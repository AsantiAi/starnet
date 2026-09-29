/* sidecar/userprops.js — player-made props: the station asks the StarNet cloud to generate a prop from a noun
   (paid from StarNet credits), then keeps the result locally so it survives restarts and relinks.

   Contract with the cloud (starnet-cloud src/propgen.js):
     POST {cloud}/v1/props/generate {noun}         -> 202 {job}  | 402 insufficient credits | 429 busy/rate | 400 bad noun
     GET  {cloud}/v1/props/jobs/:id                -> 200 {job}  (job.status queued|running|done|failed, costUsd = real debits)
   Auth is the linked device token (Bearer), the same one managed inference uses.

   A PAID PROP IS NEVER LOST. The job id is written to disk (pending.json) the moment the cloud accepts it and a
   background poller keeps asking until the job settles, across window closes and sidecar restarts (the cloud
   keeps finished jobs for 2h). Finished props land in WORKSPACES/.userprops/<id>.png + index.json. The folder is
   dot-prefixed, so it can never be an agent id and /api/file can never serve it; the PNG has its own route.

   Pure factory: fs, path, fetch, clock and timers are injected (lint-determinism). index.js composes it.

   makeUserProps({ fs, path, dir, cloud: () => ({ url, token }), fetch, now, setTimer, clearTimer,
                   writeDurable(deps, file, data), onSettled? }) ->
   JSON goes through durable-store's readJsonResilient/writeJsonResilient (.bak recovery, refuse-to-clobber);
   the PNG through the injected durable writer (index.js passes the update-freeze-aware writeFileDurable).
     { list(), imageFile(id), start(noun), job(id), resume(), stop() } */
'use strict';
const { readJsonResilient, writeJsonResilient } = require('./durable-store.js');
const { swallow, note } = require('./failopen.js');   // a swallowed error stays visible (tagged warn + counter)

const ID_RE = /^user_[a-z0-9_]{3,60}$/;
const POLL_MS = 4000;
const START_TIMEOUT_MS = 15000;
const POLL_TIMEOUT_MS = 10000;
const MAX_PNG_BYTES = 4 << 20;

