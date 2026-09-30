/* node test/model-tier-badges.test.js — the model dock's tier-badge index. Badges come ONLY from the cloud's
   list, only on OpenRouter-id rows (starnet managed + openrouter), and a failed list badges nothing. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

global.U = global.U || { esc: s => String(s) };
const ModelDock = require('../frontend/app/modeldock.js');
const { tierIndexFrom, tiersFor } = ModelDock._internals;

const LIST = { ok: true, updated: '2026-09-29', boards: [
  { key: 'agent', title: 'Agent', tiers: [
    { tier: 'S', models: [{ id: 'anthropic/claude-sonnet-5.5', note: 'the all-rounder' }] },
    { tier: 'X', models: [{ id: 'bogus/x' }] }
  ] },
  { key: 'cheap', title: 'Cheap', tiers: [{ tier: 'A', models: [{ id: 'Anthropic/Claude-Sonnet-5.5', note: '' }, { id: 'deepseek/deepseek-v4' }] }] }
] };

test('index keeps every board a model sits on, drops unknown tiers', () => {
  const idx = tierIndexFrom(LIST);
  assert.deepEqual(idx.get('anthropic/claude-sonnet-5.5'), [
    { board: 'agent', tier: 'S', note: 'the all-rounder' },
    { board: 'cheap', tier: 'A', note: '' }
  ]);
  assert.equal(idx.has('bogus/x'), false);
});

test('only starnet/openrouter rows match (OpenRouter id space); vendor-direct ids never get guessed badges', () => {
  const idx = tierIndexFrom(LIST);
  assert.equal(tiersFor({ id: 'anthropic/claude-sonnet-5.5', provider: 'starnet' }, idx).length, 2);
  assert.equal(tiersFor({ id: 'deepseek/deepseek-v4', provider: 'openrouter' }, idx)[0].tier, 'A');
  assert.deepEqual(tiersFor({ id: 'anthropic/claude-sonnet-5.5', provider: 'anthropic' }, idx), []);
  assert.deepEqual(tiersFor({ id: 'openai/unlisted', provider: 'starnet' }, idx), []);
});

test('a failed or empty tier list badges nothing', () => {
  for (const payload of [null, { ok: false, boards: [], reason: 'tier list unavailable: http 503' }, { boards: 'nope' }]) {
    assert.equal(tierIndexFrom(payload).size, 0);
  }
});
