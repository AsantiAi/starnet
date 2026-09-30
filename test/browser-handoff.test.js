/* node test/browser-handoff.test.js — STEP-IN handoff state machine (sidecar/browser-handoff.js).

   Pins the laws the handoff host owns: its own id and wait (not the consent channel), waiting → taken →
   returned / cancelled / expired / aborted, taking the wheel restarts the 30-minute clock, the run's own signal
   ends it, frames and input exist ONLY while the Commander holds the wheel, the input vocabulary is closed,
   and every state change is published as a browser.handoff event the station can render truthfully. */
'use strict';
const A = require('./_assert.js');
const H = require('../sidecar/browser-handoff.js');
const events = require('../shared/events.js');

function fakeClock() {
  let t = 1000, seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: id => { timers.delete(id); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, tm] of timers) if (tm.at <= end && (!next || tm.at < next[1].at)) next = [id, tm];
        if (!next) break;
        timers.delete(next[0]); t = next[1].at; next[1].fn();
      }
      t = end;
    },
    pending: () => timers.size
  };
}
function fakeSurface() {
  const s = { started: 0, stopped: 0, inputs: [], onFrame: null };
  s.startStream = async fn => { s.started++; s.onFrame = fn; };
  s.stopStream = async () => { s.stopped++; s.onFrame = null; };
  s.input = async ev => { s.inputs.push(ev); };
  return s;
}
const flush = () => new Promise(r => setImmediate(r));

