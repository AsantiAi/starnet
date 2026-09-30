/* sidecar/apps.js — APPS: describe what you want, get a real app inside StarNet (2026-09-29).

   "I want a Daily AI News Brief" → a window in the station, drawn with the station's own glass UI, that fills itself
   on a schedule. No manifests, approvals, terminals or folders to think about: an app is
     · a PAGE the crew writes (HTML with the station kit — served sandboxed, scripts only, NO network),
     · its DATA (a private store the page reads; the crew publishes into it with app.publish),
     · an optional SCHEDULE (an ordinary routine that runs the app's task — "research today's AI news" — and
       publishes the result). Every 24h the brief refreshes itself; you just open the window.
   Changing it is vibe coding: describe the change, the crew rewrites the page.

   WHY NO APPROVAL STEP: an app page can only draw. Its frame is an opaque-origin sandbox with the network switched
   off (connect-src/form-action 'none', no popups — the /plugin-draft/ lockdown), it cannot read the station, its
   token or other apps, and the only data it ever sees is what its own scheduled run published. Anything that
   touches the world (the web research, a write somewhere) happens in an ordinary crew run under the station's
   normal consent and taint rules — never in the page. (Code that runs in the station with full power is what
   plugins are for; apps never have any.)

   makeApps({ fsp, path, dir, store, treeDigest, relPathOk, now, template, cron, notify }) -> api */
'use strict';
const { note } = require('./failopen.js');

const ID_RX = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MAX_FILE = 512 * 1024, MAX_FILES = 48, MAX_TOTAL = 6 * 1024 * 1024;
const TEXT_EXT = /\.(?:html?|css|m?js|json|svg|txt|md)$/i;
const META_KEY = '_meta';

function slugify(name) {
  return String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app';
}
function jsonOr(text) { try { return JSON.parse(text); } catch (_) { return text; } }   // plain text stays text
function plain(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }

