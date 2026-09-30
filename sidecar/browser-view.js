/* sidecar/browser-view.js — the BROWSER window's live side: WATCH an agent's browser, and browse yourself.

   WHY THIS EXISTS (Andrew, 2026-09-30: "a browser button … so users can easily open it up to see what the agent is
   doing … should also allow the user to type a URL in"). Two pictures, one window:

     · WATCH  — every run owns its own headless Chrome (runOnce → makeBrowserTools). While a run has a page open,
                the Commander can LOOK at it: the same capture stream STEP-IN uses, frames only. Watching never
                sends input and never freezes the agent; taking the wheel is STEP-IN's job (browser-handoff.js)
                and stays there. While a handoff is live on a run this module steps aside: the handoff host owns
                that browser's one frame stream, and the window shows the STEP IN door instead.
     · YOURS  — a URL the Commander types opens in a station-owned browser session (the "commander" session):
                real Chrome, streamed into the window, mouse and keyboard forwarded. It runs on a temporary
                profile (index.js says why: the durable station profile is a single-owner lease a run must never
                lose to an open window), so a sign-in made here lasts until it closes — `remembered` reports
                that truthfully. It closes itself after ten idle minutes and whenever the window closes.

   LAWS
     · Truthful telemetry: a run is listed only while its session really has a browser open (the session itself is
       asked, never a flag we set); `remembered` comes from the session's own profile answer.
     · No agent ever receives anything from here. Frames and input flow between the station page and Chrome only;
       nothing is placed on a tool result, nothing typed is stored or logged.
     · Input goes to the Commander's OWN session only. A run's browser takes human input through a handoff or not
       at all (the agent-frozen law lives there).
     · Pure: clock and timers are injected; the composition root (index.js) supplies them. */
'use strict';
const { swallow, note: failNote } = require('./failopen.js');
const { sanitizeInput } = require('./browser-handoff.js');

