/* test/userprops-side.test.js — side views for made props, station side: the accepted front PNG is what gets sent,
   the side view lands as <id>-w.png with its own footprint on the index entry, landing is idempotent, a second
   side view is refused, a bad cloud result touches nothing, and the paid side job survives a restart. */
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

let SEQ = 0;
function fakeCloud() {
  const state = { jobs: new Map(), calls: [] };
  const fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    state.calls.push({ url, method: init.method, body });
    if (init.method === 'POST' && /\/v1\/props\/(generate|side|preview)$/.test(url)) {
      const id = 'pj_side' + String(++SEQ).padStart(8, '0');
      state.jobs.set(id, { id, kind: /side$/.test(url) ? 'side' : /preview$/.test(url) ? 'preview' : 'front', noun: body.noun, status: 'running', step: 'drawing', tries: 1, costUsd: 0 });
      return { status: 202, ok: true, json: async () => ({ job: state.jobs.get(id) }) };
    }
    const m = /\/v1\/props\/jobs\/(.+)$/.exec(url);
    if (m) { const j = state.jobs.get(decodeURIComponent(m[1])); return j ? { status: 200, ok: true, json: async () => ({ job: j }) } : { status: 404, ok: false, json: async () => ({}) }; }
    return { status: 500, ok: false, json: async () => ({}) };
  };
  return { state, fetch };
}
const make = (dir, cloud) => makeUserProps({ fs, path, dir, cloud: () => ({ url: 'https://cloud.test', token: 'snd_t' }), fetch: (...a) => cloud.fetch(...a), now: () => 1000, setTimer: () => 0, clearTimer: () => {} });
const FRONT = { noun: 'a jukebox', label: 'JUKEBOX', like: 'jukebox', footprint: { w: 1, h: 2 }, bounds: { x: -2, y: -3, width: 16, height: 27 }, sourceWidth: 20, sourceHeight: 30, png: makePng(20, 30).toString('base64') };
const SIDE = (over = {}) => ({ view: 'w', noun: 'a jukebox', footprint: { w: 2, h: 1 }, bounds: { x: -2, y: -15, width: 28, height: 27 }, sourceWidth: 40, sourceHeight: 30, png: makePng(40, 30).toString('base64'), ...over });

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'userprops-side-'));
  const dir = path.join(root, '.userprops');
  try {
    const cloud = fakeCloud();
    const up = make(dir, cloud);
    const made = await up.start('a jukebox');
    Object.assign(cloud.state.jobs.get(made.job.id), { status: 'done', costUsd: 0.35, result: FRONT });
    await up.pollOnce();
    const prop = up.list()[0];
    A.ok(prop && !prop.side, 'a fresh made prop has no side view');

    A.eq((await up.startSide('user_nope_000000')).code, 'not_found', 'an unknown prop is refused');
    const r = await up.startSide(prop.id);
    A.ok(r.ok && r.job.kind === 'side' && r.job.propId === prop.id, 'side view job started for the prop');
    const sent = cloud.state.calls.find((c) => /\/v1\/props\/side$/.test(c.url)).body;
    A.eq(sent.front.png, fs.readFileSync(path.join(dir, prop.id + '.png')).toString('base64'), 'the accepted front PNG on disk is what gets turned');
    A.eq([sent.noun, sent.front.footprint, sent.front.bounds], ['a jukebox', { w: 1, h: 2 }, { height: 27 }], 'with its noun, footprint and height');
    A.eq([prop.profile, sent.front.profile], [false, false], 'a front-shown prop is not profile');
    A.eq((await up.startSide(prop.id)).code, 'busy', 'a second side request while one runs is refused');

    // restart mid-job: a fresh instance still owns the paid side job
    const up2 = make(dir, cloud);
    A.ok(up2.activeJobs().some((j) => j.id === r.job.id && j.kind === 'side'), 'the side job survives a restart');
    Object.assign(cloud.state.jobs.get(r.job.id), { status: 'done', costUsd: 0.3, result: SIDE() });
    await up2.pollOnce();
    const after = up2.list().find((p) => p.id === prop.id);
    A.ok(after.side, 'the side view lands on the prop');
    A.eq([after.side.footprint, after.side.bounds.height, after.side.costUsd], [{ w: 2, h: 1 }, 27, 0.3], 'with its own footprint, the same height, and the real cost');
    A.ok(fs.existsSync(path.join(dir, prop.id + '-w.png')), '<id>-w.png written');
    A.eq(up2.imageFile(prop.id, 'w'), path.join(dir, prop.id + '-w.png'), 'imageFile serves the w view');
    A.eq(up2.imageFile(prop.id, 'n'), null, 'no other view name is accepted');
    A.eq(up2.job(r.job.id).status, 'done', 'the side job reports done');
    A.eq(up2.activeJobs().length, 0, 'nothing pending');
    fs.writeFileSync(path.join(dir, 'pending.json'), JSON.stringify({ jobs: [{ id: r.job.id, noun: 'a jukebox', kind: 'side', propId: prop.id }] }));
    await up2.pollOnce();
    A.eq(up2.list().filter((p) => p.id === prop.id).length, 1, 'a re-polled side job does not duplicate the prop');
    A.eq((await up2.startSide(prop.id)).code, 'exists', 'a prop with a side view is not re-made');

    // a bad side result touches nothing
    const made2 = await up2.start('a lamp');
    Object.assign(cloud.state.jobs.get(made2.job.id), { status: 'done', costUsd: 0.3, result: { ...FRONT, label: 'LAMP', noun: 'a lamp' } });
    await up2.pollOnce();
    const lamp = up2.list().find((p) => p.label === 'LAMP');
    const s2 = await up2.startSide(lamp.id);
    Object.assign(cloud.state.jobs.get(s2.job.id), { status: 'done', result: SIDE({ view: 's' }) });
    await up2.pollOnce();
    A.ok(!up2.list().find((p) => p.id === lamp.id).side, 'a side result that is not the w view is refused');
    A.eq(up2.job(s2.job.id).error && up2.job(s2.job.id).error.code, 'bad_result', 'and reported honestly');
    A.ok(!fs.existsSync(path.join(dir, lamp.id + '-w.png')), 'no side file written for it');

    // ---- delete: refused while a job for the prop runs; then files + entry go and the id is tombstoned
    const busyStart = await up2.startSide((await (async () => { const m = await up2.start('a chair'); Object.assign(cloud.state.jobs.get(m.job.id), { status: 'done', costUsd: 0.3, result: { ...FRONT, label: 'CHAIR', noun: 'a chair' } }); await up2.pollOnce(); return up2.list().find((p) => p.label === 'CHAIR').id; })()));
    const chairId = up2.list().find((p) => p.label === 'CHAIR').id;
    A.eq((await up2.remove(chairId)).code, 'busy', 'a prop with a running side job cannot be deleted yet');
    A.eq((await up2.remove('user_missing_zzzzzz')).code, 'not_found', 'deleting an unknown prop is refused');
    A.eq((await up2.remove('../x')).code, 'bad_id', 'a bad id is refused');
    const gone = await up2.remove(prop.id);
    A.ok(gone.ok, 'a made prop is deleted');
    A.ok(!up2.list().some((p) => p.id === prop.id), 'it leaves the index');
    A.ok(!fs.existsSync(path.join(dir, prop.id + '.png')) && !fs.existsSync(path.join(dir, prop.id + '-w.png')), 'both its files are removed');
    A.ok(up2.deleted().includes(prop.id), 'its id is tombstoned so saves drop placed copies');
    A.ok(up2.list().some((p) => p.id === lamp.id), 'other made props are untouched');
    Object.assign(cloud.state.jobs.get(busyStart.job.id), { status: 'done', result: SIDE() });
    await up2.pollOnce();
    A.ok(up2.deleted().includes(prop.id), 'a later landing keeps the tombstones');

    // ---- a symmetric prop records the flag and never sells a side view (it turns with its own art)
    const barrelJob = await up2.start('a wooden barrel');
    Object.assign(cloud.state.jobs.get(barrelJob.job.id), { status: 'done', costUsd: 0.3, result: { ...FRONT, label: 'WOODEN BARREL', noun: 'a wooden barrel', symmetric: true } });
    await up2.pollOnce();
    const barrel = up2.list().find((p) => p.label === 'WOODEN BARREL');
    A.eq(barrel.symmetric, true, 'the symmetric flag lands on the entry');
    const beforeCalls = cloud.state.calls.length;
    A.eq((await up2.startSide(barrel.id)).code, 'symmetric', 'no paid side view for a prop that looks the same turned');
    A.eq(cloud.state.calls.length, beforeCalls, 'and no cloud call is made');
    A.eq(up2.list().find((p) => p.id === lamp.id).symmetric, false, 'a prop without the flag is not symmetric');

    // ---- SIZE: only the allowed steps are stored, and only for a real made prop
    A.eq((await up2.setScale(lamp.id, 1.5)).scale, 1.5, 'a made prop takes an allowed size');
    A.eq(up2.list().find((p) => p.id === lamp.id).scale, 1.5, 'the size persists on the entry');
    A.eq((await up2.setScale(lamp.id, 1.7)).code, 'bad_scale', 'an off-step size is refused');
    A.eq((await up2.setScale(lamp.id, 10)).code, 'bad_scale', 'an oversized value is refused');
    A.eq((await up2.setScale('user_missing_zzzzzz', 2)).code, 'not_found', 'an unknown prop is refused');
    A.eq(up2.list().find((p) => p.id === lamp.id).scale, 1.5, 'a refused size leaves the stored one alone');

    // ---- PREVIEW before paying: sketch + size come back to the page; making it forwards them to the cloud
    const pvStart = await up2.startPreview('a crane');
    A.ok(pvStart.ok && pvStart.job && pvStart.job.kind === 'preview', 'a preview job starts');
    A.eq(cloud.state.calls.filter((c) => /\/v1\/props\/preview$/.test(c.url)).length, 1, 'posted to the cloud preview route');
    const pending1 = await up2.preview(pvStart.job.id);
    A.eq([pending1.ok, pending1.preview], [true, null], 'a running preview has no sketch yet');
    const sketch = makePng(16, 16).toString('base64');
    Object.assign(cloud.state.jobs.get(pvStart.job.id), { status: 'done', costUsd: 0.045, result: { noun: 'a crane', label: 'CRANE', size: { fp: '3x2', height: 40, like: 'bunk', symmetric: false }, sketch } });
    const done1 = await up2.preview(pvStart.job.id);
    A.eq([done1.preview.label, done1.preview.footprint, done1.preview.height, done1.job.costUsd], ['CRANE', '3x2', 40, 0.045], 'the preview carries label, size and its real cost');
    A.eq(done1.preview.sketch, 'data:image/png;base64,' + sketch, 'the sketch reaches the page as a data URL');
    A.eq((await up2.preview('pj_nope00000000')).code, 'not_found', 'an unknown preview is refused');
    const madeP = await up2.start('a crane', pvStart.job.id);
    const sentBody = cloud.state.calls.filter((c) => /\/v1\/props\/generate$/.test(c.url)).pop().body;
    A.ok(madeP.ok, 'making the previewed prop starts');
    A.eq(sentBody.preview && sentBody.preview.size, { fp: '3x2', height: 40, like: 'bunk', symmetric: false, profile: false }, 'the approved sizing is forwarded');
    A.eq(sentBody.preview && sentBody.preview.sketch, sketch, 'and the approved sketch');
    await up2.start('a different thing', pvStart.job.id);
    A.eq(cloud.state.calls.filter((c) => /\/v1\/props\/generate$/.test(c.url)).pop().body.preview, undefined, 'a preview is never attached to a different noun');

    // a PROFILE prop (vehicle/animal, drawn side-on) keeps the flag, and its side request says so (the cloud turns it head-on)
    Object.assign(cloud.state.jobs.get(madeP.job.id), { status: 'done', costUsd: 0.34, result: { ...FRONT, noun: 'a crane', label: 'CRANE', footprint: { w: 3, h: 2 }, profile: true } });
    await up2.pollOnce();
    const crane = up2.list().find((p) => p.noun === 'a crane');
    A.eq(crane && crane.profile, true, 'the profile flag lands on the entry');
    await up2.startSide(crane.id);
    A.eq(cloud.state.calls.filter((c) => /\/v1\/props\/side$/.test(c.url)).pop().body.front.profile, true, 'and rides the side request');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  A.report();
})();
