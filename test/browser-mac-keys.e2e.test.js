/* node test/browser-mac-keys.e2e.test.js — Mac keyboard in the station browser, on REAL Chromium (2026-10-01).
   On macOS, Chrome runs Cmd+A/C/X/Z and Cmd/Option+arrows in the browser process, which CDP key events never reach;
   the driver names the editing command (`commands`) instead when the station runs on a Mac (macEditingCommands).
   CDP honours `commands` on every platform, so the exact events a Mac sends are proven here against a live page:
   typing, Cmd+A selects all, Cmd+X cuts, Cmd+Z undoes, Option+Left moves by word, and an Option-composed
   character (Option+L = @ on a German Mac) is typed as text. */
'use strict';
const A = require('./_assert.js');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { _internals: T } = require('../sidecar/tools/builtin/browser.js');

(async () => {
  if (!T.findChrome()) { console.log('browser-mac-keys: no Chromium on this box — skipped'); A.report('browser-mac-keys.e2e'); return; }
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><body><input id="f" style="font-size:20px;width:600px"></body>'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-mac-keys-'));
  const d = T.makeCdpDriver({ forceHeadless: true, syntheticInputOnly: true, cdpPort: 0, profileDir: dir, timeoutMs: 20000, platform: 'darwin' });
  d.allowLocal(base);
  const ALT = 1, META = 4, SHIFT = 8;
  const key = (k, modifiers, text) => d.humanInput(Object.assign({ type: 'key', action: 'down', key: k, code: '', keyCode: 0, modifiers: modifiers || 0 }, text ? { text } : {}))
    .then(() => d.humanInput({ type: 'key', action: 'up', key: k, code: '', keyCode: 0, modifiers: modifiers || 0 }));
  const field = () => d.testEval('(()=>{const f=document.getElementById("f");return {v:f.value,s:f.selectionStart,e:f.selectionEnd}})()');
  try {
    await d.navigate(base);
    await d.testEval('document.getElementById("f").focus(), 1');
    for (const ch of 'hello world') await key(ch, 0, ch);
    A.eq((await field()).v, 'hello world', 'typing reaches the page');
    await key('a', META);
    let f = await field();
    A.ok(f.s === 0 && f.e === 11, 'Cmd+A selects all (' + f.s + '-' + f.e + ')');
    await key('x', META);
    A.eq((await field()).v, '', 'Cmd+X cuts it');
    await key('z', META);
    A.eq((await field()).v, 'hello world', 'Cmd+Z undoes the cut');
    await d.testEval('(()=>{const f=document.getElementById("f");f.setSelectionRange(11,11);return 1})()');
    await key('ArrowLeft', ALT);
    f = await field();
    A.eq(f.s, 6, 'Option+Left moves back one word (caret at ' + f.s + ')');
    await key('ArrowLeft', META | SHIFT);
    f = await field();
    A.ok(f.s === 0 && f.e === 6, 'Cmd+Shift+Left selects to the start of the line (' + f.s + '-' + f.e + ')');
    await d.testEval('(()=>{const f=document.getElementById("f");f.setSelectionRange(11,11);return 1})()');
    await key('@', ALT, '@');   // what the BROWSER window sends for Option+L on a German Mac (modifiers stripped to 0 there; ALT kept here to prove it still types)
    A.eq((await field()).v, 'hello world@', 'an Option-composed character is typed as text');
  } finally {
    try { await d.close(); } catch (_) { /* best effort */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    server.close();
  }
  A.report('browser-mac-keys.e2e');
})().catch(e => { console.log('FAIL: browser-mac-keys.e2e threw — ' + (e && e.stack || e)); process.exit(1); });
