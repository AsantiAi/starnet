/* sidecar/remote/relay-client.js — the station dials OUT to the relay, so phones can reach it from anywhere.

   No port forwarding and no inbound connection: this is an ordinary outgoing TLS WebSocket (Node's built-in
   WebSocket, no package). The relay only switches sealed frames between this station and its paired phones
   (relay/server.js); every phone request still goes through the same sessions → gateway path as the LAN door.

     const rc = makeRelayClient({ url, devices, sessions, gateway, crypto, WebSocketImpl, log, now })
     rc.start() · rc.stop() · rc.info() -> { state, url, rid, since, lastError }
     rc.syncTokens()     after a pairing or revoke: tell the relay which phones may knock
     rc.kickDevice(id)   drop a revoked phone's live connections at the relay

   States (what the desk shows, never guessed): off · connecting · online · offline (with lastError + retry).

   From a phone, over the relay:
     { t:'pair', pairingId, publicKey, name, proof } -> { t:'paired', deviceId, relayToken, fingerprint } | { t:'error' }
     { t:'hello', v, deviceId, eph, nonce }          -> { t:'welcome', welcome } | { t:'error' }
     { t:'call', frame }                             -> { t:'res', frame } | { t:'error' }
     (station push)                                  -> { t:'ev', frame } */
'use strict';

const nodeCrypto = require('crypto');

const LABEL = 'starnet-relay/1';
const PING_MS = 30000;
const PONG_WAIT_MS = 20000;

