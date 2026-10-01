/* test/userprops-sweep.test.js — the paid-job guarantees of sidecar/userprops.js (sweep 2026-09-30):
   a LOCAL failure to save a finished prop keeps the job and retries (only invalid art is dropped); a corrupt pending
   or index file is never overwritten; a start the cloud never answered is retried with the SAME client key (one job,
   one charge); a double click on a side view and a delete racing it are refused atomically; settled jobs are
   remembered so a failure that happened while REFIT was closed can be reported. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { makeUserProps } = require('../sidecar/userprops.js');

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function makePng(w, h) { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc((w * 4 + 1) * h))), chunk('IEND', Buffer.alloc(0))]); }
const RESULT = { noun: 'a lamp', label: 'LAMP', like: 'lamp', footprint: { w: 1, h: 1 }, bounds: { x: 0, y: -10, width: 12, height: 22 }, sourceWidth: 20, sourceHeight: 30, png: makePng(20, 30).toString('base64') };

let SEQ = 0;
// a fake cloud that dedupes on clientKey like the real one, and can be told to swallow the next N starts (no answer)
function fakeCloud() {
  const state = { jobs: new Map(), byKey: new Map(), posts: [], swallow: 0 };
  const fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if (init.method === 'POST' && /\/v1\/props\/(generate|side|preview)$/.test(url)) {
      state.posts.push({ url, body });
      let job = body && body.clientKey && state.byKey.get(body.clientKey);
      if (!job) {
        const id = 'pj_sweep' + String(++SEQ).padStart(8, '0');
        job = { id, kind: /side$/.test(url) ? 'side' : 'front', noun: body.noun, status: 'running', step: 'drawing', tries: 1, costUsd: 0 };
        state.jobs.set(id, job); if (body.clientKey) state.byKey.set(body.clientKey, job);
      }
      if (state.swallow > 0) { state.swallow--; const e = new Error('aborted'); e.name = 'AbortError'; throw e; }   // accepted, but the answer never arrives
      return { status: 202, ok: true, json: async () => ({ job }) };
    }
    const m = /\/v1\/props\/jobs\/(.+)$/.exec(url);
    if (m) { const j = state.jobs.get(decodeURIComponent(m[1])); return j ? { status: 200, ok: true, json: async () => ({ job: j }) } : { status: 404, ok: false, json: async () => ({}) }; }
    return { status: 500, ok: false, json: async () => ({}) };
  };
  return { state, fetch };
}
let KEY = 0;
const make = (dir, cloud, extra = {}) => makeUserProps({ fs, path, dir, cloud: () => ({ url: 'https://cloud.test', token: 'snd_t' }), fetch: (...a) => cloud.fetch(...a), now: () => extra.now ? extra.now() : 1000, setTimer: () => 0, clearTimer: () => {}, randomKey: () => 'ck_test' + String(++KEY).padStart(8, '0'), ...extra });

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'userprops-sweep-'));
  try {
    // ---- 1. a local save failure keeps the paid job; the next tick lands it
    {
      const dir = path.join(root, 'a', '.userprops');
      const cloud = fakeCloud();
      let failWrites = 1;
      const writeDurable = (d, file, data) => { if (failWrites > 0 && /\.png$/.test(file)) { failWrites--; const e = new Error('EBUSY: resource busy or locked'); e.code = 'EBUSY'; throw e; } fs.writeFileSync(file + '.tmp', data); fs.renameSync(file + '.tmp', file); };
      const up = make(dir, cloud, { writeDurable });
      const r = await up.start('a lamp');
      A.ok(r.ok, 'started');
      Object.assign(cloud.state.jobs.get(r.job.id), { status: 'done', costUsd: 0.35, result: RESULT });
      await up.pollOnce();
      A.eq(up.list().length, 0, 'the locked file did not land');
      A.eq(up.activeJobs().length, 1, 'but the paid job is KEPT (not dropped as a bad result)');
      A.eq(up.job(r.job.id).step, 'saving', 'and says it is saving');
      await up.pollOnce();
      A.eq(up.list().length, 1, 'the next tick lands it');
      A.eq(up.activeJobs().length, 0, 'and the job settles');
    }
    // ---- 2. corrupt pending.json (no .bak) is never overwritten
    {
      const dir = path.join(root, 'b', '.userprops');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'pending.json'), '{"jobs":[{"id":"pj_paid0000001","noun":"x"},');   // torn write
      const cloud = fakeCloud();
      const up = make(dir, cloud);
      const r = await up.start('a lamp');
      A.eq(r.code, 'state_unreadable', 'a start is refused while the pending list is unreadable');
      A.eq(cloud.state.posts.length, 0, 'and nothing is sent to the cloud (nothing charged)');
      A.ok(fs.readFileSync(path.join(dir, 'pending.json'), 'utf8').startsWith('{"jobs":[{"id":"pj_paid0000001"'), 'the corrupt file is left for recovery, not replaced');
    }
    // ---- 3. a start the cloud never answered is adopted by the poller with the SAME key: one job, one charge
    {
      const dir = path.join(root, 'c', '.userprops');
      const cloud = fakeCloud();
      cloud.state.swallow = 1;
      const up = make(dir, cloud);
      const r = await up.start('a lamp');
      A.eq(r.code, 'unreachable', 'no answer');
      A.ok(/never charged twice/.test(String(r.message)), 'and the player is told it may still arrive');
      A.eq(up.activeJobs().length, 1, 'the claim is kept');
      await up.pollOnce();
      A.eq(cloud.state.posts.length, 2, 'the poller asked again');
      A.eq(cloud.state.posts[0].body.clientKey, cloud.state.posts[1].body.clientKey, 'with the same key');
      A.eq(cloud.state.jobs.size, 1, 'so the cloud made ONE job');
      const id = [...cloud.state.jobs.keys()][0];
      Object.assign(cloud.state.jobs.get(id), { status: 'done', costUsd: 0.35, result: RESULT });
      await up.pollOnce();
      A.eq(up.list().length, 1, 'and it lands');
    }
    // ---- 4. a double click on SIDE VIEW is refused atomically; a delete racing it is refused too
    {
      const dir = path.join(root, 'd', '.userprops');
      const cloud = fakeCloud();
      const up = make(dir, cloud);
      const f = await up.start('a lamp');
      Object.assign(cloud.state.jobs.get(f.job.id), { status: 'done', costUsd: 0.35, result: RESULT });
      await up.pollOnce();
      const prop = up.list()[0];
      const before = cloud.state.posts.length;
      const [s1, s2, del] = await Promise.all([up.startSide(prop.id), up.startSide(prop.id), up.remove(prop.id)]);
      A.ok(s1.ok, 'the first side view starts');
      A.eq(s2.code, 'busy', 'the second click is refused');
      A.eq(del.code, 'busy', 'a delete racing it is refused');
      A.eq(cloud.state.posts.length - before, 1, 'exactly one side view was asked for (one charge)');
      A.ok(up.list().some((p) => p.id === prop.id), 'the prop is still there');
    }
    // ---- 5. settled jobs are remembered for the page
    {
      const dir = path.join(root, 'e', '.userprops');
      const cloud = fakeCloud();
      const up = make(dir, cloud);
      const r = await up.start('a lamp');
      Object.assign(cloud.state.jobs.get(r.job.id), { status: 'failed', costUsd: 0, error: { code: 'no_consistent_result', message: 'Could not make it match. Nothing was charged.' } });
      await up.pollOnce();
      const rec = up.recentJobs();
      A.eq([rec.length, rec[0].status, rec[0].id], [1, 'failed', r.job.id], 'a failure is remembered');
      const again = make(dir, cloud);   // a sidecar restart: the memory is on disk
      A.eq(again.job(r.job.id).status, 'failed', 'and answers after a restart');
      A.ok(/Nothing was charged/.test(String(again.job(r.job.id).error.message)));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  A.report();
})();
