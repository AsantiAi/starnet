'use strict';

/* DELETE AGENT must stay findable. It used to live in a DANGER block at the bottom of the collapsed
   APPEARANCE group in the dossier's CONFIG tab, and people kept asking how to delete an agent at all.
   It is now its own row under every group. This pins both halves: the row renders with the right
   gating, and CONFIG places it OUTSIDE the <details> groups (never back inside agCommand). */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const A = require('./_assert.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'stationui.js'), 'utf8');
const slice = (from, to) => {
  const s = source.indexOf(from);
  const e = source.indexOf(to, s + from.length);
  A.ok(s >= 0 && e > s, 'can isolate ' + from.trim());
  return source.slice(s, e);
};

const delSrc = slice('  function agDeleteRow(a) {', '\n  // COMMANDER CONTROLS');
const render = (crew, agent) => vm.runInNewContext(delSrc + '\n agDeleteRow;', {
  access: { config: { crewCount: () => crew } }, present: [], esc: String
})(agent);

const live = render(3, { id: 'scout', role: 'researcher' });
A.ok(/id="ag-del-card"/.test(live), 'the delete row is its own card');
A.ok(/<button class="bb sm ag-del" id="ag-del-btn" title=[^>]*>✕ DELETE AGENT<\/button>/.test(live), 'a crew agent gets a live DELETE AGENT button');
A.ok(!/disabled/.test(live), 'a crew agent’s delete is not disabled');

const hero = render(3, { id: 'agent', role: 'orchestrator' });
A.ok(/id="ag-del-btn" disabled/.test(hero), 'the overseer’s delete is disabled');
A.ok(hero.includes('the overseer can’t be deleted'), 'and says why');

const last = render(1, { id: 'scout', role: 'researcher' });
A.ok(/id="ag-del-btn" disabled/.test(last), 'the last agent’s delete is disabled');
A.ok(last.includes('the last agent can’t be deleted'), 'and says why');

const cmdSrc = slice('  function agCommand(a) {', '\n  function agGrowth(a) {');
A.ok(!cmdSrc.includes('ag-del-btn') && !cmdSrc.includes('agDeleteRow'), 'APPEARANCE (agCommand) no longer holds the delete button');

const cfgSrc = slice('  function agConfig(a) {', '\n  // W3 per-agent AWAY-WORKSHOP');
const groupsEnd = cfgSrc.indexOf("}).join('')");
const delAt = cfgSrc.indexOf('agDeleteRow(a)');
A.ok(groupsEnd > 0 && delAt > groupsEnd, 'CONFIG renders the delete row after (outside) every collapsible group');

A.report('dossier-delete-visible.test');
