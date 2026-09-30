/* sidecar/skills/market-signing.js — the Skill Market's signatures (2026-09-29).

   Every document a station trusts from the market — the catalog index and the pulled-skills list — is signed with
   an Ed25519 key that lives only on the publisher's machine: never on the website, never in this repo. The app
   ships the PUBLIC keys below and refuses any document whose detached signature (<document url>.sig) does not
   verify over the exact bytes it downloaded, so controlling the website is not enough to change what a station
   installs.

   Two keys are trusted: the working key that signs every catalog build, and a backup kept offline. If the working
   key is ever lost or exposed, the backup signs while a new pair ships in an app update, and no installed station
   is stranded. A station pointed at its own catalog (STARNET_SKILL_MARKET_URL) adds that catalog's public key with
   STARNET_SKILL_MARKET_KEYS (see keysFromEnv).

   Pure: no network, no clock. */
'use strict';

const crypto = require('node:crypto');

const SIG_FORMAT = 'starnet-signature/v1';
const KEY_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

// public keys as base64 SPKI DER (what publicKeyOf returns)
const TRUSTED_KEYS = Object.freeze([
  Object.freeze({ id: 'market-2026-a', publicKey: 'MCowBQYDK2VwAyEAAfLsd/480eFRM7LdmI7icZf/0QNg61d8d9iGJo+vUxU=' }),
  Object.freeze({ id: 'market-backup-2026-a', publicKey: 'MCowBQYDK2VwAyEAMP197BVUfEfM98o4fdUB89HcHKolS48prfN253GXxAk=' })
]);

function str(v) { return v == null ? '' : String(v); }

function publicKeyObject(b64) {
  const key = crypto.createPublicKey({ key: Buffer.from(str(b64), 'base64'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('not an Ed25519 key');
  return key;
}

// publicKeyOf(privateKeyPem) -> the base64 SPKI DER public key that TRUSTED_KEYS holds
function publicKeyOf(privateKeyPem) {
  return crypto.createPublicKey(crypto.createPrivateKey(privateKeyPem)).export({ format: 'der', type: 'spki' }).toString('base64');
}

function generateKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }), publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
}

/* sign(bytes, privateKeyPem, keys?) -> the .sig document text. The signing key must be one of `keys` (the app's
   trusted keys by default): signing with a key no station trusts would publish a catalog every station refuses. */
function sign(bytes, privateKeyPem, keys) {
  keys = keys || TRUSTED_KEYS;
  const key = crypto.createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('the market signing key must be Ed25519');
  const pub = publicKeyOf(privateKeyPem);
  const known = keys.find(k => k.publicKey === pub);
  if (!known) throw new Error('this signing key is not one the app trusts (its public key is ' + pub + ')');
  const sig = crypto.sign(null, Buffer.from(bytes), key).toString('base64');
  return JSON.stringify({ format: SIG_FORMAT, alg: 'ed25519', keyId: known.id, sig }, null, 2) + '\n';
}

/* verify(bytes, sigText, keys?) -> the id of the key that signed `bytes`. Throws a short reason when the signature
   is unreadable, names a key this app does not trust, or does not match the bytes. */
function verify(bytes, sigText, keys) {
  keys = keys || TRUSTED_KEYS;
  let doc = null;
  try { doc = JSON.parse(str(sigText)); } catch (_) { doc = null; }
  if (!doc || doc.format !== SIG_FORMAT || doc.alg !== 'ed25519' || typeof doc.sig !== 'string') throw new Error('its signature is missing or unreadable');
  const key = keys.find(k => k.id === doc.keyId);
  if (!key) throw new Error('it is signed by a key this app does not trust');
  const sig = Buffer.from(doc.sig, 'base64');
  let ok = false;
  try { ok = sig.length === 64 && crypto.verify(null, Buffer.from(bytes), publicKeyObject(key.publicKey), sig); } catch (_) { ok = false; }
  if (!ok) throw new Error('its signature does not match its contents');
  return key.id;
}

// sigUrl(url) -> where a document's detached signature lives
function sigUrl(url) {
  const u = new URL(url);
  u.pathname += '.sig';
  return u.href;
}

/* keysFromEnv(value) -> extra trusted keys from STARNET_SKILL_MARKET_KEYS: a JSON list of { id, publicKey } for a
   station that runs its own catalog. Malformed entries are ignored; the built-in keys are always trusted. */
function keysFromEnv(value) {
  if (!str(value).trim()) return [];
  let list = null;
  try { list = JSON.parse(str(value)); } catch (_) { return []; }
  const out = [];
  for (const k of Array.isArray(list) ? list.slice(0, 8) : []) {
    if (!k || !KEY_ID_RE.test(str(k.id))) continue;
    try { publicKeyObject(k.publicKey); } catch (_) { continue; }
    out.push(Object.freeze({ id: str(k.id), publicKey: str(k.publicKey) }));
  }
  return out;
}

module.exports = { SIG_FORMAT, TRUSTED_KEYS, sign, verify, sigUrl, publicKeyOf, generateKeyPair, keysFromEnv };
