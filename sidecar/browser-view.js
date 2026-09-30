/* sidecar/browser-view.js — THE STATION BROWSER: one built-in browser the Commander and the agents SHARE.

   WHY THIS EXISTS (Andrew, 2026-09-30, after trying the first cut: "the agent is not using the built in browser or
   controlling it at all, and cant see anything"). The first cut gave every run its own private Chrome that died with
   the run, and the Commander a second browser nobody else could see — so "open YouTube" happened in a browser that
   was gone by the time you looked, and "do you see Google?" was asked of a browser that never had it. The model
   people expect (Claude Code's browser pane, Codex's in-app browser) is ONE browser:

     · the agent DRIVES it — an interactive (COMMS) run's browser.* tools are bound to this session, not a private one;
     · the Commander WATCHES it live in the BROWSER window, during the run and after it (it stays open);
     · the Commander USES it between runs — a typed address, clicks and keys go to the same page the agent will see;
     · it holds the ONE durable station profile, so a sign-in made here — by either of you — is there next time.

   ONE DRIVER AT A TIME. While a run is driving, the Commander's input is refused (they watch); taking the wheel
   mid-run is STEP-IN's handoff (browser-handoff.js) and nothing else. When nobody is driving, the Commander drives.
   A second interactive run that starts while another is driving gets a private per-run browser exactly as before
   (sessionForRun returns null), and so does every unattended run (cron, night shift, channels).

   THE PROFILE LEASE. The durable profile is a single-owner lease. The station browser holds it while open and NEVER
   gives it up to another run (Andrew: it "constantly closes" — a browser closing under you is the bug): a run that
   loses to it browses on a temporary profile instead (index.js browserProfileLeaseFor → fallback). It closes only
   after half an hour with nobody driving or watching it.

   LAWS
     · Truthful telemetry: `open` means the session really has a browser; `driver` is the run bound right now;
       `remembered` is the session's own profile answer. The address shown is the one Chrome reports.
     · No agent receives anything from here: frames and input flow between the station page and Chrome only.
     · Every ref dies when the browser changes hands (session.handTo): the page may be one the Commander opened.
     · Pure: clock and timers are injected; the composition root (index.js) supplies them. */
'use strict';
const { swallow, note: failNote } = require('./failopen.js');
const { sanitizeInput } = require('./browser-handoff.js');

const FRAME_POLL_MAX_MS = 12000;
const VIEW_POLL_MS = 2500;                 // a still page answers this often, so the address shown is never long stale
const STREAM_IDLE_MS = 6000;               // nobody polled a picture for this long → stop capturing it
const STATION_IDLE_MS = 30 * 60 * 1000;    // nobody driving, nobody watching for this long → the browser closes
const VIEWER_RECENT_MS = 15000;            // a picture was asked for this recently → somebody is watching
const PAGE_INFO_EVERY_MS = 300;
const SEARCH_URL = 'https://duckduckgo.com/?q=';

/* What the Commander typed → the address to open. A scheme is kept; a bare host gets https (http for loopback —
   a dev server rarely has a certificate); anything that is not address-shaped becomes a web search. Only http(s)
   ever comes out: file:, chrome:, javascript: and friends are refused. */
function resolveAddress(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return { ok: false, error: 'type an address' };
  if (text.length > 2000) return { ok: false, error: 'that address is too long' };
  let candidate = text;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  const loopbackHost = h => /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i.test(h) || /\.localhost$/i.test(h);
  if (scheme && !/^[^/:]+:\d{1,5}(\/|$)/.test(text)) {   // "localhost:3000/x" is host:port, not a scheme
    if (!/^https?$/i.test(scheme[1])) return { ok: false, error: 'only http and https addresses open here' };
  } else if (/\s/.test(text) || !/^[^/]+\.[^/]+|^localhost\b|^\[?[0-9a-f:.]+\]?(:\d+)?(\/|$)/i.test(text)) {
    return { ok: true, url: SEARCH_URL + encodeURIComponent(text), local: false, search: true };
  } else {
    const hostPart = text.split('/')[0].replace(/:\d+$/, '');
    candidate = (loopbackHost(hostPart) ? 'http://' : 'https://') + text;
  }
  let u;
  try { u = new URL(candidate); } catch (_) { return { ok: true, url: SEARCH_URL + encodeURIComponent(text), local: false, search: true }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'only http and https addresses open here' };
  return { ok: true, url: u.href, local: loopbackHost(u.hostname), search: false };
}

