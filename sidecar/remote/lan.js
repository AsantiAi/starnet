/* sidecar/remote/lan.js — the phone's door on your home network (phase 1 transport; the relay comes later).

   A SEPARATE listener from the main sidecar. The main one stays pinned to 127.0.0.1 with its host/origin/token
   fence exactly as it is; this one binds the LAN only while Remote is switched on, and it speaks nothing but
   the remote protocol:

     POST /remote/v1/pair    { pairingId, publicKey, name, proof }  -> { ok, deviceId, stationId }
     POST /remote/v1/hello   { v, deviceId, eph, nonce }            -> welcome
     POST /remote/v1/call    { sessionId, frame }                   -> { frame }   (sealed request -> sealed reply)
     GET  /remote/v1/events?sid=<sessionId>                         -> text/event-stream of sealed frames
     GET  /remote/v1/info                                           -> { ok, v, stationId }  (no secrets)

   Nothing here can reach the master API token, any /api route, or the file system. Every request body is
   size-capped; pairing and hello are rate-limited per address. The master sidecar port never opens to the LAN. */
'use strict';

const http = require('http');

const MAX_BODY = 64 * 1024;

function makeRateLimit(limit, windowMs, now) {
  const hits = new Map();
  return function allow(key) {
    const t = now();
    let h = hits.get(key);
    if (!h || t - h.start > windowMs) { h = { start: t, n: 0 }; hits.set(key, h); }
    h.n += 1;
    if (hits.size > 2048) for (const [k, v] of hits) if (t - v.start > windowMs) hits.delete(k);
    return h.n <= limit;
  };
}

function makeLanListener(deps) {
  const sessions = deps.sessions, devices = deps.devices, gateway = deps.gateway, C = deps.crypto;
  const now = deps.now;
  if (typeof now !== 'function') throw new Error('makeLanListener needs an injected clock (deps.now)');
  const log = deps.log || (() => {});
  const extraRoute = typeof deps.extraRoute === 'function' ? deps.extraRoute : null;   // phase 2: the phone app's static files
  const allowPair = makeRateLimit(10, 10 * 60 * 1000, now);
  const allowHello = makeRateLimit(60, 60 * 1000, now);
  let server = null, bound = null;

  function send(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(body);
  }
  function readJson(req) {
    return new Promise((resolve) => {
      let size = 0; const parts = []; let done = false;
      req.on('data', (d) => { if (done) return; size += d.length; if (size > MAX_BODY) { done = true; resolve({ tooBig: true }); try { req.destroy(); } catch (_) {} return; } parts.push(d); });
      req.on('end', () => { if (done) return; done = true; try { resolve({ value: JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') }); } catch (_) { resolve({ bad: true }); } });
      req.on('error', () => { if (!done) { done = true; resolve({ bad: true }); } });
    });
  }
  const addrOf = (req) => String((req.socket && req.socket.remoteAddress) || '');

  async function handle(req, res) {
    const u = new URL(req.url, 'http://lan');
    const p = u.pathname;
    if (req.method === 'GET' && p === '/remote/v1/info') {
      let stationId = null; try { stationId = devices.stationKeys().id; } catch (_) {}
      return send(res, 200, { ok: true, v: C.VERSION, stationId });
    }
    if (req.method === 'POST' && p === '/remote/v1/pair') {
      if (!allowPair(addrOf(req))) return send(res, 429, { ok: false, error: 'too many pairing attempts — wait a few minutes' });
      const b = await readJson(req);
      if (!b.value) return send(res, 400, { ok: false, error: 'bad request' });
      const r = devices.completePairing(b.value);
      if (!r.ok) return send(res, 400, { ok: false, error: r.error });
      let st = null; try { st = devices.stationKeys(); } catch (_) {}
      const tok = typeof devices.issueRelayToken === 'function' ? devices.issueRelayToken(r.device.id) : { ok: false };
      if (typeof deps.onPaired === 'function') { try { deps.onPaired(r.device); } catch (_) {} }
      log('paired ' + r.device.name + ' (' + r.device.id + ')');
      return send(res, 200, { ok: true, deviceId: r.device.id, stationId: st && st.id, fingerprint: r.device.fingerprint, relayToken: tok.ok ? tok.token : null });
    }
    if (req.method === 'POST' && p === '/remote/v1/hello') {
      if (!allowHello(addrOf(req))) return send(res, 429, { ok: false, error: 'slow down' });
      const b = await readJson(req);
      if (!b.value) return send(res, 400, { ok: false, error: 'bad request' });
      const r = sessions.hello(b.value);
      if (!r.ok) return send(res, 403, { ok: false, error: r.error });
      return send(res, 200, { ok: true, welcome: r.welcome });
    }
    if (req.method === 'POST' && p === '/remote/v1/call') {
      const b = await readJson(req);
      if (b.tooBig) return send(res, 413, { ok: false, error: 'request too large' });
      if (!b.value) return send(res, 400, { ok: false, error: 'bad request' });
      const o = sessions.openRequest(b.value.sessionId, b.value.frame);
      if (!o.ok) return send(res, o.error === 'no session' ? 401 : 400, { ok: false, error: o.error });
      const msg = o.msg || {};
      const out = await gateway.call(msg, { deviceId: o.session.deviceId, sessionId: o.session.id });
      const reply = Object.assign({ id: msg.id == null ? null : msg.id }, out);
      return send(res, 200, { ok: true, frame: sessions.sealOut(o.session, reply, 'res') });
    }
    if (req.method === 'GET' && p === '/remote/v1/events') {
      const sid = u.searchParams.get('sid') || '';
      const s = sessions.get(sid);
      if (!s) return send(res, 401, { ok: false, error: 'no session' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
      res.write(': open\n\n');
      const detach = sessions.attachSink(sid, (frame) => { res.write('data: ' + JSON.stringify(frame) + '\n\n'); });
      // keepalive: a bare comment carries no content, and it keeps the session from idling out while watched
      const ka = setInterval(() => { try { res.write(': k\n\n'); sessions.keep(sid); } catch (_) {} }, 20000);
      const close = () => { clearInterval(ka); if (detach) detach(); };
      res.on('close', close);
      return;
    }
    if (extraRoute) { try { if (await extraRoute(req, res, u)) return; } catch (_) {} }
    send(res, 404, { ok: false, error: 'not found' });
  }

  function start(o) {
    if (server) return Promise.resolve(bound);
    const host = (o && o.host) || '0.0.0.0';
    const port = Number(o && o.port) || 0;
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => { handle(req, res).catch(() => { try { send(res, 500, { ok: false, error: 'station error' }); } catch (_) {} }); });
      s.headersTimeout = 15000;
      s.requestTimeout = 30000;
      s.on('error', (e) => { if (!bound) reject(e); else log('listener error: ' + ((e && e.message) || e)); });
      s.listen(port, host, () => { server = s; bound = { host, port: s.address().port }; resolve(bound); });
    });
  }
  function stop() {
    if (!server) return Promise.resolve();
    const s = server; server = null; bound = null;
    return new Promise((resolve) => { try { s.closeAllConnections && s.closeAllConnections(); } catch (_) {} s.close(() => resolve()); });
  }
  function info() { return bound ? Object.assign({ listening: true }, bound) : { listening: false }; }

  return { start, stop, info, _handle: handle };
}

module.exports = { makeLanListener, makeRateLimit };
