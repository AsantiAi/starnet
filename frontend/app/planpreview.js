/* frontend/app/planpreview.js — the station builder's approval card DRAWS its plan (vibe design, 2026-09-29).

   Before the Commander approves, the card shows where the build goes and what goes where: the station's rooms as flat
   plates (dimmed), the room the plan adds or changes lit, each zone outlined and numbered, and what will stand there.
   The same recipe as the station preset cards (build.js showStationBuilds): plank decks warm, others steel, belts in the
   accent, equipment gold, every other piece green. The data is StationBuilder's plan.preview, read from the plan the
   page parked (StationCommands.previewFor), never from the model's words. */
'use strict';
const PlanPreview = (() => {
  const W = 230, H = 120;   // drawing units (the canvas is twice this, for crisp plates)
  function el(pv) {
    if (!pv || !Array.isArray(pv.rooms) || !pv.rooms.length) return null;
    const fig = document.createElement('figure'); fig.className = 'consent-plan';
    const cv = document.createElement('canvas'); cv.width = W * 2; cv.height = H * 2; cv.setAttribute('aria-hidden', 'true');
    fig.appendChild(cv);
    const ctx = cv.getContext && cv.getContext('2d');
    if (ctx) draw(ctx, pv);
    if (Array.isArray(pv.zones) && pv.zones.length) {
      const cap = document.createElement('figcaption');
      cap.textContent = pv.zones.map((z, i) => (i + 1) + ' · ' + z.where + ': ' + z.label).join('   ');
      fig.appendChild(cap);
    }
    return fig;
  }
  function draw(ctx, pv) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const r of pv.rooms) for (const q of r.rects) { x1 = Math.min(x1, q.x1); y1 = Math.min(y1, q.y1); x2 = Math.max(x2, q.x2); y2 = Math.max(y2, q.y2); }
    const tw = x2 - x1 + 1, th = y2 - y1 + 1, s = Math.min((W - 10) / tw, (H - 10) / th);
    const ox = (W - tw * s) / 2, oy = (H - th * s) / 2, X = x => ox + (x - x1) * s, Y = y => oy + (y - y1) * s;
    let accent = '#b6a375';
    try { accent = getComputedStyle(document.documentElement).getPropertyValue('--ph').trim() || accent; } catch (_) {}
    ctx.scale(2, 2);
    // the rooms: the station dimmed, the plan's room lit
    for (const pass of [false, true]) for (const r of pv.rooms) {
      if (!!r.mine !== pass) continue;
      ctx.globalAlpha = r.mine ? 1 : 0.45;
      for (const q of r.rects) {
        const x = X(q.x1), y = Y(q.y1), w = (q.x2 - q.x1 + 1) * s, h = (q.y2 - q.y1 + 1) * s;
        ctx.fillStyle = r.corridor ? '#343636' : r.plank ? '#494139' : '#343e43'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
    }
    ctx.globalAlpha = 1;
    for (const b of pv.belts || []) { ctx.fillStyle = '#b6a375'; ctx.fillRect(X(b.x), Y(b.y), Math.max(1, s), Math.max(1, s)); }
    for (const p of pv.props || []) { ctx.fillStyle = p.cap ? '#d2b276' : p.machine ? '#b6a375' : '#6d957e'; ctx.fillRect(X(p.x), Y(p.y), Math.max(2, p.w * s), Math.max(2, p.h * s)); }
    // the zones: a dashed outline in the accent, numbered in its corner
    (pv.zones || []).forEach((z, i) => {
      const r = z.rect, x = X(r.x1) + 1, y = Y(r.y1) + 1, w = (r.x2 - r.x1 + 1) * s - 2, h = (r.y2 - r.y1 + 1) * s - 2;
      ctx.setLineDash([2, 2]); ctx.strokeStyle = accent; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.setLineDash([]);
      ctx.fillStyle = accent; ctx.font = '9px VT323, monospace'; ctx.textBaseline = 'top'; ctx.fillText(String(i + 1), x + 3, y + 2);
    });
  }
  return { el, draw };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PlanPreview;