function slugOf(noun) {
  return String(noun || '').toLowerCase().replace(/^(a|an|the)\s+/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'prop';
}
function isPropId(id) { return ID_RE.test(String(id || '')); }
function finiteNum(v, lo, hi) { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi; }
// The cloud is trusted to generate, not to write arbitrary files: every field that reaches disk or the renderer
// is re-validated against the renderer's own limits (propremaster.js validate()).
function validResult(r) {
  if (!r || typeof r !== 'object') return false;
  const f = r.footprint || {}, b = r.bounds || {};
  return Number.isInteger(f.w) && Number.isInteger(f.h) && f.w >= 1 && f.w <= 16 && f.h >= 1 && f.h <= 16 &&
    finiteNum(b.x, -192, 192) && finiteNum(b.y, -192, 192) && finiteNum(b.width, 0.01, 192) && finiteNum(b.height, 0.01, 192) &&
    Number.isInteger(r.sourceWidth) && Number.isInteger(r.sourceHeight) && r.sourceWidth >= 1 && r.sourceWidth <= 4096 && r.sourceHeight >= 1 && r.sourceHeight <= 4096 &&
    typeof r.png === 'string' && r.png.length > 0 && typeof r.label === 'string';
}
function isPng(buf) { return buf && buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a; }

function makeUserProps(deps) {
  const { fs, path, dir, cloud, now } = deps;
  const doFetch = deps.fetch;
  const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer || ((t) => clearTimeout(t));
  const writeDurable = deps.writeDurable || ((d, file, data) => { fs.writeFileSync(file + '.tmp', data); fs.renameSync(file + '.tmp', file); });
  const indexFile = path.join(dir, 'index.json');
  const pendingFile = path.join(dir, 'pending.json');
  const live = new Map();       // jobId -> last public job state (for the UI)
  let timer = null, polling = false, stopped = false, chain = Promise.resolve();

  // mkdir failing here is not fatal by itself: the durable write right after it fails loudly if the folder is truly unusable
  function ensureDir() { try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { note('userprops.mkdir', e); } }
  // absent -> fallback; recovered from .bak -> that value; unreadable/corrupt -> fallback for READS only
  // (writeJsonResilient itself refuses to replace unreadable state, so a read fallback can never clobber it).
  function readJson(file, fallback) {
    const r = readJsonResilient({ fs }, file);
    return r.value && typeof r.value === 'object' ? r.value : fallback;
  }
  function writeJson(file, value) {
    ensureDir();
    writeJsonResilient({ fs, path, writeDurable }, file, value);
  }
  // serialize every index/pending mutation (single sidecar per WORKSPACES; in-process order is enough)
  // the CALLER gets p's rejection; the chain itself must keep going after a failed step
  function serial(fn) { const p = chain.then(fn, fn); chain = p.catch(swallow('userprops.serial')); return p; }

  function list() {
    const idx = readJson(indexFile, { props: [] });
    return (Array.isArray(idx.props) ? idx.props : []).filter((p) => p && isPropId(p.id));
  }
  // view 's' (front, <id>.png) or 'w' (the left-facing side view, <id>-w.png). Anything else is refused.
  function imageFile(id, view) {
    if (!isPropId(id)) return null;
    if (view != null && view !== 's' && view !== 'w') return null;
    const f = path.join(dir, id + (view === 'w' ? '-w' : '') + '.png');
    return f.startsWith(dir) ? f : null;
  }
  // ids the player deliberately deleted. The page must NOT keep these in a save (made props are otherwise protected
  // from pruning), or a copy in another crew member's station would linger as a placeholder forever.
  function deleted() {
    const idx = readJson(indexFile, { props: [] });
    return (Array.isArray(idx.deleted) ? idx.deleted : []).filter(isPropId);
  }
  function pending() { const p = readJson(pendingFile, { jobs: [] }); return Array.isArray(p.jobs) ? p.jobs : []; }

  function cloudCfg() {
    const c = (cloud && cloud()) || {};
    const url = String(c.url || '').replace(/\/+$/, '');
    return url && c.token ? { url, token: String(c.token) } : null;
  }
  async function request(method, url, token, body, timeoutMs) {
    const ac = new AbortController();
    const t = setTimer(() => ac.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
      let j = null; try { j = await res.json(); } catch (_) { j = null; }
      return { status: res.status, ok: res.ok, j };
    } finally { clearTimer(t); }
  }

  async function start(rawNoun) {
    const noun = String(rawNoun == null ? '' : rawNoun).replace(/\s+/g, ' ').trim();
    if (!noun) return { ok: false, code: 'empty', message: 'Describe an object.' };
    if (noun.length > 60) return { ok: false, code: 'too_long', message: 'Keep it under 60 characters.' };
    const c = cloudCfg();
    if (!c) return { ok: false, code: 'not_linked', message: 'Making props uses StarNet credits. Link this station under SETTINGS → PROVIDERS first.' };
    let r;
    try { r = await request('POST', c.url + '/v1/props/generate', c.token, { noun }, START_TIMEOUT_MS); }
    catch (_) { return { ok: false, code: 'unreachable', message: 'StarNet could not be reached. Check your connection and try again.' }; }
    const cloudMsg = r.j && r.j.error && r.j.error.message ? String(r.j.error.message).slice(0, 200) : '';
    if (r.status === 402) return { ok: false, code: 'insufficient_credits', message: 'Out of StarNet credits. Top up under SETTINGS → PROVIDERS.' };
    if (r.status === 401 || r.status === 403) return { ok: false, code: 'not_linked', message: 'This station’s StarNet link is no longer valid. Relink it under SETTINGS → PROVIDERS.' };
    if (r.status === 429) return { ok: false, code: 'busy', message: cloudMsg || 'Too many props right now. Try again shortly.' };
    if (r.status === 400) return { ok: false, code: (r.j && r.j.error && r.j.error.code) || 'invalid', message: cloudMsg || 'That description was not accepted.' };
    if (r.status === 404) return { ok: false, code: 'unsupported', message: 'Your StarNet account server does not offer prop making yet.' };
    const job = r.j && r.j.job;
    if (!r.ok || !job || typeof job.id !== 'string' || !/^pj_[A-Za-z0-9]{8,64}$/.test(job.id)) return { ok: false, code: 'cloud_error', message: cloudMsg || 'StarNet could not start that prop.' };
    await serial(() => { const jobs = pending().filter((j) => j.id !== job.id); jobs.push({ id: job.id, noun, startedAt: now() }); writeJson(pendingFile, { jobs }); });
    live.set(job.id, { ...publicJob(job), noun });
    schedule(0);
    return { ok: true, job: live.get(job.id) };
  }

  function publicJob(j) {
    return { id: j.id, noun: j.noun, status: j.status, step: j.step, tries: j.tries || 0, maxTries: j.maxTries || 3,
      costUsd: Number(j.costUsd) || 0, costPending: !!j.costPending, error: j.error ? { code: String(j.error.code || 'failed'), message: String(j.error.message || '').slice(0, 240) } : null, propId: j.propId || null };
  }

  async function land(jobId, noun, result, costUsd) {
    return serial(() => {
      const existing = list().find((p) => p.jobId === jobId);
      if (existing) return existing;   // idempotent: a second poll of a finished job never duplicates the prop
      const png = Buffer.from(result.png, 'base64');
      if (!isPng(png) || png.length > MAX_PNG_BYTES || png.readUInt32BE(16) !== result.sourceWidth || png.readUInt32BE(20) !== result.sourceHeight) throw new Error('bad prop image');
      const id = 'user_' + slugOf(noun) + '_' + jobId.slice(-6).toLowerCase().replace(/[^a-z0-9]/g, '0');
      ensureDir();
      writeDurable({ fs, path }, path.join(dir, id + '.png'), png);
      const entry = { id, jobId, noun, label: String(result.label).slice(0, 24), like: String(result.like || '').slice(0, 80), symmetric: result.symmetric === true,
        footprint: { w: result.footprint.w, h: result.footprint.h }, bounds: { x: result.bounds.x, y: result.bounds.y, width: result.bounds.width, height: result.bounds.height },
        sourceWidth: result.sourceWidth, sourceHeight: result.sourceHeight, costUsd: Number(costUsd) || 0, createdAt: now() };
      const props = list().concat([entry]);
      writeJson(indexFile, { version: 1, props, deleted: deleted() });
      return entry;
    });
  }

  // ---- SIDE VIEW: turn a made prop's accepted front view into its left-facing side view (the cloud keeps the
  // height; the station stores <id>-w.png and the side footprint on the index entry). Same pending ledger.
  async function startSide(propId) {
    const entry = list().find((p) => p.id === propId);
    if (!entry) return { ok: false, code: 'not_found', message: 'No such made prop.' };
    if (entry.side) return { ok: false, code: 'exists', message: 'This prop already has a side view.' };
    if (entry.symmetric) return { ok: false, code: 'symmetric', message: 'This prop looks the same from every side, so it already turns for free.' };
    if (pending().some((j) => j.kind === 'side' && j.propId === propId)) return { ok: false, code: 'busy', message: 'A side view for this prop is already being made.' };
    const c = cloudCfg();
    if (!c) return { ok: false, code: 'not_linked', message: 'Making props uses StarNet credits. Link this station under SETTINGS \u2192 PROVIDERS first.' };
    let png;
    try { png = fs.readFileSync(imageFile(propId)); } catch (_) { return { ok: false, code: 'missing_art', message: 'This prop\u2019s front view is missing on disk.' }; }
    let r;
    try { r = await request('POST', c.url + '/v1/props/side', c.token, { noun: entry.noun, front: { png: png.toString('base64'), footprint: entry.footprint, bounds: { height: entry.bounds.height } } }, START_TIMEOUT_MS); }
    catch (_) { return { ok: false, code: 'unreachable', message: 'StarNet could not be reached. Check your connection and try again.' }; }
    const cloudMsg = r.j && r.j.error && r.j.error.message ? String(r.j.error.message).slice(0, 200) : '';
    if (r.status === 402) return { ok: false, code: 'insufficient_credits', message: 'Out of StarNet credits. Top up under SETTINGS \u2192 PROVIDERS.' };
    if (r.status === 401 || r.status === 403) return { ok: false, code: 'not_linked', message: 'This station\u2019s StarNet link is no longer valid. Relink it under SETTINGS \u2192 PROVIDERS.' };
    if (r.status === 429) return { ok: false, code: 'busy', message: cloudMsg || 'Too many props right now. Try again shortly.' };
    if (r.status === 404) return { ok: false, code: 'unsupported', message: 'Your StarNet account server does not offer side views yet.' };
    const job = r.j && r.j.job;
    if (!r.ok || !job || typeof job.id !== 'string' || !/^pj_[A-Za-z0-9]{8,64}$/.test(job.id)) return { ok: false, code: 'cloud_error', message: cloudMsg || 'StarNet could not start that side view.' };
    await serial(() => { const jobs = pending().filter((j) => j.id !== job.id); jobs.push({ id: job.id, noun: entry.noun, kind: 'side', propId, startedAt: now() }); writeJson(pendingFile, { jobs }); });
    live.set(job.id, { ...publicJob(job), noun: entry.noun, kind: 'side', propId });
    schedule(0);
    return { ok: true, job: live.get(job.id) };
  }
  function validSide(r) {
    return !!r && r.view === 'w' && validResult({ ...r, label: 'side' });
  }
  async function landSide(propId, jobId, result, costUsd) {
    return serial(() => {
      const props = list();
      const entry = props.find((p) => p.id === propId);
      if (!entry) throw new Error('prop gone');
      if (entry.side) return entry;   // idempotent
      const png = Buffer.from(result.png, 'base64');
      if (!isPng(png) || png.length > MAX_PNG_BYTES || png.readUInt32BE(16) !== result.sourceWidth || png.readUInt32BE(20) !== result.sourceHeight) throw new Error('bad side image');
      writeDurable({ fs, path }, imageFile(propId, 'w'), png);
      entry.side = { jobId, footprint: { w: result.footprint.w, h: result.footprint.h }, bounds: { x: result.bounds.x, y: result.bounds.y, width: result.bounds.width, height: result.bounds.height },
        sourceWidth: result.sourceWidth, sourceHeight: result.sourceHeight, costUsd: Number(costUsd) || 0, createdAt: now() };
      writeJson(indexFile, { version: 1, props, deleted: deleted() });
      return entry;
    });
  }
  // The player's SIZE for a made prop (library-wide). Only a number is stored; the page derives the box from it.
  const SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  async function setScale(propId, scale) {
    if (!isPropId(propId)) return { ok: false, code: 'bad_id', message: 'No such made prop.' };
    const s = Number(scale);
    if (!SCALES.includes(s)) return { ok: false, code: 'bad_scale', message: 'Pick a size from 50% to 300%.' };
    return serial(() => {
      const props = list();
      const entry = props.find((p) => p.id === propId);
      if (!entry) return { ok: false, code: 'not_found', message: 'No such made prop.' };
      entry.scale = s;
      writeJson(indexFile, { version: 1, props, deleted: deleted() });
      return { ok: true, id: propId, scale: s };
    });
  }
  // Delete a made prop: its files and index entry go, its id is tombstoned. Refused while a job for it runs.
  // Credits already spent are not refunded (the cloud billed real upstream work) — the page says so.
  async function remove(propId) {
    if (!isPropId(propId)) return { ok: false, code: 'bad_id', message: 'No such made prop.' };
    if (pending().some((j) => j.propId === propId)) return { ok: false, code: 'busy', message: 'A side view for this prop is still being made. Delete it once that finishes.' };
    return serial(() => {
      const props = list();
      if (!props.some((p) => p.id === propId)) return { ok: false, code: 'not_found', message: 'No such made prop.' };
      writeJson(indexFile, { version: 1, props: props.filter((p) => p.id !== propId), deleted: deleted().concat([propId]).slice(-500) });
      for (const v of ['s', 'w']) { try { fs.rmSync(imageFile(propId, v), { force: true }); } catch (e) { note('userprops.remove.file', e); } }
      return { ok: true, id: propId };
    });
  }

  async function pollOnce() {
    const c = cloudCfg();
    const jobs = pending();
    if (!c || !jobs.length) return jobs.length;
    for (const pj of jobs) {
      let r;
      try { r = await request('GET', c.url + '/v1/props/jobs/' + encodeURIComponent(pj.id), c.token, null, POLL_TIMEOUT_MS); }
      catch (_) { continue; }   // offline: keep the job, try again next tick
      if (r.status === 404) {
        // the cloud no longer knows it (expired or restarted). Its completed calls stay billed in /v1/history.
        live.set(pj.id, { ...(live.get(pj.id) || { id: pj.id, noun: pj.noun }), status: 'failed', error: { code: 'lost', message: 'StarNet lost track of this prop before it finished. Any completed steps are in your credit history.' } });
        await serial(() => writeJson(pendingFile, { jobs: pending().filter((j) => j.id !== pj.id) }));
        continue;
      }
      const job = r.j && r.j.job;
      if (!r.ok || !job) continue;
      const pub = { ...publicJob(job), noun: pj.noun };
      if (pj.kind === 'side') { pub.kind = 'side'; pub.propId = pj.propId; }
      if (job.status === 'done' && pj.kind === 'side') {
        if (!validSide(job.result)) { pub.status = 'failed'; pub.error = { code: 'bad_result', message: 'StarNet returned a side view this station could not use.' }; }
        else {
          try { await landSide(pj.propId, pj.id, job.result, job.costUsd); }
          catch (_) { pub.status = 'failed'; pub.error = { code: 'bad_result', message: 'StarNet returned a side view this station could not use.' }; }
        }
      } else if (job.status === 'done') {
        if (!validResult(job.result)) { pub.status = 'failed'; pub.error = { code: 'bad_result', message: 'StarNet returned a prop this station could not use.' }; }
        else {
          try { const entry = await land(pj.id, pj.noun, job.result, job.costUsd); pub.propId = entry.id; }
          catch (_) { pub.status = 'failed'; pub.error = { code: 'bad_result', message: 'StarNet returned a prop this station could not use.' }; }
        }
      }
      live.set(pj.id, pub);
      if (pub.status === 'done' || pub.status === 'failed') {
        await serial(() => writeJson(pendingFile, { jobs: pending().filter((j) => j.id !== pj.id) }));
        if (deps.onSettled) { try { deps.onSettled(pub); } catch (e) { note('userprops.onSettled', e); } }
      }
    }
    return pending().length;
  }

  function schedule(ms) {
    if (stopped || timer) return;
    timer = setTimer(async () => {
      timer = null;
      if (polling) return schedule(POLL_MS);
      polling = true;
      let left = 0;
      try { left = await pollOnce(); } catch (_) { left = pending().length; }
      polling = false;
      if (left) schedule(POLL_MS);
    }, ms);
  }

  function job(id) {
    if (live.has(id)) return live.get(id);
    const pj = pending().find((j) => j.id === id);
    if (pj) return { id, noun: pj.noun, kind: pj.kind || 'front', status: 'running', step: 'waiting', tries: 0, maxTries: 3, costUsd: 0, costPending: false, error: null, propId: pj.propId || null };
    const sided = list().find((p) => p.side && p.side.jobId === id);
    if (sided) return { id, noun: sided.noun, kind: 'side', status: 'done', step: 'done', tries: 0, maxTries: 3, costUsd: sided.side.costUsd, costPending: false, error: null, propId: sided.id };
    const landed = list().find((p) => p.jobId === id);
    return landed ? { id, noun: landed.noun, status: 'done', step: 'done', tries: 0, maxTries: 3, costUsd: landed.costUsd, costPending: false, error: null, propId: landed.id } : null;
  }

  function resume() { if (pending().length) schedule(0); }
  function stop() { stopped = true; if (timer) { clearTimer(timer); timer = null; } }
  function activeJobs() { return pending().map((pj) => job(pj.id)).filter(Boolean); }

  return { list, deleted, remove, setScale, imageFile, start, startSide, job, activeJobs, resume, stop, pollOnce, _internals: { slugOf, validResult, isPropId } };
}

module.exports = { makeUserProps, isPropId };
