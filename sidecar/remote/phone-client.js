/* sidecar/remote/phone-client.js — the PHONE side of the sealed channel, written against WebCrypto only.

   This exact file is what the phone app will load (phase 2) and what the tests drive under Node, whose
   globalThis.crypto.subtle is the same WebCrypto API a phone browser has. So every test that passes here
   proves the station speaks to a real browser's crypto, not to a Node-only twin of itself.

   Uses only: crypto.subtle (P-256 ECDH, HKDF-SHA256, AES-GCM, HMAC), crypto.getRandomValues, TextEncoder,
   fetch, and optionally a stream reader for events. No Node modules.

     const kp = await PhoneClient.makeDeviceKey()                 // { privateKey:CryptoKey, publicRaw }
     const p  = await PhoneClient.pair({ base, pairingId, code, name, key: kp })
     const c  = PhoneClient.connect({ base, deviceId, stationPub, key: kp })
     await c.open();  await c.call('status');  c.onEvent(fn);  await c.listen();  c.close() */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PhoneClient = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LABEL = 'starnet-remote/1';
  const VERSION = 1;
  const subtle = () => globalThis.crypto.subtle;
  const enc = new TextEncoder(), dec = new TextDecoder();

  function b64u(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function concat(parts) {
    let n = 0; for (const p of parts) n += p.length;
    const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  function randomB64u(n) { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return b64u(b); }

  const EC = { name: 'ECDH', namedCurve: 'P-256' };

  async function makeKeyPair(extractable) {
    const kp = await subtle().generateKey(EC, !!extractable, ['deriveBits']);
    const raw = new Uint8Array(await subtle().exportKey('raw', kp.publicKey));
    return { privateKey: kp.privateKey, publicRaw: b64u(raw) };
  }
  // The device key is made once at pairing. Non-extractable: the phone can use it but script can't read it out.
  function makeDeviceKey() { return makeKeyPair(false); }
  async function importPub(raw) { return subtle().importKey('raw', unb64u(raw), EC, false, []); }
  async function ecdh(priv, pubRaw) { return new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: await importPub(pubRaw) }, priv, 256)); }

  async function deriveKeys(o) {
    const ee = await ecdh(o.ephPrivate, o.stationEph);
    const ss = await ecdh(o.devicePrivate, o.stationPub);
    const salt = new Uint8Array(await subtle().digest('SHA-256', concat([
      enc.encode(LABEL), unb64u(o.stationPub), unb64u(o.devicePub), unb64u(o.stationEph), unb64u(o.phoneEph),
      unb64u(o.phoneNonce), unb64u(o.stationNonce)
    ])));
    const ikm = await subtle().importKey('raw', concat([ee, ss]), 'HKDF', false, ['deriveKey']);
    const key = (info, usage) => subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, ikm, { name: 'AES-GCM', length: 256 }, false, usage);
    return { p2s: await key('p2s', ['encrypt']), s2p: await key('s2p', ['decrypt']) };
  }

  async function seal(key, dir, seq, obj) {
    const iv = new Uint8Array(12); globalThis.crypto.getRandomValues(iv);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(dir + ':' + seq) }, key, enc.encode(JSON.stringify(obj))));
    return { seq, iv: b64u(iv), ct: b64u(ct) };
  }
  async function open(key, dir, frame) {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64u(frame.iv), additionalData: enc.encode(dir + ':' + frame.seq) }, key, unb64u(frame.ct));
    return JSON.parse(dec.decode(pt));
  }

  async function pairingProof(code, devicePub, name) {
    const k = await subtle().importKey('raw', enc.encode(String(code)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return b64u(new Uint8Array(await subtle().sign('HMAC', k, enc.encode(LABEL + '|pair|' + devicePub + '|' + (name == null ? '' : name)))));
  }

  async function postJson(fetchFn, url, body) {
    const r = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch (_) {}
    return { status: r.status, body: j || {} };
  }

  async function pair(o) {
    const fetchFn = o.fetch || fetch;
    const name = String(o.name || 'Phone');
    const proof = await pairingProof(o.code, o.key.publicRaw, name);
    const r = await postJson(fetchFn, o.base + '/remote/v1/pair', { pairingId: o.pairingId, publicKey: o.key.publicRaw, name, proof });
    if (r.status !== 200 || !r.body.ok) throw new Error(r.body.error || ('pairing failed (' + r.status + ')'));
    return r.body;
  }

  function connect(o) {
    const fetchFn = o.fetch || fetch;
    const state = { sid: null, keys: null, seq: 0, lastRes: 0, lastEv: 0, nextId: 1, handlers: [], abort: null };

    async function openSession() {
      const eph = await makeKeyPair(false);
      const nonce = randomB64u(16);
      const r = await postJson(fetchFn, o.base + '/remote/v1/hello', { v: VERSION, deviceId: o.deviceId, eph: eph.publicRaw, nonce });
      if (r.status !== 200 || !r.body.ok) throw new Error(r.body.error || ('hello refused (' + r.status + ')'));
      const w = r.body.welcome;
      state.keys = await deriveKeys({
        ephPrivate: eph.privateKey, devicePrivate: o.key.privateKey,
        stationPub: o.stationPub, devicePub: o.key.publicRaw,
        stationEph: w.eph, phoneEph: eph.publicRaw, phoneNonce: nonce, stationNonce: w.nonce
      });
      state.sid = w.sessionId; state.seq = 0; state.lastRes = 0; state.lastEv = 0;
      return w.sessionId;
    }

    async function call(verb, args) {
      if (!state.sid) await openSession();
      const id = state.nextId++;
      state.seq += 1;
      const frame = await seal(state.keys.p2s, 'p2s', state.seq, { id, verb, args: args || {} });
      const r = await postJson(fetchFn, o.base + '/remote/v1/call', { sessionId: state.sid, frame });
      if (r.status === 401) { state.sid = null; throw new Error('session expired'); }
      if (r.status !== 200 || !r.body.ok) throw new Error(r.body.error || ('call failed (' + r.status + ')'));
      const f = r.body.frame;
      if (!f || f.seq <= state.lastRes) throw new Error('stale reply');
      const reply = await open(state.keys.s2p, 's2p', f);   // throws if anything in the middle touched it
      state.lastRes = f.seq;
      if (reply.id !== id) throw new Error('reply for a different request');
      return reply;
    }

    function onEvent(fn) { state.handlers.push(fn); }

    // Reads the sealed event stream until closed. Resolves when the stream ends.
    async function listen() {
      if (!state.sid) await openSession();
      state.abort = new AbortController();
      const r = await fetchFn(o.base + '/remote/v1/events?sid=' + encodeURIComponent(state.sid), { signal: state.abort.signal });
      if (r.status !== 200) throw new Error('events refused (' + r.status + ')');
      const reader = r.body.getReader();
      let buf = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const line = chunk.split('\n').find(l => l.indexOf('data:') === 0);
            if (!line) continue;
            let f; try { f = JSON.parse(line.slice(5).trim()); } catch (_) { continue; }
            if (!f || f.seq <= state.lastEv) continue;           // replayed or reordered: refuse
            let ev; try { ev = await open(state.keys.s2p, 's2e', f); } catch (_) { continue; }   // tampered: drop
            state.lastEv = f.seq;
            for (const h of state.handlers) { try { h(ev); } catch (_) {} }
          }
        }
      } catch (_) { /* aborted or dropped */ }
    }

    function close() { try { state.abort && state.abort.abort(); } catch (_) {} }

    return { open: openSession, call, onEvent, listen, close, _state: state };
  }

  return { VERSION, LABEL, makeDeviceKey, pair, connect, pairingProof, _b64u: b64u, _unb64u: unb64u, _seal: seal, _open: open, _deriveKeys: deriveKeys, _makeKeyPair: makeKeyPair };
}));
