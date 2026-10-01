'use strict';
// A computer with no Chrome / Edge / Chromium gets Chrome for Testing downloaded once (sidecar/browser-install.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./_assert.js');
const { makeChromiumInstaller, platformKey, exeInside } = require('../sidecar/browser-install.js');

function fakeFetch(key, opts) {
  opts = opts || {};
  const calls = [];
  const zipBytes = Buffer.alloc(3000, 7);
  const fn = async url => {
    calls.push(url);
    if (/last-known-good/.test(url)) {
      return { ok: true, status: 200, json: async () => ({ channels: { Stable: { version: '150.0.1.2', downloads: { chrome: [{ platform: key, url: opts.url || ('https://storage.googleapis.com/chrome-for-testing-public/150.0.1.2/' + key + '/chrome-' + key + '.zip') }] } } } }) };
    }
    const body = (async function* () { yield zipBytes.subarray(0, 1000); yield zipBytes.subarray(1000, opts.short ? 2000 : 3000); })();
    return { ok: true, status: 200, headers: { get: h => (h === 'content-length' ? '3000' : null) }, body };
  };
  fn.calls = calls;
  return fn;
}
const fakeUnzip = key => async (zip, dest) => {
  const exe = path.join(dest, exeInside(key));
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, 'chrome');
};

