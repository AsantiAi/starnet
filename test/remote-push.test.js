/* node test/remote-push.test.js — StarNet Remote phase 4: the station's own Web Push.
   The payload must be readable ONLY by the phone that subscribed (RFC 8291 aes128gcm, checked here by decrypting
   it the way a browser does), the VAPID token must verify against the key the phone subscribed with (RFC 8292),
   and a subscription the push service dropped (404/410) must be forgotten. No network: fetch is captured. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { makePush, encrypt, _b64u: b64u, _unb64u: unb64u } = require('../sidecar/remote/push.js');

// a browser's side of a subscription: its own P-256 key pair + a 16-byte auth secret
function browserSub() {
  const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = kp.publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)]);
  return { kp, raw, auth: crypto.randomBytes(16) };
}
// what the browser does with an incoming push body
function decrypt(body, ua) {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const asKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(asPublic.subarray(1, 33)), y: b64u(asPublic.subarray(33, 65)) }, format: 'jwk' });
  const shared = crypto.diffieHellman({ privateKey: ua.kp.privateKey, publicKey: asKey });
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, ua.auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.raw, asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  A.eq(plain[plain.length - 1], 2, 'a single final record ends with the 0x02 delimiter');
  return { rs, text: plain.subarray(0, plain.length - 1).toString('utf8') };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-push-'));
  const file = path.join(dir, '.secrets', 'remote-push.json');
  let t = 1_800_000_000_000;
  const sent = [];
  let reply = 201;
  const fakeFetch = async (url, o) => { sent.push({ url, o }); return { status: reply }; };
  const push = makePush({ fs, path, file, now: () => t, fetch: fakeFetch, subject: 'https://starnetos.com' });

  // 1. the push key
  const pub = push.publicKey();
  A.eq(unb64u(pub).length, 65, 'the public key is a raw P-256 point, the form PushManager.subscribe takes');
  A.eq(makePush({ fs, path, file, now: () => t, fetch: fakeFetch }).publicKey(), pub, 'the key survives a restart (phones stay subscribed)');
  A.ok(!fs.readFileSync(file, 'utf8').includes('BEGIN'), 'stored as data, never as a PEM file to be picked up elsewhere');

  // 2. subscribing validates what the phone sends
  const ua = browserSub();
  const ok = { endpoint: 'https://web.push.apple.com/QGuQyavXutnMjk', keys: { p256dh: b64u(ua.raw), auth: b64u(ua.auth) } };
  A.eq(push.subscribe('', ok).ok, false, 'a subscription needs a paired phone');
  A.eq(push.subscribe('d1', Object.assign({}, ok, { endpoint: 'http://evil.test/x' })).ok, false, 'a plain-http endpoint is refused');
  A.eq(push.subscribe('d1', Object.assign({}, ok, { endpoint: 'file:///etc/passwd' })).ok, false, 'a non-web endpoint is refused');
  A.eq(push.subscribe('d1', Object.assign({}, ok, { endpoint: 'https://attacker.example/x' })).ok, false, 'an https address that is not a browser push service is refused');
  A.eq(push.subscribe('d1', Object.assign({}, ok, { endpoint: 'https://push.apple.com.attacker.example/x' })).ok, false, 'a look-alike host is refused');
  A.eq(push.subscribe('d9', Object.assign({}, ok, { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' })).ok, true, 'the Google push service is accepted');
  push.unsubscribe('d9');
  A.eq(push.subscribe('d1', { endpoint: ok.endpoint, keys: { p256dh: 'AAAA', auth: b64u(ua.auth) } }).ok, false, 'a bad phone key is refused');
  A.eq(push.subscribe('d1', { endpoint: ok.endpoint, keys: { p256dh: ok.keys.p256dh, auth: 'AAAA' } }).ok, false, 'a bad auth secret is refused');
  A.eq(push.subscribe('d1', ok).ok, true, 'a real subscription is kept');
  A.ok(push.has('d1'), 'and remembered');
  A.ok(makePush({ fs, path, file, now: () => t, fetch: fakeFetch }).has('d1'), 'across a restart');

  // 3. a push: encrypted to the phone, signed by the station
  const res = await push.send(['d1'], { title: 'SCOUT needs your OK', body: 'wants to use shell.exec', tag: 'approval:r1', url: '#needs' });
  A.eq(res, [{ deviceId: 'd1', ok: true, status: 201 }], 'sent');
  const req = sent[0];
  A.eq(req.url, ok.endpoint, 'straight to the phone\'s own push service');
  A.eq([req.o.method, req.o.headers['Content-Encoding'], req.o.headers.TTL], ['POST', 'aes128gcm', String(12 * 3600)], 'as an aes128gcm Web Push with a TTL');
  const body = Buffer.from(req.o.body);
  A.ok(!body.includes(Buffer.from('SCOUT')), 'the push service sees ciphertext, never the words');
  const opened = decrypt(body, ua);
  A.eq(opened.rs, 4096, 'record size header');
  A.eq(JSON.parse(opened.text), { title: 'SCOUT needs your OK', body: 'wants to use shell.exec', tag: 'approval:r1', url: '#needs' }, 'the phone decrypts exactly what was sent');
  const other = browserSub();
  let stolen = true; try { decrypt(body, other); } catch (_) { stolen = false; }
  A.eq(stolen, false, 'another browser cannot read it');

  const m = /^vapid t=([^,]+), k=(.+)$/.exec(req.o.headers.Authorization);
  A.ok(!!m, 'VAPID authorization header');
  A.eq(m[2], pub, 'names the key the phone subscribed with');
  const [h, c, s] = m[1].split('.');
  const claims = JSON.parse(unb64u(c).toString());
  A.eq(claims.aud, 'https://web.push.apple.com', 'the audience is the push service origin');
  A.eq(claims.sub, 'https://starnetos.com', 'a contact subject');
  A.ok(claims.exp > t / 1000 && claims.exp <= t / 1000 + 24 * 3600, 'expires within a day');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(unb64u(pub).subarray(1, 33)), y: b64u(unb64u(pub).subarray(33, 65)) }, format: 'jwk' });
  A.ok(crypto.verify('sha256', Buffer.from(h + '.' + c), { key, dsaEncoding: 'ieee-p1363' }, unb64u(s)), 'the token verifies against the station push key (ES256)');

  // 4. only subscribed phones, and a dropped subscription is forgotten
  A.eq(await push.send(['nobody'], { title: 'x' }), [], 'a phone without a subscription gets nothing');
  reply = 404;
  A.eq((await push.send(['d1'], { title: 'x' }))[0].status, 404, 'a 404 on a brand-new subscription');
  A.eq(push.has('d1'), true, 'is not trusted to mean gone (a push service may still be settling it)');
  t += 2 * 60 * 60 * 1000;
  await push.send(['d1'], { title: 'x' });
  A.eq(push.has('d1'), false, 'an old subscription that 404s is forgotten');
  push.subscribe('d1', ok);
  reply = 410;
  const gone = await push.send(null, { title: 'x' });
  A.eq(gone, [{ deviceId: 'd1', ok: false, status: 410 }], 'the push service says the subscription is gone');
  A.eq(push.has('d1'), false, 'so the station forgets it');
  reply = 201;
  push.subscribe('d2', ok);
  const down = makePush({ fs, path, file, now: () => t, fetch: async () => { throw new Error('offline'); } });
  A.eq(await down.send(['d2'], { title: 'x' }), [{ deviceId: 'd2', ok: false, status: 0 }], 'no network: reported as not sent, nothing thrown');
  A.eq(down.has('d2'), true, 'and the subscription is kept for next time');
  A.eq(push.forget('d2').ok, true, 'a revoked phone is unsubscribed');
  A.eq(push.has('d2'), false, 'gone');

  // 5. the encryption itself against the RFC 8291 section 5 example
  const rfc = {
    plaintext: 'When I grow up, I want to be a watermelon',
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    result: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
  };
  const asPubRaw = unb64u(rfc.asPublic);
  const asPriv = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: rfc.asPrivate, x: b64u(asPubRaw.subarray(1, 33)), y: b64u(asPubRaw.subarray(33, 65)) }, format: 'jwk' });
  const asPubKey = crypto.createPublicKey(asPriv);
  const out = encrypt(Buffer.from(rfc.plaintext), unb64u(rfc.uaPublic), unb64u(rfc.auth), { ephemeral: { privateKey: asPriv, publicKey: asPubKey }, salt: unb64u(rfc.salt) });
  // the RFC example uses record size 4096 and no extra padding: byte-for-byte equal
  A.eq(b64u(out), rfc.result, 'byte-for-byte the RFC 8291 worked example');

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  // sweep 2026-10-02: a subscription saved by an OLDER build (before the subscribe-time host check) is re-checked at send
  {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-push-old-'));
    const file2 = path.join(dir2, '.secrets', 'remote-push.json');
    const sent2 = [];
    const p2 = makePush({ fs, path, file: file2, now: () => t, fetch: async (url, o) => { sent2.push({ url, o }); return { status: 201 }; } });
    p2.publicKey();
    const ua2 = browserSub();
    A.eq(p2.subscribe('good', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: b64u(ua2.raw), auth: b64u(ua2.auth) } }).ok, true, 'fixture: a real push address');
    const st = JSON.parse(fs.readFileSync(file2, 'utf8'));
    st.subs.old = Object.assign({}, st.subs.good, { endpoint: 'https://attacker.example/collect' });   // what an older build stored
    fs.writeFileSync(file2, JSON.stringify(st));
    const p3 = makePush({ fs, path, file: file2, now: () => t, fetch: async (url, o) => { sent2.push({ url, o }); return { status: 201 }; } });
    await p3.send(['old', 'good'], { title: 'x', body: 'y' });
    A.ok(!sent2.some(s => /attacker\.example/.test(s.url)), 'the station never POSTs to a stored address that is not a browser push service');
    A.ok(sent2.some(s => /fcm\.googleapis\.com/.test(s.url) && s.o.redirect === 'manual'), 'a real one still gets its push, and a redirect is never followed');
    fs.rmSync(dir2, { recursive: true, force: true });
  }
  A.report('remote push');
})().catch((e) => { console.log('FAIL: threw ' + (e && e.stack || e)); process.exit(1); });
