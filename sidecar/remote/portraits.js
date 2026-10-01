/* sidecar/remote/portraits.js — an agent's own sprite, for a phone's crew list.

   The desk shows each agent as its skin's south-facing sprite (frontend/app/agentportraits.js). A phone shows
   the same art: this reads that one file from the shipped frontend. The skin table is the frontend's own
   (frontend/app/data-shim.js, DATA.SKINS) read as text, so a new skin needs no change here. An unknown skin
   falls back to the default one, exactly as the renderer does.

     const p = makePortraits({ fs, path, frontend })
     p.forSkin('ultron') -> { skin, mime: 'image/png', data: <base64> } | null */
'use strict';

const { note } = require('../failopen.js');

const MAX_BYTES = 256 * 1024;

function makePortraits(deps) {
  const fs = deps.fs, path = deps.path, frontend = deps.frontend;
  let table = null;            // skin -> sprite set
  let fallback = 'blank';
  const cache = new Map();     // skin -> { skin, mime, data } | null

  function load() {
    if (table) return table;
    table = new Map();
    try {
      const src = fs.readFileSync(path.join(frontend, 'app', 'data-shim.js'), 'utf8');
      const re = /^\s*([A-Za-z0-9_]+):\s*\{"name":"[^"]*","set":"([A-Za-z0-9_]+)"/gm;
      let m;
      while ((m = re.exec(src))) table.set(m[1], m[2]);
      const d = /DATA\.DEFAULT_SKIN\s*=\s*'([A-Za-z0-9_]+)'/.exec(src);
      if (d && table.has(d[1])) fallback = d[1];
    } catch (e) { note('remote.portraits.table', e); }
    return table;
  }

  function forSkin(skin) {
    const t = load();
    const key = t.has(String(skin || '')) ? String(skin) : fallback;
    if (cache.has(key)) return cache.get(key);
    let out = null;
    const set = t.get(key);
    if (set) {
      try {
        const buf = fs.readFileSync(path.join(frontend, 'assets', 'sprites', set, 'rot_south.png'));
        if (buf.length && buf.length <= MAX_BYTES) out = { skin: key, mime: 'image/png', data: buf.toString('base64') };
      } catch (e) { note('remote.portraits.read', e); }
    }
    cache.set(key, out);
    return out;
  }

  /* One sprite TRACK (every frame of e.g. "approved_android.walk.south-east"), for the phone to draw a moving crew
     member with the same drawings the stage uses. Only names the frontend's own sprite manifest lists. */
  let manifest = null;
  const tracks = new Map();
  function framesFor(key) {
    const k = String(key || '');
    if (!/^[A-Za-z0-9_]{1,40}\.[a-z_]{1,20}\.[a-z-]{1,20}$/.test(k)) return null;
    if (tracks.has(k)) return tracks.get(k);
    if (!manifest) {
      try { manifest = JSON.parse(fs.readFileSync(path.join(frontend, 'assets', 'sprites', 'manifest.json'), 'utf8')).sprites || {}; }
      catch (e) { note('remote.portraits.manifest', e); manifest = {}; }
    }
    const list = Array.isArray(manifest[k]) ? manifest[k].slice(0, 32) : null;
    let out = null;
    if (list && list.length) {
      const root = path.join(frontend, 'assets', 'sprites');
      const frames = [];
      for (const rel of list) {
        const abs = path.resolve(root, String(rel));
        if (abs.indexOf(root + path.sep) !== 0 || !/\.png$/i.test(abs)) { frames.length = 0; break; }
        try { const buf = fs.readFileSync(abs); if (buf.length > MAX_BYTES) { frames.length = 0; break; } frames.push(buf.toString('base64')); }
        catch (e) { note('remote.portraits.frame', e); frames.length = 0; break; }
      }
      if (frames.length) out = { key: k, mime: 'image/png', frames };
    }
    if (tracks.size > 400) tracks.clear();
    tracks.set(k, out);
    return out;
  }

  return { forSkin, framesFor, skins: () => Array.from(load().keys()) };
}

module.exports = { makePortraits };
