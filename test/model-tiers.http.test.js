'use strict';
/* GET /api/model-tiers through a real sidecar: proxies the configured cloud's /v1/tierlist, and answers an honest
   { ok:false, boards:[], reason } (200) when the cloud is unreachable — never an invented list. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

test('/api/model-tiers serves the cloud tier list, and says so when the cloud is down', { timeout: 120000 }, async () => {
  let up = true, hits = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/tierlist') {
      hits++;
      if (!up) { res.statusCode = 503; return res.end('{"error":"down"}'); }
      return res.end(JSON.stringify({ updated: '2026-09-29', boards: [{ key: 'agent', title: 'Agent', tiers: [{ tier: 'S', models: [{ id: 'test/model', note: 'fixture note' }] }] }] }));
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const cloud = 'http://127.0.0.1:' + server.address().port;
  const fixture = new SidecarFixture({ prefix: 'model-tiers-', timeoutMs: 20000, env: {
    STARNET_CREDITS_URL: '', SKYNET_CREDITS_URL: '', STARNET_CREDITS_TOKEN: '', SKYNET_CREDITS_TOKEN: '', STARNET_CLOUD_URL: cloud
  } });
  try {
    await fixture.start();
    const a = await (await fixture.request('/api/model-tiers')).json();
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.equal(a.boards[0].tiers[0].models[0].id, 'test/model');
    assert.equal(a.boards[0].tiers[0].models[0].note, 'fixture note');
    up = false;
    const b = await fixture.request('/api/model-tiers?force=1');
    assert.equal(b.status, 200);
    const bj = await b.json();
    assert.match(bj.reason || '', /http 503/, 'the refresh failure is named');
    assert.equal(hits, 2);
    // a fresh sidecar that never reached the cloud has NOTHING to show — and says why
    await fixture.restart({});
    const c = await (await fixture.request('/api/model-tiers')).json();
    assert.equal(c.ok, false);
    assert.deepEqual(c.boards, []);
    assert.match(c.reason, /tier list unavailable: .*503/);
  } finally { await fixture.dispose(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
