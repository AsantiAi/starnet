/* sidecar/remote/view.js — the station picture a phone sees.

   The sidecar has no renderer: the station is drawn by the desk page. So the desk page draws a still of the
   whole station with its own renderer (World.renderStill) and hands it here; a phone reads it through the
   gateway's `view` verb. This module only HOLDS the latest still and remembers whether a phone is looking.

   Truth rules:
     · the picture is always stamped with when the desk drew it (`at`). A phone shows that age; it never calls
       an old picture live.
     · nothing is kept on disk. A station that restarts has no picture until a desk page draws one.
     · the desk only draws while a phone is looking (wanted()), plus one picture when it opens, so an idle
       station does no extra work.

     const view = makeRemoteView({ now })
     view.put({ mime, w, h, bodies, data })  -> { ok } | { ok:false, error }     (data = base64 image bytes)
     view.want()                             a phone asked; the desk should keep the picture fresh for a while
     view.wanted()                           is a phone looking right now?
     view.meta()                             { at, w, h, mime, size, bodies } | null
     view.read(offset, length)               Buffer slice of the image
     view.putCrew(bodies)                    where the crew are right now (the desk's crew stream), still pixels
     view.crew()                             { at, bodies } | null
   A still marked crewFree has no bodies in it: the phone draws the crew itself from the crew stream, which is
   what lets them move smoothly between stills. */
'use strict';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 4096;
const MAX_BODIES = 200;
const WANT_MS = 25000;
const KEY_RE = /^[A-Za-z0-9_]{1,40}\.[a-z_]{1,20}\.[a-z-]{1,20}$/;   // <sprite set>.<track>.<facing>

// the three formats a canvas can export, told apart by their first bytes (never by what the caller claims)
function sniff(buf) {
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  return '';
}

function makeRemoteView(deps) {
  const now = deps && deps.now;
  if (typeof now !== 'function') throw new Error('makeRemoteView needs an injected clock (deps.now)');
  let still = null;      // { buf, mime, w, h, at, bodies, crewFree }
  let crew = null;       // { at, bodies:[{ agentId, key, idx, x, y, w, h, walking, working }] }
  let wantAt = 0;

  const dim = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 && n <= MAX_SIDE ? n : 0; };

  function put(o) {
    o = o || {};
    const w = dim(o.w), h = dim(o.h);
    if (!w || !h) return { ok: false, error: 'bad picture size' };
    if (typeof o.data !== 'string' || !o.data) return { ok: false, error: 'no picture' };
    if (o.data.length > Math.ceil(MAX_BYTES * 4 / 3) + 8) return { ok: false, error: 'picture too large' };
    const buf = Buffer.from(o.data, 'base64');
    if (!buf.length || buf.length > MAX_BYTES) return { ok: false, error: 'picture too large' };
    const mime = sniff(buf);
    if (!mime) return { ok: false, error: 'not a picture' };
    const bodies = [];
    for (const b of Array.isArray(o.bodies) ? o.bodies.slice(0, MAX_BODIES) : []) {
      if (!b || typeof b !== 'object') continue;
      const agentId = String(b.agentId == null ? '' : b.agentId);
      const x = Math.round(Number(b.x)), y = Math.round(Number(b.y));
      if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(agentId) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < 0 || y < 0 || x > w || y > h) continue;
      bodies.push({ agentId, x, y });
    }
    still = { buf, mime, w, h, at: now(), bodies, crewFree: o.crewFree === true };
    return { ok: true, at: still.at, bytes: buf.length };
  }

  function want() { wantAt = now(); }
  function wanted() { return wantAt > 0 && now() - wantAt < WANT_MS; }
  function meta() { return still ? { at: still.at, w: still.w, h: still.h, mime: still.mime, size: still.buf.length, bodies: still.bodies, crewFree: still.crewFree } : null; }

  const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 10) / 10 : null; };
  function putCrew(list) {
    if (!still) return { ok: false, error: 'no picture yet' };
    const out = [];
    for (const b of Array.isArray(list) ? list.slice(0, MAX_BODIES) : []) {
      if (!b || typeof b !== 'object') continue;
      const agentId = String(b.agentId == null ? '' : b.agentId), key = String(b.key || '');
      if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(agentId) || !KEY_RE.test(key)) continue;
      const x = num(b.x, -still.w, 2 * still.w), y = num(b.y, -still.h, 2 * still.h), w = num(b.w, 0.1, still.w), h = num(b.h, 0.1, still.h);
      const idx = Math.floor(Number(b.idx));
      if (x == null || y == null || w == null || h == null || !(idx >= 0 && idx < 64)) continue;
      out.push({ agentId, key, idx, x, y, w, h, walking: b.walking === true, working: b.working === true });
    }
    crew = { at: now(), bodies: out };
    return { ok: true, at: crew.at, bodies: out };
  }
  const crewNow = () => crew;
  function read(offset, length) {
    if (!still) return Buffer.alloc(0);
    const start = Math.max(0, Math.min(still.buf.length, Math.floor(Number(offset)) || 0));
    const len = Math.max(0, Math.floor(Number(length)) || 0);
    return still.buf.subarray(start, Math.min(still.buf.length, start + len));
  }
  function clear() { still = null; crew = null; wantAt = 0; }

  return { put, want, wanted, meta, read, clear, putCrew, crew: crewNow };
}

module.exports = { makeRemoteView, MAX_BYTES, WANT_MS };
