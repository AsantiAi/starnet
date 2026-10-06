/* node test/credit-tool.test.js — tool registration, schema, and redacted results.
   The model-facing string must not carry the consumer's name, date of birth, or street address,
   and it must not carry the letter body. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const { makeRegistry } = require('../sidecar/tools/registry.js');
const { makeCreditTools } = require('../sidecar/tools/builtin/credit.js');
const { makeStore, makeMemoryFs } = require('../sidecar/credit/store.js');
const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');

const ROOT = path.join(__dirname, '..');
const FIX = 'test/fixtures/credit/synthetic-3b-report.txt';
const mem = makeMemoryFs();
const store = makeStore({ fs: mem, path: path, root: ROOT, clock: { now: () => Date.parse('2026-10-06T12:00:00.000Z') } });
const tools = makeCreditTools({ fs: fs, storeFs: mem, store: store, pathMod: path, root: ROOT, clock: { now: () => Date.parse('2026-10-06T12:00:00.000Z') } });
const registry = makeRegistry();
tools.register(registry);

const names = tools.tools.map(t => t.name).sort();
A.eq(names, ['credit.draft_letters', 'credit.list_drafts', 'credit.parse_report', 'credit.review_case'], 'exactly the four credit tools');
tools.tools.forEach(t => {
  A.eq(t.capability, 'credit', t.name + ' capability');
  A.eq(t.impact, 'none', t.name + ' impact');
  A.eq(t.requiresConsent, false, t.name + ' does not ask first');
  A.eq(t.schema.type, 'object', t.name + ' schema');
  A.ok(registry.get(t.name), t.name + ' is registered');
});
A.eq(tools.tools.filter(t => /send|mail|fax|approve/i.test(t.name)).length, 0, 'no send tool is registered');

const grants = CAP_REGISTRY.computer.filter(g => g.capId === 'credit');
A.eq(grants.map(g => g.tool).sort(), names, 'computer grants the four tools');
A.ok(grants.every(g => g.deferred === true && g.network === false), 'credit grants are deferred and offline');

const BANNED = [
  'Alex R. Testperson',
  'Alex Testperson',
  'Testperson Alex',
  '100 SAMPLE ST',
  'ANYTOWN, FL 30000',
  '1990-01-01',
  'Jan 01, 1990',
  '01/01/1990',
  '## Disputed Item',
  'To Whom It May Concern'
];

function assertRedacted(label, value) {
  const blob = JSON.stringify(value);
  BANNED.forEach(s => A.ok(blob.indexOf(s) < 0, label + ' does not contain ' + s));
}

(async () => {
  const parsed = await registry.dispatch({ name: 'credit.parse_report', args: { path: FIX } }, {});
  A.eq(parsed.ok, true, 'parse tool runs');
  A.ok(/7 tradelines/.test(parsed.content) || /Tradelines: 7/.test(parsed.content), 'parse summary counts tradelines');
  assertRedacted('parse', parsed);

  const intake = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/credit/intake-complete.json'), 'utf8'));
  const reviewed = await registry.dispatch({ name: 'credit.review_case', args: { reportPath: FIX, intake: intake } }, {});
  A.eq(reviewed.ok, true, 'review tool runs');
  A.ok(/No letter was drafted/.test(reviewed.content), 'review does not draft');
  assertRedacted('review', reviewed);

  const drafted = await registry.dispatch({ name: 'credit.draft_letters', args: { reportPath: FIX, intake: intake } }, {});
  A.eq(drafted.ok, true, 'draft tool runs');
  A.ok(/Status DRAFT/.test(drafted.content), 'draft summary says DRAFT');
  A.ok(/Demo Credit Union/.test(drafted.content), 'furnisher name is allowed in the summary');
  A.ok(/5555/.test(drafted.content), 'masked last4 is allowed');
  A.ok(/credit\/cases\//.test(drafted.content), 'summary names the file path');
  assertRedacted('draft', drafted);

  const listed = await registry.dispatch({ name: 'credit.list_drafts', args: {} }, {});
  A.eq(listed.ok, true, 'list tool runs');
  A.ok(/DRAFT/.test(listed.content), 'list shows the draft status');
  assertRedacted('list', listed);

  const outside = await registry.dispatch({ name: 'credit.parse_report', args: { path: '/etc/passwd' } }, {});
  A.eq(outside.ok, false, 'a path outside the workspace is refused');
  A.report('credit-tool.test');
})();
