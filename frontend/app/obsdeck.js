/* OBSERVATION DECK — the station renders edge to edge under floating glass panels (css/obsdeck.css).
   This module only measures: how much of the full-screen stage each panel covers. It hands that to
   the world camera (World.setViewInset) so the station is framed in the open gap, and to CSS
   (--od-l/t/r/b on #stage-wrap) so the CINEMA key and the CREW drawer tab sit inside the gap too.
   ?deck=0 turns the layer off for a side-by-side check. */
(() => {
  'use strict';
  const on = new URLSearchParams(location.search).get('deck') !== '0';
  document.body.classList.toggle('obs-deck', on);
  if (!on) return;

  const GAP = 14;   // visual px of clear space kept between a panel's edge and the framed station
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
      const left = $('left'), chat = $('chat-panel'), top = $('topbar'), bot = $('bottombar');
      if (visible(left)) l = Math.max(0, left.getBoundingClientRect().right - s.left + GAP);
      if (visible(chat)) r = Math.max(0, s.right - chat.getBoundingClientRect().left + GAP);
      if (visible(top)) t = Math.max(0, top.getBoundingClientRect().bottom - s.top + GAP);
      if (visible(bot)) b = Math.max(0, s.bottom - bot.getBoundingClientRect().top + GAP);
    }
    // rects are VISUAL px; the canvas and the stage's own style px are ZOOMED px (uiZoom law)
    const inset = { l: l / z, t: t / z, r: r / z, b: b / z };
    for (const k of ['l', 't', 'r', 'b']) stage.style.setProperty('--od-' + k, Math.round(inset[k]) + 'px');
    if (typeof World !== 'undefined' && World.setViewInset) World.setViewInset(inset);
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
