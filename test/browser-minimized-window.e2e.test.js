/* node test/browser-minimized-window.e2e.test.js — the in-app picture stays alive when the station's Chrome WINDOW is
   minimized (Andrew 2026-10-02: "I can't interact with the browser whatsoever from the built in browser, I have to
   manually 'show window' and then I can control it"). Real headed Chromium: open the station window, start the in-app
   picture, MINIMIZE the window (what a user does to get it out of the way), then click and type through the in-app
   path. Before the fix the page was hidden and the picture sat at 0 frames/s while typing — a frozen mirror. Now the
   window is put back to normal (behind the active app) and the picture updates as you type. */
'use strict';
const A = require('./_assert.js');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { _internals: T } = require('../sidecar/tools/builtin/browser.js');

async function cdpTo(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  return { send: (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }), close: () => ws.close() };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const full = T.resolveChrome(true);
  if (!full || full.headless || T.headlessRequested(process.env) || (process.platform === 'linux' && !process.env.DISPLAY)) {
    console.log('browser-minimized-window: no visible Chrome on this box — skipped'); A.report('browser-minimized-window.e2e'); return;
  }
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<!doctype html><body style="margin:0"><input id="f" style="position:absolute;left:50px;top:50px;width:400px;height:40px;font-size:20px"></body>'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-minimized-'));
  const d = T.makeCdpDriver({ chrome: full.path, headed: true, syntheticInputOnly: true, cdpPort: 0, profileDir: dir, timeoutMs: 20000, env: {} });
  d.allowLocal(base);
  let browser = null;
  try {
    await d.navigate(base);
    // a second, plain CDP connection plays the user: it minimizes the window
    const port = await d.testEval('0').then(() => null);
    void port;
    const portFile = fs.readdirSync(dir).includes('DevToolsActivePort') ? fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim() : null;
    const cdpPort = portFile || (await (async () => {
      const out = require('node:child_process').execFileSync(process.platform === 'win32' ? 'powershell' : 'ps',
        process.platform === 'win32' ? ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match '" + path.basename(dir) + "' -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.CommandLine }"] : ['-axww', '-o', 'command='],
        { encoding: 'utf8' });
      const line = out.split('\n').find(l => l.indexOf(path.basename(dir)) >= 0 && l.indexOf('--type=') < 0) || out;
      return (/--remote-debugging-port=(\d+)/.exec(line) || [])[1];
    })());
    const ver = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/version')).json();
    const tid = (await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json()).find(t => t.type === 'page').id;
    browser = await cdpTo(ver.webSocketDebuggerUrl);
    const { windowId } = (await browser.send('Browser.getWindowForTarget', { targetId: tid })).result;
    const winState = async () => (await browser.send('Browser.getWindowBounds', { windowId })).result.bounds.windowState;

    let frames = 0;
    await d.streamStart(() => { frames++; });
    await browser.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    await sleep(500);
    A.eq(await winState(), 'minimized', 'the user minimized the station window');
    // they click into the in-app picture and type
    await d.humanInput({ type: 'mouse', action: 'down', x: 250, y: 70, button: 'left', clickCount: 1 });
    await d.humanInput({ type: 'mouse', action: 'up', x: 250, y: 70, button: 'left', clickCount: 1 });
    await sleep(600);
    A.eq(await winState(), 'normal', 'clicking into the in-app picture puts the window back to normal (it renders again)');
    frames = 0;
    for (const ch of 'hello') { await d.humanInput({ type: 'key', action: 'down', key: ch, code: 'Key' + ch.toUpperCase(), keyCode: ch.toUpperCase().charCodeAt(0), text: ch, modifiers: 0 }); await d.humanInput({ type: 'key', action: 'up', key: ch, code: 'Key' + ch.toUpperCase(), keyCode: ch.toUpperCase().charCodeAt(0), modifiers: 0 }); await sleep(100); }
    await sleep(700);
    A.ok(frames >= 2, 'the in-app picture updates while you type (' + frames + ' frames for 5 keys; a minimized window gave 0)');
    A.eq(await d.testEval('document.getElementById("f").value'), 'hello', 'and the typing landed');
    // minimized WHILE the picture is being watched: the stream's own watch restores it within a few seconds
    await browser.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    let back = false;
    for (let i = 0; i < 12 && !back; i++) { await sleep(500); back = (await winState()) === 'normal'; }
    A.ok(back, 'minimized while the in-app picture is open: it comes back by itself');
    await d.streamStop();
  } finally {
    try { if (browser) browser.close(); } catch (_) { /* best effort */ }
    try { await d.close(); } catch (_) { /* best effort */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    server.close();
  }
  A.report('browser-minimized-window.e2e');
})().catch(e => { console.log('FAIL: browser-minimized-window.e2e threw — ' + (e && e.stack || e)); process.exit(1); });
