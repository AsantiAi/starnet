/* frontend/app/userprops.js — player-made props, page side.
   Boot: fetch the station's made props (GET /api/userprops), fetch each PNG with the API token (a blob URL, so
   the master token never rides in a URL), and register it: PropSprites.registerUserProp (catalog row) +
   PropRemaster.registerRuntime (raster art). Placed made props draw as a dim placeholder until their art is in.
   Make: POST /api/userprops/generate {noun} starts a StarNet-credits job; watch() polls the station (which polls
   the cloud and keeps the job on disk) until it settles, then loads the new prop. Every number shown to the
   player (cost, tries) is the job state the station reports, never a guess.
   Fires window 'starnet:userprops-changed' whenever the made-prop catalog changes (build.js re-renders). */
'use strict';
const UserProps = (() => {
  const registered = new Set();
  const sided = new Set();
  let props = [];
  let loading = null;
  const apiFetch = (url, init) => (typeof Harness !== 'undefined' && Harness.apiFetch) ? Harness.apiFetch(url, init) : fetch(url, init);
  const changed = () => { try { window.dispatchEvent(new CustomEvent('starnet:userprops-changed', { detail: { count: props.length } })); } catch (_) {} };

  async function decode(id, view) {
    const r = await apiFetch('/api/userprops/image?id=' + encodeURIComponent(id) + (view === 'w' ? '&view=w' : ''));
    if (!r.ok) throw new Error('image ' + r.status);
    const url = URL.createObjectURL(await r.blob());
    const im = new Image();
    try { await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('decode')); im.src = url; }); }
    catch (e) { URL.revokeObjectURL(url); throw e; }
    return { im, url };
  }
  async function register(p) {
    if (!p || registered.has(p.id) || typeof PropSprites === 'undefined' || !PropSprites.registerUserProp) return false;
    if (!PropSprites.registerUserProp(p)) return false;
    registered.add(p.id);
    if (typeof PropRemaster === 'undefined' || !PropRemaster.registerRuntime) return false;
    let d = null;
    try {
      d = await decode(p.id);
      const ok = await PropRemaster.registerRuntime(p.id, { image: p.id + '.png', sourceWidth: p.sourceWidth, sourceHeight: p.sourceHeight,
        footprint: { w: p.footprint.w, h: p.footprint.h }, bounds: p.bounds, mode: 'approved', exposure: 1, effects: false }, d.im);
      // A round object looks the same turned: its own front art IS its side view (box turned, same height), free.
      if (ok && p.symmetric && !p.side && PropSprites.registerUserSide) {
        const fp = { w: p.footprint.h, h: p.footprint.w }, H = p.bounds.height;
        if (PropSprites.registerUserSide(p.id, { footprint: fp })) {
          sided.add(p.id);
          await PropRemaster.registerRuntime(p.id, { image: p.id + '.png', sourceWidth: p.sourceWidth, sourceHeight: p.sourceHeight, footprint: fp,
            bounds: { x: -2, y: fp.h * 12 - H, width: fp.w * 12 + 4, height: H }, mode: 'approved', exposure: 1, effects: false }, d.im, 'w');
        }
      }
      return ok;
    } catch (_) { return false; }   // the row stays; the prop keeps its placeholder rather than vanishing
    finally { if (d) URL.revokeObjectURL(d.url); }
  }
  // the left-facing side view, once the station has one (made later, from REFIT)
  async function registerSide(p) {
    if (!p || !p.side || sided.has(p.id) || !registered.has(p.id) || !PropSprites.registerUserSide) return false;
    if (!PropSprites.registerUserSide(p.id, p.side)) return false;
    sided.add(p.id);
    if (typeof PropRemaster === 'undefined' || !PropRemaster.registerRuntime) return false;
    let d = null;
    try {
      d = await decode(p.id, 'w');
      return await PropRemaster.registerRuntime(p.id, { image: p.id + '-w.png', sourceWidth: p.side.sourceWidth, sourceHeight: p.side.sourceHeight,
        footprint: { w: p.side.footprint.w, h: p.side.footprint.h }, bounds: p.side.bounds, mode: 'approved', exposure: 1, effects: false }, d.im, 'w');
    } catch (_) { return false; }
    finally { if (d) URL.revokeObjectURL(d.url); }
  }
  function load() {
    if (loading) return loading;
    loading = (async () => {
      let j = null;
      try { const r = await apiFetch('/api/userprops'); j = r.ok ? await r.json() : null; } catch (_) { j = null; }
      if (j && Array.isArray(j.deleted) && PropSprites.markUserDeleted) PropSprites.markUserDeleted(j.deleted);
      if (j && Array.isArray(j.props)) {
        const before = props.map((p) => p.id).join(',');
        props = j.props;
        let any = false;
        for (const p of props) { if (await register(p)) any = true; if (await registerSide(p)) any = true; }
        if (any && PropSprites.userArtChanged) PropSprites.userArtChanged();
        // announce ONLY a real catalog change: build.js re-renders on this, and a panel render itself calls
        // load() to resume a running job — an unconditional event would loop (and wipe what the player typed).
        if (any || props.map((p) => p.id).join(',') !== before) changed();
      }
      return { props: props.slice(), jobs: (j && j.jobs) || [] };
    })().finally(() => { loading = null; });
    return loading;
  }
  async function generate(noun) {
    try {
      const r = await apiFetch('/api/userprops/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noun }) });
      return await r.json();
    } catch (_) { return { ok: false, code: 'unreachable', message: 'The station did not answer. Try again.' }; }
  }
  async function makeSide(id) {
    try {
      const r = await apiFetch('/api/userprops/side', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      return await r.json();
    } catch (_) { return { ok: false, code: 'unreachable', message: 'The station did not answer. Try again.' }; }
  }
  // delete a made prop from the station's library; the caller removes placed copies and the catalog row
  async function remove(id) {
    try {
      const r = await apiFetch('/api/userprops/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const j = await r.json();
      if (j && j.ok) { props = props.filter((p) => p.id !== id); registered.delete(id); sided.delete(id); }
      return j;
    } catch (_) { return { ok: false, code: 'unreachable', message: 'The station did not answer. Try again.' }; }
  }
  async function job(id) {
    try { const r = await apiFetch('/api/userprops/job?id=' + encodeURIComponent(id)); return await r.json(); }
    catch (_) { return { ok: false, code: 'unreachable' }; }
  }
  // Poll one job until it settles. onUpdate(job) on every change; resolves with the final job.
  function watch(id, onUpdate) {
    return new Promise((resolve) => {
      let last = '';
      const tick = async () => {
        const r = await job(id);
        const j = r && r.ok ? r.job : null;
        if (j) {
          const sig = JSON.stringify(j);
          if (sig !== last) { last = sig; try { onUpdate && onUpdate(j); } catch (_) {} }
          if (j.status === 'done' || j.status === 'failed') { if (j.status === 'done') await load(); resolve(j); return; }
        }
        setTimeout(tick, 2500);
      };
      tick();
    });
  }
  const list = () => props.slice();
  if (typeof window !== 'undefined') setTimeout(() => { load(); }, 0);
  const get = (id) => props.find((p) => p.id === id) || null;
  return { load, list, get, generate, makeSide, remove, job, watch };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = UserProps;
