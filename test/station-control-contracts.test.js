/* test/station-control-contracts.test.js — station.control says "done" only when the station changed (sweep 2026-10-03).

   A contract review of every station.control action against its real route found the tool reporting changes that never
   happened: a route that refuses inside a 200 ({ok:false} — a KEEP whose patch could not apply, a reconnect that failed),
   a change to something that is not there (a connector, skill, standing approval or off-limits entry that does not exist;
   a trusted folder written with other case or slashes, which left the folder TRUSTED), Full Power "off" while the boot flag
   keeps it on; settings reads that showed every market skill uninstalled and every plugin unapproved; and the Commander's
   next autonomy-dial click quietly writing back the axes the lead had just changed. */
'use strict';
const A = require('./_assert.js');
const { makeStationControlTools } = require('../sidecar/tools/builtin/station-control.js');

const refused = r => /^REFUSED: /.test(r.content);
function station(lists, posts) {
  const routes = [];
  return {
    routes,
    route: async (method, url, body) => {
      routes.push({ method, url, body });
      if (method === 'GET' && lists[url]) return { status: 200, json: lists[url] };
      const k = method + ' ' + url;
      return posts && posts[k] ? posts[k] : { status: 200, json: { ok: true } };
    }
  };
}
const make = s => makeStationControlTools({ route: s.route, surface: 'interactive' });
const changed = s => s.routes.filter(r => r.method !== 'GET');

