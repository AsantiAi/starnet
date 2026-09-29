/* frontend/app/pluginhost.js — PLUGIN WINDOWS (plugin extensions phase 1, 2026-09-29).

   An approved plugin's `screens` (plugin.json) become real StarNet windows. Each one is registered through the
   ordinary window registry (StationUI.registerWindow), so it opens, drags, docks, minimizes and rises in as a glass
   sheet exactly like CONNECTORS or the TASK BOARD — the station's chrome, the plugin's content.

   The content is a SANDBOXED FRAME served by the sidecar's /plugin-ui/ route with an opaque origin: it cannot read
   this page, its token, or the API. What it may ask for, it asks HERE, over postMessage, and this host answers only
   for the plugin that owns that frame — the frame never gets to say which plugin it is (we match the message's
   source window against frames we created). Everything the plugin draws stays inside its window body; the title
   bar, the PLUGIN plate and every approval stay host-drawn, so a plugin can never pass its content off as the
   station's own telemetry.

   Theme: the host pushes the station's LIVE computed tokens into each frame (starnet-kit.js applies them) when a
   frame says hello and whenever <body>'s theme class or inline theme vars change — a custom hue repaints every
   plugin window in the same frame as the station.

   Exposes window.PluginHost = { refresh, open, list, _test } */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  const KEY_PREFIX = 'plugin.';
  const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads';
  // The tokens a plugin page is kept in step with. The rgb triplets matter most: every kit recipe derives its
  // translucent glass from them, exactly as the station's own glass does.
  const THEME_VARS = ['--ph', '--ph-bright', '--ph-dim', '--ph-faint', '--ink', '--bg', '--panel', '--panel2', '--text',
    '--gold', '--ph-rgb', '--ph-bright-rgb', '--gold-rgb', '--ok', '--ok-rgb', '--bad', '--bad-rgb', '--warn',
    '--gd-edge', '--gd-light', '--gd-face', '--gd-hover', '--gd-shadow', '--t-fast', '--t-med', '--ease-soft'];

  const screens = new Map();   // window key -> { plugin, screen }   (live, approved screens only)
  const keyPlugin = new Map(); // window key -> plugin id, kept after a plugin goes off so its window can say why
  const frames = new Set();    // live { key, iframe, plugin, screen }
  let plugins = [];
  let lastError = '';

  const plainTitle = (s) => String(s == null ? '' : s).replace(/[&<>"'`\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'PLUGIN';
  const keyOf = (pluginId, screenId) => KEY_PREFIX + pluginId + '.' + screenId;
  const UI = () => (typeof StationUI !== 'undefined' ? StationUI : null);
  const zoom = () => { try { return (typeof U !== 'undefined' && U.uiZoom) ? U.uiZoom() : 1; } catch (_) { return 1; } };

  function themeVars() {
    const out = {};
    let cs;
    try { cs = getComputedStyle(document.body); } catch (_) { return out; }
    for (const k of THEME_VARS) {
      const v = String(cs.getPropertyValue(k) || '').trim();
      if (v) out[k] = v;
    }
    return out;
  }
  function post(entry, msg) {
    try { entry.iframe.contentWindow.postMessage(Object.assign({ __sn: 1 }, msg), '*'); } catch (_) {}
  }
  function pushTheme() {
    if (!frames.size) return;
    const vars = themeVars();
    for (const f of frames) post(f, { ev: 'theme', vars });
  }

  function openExternal(url) {
    try {
      const invoke = root.__TAURI__ && root.__TAURI__.core && root.__TAURI__.core.invoke;
      if (invoke) { invoke('open_external_url', { url }).catch(() => { try { root.open(url, '_blank', 'noopener'); } catch (_) {} }); return; }
    } catch (_) {}
    try { root.open(url, '_blank', 'noopener'); } catch (_) {}
  }

  // Keep the window hugging its page like a native one, inside the room the viewport actually has.
  function fitHeight(entry, px) {
    const want = Math.max(0, Number(px) || 0);
    const maxH = Math.max(160, Math.floor((root.innerHeight / zoom()) * 0.78));
    entry.iframe.style.height = Math.max(80, Math.min(want, maxH)) + 'px';
  }

  function toastFor(entry, text, kind) {
    const ui = UI();
    const msg = entry.plugin.name + ': ' + String(text || '').slice(0, 280);
    const cls = kind === 'bad' ? 'bad' : (kind === 'warn' ? 'warn' : 'good');
    if (ui && ui.notify) ui.notify(msg, cls);
  }

  async function storeOp(entry, op, a) {
    const r = await fetch('/api/plugins/store', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.plugin.id, op, key: a && a.key, value: a && a.value })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error((j && j.error) || ('the station refused (' + r.status + ')'));
    return j.value;
  }

  /* THE BRIDGE. One table, every method named; anything else is refused. `entry` was resolved from the message's
     SOURCE window, so every answer is for the plugin that owns that frame and nothing else. */
  const METHODS = {
    hello: (entry) => ({
      plugin: { id: entry.plugin.id, name: entry.plugin.name, version: entry.plugin.version },
      screen: { id: entry.screen.id, title: entry.screen.title },
      theme: themeVars()
    }),
    'store.get': (entry, a) => storeOp(entry, 'get', a),
    'store.set': (entry, a) => storeOp(entry, 'set', a),
    'store.delete': (entry, a) => storeOp(entry, 'delete', a),
    'store.keys': (entry) => storeOp(entry, 'keys', {}),
    'ui.toast': (entry, a) => { toastFor(entry, a && a.text, a && a.kind); return null; },
    'ui.height': (entry, a) => { fitHeight(entry, a && a.px); return null; },
    'ui.title': (entry, a) => {
      const w = entry.iframe.closest('.term');
      const t = w && w.querySelector('.term-title');
      const extra = String((a && a.text) || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
      if (t) t.textContent = entry.screen.title + (extra ? ' · ' + extra : '');
      return null;
    },
    'ui.open': (entry, a) => {
      const sid = String((a && a.screen) || '');
      const key = keyOf(entry.plugin.id, sid);
      if (!screens.has(key)) throw new Error('this plugin has no screen named "' + sid + '"');
      const ui = UI(); if (ui && ui.openTerm) ui.openTerm(key);
      return null;
    },
    'ui.close': (entry) => { const ui = UI(); if (ui && ui.closeTerm) ui.closeTerm(entry.key); return null; },
    'ui.link': (entry, a) => {
      let u;
      try { u = new URL(String((a && a.url) || '')); } catch (_) { throw new Error('that is not a link'); }
      if (u.protocol !== 'https:') throw new Error('only https:// links can be opened');
      openExternal(u.href);
      return null;
    }
  };

  function onMessage(ev) {
    const d = ev.data;
    if (!d || d.__sn !== 1 || typeof d.m !== 'string' || !Number.isFinite(d.id)) return;
    let entry = null;
    for (const f of frames) { if (f.iframe.contentWindow === ev.source) { entry = f; break; } }
    if (!entry) return;   // not one of ours: never answered
    const fn = Object.prototype.hasOwnProperty.call(METHODS, d.m) ? METHODS[d.m] : null;
    const reply = (ok, v, err) => post(entry, { re: d.id, ok, v: ok ? v : undefined, err: ok ? undefined : String(err || 'refused') });
    if (!fn) return reply(false, null, 'unknown call: ' + d.m);
    Promise.resolve().then(() => fn(entry, d.a && typeof d.a === 'object' ? d.a : {}))
      .then((v) => reply(true, v === undefined ? null : v), (e) => reply(false, null, (e && e.message) || e));
  }

  // ---- the window builder -----------------------------------------------------------------------------------------
  function frameFor(body) { return body && body.querySelector ? body.querySelector(':scope > iframe.plugin-frame') : null; }
  function forget(iframe) { for (const f of frames) if (f.iframe === iframe) frames.delete(f); }

  function build(key, body) {
    const def = screens.get(key);
    const existing = frameFor(body);
    // IDEMPOTENT: the window manager re-runs builders on re-render; a live plugin must never be reloaded (and lose
    // its state) because the station repainted. Same plugin code → keep the running frame.
    if (existing && def && existing.dataset.digest === def.plugin.digest) return;
    if (existing) forget(existing);
    body.innerHTML = '';
    body.classList.add('plugin-body');
    const w = body.closest && body.closest('.term');
    if (w && !w.querySelector('.plugin-plate')) {
      const title = w.querySelector('.term-title');
      if (title) {
        const plate = document.createElement('span');
        plate.className = 'plugin-plate';
        plate.textContent = 'PLUGIN';
        plate.setAttribute('data-tip', 'Drawn by a plugin you approved, not by StarNet');
        title.insertAdjacentElement('afterend', plate);
      }
    }
    if (!def) {
      // say WHY, from the listing: an edited plugin is not the same as a removed or switched-off one
      const pid = keyPlugin.get(key);
      const p = pid ? plugins.find((x) => x.id === pid) : null;
      const why = !p ? 'This plugin was removed.'
        : (p.pending ? (p.name || p.id) + ' changed since you approved it, so its window is closed until you approve the new code in ABILITIES → EXTENSIONS.'
          : (p.name || p.id) + ' is turned off. Turn it on in ABILITIES → EXTENSIONS.');
      const note = document.createElement('div');
      note.className = 'plugin-gone';
      note.textContent = why;
      body.appendChild(note);
      return;
    }
    const url = (typeof ApiTicket !== 'undefined' && ApiTicket.pluginUrl) ? ApiTicket.pluginUrl(def.plugin.id, def.plugin.digest, def.screen.entry) : '';
    if (!url) { body.innerHTML = '<div class="plugin-gone">The station could not open this window (no session).</div>'; return; }
    const iframe = document.createElement('iframe');
    iframe.className = 'plugin-frame';
    iframe.setAttribute('sandbox', SANDBOX);
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('allow', '');
    iframe.setAttribute('title', def.plugin.name + ' — ' + def.screen.title);
    iframe.dataset.digest = def.plugin.digest;
    iframe.dataset.plugin = def.plugin.id;
    iframe.style.height = '240px';
    const entry = { key, iframe, plugin: def.plugin, screen: def.screen };
    frames.add(entry);
    iframe.src = url;
    body.appendChild(iframe);
  }

  // A closed window's frame must stop being answered.
  const reaper = new MutationObserver(() => {
    for (const f of frames) if (!f.iframe.isConnected) frames.delete(f);
  });

  async function refresh() {
    let data;
    try {
      const r = await fetch('/api/plugins');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      data = await r.json();
    } catch (e) { lastError = (e && e.message) || String(e); return false; }
    lastError = '';
    plugins = Array.isArray(data.plugins) ? data.plugins : [];
    const ui = UI();
    const live = new Set();
    for (const p of plugins) {
      if (!p.active || !Array.isArray(p.screens)) continue;
      for (const s of p.screens) {
        const key = keyOf(p.id, s.id);
        live.add(key);
        keyPlugin.set(key, p.id);
        screens.set(key, { plugin: { id: p.id, name: p.name || p.id, version: p.version || '0', digest: p.digest }, screen: s });
        if (ui && ui.registerWindow) {
          // The window manager renders a title as HTML; a plugin's title is plain text, so markup characters are
          // dropped outright (escaping would double-escape in the footer plate and the close button's label).
          ui.registerWindow(key, plainTitle(s.title), (body) => build(key, body), { className: 'plugin-win', wide: s.size === 'wide' });
        }
      }
    }
    // A plugin turned off or edited: its registry entry goes; any open window re-renders into the honest notice
    // (off) or the newly approved code (edited). Never leave old code looking live.
    for (const key of Array.from(screens.keys())) if (!live.has(key)) screens.delete(key);
    for (const f of Array.from(frames)) {
      const def = screens.get(f.key);
      if (!def || def.plugin.digest !== f.iframe.dataset.digest) { if (ui && ui.rerender) ui.rerender(f.key); }
    }
    return true;
  }

  function open(pluginId, screenId) {
    const p = plugins.find((x) => x.id === pluginId);
    const sid = screenId || (p && p.screens && p.screens[0] && p.screens[0].id);
    const key = keyOf(pluginId, sid || '');
    if (!screens.has(key)) return false;
    const ui = UI(); if (ui && ui.openTerm) ui.openTerm(key);
    return true;
  }

  function init() {
    root.addEventListener('message', onMessage);
    try { reaper.observe(document.getElementById('terms') || document.body, { childList: true, subtree: true }); } catch (_) {}
    // theme changes are a class swap (body.theme-*) or inline vars/zoom on <body> — one observer covers every path
    let t = 0;
    try {
      new MutationObserver(() => { clearTimeout(t); t = setTimeout(pushTheme, 30); })
        .observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    } catch (_) {}
    refresh();
  }

  const api = {
    refresh, open,
    list: () => plugins.slice(),
    _test: { frames, screens, themeVars, METHODS, get lastError() { return lastError; } }
  };
  root.PluginHost = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : this);
