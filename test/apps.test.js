/* node test/apps.test.js — APPS: describe it, get it (2026-09-29).

   sidecar/apps.js + sidecar/tools/builtin/apps.js against real temp folders and the real plugin store:
     - create names a unique id from the name and writes the "building" page (escaped by the host's template);
     - the page files are bounded (paths, types, sizes, app.json is the station's) and a write moves the digest
       (a new URL, so the open window reloads) and tells the window;
     - publish stores the data plus the station's own _meta { updatedAt } (never writable by the crew) and tells the window;
     - schedule makes ONE routine (replacing any old one), "off" removes it, describe reports the routine's truth
       (a deleted routine reads `missing`, never a schedule that will not fire);
     - remove takes the routine and the data with it;
     - the tools: capability apps, impact none, no consent, every one granted to the computer — and check lints the look. */
'use strict';
const A = require('./_assert.js');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const vm = require('node:vm');
const crypto = require('crypto');
const { makeApps, slugify } = require('../sidecar/apps.js');
const { makeAppTools, toolNames } = require('../sidecar/tools/builtin/apps.js');
const { makePluginLoader, _internals } = require('../sidecar/plugins.js');
const { makePluginStore } = require('../sidecar/plugin-surface.js');
const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');

const DIR = path.join(os.tmpdir(), 'starnet-apps-' + process.pid);
const loader = makePluginLoader({ fsp, pathMod: path, dir: path.join(DIR, 'plugins'), allowFile: path.join(DIR, 'allow.json'), requireModule: () => ({}), hash: (s) => crypto.createHash('sha256').update(String(s)).digest('hex'), onError() {} });
const mem = new Map();
const store = makePluginStore({ store: { get: (k) => mem.get(k), set: (k, v) => mem.set(k, v), update: async (k, fn) => { const n = fn(mem.get(k)); if (n !== undefined) mem.set(k, n); } } });
let clock = 1000;
const jobs = new Map(); let jobSeq = 0; let armed = false;
const cron = {
  create: async (spec) => { const id = 'job' + (++jobSeq); jobs.set(id, Object.assign({ id, scheduleDisplay: 'every 24h', nextRunAt: 5000 }, spec)); return { ok: true, job: jobs.get(id) }; },
  remove: async (id) => { jobs.delete(id); },
  get: (id) => jobs.get(id) || null,
  armed: () => armed
};
const told = [];
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const apps = makeApps({
  fsp, path, dir: path.join(DIR, 'apps'), store, treeDigest: (d) => loader._internals.treeDigest(d), relPathOk: _internals.relPathOk,
  now: () => clock,
  template: ({ name, description }) => ({ 'index.html': '<title>' + esc(name) + '</title><p class="sn-hint">' + esc(description) + '</p>' }),
  cron, notify: { reload: (id, digest) => told.push(['reload', id, digest]), data: (id) => told.push(['data', id]) }
});
const tools = makeAppTools({ apps, now: () => Date.UTC(2026, 8, 29, 12), compile: (src, file) => { try { new vm.Script(src, { filename: file }); return ''; } catch (e) { return e.message; } } });
const run = (n, a) => tools.defs.find(d => d.name === n).run(a);
const throwsMsg = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };

