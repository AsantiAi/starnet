/* node test/station-control.test.js — station.settings / station.control / station.power (the lead changes the station
   for the Commander, 2026-10-02). Driven against a stub bridge and a stub route table. What these tools OWN:
     • the split: an escalation (wider access or spending) is refused by station.control and only station.power does it;
       station.power refuses a non-escalation, and refuses ANY call on a run nobody is watching;
     • the walls: the autonomy dial is written with resumeHalt:false; the scheduler is never switched under an E-STOP;
       a deliverable keep never forwards a destination path; a model on an unconnected provider is refused;
     • every route action calls exactly its button's route, method and body; every page action rides station.control;
     • a refusal from the page or a route comes back REFUSED, never as done;
     • the approval card's words come from the catalog for EVERY action (never the model's framing).
   The page half (the setters + the save read-back) is exercised live; the route half's handlers are the existing ones. */
'use strict';
const A = require('./_assert.js');
const { makeStationControlTools, cardFor, ACTIONS } = require('../sidecar/tools/builtin/station-control.js');

function stubs(routeImpl, pageImpl) {
  const routes = [], pages = [];
  return {
    routes, pages,
    route: async (method, url, body) => { routes.push({ method, url, body }); return routeImpl ? routeImpl(method, url, body) : { status: 200, json: { ok: true } }; },
    station: { request: async (verb, args) => { pages.push({ verb, args }); return pageImpl ? pageImpl(verb, args) : { ok: true, result: { ok: true } }; } }
  };
}
const make = (s, extra) => makeStationControlTools(Object.assign({ station: s.station, route: s.route, surface: 'interactive' }, extra || {}));
const refused = r => /^REFUSED: /.test(r.content);

