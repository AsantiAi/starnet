/* STARNET — remoteview.js : the picture of this station that a paired phone sees.

   StarNet Remote's phone app has a STATION view. The station is drawn by THIS page (the sidecar has no
   renderer), so this page draws it: World.renderStill() runs the real scene pass — floor, walls, props, the
   crew where they really stand, light — onto an offscreen canvas framed on the whole station, and the still is
   handed to the sidecar (POST /api/remote/view), which passes it to the phone over the sealed channel.

   WHEN IT DRAWS (an idle station does no extra work):
     · GET /api/remote/view says whether Remote is on and whether a phone is looking right now.
     · Remote off: nothing is drawn; it looks again once a minute.
     · Remote on: one picture when the floor is up (so a phone that opens later has something, stamped with its
       age), then a fresh one every few seconds only while a phone is looking.

   TRUTH RULE: the picture is whatever the real renderer drew at that moment, stamped by the sidecar with the
   time it arrived. Nothing is staged for the phone, and the phone shows the picture's age.

   Plain init()/reset(), never emits, fail-open (a failed draw or upload changes nothing). */
'use strict';
const RemoteView = (() => {
  const IDLE_MS = 60000;      // Remote is off: look again this often
  const WATCH_MS = 6000;      // Remote is on, nobody looking
  const LIVE_MS = 3000;       // a phone is looking: redraw this often
  const MAX_PX = 1600;        // longest side of the still
  let timer = null, busy = false, sentOnce = false, started = false;

  const hasWorld = () => typeof World !== 'undefined' && World && typeof World.renderStill === 'function';

  async function getJson(url) {
    try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) return null; return (await r.json()) || null; }
    catch (_) { return null; }
  }

  function blobOf(canvas, type, q) {
    return new Promise((resolve) => { try { canvas.toBlob((b) => resolve(b || null), type, q); } catch (_) { resolve(null); } });
  }
  function base64Of(blob) {
    return new Promise((resolve) => {
      try {
        const fr = new FileReader();
        fr.onload = () => { const s = String(fr.result || ''); const i = s.indexOf(','); resolve(i >= 0 ? s.slice(i + 1) : ''); };
        fr.onerror = () => resolve('');
        fr.readAsDataURL(blob);
      } catch (_) { resolve(''); }
    });
  }
  // WebP where the engine can write it (small, sharp pixel art); JPEG otherwise. Never a multi-megabyte PNG.
  async function encode(canvas) {
    let blob = await blobOf(canvas, 'image/webp', 0.82);
    if (!blob || blob.type !== 'image/webp') blob = await blobOf(canvas, 'image/jpeg', 0.85);
    if (!blob || !/^image\/(webp|jpeg)$/.test(blob.type)) return null;
    const data = await base64Of(blob);
    return data ? { mime: blob.type, data } : null;
  }

  async function draw() {
    if (!hasWorld()) return false;
    let still = null;
    try { still = World.renderStill(MAX_PX); } catch (_) { still = null; }
    if (!still || !still.canvas) return false;
    const enc = await api._internals.encode(still.canvas);
    if (!enc) return false;
    try {
      const r = await fetch('/api/remote/view', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mime: enc.mime, w: still.width, h: still.height, bodies: still.bodies || [], data: enc.data }) });
      return !!(r && r.ok);
    } catch (_) { return false; }
  }

  // one look at the station's answer, maybe one picture; returns how long to wait before the next look
  async function step() {
    const s = await getJson('/api/remote/view');
    if (!s || !s.enabled) { sentOnce = false; return IDLE_MS; }
    if (s.want || !sentOnce || !s.at) { if (await draw()) sentOnce = true; }
    return s.want ? LIVE_MS : WATCH_MS;
  }

  function schedule(ms) { if (timer) clearTimeout(timer); timer = setTimeout(tick, ms); }
  async function tick() {
    timer = null;
    if (busy) return;
    busy = true;
    let next = WATCH_MS;
    try { next = await step(); } catch (_) { next = WATCH_MS; }
    finally { busy = false; }
    if (started) schedule(next);
  }

  function init() {
    if (started) return;
    started = true;
    schedule(4000);   // after the floor is up and the first frames have drawn
  }
  function reset() { started = false; sentOnce = false; if (timer) { clearTimeout(timer); timer = null; } }

  const api = { init, reset, _internals: { step, draw, encode, IDLE_MS, WATCH_MS, LIVE_MS } };
  return api;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { RemoteView };
