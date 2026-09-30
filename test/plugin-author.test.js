/* node test/plugin-author.test.js — THE CREW BUILDS PLUGINS (plugin extensions phase 4, 2026-09-29).

   sidecar/tools/builtin/plugin-author.js against real temp folders. Proves the flow is INERT until approval:
     - drafts are written only inside plugin-drafts/<id> (paths, types, sizes and counts are bounded);
     - check parses and COMPILES (never runs) and lints the look (warnings, never blocks);
     - preview hands the page the draft's first screen; a draft with no window is refused;
     - submit refuses a broken draft, installs a good one into plugins/<id> and re-lists (installed = OFF);
     - the tool defs: capability pluginauthor, impact none, only submit asks — and every one is granted. */
'use strict';
const A = require('./_assert.js');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const vm = require('node:vm');
const { makePluginAuthorTools, toolNames } = require('../sidecar/tools/builtin/plugin-author.js');
const { templateFiles } = require('../sidecar/plugin-template.js');
const { parseScreens } = require('../sidecar/plugins.js');
const { relPathOk } = require('../sidecar/plugin-surface.js');
const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');

const DIR = path.join(os.tmpdir(), 'starnet-plugin-author-' + process.pid);
const DRAFTS = path.join(DIR, 'plugin-drafts'), PLUGINS = path.join(DIR, 'plugins');
const previews = [], installs = [];
const author = makePluginAuthorTools({
  fsp, path, draftsDir: DRAFTS, pluginsDir: PLUGINS, template: templateFiles, parseScreens, relPathOk, now: () => 1000,
  compile: (src, file) => { if (/^\s*(?:import|export)\s/m.test(src)) return ''; try { new vm.Script('(function (exports, require, module, __filename, __dirname) {' + src + '\n})', { filename: file }); return ''; } catch (e) { return e.message; } },
  preview: async (id, screen) => { previews.push({ id, screen }); return { ok: true, title: 'PR RADAR' }; },
  afterInstall: async (id) => { installs.push(id); }
});
const tool = (n) => author.defs.find(d => d.name === n);
const run = (n, a) => tool(n).run(a, {});
async function throwsMsg(fn) { try { await fn(); return ''; } catch (e) { return e.message; } }