function makeRelayClient(d) {
  const C = d.crypto, devices = d.devices, sessions = d.sessions, gateway = d.gateway;
  const WS = d.WebSocketImpl || globalThis.WebSocket;
  const now = d.now;
  if (typeof now !== 'function') throw new Error('makeRelayClient needs an injected clock (d.now)');
  const log = d.log || (() => {});
  const url = String(d.url || '').replace(/\/+$/, '');
  let ws = null, state = 'off', rid = null, since = null, lastError = null;
  let retryMs = 1000, retryTimer = null, pingTimer = null, pongTimer = null, stopped = true;
  const conns = new Map();   // conn -> { paired, sid, deviceId, detach }

  function set(s, err) { state = s; since = now(); if (err !== undefined) lastError = err; }
  function send(obj) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (_) {} }
  function toPhone(conn, msg) { send({ t: 'to', conn, msg }); }

  function syncTokens() { if (state === 'online') send({ t: 'tokens', hashes: devices.relayTokenHashes() }); }
  function kickDevice(deviceId) {
    for (const [conn, c] of conns) if (c.deviceId === deviceId) { send({ t: 'kick', conn }); drop(conn); }
    syncTokens();
  }
  function drop(conn) {
    const c = conns.get(conn);
    if (!c) return;
    conns.delete(conn);
    if (c.detach) { try { c.detach(); } catch (_) {} }
    if (c.sid) sessions.end(c.sid);
  }

  async function onPhone(conn, msg) {
    const c = conns.get(conn);
    if (!c || !msg || typeof msg !== 'object') return;
    if (msg.t === 'pair') {
      const r = devices.completePairing(msg);
      if (!r.ok) return toPhone(conn, { t: 'error', error: r.error });
      const tok = devices.issueRelayToken(r.device.id);
      if (!tok.ok) return toPhone(conn, { t: 'error', error: 'paired, but the relay pass could not be saved — pair again from the desk' });
      let st = null; try { st = devices.stationKeys(); } catch (_) {}
      log('paired ' + r.device.name + ' (' + r.device.id + ') over the relay');
      toPhone(conn, { t: 'paired', deviceId: r.device.id, relayToken: tok.token, stationId: st && st.id, fingerprint: r.device.fingerprint });
      syncTokens();
      return;
    }
    if (!c.paired) return toPhone(conn, { t: 'error', error: 'not paired' });
    if (msg.t === 'hello') {
      const r = sessions.hello(msg);
      if (!r.ok) return toPhone(conn, { t: 'error', error: r.error });
      if (c.detach) { try { c.detach(); } catch (_) {} }
      if (c.sid) sessions.end(c.sid);
      c.sid = r.sessionId;
      c.deviceId = String(msg.deviceId || '');
      c.detach = sessions.attachSink(r.sessionId, (frame) => toPhone(conn, { t: 'ev', frame }));
      return toPhone(conn, { t: 'welcome', welcome: r.welcome });
    }
    if (msg.t === 'call') {
      const o = sessions.openRequest(c.sid, msg.frame);
      // the frame's seq is plaintext, so the phone can tell WHICH request failed without the station opening it
      if (!o.ok) return toPhone(conn, { t: 'error', error: o.error, seq: msg.frame && msg.frame.seq });
      const m = o.msg || {};
      const out = await gateway.call(m, { deviceId: o.session.deviceId, sessionId: o.session.id });
      return toPhone(conn, { t: 'res', frame: sessions.sealOut(o.session, Object.assign({ id: m.id == null ? null : m.id }, out), 'res') });
    }
  }

  function onMessage(ev) {
    let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch (_) { return; }
    if (!m) return;
    if (m.t === 'challenge') {
      try {
        const st = devices.stationKeys();
        const sig = nodeCrypto.sign('sha256', Buffer.from(LABEL + '|' + String(m.nonce)), st.privateKey);
        send({ t: 'auth', pub: st.publicRaw, sig: C.b64u(sig) });
      } catch (e) { lastError = 'could not sign the relay challenge: ' + ((e && e.message) || e); }
      return;
    }
    if (m.t === 'ready') { rid = m.rid; retryMs = 1000; set('online', null); log('online at the relay'); syncTokens(); return; }
    if (m.t === 'pong') { if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; } return; }
    if (m.t === 'open') { conns.set(Number(m.conn), { paired: !!m.paired, sid: null, deviceId: '', detach: null }); return; }
    if (m.t === 'gone') { drop(Number(m.conn)); return; }
    if (m.t === 'from') { onPhone(Number(m.conn), m.msg).catch(() => {}); return; }
  }

  function clearTimers() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
  }

  function connect() {
    if (stopped) return;
    if (!url || typeof WS !== 'function') { set('offline', !url ? 'no relay address set' : 'this runtime has no WebSocket'); return; }
    set('connecting');
    let sock;
    try { sock = new WS(url + '/v1/station'); } catch (e) { return fail('could not open the relay connection: ' + ((e && e.message) || e)); }
    ws = sock;
    sock.onmessage = (ev) => { if (ws === sock) onMessage(ev); };
    sock.onopen = () => {
      if (ws !== sock) return;
      clearTimers();
      pingTimer = setInterval(() => {
        send({ t: 'ping' });
        if (!pongTimer) pongTimer = setTimeout(() => { pongTimer = null; try { sock.close(); } catch (_) {} fail('the relay stopped answering'); }, PONG_WAIT_MS);
      }, PING_MS);
    };
    sock.onerror = () => {};
    sock.onclose = (ev) => {
      if (ws !== sock) return;
      fail(state === 'online' ? 'lost the relay connection' : ('the relay refused the connection' + (ev && ev.code ? ' (' + ev.code + (ev.reason ? ' ' + ev.reason : '') + ')' : '')));
    };
  }

  function fail(msg) {
    clearTimers();
    for (const conn of Array.from(conns.keys())) drop(conn);
    ws = null;
    if (stopped) { set('off', null); return; }
    set('offline', msg);
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, retryMs);
    if (retryTimer.unref) retryTimer.unref();
    retryMs = Math.min(retryMs * 2, 60000);
  }

  function start() { if (!stopped) return; stopped = false; retryMs = 1000; connect(); }
  function stop() {
    stopped = true;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    clearTimers();
    for (const conn of Array.from(conns.keys())) drop(conn);
    const s = ws; ws = null;
    if (s) { try { s.close(1000, 'station stopped'); } catch (_) {} }
    set('off', null);
  }
  function info() { return { state, url: url || null, rid, since, lastError, phones: conns.size, retryInMs: state === 'offline' && retryTimer ? retryMs / 2 : null }; }

  return { start, stop, info, syncTokens, kickDevice };
}

module.exports = { makeRelayClient, LABEL };