(async () => {
  try {
    A.throws(() => makeApps({ fsp, path, dir: DIR }), 'apps without an injected clock is refused');
    A.eq(slugify('AI News Brief!'), 'ai-news-brief', 'the id comes from the name');
    A.eq(slugify('***'), 'app', 'a name with no letters still gets an id');

    // ---- create ----
    const a = await apps.create({ name: 'AI News Brief', description: 'Top <b>AI</b> news\nevery 24h' });
    A.eq(a.id, 'ai-news-brief', 'create names the app from its name');
    A.eq(a.description, 'Top <b>AI</b> news every 24h', 'the description is one plain line');
    const b = await apps.create({ name: 'AI News Brief' });
    A.eq(b.id, 'ai-news-brief-2', 'a second app with the same name gets its own id');
    A.ok(/Top &lt;b&gt;AI&lt;\/b&gt;/.test(await apps.readFile(a.id, 'index.html')), 'the building page shows the description escaped');
    A.ok(/give the app a name/.test(await throwsMsg(() => apps.create({ name: '  ' }))), 'an app needs a name');
    A.ok(/there is no app/.test(await throwsMsg(() => apps.need('ghost'))), 'an unknown app is refused by name');
    A.ok(/app id/.test(await throwsMsg(() => apps.need('../x'))), 'an id that is not an app id is refused');

    // ---- the page ----
    const d0 = (await apps.record(a.id)).digest;
    told.length = 0;
    clock += 5000;
    await apps.writeFile(a.id, 'index.html', '<div class="sn-panel">hi</div><script>starnet.store.get("brief")</script>');
    const d1 = (await apps.record(a.id)).digest;
    A.ok(d0 && d1 && d0 !== d1, 'writing the page moves its digest (a new URL)');
    A.eq(told[0], ['reload', a.id, d1], 'a write tells the open window to reload onto the new digest');
    A.ok(/page file/.test(await throwsMsg(() => apps.writeFile(a.id, 'app.json', '{}'))), 'app.json is the station\'s, never the crew\'s');
    A.ok(/page file/.test(await throwsMsg(() => apps.writeFile(a.id, '../escape.html', 'x'))), 'a path outside the app is refused');
    A.ok(/page file/.test(await throwsMsg(() => apps.writeFile(a.id, 'index.html:evil', 'x'))), 'an NTFS stream path is refused');
    A.ok(/only text files/.test(await throwsMsg(() => apps.writeFile(a.id, 'run.exe', 'x'))), 'only text files');
    A.ok(/512 KB/.test(await throwsMsg(() => apps.writeFile(a.id, 'big.txt', 'x'.repeat(512 * 1024 + 1)))), 'a file is bounded');

    // ---- data ----
    told.length = 0;
    await apps.publish(a.id, 'brief', { date: '2026-09-29', items: [{ title: 'T', source: 'S' }] });
    A.eq((await apps.dataGet(a.id, 'brief')).items[0].title, 'T', 'publish stores the data the page reads');
    A.eq((await apps.dataGet(a.id, '_meta')).updatedAt, clock, 'the station stamps when it was updated');
    A.eq(await apps.dataKeys(a.id), ['brief'], 'the station\'s _meta is not listed as the app\'s data');
    A.eq(told, [['data', a.id]], 'publish tells the open window');
    await apps.publish(a.id, 'brief', JSON.stringify({ items: [{ title: 'S' }] }));
    A.eq((await apps.dataGet(a.id, 'brief')).items[0].title, 'S', 'JSON sent as text (models do this) is stored as the value the page reads');
    await apps.publish(a.id, 'note', '{ not json');
    A.eq(await apps.dataGet(a.id, 'note'), '{ not json', 'plain text stays text');
    A.ok(/kept by the station/.test(await throwsMsg(() => apps.publish(a.id, '_meta', { updatedAt: 9e12 }))), 'the crew cannot forge the updated time');
    A.ok(/store key/.test(await throwsMsg(() => apps.publish(a.id, 'bad key!', 1))), 'a bad key is refused');

    // ---- schedule ----
    const s = await apps.schedule(a.id, { every: 'every 24h', task: 'research today\'s AI news' });
    A.eq(s.jobId, 'job1', 'schedule makes a routine');
    A.eq(s.armed, false, 'and says honestly whether routines are on');
    const job = jobs.get('job1');
    A.ok(job.name === 'App: AI News Brief' && job.meta.appId === a.id && /app\.publish/.test(job.prompt) && /research today's AI news/.test(job.prompt), 'the routine runs the task and ends by publishing to this app');
    A.ok(/FIRST call app\.read/.test(job.prompt) && /real date/.test(job.prompt), 'the routine starts by reading the real date (a model assumes its training era)');
    let desc = await apps.describe(a.id);
    A.ok(desc.schedule && desc.schedule.nextRunAt === 5000 && desc.schedule.armed === false && desc.updatedAt === clock, 'describe reports the routine\'s own next run, armed state and the last update');
    await apps.schedule(a.id, { every: 'every 6h', task: 'again' });
    A.ok(!jobs.has('job1') && jobs.has('job2'), 'rescheduling replaces the routine (never two)');
    A.ok(/task/.test(await throwsMsg(() => apps.schedule(a.id, { every: 'every 1h' }))), 'a schedule needs a task');
    jobs.delete('job2');
    desc = await apps.describe(a.id);
    A.ok(desc.schedule && desc.schedule.missing === true, 'a routine deleted elsewhere reads as missing, never as a live schedule');
    const off = await apps.schedule(a.id, { every: 'off' });
    A.ok(off.off && (await apps.describe(a.id)).schedule === null, '"off" clears the schedule');

    // ---- rename / list / remove ----
    await apps.rename(b.id, 'Market Pulse');
    A.eq((await apps.list()).map(x => x.name), ['AI News Brief', 'Market Pulse'], 'list shows every app by its name');
    await apps.schedule(b.id, { every: 'every 24h', task: 'x' });
    await apps.publish(b.id, 'k', 1);
    const bJob = [...jobs.keys()].pop();
    await apps.remove(b.id);
    A.ok(!jobs.has(bJob), 'deleting an app deletes its routine');
    A.eq((await store.op(b.id, 'keys')).value, [], 'and its data');
    A.eq((await apps.list()).map(x => x.id), ['ai-news-brief'], 'and the app');

    // ---- the tools ----
    A.eq(tools.defs.map(d => d.name), toolNames(), 'the tool list matches toolNames()');
    A.ok(tools.defs.every(d => d.capability === 'apps' && d.impact === 'none' && d.requiresConsent === false), 'app tools: capability apps, impact none, never ask');
    const grants = CAP_REGISTRY.computer ? JSON.stringify(CAP_REGISTRY.computer) : JSON.stringify(CAP_REGISTRY);
    A.ok(toolNames().every(n => grants.includes(n)), 'every app tool is granted by the computer');
    const r = await run('app.read', { app: a.id });
    A.ok(/^Today is \w+day, September 29, 2026/.test(r.content), 'app.read opens with the station\'s real date');
    A.ok(/Data keys: brief/.test(r.content) && /HOW A STARNET APP WORKS/.test(r.content), 'app.read lists the data keys and carries the build guide');
    A.ok(/OK — no problems/.test((await run('app.check', { app: a.id })).content), 'a good page checks clean');
    await run('app.write', { app: a.id, path: 'index.html', content: '<body style="background:#fff"><script>fetch("https://x"); (</script></body>' });
    const c = (await run('app.check', { app: a.id })).content;
    A.ok(/PROBLEMS/.test(c) && /white background/.test(c) && /no kit classes/.test(c) && /network/.test(c), 'check reports a broken script and the look/network warnings');
    await run('app.write', { app: a.id, path: 'index.html', content: '<div class="sn-card"></div><script>const h = (u) => `<a href="${u}" onclick="starnet.ui.openLink(${JSON.stringify(u)})">x</a>`;</script>' });
    A.ok(/JSON\.stringify inside an onclick/.test((await run('app.check', { app: a.id })).content), 'check flags a URL quoted into an inline onclick (the bug that framed a news site)');
    const made = await run('app.create', { name: 'Reading List' });
    A.ok(/id: reading-list/.test(made.content), 'app.create (from chat) makes a new app');
  } finally {
    await fsp.rm(DIR, { recursive: true, force: true }).catch(() => {});
  }
  A.report ? A.report('apps.test') : process.exit(0);
})();
