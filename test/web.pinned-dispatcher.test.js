/* node test/web.pinned-dispatcher.test.js — web_request / web_fetch's DNS-pinned socket against REAL Node sockets.

   Every other web test passes lookup:null, which skips the pinned dispatcher entirely — so nothing ever drove
   fetchPinned's connect.lookup through real undici + net.connect. Node 20+ connects with autoSelectFamily on,
   which calls the lookup with { all: true } and expects an ARRAY of {address, family}. The pin answered with
   (address, family) regardless, Node read `undefined` as the address list, and EVERY pinned request died as
   "fetch failed" (cause: ERR_INVALID_IP_ADDRESS "Invalid IP address: undefined") — a user report on 0.12.5 and
   0.13.0: web_request to https://www.google.com/ failed while curl/fetch from the same machine got 200. */
'use strict';
const A = require('./_assert.js');
const http = require('node:http');
const undici = require('undici');
const { makeWebTools } = require('../sidecar/tools/builtin/web.js');

const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2606:2800:220:1:248:1893:25c8:1946';

(async () => {
  // 1) the pinned lookup answers BOTH callback shapes, and only with validated addresses
  let made = null;
  const shapes = makeWebTools({
    lookup: async () => [{ address: PUBLIC_V6, family: 6 }, { address: PUBLIC_V4, family: 4 }],
    agentFactory: opts => { made = opts; return { close: async () => {} }; },
    fetchImpl: async () => ({ status: 200, headers: new Map(), body: null, text: async () => 'x' })
  }).requestTool;
  try { await shapes.run({ url: 'https://api.shapes.example/x' }, {}); } catch (_) { /* the fake response is not the point */ }
  A.ok(made && made.connect && typeof made.connect.lookup === 'function', 'a pinned dispatcher was built for a named host');
  let single = null, all = null;
  made.connect.lookup('api.shapes.example', {}, (err, addr, fam) => { single = { err, addr, fam }; });
  made.connect.lookup('api.shapes.example', { all: true }, (err, list) => { all = { err, list }; });
  A.eq(single, { err: null, addr: PUBLIC_V6, fam: 6 }, 'single-address lookup returns the first validated address');
  A.eq(all, { err: null, list: [{ address: PUBLIC_V6, family: 6 }, { address: PUBLIC_V4, family: 4 }] },
    'all:true (Node autoSelectFamily) gets an ARRAY of every validated address, so a v6-less network still reaches v4');

  // 2) REAL undici + REAL net.connect: the request lands and returns 200. The agentFactory wraps the pin only
  //    to swap the public test address for this loopback listener — it passes the pin's callback SHAPE through
  //    untouched, which is exactly what Node validates.
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('pinned ok ' + req.headers.host); });
  await new Promise(res => srv.listen(0, '127.0.0.1', res));
  const port = srv.address().port;
  const toLoop = a => (a === PUBLIC_V4 ? '127.0.0.1' : a);
  let lookupCalls = 0;
  const real = makeWebTools({
    lookup: async () => [{ address: PUBLIC_V4, family: 4 }],
    agentFactory: opts => new undici.Agent({ connect: { lookup(h, o, cb) {
      lookupCalls++;
      opts.connect.lookup(h, o, (err, a, f) => {
        if (err) return cb(err);
        if (Array.isArray(a)) cb(null, a.map(x => ({ address: toLoop(x.address), family: x.family })));
        else cb(null, toLoop(a), f);
      });
    } } })
  });
  let out = null, failure = null;
  try { out = await real.requestTool.run({ url: 'http://api.pinned.example:' + port + '/ping' }, {}); }
  catch (e) { failure = (e && e.message) + (e && e.cause ? ' (cause: ' + (e.cause.code || '') + ' ' + e.cause.message + ')' : ''); }
  srv.close();
  A.eq(failure, null, 'a pinned web_request over real sockets does not fail');
  A.ok(out && /200$/.test(out.summary), 'web_request reports HTTP 200 (got ' + (out && out.summary) + ')');
  A.ok(out && /pinned ok api\.pinned\.example:/.test(String(out.content)), 'the body arrived and the Host header kept the requested name');
  A.ok(lookupCalls >= 1, 'the connection went through the pinned lookup');

  // 3) a transport failure names its cause (code + host), not undici's bare "fetch failed" — and never the URL,
  //    which can carry an auth.in:"query" key
  const failing = makeWebTools({
    lookup: async () => [{ address: PUBLIC_V4, family: 4 }],
    agentFactory: () => ({ close: async () => {} }),
    fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED ' + PUBLIC_V4 + ':443 https://api.down.example/?k=SECRET'), { code: 'ECONNREFUSED', address: PUBLIC_V4 }) }); }
  }).requestTool;
  let msg = '';
  try { await failing.run({ url: 'https://api.down.example/x' }, {}); } catch (e) { msg = e.message; }
  A.eq(msg, 'fetch failed (ECONNREFUSED ' + PUBLIC_V4 + ')', 'the error names the transport cause');

  A.report('web.pinned-dispatcher.test');
})().catch(e => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });
