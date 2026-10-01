/* node test/verdictreview.test.js — the consistency loop's slice 1 (sidecar/verdictreview.js + skillreview.js).
   Ratchet: a Commander `ok`/`miss` verdict on a SMALL run MUST earn a skill review (the 08-17 law — a background
   pass owes a test that proves it FIRES); `great` never spends a packet; a packet is taken once; the packet store is
   bounded (cap + TTL); the review prompt carries the verdict and the Commander's own correction. */
'use strict';
const A = require('./_assert.js');
const { makeVerdictReview, VERDICTS_THAT_TEACH } = require('../sidecar/verdictreview.js');
const SR = require('../sidecar/skillreview.js');

/* ---------- the gate: verdict beats size ---------- */
const tiny = { reason: 'done', turns: 1, messages: [{ role: 'user', content: 'brief me' }, { role: 'assistant', content: 'ok' }] };
A.eq(SR.shouldReviewRun(tiny), false, 'a tiny run earns no size-review (unchanged)');
A.eq(SR.shouldReviewRun(tiny, { verdict: 'miss' }), true, 'RATCHET: a tiny run rated miss earns a review');
A.eq(SR.shouldReviewRun(tiny, { verdict: 'ok' }), true, 'a tiny run rated ok (close) earns a review');
A.eq(SR.shouldReviewRun(tiny, { verdict: 'great' }), false, 'praise is not a lesson: great never triggers by itself');
A.eq(SR.shouldReviewRun({ reason: 'error', turns: 1, messages: [] }, { verdict: 'miss' }), false, 'a failed run is the failure review\'s job, not this one');
A.eq(SR.shouldReviewRun(tiny, { verdict: 'miss', enabled: false }), false, 'the enabled=false kill switch still wins');

/* ---------- the prompt: verdict + correction ride in ---------- */
const p = SR.buildPrompt({ verdict: 'miss', correction: '  shorter,   bullets only  ', messages: tiny.messages });
A.ok(p.indexOf('COMMANDER VERDICT ON THIS RUN: MISSED the mark') !== -1, 'a miss is named as a miss');
A.ok(p.indexOf('in their words: "shorter, bullets only"') !== -1, 'the correction is quoted verbatim, whitespace collapsed');
A.ok(p.indexOf('NEXT run of this class of task does not repeat') !== -1, 'the reviewer is given the one job');
const pOk = SR.buildPrompt({ verdict: 'ok', messages: tiny.messages });
A.ok(pOk.indexOf('CLOSE, but short of the mark') !== -1 && pOk.indexOf('No written correction') !== -1, 'ok without a correction says so honestly');
A.eq(SR.buildPrompt({ verdict: 'great', messages: tiny.messages }).indexOf('COMMANDER VERDICT'), -1, 'a great verdict adds no block');
A.eq(SR.buildPrompt({ messages: tiny.messages }).indexOf('COMMANDER VERDICT'), -1, 'a size-triggered review is byte-identical in shape (no block)');
A.ok(SR.buildPrompt({ verdict: 'miss', correction: 'x'.repeat(2000), messages: [] }).indexOf('x'.repeat(601)) === -1, 'a correction is capped at 600 chars');

/* ---------- the packet store ---------- */
let t = 1000;
const vr = makeVerdictReview({ cap: 3, ttlMs: 500, now: () => t });
A.eq(vr.stash('', {}), false, 'no runId → no packet');
A.eq(vr.stash('r1', null), false, 'no packet → nothing stored');
A.eq(vr.stash('r1', { agentId: 'a' }), true, 'a packet parks');
A.eq(vr.shouldTrigger('r1', 'great'), false, 'great never triggers');
A.eq(vr.take('r1', 'great'), null, 'great never takes the packet');
A.eq(vr.has('r1'), true, '…and the packet is still there for a later honest verdict');
A.eq(vr.shouldTrigger('r1', 'miss'), true, 'miss triggers');
A.eq(vr.shouldTrigger('nope', 'miss'), false, 'an unknown run never triggers');
const got = vr.take('r1', 'miss');
A.eq(got && got.agentId, 'a', 'take returns the packet');
A.eq(vr.take('r1', 'miss'), null, 'taken ONCE — a second verdict on the same run reviews nothing');
// cap: oldest evicted
vr.stash('a', {}); vr.stash('b', {}); vr.stash('c', {}); vr.stash('d', {});
A.eq(vr.size(), 3, 'cap holds');
A.eq(vr.has('a'), false, 'the oldest packet is the one evicted');
A.eq(vr.has('d'), true, 'the newest survives');
// re-stash moves to newest
vr.stash('b', { v: 2 }); vr.stash('e', {});
A.eq(vr.has('c'), false, 're-stashing b made c the oldest → evicted');
A.eq(vr.take('b', 'ok').v, 2, 'a re-stash replaces the packet (latest state wins)');
// ttl
t += 501;
A.eq(vr.has('d'), false, 'a packet past its TTL is gone (a day-old verdict never reviews against a moved skillbase)');
A.eq(vr.size(), 0, 'sweep drains everything stale');
A.ok(VERDICTS_THAT_TEACH.has('ok') && VERDICTS_THAT_TEACH.has('miss') && !VERDICTS_THAT_TEACH.has('great'), 'the teaching set is exactly ok+miss');

