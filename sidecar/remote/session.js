/* sidecar/remote/session.js — one live, authenticated phone connection.

   Transport-agnostic: the LAN listener (phase 1) and the relay socket (phase 3) both hand this module the
   same three things — a hello, sealed request frames, and a way to push sealed frames back. Nothing here
   knows about HTTP or WebSockets.

     const sessions = makeSessions({ devices, crypto, now, newId, ttlMs })
     sessions.hello(hello)            -> { ok, sessionId, welcome } | { ok:false, error }
     sessions.openRequest(sid, frame) -> { ok, session, msg }       | { ok:false, error }   (p2s, seq must rise)
     sessions.sealOut(session, obj)   -> frame                                            (s2p, seq rises)
     sessions.get(sid) / end(sid) / endDevice(deviceId) / sweep()

   Laws:
     · A hello for a device that isn't paired (or was revoked) gets NO welcome. The station never derives keys
       for a stranger, so there is nothing to probe.
     · Every inbound seq must be strictly greater than the last one on that session: a replayed or reordered
       frame is refused, not processed twice.
     · A session carries its device id; revoking the device ends every session it has, immediately.
     · Idle sessions expire (default 10 min without a frame). The phone simply says hello again. */
'use strict';

function makeSessions(deps) {
  const devices = deps.devices;
  const C = deps.crypto;
  const now = deps.now || (() => Date.now());
  const newId = deps.newId;
  const ttlMs = deps.ttlMs || 10 * 60 * 1000;
  const maxSessions = deps.maxSessions || 64;
  const live = new Map();   // sessionId -> session

  function hello(h) {
    if (!h || typeof h !== 'object') return { ok: false, error: 'bad hello' };
    if (h.v !== C.VERSION) return { ok: false, error: 'unsupported protocol version' };
    const dev = devices.get(String(h.deviceId || ''));
    if (!dev) return { ok: false, error: 'unknown device' };
    let keys, eph, nS;
    try {
      const station = devices.stationKeys();
      eph = C.generateKeyPair();
      nS = C.newNonce();
      keys = C.deriveSessionKeys({
        side: 'station',
        myStaticPrivate: station.privateKey, myStaticPublic: station.publicRaw,
        myEphPrivate: eph.privateKey, myEphPublic: eph.publicRaw,
        peerStaticPublic: dev.publicKey, peerEphPublic: String(h.eph || ''),
        phoneNonce: String(h.nonce || ''), stationNonce: nS
      });
    } catch (e) { return { ok: false, error: 'bad hello' }; }
    sweep();
    if (live.size >= maxSessions) {   // bounded: drop the stalest session rather than grow forever
      let oldest = null;
      for (const s of live.values()) if (!oldest || s.lastAt < oldest.lastAt) oldest = s;
      if (oldest) end(oldest.id);
    }
    const s = { id: newId(), deviceId: dev.id, keys, inSeq: 0, outSeq: 0, createdAt: now(), lastAt: now(), verified: false };
    live.set(s.id, s);
    return { ok: true, sessionId: s.id, welcome: { v: C.VERSION, sessionId: s.id, eph: eph.publicRaw, nonce: nS } };
  }

  function get(sid) {
    const s = live.get(String(sid || ''));
    if (!s) return null;
    if (now() - s.lastAt > ttlMs) { live.delete(s.id); return null; }
    if (!devices.get(s.deviceId)) { live.delete(s.id); return null; }   // revoked since
    return s;
  }

  function openRequest(sid, frame) {
    const s = get(sid);
    if (!s) return { ok: false, error: 'no session' };
    if (!frame || !Number.isSafeInteger(frame.seq) || frame.seq <= s.inSeq) return { ok: false, error: 'stale frame' };
    let msg;
    try { msg = C.open(s.keys.p2s, 'p2s', frame); } catch (_) { return { ok: false, error: 'bad frame' }; }
    s.inSeq = frame.seq;
    s.lastAt = now();
    if (!s.verified) { s.verified = true; try { devices.touch(s.deviceId); } catch (_) {} }
    return { ok: true, session: s, msg };
  }

  // Two outbound lanes, each with its own counter and direction label: 'res' answers requests, 'ev' is the
  // live event stream. Over HTTP they arrive on different connections, so one shared counter would look like
  // reordering to the phone. The label is in the AAD, so a frame can't be moved from one lane to the other.
  function sealOut(s, obj, lane) {
    if (lane === 'ev') { s.evSeq = (s.evSeq || 0) + 1; return C.seal(s.keys.s2p, 's2e', s.evSeq, obj); }
    s.outSeq += 1;
    return C.seal(s.keys.s2p, 's2p', s.outSeq, obj);
  }

  function end(sid) { const s = live.get(String(sid || '')); live.delete(String(sid || '')); if (s && typeof s.onEnd === 'function') { try { s.onEnd(); } catch (_) {} } }
  function endDevice(deviceId) { for (const s of Array.from(live.values())) if (s.deviceId === deviceId) end(s.id); }
  function sweep() { const t = now(); for (const s of Array.from(live.values())) if (t - s.lastAt > ttlMs) end(s.id); }
  function list() { sweep(); return Array.from(live.values()); }
  function keep(sid) { const s = get(sid); if (s) s.lastAt = now(); return !!s; }

  // Live event delivery. A transport attaches one sink per session (the SSE response, later the relay
  // socket); broadcast seals each event separately for every attached session. A sink that throws is
  // dropped (dead socket), and an event with no live sink is simply not delivered: the phone re-reads
  // state with `status` / `approvals` when it reconnects, so nothing depends on a queued backlog.
  function attachSink(sid, fn) {
    const s = get(sid);
    if (!s) return null;
    s.sink = fn;
    return () => { if (s.sink === fn) s.sink = null; };
  }
  function broadcast(obj) {
    let n = 0;
    for (const s of Array.from(live.values())) {
      if (!s.sink) continue;
      if (!get(s.id)) continue;   // expired or revoked
      try { s.sink(sealOut(s, obj, 'ev')); n++; } catch (_) { s.sink = null; }
    }
    return n;
  }

  return { hello, get, openRequest, sealOut, end, endDevice, sweep, list, keep, attachSink, broadcast };
}

module.exports = { makeSessions };