(async () => {
  const LISTS = {
    '/api/connectors': { connectors: [{ id: 'github' }] }, '/api/skills': { skills: [{ slug: 'pdf' }] },
    '/api/permissions': { grants: ['cabinet:write', 'path:C:\\Users\\me\\Proj'] }, '/api/nightshift/focus': { avoid: [{ ref: 'goal' }] }
  };

  // ---- a 200 that says ok:false is a refusal ----
  let s = station(LISTS, { 'POST /api/workshop/decide': { status: 200, json: { ok: false, applied: false, error: 'the patch does not apply to the project any more' } },
    'POST /api/connectors/refresh': { status: 200, json: { ok: false, state: 'error', error: 'auth failed' } } });
  let t = make(s);
  let r = await t.powerTool.run({ action: 'deliverable.decide', args: { runId: 'r1', decision: 'keep' } });
  A.ok(refused(r) && /does not apply/.test(r.content), 'a KEEP whose patch could not apply is REFUSED with the reason, never "done"');
  r = await t.controlTool.run({ action: 'connector.refresh', args: { id: 'github' } });
  A.ok(refused(r) && /auth failed/.test(r.content), 'a reconnect that failed is REFUSED');

  // ---- a change to something that is not there is refused, and nothing is written ----
  for (const [action, args, what] of [
    ['connector.remove', { id: 'gitlab' }, 'an unknown connector'],
    ['skill.set', { slug: 'nope', on: false }, 'an unknown skill'],
    ['permission.revoke', { key: 'shell:execute' }, 'a standing approval that is not held'],
    ['nightshift.avoid', { ref: 'C:\\x', allow: true }, 'an off-limits entry that is not on the list'],
    ['project.untrust', { root: 'C:\\Users\\me\\Other' }, 'a folder that is not trusted']
  ]) {
    s = station(LISTS); t = make(s);
    r = await t.controlTool.run({ action, args });
    A.ok(refused(r), action + ': ' + what + ' is REFUSED, never "done"');
    A.eq(changed(s).length, 0, action + ': nothing was written');
  }
  for (const [action, args, method, url] of [
    ['connector.remove', { id: 'github' }, 'POST', '/api/connectors/remove'], ['skill.set', { slug: 'pdf', on: true }, 'POST', '/api/skills/toggle'],
    ['permission.revoke', { key: 'cabinet:write' }, 'POST', '/api/permissions/revoke'], ['nightshift.avoid', { ref: 'goal', allow: true }, 'DELETE', '/api/nightshift/avoid?ref=goal']
  ]) {
    s = station(LISTS); t = make(s);
    r = await t.controlTool.run({ action, args });
    A.ok(!refused(r) && changed(s).length === 1 && changed(s)[0].method + ' ' + changed(s)[0].url === method + ' ' + url, action + ': a real one still changes');
  }
  // the folder grant is keyed by the exact stored root: other case, forward slashes and a trailing slash still find it
  s = station(LISTS); t = make(s);
  r = await t.controlTool.run({ action: 'project.untrust', args: { root: 'c:/users/ME/proj/' } });
  A.ok(!refused(r), 'untrusting a folder written another way works');
  A.eq(JSON.stringify(changed(s)[0].body), JSON.stringify({ key: 'path:C:\\Users\\me\\Proj' }), 'and revokes the EXACT stored key (it left the folder trusted before)');

  // ---- Full Power OFF while the boot flag keeps it on ----
  s = station(LISTS, { 'POST /api/permissions/bypass': { status: 200, json: { ok: true, masterBypass: false, envFullAccess: true } } }); t = make(s);
  r = await t.controlTool.run({ action: 'fullpower.set', args: { on: false } });
  A.ok(refused(r) && /STAYS ON/.test(r.content) && /SKYNET_FULL_ACCESS/.test(r.content), 'Full Power off under the boot flag says it stays on');
  s = station(LISTS, { 'POST /api/permissions/bypass': { status: 200, json: { ok: true, masterBypass: false, envFullAccess: false } } }); t = make(s);
  A.ok(!refused(await t.controlTool.run({ action: 'fullpower.set', args: { on: false } })), 'Full Power off without it is done');

  // ---- settings reads match what the routes return ----
  s = station({
    '/api/skills': { skills: [] },
    '/api/skill-market': { entries: [{ slug: 'a', status: 'installed' }, { slug: 'b', status: 'update' }, { slug: 'c', status: 'available' }, { slug: 'd', status: 'bundled' }] },
    '/api/plugins': { plugins: [{ id: 'p1', active: true, pending: false }, { id: 'p2', active: false, pending: true }] }, '/api/hooks': { hooks: [], pending: [] },
    '/api/projects': { projects: [{ root: 'C:\\p', displayPath: 'C:\\p', blessed: true }] }
  }); t = make(s);
  let read = JSON.parse((await t.settingsTool.run({ section: 'skills' })).content);
  A.eq(read['skill-market'].market.map(m => m.slug + ':' + m.installed).join(' '), 'a:true b:true c:false d:true', 'market skills read installed from their status');
  read = JSON.parse((await t.settingsTool.run({ section: 'extensions' })).content);
  A.eq(read.plugins.plugins.map(p => p.id + ':' + p.approved).join(' '), 'p1:true p2:false', 'a plugin is approved unless it is pending');
  read = JSON.parse((await t.settingsTool.run({ section: 'projects' })).content);
  A.eq(read.projects.projects[0].name, 'C:\\p', 'a project is named by its displayPath');
  s = station({ '/api/skills': { skills: [] }, '/api/skill-market': { ok: false, error: 'the market is unreachable' } }); t = make(s);
  read = JSON.parse((await t.settingsTool.run({ section: 'skills' })).content);
  A.ok(read['skill-market'].unreadable && /unreachable/.test(read['skill-market'].unreadable), 'an offline market reads as unreadable, never as an empty market');

  // ---- the dial never writes old axes back over the lead's change ----
  global.Autonomy = require('../frontend/app/autonomy.js');
  const mem = {};
  global.localStorage = { getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } };
  let server = Autonomy.fresh();
  global.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    if (body) server = Autonomy.normalize(body.posture);
    return { ok: true, json: async () => ({ ok: true, summary: Autonomy.summary(server) }) };
  };
  const { AutonomyStore } = require('../frontend/app/autonomystore.js');
  await AutonomyStore.init();
  server = Autonomy.normalize(Object.assign({}, server, { initiative: 'leash', reach: 'reach' }));   // the lead's station.power autonomy.set
  await AutonomyStore.setLeash(5);                                                                     // the Commander's next click
  A.eq(server.initiative + '/' + server.reach + '/' + server.leashPerDay, 'leash/reach/5', 'one dial click keeps the axes the lead changed');

  A.report('station-control-contracts.test');
})().catch(e => { console.error(e); process.exit(1); });
