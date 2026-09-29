/* node test/goal-advance.test.js — USER-STUDY LOOP: the sidecar settles a plan step once every quest planned
   for it is settled, and the goal mirror advances from the durable journey (never backwards from a stale push). */
'use strict';
const A = require('./_assert.js');
const path = require('path');
const GA = require('../sidecar/goal-advance.js');
const { makeJourneyStore } = require('../sidecar/journey-store.js');

function memFs() {
  const files = new Map();
  return {
    readFileSync(f) { if (!files.has(String(f))) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files.get(String(f)); },
    writeFileSync(f, data) { files.set(String(f), String(data)); },
    renameSync(a, b) { files.set(String(b), files.get(String(a))); files.delete(String(a)); },
    existsSync(f) { return files.has(String(f)); }, mkdirSync() {}, unlinkSync(f) { files.delete(String(f)); },
    openSync() { return 1; }, fsyncSync() {}, closeSync() {}
  };
}
const writeDurable = ({ fs }, file, data) => fs.writeFileSync(file, data);

const goal = () => ({ id: 'g_1', text: 'Launch the newsletter', done: 0, total: 3, pct: 0, next: 'Pick a niche', milestoneId: 'g_1:m1',
  milestones: [{ id: 'g_1:m1', text: 'Pick a niche', status: 'open' }, { id: 'g_1:m2', text: 'Write issue one', status: 'open' }, { id: 'g_1:m3', text: 'Get ten subscribers', status: 'open' }] });
const q = (id, status, milestoneId) => ({ id, title: 'quest ' + id, status, goalId: 'g_1', milestoneId: milestoneId || 'g_1:m1' });

(async () => {
  // ---- slateFinished: the step settles only when its whole slate is settled with at least one real completion
  A.eq(GA.slateFinished(goal(), []), null, 'a step with no planned quests is not finished');
  A.eq(GA.slateFinished(goal(), [q('a', 'done'), q('b', 'open')]), null, 'an open quest keeps the step open');
  A.eq(GA.slateFinished(goal(), [q('a', 'dismissed'), q('b', 'dismissed')]), null, 'an all-dismissed slate is a rejected plan, never a finished step');
  const fin = GA.slateFinished(goal(), [q('a', 'done'), q('b', 'dismissed'), q('c', 'done', 'g_1:m2')]);
  A.ok(fin && fin.milestoneId === 'g_1:m1', 'a settled slate with a completion finishes the CURRENT step');
  A.eq(fin && fin.questIds, ['a'], 'only the current step\'s completed quests are its evidence');
  A.ok(fin && /quest a/.test(fin.evidence) && !/quest c/.test(fin.evidence), 'the evidence names the completed quests of this step only');
  A.eq(GA.slateFinished(Object.assign(goal(), { milestones: null }), [q('a', 'done')]), null, 'a summary-only mirror (older webview) never advances blind');
  const attest = (id, st) => Object.assign(q(id, st), { contract: { type: 'attest' } }), artifact = (id, st) => Object.assign(q(id, st), { contract: { type: 'artifact', key: 'x.md' } });
  A.eq(GA.slateFinished(goal(), [attest('a', 'done'), attest('b', 'dismissed')]).authority, 'commander-confirmed', 'a step settled only by the Commander own reports is THEIR word ("You confirmed"), never a harness proof');
  A.eq(GA.slateFinished(goal(), [artifact('a', 'done'), attest('b', 'done')]).authority, 'harness-contract', 'a step with mechanically-proven work is a harness record ("StarNet recorded")');
  A.eq(GA.slateFinished(Object.assign(goal(), { id: 'other' }), [q('a', 'done')]), null, 'quests bound to another goal never settle this one');

  // ---- overlay: journey completions fold on, next step recomputes, the Commander's chosen step is honored
  const o = GA.overlay(goal(), new Set(['g_1:g_1:m1']));
  A.eq([o.done, o.total, o.pct, o.milestoneId, o.next], [1, 3, 33, 'g_1:m2', 'Write issue one'], 'a recorded completion advances the mirror to the next open step');
  const chosen = GA.overlay(Object.assign(goal(), { milestoneId: 'g_1:m3', next: 'Get ten subscribers' }), new Set(['g_1:g_1:m1']));
  A.eq(chosen.milestoneId, 'g_1:m3', 'a still-open step the Commander chose stays the next step');
  const stale = GA.overlay(Object.assign(goal(), { milestones: goal().milestones }), new Set(['g_1:g_1:m1', 'g_1:g_1:m2']));
  A.eq(stale.milestoneId, 'g_1:m3', 'a stale push naming a finished step can never walk the plan backwards');
  const all = GA.overlay(goal(), new Set(['g_1:g_1:m1', 'g_1:g_1:m2', 'g_1:g_1:m3']));
  A.eq([all.done, all.milestoneId, all.next], [3, null, null], 'a fully finished plan names no next step (the goal itself still awaits confirmation)');
  A.eq(GA.overlay({ id: 'g', text: 't', milestoneId: 'x' }, new Set(['g:x'])).milestoneId, 'x', 'a summary-only goal is returned unchanged');
  A.eq(GA.normMilestones([{ id: '', text: 'x' }, null, { id: 'm', text: 'y', status: 'weird' }]), [{ id: 'm', text: 'y', status: 'open' }], 'junk milestones are dropped, unknown status reads open');

  // ---- journey: the harness authority is sidecar-only, and the done-key set is lifetime
  const s = makeJourneyStore({ fs: memFs(), path, workspaces: '/ws', writeDurable });
  await s.registerGoal({ id: 'g_1', text: 'Launch the newsletter', successCondition: 'Ten real subscribers' }, 1);
  const h = await s.recordMilestone({ goalId: 'g_1', milestoneId: 'g_1:m1', milestoneText: 'Pick a niche', evidence: fin.evidence }, 10, { authority: 'harness-contract' });
  A.ok(h.ok && h.outcome.verifiedBy === 'harness-contract', 'a sidecar-settled step carries harness-contract authority');
  const c = await s.recordMilestone({ goalId: 'g_1', milestoneId: 'g_1:m2', milestoneText: 'Write issue one', evidence: 'wrote it', source: 'harness-contract' }, 11);
  A.ok(c.ok && c.outcome.verifiedBy === 'commander-client', 'a client-supplied source can never claim harness authority (the route passes no opts)');
  const bogus = await s.recordMilestone({ goalId: 'g_1', milestoneId: 'g_1:m9', evidence: 'nine things' }, 13, { authority: 'root' });
  A.eq(bogus.outcome.verifiedBy, 'commander-client', 'an unknown internal authority falls back, never passes through');
  A.ok(s.milestoneDoneKeys().has(GA.milestoneKey('g_1', 'g_1:m1')), 'the done-key set uses the same key the overlay reads');
  const dup = await s.recordMilestone({ goalId: 'g_1', milestoneId: 'g_1:m1', evidence: fin.evidence }, 12, { authority: 'harness-contract' });
  A.ok(dup.ok && dup.duplicate, 'settling the same step twice is idempotent');
  const snap = s.snapshot(null);
  A.eq(snap.milestones.map(m => [m.milestoneId, m.verifiedBy]), [['g_1:m1', 'harness-contract'], ['g_1:m2', 'commander-client'], ['g_1:m9', 'commander-client']], 'the snapshot carries every recorded step completion for the webview fold');
  A.eq(GA.overlay(goal(), s.milestoneDoneKeys()).milestoneId, 'g_1:m3', 'the mirror folds the journey truth end to end');

  A.report('goal-advance.test');
})().catch(e => { console.error(e); process.exitCode = 1; });