/* ---------- slice 2: correction grace (fake timers, injected) ---------- */
{
  const timers = []; let tick = 0;
  const fakeSet = (fn, ms) => { const h = { fn, ms, id: ++tick, live: true }; timers.push(h); return h; };
  const fakeClear = (h) => { if (h) h.live = false; };
  const runTimers = () => { for (const h of timers.splice(0)) if (h.live) h.fn(); };
  const fired = [];
  const g = makeVerdictReview({ now: () => 1, graceMs: 5000, setTimeout: fakeSet, clearTimeout: fakeClear });
  g.stash('r1', { agentId: 'a' }); g.stash('r2', { agentId: 'a' }); g.stash('r3', { agentId: 'a' });
  A.eq(g.arm('r1', 'great', j => fired.push(j)), false, 'great never arms');
  A.eq(g.arm('r1', 'miss', null), false, 'no fire fn → no arm');
  A.eq(g.arm('r1', 'miss', j => fired.push(j)), true, 'a miss arms a held review');
  A.eq(fired.length, 0, 'RATCHET: the review does NOT fire on the verdict alone — it waits for the correction');
  A.eq(g.holding('r1'), true, 'held');
  A.eq(g.arm('r1', 'miss', j => fired.push(j)), false, 'a duplicate verdict never double-arms');
  A.eq(g.correct('r1', 'too long — tighter', false, 'chip').fired, false, 'a chip attaches but keeps waiting');
  A.eq(g.correct('r1', '  shorter, bullets   only ', true, 'message').fired, true, 'the typed message fires NOW');
  A.eq(fired.length, 1, 'exactly one review fired');
  A.eq(fired[0].runId, 'r1', 'with the run id');
  A.eq(fired[0].verdict, 'miss', 'with the verdict');
  A.eq(fired[0].correction, 'shorter, bullets only', 'the typed message REPLACES the chip (their words win), whitespace collapsed');
  A.eq(fired[0].correctionSource, 'message', 'source names the message');
  A.eq(fired[0].firedBy, 'correction', 'fired by the correction');
  A.eq(fired[0].agentId, 'a', 'the packet rides through');
  A.eq(g.holding('r1'), false, 'no longer held');
  A.eq(g.correct('r1', 'again', true).ok, false, 'a correction after firing changes nothing (single-shot)');
  runTimers();
  A.eq(fired.length, 1, 'the cancelled timer never fires a second review');
  // grace expiry with only a chip
  g.arm('r2', 'ok', j => fired.push(j));
  g.correct('r2', 'wrong audience / tone', false, 'chip');
  runTimers();
  A.eq(fired.length, 2, 'the grace timer fires the review');
  A.eq(fired[1].correction, 'wrong audience / tone', 'with the chip as the correction');
  A.eq(fired[1].firedBy, 'grace', 'fired by grace');
  // initial correction from the ratings body, then nothing
  g.arm('r3', 'miss', j => fired.push(j), 'from body');
  runTimers();
  A.eq(fired[2].correction, 'from body', 'a correction carried on the rating body survives to the grace fire');
  A.eq(fired[2].correctionSource, 'verdict', 'source = verdict');
  // graceMs 0 = immediate (the old behaviour, opt-in)
  const g0 = makeVerdictReview({ now: () => 1, graceMs: 0, setTimeout: fakeSet, clearTimeout: fakeClear });
  g0.stash('x', {}); const f0 = []; g0.arm('x', 'miss', j => f0.push(j));
  A.eq(f0.length === 1 && f0[0].firedBy, 'immediate', 'graceMs 0 fires immediately');
  A.eq(makeVerdictReview({ now: () => 1 }).graceMs, 90000, 'default grace is 90s');
}

