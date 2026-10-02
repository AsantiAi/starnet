/* node test/plugin-windows.test.js — PLUGIN WINDOWS (plugin extensions phase 1, 2026-09-29).

   A plugin's `screens` open as real StarNet windows around a sandboxed page the sidecar serves from /plugin-ui/.
   These assertions pin what makes that safe and honest:
     - the manifest's screens are validated (an id keys a window, a title is rendered, an entry becomes a path);
     - a window-only plugin (screens, no code) is valid and never require()d;
     - files are served ONLY while the approval covers the bytes on disk — an edit refuses with 410 at once;
     - every response is an OPAQUE-ORIGIN sandbox (never allow-same-origin), framed only by the station;
     - the page minter's plugin ticket verifies on the sidecar and opens nothing else;
     - the kit is injected into every page, relative to it, and a path can never climb out of the plugin;
     - the private store is bounded and keyed only by the plugin the host names.
   Real folders, a real loader, a fake req/res. No server boot. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('node:crypto');
const { makePluginLoader, parseScreens } = require('../sidecar/plugins.js');
const { makePluginUiServer, makePluginStore, injectKit, SANDBOX } = require('../sidecar/plugin-surface.js');
const { templateFiles } = require('../sidecar/plugin-template.js');
const T = require('../sidecar/apitickets.js');
const { MIME } = require('../sidecar/file-response.js');
const { makeDurableJsonStore } = require('../sidecar/durable-store.js');

const DIR = path.join(os.tmpdir(), 'starnet-plugin-windows-' + process.pid);
const PLUGINS = path.join(DIR, 'plugins');
const ALLOW = path.join(DIR, 'plugins-allowed.json');
const FRONTEND = path.resolve(__dirname, '..', 'frontend');
const KEY = 'launch-token-' + 'y'.repeat(40);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
let clockNow = 1000;
const loader = makePluginLoader({
  fsp, pathMod: path, dir: PLUGINS, allowFile: ALLOW,
  requireModule: (p) => { delete require.cache[require.resolve(p)]; return require(p); },
  hash: sha, clock: { now: () => clockNow }, onError: () => {}, template: templateFiles
});
const spine = { register: () => () => {}, events: () => [] };

async function write(id, rel, text) {
  const abs = path.join(PLUGINS, id, ...rel.split('/'));
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, text, 'utf8');
}
function fakeRes() {
  const res = { code: 0, headers: {}, chunks: [], ended: false };
  res.writeHead = (c, h) => { res.code = c; res.headers = Object.assign({}, h || {}); };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.write = (c) => { res.chunks.push(Buffer.from(c)); return true; };
  res.end = (c) => { if (c) res.chunks.push(Buffer.from(c)); res.ended = true; res.emit && res.emit('finish'); };
  res.on = res.once = res.emit = res.removeListener = () => res;
  res.destroy = () => {};
  res.body = () => Buffer.concat(res.chunks).toString('utf8');
  return res;
}
// createReadStream().pipe(res) needs a stream-ish res; collect through a real PassThrough.
function serve(handler, url, method) {
  return new Promise((resolve) => {
    const { PassThrough } = require('stream');
    const res = new PassThrough();
    const out = { code: 0, headers: {}, chunks: [] };
    res.writeHead = (c, h) => { out.code = c; out.headers = Object.assign({}, h || {}); };
    res.setHeader = () => {};
    res.on('data', (c) => out.chunks.push(Buffer.from(c)));
    res.on('end', () => resolve(Object.assign(out, { body: Buffer.concat(out.chunks).toString('utf8') })));
    const origEnd = res.end.bind(res);
    res.end = (c) => { if (c) res.write(c); origEnd(); };
    const req = { url, method: method || 'GET', headers: {}, on: () => {} };
    Promise.resolve(handler(req, res)).catch((e) => { out.code = 599; out.err = e; origEnd(); });
  });
}

(async () => {
  await fsp.rm(DIR, { recursive: true, force: true });
  await fsp.mkdir(PLUGINS, { recursive: true });
  try {
    // ---- 1. MANIFEST SCREENS ARE VALIDATED HARD ----
    const files = new Set(['ui/index.html', 'ui/b.html']);
    const ok = parseScreens({ screens: [{ id: 'main', title: 'PR <b>RADAR</b>\u0007', entry: 'ui/index.html', size: 'wide' }] }, files);
    A.eq(ok.screens.length, 1, 'a valid screen is kept');
    A.eq(ok.screens[0].size, 'wide', 'size wide is honoured');
    A.ok(!/\u0007/.test(ok.screens[0].title), 'control characters are stripped from a title');
    const bad = parseScreens({ screens: [
      { id: '../x', entry: 'ui/index.html' },
      { id: 'a', entry: '../outside.html' },
      { id: 'b', entry: '/abs.html' },
      { id: 'c', entry: 'ui\\index.html' },
      { id: 'd', entry: 'ui/script.js' },
      { id: 'e', entry: 'ui/missing.html' },
      { id: 'f', entry: 'ui/.hidden/index.html' },
      { id: 'main', entry: 'ui/index.html' }, { id: 'main', entry: 'ui/b.html' }
    ] }, files);
    A.eq(bad.screens.map(s => s.id), ['main'], 'only the one valid, non-duplicate screen survives');
    A.eq(bad.errors.length, 8, 'every refused screen is reported (8)');
    A.eq(parseScreens({ screens: 'x' }, files).errors.length, 1, 'screens that is not a list is an error');
    A.eq(parseScreens({ screens: [{ id: 's', entry: 'ui/index.html', size: 'giant' }] }, files).screens[0].size, 'panel', 'an unknown size falls back to panel');

    // ---- 2. A WINDOW-ONLY PLUGIN IS VALID AND NEVER REQUIRE()D ----
    await write('ui-only', 'plugin.json', JSON.stringify({ name: 'UI Only', version: '1.0.0', screens: [{ id: 'main', title: 'UI ONLY', entry: 'ui/index.html' }] }));
    await write('ui-only', 'ui/index.html', '<!doctype html><html><head><title>x</title></head><body><p>hi</p></body></html>');
    await write('ui-only', 'ui/app.js', 'window.x = 1;');
    let d = await loader.discover();
    const uiOnly = d.plugins.find(p => p.id === 'ui-only');
    A.ok(!!uiOnly, 'a screens-only plugin is discovered');
    A.eq(uiOnly && uiOnly.main, null, 'it has no main to load');
    A.eq(uiOnly && uiOnly.screens.map(s => s.id), ['main'], 'its screen is parsed');
    let loaded = await loader.load(spine, { accept: true });
    A.ok(loaded.loaded.some(p => p.id === 'ui-only'), 'approved, it counts as live (its windows may open)');
    A.eq(loaded.errors.length, 0, 'loading a window-only plugin raises no error');

    // ---- 3. THE SERVING GATE: approval must cover the exact bytes on disk ----
    const rec = await loader.approvedRecord('ui-only');
    A.ok(rec && rec.digest === uiOnly.digest, 'approvedRecord returns the approved plugin');
    A.eq(await loader.approvedRecord('nope'), null, 'an unknown plugin has no approved record');
    A.eq(await loader.approvedRecord('../ui-only'), null, 'a path-shaped id is refused');

    const server = makePluginUiServer({
      fs, fsp, path, frontendDir: FRONTEND, loader, apitickets: T, apiKey: KEY, mime: MIME,
      tokenOk: () => false, now: () => 1.9e12, frameAncestors: () => "tauri://localhost http://127.0.0.1:8787"
    });
    const tk = (id, digest) => T.mint(KEY, 'plugin', T.scopePlugin(id, digest), { now: 1.9e12 });
    const url = (id, digest, rel, ticket) => '/plugin-ui/~t/' + (ticket || tk(id, digest)) + '/' + id + '/' + digest + '/' + rel;

    let r = await serve(server, url('ui-only', rec.digest, 'ui/index.html'));
    A.eq(r.code, 200, 'an approved page is served');
    A.ok(/sandbox allow-scripts/.test(r.headers['Content-Security-Policy'] || ''), 'the page is sandboxed');
    A.ok(!/allow-same-origin/.test(r.headers['Content-Security-Policy'] || ''), 'NEVER allow-same-origin (the page must not reach the token)');
    A.ok(!/allow-top-navigation/.test(SANDBOX), 'a plugin can never navigate the station away');
    A.ok(/frame-ancestors tauri:\/\/localhost http:\/\/127\.0\.0\.1:8787/.test(r.headers['Content-Security-Policy'] || ''), 'only the station may frame it');
    A.ok(r.body.indexOf('<head><link rel="stylesheet" href="../_starnet/kit.css"><script src="../_starnet/kit.js"></script>') >= 0, 'the kit is injected first in <head>, relative to the page');
    A.eq(r.headers['Referrer-Policy'], 'no-referrer', 'the ticketed URL never rides a Referer');

    r = await serve(server, url('ui-only', rec.digest, 'ui/app.js'));
    A.eq(r.code, 200, 'the page\'s own asset is served');
    A.eq(r.body, 'window.x = 1;', 'asset bytes are served untouched');

    r = await serve(server, url('ui-only', rec.digest, '_starnet/kit.css'));
    A.ok(r.code === 200 && /@layer starnet/.test(r.body), 'the kit stylesheet is served from the station, layered under the author');
    r = await serve(server, url('ui-only', rec.digest, '_starnet/kit.js'));
    A.ok(r.code === 200 && /window\.starnet = starnet/.test(r.body), 'the kit bridge is served');

    r = await serve(server, url('ui-only', rec.digest, 'ui/../plugin.json'));
    A.eq(r.code, 403, 'a path cannot climb out through ..');
    r = await serve(server, url('ui-only', rec.digest, 'ui%2F..%2F..%2Fplugins-allowed.json'));
    A.eq(r.code, 403, 'an encoded .. is refused too');
    r = await serve(server, url('ui-only', rec.digest, 'ui/missing.html'));
    A.eq(r.code, 404, 'a missing file is 404');
    // Windows aliases that would hide code from the approval digest (NTFS streams, trailing dots, 8.3 names, devices)
    for (const alias of ['ui/app.js:hidden.js', 'ui/app.js%3Ahidden.js', 'ui/index.html.', 'ui/index.html%20', 'UI~1/app.js', 'ui/CON.js', 'ui/nul']) {
      r = await serve(server, url('ui-only', rec.digest, alias));
      A.eq(r.code, 403, 'a Windows alias path is refused: ' + alias);
    }
    r = await serve(server, url('ui-only', rec.digest, 'constructor'));
    A.ok(r.code === 403 || r.code === 404, 'a prototype-named path is refused, never a 500 (got ' + r.code + ')');
    r = await serve(server, url('ui-only', 'b'.repeat(64), 'ui/index.html'));
    A.ok(/text\/html/.test(r.headers['Content-Type'] || '') && /color-scheme:dark/.test(r.body), 'a refusal is a small DARK page (never a white text page in a station window)');
    A.ok(/sandbox; default-src 'none'/.test(r.headers['Content-Security-Policy'] || ''), 'the refusal page itself runs nothing');
    // a DRAFT preview server: same files, locked down — scripts only, no network, no forms, no popups
    const draftServer = makePluginUiServer({
      fs, fsp, path, frontendDir: FRONTEND, loader, apitickets: T, apiKey: KEY, mime: MIME, now: () => 1.9e12,
      frameAncestors: () => 'http://127.0.0.1:8787', prefix: '/plugin-draft/', scopeFor: T.scopeDraft,
      resolve: async (id) => (id === 'ui-only' ? { id, dir: path.join(PLUGINS, 'ui-only'), digest: rec.digest } : null),
      sandbox: 'sandbox allow-scripts', extraCsp: () => "; default-src 'none'; script-src 'unsafe-inline' http://127.0.0.1:8787; connect-src 'none'; form-action 'none'"
    });
    const dt = T.mint(KEY, 'plugin', T.scopeDraft('ui-only', rec.digest), { now: 1.9e12 });
    r = await serve(draftServer, '/plugin-draft/~t/' + dt + '/ui-only/' + rec.digest + '/ui/index.html');
    A.eq(r.code, 200, 'a draft page is served on its own route with a draft ticket');
    const dcsp = r.headers['Content-Security-Policy'] || '';
    A.ok(/^sandbox allow-scripts;/.test(dcsp) && !/allow-popups|allow-forms/.test(dcsp), 'a draft runs scripts only: no popups, no forms');
    A.ok(/connect-src 'none'/.test(dcsp) && /form-action 'none'/.test(dcsp), 'a draft can never reach the network');
    r = await serve(draftServer, '/plugin-draft/~t/' + tk('ui-only', rec.digest) + '/ui-only/' + rec.digest + '/ui/index.html');
    A.eq(r.code, 403, 'an INSTALLED plugin ticket never opens a draft (scopes differ)');
    r = await serve(server, '/plugin-ui/ui-only/' + rec.digest + '/ui/index.html');
    A.eq(r.code, 403, 'no ticket and no header token: refused');
    r = await serve(server, url('ui-only', rec.digest, 'ui/index.html', tk('other', rec.digest)));
    A.eq(r.code, 403, 'a ticket for another plugin is refused');
    const staleDigest = 'a'.repeat(64);
    r = await serve(server, url('ui-only', staleDigest, 'ui/index.html'));
    A.eq(r.code, 410, 'a ticket for code that is not the approved code gets 410');

    // an edit anywhere turns it off at once (the loader re-hashes once its recheck window passes)
    await write('ui-only', 'ui/app.js', 'window.x = 2; /* edited */');
    clockNow += 5000;
    r = await serve(server, url('ui-only', rec.digest, 'ui/index.html'));
    A.eq(r.code, 410, 'EDITED since approval: the open window\'s next request is refused (410)');
    A.eq(await loader.approvedRecord('ui-only'), null, 'and the plugin has no approved record until re-approved');

    // ---- 4. THE PAGE MINTER'S TICKET VERIFIES ON THE SIDECAR ----
    global.window = { __STARNET_API_TOKEN__: KEY, __STARNET_API__: 'http://127.0.0.1:5555', crypto: crypto.webcrypto };
    const realNow = Date.now; Date.now = () => 1.9e12;
    delete require.cache[require.resolve('../frontend/app/apiticket.js')];
    const P = require('../frontend/app/apiticket.js');
    const pu = P.pluginUrl('ui-only', rec.digest, 'ui/index.html');
    Date.now = realNow;
    A.ok(pu.indexOf('http://127.0.0.1:5555/plugin-ui/~t/') === 0, 'pluginUrl is absolute on desktop and ticketed');
    A.ok(pu.indexOf(KEY) < 0, 'pluginUrl never carries the master token');
    const split = T.splitPluginTicket(pu.replace('http://127.0.0.1:5555', ''));
    A.ok(T.verify(KEY, split.ticket, 'plugin', T.scopePlugin('ui-only', rec.digest), { now: 1.9e12 }).ok, 'page-minted plugin ticket verifies');
    A.ok(!T.verify(KEY, split.ticket, 'plugin', T.scopePlugin('ui-only', staleDigest), { now: 1.9e12 }).ok, 'it opens only that digest');
    A.ok(!T.verify(KEY, split.ticket, 'run', T.scopeRun('ui-only', rec.digest), { now: 1.9e12 }).ok, 'it is not a run ticket');
    A.eq(P._test.KINDS.plugin.ttl, T.KINDS.plugin.maxTtlMs, 'page plugin lifetime == server cap');
    A.ok(!T.verify(KEY, split.ticket, 'plugin', T.scopePlugin('ui-only', rec.digest), { now: 1.9e12 + T.KINDS.plugin.maxTtlMs + 1 }).ok, 'it expires');

    // ---- 5. KIT INJECTION SHAPES ----
    A.ok(injectKit('<html><body>x</body></html>', 'index.html').indexOf('<html><head><link rel="stylesheet" href="_starnet/kit.css">') === 0, 'no <head>: one is created inside <html>');
    A.ok(injectKit('<p>bare</p>', 'a/b/c.html').indexOf('href="../../_starnet/kit.css"') >= 0, 'a page two folders deep climbs two levels to the kit');
    A.ok(injectKit('<!DOCTYPE html><p>x</p>', 'p.html').indexOf('<!DOCTYPE html><head>') === 0, 'doctype stays first');

    // ---- 6. THE STARTER TEMPLATE IS A WORKING WINDOWED PLUGIN ----
    const made = await loader.scaffold({ id: 'starter', name: 'My <Starter>', description: 'demo' });
    A.ok(made.ok, 'scaffold writes the starter');
    d = await loader.discover();
    const starter = d.plugins.find(p => p.id === 'starter');
    A.ok(starter && starter.main && starter.screens.length === 1, 'the starter has code AND a window');
    A.eq(starter && starter.screens[0].entry, 'ui/index.html', 'its window is ui/index.html');
    A.eq(starter && starter.screens[0].title, 'MY STARTER', 'markup characters never reach the title');
    const tpl = await fsp.readFile(path.join(PLUGINS, 'starter', 'ui', 'index.html'), 'utf8');
    A.ok(/starnet\.store\.set\('notes'/.test(tpl) && /sn-stats/.test(tpl), 'the starter window uses the kit and the store');
    A.ok(tpl.indexOf('<title>My &lt;Starter&gt;</title>') >= 0, 'the plugin name is escaped into the page');

    // ---- 7. THE PRIVATE STORE IS BOUNDED ----
    const pstore = makePluginStore({ store: makeDurableJsonStore({ fs, path, fileFor: (id) => path.join(DIR, 'data', id + '.json') }) });
    A.ok((await pstore.op('p1', 'set', 'notes', [1, 2])).ok, 'set a value');
    A.eq((await pstore.op('p1', 'get', 'notes')).value, [1, 2], 'get it back');
    A.eq((await pstore.op('p2', 'get', 'notes')).value, null, 'another plugin cannot see it');
    A.eq((await pstore.op('p1', 'keys')).value, ['notes'], 'keys lists it');
    A.ok(!(await pstore.op('p1', 'set', '../x', 1)).ok, 'a path-shaped key is refused');
    A.ok(!(await pstore.op('p1', 'set', 'big', 'x'.repeat(300 * 1024))).ok, 'a value over 256 KB is refused');
    A.ok(!(await pstore.op('p1', 'set', '__proto__', { polluted: true })).ok, '__proto__ is refused as a key');
    A.eq(({}).polluted, undefined, 'and nothing was polluted');
    await pstore.op('p1', 'delete', 'notes');
    A.eq((await pstore.op('p1', 'get', 'notes')).value, null, 'delete removes it');
    A.ok(!(await pstore.op('p1', 'drop', 'notes')).ok, 'an unknown operation is refused');
    const persisted = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'p1.json'), 'utf8'));
    A.eq(persisted, {}, 'the store is on disk (durable), with the deleted key gone');
    // a crew-written DRAFT preview opens no links (an https link it opens on load could carry what the agent embedded)
    const hostSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'pluginhost.js'), 'utf8');
    A.ok(/'ui\.link': \(entry, a\) => \{[\s\S]{0,400}if \(entry\.draft\) throw new Error\('a draft preview cannot open links/.test(hostSrc), 'ui.link refuses a draft preview before it opens anything');
  } finally {
    await fsp.rm(DIR, { recursive: true, force: true });
  }
  A.report ? A.report() : process.exit(0);
})();