(async () => {
  await fsp.rm(DIR, { recursive: true, force: true });
  try {
    // ---- the defs and their grants ----
    A.eq(author.defs.map(d => d.name).sort(), toolNames().slice().sort(), 'six authoring tools');
    A.ok(author.defs.every(d => d.capability === 'pluginauthor' && d.impact === 'none' && d.network === false), 'all pluginauthor, no external effect, no network');
    A.eq(author.defs.filter(d => d.requiresConsent).map(d => d.name).sort(), ['plugin.draft_from_installed', 'plugin.submit'], 'only submit and reading an installed plugin ask first');
    A.eq(tool('plugin.submit').scope, 'execute', 'submit is EXECUTE scope (never carried by a cached Always or an unattended run)');
    const granted = CAP_REGISTRY.computer.filter(g => g.capId === 'pluginauthor').map(g => g.tool).sort();
    A.eq(granted, [], 'no authoring tool is granted: the crew builds APPS for the Commander, never plugins to approve (Andrew 2026-09-30)');

    // ---- start ----
    const s = await run('plugin.draft_start', { id: 'pr-radar', name: 'PR Radar', description: 'Open PRs' });
    A.ok(/Draft "pr-radar" ready with 3 files: /.test(s.content) && ['plugin.json', 'index.js', 'ui/index.html'].every(f => s.content.indexOf(f) >= 0), 'draft_start writes the working template');
    A.ok(/already exists/.test((await run('plugin.draft_start', { id: 'pr-radar' })).content), 'a second start does not clobber the draft');
    A.ok(/`id`/.test(await throwsMsg(() => run('plugin.draft_start', { id: '../evil' }))), 'a path-shaped id is refused');

    // ---- read / write ----
    A.ok(/ui\/index\.html/.test((await run('plugin.draft_read', { id: 'pr-radar' })).content), 'draft_read lists files');
    A.ok(/"screens"/.test((await run('plugin.draft_read', { id: 'pr-radar', path: 'plugin.json' })).content), 'draft_read reads a file');
    A.ok(/relative path/.test(await throwsMsg(() => run('plugin.draft_write', { id: 'pr-radar', path: '../../plugins/x/index.js', content: 'x' }))), 'writing outside the draft is refused');
    A.ok(/relative path/.test(await throwsMsg(() => run('plugin.draft_write', { id: 'pr-radar', path: 'C:/Windows/x.js', content: 'x' }))), 'an absolute path is refused');
    A.ok(/only text files/.test(await throwsMsg(() => run('plugin.draft_write', { id: 'pr-radar', path: 'ui/app.exe', content: 'x' }))), 'a binary type is refused');
    A.ok(/512 KB/.test(await throwsMsg(() => run('plugin.draft_write', { id: 'pr-radar', path: 'ui/big.js', content: 'x'.repeat(600 * 1024) }))), 'a file over 512 KB is refused');
    A.ok(/no draft/.test(await throwsMsg(() => run('plugin.draft_write', { id: 'nope', path: 'a.js', content: 'x' }))), 'writing to a draft that was never started is refused');
    await run('plugin.draft_write', { id: 'pr-radar', path: 'ui/extra.css', content: '.x { color: var(--ph); }' });
    A.ok(await fsp.stat(path.join(DRAFTS, 'pr-radar', 'ui', 'extra.css')).then(() => true, () => false), 'a file is written inside the draft');

    // ---- check ----
    let c = await run('plugin.check', { id: 'pr-radar' });
    A.ok(/^OK — no problems\./.test(c.content), 'the template checks clean: ' + c.content.split('\n')[0]);
    await run('plugin.draft_write', { id: 'pr-radar', path: 'index.js', content: 'module.exports = { register(api) { api.tool({ name: "x", run: () => 1 }) ' });
    c = await run('plugin.check', { id: 'pr-radar' });
    A.ok(/PROBLEMS/.test(c.content) && /index\.js: /.test(c.content), 'a syntax error is caught by COMPILING (never running) index.js');
    await run('plugin.draft_write', { id: 'pr-radar', path: 'index.js', content: 'module.exports = { register(api) { api.tool({ name: "x", run: () => 1 }); } };' });
    await run('plugin.draft_write', { id: 'pr-radar', path: 'ui/index.html', content: '<html><body style="background:#fff;font-family:Arial"><h1>hi</h1></body></html>' });
    c = await run('plugin.check', { id: 'pr-radar' });
    A.ok(/^OK/.test(c.content), 'look problems never block');
    A.ok(/white background/.test(c.content) && /font other than/.test(c.content) && /no kit classes/.test(c.content), 'the look check warns: white background, foreign font, no kit classes');
    await run('plugin.draft_write', { id: 'pr-radar', path: 'plugin.json', content: '{ "name": "PR Radar", "main": "missing.js", "screens": [{ "id": "main", "entry": "ui/nope.html" }] ' });
    c = await run('plugin.check', { id: 'pr-radar' });
    A.ok(/not valid JSON/.test(c.content), 'a broken manifest is a problem');
    await run('plugin.draft_write', { id: 'pr-radar', path: 'plugin.json', content: JSON.stringify({ name: 'PR Radar', main: 'missing.js', screens: [{ id: 'main', entry: 'ui/nope.html' }] }) });
    c = await run('plugin.check', { id: 'pr-radar' });
    A.ok(/missing\.js, which does not exist/.test(c.content) && /ui\/nope\.html does not exist/.test(c.content), 'a missing main and a missing window page are problems');

    // ---- submit refuses a broken draft ----
    A.ok(/fix these first/.test(await throwsMsg(() => run('plugin.submit', { id: 'pr-radar' }))), 'submit refuses a draft with problems');
    A.eq(installs.length, 0, 'nothing was installed');

    // ---- fix, preview, submit ----
    await run('plugin.draft_write', { id: 'pr-radar', path: 'plugin.json', content: JSON.stringify({ name: 'PR Radar', version: '1.0.0', main: 'index.js', screens: [{ id: 'main', title: 'PR RADAR', entry: 'ui/index.html' }, { id: 'settings', title: 'SETTINGS', entry: 'ui/index.html' }] }) });
    A.ok(/^OK/.test((await run('plugin.check', { id: 'pr-radar' })).content), 'fixed draft checks clean');
    const p = await run('plugin.preview', { id: 'pr-radar' });
    A.eq(previews[0], { id: 'pr-radar', screen: 'main' }, 'preview opens the FIRST screen by default');
    A.ok(/DRAFT window "PR RADAR" is open/.test(p.content), 'preview says a DRAFT window is open');
    await run('plugin.preview', { id: 'pr-radar', screen: 'settings' });
    A.eq(previews[1].screen, 'settings', 'preview can open a named screen');
    const sub = await run('plugin.submit', { id: 'pr-radar' });
    A.ok(/Installed the "pr-radar" plugin — it is OFF until the Commander approves it/.test(sub.content), 'submit installs it OFF and says so');
    A.eq(installs, ['pr-radar'], 'the station re-lists after install (so EXTENSIONS shows it pending)');
    A.ok(await fsp.stat(path.join(PLUGINS, 'pr-radar', 'ui', 'extra.css')).then(() => true, () => false), 'the whole draft is installed');
    A.ok(!(await fsp.readdir(DRAFTS)).some(n => /^\.staging-/.test(n)), 'no staging folder is left behind');

    // ---- edit an installed plugin ----
    await fsp.rm(path.join(DRAFTS, 'pr-radar'), { recursive: true, force: true });
    const e = await run('plugin.draft_from_installed', { id: 'pr-radar' });
    A.ok(/Draft "pr-radar" ready with 4 files copied from the installed plugin/.test(e.content), 'draft_from_installed copies the installed plugin into a draft');
    await run('plugin.draft_write', { id: 'pr-radar', path: 'ui/extra.css', content: '.x { color: var(--gold); }' });
    A.ok(/Replaced the "pr-radar" plugin/.test((await run('plugin.submit', { id: 'pr-radar' })).content), 'resubmitting replaces the installed plugin (off until re-approved)');
    A.eq(await fsp.readFile(path.join(PLUGINS, 'pr-radar', 'ui', 'extra.css'), 'utf8'), '.x { color: var(--gold); }', 'the installed copy is the new code');
    A.ok(/no installed plugin/.test(await throwsMsg(() => run('plugin.draft_from_installed', { id: 'ghost' }))), 'draft_from_installed needs a real installed plugin');
    A.ok(/relative path/.test(await throwsMsg(() => run('plugin.draft_write', { id: 'pr-radar', path: 'ui/app.js:evil.js', content: 'x' }))), 'an NTFS alternate data stream path is refused');
    A.ok(/relative path/.test(await throwsMsg(() => run('plugin.draft_write', { id: 'pr-radar', path: 'ui/index.html.', content: 'x' }))), 'a trailing dot (a Windows alias) is refused');
    A.ok(/relative path/.test(await throwsMsg(() => run('plugin.draft_write', { id: 'pr-radar', path: 'ui/CON.js', content: 'x' }))), 'a device name is refused');
    A.ok(/relative path/.test(await throwsMsg(() => run('plugin.draft_write', { id: 'pr-radar', path: 'UI~1/x.js', content: 'x' }))), 'an 8.3 short name is refused');

    // ---- a draft with no window cannot be previewed ----
    await run('plugin.draft_start', { id: 'hooks-only' });
    await run('plugin.draft_write', { id: 'hooks-only', path: 'plugin.json', content: JSON.stringify({ name: 'H', main: 'index.js' }) });
    A.ok(/no windows to preview/.test(await throwsMsg(() => run('plugin.preview', { id: 'hooks-only' }))), 'preview refuses a draft with no windows');
  } finally {
    await fsp.rm(DIR, { recursive: true, force: true }).catch(() => {});
  }
  A.report ? A.report('plugin-author.test') : process.exit(0);
})();