// ---- DURABILITY: packets survive a restart (compacted, provider-free) ----
{
  const { compactPacket } = require('../sidecar/verdictreview.js');
  const big = [{ role: 'system', content: 'SYSTEM PROMPT' }, { role: 'user', content: 'write the weekly report' }];
  for (let i = 0; i < 30; i++) big.push({ role: 'assistant', content: 'x'.repeat(5000), tool_calls: [{ id: 'c' + i, function: { name: 'fs.write', arguments: '{"secret":"sk-live"}' } }] });
  const provider = { stream() {}, key: 'sk-or-v1-SECRET' };
  const c = compactPacket({ agentId: 'nova', messages: big, provider, cost: {}, model: 'm/x', loadedSkills: [{ id: 's1', name: 'Brief', body: 'long body' }], unmetered: true, failed: true });
  A.ok(!('provider' in c) && !('cost' in c), 'no live provider/cost handle is persisted');
  A.ok(JSON.stringify(c).indexOf('SECRET') < 0 && JSON.stringify(c).indexOf('sk-live') < 0, 'no credential or tool-call arguments reach disk');
  A.ok(JSON.stringify(c.messages).length < 25000, 'transcript is compacted (' + JSON.stringify(c.messages).length + ' chars)');
  A.ok(c.messages.every(m => m.role !== 'system'), 'the system prompt is not persisted');
  A.eq(c.messages[0].role, 'user', 'the directive is kept even when the tail cut it off');
  A.eq(c.messages[0].content, 'write the weekly report', 'directive text intact');
  A.eq(c.loadedSkills[0].body, undefined, 'skill refs only, never bodies');
  A.eq(c.agentId + '/' + c.model + '/' + c.unmetered + '/' + c.failed, 'nova/m/x/true/true', 'review inputs kept');

  // review fixes: the final answer is kept whole (goldens measure it) · a redact fn scrubs every persisted turn
  const longFinal = 'word '.repeat(3000).trim();   // ~15k chars, well past the 4k per-message cap
  const withFinal = compactPacket({ messages: [{ role: 'user', content: 'write it' }, { role: 'tool', content: 'KEY=sk-or-v1-abcdef0123456789' }, { role: 'assistant', content: longFinal }] }, t => String(t).replace(/sk-or-v1-[a-z0-9]+/g, '[REDACTED]'));
  A.eq(withFinal.messages[withFinal.messages.length - 1].content.length, longFinal.length, 'the final answer survives whole');
  A.ok(JSON.stringify(withFinal).indexOf('sk-or-v1-abcdef') < 0 && JSON.stringify(withFinal).indexOf('[REDACTED]') >= 0, 'a credential a tool read is redacted before disk');
  const vrR = makeVerdictReview({ now: () => 1, redact: t => String(t).replace(/SECRET\w*/g, '[R]') });
  let snap = null; const vrS = makeVerdictReview({ now: () => 1, redact: t => String(t).replace(/SECRET\w*/g, '[R]'), onChange: rows => { snap = rows; } });
  vrS.stash('rr', { agentId: 'a', messages: [{ role: 'user', content: 'go' }, { role: 'assistant', content: 'token SECRET123 used' }] });
  A.ok(snap && JSON.stringify(snap).indexOf('SECRET123') < 0, 'makeVerdictReview passes its redact to every persisted snapshot');
  A.ok(vrR && vrS.peek('rr').messages[1].content.indexOf('SECRET123') >= 0, 'the in-RAM packet (for a live review) is untouched');

  let disk = null, t = 1000;
  const a = makeVerdictReview({ now: () => t, onChange: rows => { disk = JSON.parse(JSON.stringify(rows)); } });
  a.stash('run-1', { agentId: 'nova', messages: big.slice(0, 3), provider, model: 'm/x' });
  A.ok(Array.isArray(disk) && disk.length === 1 && disk[0].runId === 'run-1', 'a stash persists');
  A.ok(!('provider' in disk[0].packet), 'persisted packet is provider-free');
  // "restart": a fresh instance restores from disk; the verdict still finds its packet
  t = 5000;
  const b = makeVerdictReview({ now: () => t, onChange: rows => { disk = JSON.parse(JSON.stringify(rows)); } });
  A.eq(b.restore(disk), 1, 'restored one packet');
  A.ok(b.shouldTrigger('run-1', 'miss'), 'a verdict after the restart still triggers the review');
  const p = b.take('run-1', 'miss');
  A.ok(p && p.restored === true && !p.provider && p.agentId === 'nova', 'restored packet is marked, with no provider (the host rebuilds one)');
  A.eq(disk.length, 0, 'taking it persists the removal');
  // expired rows are not resurrected
  const c2 = makeVerdictReview({ now: () => 10 * 60 * 60 * 1000, ttlMs: 1000 });
  A.eq(c2.restore([{ runId: 'old', at: 1, packet: { agentId: 'a', messages: [] } }]), 1, 'restore reads the row…');
  A.eq(c2.has('old'), false, '…but an expired one is swept, never reviewed');
  A.eq(c2.restore(null) + c2.restore([{ runId: '', at: 1, packet: {} }, { runId: 'x', packet: {} }]), 0, 'malformed rows are skipped');
}

A.report('verdictreview');
