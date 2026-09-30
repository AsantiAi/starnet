/* node test/starnet-run-id-header.test.js — run attribution on managed (starnet) calls.
   The cloud proxy records a run id per debit from `x-starnet-run-id`. The starnet profile must send the calling
   run's id on every chat request; no third-party provider (openrouter BYOK, custom, openai) may ever see it. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectProvider } = require('../sidecar/providers/factory.js');
const registry = require('../sidecar/providers/registry.js');

const SSE = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) + '\n\ndata: [DONE]\n\n';

function recorder() {
  const calls = [];
  const fetch = async (url, init) => {
    const headers = {};
    const h = (init && init.headers) || {};
    for (const k of Object.keys(h)) headers[k.toLowerCase()] = h[k];
    calls.push({ url: String(url), headers, method: (init && init.method) || 'GET' });
    if (!init || init.method !== 'POST') return new Response(JSON.stringify({ data: [] }), { headers: { 'Content-Type': 'application/json' } });
    return new Response(SSE, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  return { calls, fetch, chat: () => calls.filter(c => c.method === 'POST') };
}
async function drain(provider, req) { for await (const _ of provider.stream(req)) { /* consume */ } }

test('only the starnet profile names a run-id header', () => {
  assert.equal(registry.getProviderProfile('starnet').runIdHeader, 'x-starnet-run-id');
  const others = registry.listProviderProfiles({ includeInactive: true, public: false });
assert.ok(others.length > 5);
  for (const p of others) if (p.id !== 'starnet') assert.equal(p.runIdHeader, undefined, p.id + ' must not send a run id');
});

test('starnet chat request carries x-starnet-run-id = the calling run id', async () => {
  const r = recorder();
  const p = selectProvider({ provider: 'starnet', key: 'fixture-device-token', baseUrl: 'https://cloud.example.test/v1', fetch: r.fetch });
  await drain(p, { model: 'anthropic/claude-sonnet-5.5', messages: [{ role: 'user', content: 'hi' }], runId: 'run-abc123' });
  assert.equal(r.chat().length, 1);
  assert.equal(r.chat()[0].headers['x-starnet-run-id'], 'run-abc123');
  assert.equal(r.chat()[0].headers.authorization, 'Bearer fixture-device-token');
});

test('starnet request without a run (health probe) sends no run-id header', async () => {
  const r = recorder();
  const p = selectProvider({ provider: 'starnet', key: 'k', baseUrl: 'https://cloud.example.test/v1', fetch: r.fetch });
  await drain(p, { model: 'm', messages: [{ role: 'user', content: 'Reply exactly OK.' }] });
  assert.equal(r.chat()[0].headers['x-starnet-run-id'], undefined);
});

test('a hostile run id cannot inject header bytes', async () => {
  const r = recorder();
  const p = selectProvider({ provider: 'starnet', key: 'k', baseUrl: 'https://cloud.example.test/v1', fetch: r.fetch });
  await drain(p, { model: 'm', messages: [{ role: 'user', content: 'x' }], runId: 'run-1\r\nX-Evil: 1' });
  assert.equal(r.chat()[0].headers['x-starnet-run-id'], 'run-1X-Evil:1');
});

test('openrouter BYOK request never carries the run id', async () => {
  const r = recorder();
  const p = selectProvider({ provider: 'openrouter', key: 'sk-or-fixture', fetch: r.fetch });
  await drain(p, { model: 'anthropic/claude-sonnet-5.5', messages: [{ role: 'user', content: 'hi' }], runId: 'run-abc123' });
  assert.ok(r.chat().length >= 1, 'openrouter made its chat call');
  for (const c of r.calls) assert.equal(c.headers['x-starnet-run-id'], undefined, 'leaked to ' + c.url);
});

test('custom and openai openai-compatible providers never carry the run id', async () => {
  for (const provider of ['custom', 'openai']) {
    const r = recorder();
    const p = selectProvider({ provider, key: 'fixture-key', baseUrl: 'https://third-party.example.test/v1', fetch: r.fetch });
    await drain(p, { model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }], runId: 'run-abc123' });
    assert.equal(r.chat().length, 1, provider);
    assert.equal(r.chat()[0].headers['x-starnet-run-id'], undefined, provider + ' leaked the run id');
  }
});
