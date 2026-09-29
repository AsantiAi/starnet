'use strict';
/* USER-STUDY LOOP — a real sidecar settles a plan step with no webview involved: every quest planned for the
   current step is settled (one completed, one dismissed) → the journey records the step with harness-contract
   authority → the goal mirror names the next step. A stale push can never walk the plan back, and it all
   survives a restart. */
const assert = require('node:assert/strict');
const { SidecarFixture } = require('./helpers/sidecar-fixture');

const plan = status => ({
  id: 'g_news', text: 'Launch the newsletter', done: 0, total: 3, pct: 0, next: 'Pick a niche', milestoneId: 'g_news:m1',
  milestones: [
    { id: 'g_news:m1', text: 'Pick a niche', status: status || 'open' },
    { id: 'g_news:m2', text: 'Write issue one', status: 'open' },
    { id: 'g_news:m3', text: 'Get ten subscribers', status: 'open' }
  ]
});

(async () => {
  const host = SidecarFixture.create({ env: { SKYNET_DEV: '1', SKYNET_CRON_ENABLED: '0', SKYNET_QUEST_REFRESH: '0' } });
  const active = async () => (await host.json('GET', '/api/journey')).body.journey.activeGoal;
  const mint = async (title, milestoneId) => {
    const r = await host.json('POST', '/api/quests/mint', { title, desc: 'a step', contract: { type: 'attest' }, kind: 'generated',
      createdBy: 'system:quest-refresh', goalId: 'g_news', milestoneId });
    assert.equal(r.body.ok, true, 'mint ' + title + ': ' + JSON.stringify(r.body));
    return r.body.id;
  };
  try {
    await host.start();
    const pushed = await host.json('POST', '/api/goals', { goal: plan() });
    assert.equal(pushed.body.goal.milestones.length, 3, 'the sidecar keeps the whole ordered plan');

    const a = await mint('Shortlist three niches', 'g_news:m1');
    const b = await mint('Ask five readers which niche', 'g_news:m1');
    await mint('Outline issue one', 'g_news:m2');

    const rep = await host.json('POST', '/api/quests/report', { id: a, evidence: 'shortlisted AI tools, indie games, and local food' });
    assert.equal(rep.body.ok, true);
    assert.equal((await active()).next, 'Pick a niche', 'one open quest in the slate keeps the step open');

    const dis = await host.json('POST', '/api/quests/dismiss', { id: b });
    assert.equal(dis.body.ok, true);
    const journey = (await host.json('GET', '/api/journey')).body.journey;
    const settled = journey.milestones.find(m => m.milestoneId === 'g_news:m1');
    assert.ok(settled, 'the settled step is recorded in the journey');
    assert.equal(settled.verifiedBy, 'harness-contract', 'with harness authority');
    assert.match(settled.evidence, /Shortlist three niches/, 'citing the quest completed by its contract');
    assert.doesNotMatch(settled.evidence, /Ask five readers/, 'never citing the dismissed quest');
    assert.equal(journey.activeGoal.next, 'Write issue one', 'the mirror moved to the next step');
    assert.equal(journey.activeGoal.done, 1);

    const refresh = (await host.json('GET', '/api/quests/refresh')).body;
    const ledger = (refresh.state && refresh.state.ledger) || refresh.ledger || [];
    assert.ok(ledger.some(e => e.outcome === 'advanced' && e.title === 'Pick a niche'), 'the refresh ledger says the step finished: ' + JSON.stringify(refresh).slice(0, 400));

    const stale = await host.json('POST', '/api/goals', { goal: plan('open') });
    assert.equal(stale.body.goal.milestoneId, 'g_news:m2', 'a stale webview push can never walk the plan backwards');

    await host.restart();
    const after = await active();
    assert.equal(after.next, 'Write issue one', 'the advanced plan survives a restart');
    assert.equal(after.done, 1);
    console.log('goal-advance.http: PASS (slate settles step, harness authority, stale push held, restart)');
  } finally { await host.dispose(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
