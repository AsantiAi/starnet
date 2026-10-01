/* node test/browser-screencast-restart.e2e.test.js — the fast picture (Chrome screencast) survives a restart.
   Release review 2026-09-30: the screencast frame listener is attached once per connection but compared every frame
   against the generation captured at the FIRST start, so after the BROWSER window was closed and reopened (or a second
   STEP-IN), every screencast frame was dropped and the view fell back to the slow capture loop — the "SUPER laggy"
   picture came back. Real headless Chromium against a local animated page: start → stop → start → start, and every
   start must deliver screencast-rate frames (the capture loop tops out far lower and is detected by its failNote). */
'use strict';
const A = require('./_assert.js');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { _internals: T } = require('../sidecar/tools/builtin/browser.js');

const failNotes = [];
const origErr = console.error;
console.error = (...a) => { const t = a.join(' '); if (/cast-fallback/.test(t)) failNotes.push(t); origErr(...a); };

(async () => {
  if (!T.findChrome()) { console.log('browser-screencast-restart: no Chromium on this box — skipped'); A.report('browser-screencast-restart.e2e'); return; }
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><body style="margin:0;background:#111"><div id=b style="width:120px;height:120px;background:#e33;position:absolute;top:60px;animation:m .8s linear infinite alternate"></div><style>@keyframes m{from{left:0}to{left:600px}}</style>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-cast-restart-'));
  const d = T.makeCdpDriver({ forceHeadless: true, syntheticInputOnly: true, cdpPort: 0, profileDir: dir, timeoutMs: 20000 });
  d.allowLocal(base);
  try {
    await d.navigate(base);
    const rates = [];
    for (let round = 0; round < 3; round++) {
      let n = 0;
      await d.streamStart(() => { n++; });
      await new Promise(r => setTimeout(r, 2500));
      rates.push(n / 2.5);
      await d.streamStop();
    }
    console.log('   frames/s per start:', rates.map(r => r.toFixed(1)).join(', '));
    A.ok(rates[0] >= 15, 'the first start streams fast (' + rates[0].toFixed(1) + '/s)');
    A.ok(rates[1] >= 15, 'a RESTARTED stream is still fast, not the capture loop (' + rates[1].toFixed(1) + '/s)');
    A.ok(rates[2] >= 15, '…and the third (' + rates[2].toFixed(1) + '/s)');
    A.eq(failNotes.length, 0, 'no start fell back to the capture loop');
  } finally {
    try { await d.close(); } catch (_) { /* best effort */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    server.close();
    console.error = origErr;
  }
  A.report('browser-screencast-restart.e2e');
})().catch(e => { console.log('FAIL: browser-screencast-restart.e2e threw — ' + (e && e.stack || e)); process.exit(1); });