(async () => {
  // ---- request → waiting, own id, event validates against the shared contract ----
  {
    const clk = fakeClock(); const emitted = []; const nudges = [];
    const host = H.makeHandoffHost({ now: clk.now, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout, uuid: () => 'abc-123', emit: (n, p) => emitted.push([n, p]), onNudge: v => nudges.push(v) });
    const surf = fakeSurface();
    const r = host.request({ agentId: 'nova', runId: 'run1', reason: 'login', note: 'Sign in to GitHub so I can open the PR', url: 'https://github.com/login?return_to=%2Fsecret&token=zzz', title: 'Sign in to GitHub', surface: surf });
    A.eq(r.id, 'ho_abc123', 'a handoff gets its own id (not a consent promptId)');
    A.eq(r.view.state, 'waiting', 'a new handoff is waiting for the Commander');
    A.eq(r.view.where, 'github.com/login', 'the UI location drops the query string (tokens stay out of the SSE log)');
    A.eq(r.view.expiresAt, 1000 + H.WAIT_MS, 'the wait is 30 minutes, its own clock');
    A.ok(host.isLive('run1'), 'isLive is true while waiting (the frozen guard reads this)');
    A.eq(emitted.length, 1, 'requesting publishes one browser.handoff event');
    A.eq(emitted[0][0], 'browser.handoff', 'the event name is browser.handoff');
    A.ok(events.validate('browser.handoff', emitted[0][1]).ok, 'the event payload validates against shared/events.js: ' + JSON.stringify(events.validate('browser.handoff', emitted[0][1]).errors));
    A.throws(() => host.request({ agentId: 'nova', runId: 'run1', surface: fakeSurface() }), 'one live handoff per run');
    // no frames or input before the wheel is taken
    A.eq((await host.frame(r.id, 0, 0)).ok, false, 'a WAITING handoff serves no frames');
    A.eq((await host.input(r.id, { type: 'text', text: 'x' })).ok, false, 'a WAITING handoff accepts no input');
    A.eq(surf.inputs.length, 0, 'nothing reached the browser');

    // ---- the 2-minute nudge fires only while still waiting ----
    clk.advance(H.NUDGE_MS);
    A.eq(nudges.length, 1, 'an unanswered handoff nudges once after 2 minutes');

    // ---- take: stream starts, clock restarts ----
    clk.advance(10 * 60 * 1000);
    const tk = await host.take(r.id);
    A.ok(tk.ok, 'take succeeds');
    A.eq(tk.view.state, 'taken', 'the Commander now holds the wheel');
    A.eq(tk.view.expiresAt, clk.now() + H.WAIT_MS, 'taking the wheel restarts the 30-minute clock');
    A.eq(surf.started, 1, 'taking the wheel starts the browser stream');
    A.ok(host.isLive('run1'), 'still live (agent still frozen) while taken');

    // ---- frames: long-poll delivers the newest frame ----
    const poll = host.frame(r.id, 0, 5000);
    surf.onFrame({ data: 'AAAA', width: 1440, height: 900 });
    const got = await poll;
    A.ok(got.ok && got.frame && got.frame.seq === 1 && got.frame.data === 'AAAA', 'a waiting poll wakes with the first frame');
    const again = await host.frame(r.id, 0, 0);
    A.eq(again.frame && again.frame.seq, 1, 'a poll behind the newest frame answers at once');
    const none = host.frame(r.id, 1, 3000);
    clk.advance(3000);
    A.eq((await none).frame, null, 'a poll with nothing newer times out empty (bounded)');

    // ---- input: sanitized vocabulary reaches the surface ----
    A.ok((await host.input(r.id, { type: 'mouse', action: 'down', x: 100.4, y: 50, button: 'left', clickCount: 1 })).ok, 'a mouse press is forwarded');
    A.ok((await host.input(r.id, { type: 'key', action: 'down', key: 'a', code: 'KeyA', keyCode: 65, text: 'a' })).ok, 'a key press is forwarded');
    A.ok((await host.input(r.id, { type: 'text', text: 'pasted words' })).ok, 'a paste is forwarded as text');
    A.eq((await host.input(r.id, { type: 'cdp', method: 'Runtime.evaluate' })).ok, false, 'anything outside the vocabulary is refused');
    A.eq((await host.input(r.id, { type: 'mouse', action: 'teleport' })).ok, false, 'an unknown mouse action is refused');
    A.eq(surf.inputs.length, 3, 'only the three valid events reached the browser');
    A.eq(surf.inputs[0].button, 'left', 'button survives sanitizing');

    // ---- hand back resolves the agent's wait ----
    const v = host.handBack(r.id);
    A.eq(v.state, 'returned', 'hand back settles the handoff as returned');
    const outcome = await r.done;
    A.eq(outcome.state, 'returned', 'the agent\'s wait resolves with returned');
    A.ok(!host.isLive('run1'), 'the agent unfreezes when the handoff settles');
    A.eq(surf.stopped, 1, 'settling stops the stream');
    A.eq((await host.frame(r.id, 0, 0)).ok, false, 'a settled handoff never serves the page again');
    A.eq(host.get(r.id).state, 'returned', 'the settled record stays readable (truthful history)');
    A.eq(host.list().recent[0].id, r.id, 'recent lists the settled handoff');
    A.eq(host.handBack(r.id), null, 'settling twice is a no-op');
    A.eq(clk.pending(), 0, 'no timers leak after settling');
    const kinds = emitted.map(e => e[1].state);
    A.eq(kinds, ['waiting', 'taken', 'returned'], 'every transition was published in order');
    for (const e of emitted) A.ok(events.validate(e[0], e[1]).ok, 'every published state validates (' + e[1].state + ')');
  }

  // ---- expiry: 30 minutes unanswered ----
  {
    const clk = fakeClock(); const settled = [];
    const host = H.makeHandoffHost({ now: clk.now, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout, onSettled: v => settled.push(v.state) });
    const surf = fakeSurface();
    const r = host.request({ agentId: 'a', runId: 'r2', reason: 'captcha', surface: surf });
    clk.advance(H.WAIT_MS - 1);
    A.eq(host.get(r.id).state, 'waiting', 'still waiting a moment before 30 minutes');
    clk.advance(1);
    A.eq((await r.done).state, 'expired', 'nobody came: the wait EXPIRES at 30 minutes (never an auto-deny at 2)');
    A.eq(settled, ['expired'], 'onSettled observes the expiry');
  }

  // ---- expiry also applies after the wheel is taken (fresh 30 minutes) ----
  {
    const clk = fakeClock();
    const host = H.makeHandoffHost({ now: clk.now, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout });
    const r = host.request({ agentId: 'a', runId: 'r3', surface: fakeSurface() });
    clk.advance(29 * 60 * 1000);
    await host.take(r.id);
    clk.advance(29 * 60 * 1000);
    A.eq(host.get(r.id).state, 'taken', '58 minutes after the request but 29 after taking: still the Commander\'s');
    clk.advance(60 * 1000);
    A.eq((await r.done).state, 'expired', 'a held wheel expires 30 minutes after it was taken');
  }

  // ---- cancel ("can't do it") ----
  {
    const host = H.makeHandoffHost({});
    const r = host.request({ agentId: 'a', runId: 'r4', surface: fakeSurface() });
    host.cancel(r.id);
    A.eq((await r.done).state, 'cancelled', 'CANCEL tells the agent to take another route');
    A.eq(host._internals.live.size, 0, 'no live entry remains');
  }

  // ---- the run's own signal ends the handoff ----
  {
    const host = H.makeHandoffHost({});
    const ac = new AbortController();
    const surf = fakeSurface();
    const r = host.request({ agentId: 'a', runId: 'r5', surface: surf, signal: ac.signal });
    await host.take(r.id);
    ac.abort();
    A.eq((await r.done).state, 'aborted', 'a stopped run aborts its handoff');
    await flush();
    A.eq(surf.stopped, 1, 'an aborted handoff stops streaming');
    const ac2 = new AbortController(); ac2.abort();
    A.throws(() => host.request({ agentId: 'a', runId: 'r6', surface: fakeSurface(), signal: ac2.signal }), 'a run already stopped cannot open a handoff');
    const r7 = host.request({ agentId: 'a', runId: 'r7', surface: fakeSurface() });
    A.eq(host.abortRun('r7'), 1, 'abortRun ends the run\'s handoff');
    A.eq((await r7.done).state, 'aborted', 'abortRun resolves the wait as aborted');
  }

  // ---- surface contract + stream failure is honest ----
  {
    const host = H.makeHandoffHost({});
    A.throws(() => host.request({ agentId: 'a', runId: 'r8', surface: {} }), 'a handoff needs a real browser surface');
    A.throws(() => host.request({ runId: 'r8', surface: fakeSurface() }), 'a handoff needs an agent');
    const bad = fakeSurface(); bad.startStream = async () => { throw new Error('no page'); };
    const r = host.request({ agentId: 'a', runId: 'r9', surface: bad });
    const tk = await host.take(r.id);
    A.eq(tk.ok, false, 'a stream that cannot start is reported, not faked');
    A.ok(/could not stream/.test(tk.error), 'the error names the stream failure');
    host.cancel(r.id);
  }

  // ---- sanitizeInput / safeLocation units ----
  {
    const k = H.sanitizeInput({ type: 'key', action: 'down', key: 'Enter', code: 'Enter', keyCode: 13, text: '\r', modifiers: 99 });
    A.eq(k.modifiers, 15, 'modifiers are clamped to the 4 real bits');
    A.eq(k.text, '\r', 'Enter carries its text so a form submits');
    A.eq(H.sanitizeInput({ type: 'key', action: 'up', key: 'a', text: 'a' }).text, undefined, 'keyUp never inserts text');
    A.throws(() => H.sanitizeInput({ type: 'text', text: '' }), 'an empty paste is refused');
    A.throws(() => H.sanitizeInput({ type: 'text', text: 'x'.repeat(4001) }), 'an oversized paste is refused');
    A.eq(H.sanitizeInput({ type: 'wheel', dy: 99999 }).dy, 5000, 'wheel deltas are clamped');
    A.eq(H.safeLocation('javascript:alert(1)').host, '', 'a non-http location is never shown');
    A.eq(H.safeLocation('http://127.0.0.1:5173/login?x=1').where, '127.0.0.1:5173/login', 'a local test page shows host + path');
  }

  A.report('browser-handoff.test');
})().catch(e => { console.log('FAIL: browser-handoff.test threw -- ' + (e && e.stack || e)); process.exit(1); });
