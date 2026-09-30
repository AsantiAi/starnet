/* node test/tierlist.test.js — the cloud tier list fetcher behind GET /api/model-tiers (picker badges).
   Truthful-telemetry: a failed/junk fetch yields an EMPTY list + a reason, never an invented one. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeTierList, normalize } = require('../sidecar/tierlist.js');

const PAYLOAD = {
  updated: '2026-09-29',
  boards: [
    { key: 'agent', title: 'Agent work', tiers: [
      { tier: 'S', models: [{ id: 'anthropic/claude-sonnet-5.5', note: 'best all-rounder' }] },
      { tier: 'Z', models: [{ id: 'bogus/tier' }] },
      { tier: 'b', models: [{ id: 'openai/gpt-5.4', note: '' }, { id: 'has space' }, { id: '' }] }
    ] },
    { key: 'cheap', title: 'Cheap', tiers: [{ tier: 'A', models: [{ id: 'deepseek/deepseek-v4', note: 'x'.repeat(900) }] }] },
    { key: 'bad key!', title: 'nope', tiers: [{ tier: 'S', models: [{ id: 'a/b' }] }] },
    null
  ]
};

function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => { calls.push(url); return handler(url, init, calls.length); };
  f.calls = calls;
  return f;
}
const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('normalize keeps only valid boards/tiers/ids and bounds notes', () => {
  const n = normalize(PAYLOAD);
  assert.equal(n.updated, '2026-09-29');
  assert.deepEqual(n.boards.map(b => b.key), ['agent', 'cheap']);
  assert.deepEqual(n.boards[0].tiers.map(t => t.tier), ['S', 'B']);
  assert.deepEqual(n.boards[0].tiers[1].models.map(m => m.id), ['openai/gpt-5.4']);
  assert.equal(n.boards[1].tiers[0].models[0].note.length, 280);
  assert.equal(normalize({ nope: 1 }), null);
  assert.equal(normalize(null), null);
});

test('fetches {base}/v1/tierlist once and caches for the TTL', async () => {
  let t = 1000;
  const f = fakeFetch(() => ok(PAYLOAD));
  const tl = makeTierList({ fetch: f, baseUrl: () => 'https://cloud.example.test/', now: () => t, ttlMs: 600000 });
  const a = await tl.get();
  assert.equal(a.ok, true);
  assert.equal(a.stale, false);
  assert.equal(a.boards.length, 2);
  assert.equal(f.calls[0], 'https://cloud.example.test/v1/tierlist');
  t += 599000; await tl.get();
  assert.equal(f.calls.length, 1, 'served from cache inside the TTL');
  t += 2000; await tl.get();
  assert.equal(f.calls.length, 2, 'refetched after the TTL');
  await tl.get({ force: true });
  assert.equal(f.calls.length, 3, 'force bypasses the cache');
});

test('concurrent callers share one fetch', async () => {
  const f = fakeFetch(() => new Promise(r => setTimeout(() => r(ok(PAYLOAD)), 20)));
  const tl = makeTierList({ fetch: f, baseUrl: 'https://c.example.test', now: Date.now });
  const [a, b] = await Promise.all([tl.get(), tl.get()]);
  assert.equal(f.calls.length, 1);
  assert.equal(a.ok && b.ok, true);
});

test('a failed fetch returns an EMPTY list with a reason, never invented tiers', async () => {
  for (const handler of [
    () => new Response('nope', { status: 503 }),
    () => new Response('<html>', { status: 200 }),
    () => ok({ hello: 'world' }),
    () => { throw new Error('ECONNREFUSED'); }
  ]) {
    const tl = makeTierList({ fetch: fakeFetch(handler), baseUrl: 'https://c.example.test', now: Date.now });
    const r = await tl.get();
    assert.equal(r.ok, false);
    assert.deepEqual(r.boards, []);
    assert.match(r.reason, /^tier list unavailable: /);
  }
});

test('a slow cloud times out quickly', async () => {
  const f = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }));
  const tl = makeTierList({ fetch: f, baseUrl: 'https://c.example.test', now: Date.now, timeoutMs: 50 });
  const started = Date.now();
  const r = await tl.get();
  assert.ok(Date.now() - started < 2000);
  assert.equal(r.ok, false);
  assert.match(r.reason, /did not answer/);
});

test('failures are remembered briefly; a later refresh failure keeps the last good list marked stale', async () => {
  let t = 0, fail = false;
  const f = fakeFetch(() => fail ? new Response('down', { status: 502 }) : ok(PAYLOAD));
  const tl = makeTierList({ fetch: f, baseUrl: 'https://c.example.test', now: () => t, ttlMs: 1000, failTtlMs: 500 });
  assert.equal((await tl.get()).ok, true);
  fail = true; t = 1500;
  const r = await tl.get();
  assert.equal(r.ok, true, 'last good list is still real cloud data');
  assert.equal(r.stale, true);
  assert.match(r.reason, /http 502/);
  const n = f.calls.length;
  t = 1700; await tl.get();
  assert.equal(f.calls.length, n, 'failure cached — no re-dial inside failTtl');
});

test('no configured cloud → honest empty answer, no fetch', async () => {
  const f = fakeFetch(() => ok(PAYLOAD));
  const tl = makeTierList({ fetch: f, baseUrl: () => '', now: Date.now });
  const r = await tl.get();
  assert.equal(r.ok, false);
  assert.deepEqual(r.boards, []);
  assert.match(r.reason, /no StarNet cloud/);
  assert.equal(f.calls.length, 0);
});
