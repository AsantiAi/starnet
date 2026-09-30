/* test/userprops.test.js — player-made props, station side: linking gate, cloud error mapping, the paid-prop-
   is-never-lost pending ledger (incl. across a restart), validation of what the cloud returns before anything
   reaches disk, idempotent landing, and the id jail. The cloud is a fake fetch; timers are manual. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { makeUserProps, isPropId } = require('../sidecar/userprops.js');

// a real (tiny) PNG: signature + IHDR(w,h) + IDAT + IEND
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function makePng(w, h) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const RESULT = (over = {}) => ({ noun: 'a jukebox', label: 'JUKEBOX', like: 'jukebox', footprint: { w: 1, h: 2 }, bounds: { x: -2, y: -3, width: 16, height: 27 }, sourceWidth: 20, sourceHeight: 30, png: makePng(20, 30).toString('base64'), ...over });

let JOB_SEQ = 0;   // ids unique across every fake cloud in this file, like the real cloud's UUIDs
function fakeCloud() {
  const state = { jobs: new Map(), startStatus: 202, calls: [], seq: 0 };
  const fetch = async (url, init) => {
    state.calls.push({ url, method: init.method, auth: init.headers.authorization, body: init.body ? JSON.parse(init.body) : null });
    const m = /\/v1\/props\/jobs\/(.+)$/.exec(url);
    if (init.method === 'POST' && /\/v1\/props\/generate$/.test(url)) {
      if (state.startStatus !== 202) return { status: state.startStatus, ok: false, json: async () => ({ error: { message: 'cloud says no', code: 'x' } }) };
      const id = 'pj_' + 'abcdef0123456789'.slice(0, 10) + String(++JOB_SEQ).padStart(6, '0');
      state.jobs.set(id, { id, noun: init.body && JSON.parse(init.body).noun, status: 'running', step: 'drawing', tries: 1, costUsd: 0.05 });
      return { status: 202, ok: true, json: async () => ({ job: state.jobs.get(id) }) };
    }
    if (init.method === 'GET' && m) {
      const j = state.jobs.get(decodeURIComponent(m[1]));
      if (!j) return { status: 404, ok: false, json: async () => ({ error: { code: 'not_found' } }) };
      return { status: 200, ok: true, json: async () => ({ job: j }) };
    }
    return { status: 500, ok: false, json: async () => ({}) };
  };
  return { state, fetch };
}
function make(dir, cloud, cfg = { url: 'https://cloud.test/', token: 'snd_tok' }) {
  let t = 5000;
  const settled = [];
  const up = makeUserProps({ fs, path, dir, cloud: () => cfg, fetch: cloud.fetch, now: () => (t += 1000), setTimer: () => 0, clearTimer: () => {}, onSettled: (j) => settled.push(j) });
  return { up, settled };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'userprops-'));
  const pdir = path.join(dir, '.userprops');
  try {
    // --- not linked: refused before any network call
    {
      const cloud = fakeCloud();
      const { up } = make(pdir, cloud, { url: '', token: '' });
      const r = await up.start('a lamp');
      A.eq([r.ok, r.code], [false, 'not_linked'], 'an unlinked station is told to link, not charged');
      A.eq(cloud.state.calls.length, 0, 'no cloud call when unlinked');
      A.eq((await up.start('   ')).code, 'empty', 'an empty noun is rejected locally');
    }
    // --- cloud error mapping (402/401/429/404)
    for (const [status, code] of [[402, 'insufficient_credits'], [401, 'not_linked'], [429, 'busy'], [404, 'unsupported'], [400, 'x']]) {
      const cloud = fakeCloud(); cloud.state.startStatus = status;
      const { up } = make(pdir, cloud);
      const r = await up.start('a lamp');
      A.eq([r.ok, r.code], [false, code], 'cloud ' + status + ' maps to ' + code);
      A.eq(up.activeJobs().length, 0, 'a refused start leaves nothing pending (' + status + ')');
    }
    // --- happy path: pending on disk the moment the cloud accepts, lands when done, never duplicates
    {
      const cloud = fakeCloud();
      const { up, settled } = make(pdir, cloud);
      const r = await up.start('a jukebox');
      A.ok(r.ok && /^pj_/.test(r.job.id), 'start returns the cloud job');
      A.eq(cloud.state.calls[0].auth, 'Bearer snd_tok', 'uses the linked device token');
      A.eq(cloud.state.calls[0].url, 'https://cloud.test/v1/props/generate', 'posts to the linked cloud (trailing slash trimmed)');
      const pend = JSON.parse(fs.readFileSync(path.join(pdir, 'pending.json'), 'utf8'));
      A.eq(pend.jobs.map((j) => j.id), [r.job.id], 'the paid job is on disk before any poll');
      await up.pollOnce();
      A.eq(up.list().length, 0, 'nothing lands while the cloud is still running');
      A.eq(up.job(r.job.id).status, 'running', 'job reports running');
      Object.assign(cloud.state.jobs.get(r.job.id), { status: 'done', step: 'done', costUsd: 0.4125, result: RESULT() });
      await up.pollOnce();
      const props = up.list();
      A.eq(props.length, 1, 'the finished prop lands in the index');
      A.ok(isPropId(props[0].id) && /^user_jukebox_/.test(props[0].id), 'prop id is a jailed user_ id');
      A.eq([props[0].footprint, props[0].bounds.height, props[0].costUsd, props[0].label], [{ w: 1, h: 2 }, 27, 0.4125, 'JUKEBOX'], 'index carries footprint, bounds, the real billed cost and label');
      A.ok(fs.existsSync(path.join(pdir, props[0].id + '.png')), 'png written');
      A.eq(up.imageFile(props[0].id), path.join(pdir, props[0].id + '.png'), 'imageFile resolves inside the folder');
      A.eq(up.job(r.job.id).propId, props[0].id, 'job points at the landed prop');
      A.eq(up.activeJobs().length, 0, 'pending cleared after landing');
      A.eq(settled.length, 1, 'onSettled fired once');
      // idempotent: the same finished job polled again (e.g. pending restored from .bak) never duplicates
      fs.writeFileSync(path.join(pdir, 'pending.json'), JSON.stringify({ jobs: [{ id: r.job.id, noun: 'a jukebox', startedAt: 1 }] }));
      await up.pollOnce();
      A.eq(up.list().length, 1, 'a re-polled finished job does not duplicate the prop');
    }
    // --- restart: a job started before a crash is picked up by a fresh instance and lands
    {
      const cloud = fakeCloud();
      const first = make(pdir, cloud).up;
      const r = await first.start('a globe on a stand');
      first.stop();
      Object.assign(cloud.state.jobs.get(r.job.id), { status: 'done', costUsd: 0.3, result: RESULT({ label: 'GLOBE ON A STAND', noun: 'a globe on a stand' }) });
      const second = make(pdir, cloud).up;
      A.eq(second.activeJobs().map((j) => j.id), [r.job.id], 'a restarted station still knows the paid job');
      await second.pollOnce();
      A.ok(second.list().some((p) => p.label === 'GLOBE ON A STAND'), 'and lands it');
    }
    // --- the cloud's result is validated before anything touches disk
    for (const [label, bad] of [
      ['bounds beyond the renderer limit', RESULT({ bounds: { x: 0, y: 0, width: 500, height: 20 } })],
      ['a non-png payload', RESULT({ png: Buffer.from('not a png at all, definitely not').toString('base64') })],
      ['declared size that disagrees with the image', RESULT({ sourceWidth: 99 })],
      ['a fractional footprint', RESULT({ footprint: { w: 1.5, h: 1 } })]
    ]) {
      const cloud = fakeCloud();
      const { up } = make(pdir, cloud);
      const before = up.list().length;
      const r = await up.start('a thing');
      Object.assign(cloud.state.jobs.get(r.job.id), { status: 'done', result: bad });
      await up.pollOnce();
      A.eq(up.list().length, before, 'nothing lands for ' + label);
      A.eq([up.job(r.job.id).status, up.job(r.job.id).error && up.job(r.job.id).error.code], ['failed', 'bad_result'], label + ' fails honestly');
    }
    // --- failed and lost jobs settle with their reason, pending cleared
    {
      const cloud = fakeCloud();
      const { up } = make(pdir, cloud);
      const a = await up.start('a motorcycle');
      Object.assign(cloud.state.jobs.get(a.job.id), { status: 'failed', costUsd: 0.9, error: { code: 'no_consistent_result', message: 'Could not make it match after 3 tries.' } });
      const b = await up.start('a hammock');
      cloud.state.jobs.delete(b.job.id);
      await up.pollOnce();
      A.eq([up.job(a.job.id).status, up.job(a.job.id).error.code, up.job(a.job.id).costUsd], ['failed', 'no_consistent_result', 0.9], 'a failed job reports its reason and real spend');
      A.eq([up.job(b.job.id).status, up.job(b.job.id).error.code], ['failed', 'lost'], 'a job the cloud forgot is reported lost, not left spinning');
      A.eq(up.activeJobs().length, 0, 'both cleared from pending');
    }
    // --- offline poll keeps the job
    {
      const cloud = fakeCloud();
      const { up } = make(pdir, cloud);
      const r = await up.start('a cat tree');
      const real = cloud.fetch;
      cloud.fetch = async () => { throw new Error('offline'); };
      const up2 = makeUserProps({ fs, path, dir: pdir, cloud: () => ({ url: 'https://cloud.test', token: 't' }), fetch: async () => { throw new Error('offline'); }, now: () => 1, setTimer: () => 0, clearTimer: () => {} });
      await up2.pollOnce();
      A.ok(up2.activeJobs().some((j) => j.id === r.job.id), 'an offline poll keeps the paid job pending');
      cloud.fetch = real;
    }
    // --- id jail
    const { up } = make(pdir, fakeCloud());
    for (const bad of ['../secrets', 'user_../../x', 'USER_abc', 'user_a', 'chair', 'user_abc/def', '']) A.eq(up.imageFile(bad), null, 'imageFile refuses ' + JSON.stringify(bad));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  A.report();
})();