(async () => {

// ---- every action has a card sentence, a takes line, and a home (route runner or the page) ----
for (const name of Object.keys(ACTIONS)) {
  const spec = ACTIONS[name];
  A.ok(typeof spec.takes === 'string' && spec.takes.length > 1, name + ': says what it takes');
  A.ok(spec.page === true || typeof spec.run === 'function', name + ': runs on the page or through a route');
  const card = cardFor({ action: name, args: { agent: 'NOVA', session: 'research', on: true, mode: 'full', reach: 'this-computer', id: 'x', slug: 's', look: { theme: 'green' } } });
  A.ok(/^[a-zA-Z]/.test(card) && !/[{}]/.test(card.replace(/\{[^}]*\}/g, '')) && card.length < 400 && !/\.$/.test(card), name + ': the card is one host-written verb phrase ("NOVA wants to …")');
}
A.ok(/unknown station change/.test(cardFor({ action: 'nope' })), 'an unknown action\'s card says nothing will change');

// ---- the split: control refuses escalations, power refuses the rest ----
{
  const s = stubs();
  const t = make(s);
  let r = await t.controlTool.run({ action: 'fullpower.set', args: { on: true } });
  A.ok(refused(r) && /station\.power/.test(r.content), 'control refuses Full Power on and points at station.power');
  A.eq(s.routes.length, 0, 'nothing was called');
  r = await t.powerTool.run({ action: 'fullpower.set', args: { on: true } });
  A.ok(!refused(r), 'power turns Full Power on');
  A.eq(JSON.stringify(s.routes[0]), JSON.stringify({ method: 'POST', url: '/api/permissions/bypass', body: { on: true } }), 'Full Power rides the Settings route');
  r = await t.controlTool.run({ action: 'fullpower.set', args: { on: false } });
  A.ok(!refused(r), 'control turns Full Power OFF (narrowing is ordinary)');
  r = await t.powerTool.run({ action: 'session.pin', args: { session: 'x' } });
  A.ok(refused(r) && /station\.control/.test(r.content), 'power refuses a non-escalation');
  r = await t.controlTool.run({ action: 'agent.approval', args: { agent: 'NOVA', mode: 'full' } });
  A.ok(refused(r), 'an agent to FULL is an escalation');
  r = await t.controlTool.run({ action: 'agent.reach', args: { agent: 'NOVA', reach: 'this-computer' } });
  A.ok(refused(r), 'an agent onto this computer is an escalation');
  r = await t.controlTool.run({ action: 'agent.reach', args: { agent: 'NOVA', reach: 'safe-cell' } });
  A.ok(!refused(r), 'narrowing an agent\'s reach is ordinary');
  r = await t.controlTool.run({ action: 'budget.set', args: { perDay: 5 } });
  A.ok(refused(r), 'spending limits are always station.power');
}

// ---- an unattended run never escalates ----
{
  const s = stubs();
  const t = make(s, { surface: 'autonomous' });
  const r = await t.powerTool.run({ action: 'budget.set', args: { perDay: 50 } });
  A.ok(refused(r) && /unattended/.test(r.content), 'a routine/night-shift run cannot raise caps');
  A.eq(s.routes.length, 0, 'nothing was called on the unattended run');
  const owner = make(stubs(), { surface: 'autonomous', ownerTrusted: true });
  A.ok(!refused(await owner.powerTool.run({ action: 'budget.set', args: { perDay: 50 } })), 'the Commander\'s own paired chat counts as watched');
  const ord = await t.controlTool.run({ action: 'session.pin', args: { session: 'x' } });
  A.ok(!refused(ord), 'ordinary changes still work unattended (their consent gate decides)');
}

// ---- the walls ----
{
  const s = stubs((m, u) => u === '/api/autonomy/posture' && m === 'GET' ? { status: 200, json: { summary: { initiative: 'wait', reach: 'sandbox', leashPerDay: 3 } } } : { status: 200, json: { ok: true } });
  const t = make(s);
  await t.powerTool.run({ action: 'autonomy.set', args: { initiative: 'leash' } });
  const post = s.routes.find(x => x.method === 'POST');
  A.eq(post.url, '/api/autonomy/posture', 'the dial goes to the autonomy route');
  A.eq(post.body.resumeHalt, false, '⛔ the dial never lifts an E-STOP');
  A.eq(JSON.stringify(post.body.posture), JSON.stringify({ initiative: 'leash', reach: 'sandbox', leashPerDay: 3 }), 'one axis changes; the others are read back first');
}
{
  const s = stubs((m, u) => u === '/api/halt' ? { status: 200, json: { halted: true } } : { status: 200, json: { ok: true } });
  const t = make(s);
  const r = await t.powerTool.run({ action: 'scheduler.set', args: { on: true } });
  A.ok(refused(r) && /E-STOP/.test(r.content), '⛔ routines are not switched on under an E-STOP');
  A.ok(!s.routes.some(x => x.url === '/api/cron/arm'), 'the arm route (which lifts the halt) was never called');
  const off = await t.controlTool.run({ action: 'scheduler.set', args: { on: false } });
  A.ok(refused(off), 'not even OFF: that route lifts the halt in either direction');
}
{
  const s = stubs();
  const t = make(s);
  await t.controlTool.run({ action: 'deliverable.decide', args: { agent: 'agent', runId: 'r1', decision: 'keep', destPath: 'C:\\Windows\\System32' } });
  A.eq(JSON.stringify(s.routes[0].body), JSON.stringify({ agentId: 'agent', runId: 'r1', decision: 'keep' }), '⛔ a keep never forwards a destination path');
  const bad = await t.controlTool.run({ action: 'deliverable.decide', args: { runId: 'r1', decision: 'delete-everything' } });
  A.ok(refused(bad), 'an unknown decision is refused');
}
{
  const s = stubs();
  const t = make(s, { providerReady: id => id === 'openrouter' });
  let r = await t.controlTool.run({ action: 'agent.model', args: { agent: 'NOVA', model: 'gpt-x', provider: 'openai' } });
  A.ok(refused(r) && /not connected/.test(r.content), 'a model on an unconnected provider is refused');
  A.eq(s.pages.length, 0, 'the page was never asked');
  r = await t.controlTool.run({ action: 'agent.model', args: { agent: 'NOVA', model: 'x/y', provider: 'openrouter' } });
  A.ok(!refused(r), 'a connected provider is fine');
  A.eq(JSON.stringify(s.pages[0]), JSON.stringify({ verb: 'station.control', args: { action: 'agent.model', agent: 'NOVA', model: 'x/y', provider: 'openrouter' } }), 'page actions ride station.control with their args');
}

// ---- route actions call exactly their button's route ----
{
  const s = stubs((m, u) => u === '/api/plugins' ? { status: 200, json: { plugins: [{ id: 'p1', digest: 'd9' }] } } : { status: 200, json: { ok: true } });
  const t = make(s);
  const want = [
    ['control', 'memory.forget', { agent: 'NOVA', id: 'm1' }, 'POST', '/api/memory/forget', { agentId: 'NOVA', id: 'm1', reason: 'commander via chat' }],
    ['control', 'learning.set', { on: false }, 'POST', '/api/personalization', { enabled: false }],
    ['control', 'learning.wipe', {}, 'DELETE', '/api/personalization', undefined],
    ['control', 'connector.remove', { id: 'github' }, 'POST', '/api/connectors/remove', { id: 'github' }],
    ['control', 'ability.set', { id: 'web search', on: false }, 'POST', '/api/toolsets/web%20search', { enabled: false }],
    ['control', 'skill.install', { slug: 'pdf' }, 'POST', '/api/skill-market/install', { slug: 'pdf' }],
    ['control', 'app.rename', { id: 'a1', name: 'Tracker' }, 'POST', '/api/apps/rename', { id: 'a1', name: 'Tracker' }],
    ['control', 'project.untrust', { root: 'C:\\p' }, 'POST', '/api/permissions/revoke', { key: 'path:C:\\p' }],
    ['control', 'nightshift.avoid', { ref: 'C:\\p', allow: true }, 'DELETE', '/api/nightshift/avoid?ref=C%3A%5Cp', undefined],
    ['power', 'budget.set', { perDay: 10, global: null, junk: 1 }, 'POST', '/api/budget/caps', { perDay: 10, global: null }],
    ['power', 'project.trust', { path: 'C:\\p' }, 'POST', '/api/projects/bless', { path: 'C:\\p' }],
    ['power', 'key.unattended', { id: 'k1', on: true }, 'POST', '/api/servicekeys/autonomy', { id: 'k1', autonomous: true }]
  ];
  for (const [tool, action, args, method, url, body] of want) {
    s.routes.length = 0;
    const r = await (tool === 'power' ? t.powerTool : t.controlTool).run({ action, args });
    A.ok(!refused(r), action + ': done');
    const last = s.routes[s.routes.length - 1];
    A.eq(last.method + ' ' + last.url, method + ' ' + url, action + ': ' + method + ' ' + url);
    A.eq(JSON.stringify(last.body), JSON.stringify(body), action + ': the button\'s body');
  }
  s.routes.length = 0;
  await t.powerTool.run({ action: 'plugin.approve', args: { id: 'p1' } });
  A.eq(JSON.stringify(s.routes[1].body), JSON.stringify({ id: 'p1', digest: 'd9' }), 'a plugin is approved at the digest on disk now');
}

// ---- refusals come back as refusals ----
{
  const s = stubs(() => ({ status: 404, json: { error: 'no such memory' } }), () => ({ ok: false, error: 'there is no session called "x"' }));
  const t = make(s);
  let r = await t.controlTool.run({ action: 'memory.forget', args: { id: 'zz' } });
  A.ok(refused(r) && /no such memory/.test(r.content), 'a route error is REFUSED with its reason');
  r = await t.controlTool.run({ action: 'session.delete', args: { session: 'x' } });
  A.ok(refused(r) && /no session called/.test(r.content), 'a page refusal is REFUSED with its reason');
  r = await t.controlTool.run({ action: 'not.a.thing', args: {} });
  A.ok(refused(r), 'an unknown action is refused');
  const bare = makeStationControlTools({ surface: 'interactive' });
  r = await bare.controlTool.run({ action: 'session.pin', args: { session: 'x' } });
  A.ok(refused(r) && /no station page/.test(r.content), 'no bridge: an honest refusal, never "done"');
}

// ---- reads ----
{
  const s = stubs((m, u) => ({ status: 200, json: u === '/api/budget/status' ? { caps: { perDay: 5 }, spentToday: 1.2, secretish: 'x' } : { ok: true, chain: [] } }),
    () => ({ ok: true, result: { crew: [{ id: 'agent', name: 'ORION' }] } }));
  const t = make(s);
  let r = await t.settingsTool.run({ section: 'spending' });
  A.ok(/"perDay":5/.test(r.content) && !/secretish/.test(r.content), 'spending reads the caps through a trimmed view');
  r = await t.settingsTool.run({});
  A.ok(/ORION/.test(r.content) && s.pages[0].verb === 'station.settings', 'the default section is the crew, read from the page');
  r = await t.settingsTool.run({ section: 'memory', agent: 'NOVA' });
  A.ok(s.routes.some(x => x.url === '/api/memory/records?agent=NOVA'), 'memory reads that agent\'s records');
  r = await t.settingsTool.run({ section: 'actions' });
  A.ok(/budget\.set .*\[station\.power\]/.test(r.content) && /agent\.approval .*\[station\.power when it widens access\]/.test(r.content) && /lifting an E-STOP/.test(r.content), 'the catalog marks escalations and names the walls');
  A.ok(t.settingsTool.requiresConsent === false && t.controlTool.requiresConsent === true && t.powerTool.requiresConsent === true, 'reads are free, changes ask');
  A.ok(t.controlTool.consentKey !== t.powerTool.consentKey, 'control and power are separate consent classes');
  A.ok(t.controlTool.taintLocked && t.powerTool.taintLocked, 'both lock once the run read untrusted content');
}

A.report('station-control.test');
})().catch(e => { console.error(e); process.exit(1); });
