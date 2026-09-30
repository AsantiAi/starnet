'use strict';
/* End-to-end run attribution: a REAL sidecar /api/run on the starnet provider must send the harness run id (the
   one agent.run.start announces) as `x-starnet-run-id` to the linked cloud; a custom (third-party) endpoint run
   must not see it. Seam: index.js /api/run -> loop.js req.runId -> factory -> openai-compatible header. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

test('starnet runs carry x-starnet-run-id = the run id; custom endpoint runs do not', { timeout: 120000 }, async () => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('/balance')) return res.end(JSON.stringify({ balanceUsd: 100 }));
    if (req.url.includes('/history')) return res.end(JSON.stringify({ entries: [] }));
    if (/\/(debit|credit)$/.test(req.url)) return res.end(JSON.stringify({ ok: true, balanceUsd: 100 }));
    if (req.url.includes('/models')) return res.end(JSON.stringify({ data: [{ id: 'test/model', supported_parameters: ['tools'], pricing: { prompt: '0', completion: '0' } }] }));
    calls.push({ url: req.url, runId: req.headers['x-starnet-run-id'] });
    res.setHeader('Content-Type', 'text/event-stream');
    res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Attributed.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, cost: 0 } }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const cloud = 'http://127.0.0.1:' + server.address().port;
  const fixture = new SidecarFixture({ prefix: 'starnet-run-id-', timeoutMs: 20000, env: {
    STARNET_CREDITS_URL: '', SKYNET_CREDITS_URL: '', STARNET_CREDITS_TOKEN: '', SKYNET_CREDITS_TOKEN: '',
    SKYNET_DEFAULT_MODEL: 'test/model', STARNET_CLOUD_URL: cloud, STARNET_OPENROUTER_KEY: '', SKYNET_OPENROUTER_KEY: '',
    OPENROUTER_API_KEY: '', OPENROUTER_KEY: '', SKYNET_AUX_BUDGET: '0', SKYNET_FULL_ACCESS: '1'
  } });
  const savedPath = path.join(fixture.workspace, '.secrets/credits.json');
  fs.mkdirSync(path.dirname(savedPath), { recursive: true });
  fs.writeFileSync(savedPath, JSON.stringify({ url: cloud, deviceToken: 'fixture-linked-token', accountId: 'fixture-account', linkedAt: Date.now() }));
  async function run(provider, overrides = {}) {
    const response = await fixture.request('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model: 'test/model', agentId: 'attribution-proof', messages: [{ role: 'user', content: 'Say hello' }], ...overrides }) });
    assert.equal(response.status, 200);
    const events = (await response.text()).split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(events.filter(e => e.name === 'agent.run.end').at(-1)?.payload.reason, 'done', JSON.stringify(events.filter(e => /error/.test(e.name))));
    const start = events.find(e => e.name === 'agent.run.start');
    assert.ok(start && start.payload.runId, 'run announced its id');
    return start.payload.runId;
  }
  try {
    await fixture.start();
    const before = calls.length;
    const runId = await run('starnet');
    const managed = calls.slice(before).filter(c => c.url === '/v1/chat/completions');
    assert.ok(managed.length >= 1, 'the starnet run reached the linked cloud');
    for (const c of managed) assert.equal(c.runId, runId, 'every managed chat call carries the run id');
    console.log('starnet run ' + runId + ' -> x-starnet-run-id on ' + managed.length + ' managed call(s)');

    const mark = calls.length;
    await run('custom', { baseUrl: cloud + '/custom/v1', key: 'fixture-custom-key' });
    const third = calls.slice(mark).filter(c => c.url === '/custom/v1/chat/completions');
    assert.ok(third.length >= 1, 'the custom run reached its endpoint');
    for (const c of third) assert.equal(c.runId, undefined, 'a third-party endpoint never sees the run id');
  } finally { await fixture.dispose(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
