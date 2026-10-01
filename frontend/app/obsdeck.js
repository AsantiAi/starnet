/* OBSERVATION DECK — the station renders edge to edge under floating glass panels (css/obsdeck.css).
   This module only measures: how much of the full-screen stage each panel covers. It hands that to
   the world camera (World.setViewInset) so the station is framed in the open gap, and to CSS
   (--od-l/t/r/b on #stage-wrap) so the CINEMA key and the CREW drawer tab sit inside the gap too.
   ?deck=0 turns the layer off for a side-by-side check. */
(() => {
  'use strict';
  // ?deck=0 off · ?deck=window (default) one console plate with a viewport · ?deck=docked a HUD frame · ?deck=float loose sheets
  const want = new URLSearchParams(location.search).get('deck');
  const on = want !== '0';
  document.body.classList.toggle('obs-deck', on);
  if (!on) return;
  const mode = want === 'docked' || want === 'float' ? want : 'window';
  document.body.classList.add('od-' + mode);

  const HOLE = 16;                                 // WINDOW: visual px from a panel edge to the viewport rim
  const GAP = mode === 'window' ? HOLE + 14 : 14;  // visual px of clear space kept between a panel's edge and the framed station
  const R = 14;                                    // viewport corner radius (matches #od-rim)
  const $ = (id) => document.getElementById(id);
  const visible = (el) => el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';

  function measure() {
    const stage = $('stage-wrap');
    if (!stage || !visible(stage)) return;
    const game = $('screen-game');
    const off = document.body.classList.contains('hud-mode') || (game && game.classList.contains('cinema'));
    const s = stage.getBoundingClientRect();
    const z = (typeof U !== 'undefined' && U.uiZoom) ? U.uiZoom() : 1;
    let l = 0, t = 0, r = 0, b = 0;
    if (!off) {
      const left = $('left'), chat = $('chat-panel'), bot = $('bottombar');
      if (visible(left)) l = Math.max(0, left.getBoundingClientRect().right - s.left + GAP);
      if (visible(chat)) r = Math.max(0, s.right - chat.getBoundingClientRect().left + GAP);
      // no top bar in the deck: #topbar is a transparent overlay whose middle is open station
      t = GAP;
      if (visible(bot)) b = Math.max(0, s.bottom - bot.getBoundingClientRect().top + GAP);
    }
    // rects are VISUAL px; the canvas and the stage's own style px are ZOOMED px (uiZoom law)
    const inset = { l: l / z, t: t / z, r: r / z, b: b / z };
    for (const k of ['l', 't', 'r', 'b']) stage.style.setProperty('--od-' + k, Math.round(inset[k]) + 'px');
    if (mode === 'window') cutViewport(stage, s.width / z, s.height / z, inset, (GAP - HOLE) / z);
    if (typeof World !== 'undefined' && World.setViewInset) World.setViewInset(inset);
  }

  // The plate is one element with a rounded hole: an even-odd clip path (outer screen rect + the viewport).
  function cutViewport(stage, W, H, inset, pad) {
    let plate = $('od-plate'), rim = $('od-rim');
    if (!plate) {
      plate = document.createElement('div'); plate.id = 'od-plate'; plate.setAttribute('aria-hidden', 'true');
      rim = document.createElement('div'); rim.id = 'od-rim'; rim.setAttribute('aria-hidden', 'true');
      stage.append(plate, rim);
    }
    const x = inset.l - pad, y = inset.t - pad, w = Math.max(2 * R, W - inset.l - inset.r + 2 * pad), h = Math.max(2 * R, H - inset.t - inset.b + 2 * pad);
    const f = (n) => Math.round(n * 10) / 10;
    const hole = 'M' + f(x + R) + ',' + f(y) + ' H' + f(x + w - R) + ' A' + R + ',' + R + ' 0 0 1 ' + f(x + w) + ',' + f(y + R)
      + ' V' + f(y + h - R) + ' A' + R + ',' + R + ' 0 0 1 ' + f(x + w - R) + ',' + f(y + h)
      + ' H' + f(x + R) + ' A' + R + ',' + R + ' 0 0 1 ' + f(x) + ',' + f(y + h - R)
      + ' V' + f(y + R) + ' A' + R + ',' + R + ' 0 0 1 ' + f(x + R) + ',' + f(y) + ' Z';
    plate.style.clipPath = 'path(evenodd, "M0,0 H' + f(W) + ' V' + f(H) + ' H0 Z ' + hole + '")';
    Object.assign(rim.style, { left: f(x) + 'px', top: f(y) + 'px', width: f(w) + 'px', height: f(h) + 'px' });
  }

  let queued = false;
  const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; measure(); }); };

  function wire() {
    schedule();
    addEventListener('resize', schedule);
    try {
      const ro = new ResizeObserver(schedule);
      ['stage-wrap', 'left', 'chat-panel', 'topbar', 'bottombar'].forEach((id) => { const el = $(id); if (el) ro.observe(el); });
    } catch (e) {}
    try {
      const mo = new MutationObserver(schedule);
      mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
      const game = $('screen-game');
      if (game) mo.observe(game, { attributes: true, attributeFilter: ['class'] });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
