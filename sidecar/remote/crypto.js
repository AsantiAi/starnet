/* sidecar/remote/crypto.js — the sealed channel between a paired phone and this station.

   Everything a phone and the station say to each other is sealed HERE, end to end. A relay (or anything
   else in the middle) only ever carries { seq, iv, ct } blobs it cannot open. Pure node:crypto, no deps,
   and deliberately built from primitives every phone browser has in WebCrypto (P-256 ECDH, HKDF-SHA256,
   AES-256-GCM), so the phone side is the same few calls with no library either.

   KEYS
     · The station has one static P-256 key pair (made once, kept in .secrets/remote.json).
     · Each paired phone has its own static P-256 key pair (made on the phone at pairing; the station keeps
       only its public half).
     · Each CONNECTION adds a fresh ephemeral key pair on both sides plus a random nonce from each side.

   HANDSHAKE (one round trip, KK-shaped)
     phone  -> station : hello   { v, deviceId, eph: phoneEphPub, nonce: nP }
     station-> phone   : welcome { v, eph: stationEphPub, nonce: nS }
     ikm  = ECDH(eS, eP) || ECDH(sS, sP)                (ephemeral-ephemeral || static-static)
     salt = SHA-256("starnet-remote/1" || stationPub || phonePub || ephS || ephP || nP || nS)
     keys = HKDF(ikm, salt, "p2s") and HKDF(ikm, salt, "s2p")    one AES-256-GCM key per direction
   Only a holder of BOTH static keys can derive the static-static term, so a middle box that swaps the
   ephemerals derives nothing useful; the ephemeral term gives forward secrecy if a static key leaks later.
   Everything public that went over the wire is bound into the salt, so a tampered hello/welcome yields
   keys that fail the very first GCM open.

   FRAMES
     seal(key, dir, seq, obj) -> { seq, iv, ct }   ct = AES-GCM(JSON(obj)) || 16-byte tag, AAD = dir + ":" + seq
     open(key, dir, frame)    -> obj               throws on any tamper, wrong key or wrong direction
   Replay/reorder is refused by the SESSION (strictly increasing seq per direction), not here. */
'use strict';

const crypto = require('crypto');

const VERSION = 1;
const LABEL = 'starnet-remote/1';
const CURVE = 'prime256v1';            // = WebCrypto "P-256"
const RAW_PUB_LEN = 65;                 // uncompressed point: 0x04 || X(32) || Y(32)

function b64u(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) {
  const str = String(s == null ? '' : s);
  if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('not base64url');
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/* A P-256 key pair as { privateKey: KeyObject, publicRaw: base64url(65 bytes) }. */
function generateKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: CURVE });
  return { privateKey, publicRaw: exportPublicRaw(publicKey) };
}
function exportPublicRaw(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  return b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)]));
}
/* A raw uncompressed P-256 point (what WebCrypto exportKey('raw') gives) -> KeyObject. Validates length,
   prefix and that the point is ON the curve (createPublicKey rejects an off-curve point). */
function importPublicRaw(raw) {
  const buf = unb64u(raw);
  if (buf.length !== RAW_PUB_LEN || buf[0] !== 4) throw new Error('bad public key');
  return crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(buf.subarray(1, 33)), y: b64u(buf.subarray(33, 65)) }, format: 'jwk' });
}
/* Private keys persist as PKCS#8 base64url (only ever inside the protected .secrets file). */
function exportPrivate(privateKey) { return b64u(privateKey.export({ format: 'der', type: 'pkcs8' })); }
function importPrivate(s) { return crypto.createPrivateKey({ key: unb64u(s), format: 'der', type: 'pkcs8' }); }
function publicRawOfPrivate(privateKey) { return exportPublicRaw(crypto.createPublicKey(privateKey)); }

function ecdh(privateKey, publicRaw) {
  return crypto.diffieHellman({ privateKey, publicKey: importPublicRaw(publicRaw) });
}

function newNonce() { return b64u(crypto.randomBytes(16)); }

/* Derive the two directional session keys. `side` is 'station' or 'phone'; both sides call this with
   their own private keys and the other side's publics and get byte-identical { p2s, s2p }. */
function deriveSessionKeys(o) {
  const side = o.side;
  if (side !== 'station' && side !== 'phone') throw new Error('side must be station or phone');
  const ee = ecdh(o.myEphPrivate, o.peerEphPublic);
  const ss = ecdh(o.myStaticPrivate, o.peerStaticPublic);
  const stationPub = side === 'station' ? o.myStaticPublic : o.peerStaticPublic;
  const phonePub = side === 'phone' ? o.myStaticPublic : o.peerStaticPublic;
  const ephS = side === 'station' ? o.myEphPublic : o.peerEphPublic;
  const ephP = side === 'phone' ? o.myEphPublic : o.peerEphPublic;
  const salt = crypto.createHash('sha256').update(Buffer.concat([
    Buffer.from(LABEL), unb64u(stationPub), unb64u(phonePub), unb64u(ephS), unb64u(ephP),
    unb64u(o.phoneNonce), unb64u(o.stationNonce)
  ])).digest();
  const ikm = Buffer.concat([ee, ss]);
  const key = (info) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from(info), 32));
  return { p2s: key('p2s'), s2p: key('s2p') };
}

function aad(dir, seq) { return Buffer.from(String(dir) + ':' + String(seq)); }

function seal(key, dir, seq, obj) {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error('seq must be a positive integer');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad(dir, seq));
  const body = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj === undefined ? null : obj), 'utf8')), c.final(), c.getAuthTag()]);
  return { seq, iv: b64u(iv), ct: b64u(body) };
}

function open(key, dir, frame) {
  if (!frame || typeof frame !== 'object') throw new Error('bad frame');
  const seq = frame.seq;
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error('bad seq');
  const iv = unb64u(frame.iv), body = unb64u(frame.ct);
  if (iv.length !== 12 || body.length < 17) throw new Error('bad frame');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(aad(dir, seq));
  d.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);   // final() throws on tamper
  return JSON.parse(plain.toString('utf8'));
}

/* Pairing proof: the phone shows it holds the one-time code without sending the code itself.
   proof = HMAC-SHA256(code, LABEL || "pair" || devicePub || name) — bound to the key it registers. */
function pairingProof(code, devicePub, name) {
  return b64u(crypto.createHmac('sha256', Buffer.from(String(code), 'utf8'))
    .update(LABEL + '|pair|' + String(devicePub) + '|' + String(name == null ? '' : name)).digest());
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* A short human-checkable fingerprint of a public key ("A1B2-C3D4-E5F6"), shown on both screens at pairing. */
function fingerprint(publicRaw) {
  const h = crypto.createHash('sha256').update(unb64u(publicRaw)).digest('hex').toUpperCase();
  return h.slice(0, 4) + '-' + h.slice(4, 8) + '-' + h.slice(8, 12);
}

module.exports = {
  VERSION, LABEL, b64u, unb64u,
  generateKeyPair, exportPublicRaw, importPublicRaw, exportPrivate, importPrivate, publicRawOfPrivate,
  newNonce, deriveSessionKeys, seal, open, pairingProof, safeEqual, fingerprint
};
