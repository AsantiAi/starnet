'use strict';
/* A routine assigned to a "Follow station default" (unpinned) agent runs on the STATION DEFAULT — the Overseer's
   model, provider and credential — exactly as a channel hop does (channelRunConfigFor). v0.12.5 refused it on both
   paths: the scheduled fire recorded blocked_config "no model is configured" and Run Now answered "choose a model
   for this routine agent first". Precedence stays: explicit routine model > the agent's own pin > station default.
   The durable run record must name the model/provider the run actually used (truthful telemetry). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('routines on an unpinned agent run on the station default (Run Now + scheduled fire)', async () => {
  const calls = [];
  const server = http.createServer((req, res) => {
    if (req.url.includes('/chat/completions')) {
      let raw = ''; req.on('data', d => { raw += d; });
      req.on('end', () => {
        const body = JSON.parse(raw);
        calls.push({ model: body.model, auth: req.headers.authorization });
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Routine complete.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) + '\n\ndata: [DONE]\n\n');
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url.includes('/models') ? { data: [
      { id: 'hero-model', context_length: 8000 }, { id: 'pin-model', context_length: 8000 }, { id: 'job-model', context_length: 8000 }
    ] } : { ok: true, balanceUsd: 100 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const fixture = SidecarFixture.create({ prefix: 'cron-station-default-', timeoutMs: 20000, env: {
    STARNET_DEFAULT_MODEL: '', SKYNET_DEFAULT_MODEL: '',
    STARNET_OPENROUTER_KEY: '', SKYNET_OPENROUTER_KEY: '',
    STARNET_CRON_TICK_MS: '400', SKYNET_CRON_TICK_MS: '400',
    CUSTOM_OPENAI_KEY: 'direct-fixture', CUSTOM_OPENAI_BASE_URL: base + '/v1'
  } });
  // arm the scheduler before boot so the scheduled leg really ticks
  fs.writeFileSync(path.join(fixture.workspace, 'cron.armed.json'), JSON.stringify({ version: 1, armed: true }), 'utf8');
  try {
    await fixture.start();
    const agents = [
      { agentId: 'agent', name: 'Overseer', system: 'You are the overseer.', provider: 'custom', model: 'hero-model' },
      // unpinned specialist whose row still carries a stale provider: it must follow the Overseer, not the row
      { agentId: 'scout', name: 'Scout', system: 'You are the scout.', provider: 'starnet', model: '' },
      { agentId: 'pinned', name: 'Pinned', system: 'You are pinned.', provider: 'custom', model: 'pin-model' }
    ];
    assert.equal((await fixture.json('POST', '/api/roster', { agents, updatedAt: Date.now() })).status, 200);

    const make = async (spec) => {
      const r = await fixture.json('POST', '/api/cron', Object.assign({ prompt: 'write the morning report', schedule: 'every 30m' }, spec));
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return (r.body.job || r.body).id;
    };
    const runNow = async (id) => {
      const res = await fixture.request('/api/cron/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const text = await res.text();
      return { status: res.status, text };
    };

    // 1) RUN NOW on the unpinned agent: runs on the Overseer's model + credential
    const scoutJob = await make({ name: 'Scout report', agentId: 'scout' });
    calls.length = 0;
    const r1 = await runNow(scoutJob);
    assert.equal(r1.status, 200, 'Run Now on an unpinned agent is not refused: ' + r1.text.slice(0, 300));
    assert.ok(calls.length > 0 && calls.every(c => c.model === 'hero-model' && c.auth === 'Bearer direct-fixture'),
      'Run Now used the station default model + credential: ' + JSON.stringify(calls));
    const runs1 = (await fixture.json('GET', '/api/runs?agent=scout&limit=10')).body.runs || [];
    assert.ok(runs1.length >= 1, 'the Run Now run was recorded');
    assert.equal(runs1[0].model, 'hero-model', 'the run record names the model it actually used');
    assert.equal(runs1[0].provider, 'custom', 'the run record names the provider it actually used');

    // 2) precedence: the agent's own pin and an explicit routine model stay authoritative
    const pinnedJob = await make({ name: 'Pinned report', agentId: 'pinned' });
    calls.length = 0;
    assert.equal((await runNow(pinnedJob)).status, 200);
    assert.ok(calls.length > 0 && calls.every(c => c.model === 'pin-model'), 'a pinned agent keeps its pin: ' + JSON.stringify(calls));
    const explicitJob = await make({ name: 'Explicit report', agentId: 'scout', model: 'job-model', provider: 'custom' });
    calls.length = 0;
    assert.equal((await runNow(explicitJob)).status, 200);
    assert.ok(calls.length > 0 && calls.every(c => c.model === 'job-model'), 'an explicit routine model wins: ' + JSON.stringify(calls));

    // 3) SCHEDULED fire on the unpinned agent: not blocked_config, runs on the station default
    calls.length = 0;
    const schedJob = await make({ name: 'Scheduled scout', agentId: 'scout', schedule: 'in 1s' });
    let job = null;
    for (let i = 0; i < 160; i++) {   // up to ~40s: gates run many sidecars in parallel
      await sleep(250);
      const list = (await fixture.json('GET', '/api/cron')).body.jobs || [];
      job = list.find(j => j.id === schedJob) || null;
      if (job && job.lastStatus) break;
      if (!job) break;   // a once job may be removed after a successful fire
    }
    assert.ok(!job || job.lastReason !== 'blocked_config', 'the scheduled fire was not blocked: ' + JSON.stringify(job && { lastError: job.lastError, lastReason: job.lastReason }));
    assert.ok(!job || job.lastStatus === 'ok', 'the scheduled fire completed: ' + JSON.stringify(job && { lastStatus: job.lastStatus, lastError: job.lastError }));
    assert.ok(calls.length > 0 && calls.every(c => c.model === 'hero-model' && c.auth === 'Bearer direct-fixture'),
      'the scheduled fire used the station default model + credential: ' + JSON.stringify(calls));
    const runs2 = (await fixture.json('GET', '/api/runs?agent=scout&limit=10')).body.runs || [];
    const sched = runs2.find(r => r.model === 'hero-model' && r.runId !== runs1[0].runId);
    assert.ok(sched && sched.provider === 'custom', 'the scheduled run record names hero-model on custom: ' + JSON.stringify(runs2.map(r => ({ model: r.model, provider: r.provider }))));

    // 4) no station default at all: still refused honestly (never a silent guess)
    agents[0].model = '';
    assert.equal((await fixture.json('POST', '/api/roster', { agents, updatedAt: Date.now() })).status, 200);
    calls.length = 0;
    const r4 = await runNow(scoutJob);
    assert.equal(r4.status, 400, 'with no station default the routine is refused: ' + r4.text.slice(0, 300));
    assert.equal(calls.length, 0, 'nothing was spent');
  } finally {
    await fixture.dispose();
    await new Promise(resolve => server.close(resolve));
  }
});