function makeApps(deps) {
  const { fsp, path: P, dir, store, treeDigest, relPathOk } = deps;
  if (typeof deps.now !== 'function') throw new Error('apps requires an injected clock { now }');
  const now = deps.now;
  const template = deps.template;          // ({ id, name, description }) -> { 'index.html': text }
  const cron = deps.cron || null;          // { create(spec) -> {ok, job|error}, remove(jobId), get(jobId) -> job|null, armed() -> bool }
  const notify = deps.notify || { reload() {}, data() {} };
  const appDir = (id) => P.join(dir, id);
  const idOk = (id) => ID_RX.test(String(id || ''));
  // An app only ever retires a routine that is really ITS OWN (meta.appId): a jobId that points anywhere else —
  // however it got into app.json — is never removed on the app's behalf.
  const ownJob = (id, jobId) => { const j = cron && cron.get(jobId); return !j || !!(j.meta && j.meta.appId === id); };
  const digests = new Map();   // id -> { rec, at }
  const gens = new Map();      // id -> n, bumped by every write: an in-flight record() must not cache a pre-write digest
  const dirty = (id) => { gens.set(id, (gens.get(id) || 0) + 1); digests.delete(id); };

  async function readMeta(id) {
    try { return JSON.parse(await fsp.readFile(P.join(appDir(id), 'app.json'), 'utf8')); } catch (_) { return null; }
  }
  async function writeMeta(id, meta) {
    await fsp.writeFile(P.join(appDir(id), 'app.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
    dirty(id);
  }
  async function need(id) {
    const a = String(id || '').trim();
    if (!idOk(a)) throw new Error('`app` is the app id, like "ai-news-brief"');
    const meta = await readMeta(a);
    if (!meta) throw new Error('there is no app "' + a + '" — see the APPS window, or create it with app.create');
    return { id: a, meta };
  }

  /* record(id) -> { id, dir, digest } — the serving record. The digest (of every file) is in the page URL, so a page
     the crew just rewrote is a new URL: the open window reloads onto it, never a stale cached page. */
  async function record(id) {
    if (!idOk(id)) return null;
    const c = digests.get(id);
    if (c && now() - c.at < 1500 && now() >= c.at) return c.rec;
    const gen = gens.get(id) || 0;
    const tree = await treeDigest(appDir(id));
    const rec = tree.error ? null : { id, dir: appDir(id), digest: tree.digest };
    if ((gens.get(id) || 0) === gen) digests.set(id, { rec, at: now() });
    return rec;
  }

  async function listFiles(id) {
    const base = appDir(id), out = [];
    async function walk(d, rel, depth) {
      if (depth > 6) return;
      let names = [];
      try { names = (await fsp.readdir(d)).sort(); } catch (_) { return; }
      for (const n of names) {
        const abs = P.join(d, n), r = rel ? rel + '/' + n : n;
        const st = await fsp.lstat(abs);
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) await walk(abs, r, depth + 1);
        else if (st.isFile()) out.push({ path: r, bytes: st.size });
      }
    }
    await walk(base, '', 0);
    return out;
  }

  // ---- lifecycle ------------------------------------------------------------------------------------------------
  async function create(spec) {
    const name = plain(spec && spec.name, 60);
    if (!name) throw new Error('give the app a name');
    const description = plain(spec && spec.description, 1500);
    await fsp.mkdir(dir, { recursive: true });
    let id = slugify(name), n = 1;
    // mkdir WITHOUT recursive claims the id atomically: two creates of the same name can never share a folder
    for (;;) {
      try { await fsp.mkdir(appDir(id)); break; }
      catch (e) { if (!e || e.code !== 'EEXIST' || n > 200) throw e; id = slugify(name).slice(0, 44) + '-' + (++n); }
    }
    try {
      const files = template({ id, name, description });
      for (const rel of Object.keys(files)) await fsp.writeFile(P.join(appDir(id), rel), files[rel], 'utf8');
      await writeMeta(id, { id, name, description, createdAt: now(), builtAt: null, schedule: null });
    } catch (e) {
      await fsp.rm(appDir(id), { recursive: true, force: true }).catch((e2) => note('apps.create-cleanup', e2));
      throw e;
    }
    notify.reload(id);   // the station page learns a new app exists (the APPS dock appears, its window opens)
    return { id, name, description };
  }
  async function remove(id) {
    const { meta } = await need(id);
    if (meta.schedule && meta.schedule.jobId && cron && ownJob(id, meta.schedule.jobId)) {
      try { await cron.remove(meta.schedule.jobId); }
      catch (e) { note('apps.remove-routine', e); throw new Error('its refresh routine could not be removed, so the app was kept — try again'); }
    }
    await fsp.rm(appDir(id), { recursive: true, force: true });
    try { await store.op(id, 'clear'); } catch (e) { note('apps.remove-data', e); }
    dirty(id);
    notify.reload(id);
    return true;
  }
  async function rename(id, name) {
    const { meta } = await need(id);
    const n = plain(name, 60);
    if (!n) throw new Error('give the app a name');
    meta.name = n;
    await writeMeta(id, meta);
    notify.reload(id);
    return meta;
  }

  // ---- files (the page) ------------------------------------------------------------------------------------------
  async function readFile(id, rel) {
    await need(id);
    const r = String(rel || '').replace(/^\.\//, '');
    if (!relPathOk(r)) throw new Error('`path` must be a file inside the app, like "index.html"');
    const text = await fsp.readFile(P.join(appDir(id), ...r.split('/')), 'utf8');
    return text.length > 64 * 1024 ? text.slice(0, 64 * 1024) + '\n…[truncated at 64 KB]' : text;
  }
  // the WHOLE file (app.check must compile what is really there, never a 64 KB view of it)
  async function readWhole(id, rel) {
    await need(id);
    const r = String(rel || '').replace(/^\.\//, '');
    if (!relPathOk(r)) throw new Error('`path` must be a file inside the app, like "index.html"');
    return fsp.readFile(P.join(appDir(id), ...r.split('/')), 'utf8');
  }
  async function writeFile(id, rel, content) {
    const { meta } = await need(id);
    const r = String(rel || '').replace(/^\.\//, '');
    // app.json is the station's (case-insensitive: Windows would let "App.json" overwrite it); 5 folders deep is
    // as far as the file walk (and so the size caps) can see
    if (!relPathOk(r) || r.toLowerCase() === 'app.json' || r.split('/').length > 5) throw new Error('`path` must be a page file inside the app (index.html, style.css, app.js …)');
    if (!TEXT_EXT.test(r)) throw new Error('only text files: .html .css .js .json .svg .txt .md');
    const text = String(content == null ? '' : content);
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > MAX_FILE) throw new Error('a file may be at most 512 KB');
    const files = await listFiles(id);
    if (!files.some(f => f.path === r) && files.length >= MAX_FILES) throw new Error('an app may hold at most ' + MAX_FILES + ' files');
    if (files.reduce((t, f) => t + (f.path === r ? 0 : f.bytes), 0) + bytes > MAX_TOTAL) throw new Error('an app may hold at most 6 MB');
    const abs = P.join(appDir(id), ...r.split('/'));
    await fsp.mkdir(P.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, text, 'utf8');
    dirty(id);
    if (!meta.builtAt) { meta.builtAt = now(); await writeMeta(id, meta); }   // the crew has written the page: it is no longer "not built yet"
    const rec = await record(id);
    notify.reload(id, rec && rec.digest);
    return { path: r, bytes };
  }

  // ---- data ------------------------------------------------------------------------------------------------------
  async function publish(id, key, value) {
    await need(id);
    const k = String(key || '');
    if (k === META_KEY) throw new Error('"' + META_KEY + '" is kept by the station');
    // Models often send the JSON as TEXT ("{\"items\":[…]}"): the page would then read a string with no .items and
    // show nothing. Text that is a JSON object or array is stored as that value.
    if (typeof value === 'string' && /^\s*[[{]/.test(value)) value = jsonOr(value);
    const r = await store.op(id, 'set', k, value);
    if (!r.ok) throw new Error(String(r.error || 'the data could not be saved').replace(/this plugin/g, 'this app'));
    const m = await store.op(id, 'set', META_KEY, { updatedAt: now(), key: k });
    if (!m.ok) note('apps.publish-meta', new Error(String(m.error)));
    notify.data(id);
    return { key: k };
  }
  async function dataKeys(id) {
    const r = await store.op(id, 'keys');
    return (r.ok ? r.value : []).filter(k => k !== META_KEY);
  }
  async function dataGet(id, key) {
    const r = await store.op(id, 'get', key);
    return r.ok ? r.value : null;
  }

  // ---- schedule (an ordinary routine; the app remembers which) --------------------------------------------------
  async function schedule(id, spec) {
    const { meta } = await need(id);
    if (!cron) throw new Error('routines are not available on this station');
    const every = plain(spec && spec.every, 80);
    const task = plain(spec && spec.task, 2000);
    const old = (meta.schedule && meta.schedule.jobId && ownJob(id, meta.schedule.jobId)) ? meta.schedule.jobId : null;
    const retire = async () => { if (old) { try { await cron.remove(old); } catch (e) { note('apps.replace-routine', e); } } };
    if (!every || /^(?:off|none|never|stop)$/i.test(every)) {
      await retire();
      meta.schedule = null;
      await writeMeta(id, meta);
      notify.reload(id, (await record(id) || {}).digest);
      return { off: true };
    }
    if (!task) throw new Error('say what each refresh should do (`task`), e.g. "research today\'s top AI news and publish a brief"');
    const prompt = 'Refresh the StarNet app "' + meta.name + '" (app id: ' + id + ').\n\n' +
      'FIRST call app.read { app: "' + id + '" } (find it with tool.search "app read"): it states TODAY\'s real date — your own sense of the date is out of date. The task is about today.\n\n' +
      'TASK: ' + task + '\n\n' +
      'When you have the result, save it with the app.publish tool (find it with tool.search "app publish"): app "' + id + '", ' +
      'using the SAME key and data shape the app\'s page reads (check with app.read { app: "' + id + '" } if unsure). ' +
      'Publishing is what the Commander sees — a refresh that does not publish did nothing.';
    const out = await cron.create({ name: 'App: ' + meta.name, schedule: every, prompt, agentId: 'agent', meta: { appId: id } });
    if (!out.ok) throw new Error(out.error || 'the routine could not be created');
    // the routine must be THIS app's own new one — never an existing routine handed back as a "duplicate"
    if (out.job.id === old || !out.job.meta || out.job.meta.appId !== id) throw new Error('the routine could not be created (the station answered with another routine)');
    await retire();
    meta.schedule = { jobId: out.job.id, every, task };
    await writeMeta(id, meta);
    notify.reload(id, (await record(id) || {}).digest);   // app.json is part of the page's version: move the open window onto it
    return { jobId: out.job.id, display: out.job.scheduleDisplay || every, armed: cron.armed() };
  }

  // ---- listing ---------------------------------------------------------------------------------------------------
  async function describe(id) {
    const meta = await readMeta(id);
    if (!meta) return null;
    const rec = await record(id);
    const m = await dataGet(id, META_KEY);
    let sched = null;
    if (meta.schedule && meta.schedule.jobId && cron) {
      const job = cron.get(meta.schedule.jobId);
      sched = job ? {
        jobId: job.id, every: meta.schedule.every, display: job.scheduleDisplay || meta.schedule.every,
        enabled: job.enabled !== false, nextRunAt: job.nextRunAt || null, lastRunAt: job.lastRunAt || null,
        lastStatus: job.lastStatus || null, lastError: job.lastError || null, armed: cron.armed()
      } : { jobId: meta.schedule.jobId, every: meta.schedule.every, missing: true };
    }
    return {
      id, name: meta.name, description: meta.description || '', createdAt: meta.createdAt || null, builtAt: meta.builtAt || null,
      digest: rec ? rec.digest : null, updatedAt: (m && m.updatedAt) || null, schedule: sched
    };
  }
  async function list() {
    let names = [];
    try { names = (await fsp.readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name); } catch (_) { return []; }
    const out = [];
    for (const n of names.sort()) { if (!idOk(n)) continue; const d = await describe(n); if (d) out.push(d); }
    return out;
  }

  return { create, remove, rename, record, readFile, readWhole, writeFile, listFiles, publish, dataKeys, dataGet, schedule, describe, list, need, META_KEY };
}

module.exports = { makeApps, slugify };
