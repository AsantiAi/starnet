/* sidecar/browser-handoff.js — STEP-IN: the agent hands its live browser to the Commander and waits.

   WHY THIS EXISTS. An agent browsing on its own dead-ends at every login, 2FA prompt and CAPTCHA, and the
   Commander could not even see that it had. STEP-IN is the handoff: the agent asks (browser.need_human), its run
   PARKS here, the station shows the agent's own browser in a docked window, the Commander signs in inside that
   SAME browser, presses HAND BACK, and the agent carries on from the page they left it on. One browser, two
   drivers, never at the same time.

   THE LAWS THIS MODULE HOLDS (Andrew, 2026-09-29 plan):
     · A handoff has its OWN id and its own wait. It is not a permission.prompt on the /api/run socket: that
       channel auto-denies in minutes and dies with the tab, and a phone or Telegram must be able to resolve a
       handoff later. It still ends when the RUN ends (the run's signal aborts it) — a run that is gone has
       nobody to hand back to.
     · 30 minutes, then it EXPIRES and the agent is told truthfully that nobody came. Taking the wheel restarts
       the clock, so a slow sign-in is never cut off by the time the request sat unanswered.
     · The agent is FROZEN while a handoff is live. This module owns the live-state truth (isLive) the browser
       session's frozen guard reads; the session refuses every page read until the handoff settles.
     · The agent never sees what the Commander types. Frames and input flow between the station page and the
       browser only: nothing here is placed on a tool result, and input events are never stored or logged.
     · Truthful telemetry: every state the UI shows comes from `view()` of a record in this registry; a terminal
       record says HOW it ended (returned / cancelled / expired / aborted) — never a stale "waiting for you".

   Pure host logic with injected clock/timers/emit so the state machine is unit-tested without Chrome
   (test/browser-handoff.test.js). The browser side is a `surface` object supplied by the session:
     { startStream(onFrame) -> Promise, stopStream() -> Promise, input(ev) -> Promise, pageInfo() -> Promise<{url,title}> } */
'use strict';
const { swallow, note: failNote } = require('./failopen.js');

const WAIT_MS = 30 * 60 * 1000;
const NUDGE_MS = 2 * 60 * 1000;
const REASONS = ['login', '2fa', 'captcha', 'payment', 'other'];
const TERMINAL = new Set(['returned', 'cancelled', 'expired', 'aborted']);
const KEEP_RECENT = 12;
const FRAME_POLL_MAX_MS = 15000;

function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; }

/* The UI shows WHERE the agent is, never a full URL: a query string can carry a one-time token or an email
   address the site put there, and the station SSE log is replayable. Origin + path is enough to say
   "github.com/login". */
function safeLocation(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { host: '', where: '' };
    return { host: u.host, where: u.host + (u.pathname && u.pathname !== '/' ? clip(u.pathname, 120) : '') };
  } catch (_) { return { host: '', where: '' }; }
}

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const BUTTONS = new Set(['left', 'middle', 'right', 'none']);

/* The ONLY input shapes the station page may forward. Anything else is refused before it reaches Chrome:
   the endpoint drives a real signed-in browser, so it accepts pointer/keyboard vocabulary, not CDP. */
function sanitizeInput(ev) {
  ev = ev || {};
  const mods = num(ev.modifiers, 0, 15, 0) | 0;
  if (ev.type === 'mouse') {
    const action = String(ev.action || '');
    if (!['move', 'down', 'up'].includes(action)) throw new Error('bad mouse action');
    const button = BUTTONS.has(String(ev.button)) ? String(ev.button) : (action === 'move' ? 'none' : 'left');
    return { type: 'mouse', action, x: num(ev.x, 0, 20000, 0), y: num(ev.y, 0, 20000, 0), button, clickCount: num(ev.clickCount, 0, 3, action === 'move' ? 0 : 1) | 0, modifiers: mods };
  }
  if (ev.type === 'wheel') {
    return { type: 'wheel', x: num(ev.x, 0, 20000, 0), y: num(ev.y, 0, 20000, 0), dx: num(ev.dx, -5000, 5000, 0), dy: num(ev.dy, -5000, 5000, 0), modifiers: mods };
  }
  if (ev.type === 'key') {
    const action = String(ev.action || '');
    if (action !== 'down' && action !== 'up') throw new Error('bad key action');
    const key = clip(ev.key, 32), code = clip(ev.code, 32);
    if (!key && !code) throw new Error('key event needs key or code');
    const out = { type: 'key', action, key, code, keyCode: num(ev.keyCode, 0, 255, 0) | 0, modifiers: mods };
    // `text` is the character a keyDown inserts. One grapheme-ish unit at most — a paste goes through `text`.
    if (action === 'down' && typeof ev.text === 'string' && ev.text.length && ev.text.length <= 4) out.text = ev.text;
    return out;
  }
  if (ev.type === 'text') {
    const text = String(ev.text == null ? '' : ev.text);
    if (!text || text.length > 4000) throw new Error('text must be 1-4000 characters');
    return { type: 'text', text };
  }
  throw new Error('unsupported input type');
}