(async () => {
  A.eq(platformKey('win32', 'x64'), 'win64', 'Windows 64-bit');
  A.eq(platformKey('darwin', 'arm64'), 'mac-arm64', 'Apple silicon');
  A.eq(platformKey('darwin', 'x64'), 'mac-x64', 'Intel Mac');
  A.eq(platformKey('linux', 'x64'), 'linux64', 'Linux x64');
  A.eq(platformKey('linux', 'arm64'), 'linux-arm64', 'Linux ARM (Google lists a build now)');
  A.eq(exeInside('linux-arm64').split(path.sep).join('/'), 'chrome-linux-arm64/chrome', '…and the browser sits where the zip has it (checked against the real zip 2026-10-01)');
  A.eq(platformKey('freebsd', 'x64'), null, 'a system with no Chrome for Testing build: none offered');

  for (const [plat, arch] of [['win32', 'x64'], ['darwin', 'arm64'], ['linux', 'x64']]) {
    const key = platformKey(plat, arch);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-binstall-'));
    const f = fakeFetch(key);
    const inst = makeChromiumInstaller({ root, fetchImpl: f, platform: plat, arch, unzip: fakeUnzip(key) });
    A.eq(inst.find(), null, key + ': nothing downloaded yet');
    const [p1, p2] = await Promise.all([inst.ensure(), inst.ensure()]);
    A.eq(p1, p2, key + ': two callers share one download');
    A.eq(f.calls.filter(u => /\.zip$/.test(u)).length, 1, key + ': the zip is fetched once (single-flight)');
    A.ok(p1.endsWith(exeInside(key)) && fs.existsSync(p1), key + ': the browser is in place');
    A.eq(inst.find(), p1, key + ': and is found again');
    A.eq(inst.status().state, 'ready', key + ': status says ready');
    A.ok(!fs.readdirSync(root).some(n => /^download-|^unpack-/.test(n)), key + ': no partial files left behind');
    await inst.ensure();
    A.eq(f.calls.length, 2, key + ': a later ensure downloads nothing');
    fs.rmSync(root, { recursive: true, force: true });
  }

  // a cut-short download is never unpacked or launched
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-binstall-'));
    const inst = makeChromiumInstaller({ root, fetchImpl: fakeFetch('win64', { short: true }), platform: 'win32', arch: 'x64', unzip: fakeUnzip('win64') });
    let err = null; try { await inst.ensure(); } catch (e) { err = e; }
    A.ok(err && /cut short/.test(err.message), 'a short download fails loudly');
    A.eq(inst.find(), null, '…and nothing is installed');
    A.ok(inst.status().state === 'failed' && /cut short/.test(inst.status().error), 'status carries the reason for the window');
    fs.rmSync(root, { recursive: true, force: true });
  }
  // a download from anywhere but Google's host is refused
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-binstall-'));
    const inst = makeChromiumInstaller({ root, fetchImpl: fakeFetch('win64', { url: 'https://evil.example/chrome.zip' }), platform: 'win32', arch: 'x64', unzip: fakeUnzip('win64') });
    let err = null; try { await inst.ensure(); } catch (e) { err = e; }
    A.ok(err && /refusing a browser download from evil\.example/.test(err.message), 'only storage.googleapis.com is trusted');
    fs.rmSync(root, { recursive: true, force: true });
  }
  // a failed download leaves nothing behind, and is not retried on every browser call
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-binstall-'));
    let t = 1000; const f = fakeFetch('win64', { short: true });
    const inst = makeChromiumInstaller({ root, fetchImpl: f, platform: 'win32', arch: 'x64', unzip: fakeUnzip('win64'), now: () => t, retryAfterMs: 60000 });
    let e1 = null; try { await inst.ensure(); } catch (e) { e1 = e; }
    A.ok(e1 && /cut short/.test(e1.message), 'the first attempt fails');
    A.ok(!fs.readdirSync(root).some(n => /^download-|^unpack-/.test(n)), 'its partial download is removed');
    const zips = () => f.calls.filter(u => /\.zip$/.test(u)).length;
    t += 1000;
    let e2 = null; try { await inst.ensure(); } catch (e) { e2 = e; }
    A.ok(e2 && /retried in a few minutes/.test(e2.message), 'a call right after the failure does not download again');
    A.eq(zips(), 1, '…no second 150 MB download');
    t += 60000;
    try { await inst.ensure(); } catch (_) { /* still short */ }
    A.eq(zips(), 2, 'after the wait it tries again');
    fs.rmSync(root, { recursive: true, force: true });
  }
  // LINUX + the downloaded browser + restricted user namespaces (Ubuntu 23.10+): --no-sandbox, and ONLY then
  {
    const T2 = require('../sidecar/tools/builtin/browser.js')._internals;
    const own = '/home/u/.starnet/.browsers/150/chrome-linux64/chrome';
    const restricted = () => '1\n', open = () => '0\n', missing = () => { throw new Error('ENOENT'); };
    A.eq(T2.needsNoSandbox({ platform: 'linux', chromePath: own, ownChrome: own, readFile: restricted }), true, 'downloaded browser on restricted Linux: no sandbox (it cannot start otherwise)');
    A.eq(T2.needsNoSandbox({ platform: 'linux', chromePath: own, ownChrome: own, readFile: open }), false, 'unrestricted Linux keeps the sandbox');
    A.eq(T2.needsNoSandbox({ platform: 'linux', chromePath: own, ownChrome: own, readFile: missing }), false, 'no such setting keeps the sandbox');
    A.eq(T2.needsNoSandbox({ platform: 'linux', chromePath: '/usr/bin/google-chrome', ownChrome: own, readFile: restricted }), false, 'an INSTALLED Chrome always keeps its sandbox');
    A.eq(T2.needsNoSandbox({ platform: 'darwin', chromePath: own, ownChrome: own, readFile: restricted }), false, 'never on macOS');
    A.eq(T2.needsNoSandbox({ platform: 'win32', chromePath: own, ownChrome: own, readFile: restricted }), false, 'never on Windows');
  }
  // unpacked but the browser is missing: not installed
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-binstall-'));
    const inst = makeChromiumInstaller({ root, fetchImpl: fakeFetch('win64'), platform: 'win32', arch: 'x64', unzip: async () => {} });
    let err = null; try { await inst.ensure(); } catch (e) { err = e; }
    A.ok(err && /incomplete/.test(err.message) && inst.find() === null, 'an incomplete unpack is refused');
    fs.rmSync(root, { recursive: true, force: true });
  }
  // no build for this computer
  {
    const inst = makeChromiumInstaller({ root: path.join(os.tmpdir(), 'sn-none'), fetchImpl: fakeFetch('x'), platform: 'freebsd', arch: 'x64' });
    let err = null; try { await inst.ensure(); } catch (e) { err = e; }
    A.ok(err && /install Chrome, Edge or Chromium/.test(err.message), 'no build → tells the user what to install');
  }

  // THE DRIVER: no browser installed → it waits for the download, then launches what was downloaded
  {
    const T = require('../sidecar/tools/builtin/browser.js')._internals;
    let asked = 0; const spawned = [];
    const d = T.makeCdpDriver({
      existsSync: () => false, chrome: null, env: {},
      ensureChromium: async () => { asked++; return 'C:/sn/.browsers/150/chrome-win64/chrome.exe'; },
      spawn: (bin) => { spawned.push(bin); throw new Error('stop here'); },
      fetchImpl: async () => { throw new Error('no'); }, WebSocketImpl: function () {}
    });
    let err = null; try { await d.tabs(); } catch (e) { err = e; }
    A.eq(asked, 1, 'a driver with no browser asks for the download');
    A.eq(spawned[0], 'C:/sn/.browsers/150/chrome-win64/chrome.exe', '…and launches the downloaded browser');
    let refused = null; try { T.makeCdpDriver({ existsSync: () => false, env: {}, fetchImpl: async () => {}, WebSocketImpl: function () {} }); } catch (e) { refused = e; }
    A.ok(refused && /Chromium not found/.test(refused.message), 'without a downloader it still refuses honestly');
    // resolveChrome falls back to the downloaded browser only when nothing is installed
    T.setExtraChrome(() => 'C:/sn/own/chrome.exe');
    A.eq(T.resolveChrome(true, p => p === 'C:/sn/own/chrome.exe').path, 'C:/sn/own/chrome.exe', 'nothing installed → the downloaded browser');
    const inst = T.CHROME_CANDIDATES.find(c => !c.headless && !/ms-playwright/.test(c.path));
    A.eq(T.resolveChrome(true, p => p === 'C:/sn/own/chrome.exe' || p === inst.path).path, inst.path, 'an installed browser always wins');
    T.setExtraChrome(null);
  }
  A.report("browser-install.test");
})().catch(e => { console.error(e); process.exit(1); });
