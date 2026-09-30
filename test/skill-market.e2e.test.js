/* node test/skill-market.e2e.test.js — the Skill Market end to end on the real sidecar (2026-09-29).

   Boots the REAL sidecar with test/_skill_market_fixture.js preloaded, which answers the market's own catalog URLs
   on starnetos.com from this checkout's website/ folder (the exact bytes a deploy publishes). A mock OpenRouter
   captures what the model is told. Proves, at the live seams:
     1. the catalog lists our originals as BUILT IN (bundled text == published version) and a market-only
        original as available
     2. install lands the skill in the station SKILL LIBRARY, switched on
     3. the next run's system prompt indexes it (library:<slug>) — installed means the model is told
     4. it survives a sidecar restart
     5. a download whose bytes differ from the catalog is refused and nothing installs
     6. uninstall takes it out of the library
   Zero real network for the catalog and the model. */
'use strict';
const A = require('./_assert.js');
const http = require('http');
const path = require('path');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

const HOST = '127.0.0.1';
const PRELOAD = '--require ' + path.join(__dirname, '_skill_market_fixture.js').replace(/\\/g, '/');
const TARGET = 'line-design';      // a market-only StarNet Original (needs the orchestrator)
const TAMPERED = 'routine-craft';  // served with one extra line when STARNET_TEST_MARKET_TAMPER names it

function startMock() {
  const state = { requests: [] };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 64000, supported_parameters: ['tools'], pricing: { prompt: '0', completion: '0' } }] }));
        return;
      }
      if (req.url.indexOf('/chat/completions') < 0) { res.writeHead(404); res.end(); return; }
      let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
        let body = {}; try { body = JSON.parse(raw); } catch (_) {}
        const sys = String(((body.messages || [])[0] || {}).content || '');
        state.requests.push({ sys, isMain: sys.indexOf('[RUNTIME]') >= 0 });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n\n');
        res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 } }) + '\n\n');
        res.write('data: [DONE]\n\n'); res.end();
      });
    });
    server.listen(0, HOST, () => resolve({ server, state, base: 'http://' + HOST + ':' + server.address().port + '/api/v1' }));
  });
}

(async () => {
  const mock = await startMock();
  const fixture = SidecarFixture.create({
    prefix: 'sk-market-e2e-',
    env: { NODE_OPTIONS: PRELOAD, SKYNET_OPENROUTER_BASE: mock.base, SKYNET_SKILL_REVIEW: '0', SKYNET_SKILL_CURATOR: '0', SKYNET_QUEST_REFRESH: '0' },
    timeoutMs: 20000
  });
  await fixture.start();
  const PLACED = 'orchestrator,notebook,computer,cabinet,dish';
  const market = async () => (await fixture.json('GET', '/api/skill-market?placed=' + PLACED)).body;
  const library = async () => ((await fixture.json('GET', '/api/skills?placed=' + PLACED)).body.skills || []);
  try {
    // ---- 1. the catalog ----
    let m = await market();
    A.eq(m.ok, true, 'the market catalog loads through the real sidecar: ' + (m.error || ''));
    const by = Object.fromEntries((m.entries || []).map(e => [e.slug, e]));
    A.eq(by['feed-watch'] && by['feed-watch'].status, 'bundled', 'a bundled original reads BUILT IN (our text is exactly the published version)');
    A.eq(by[TARGET] && by[TARGET].status, 'available', 'a market-only original is available to install');
    A.eq(by[TARGET] && by[TARGET].shelf, 'originals', 'on the StarNet Originals shelf');
    A.ok(!(await library()).some(s => s.slug === TARGET), 'precondition: it is not in the library yet');

    // ---- 2. install ----
    const inst = await fixture.json('POST', '/api/skill-market/install', { slug: TARGET });
    A.eq([inst.status, inst.body.ok, inst.body.action, inst.body.enabled], [200, true, 'install', true], 'install succeeds and switches it on: ' + (inst.body.error || ''));
    let row = (await library()).find(s => s.slug === TARGET);
    A.ok(row && row.market && row.enabled && row.available, 'it is in the SKILL LIBRARY, from the market, enabled and available with the orchestrator placed');
    A.eq((await market()).entries.find(e => e.slug === TARGET).status, 'installed', 'the market card now reads installed');

    // ---- 3. the next run's prompt indexes it ----
    const start = mock.state.requests.length;
    const r = await fixture.request('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'sk-or-v1-market-fake', model: 'test/model', agentId: 'agent', isTask: true, placed: PLACED.split(','), messages: [{ role: 'user', content: 'plan a line for my weekly research brief' }] }) });
    A.eq(r.status, 200, 'a real run streams');
    const rd = r.body.getReader(); while (true) { const { done } = await rd.read(); if (done) break; }
    const main = mock.state.requests.slice(start).find(q => q.isMain);
    A.ok(main && main.sys.indexOf('library:' + TARGET) >= 0, 'the model is told the installed skill exists (library:' + TARGET + ' in the index)');

    // ---- 4. survives a restart ----
    await fixture.restart();
    row = (await library()).find(s => s.slug === TARGET);
    A.ok(row && row.market && row.enabled, 'after a restart it is still installed and switched on');

    // ---- 5. a download that differs from the catalog is refused ----
    await fixture.restart({ STARNET_TEST_MARKET_TAMPER: TAMPERED });
    const bad = await fixture.json('POST', '/api/skill-market/install', { slug: TAMPERED });
    A.eq(bad.body.ok, false, 'a changed file is refused');
    A.ok(/doesn't match the catalog/.test(bad.body.error || ''), 'and says why: ' + bad.body.error);
    A.ok(!(await library()).some(s => s.slug === TAMPERED), 'nothing from it reached the library');

    // ---- 6. uninstall ----
    const un = await fixture.json('POST', '/api/skill-market/uninstall', { slug: TARGET });
    A.eq(un.body.ok, true, 'uninstall succeeds');
    A.ok(!(await library()).some(s => s.slug === TARGET), 'and it is gone from the library');
  } finally {
    await fixture.dispose();
    try { mock.server.close(); } catch (_) {}
  }
  A.report('skill-market.e2e.test');
})().catch(e => { console.log('FAIL: skill-market.e2e.test threw - ' + (e && e.stack || e)); process.exit(1); });