function makeHandoffHost(deps) {
  deps = deps || {};
  if (typeof deps.now !== 'function') throw new Error('browser-handoff requires deps.now (the composition root injects the clock)');
  const now = deps.now;
  const uuid = typeof deps.uuid === 'function' ? deps.uuid : () => require('node:crypto').randomUUID();
  const setT = deps.setTimeout || setTimeout;
  const clearT = deps.clearTimeout || clearTimeout;
  const emit = typeof deps.emit === 'function' ? deps.emit : () => {};
  const waitMs = deps.waitMs > 0 ? deps.waitMs : WAIT_MS;
  const nudgeMs = deps.nudgeMs === 0 ? 0 : (deps.nudgeMs > 0 ? deps.nudgeMs : NUDGE_MS);
  const onNudge = typeof deps.onNudge === 'function' ? deps.onNudge : null;
  const onSettled = typeof deps.onSettled === 'function' ? deps.onSettled : null;
  const live = new Map();     // id -> entry
  const recent = [];          // terminal views, newest last (bounded)

  function view(rec) {
    return {
      id: rec.id, agentId: rec.agentId, runId: rec.runId, state: rec.state, reason: rec.reason, note: rec.note,
      host: rec.host, where: rec.where, title: rec.title, remembered: rec.remembered,
      requestedAt: rec.requestedAt, takenAt: rec.takenAt, endedAt: rec.endedAt, expiresAt: rec.expiresAt
    };
  }
  function publish(rec) { try { emit('browser.handoff', view(rec)); } catch (e) { failNote('handoff.publish', e); } }
  function unref(t) { if (t && typeof t.unref === 'function') t.unref(); return t; }
  function arm(entry) {
    if (entry.timer) clearT(entry.timer);
    entry.rec.expiresAt = now() + waitMs;
    entry.timer = unref(setT(() => finish(entry.rec.id, 'expired'), waitMs));
  }

  function request(fields) {
    fields = fields || {};
    const agentId = clip(fields.agentId, 80), runId = clip(fields.runId, 120);
    if (!agentId || !runId) throw new Error('a handoff needs the agent and run it belongs to');
    const s = fields.surface;
    if (!s || typeof s.startStream !== 'function' || typeof s.stopStream !== 'function' || typeof s.input !== 'function') {
      throw new Error('a handoff needs a live browser surface');
    }
    for (const e of live.values()) {
      if (e.rec.runId === runId) throw new Error('this run is already waiting on handoff ' + e.rec.id);
    }
    if (fields.signal && fields.signal.aborted) throw new Error('the run was stopped before the handoff opened');
    const reason = REASONS.includes(String(fields.reason)) ? String(fields.reason) : 'other';
    const loc = safeLocation(fields.url);
    const rec = {
      id: 'ho_' + String(uuid()).replace(/[^A-Za-z0-9]/g, '').slice(0, 24),
      agentId, runId, reason, note: clip(fields.note, 240), host: loc.host, where: loc.where,
      title: clip(fields.title, 160), remembered: fields.remembered === true,
      state: 'waiting', requestedAt: now(), takenAt: null, endedAt: null, expiresAt: 0
    };
    const entry = { rec, surface: s, resolve: null, timer: null, nudge: null, frame: null, seq: 0, waiters: new Set(), signal: fields.signal || null, onAbort: null };
    const done = new Promise(resolve => { entry.resolve = resolve; });
    live.set(rec.id, entry);
    arm(entry);
    if (nudgeMs && onNudge) {
      entry.nudge = unref(setT(() => {
        entry.nudge = null;
        if (live.get(rec.id) === entry && entry.rec.state === 'waiting') { try { onNudge(view(rec)); } catch (e) { failNote('handoff.nudge', e); } }
      }, nudgeMs));
    }
    if (entry.signal && typeof entry.signal.addEventListener === 'function') {
      entry.onAbort = () => finish(rec.id, 'aborted');
      entry.signal.addEventListener('abort', entry.onAbort, { once: true });
    }
    publish(rec);
    return { id: rec.id, view: view(rec), done };
  }

  function wake(entry) { for (const w of Array.from(entry.waiters)) { try { w(); } catch (e) { failNote('handoff.wake', e); } } entry.waiters.clear(); }

  async function take(id) {
    const entry = live.get(String(id || ''));
    if (!entry) return { ok: false, error: 'no live handoff ' + id };
    if (entry.rec.state === 'taken') return { ok: true, view: view(entry.rec) };
    entry.rec.state = 'taken';
    entry.rec.takenAt = now();
    arm(entry);   // the Commander is working now: a fresh 30 minutes, not what is left of the wait
    if (entry.nudge) { clearT(entry.nudge); entry.nudge = null; }
    publish(entry.rec);
    try {
      await entry.surface.startStream(frame => {
        if (live.get(entry.rec.id) !== entry || !frame || !frame.data) return;
        entry.frame = { seq: ++entry.seq, data: String(frame.data), mime: frame.mime || 'image/jpeg', width: Number(frame.width) || 0, height: Number(frame.height) || 0 };
        wake(entry);
      });
    } catch (e) {
      // A stream that will not start leaves the Commander with nothing to drive. Say so; the handoff stays
      // TAKEN (they can still hand back or cancel) rather than pretending the wheel works.
      return { ok: false, error: 'could not stream the agent browser: ' + ((e && e.message) || e), view: view(entry.rec) };
    }
    return { ok: true, view: view(entry.rec) };
  }

  function finish(id, state) {
    const entry = live.get(String(id || ''));
    if (!entry || !TERMINAL.has(state)) return null;
    live.delete(entry.rec.id);
    if (entry.timer) clearT(entry.timer);
    if (entry.nudge) clearT(entry.nudge);
    if (entry.signal && entry.onAbort) { try { entry.signal.removeEventListener('abort', entry.onAbort); } catch (e) { failNote('handoff.unlisten', e); } }
    entry.rec.state = state;
    entry.rec.endedAt = now();
    entry.frame = null;
    wake(entry);
    try { const p = entry.surface.stopStream(); if (p && typeof p.catch === 'function') p.catch(swallow('handoff.stop-stream')); } catch (e) { failNote('handoff.stop-stream', e); }
    const v = view(entry.rec);
    recent.push(v);
    while (recent.length > KEEP_RECENT) recent.shift();
    publish(entry.rec);
    if (onSettled) { try { onSettled(v); } catch (e) { failNote('handoff.settled', e); } }
    entry.resolve(v);
    return v;
  }

  const handBack = id => finish(id, 'returned');
  const cancel = id => finish(id, 'cancelled');
  function abortRun(runId) {
    let n = 0;
    for (const e of Array.from(live.values())) if (e.rec.runId === runId) { finish(e.rec.id, 'aborted'); n++; }
    return n;
  }

  /* Long-poll for the next frame: answers at once when a frame newer than `after` exists, otherwise waits (bounded)
     for one. Only a TAKEN handoff streams — a waiting one has no frames to leak, and a settled one never serves the
     page again. */
  async function frame(id, after, budgetMs) {
    const entry = live.get(String(id || ''));
    if (!entry) return { ok: false, error: 'no live handoff ' + id };
    if (entry.rec.state !== 'taken') return { ok: false, error: 'take the wheel first' };
    const since = Number(after) || 0;
    if (entry.frame && entry.frame.seq > since) return { ok: true, frame: entry.frame };
    const wait = num(budgetMs, 0, FRAME_POLL_MAX_MS, FRAME_POLL_MAX_MS);
    await new Promise(resolve => {
      const t = setT(done, wait);
      function done() { clearT(t); entry.waiters.delete(done); resolve(); }
      entry.waiters.add(done);
    });
    if (live.get(entry.rec.id) !== entry) return { ok: false, error: 'handoff ended', state: entry.rec.state };
    if (entry.frame && entry.frame.seq > since) return { ok: true, frame: entry.frame };
    return { ok: true, frame: null };
  }

  async function input(id, ev) {
    const entry = live.get(String(id || ''));
    if (!entry) return { ok: false, error: 'no live handoff ' + id };
    if (entry.rec.state !== 'taken') return { ok: false, error: 'take the wheel first' };
    let clean;
    try { clean = sanitizeInput(ev); } catch (e) { return { ok: false, error: e.message }; }
    await entry.surface.input(clean);
    return { ok: true };
  }

  function get(id) {
    const entry = live.get(String(id || ''));
    if (entry) return view(entry.rec);
    for (let i = recent.length - 1; i >= 0; i--) if (recent[i].id === id) return Object.assign({}, recent[i]);
    return null;
  }
  function list() {
    return { live: Array.from(live.values()).map(e => view(e.rec)), recent: recent.slice().reverse() };
  }
  function isLive(runId) { for (const e of live.values()) if (e.rec.runId === runId) return true; return false; }

  return { request, take, handBack, cancel, abortRun, frame, input, get, list, isLive, _internals: { live, recent } };
}

module.exports = { makeHandoffHost, sanitizeInput, safeLocation, REASONS, WAIT_MS, NUDGE_MS };
