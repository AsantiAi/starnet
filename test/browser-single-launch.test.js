/* node test/browser-single-launch.test.js — concurrent callers share ONE Chromium launch.
   Measured 2026-09-30: the BROWSER window's picture poll and a navigation (or its warm-up and a typed address) both
   reached the CDP driver's connect() before either finished; each spawned its own Chromium on the same profile, the
   second handed off to the first and exited ("spawned Chromium exited before CDP ownership"), and every retry then
   collided with the browser we had started. Fake spawn/fetch/WebSocket: counts launches. */
'use strict';
const A = require('./_assert.js');
const { _internals: T } = require('../sidecar/tools/builtin/browser.js');
const os = require('os'), path = require('path'), fs = require('fs');

function fakeWsClass() {
  return class FakeWs {
    constructor() { this.ls = {}; setTimeout(() => this.emit('open'), 5); }
    addEventListener(ev, fn) { (this.ls[ev] = this.ls[ev] || []).push(fn); }
    emit(ev, arg) { (this.ls[ev] || []).slice().forEach(fn => fn(arg)); }
    send(raw) {
      const m = JSON.parse(raw);
      let result = {};
      if (m.method === 'Runtime.evaluate') result = { result: { type: 'object', value: { url: 'about:blank', title: '' } } };
      if (m.method === 'Page.getFrameTree') result = { frameTree: { frame: { id: 'F1' } } };
      if (m.method === 'Browser.getVersion') result = { product: 'Chrome/149.0.0.0', userAgent: 'Mozilla/5.0 Chrome/149.0.0.0' };
      setTimeout(() => this.emit('message', { data: JSON.stringify({ id: m.id, result }) }), 1);
    }
    close() { this.emit('close'); }
  };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'single-launch-'));
  let spawns = 0;
  const spawn = () => { spawns++; return { pid: 999999, on: () => {}, kill: () => {} }; };
  const fetchImpl = async url => ({ ok: true, json: async () => (/json\/version/.test(url) ? {} : [{ type: 'page', webSocketDebuggerUrl: 'ws://fake/page' }]) });
  const d = T.makeCdpDriver({ spawn, fetchImpl, WebSocketImpl: fakeWsClass(), chrome: 'fake-chrome', profileDir: dir, cdpPort: 9555,
    adoptPopups: false, syntheticInputOnly: false, networkProxy: false, timeoutMs: 400, lookup: null });
  const results = await Promise.allSettled([d.tabs(), d.tabs(), d.pageInfo()]);
  A.eq(spawns, 1, 'three concurrent callers → exactly ONE Chromium launch');
  A.ok(results.every(r => r.status === 'fulfilled'), 'and every caller got its answer: ' + results.map(r => r.status === 'fulfilled' ? 'ok' : String(r.reason && r.reason.message).slice(0, 80)).join(' | '));
  await d.tabs();
  A.eq(spawns, 1, 'a later call reuses the connected browser');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  A.report('browser-single-launch.test');
})().catch(e => { console.log('FAIL: browser-single-launch.test threw - ' + (e && e.stack || e)); process.exit(1); });
