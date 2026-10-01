'use strict';
const A = require('./_assert.js');
const http = require('node:http');
const { startPinnedProxy } = require('../sidecar/tools/builtin/browser-proxy.js');
const { _internals } = require('../sidecar/tools/builtin/browser.js');

function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); }
function request(proxyPort, url) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: proxyPort, path: url }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}
function connect(proxyPort, authority) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: authority });
    req.on('connect', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on('response', res => resolve(res.statusCode));
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  let hits = 0;
  const sentinel = http.createServer((req, res) => { hits++; res.end('LOCAL_SENTINEL'); });
  const port = await listen(sentinel);
  const proxy = await startPinnedProxy({ validate: _internals.assertSafeUrl,
    resolve: u => _internals.assertResolvedSafe(u, async () => [{ address: '127.0.0.1', family: 4 }]) });
  try {
    const url = 'http://127.0.0.1:' + port + '/proof';
    const blocked = await request(proxy.port, url);
    A.eq(blocked.status, 403, 'ordinary browser traffic cannot reach loopback through the proxy');
    A.eq(hits, 0, 'blocked request never reaches the local sentinel');
    A.eq(await connect(proxy.port, '127.0.0.1:' + port), 403, 'HTTPS CONNECT to loopback is refused');
    const rebound = await request(proxy.port, 'http://rebind.audit.test:' + port + '/proof');
    A.eq(rebound.status, 403, 'a public hostname resolving to loopback is refused');
    A.eq(hits, 0, 'neither DNS rebinding nor CONNECT reached the sentinel');
    proxy.allowLocal(url);
    const allowed = await request(proxy.port, url);
    A.eq(allowed.status, 200, 'explicit browser.test_navigate origin can reach its local server');
    A.eq(allowed.body, 'LOCAL_SENTINEL', 'local test request reaches only the authorized origin');
  } finally {
    await proxy.close();
    await new Promise(resolve => sentinel.close(resolve));
  }

  /* THE BROWSER CLOSES MID-CONNECT (measured 2026-09-30, gate): Chromium's socket resets while the proxy is still
     resolving DNS for its CONNECT. That reset had no listener yet and ended the whole sidecar with ECONNRESET. */
  {
    const crashes = [];
    const onCrash = e => crashes.push(e);
    process.on('uncaughtException', onCrash);
    let release; const resolving = new Promise(r => { release = r; });
    let asked = 0;
    const slow = await startPinnedProxy({ validate: _internals.assertSafeUrl,
      resolve: async () => { asked++; await resolving; return { address: '93.184.215.14', family: 4 }; } });
    try {
      for (const verb of ['CONNECT example.com:443', 'GET ws://example.com/socket']) {
        const sock = require('node:net').connect(slow.port, '127.0.0.1');
        await new Promise(r => sock.once('connect', r));
        sock.write(verb + ' HTTP/1.1\r\nHost: example.com\r\n' + (/^GET/.test(verb) ? 'Connection: Upgrade\r\nUpgrade: websocket\r\n' : '') + '\r\n');
        await new Promise(r => setTimeout(r, 150));
        sock.on('error', () => {});
        sock.resetAndDestroy();   // a TCP RST, as when the browser process is killed
      }
      await new Promise(r => setTimeout(r, 150));
      release();
      await new Promise(r => setTimeout(r, 300));
      A.ok(asked >= 1, 'the reset arrived while the proxy was still resolving the address');
      A.eq(crashes.map(e => e.code || e.message), [], 'a browser reset mid-CONNECT / mid-upgrade never crashes the sidecar');
      const after = await request(slow.port, 'http://127.0.0.1:1/');
      A.eq(after.status, 403, 'and the proxy keeps serving');
    } finally {
      process.removeListener('uncaughtException', onCrash);
      await slow.close();
    }
  }
  A.report('browser-proxy.test');
})().catch(e => { console.error(e); process.exitCode = 1; });
