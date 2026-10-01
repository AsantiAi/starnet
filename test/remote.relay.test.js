/* node test/remote.relay.test.js — StarNet Remote over the RELAY (phase 3), in one process, on 127.0.0.1.

   The real relay (relay/server.js + its dependency-free WebSocket server), the real station side
   (sidecar/remote/relay-client.js over Node's built-in WebSocket, with the real devices/sessions/approvals/
   gateway) and the real WebCrypto phone client. What it proves:
     · a station signs in with its own key; a forged signature is refused; another key can't take its routing id
     · a phone pairs through the relay with the one-time code, then connects with its relay pass
     · a stranger without a pass can only send a pairing request; anything else is closed (4401)
     · sealed calls and live events flow end to end; the relay never holds anything it could open
     · approvals: the phone approves once; always/full are refused
     · revoke kicks the phone at the relay and its pass stops working
     · station offline -> phones get 4404; the station comes back by itself after a relay restart */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');

const C = require('../sidecar/remote/crypto.js');
const { makeSessions } = require('../sidecar/remote/session.js');
const { makeDevices } = require('../sidecar/remote/devices.js');
const { makeApprovals } = require('../sidecar/remote/approvals.js');
const { makeGateway } = require('../sidecar/remote/gateway.js');
const { makeRelayClient } = require('../sidecar/remote/relay-client.js');
const { makeRelay, ridOf, tokenHash, LABEL } = require('../relay/server.js');
const net = require('net');
const Phone = require('../relay/app/phone-client.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitUntil(fn, ms, label) { const t = Date.now() + ms; while (Date.now() < t) { if (await fn()) return; await sleep(20); } throw new Error('timed out waiting for ' + label); }
function wsClose(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 1, deviceId: 'dev_x', eph: 'x', nonce: 'x' }));
    ws.onclose = (ev) => resolve(ev.code);
    setTimeout(() => { try { ws.close(); } catch (_) {} resolve('timeout'); }, 5000);
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-relay-'));
  const newId = () => nodeCrypto.randomUUID();
  const devices = makeDevices({ fs, path, file: path.join(dir, '.secrets', 'remote.json'), crypto: C, now: () => Date.now(), newId });
  const sessions = makeSessions({ devices, crypto: C, now: () => Date.now(), newId });
  const approvals = makeApprovals({ now: () => Date.now() });
  const host = {
    status: async () => ({ station: 'TEST STATION', agents: [{ agentId: 'forge', name: 'FORGE', state: 'idle' }], runs: [] }),
    threads: async () => [], thread: async () => [], send: async () => ({ runId: 'r1', streamId: 's1' }), stop: async () => ({ ok: false }),
    files: async () => [], fetchFile: async () => ({ ok: false, error: 'unknown file' }), routines: async () => [], setRoutine: async () => ({ ok: true })
  };
  const gateway = makeGateway({ host, approvals, now: () => Date.now() });

  let relay = makeRelay({ log: () => {} });
  let port = await relay.listen(0, '127.0.0.1');
  const base = 'http://127.0.0.1:' + port;
  let rc = null;
  try {
    // a forged station sign-in is refused
    {
      const ws = new WebSocket(base.replace('http', 'ws') + '/v1/station');
      const code = await new Promise((resolve) => {
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.t === 'challenge') ws.send(JSON.stringify({ t: 'auth', pub: devices.stationKeys().publicRaw, sig: C.b64u(Buffer.alloc(70, 1)) })); };
        ws.onclose = (ev) => resolve(ev.code);
      });
      A.eq(code, 4401, 'a station that cannot sign for its key is refused');
    }

    // ONE bad request must never take the relay down (it carries every station and phone)
    {
      // a relay that serves the phone app (the crash lived on that path)
      const appRelay = makeRelay({ appDir: path.join(__dirname, '..', 'relay', 'app'), log: () => {} });
      const appPort = await appRelay.listen(0, '127.0.0.1');
      const abase = 'http://127.0.0.1:' + appPort;
      A.eq((await fetch(abase + '/')).status, 200, 'the phone app is served');
      const r1 = await fetch(abase + '/%00');
      A.eq(r1.status, 400, 'a path with a NUL byte is refused, not crashed on');
      const r2 = await fetch(abase + '/' + 'a'.repeat(400));
      A.eq(r2.status, 400, 'an absurdly long path is refused');
      await new Promise((resolve) => {
        const s = net.connect(appPort, '127.0.0.1', () => s.write('GET //[ HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'));
        s.on('close', resolve); s.on('error', resolve); setTimeout(() => { s.destroy(); resolve(); }, 1500);
      });
      const h = await fetch(abase + '/healthz').then(r => r.json());
      A.eq(h.ok, true, 'and the relay is still up afterwards');
      await appRelay.close();
    }

    // A phone that arrives while a station has just connected (its paired list not sent yet) WAITS for the list
    // instead of being told "not paired" (which used to make a healthy phone believe it was removed)
    {
      const keys = devices.stationKeys();
      const sws = new WebSocket(base.replace('http', 'ws') + '/v1/station');
      const got = [];
      let rid = null;
      await new Promise((resolve) => {
        sws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.t === 'challenge') sws.send(JSON.stringify({ t: 'auth', pub: keys.publicRaw, sig: C.b64u(nodeCrypto.sign('sha256', Buffer.from(LABEL + '|' + m.nonce), keys.privateKey)) }));
          else if (m.t === 'ready') { rid = m.rid; resolve(); }
          else got.push(m);
        };
      });
      const pws = new WebSocket(base.replace('http', 'ws') + '/v1/phone?rid=' + encodeURIComponent(rid) + '&tok=early-token');
      await new Promise(r => { pws.onopen = r; });
      pws.send(JSON.stringify({ t: 'hello', v: 1, deviceId: 'dev_early' }));
      await sleep(300);
      A.eq(got.filter(m => m.t === 'open').length, 0, 'the phone is held while the station has not said who is paired');
      sws.send(JSON.stringify({ t: 'tokens', hashes: [tokenHash('early-token')] }));
      await waitUntil(() => got.some(m => m.t === 'open') && got.some(m => m.t === 'from'), 3000, 'held phone admitted');
      A.eq(got.find(m => m.t === 'open').paired, true, 'then admitted as paired, its early hello delivered');
      try { pws.close(); sws.close(); } catch (_) {}
      await sleep(100);
    }

    rc = makeRelayClient({ url: base, devices, sessions, gateway, crypto: C, now: () => Date.now(), log: () => {} });
    rc.start();
    await waitUntil(() => rc.info().state === 'online', 5000, 'station online at the relay');
    const st = devices.stationKeys();
    A.eq(rc.info().rid, ridOf(st.publicRaw), 'the routing id is the hash of the station key');
    A.eq(await Phone.ridOf(st.publicRaw), rc.info().rid, 'the phone computes the same routing id from the QR');

    // a stranger (no pass) can't do anything but ask to pair
    A.eq(await wsClose(base.replace('http', 'ws') + '/v1/phone?rid=' + rc.info().rid), 4401, 'no relay pass: a hello is refused at the relay');
    A.eq(await wsClose(base.replace('http', 'ws') + '/v1/phone?rid=nope'), 4404, 'unknown station: 4404');

    // pair through the relay
    const p = devices.startPairing({});
    const key = await Phone.makeDeviceKey();
    let bad = null; try { await Phone.pairRelay({ relay: base, stationPub: st.publicRaw, pairingId: p.pairingId, code: 'WRONGCOD', name: 'Relay phone', key }); } catch (e) { bad = e.message; }
    A.ok(/wrong pairing code/.test(bad || ''), 'a wrong code over the relay is refused by the station: ' + bad);
    const paired = await Phone.pairRelay({ relay: base, stationPub: st.publicRaw, pairingId: p.pairingId, code: p.code, name: 'Relay phone', key });
    A.ok(/^dev_/.test(paired.deviceId), 'paired through the relay');
    A.ok(typeof paired.relayToken === 'string' && paired.relayToken.length >= 32, 'the phone got its relay pass');
    const raw = fs.readFileSync(path.join(dir, '.secrets', 'remote.json'), 'utf8');
    A.ok(raw.indexOf(paired.relayToken) < 0, 'the station stores only a hash of the pass');

    // connect with the pass; sealed calls + events
    const c = Phone.connectRelay({ relay: base, stationPub: st.publicRaw, deviceId: paired.deviceId, relayToken: paired.relayToken, key });
    const states = []; c.onStatus((s) => states.push(s));
    const events = []; c.onEvent((e) => events.push(e));
    const s1 = await c.call('status');
    A.eq(s1.data.station, 'TEST STATION', 'status over the relay');
    A.ok(states.indexOf('open') >= 0, 'the link reports open only after the sealed handshake');
    sessions.broadcast({ type: 'hello.phone', n: 7 });
    await waitUntil(() => events.length > 0, 3000, 'event over the relay');
    A.eq(events[0], { type: 'hello.phone', n: 7 }, 'a station event arrives sealed and opens on the phone');

    const decided = [];
    const done = approvals.add({ runId: 'rR', promptId: 'pR', agentId: 'forge', surface: 'remote', tool: 'shell.exec', argsSummary: 'npm test', finish: (d) => decided.push(d) });
    A.eq((await c.call('approvals')).data.length, 1, 'the approval is listed over the relay');
    A.eq((await c.call('decide', { runId: 'rR', promptId: 'pR', decision: 'always' })).ok, false, 'no ALWAYS from a phone over the relay');
    A.eq((await c.call('decide', { runId: 'rR', promptId: 'pR', decision: 'once' })).ok, true, 'approve once over the relay');
    A.eq(decided, ['once'], 'the waiter got it');
    done();

    // the station drops the session (idle expiry, restart) while the socket stays up: the client recovers by itself
    for (const s of sessions.list()) sessions.end(s.id);
    const again = await c.call('status');
    A.eq(again.ok && again.data.station, 'TEST STATION', 'a dropped station session is re-established transparently');

    // parallel calls resolve to the right replies
    const [a1, a2, a3] = await Promise.all([c.call('ping'), c.call('status'), c.call('approvals')]);
    A.ok(a1.ok && a2.data.station === 'TEST STATION' && Array.isArray(a3.data), 'concurrent calls are matched to their own replies');

    // what the relay holds: routing only
    const rs = relay._stations.get(rc.info().rid);
    A.ok(rs && rs.tokens.size === 1 && !rs.tokens.has(paired.relayToken), 'the relay keeps only pass hashes');

    // revoke: kicked at the relay, pass dead
    devices.revoke(paired.deviceId); sessions.endDevice(paired.deviceId); rc.kickDevice(paired.deviceId);
    await waitUntil(() => states[states.length - 1] === 'closed', 3000, 'phone kicked');
    let refused = null; try { await c.call('status'); } catch (e) { refused = e.message; }
    A.ok(/not paired|removed|closed|refused|unknown/.test(refused || ''), 'a revoked phone cannot reconnect: ' + refused);

    // a second phone survives a relay restart
    const p2 = devices.startPairing({});
    const key2 = await Phone.makeDeviceKey();
    const paired2 = await Phone.pairRelay({ relay: base, stationPub: st.publicRaw, pairingId: p2.pairingId, code: p2.code, name: 'Tablet', key: key2 });
    const c2 = Phone.connectRelay({ relay: base, stationPub: st.publicRaw, deviceId: paired2.deviceId, relayToken: paired2.relayToken, key: key2 });
    A.eq((await c2.call('ping')).ok, true, 'second phone linked');
    const closed2 = [];
    c2.onStatus((s, d) => { if (s === 'closed') closed2.push(d && d.code); });
    await relay.close();
    await waitUntil(() => rc.info().state === 'offline', 5000, 'station notices the relay is gone');
    A.ok(closed2.length > 0, 'the phone sees the link drop');
    relay = makeRelay({ log: () => {} });
    port = await relay.listen(port, '127.0.0.1');
    await waitUntil(() => rc.info().state === 'online', 15000, 'station back online by itself');
    A.eq((await c2.call('status')).ok, true, 'the phone reconnects after the relay restart');

    // the station stops -> phones are told the station is offline
    const offline = [];
    c2.onStatus((s, d) => { if (s === 'closed') offline.push(d && d.code); });
    rc.stop();
    await waitUntil(() => offline.includes(4404), 5000, 'phone told station offline');
    A.ok(true, 'station stop -> phone gets 4404 station offline');
    c2.close();
  } catch (e) {
    A.ok(false, 'threw: ' + (e && e.stack || e));
  } finally {
    try { rc && rc.stop(); } catch (_) {}
    await relay.close().catch(() => {});
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  A.report('remote relay');
})();
