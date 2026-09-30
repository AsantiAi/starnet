/* node test/remote-view.test.js — the STATION picture a paired phone sees, end to end without a browser:
     · sidecar/remote/view.js      holds the desk's latest still and whether a phone is looking
     · sidecar/remote/portraits.js an agent's own sprite, by the frontend's own skin table
     · host.view / host.portrait through the REAL gateway (validation, chunking, the picture's age)
     · frontend/app/remoteview.js  the desk page draws only while Remote is on and a phone is looking
   The law under test: the phone gets what the desk's renderer drew, stamped with when, and never more. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { makeRemoteView, MAX_BYTES, WANT_MS } = require('../sidecar/remote/view.js');
const { makePortraits } = require('../sidecar/remote/portraits.js');
const { makeRemoteHost } = require('../sidecar/remote/host.js');
const { makeGateway, MAX_CHUNK } = require('../sidecar/remote/gateway.js');

const FRONTEND = path.resolve(__dirname, '..', 'frontend');
const webp = (n) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(Math.max(0, n - 16), 7)]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);

(async () => {
  /* ---------- 1. the store ---------- */
  let t = 1000;
  const view = makeRemoteView({ now: () => t });
  A.eq(view.meta(), null, 'a fresh station has no picture');
  A.eq(view.wanted(), false, 'and nobody is looking');
  A.eq(view.put({ w: 800, h: 600, data: Buffer.from('<html>').toString('base64') }).ok, false, 'a non-image is refused whatever it claims to be');
  A.eq(view.put({ mime: 'image/webp', w: 0, h: 600, data: webp(64).toString('base64') }).ok, false, 'a bad size is refused');
  A.eq(view.put({ w: 800, h: 600, data: Buffer.alloc(MAX_BYTES + 1, 1).toString('base64') }).ok, false, 'an oversized picture is refused');
  A.eq(view.meta(), null, 'a refused picture stores nothing');
  const put = view.put({ mime: 'text/html', w: 800, h: 600, data: webp(5000).toString('base64'),
    bodies: [{ agentId: 'forge', x: 100.4, y: 200, name: 'IGNORED', working: true }, { agentId: '../x', x: 1, y: 1 }, { agentId: 'far', x: 9000, y: 1 }, null] });
  A.eq(put.ok, true, 'a real picture is kept');
  const m = view.meta();
  A.eq(m.mime, 'image/webp', 'the type comes from the bytes, never from the claim');
  A.eq(m.at, 1000, 'stamped with when it arrived');
  A.eq(m.bodies, [{ agentId: 'forge', x: 100, y: 200 }], 'crew positions are reduced to id + point; bad ids and off-picture points are dropped');
  A.eq(view.read(0, 100).length, 100, 'reads in chunks');
  A.eq(view.read(4990, 100).length, 10, 'and stops at the end');
  view.want();
  A.eq(view.wanted(), true, 'a phone asked: someone is looking');
  t += WANT_MS + 1;
  A.eq(view.wanted(), false, 'and stops counting once the phone goes quiet');
  A.eq(view.put({ w: 10, h: 10, data: jpeg().toString('base64') }).ok, true, 'a JPEG is accepted too');
  A.eq(view.meta().mime, 'image/jpeg', 'and recognised');

  /* ---------- 2. portraits: the frontend's own skin table ---------- */
  const portraits = makePortraits({ fs, path, frontend: FRONTEND });
  const ctx = { DATA: {} };
  vm.runInNewContext(fs.readFileSync(path.join(FRONTEND, 'app', 'data-shim.js'), 'utf8').replace(/^[\s\S]*?(DATA\.SKINS\s*=)/, '$1'), ctx);
  const skins = Object.keys(ctx.DATA.SKINS);
  A.ok(skins.length >= 40, 'the skin table loaded (' + skins.length + ')');
  A.eq(portraits.skins().slice().sort(), skins.slice().sort(), 'the sidecar reads exactly the skins the renderer knows');
  let missing = [];
  for (const s of skins) {
    const p = portraits.forSkin(s);
    if (!p || p.skin !== s || p.mime !== 'image/png' || Buffer.from(p.data, 'base64').toString('latin1', 1, 4) !== 'PNG') missing.push(s);
  }
  A.eq(missing, [], 'every skin has its sprite');
  const dflt = portraits.forSkin('no-such-skin');
  A.eq(dflt && dflt.skin, ctx.DATA.DEFAULT_SKIN, 'an unknown skin falls back to the default, as the renderer does');
  A.eq(portraits.forSkin('../../secret'), dflt, 'a hostile skin name reads nothing but the default sprite');

  /* ---------- 3. the verbs, through the real gateway ---------- */
  let now = 50000;
  const v2 = makeRemoteView({ now: () => now });
  const host = makeRemoteHost({
    now: () => now, newId: () => 'r1', broadcast: () => {},
    roster: () => [{ agentId: 'forge', name: 'FORGE', model: 'm', provider: 'p' }, { agentId: 'scout', name: 'SCOUT' }],
    liveRuns: () => [], transcript: { streams: () => [], history: () => [] },
    view: v2, crewLooks: () => ({ forge: { skin: 'robot', color: '#fff' } }), portrait: (skin) => portraits.forSkin(skin)
  });
  const gw = makeGateway({ host, approvals: { size: () => 0, list: () => [] }, now: () => now });
  const call = (verb, args) => gw.call({ verb, args }, { deviceId: 'd1' });

  const none = await call('view', {});
  A.ok(none.ok && none.data.none === true, 'no picture yet: the phone is told so, not shown a blank');
  A.eq(v2.wanted(), true, 'asking is what tells the desk a phone is looking');

  const big = webp(MAX_CHUNK + 5000);
  v2.put({ w: 1600, h: 1200, data: big.toString('base64'), bodies: [{ agentId: 'forge', x: 10, y: 20 }] });
  now += 7000;
  const c1 = await call('view', {});
  A.eq([c1.data.at, c1.data.now, c1.data.w, c1.data.h, c1.data.mime, c1.data.size], [50000, 57000, 1600, 1200, 'image/webp', big.length], 'the picture comes with its size and BOTH clocks (drawn at, answered at)');
  A.eq(c1.data.bytes, MAX_CHUNK, 'one chunk is at most ' + MAX_CHUNK + ' bytes');
  A.eq(c1.data.eof, false, 'with more to come');
  A.eq(c1.data.bodies, [{ agentId: 'forge', x: 10, y: 20 }], 'the crew positions ride the first chunk');
  const c2 = await call('view', { at: c1.data.at, offset: c1.data.offset + c1.data.bytes });
  A.eq([c2.data.bytes, c2.data.eof, c2.data.bodies], [5000, true, undefined], 'the rest follows');
  A.ok(Buffer.concat([Buffer.from(c1.data.data, 'base64'), Buffer.from(c2.data.data, 'base64')]).equals(big), 'the chunks rebuild the exact picture');
  const same = await call('view', { have: c1.data.at });
  A.eq([same.data.same, same.data.data], [true, undefined], 'a picture the phone already has is not sent again');
  v2.put({ w: 100, h: 100, data: webp(200).toString('base64') });
  const mid = await call('view', { at: c1.data.at, offset: 100 });
  A.eq(mid.data.changed, true, 'a picture replaced mid-read is restarted, never spliced');
  const weird = await call('view', { have: 'x', offset: -5, length: 99999999 });
  A.ok(weird.ok && weird.data.offset === 0 && weird.data.bytes <= MAX_CHUNK, 'junk arguments are clamped');

  const st = await call('status', {});
  A.eq(st.data.agents.map(a => a.skin), ['robot', ''], 'status carries each agent\'s skin (blank when the save has none)');
  const pf = await call('portrait', { agentId: 'forge' });
  A.eq([pf.ok, pf.data.skin, pf.data.mime], [true, 'robot', 'image/png'], 'an agent\'s portrait is its own sprite');
  const ps = await call('portrait', { agentId: 'scout' });
  A.eq(ps.data.skin, ctx.DATA.DEFAULT_SKIN, 'an agent with no skin gets the default sprite');
  A.eq((await call('portrait', { agentId: 'nobody' })).ok, false, 'an unknown agent has no portrait');
  A.eq((await call('portrait', { agentId: '../x' })).ok, false, 'a bad id is refused');

  /* ---------- 4. the desk page: draws only when Remote is on and a phone is looking ---------- */
  let answer = null, stills = 0, still = { canvas: { id: 'c' }, width: 640, height: 480, bodies: [{ agentId: 'forge', x: 1, y: 2 }] };
  const posts = [];
  globalThis.World = { renderStill: (px) => { stills++; A.eq(px, 1600, 'asks for a still of a sane size'); return still; } };
  globalThis.fetch = async (url, o) => {
    if (o && o.method === 'POST') { posts.push({ url, body: JSON.parse(o.body) }); return { ok: true, json: async () => ({ ok: true }) }; }
    return answer === null ? { ok: false, json: async () => null } : { ok: true, json: async () => answer };
  };
  const { RemoteView } = require('../frontend/app/remoteview.js');
  const I = RemoteView._internals;
  I.encode = async (canvas) => ({ mime: 'image/webp', data: 'QUJD', canvas });

  answer = { ok: true, enabled: false, want: false, at: null };
  A.eq(await I.step(), I.IDLE_MS, 'Remote off: look again slowly');
  A.eq([stills, posts.length], [0, 0], 'and draw nothing');

  answer = { ok: true, enabled: true, want: false, at: null };
  A.eq(await I.step(), I.WATCH_MS, 'Remote on, nobody looking');
  A.eq([stills, posts.length], [1, 1], 'one picture so a phone that opens later has something');
  A.eq(posts[0].url, '/api/remote/view', 'handed to the sidecar');
  A.eq([posts[0].body.mime, posts[0].body.w, posts[0].body.h, posts[0].body.data, posts[0].body.bodies.length], ['image/webp', 640, 480, 'QUJD', 1], 'with its size and the crew positions');
  answer = { ok: true, enabled: true, want: false, at: 123 };
  await I.step(); await I.step();
  A.eq(stills, 1, 'and then no more while nobody is looking');

  answer = { ok: true, enabled: true, want: true, at: 123 };
  A.eq(await I.step(), I.LIVE_MS, 'a phone is looking: redraw on the live cadence');
  await I.step();
  A.eq([stills, posts.length], [3, 3], 'a fresh picture every pass while it looks');

  still = null;
  await I.step();
  A.eq(posts.length, 3, 'no honest picture (no bake yet, the awakening playing): nothing is sent');
  still = { canvas: {}, width: 1, height: 1, bodies: [] };
  I.encode = async () => null;
  await I.step();
  A.eq(posts.length, 3, 'an encode that fails sends nothing');

  answer = { ok: true, enabled: true, want: false, at: null };
  I.encode = async () => ({ mime: 'image/jpeg', data: 'QQ==' });
  await I.step();
  A.eq(posts.length, 4, 'a station that lost its picture (restart) gets a new one without a phone asking');

  answer = null;
  A.eq(await I.step(), I.IDLE_MS, 'an unreachable station: nothing drawn, nothing thrown');
  A.eq(posts.length, 4, 'and nothing sent');

  A.report('remote-view');
})().catch((e) => { console.log('FAIL: threw ' + (e && e.stack || e)); process.exit(1); });
