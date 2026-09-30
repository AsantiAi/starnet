/* node test/skill-market-signing.test.js — the Skill Market's signatures (2026-09-29).

   The app ships the public keys; the catalog is signed with a private key that lives only on the publisher's
   machine. This pins the primitive: a signature verifies over exactly the bytes it signed and nothing else, only
   with a trusted key, and the build can only sign with a key the app trusts. */
'use strict';
const A = require('./_assert.js');
const crypto = require('crypto');
const signing = require('../sidecar/skills/market-signing.js');

// the shipped keys are real Ed25519 public keys with distinct ids
for (const k of signing.TRUSTED_KEYS) {
  const key = crypto.createPublicKey({ key: Buffer.from(k.publicKey, 'base64'), format: 'der', type: 'spki' });
  A.eq(key.asymmetricKeyType, 'ed25519', k.id + ' is an Ed25519 public key');
}
A.eq(new Set(signing.TRUSTED_KEYS.map(k => k.id)).size, signing.TRUSTED_KEYS.length, 'trusted key ids are distinct');
A.ok(Object.isFrozen(signing.TRUSTED_KEYS), 'the trusted key list cannot be changed at runtime');

const pair = signing.generateKeyPair();
const keys = [{ id: 'test-market', publicKey: pair.publicKey }];
const bytes = Buffer.from('{"format":"starnet-skill-registry/v1","serial":7}\n');
const sig = signing.sign(bytes, pair.privateKeyPem, keys);
A.eq(JSON.parse(sig).keyId, 'test-market', 'a signature names the key that made it');
A.eq(signing.verify(bytes, sig, keys), 'test-market', 'it verifies over the exact bytes');
A.throws(() => signing.verify(Buffer.from(bytes.toString().replace('7', '8')), sig, keys), /does not match/, 'one changed byte fails');
A.throws(() => signing.verify(Buffer.concat([bytes, Buffer.from(' ')]), sig, keys), /does not match/, 'appended bytes fail');
A.throws(() => signing.verify(bytes, sig), /does not trust/, 'a signature from a key the app does not ship fails');
A.throws(() => signing.verify(bytes, '', keys), /missing or unreadable/, 'no signature fails');
A.throws(() => signing.verify(bytes, JSON.stringify({ format: 'starnet-signature/v1', alg: 'rsa', keyId: 'test-market', sig: 'x' }), keys), /missing or unreadable/, 'another algorithm is not accepted');
A.throws(() => signing.sign(bytes, signing.generateKeyPair().privateKeyPem, keys), /not one the app trusts/, 'the build refuses to sign with a key no station would trust');
const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' });
A.throws(() => signing.sign(bytes, rsa, keys), /must be Ed25519/, 'only Ed25519 keys sign');

A.eq(signing.sigUrl('https://starnetos.com/.well-known/starnet-skills.json'), 'https://starnetos.com/.well-known/starnet-skills.json.sig', 'the signature sits next to its document');
const extra = signing.keysFromEnv(JSON.stringify([{ id: 'my-market', publicKey: pair.publicKey }, { id: 'Bad Id', publicKey: pair.publicKey }, { id: 'junk', publicKey: 'AAAA' }]));
A.eq(extra.map(k => k.id), ['my-market'], 'STARNET_SKILL_MARKET_KEYS adds well-formed Ed25519 keys and ignores the rest');
A.eq(signing.keysFromEnv('not json'), [], 'an unreadable value adds nothing');

A.report('skill-market-signing.test');