const FRAME_POLL_MAX_MS = 12000;
const STREAM_IDLE_MS = 6000;               // nobody polled a picture for this long → stop capturing it
const COMMANDER_IDLE_MS = 10 * 60 * 1000;  // the Commander's session (a whole Chrome) closes after this long unused
const PAGE_INFO_EVERY_MS = 300;
const VIEW_POLL_MS = 2500;                 // a still page answers this often, so the address shown is never long stale
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
  const makeSession = typeof deps.makeCommanderSession === 'function' ? deps.makeCommanderSession : null;
  const streamIdleMs = deps.streamIdleMs > 0 ? deps.streamIdleMs : STREAM_IDLE_MS;
  const commanderIdleMs = deps.commanderIdleMs > 0 ? deps.commanderIdleMs : COMMANDER_IDLE_MS;

  const runs = new Map();    // runId -> { agentId, runId, session }
  const chans = new Map();   // target key -> channel
  let commander = null;      // { session, remembered, idleTimer, opening }

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

  // ---- runs (watch) ----
  function registerRun(info) {
    if (!info || !info.runId || !info.session) return false;
    runs.set(String(info.runId), { agentId: String(info.agentId || 'agent'), runId: String(info.runId), session: info.session });
    return true;
  }
  function unregisterRun(runId) {
    const id = String(runId || '');
    // the run is closing its own browser: never reach into it again, just forget the channel
    dropChan('run:' + id, true);
    return runs.delete(id);
  }

  // ---- the Commander's own session ----
  function touchCommander() {
    if (!commander) return;
    if (commander.idleTimer) clearT(commander.idleTimer);
    commander.idleTimer = setT(() => { closeCommander().catch(swallow('view.commander-idle-close')); }, commanderIdleMs);
    if (commander.idleTimer && typeof commander.idleTimer.unref === 'function') commander.idleTimer.unref();
  }
  async function closeCommander() {
    const c = commander; if (!c) return { ok: true, open: false };
    commander = null;
    if (c.idleTimer) clearT(c.idleTimer);
    dropChan('commander');
    try { await c.session.close(); } catch (e) { failNote('view.commander-close', e); }
    return { ok: true, open: false };
  }
  async function open(raw) {
    if (!makeSession) return { ok: false, error: 'this station cannot open a browser of its own' };
    const addr = resolveAddress(raw);
    if (!addr.ok) return addr;
    if (!commander) commander = { session: makeSession(), remembered: false, idleTimer: null };
    const c = commander;
    touchCommander();
    let finalUrl;
    try {
      if (typeof c.session.waitForProfile === 'function') await c.session.waitForProfile();
      finalUrl = await c.session.navigate(addr.url, addr.local ? { local: true } : {});
    } catch (e) {
      // a session that never got a page is not "open": close it so the profile lease is not held by a blank browser
      if (commander === c && !surfaceOf(c.session)) await closeCommander();
      return { ok: false, error: String((e && e.message) || e), url: addr.url };
    }
    if (commander !== c) return { ok: false, error: 'the browser was closed' };
    const s = surfaceOf(c.session);
    c.remembered = !!(s && s.remembered);
    const ch = chans.get('commander'); if (ch) { ch.pageAt = 0; }
    return { ok: true, url: finalUrl || addr.url, search: !!addr.search, remembered: c.remembered };
  }
  async function nav(action) {
    const c = commander;
    if (!c || !surfaceOf(c.session)) return { ok: false, error: 'open a page first' };
    touchCommander();
    try {
      if (action === 'back') await c.session.back();
      else if (action === 'forward') await c.session.forward();
      else if (action === 'reload') {
        const at = await surfaceOf(c.session).pageInfo();
        if (!at || !at.url) return { ok: false, error: 'nothing to reload' };
        const addr = resolveAddress(at.url);
        if (!addr.ok) return addr;
        await c.session.navigate(addr.url, addr.local ? { local: true } : {});
      } else return { ok: false, error: 'unknown action' };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    const ch = chans.get('commander'); if (ch) ch.pageAt = 0;
    return { ok: true };
  }
  async function input(ev) {
    const c = commander;
    const s = c ? surfaceOf(c.session) : null;
    if (!s) return { ok: false, error: 'open a page first' };
    let clean;
    try { clean = sanitizeInput(ev); } catch (e) { return { ok: false, error: e.message }; }
    touchCommander();
    await s.input(clean);
    const ch = chans.get('commander'); if (ch) ch.pageAt = 0;   // the Commander acted: re-read where the page is
    return { ok: true };
  }

  // ---- pictures ----
  function resolveTarget(target) {
    const t = String(target || '');
    if (t === 'commander') {
      const s = commander ? surfaceOf(commander.session) : null;
      return s ? { key: 'commander', surface: s } : { error: 'closed', message: 'no page is open' };
    }
    if (t.indexOf('run:') === 0) {
      const r = runs.get(t.slice(4));
      if (!r) return { error: 'ended', message: 'that run has ended' };
      if (handoffLive(r.runId)) return { error: 'handoff', message: 'this agent is waiting for you in STEP-IN' };
      const s = surfaceOf(r.session);
      return s ? { key: t, surface: s } : { error: 'closed', message: 'this agent has no browser page open' };
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
  /* Long-poll for the next picture of `target` ('commander' | 'run:<runId>'). Starts the capture on first ask and
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
    if (r.key === 'commander') touchCommander();
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
      if (c.polls === 0 && c.streaming && chans.get(r.key) === c) armIdle(c, () => { if (handoffLive(String(r.key).slice(4))) dropChan(r.key, true); else stopStream(c); });
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
    if (chans.get(r.key) !== c || !c.streaming) {
      const again = resolveTarget(target);
      return { ok: false, code: again.error || 'closed', error: again.message || 'the picture stopped' };
    }
    const page = await pageOf(c);
    return { ok: true, frame: c.frame && c.frame.seq > since ? c.frame : null, page };
  }

  function list() {
    const agents = [];
    for (const r of runs.values()) {
      const handoff = !!handoffLive(r.runId);
      if (!handoff && !surfaceOf(r.session)) continue;   // no page open: nothing to watch, nothing listed
      agents.push({ agentId: r.agentId, runId: r.runId, target: 'run:' + r.runId, handoff });
    }
    const s = commander ? surfaceOf(commander.session) : null;
    return { agents, commander: { open: !!s, remembered: !!(s && s.remembered), available: !!makeSession } };
  }
  async function closeAll() {
    for (const k of Array.from(chans.keys())) dropChan(k, k !== 'commander');
    await closeCommander();
  }

  return { registerRun, unregisterRun, open, nav, input, frame, list, close: closeCommander, closeAll,
    _internals: { runs, chans, commander: () => commander } };
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
  async function close(req, res) { respondJson(res, 200, await views.close()); }
  async function frame(req, res) {
    const u = new URL(req.url, 'http://x');
    const r = await views.frame(String(u.searchParams.get('target') || '').slice(0, 120), Number(u.searchParams.get('after')) || 0, VIEW_POLL_MS);
    if (!r.ok) return respondJson(res, 409, r);
    respondJson(res, 200, { ok: true, page: r.page || null, frame: r.frame ? { seq: r.frame.seq, mime: r.frame.mime, width: r.frame.width, height: r.frame.height, data: r.frame.data } : null });
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
      if (!r.ok) return respondJson(res, 409, { ok: false, error: r.error, applied: n });
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

module.exports = { makeBrowserViews, makeViewRoutes, resolveAddress, STREAM_IDLE_MS, COMMANDER_IDLE_MS };