function makeBrowserViews(deps) {
  deps = deps || {};
  if (typeof deps.now !== 'function') throw new Error('browser-view requires deps.now (the composition root injects the clock)');
  const now = deps.now;
  const setT = deps.setTimeout || setTimeout;
  const clearT = deps.clearTimeout || clearTimeout;
  const handoffLive = typeof deps.handoffLive === 'function' ? deps.handoffLive : () => false;
  const makeSession = typeof deps.makeStationSession === 'function' ? deps.makeStationSession : null;
  const downloadDirFor = typeof deps.downloadDirFor === 'function' ? deps.downloadDirFor : () => null;
  const attended = deps.attended || null;   // the session's attendedLogin holder: .prompt is set to the driving run's
  const streamIdleMs = deps.streamIdleMs > 0 ? deps.streamIdleMs : STREAM_IDLE_MS;
  const stationIdleMs = deps.stationIdleMs > 0 ? deps.stationIdleMs : STATION_IDLE_MS;

  const runs = new Map();    // runId -> { agentId, runId, session }   private per-run browsers (watch only)
  const chans = new Map();   // target key -> channel
  let station = null;        // { session, driver: null|{agentId,runId}, idleTimer, lastPollAt }

  function surfaceOf(session) {
    try { return session && typeof session.handoffSurface === 'function' ? session.handoffSurface() : null; }
    catch (_) { return null; }   // "no browser page is open" — the honest answer is simply: nothing to show yet
  }
  function chan(key) {
    let c = chans.get(key);
    if (!c) { c = { key, surface: null, streaming: false, frame: null, seq: 0, waiters: new Set(), idle: null, polls: 0, page: null, pageAt: 0 }; chans.set(key, c); }
    return c;
  }
  function wake(c) { for (const w of Array.from(c.waiters)) { try { w(); } catch (e) { failNote('view.wake', e); } } c.waiters.clear(); }
  function stopStream(c, keepDriverStream) {
    if (c.idle) { clearT(c.idle); c.idle = null; }
    if (c.streaming && c.surface && !keepDriverStream) {
      try { const p = c.surface.stopStream(); if (p && typeof p.catch === 'function') p.catch(swallow('view.stop-stream')); }
      catch (e) { failNote('view.stop-stream', e); }
    }
    c.streaming = false; c.surface = null;
    wake(c);
  }
  function dropChan(key, keepDriverStream) { const c = chans.get(key); if (!c) return; stopStream(c, keepDriverStream); chans.delete(key); }
  function armIdle(c, onIdle) {
    if (c.idle) clearT(c.idle);
    c.idle = setT(() => { c.idle = null; onIdle(); }, streamIdleMs);
    if (c.idle && typeof c.idle.unref === 'function') c.idle.unref();
  }

  // ---- the station browser's life ----
  function touchStation() {
    if (!station) return;
    if (station.idleTimer) { clearT(station.idleTimer); station.idleTimer = null; }
    if (station.driver) return;   // a run is driving: it cannot be idle
    station.idleTimer = setT(() => {
      if (!station || station.driver) return;
      if (now() - station.lastPollAt < VIEWER_RECENT_MS) return touchStation();   // somebody is looking at it
      closeStation().catch(swallow('view.station-idle-close'));
    }, stationIdleMs);
    if (station.idleTimer && typeof station.idleTimer.unref === 'function') station.idleTimer.unref();
  }
  async function closeStation() {
    const st = station; if (!st) return { ok: true, open: false };
    if (st.driver) return { ok: false, error: 'an agent is driving the browser right now' };
    station = null;
    if (st.idleTimer) clearT(st.idleTimer);
    dropChan('station');
    if (attended) attended.prompt = undefined;
    try { await st.session.close(); } catch (e) { failNote('view.station-close', e); }
    return { ok: true, open: false };
  }
  function ensureStation() {
    if (!station) station = { session: makeSession(), driver: null, idleTimer: null, lastPollAt: 0 };
    return station;
  }
  // ---- a run takes / releases the station browser ----
  /* Session methods that do not DRIVE the page: asking them never makes a run the driver. */
  const PASSIVE = new Set(['handoffSurface', 'freeze', 'thaw', 'frozen', 'handTo', 'hasDriver', 'visible', 'headlessFallback', 'attachedPort', 'lastResponse', 'evalAllowed', 'close']);
  /* An interactive run asks for the station browser. It gets a VIEW of the shared session, and becomes the DRIVER
     only when it actually uses it (its first driving call) — a run that never browses never locks the Commander
     out, and "driving" is only ever said of a run that is. Returns null when the run must use a private browser
     (not interactive, or no station browser on this host). While another run is driving, a driving call throws. */
  function sessionForRun(info) {
    info = info || {};
    if (!makeSession || info.interactive !== true || !info.runId) return null;
    const me = { agentId: String(info.agentId || 'agent'), runId: String(info.runId) };
    const loginPrompt = typeof info.loginPrompt === 'function' ? info.loginPrompt : undefined;
    // returns null when this run already drives; a promise while it takes the wheel; throws when another run has it
    function take() {
      const st = ensureStation();
      if (st.driver && st.driver.runId === me.runId) return null;
      if (st.driver) throw new Error('the station browser is in use by another run right now — retry after it finishes');
      st.driver = me;
      if (st.idleTimer) { clearT(st.idleTimer); st.idleTimer = null; }
      if (attended) attended.prompt = loginPrompt;
      const c = chans.get('station'); if (c) c.pageAt = 0;
      if (typeof st.session.handTo !== 'function') return null;
      return Promise.resolve(st.session.handTo({ downloadDir: downloadDirFor(me.agentId) })).catch(e => { failNote('view.hand-to', e); });
    }
    return new Proxy({}, {
      get(_t, prop) {
        const st = ensureStation();
        const v = st.session[prop];
        if (typeof v !== 'function') return v;
        if (PASSIVE.has(String(prop))) return v.bind(st.session);
        return (...args) => {
          const taking = take();
          return taking ? taking.then(() => ensureStation().session[prop](...args)) : v.apply(st.session, args);
        };
      },
      has(_t, prop) { return prop in ensureStation().session; }
    });
  }
  function releaseRun(runId) {
    if (!station || !station.driver || station.driver.runId !== String(runId || '')) return false;
    station.driver = null;
    if (attended) attended.prompt = undefined;
    touchStation();
    return true;
  }
  function registerRun(info) {   // a PRIVATE per-run browser: the Commander may still watch it
    if (!info || !info.runId || !info.session) return false;
    runs.set(String(info.runId), { agentId: String(info.agentId || 'agent'), runId: String(info.runId), session: info.session });
    return true;
  }
  function unregisterRun(runId) {
    const id = String(runId || '');
    dropChan('run:' + id, true);   // the run is closing its own browser: never reach into it again
    return runs.delete(id);
  }

  // ---- the Commander's hands (only while no run is driving) ----
  function driving() {
    const d = station && station.driver;
    return d ? { ok: false, code: 'driving', agentId: d.agentId, error: 'an agent is driving the browser right now — you can watch, and it hands you the wheel in STEP-IN if it needs you' } : null;
  }
  async function open(raw) {
    if (!makeSession) return { ok: false, error: 'this station cannot open a browser of its own' };
    const addr = resolveAddress(raw);
    if (!addr.ok) return addr;
    const busy = driving(); if (busy) return busy;
    const st = ensureStation();
    touchStation();
    let finalUrl;
    try {
      if (typeof st.session.waitForProfile === 'function') await st.session.waitForProfile();
      finalUrl = await st.session.navigate(addr.url, addr.local ? { local: true } : {});
    } catch (e) {
      // a session that never got a page is not "open": close it so the profile lease is not held by a blank browser
      if (station === st && !st.driver && !surfaceOf(st.session)) await closeStation();
      return { ok: false, error: String((e && e.message) || e), url: addr.url };
    }
    if (station !== st) return { ok: false, error: 'the browser was closed' };
    const s = surfaceOf(st.session);
    const ch = chans.get('station'); if (ch) ch.pageAt = 0;
    return { ok: true, url: finalUrl || addr.url, search: !!addr.search, remembered: !!(s && s.remembered) };
  }
  async function nav(action) {
    const busy = driving(); if (busy) return busy;
    const st = station;
    if (!st || !surfaceOf(st.session)) return { ok: false, error: 'open a page first' };
    touchStation();
    try {
      if (action === 'back') await st.session.back();
      else if (action === 'forward') await st.session.forward();
      else if (action === 'reload') {
        const at = await surfaceOf(st.session).pageInfo();
        if (!at || !at.url) return { ok: false, error: 'nothing to reload' };
        const addr = resolveAddress(at.url);
        if (!addr.ok) return addr;
        await st.session.navigate(addr.url, addr.local ? { local: true } : {});
      } else return { ok: false, error: 'unknown action' };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    const ch = chans.get('station'); if (ch) ch.pageAt = 0;
    return { ok: true };
  }
  async function input(ev) {
    const busy = driving(); if (busy) return busy;
    const st = station;
    const s = st ? surfaceOf(st.session) : null;
    if (!s) return { ok: false, error: 'open a page first' };
    let clean;
    try { clean = sanitizeInput(ev); } catch (e) { return { ok: false, error: e.message }; }
    touchStation();
    await s.input(clean);
    const ch = chans.get('station'); if (ch) ch.pageAt = 0;   // the Commander acted: re-read where the page is
    return { ok: true };
  }

  // ---- pictures ----
  function resolveTarget(target) {
    const t = String(target || '');
    if (t === 'station') {
      const st = station;
      if (st && st.driver && handoffLive(st.driver.runId)) return { error: 'handoff', message: 'the agent is waiting for you in STEP-IN' };
      const s = st ? surfaceOf(st.session) : null;
      return s ? { key: 'station', surface: s, handoffRun: st.driver ? st.driver.runId : '' } : { error: 'closed', message: 'no page is open' };
    }
    if (t.indexOf('run:') === 0) {
      const r = runs.get(t.slice(4));
      if (!r) return { error: 'ended', message: 'that run has ended' };
      if (handoffLive(r.runId)) return { error: 'handoff', message: 'this agent is waiting for you in STEP-IN' };
      const s = surfaceOf(r.session);
      return s ? { key: t, surface: s, handoffRun: r.runId } : { error: 'closed', message: 'this agent has no browser page open' };
    }
    return { error: 'unknown', message: 'unknown browser' };
  }
  async function pageOf(c) {
    if (c.page && now() - c.pageAt < PAGE_INFO_EVERY_MS) return c.page;
    try { const p = await c.surface.pageInfo(); c.page = { url: String((p && p.url) || ''), title: String((p && p.title) || '') }; }
    catch (e) { failNote('view.page-info', e); }
    c.pageAt = now();
    return c.page;
  }
  /* Long-poll for the next picture of `target` ('station' | 'run:<runId>'). Starts the capture on first ask and
     stops it when nobody has asked for streamIdleMs. */
  async function frame(target, after, budgetMs) {
    const r = resolveTarget(target);
    if (r.error) {
      // a handoff took this browser's one stream: forget ours without touching the driver's
      if (r.error === 'handoff') dropChan(String(target), true);
      else if (r.error !== 'unknown') dropChan(String(target), r.error === 'ended');
      return { ok: false, code: r.error, error: r.message };
    }
    const c = chan(r.key);
    if (r.key === 'station' && station) { station.lastPollAt = now(); touchStation(); }
    if (!c.streaming) {
      c.surface = r.surface; c.streaming = true;
      try {
        await c.surface.startStream(f => {
          if (!c.streaming || !f || !f.data) return;
          c.frame = { seq: ++c.seq, mime: f.mime || 'image/jpeg', width: f.width, height: f.height, data: f.data };
          wake(c);
        });
      } catch (e) { stopStream(c, true); return { ok: false, code: 'closed', error: String((e && e.message) || e) }; }
    }
    // "Nobody is watching" is measured from the END of the last poll: a long-poll on a still page is somebody
    // watching, and the idle clock must not run underneath it.
    if (c.idle) { clearT(c.idle); c.idle = null; }
    c.polls++;
    const release = () => {
      c.polls = Math.max(0, c.polls - 1);
      if (c.polls === 0 && c.streaming && chans.get(r.key) === c) armIdle(c, () => { if (r.handoffRun && handoffLive(r.handoffRun)) dropChan(r.key, true); else stopStream(c); });
    };
    const since = Number(after) || 0;
    if (!(c.frame && c.frame.seq > since)) {
      const wait = Math.max(0, Math.min(FRAME_POLL_MAX_MS, Number(budgetMs) >= 0 ? Number(budgetMs) : FRAME_POLL_MAX_MS));
      if (wait > 0) await new Promise(resolve => {
        const t = setT(done, wait);
        function done() { clearT(t); c.waiters.delete(done); resolve(); }
        c.waiters.add(done);
      });
    }
    release();
    if (r.key === 'station' && station) station.lastPollAt = now();
    if (chans.get(r.key) !== c || !c.streaming) {
      const again = resolveTarget(target);
      return { ok: false, code: again.error || 'closed', error: again.message || 'the picture stopped' };
    }
    const page = await pageOf(c);
    const d = r.key === 'station' && station ? station.driver : null;
    return { ok: true, frame: c.frame && c.frame.seq > since ? c.frame : null, page, driver: d ? { agentId: d.agentId, runId: d.runId } : null };
  }

  function list() {
    const agents = [];
    for (const r of runs.values()) {
      const handoff = !!handoffLive(r.runId);
      if (!handoff && !surfaceOf(r.session)) continue;   // no page open: nothing to watch, nothing listed
      agents.push({ agentId: r.agentId, runId: r.runId, target: 'run:' + r.runId, handoff });
    }
    const st = station;
    const s = st ? surfaceOf(st.session) : null;
    const d = st && st.driver ? { agentId: st.driver.agentId, runId: st.driver.runId } : null;
    return { agents, station: { available: !!makeSession, open: !!s, driver: d, handoff: !!(d && handoffLive(d.runId)), remembered: !!(s && s.remembered) } };
  }
  async function closeAll() {
    for (const k of Array.from(chans.keys())) dropChan(k, k !== 'station');
    if (station) { station.driver = null; await closeStation(); }
  }

  return { sessionForRun, releaseRun, registerRun, unregisterRun, open, nav, input, frame, list, close: closeStation, closeAll,
    _internals: { runs, chans, station: () => station } };
}

function makeViewRoutes(deps) {
  const { views, readBody, respondJson } = deps;
  const MAX_EVENTS = 64;
  async function body(req, max) { try { return JSON.parse(await readBody(req, max || 8192)) || {}; } catch (_) { return null; } }
  async function list(req, res) { respondJson(res, 200, Object.assign({ ok: true }, views.list())); }
  async function open(req, res) {
    const b = await body(req); if (!b) return respondJson(res, 400, { ok: false, error: 'bad json' });
    const r = await views.open(b.url);
    respondJson(res, r.ok ? 200 : 409, r);
  }
  async function nav(req, res) {
    const b = await body(req); if (!b) return respondJson(res, 400, { ok: false, error: 'bad json' });
    const r = await views.nav(String(b.action || ''));
    respondJson(res, r.ok ? 200 : 409, r);
  }
  async function close(req, res) { const r = await views.close(); respondJson(res, r.ok ? 200 : 409, r); }
  async function frame(req, res) {
    const u = new URL(req.url, 'http://x');
    const r = await views.frame(String(u.searchParams.get('target') || '').slice(0, 120), Number(u.searchParams.get('after')) || 0, VIEW_POLL_MS);
    if (!r.ok) return respondJson(res, 409, r);
    respondJson(res, 200, { ok: true, page: r.page || null, driver: r.driver || null, frame: r.frame ? { seq: r.frame.seq, mime: r.frame.mime, width: r.frame.width, height: r.frame.height, data: r.frame.data } : null });
  }
  async function input(req, res) {
    const b = await body(req, 64 * 1024); if (!b) return respondJson(res, 400, { ok: false, error: 'bad json' });
    const events = Array.isArray(b.events) ? b.events.slice(0, MAX_EVENTS) : [];
    if (!events.length) return respondJson(res, 400, { ok: false, error: 'no input events' });
    let n = 0;
    for (const ev of events) {
      let r;
      try { r = await views.input(ev); }
      catch (e) { return respondJson(res, 502, { ok: false, error: 'the browser did not take the input: ' + ((e && e.message) || e), applied: n }); }
      if (!r.ok) return respondJson(res, 409, Object.assign({}, r, { applied: n }));
      n++;
    }
    respondJson(res, 200, { ok: true, applied: n });
  }
  return {
    routes: [
      { m: 'GET', exact: '/api/browser/view', h: list },
      { m: 'POST', exact: '/api/browser/view/open', h: open },
      { m: 'POST', exact: '/api/browser/view/nav', h: nav },
      { m: 'POST', exact: '/api/browser/view/close', h: close },
      { m: 'GET', qsplit: '/api/browser/view/frame', h: frame },
      { m: 'POST', exact: '/api/browser/view/input', h: input }
    ]
  };
}

module.exports = { makeBrowserViews, makeViewRoutes, resolveAddress, STREAM_IDLE_MS, STATION_IDLE_MS };
