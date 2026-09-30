/* frontend/app/apps.js — APPS: describe it, get it (2026-09-29).

   The Commander names an app and says what it should do ("A daily brief of the top AI news, refreshed every 24h").
   StarNet creates it at once (its window opens on a "building" page), then hands the build to the lead in its own
   COMMS session — so the work is visible, runs under the station's normal rules, and the page appears the moment
   the crew writes it. Changing an app is the same move from the bar under its window: describe the change.

   Owns: the APPS window (NEW APP + your apps), the bar under every app window (change · refresh · honest status),
   and the station-bridge verbs app.reload / app.data (see stationcommands.js). The frame, bridge and kit are
   PluginHost's (frontend/app/pluginhost.js, the 'app' kind).

   TRUTHFUL: every status line reads the sidecar (GET /api/apps): the routine's real next/last run, and whether
   routines are switched on at all — an app never says it will refresh when nothing will fire. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  let list = [];            // the last GET /api/apps
  let routinesOn = true;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const UI = () => (typeof StationUI !== 'undefined' ? StationUI : null);
  const notify = (msg, cls) => { const ui = UI(); if (ui && ui.notify) ui.notify(msg, cls || 'good', 'general', { transient: true }); };
  const EXAMPLES = [
    ['AI News Brief', 'A daily brief of the top AI news — headline, two-line summary and source for each story. Refresh every 24h.'],
    ['Market Pulse', 'The day\'s biggest moves in crypto and tech stocks, with a one-line why for each. Refresh every 6h.'],
    ['Reading List', 'A list of links I want to read, with a short summary of each. I will tell you what to add.'],
    ['Weekly Wins', 'Every Friday, a recap of what my crew finished this week.']
  ];

  async function load() {
    try {
      const r = await fetch('/api/apps');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      list = Array.isArray(j.apps) ? j.apps : [];
      routinesOn = j.routinesOn !== false;
    } catch (_) { /* keep the last known list; the window says when it cannot load */ return false; }
    for (const a of list) if (typeof PluginHost !== 'undefined' && PluginHost.registerApp) PluginHost.registerApp(a);
    return true;
  }
  const find = (id) => list.find((a) => a.id === id) || null;

  function ago(t) {
    if (!t) return '';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }
  function when(t) {
    if (!t) return '';
    const d = new Date(t), today = new Date();
    const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === today.toDateString() ? hm : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + hm;
  }
  // one honest line: when it last got data, and what the schedule will really do
  function statusOf(a) {
    const parts = [a.updatedAt ? 'Updated ' + ago(a.updatedAt) : 'No content yet'];
    const s = a.schedule;
    if (s && s.missing) parts.push('its refresh routine was removed');
    else if (s) {
      if (!routinesOn) parts.push('refreshes ' + s.display + ' — but routines are OFF');
      else if (s.enabled === false) parts.push('refresh paused');
      else parts.push('refreshes ' + s.display + (s.nextRunAt ? ' · next ' + when(s.nextRunAt) : ''));
      if (s.lastStatus === 'error') parts.push('last refresh failed');
    }
    return parts.join(' · ');
  }

  /* ---- handing work to the crew (one COMMS session per app) ------------------------------------------------ */
  const SESSIONS_KEY = 'starnet.appSessions';
  function sessions() { try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '{}') || {}; } catch (_) { return {}; } }
  function remember(id, wsId) { const m = sessions(); m[id] = wsId; try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(m)); } catch (_) { /* per-browser memory only */ } }
  function toCrew(app, text) {
    if (typeof Workstreams === 'undefined' || typeof Chat === 'undefined' || !Chat.send) { notify('COMMS is not ready yet — try again in a moment.', 'warn'); return false; }
    if (Chat.isBusy && Chat.isBusy()) { notify('Your crew is mid-task in COMMS — send this again when it finishes.', 'warn'); return false; }
    let ws = null;
    const known = sessions()[app.id];
    if (known && Workstreams.get && Workstreams.get(known) && !(Workstreams.isDeleted && Workstreams.isDeleted(known))) ws = Workstreams.get(known);
    if (!ws) { ws = Workstreams.create('App · ' + app.name); remember(app.id, ws.id); }
    if (typeof App !== 'undefined' && App.openWorkstream) App.openWorkstream(ws.id); else if (Chat.load) Chat.load(ws);
    Chat.send(text);
    try { if (typeof App !== 'undefined' && App.persist) App.persist(); } catch (_) { /* the chat itself is saved by Chat */ }
    return true;
  }
  // the model's own sense of the date is its training era: every hand-off states the real one
  const today = () => { try { return 'Today is ' + new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + '. '; } catch (_) { return ''; } };
  const buildText = (a, what) => 'Build my new StarNet app "' + a.name + '" (app id: ' + a.id + ').\n\nWhat it should do: ' + what + '\n\n' + today() +
    'Use the app tools (find them with tool.search "app"): read it with app.read, write index.html with app.write using the station kit, app.check it, ' +
    'fill it with REAL content now with app.publish, and if it should update by itself, app.schedule it. Then tell me in a sentence what it shows and when it refreshes.';
  const changeText = (a, what) => 'Change my StarNet app "' + a.name + '" (app id: ' + a.id + '): ' + what + '\n\n' + today() +
    'Read it first with app.read (find the app tools with tool.search "app"), then app.write the new version and app.check it. Keep what already works.';

  async function create(name, what) {
    const r = await fetch('/api/apps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description: what }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error((j && j.error) || 'the station could not create the app');
    await load();
    const a = find(j.app.id) || j.app;
    if (typeof PluginHost !== 'undefined' && PluginHost.openApp) PluginHost.openApp(a);
    toCrew(a, buildText(a, what || name));
    return a;
  }
  function change(id, what) {
    const a = find(id);
    if (!a || !String(what || '').trim()) return false;
    return toCrew(a, changeText(a, String(what).trim()));
  }
  async function refreshNow(id) {
    const a = find(id);
    if (!a || !a.schedule || !a.schedule.jobId) return;
    notify(a.name + ': refreshing — your crew is on it.');
    try {
      const r = await fetch('/api/cron/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.schedule.jobId }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); notify(a.name + ': ' + ((j && j.error) || 'the refresh could not start'), 'warn'); return; }
      await r.text();   // the run streams until it finishes; reading it keeps it attached
    } catch (e) { notify(a.name + ': the refresh could not start — ' + ((e && e.message) || e), 'warn'); }
    await load(); refreshBar(id); rerenderList();
  }
  async function turnOnRoutines() {
    const r = await fetch('/api/cron/arm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    if (!r.ok) { notify('Could not turn routines on — open AUTOMATION to check.', 'warn'); return; }
    notify('Routines are on: your apps refresh on schedule.');
    await load(); for (const a of list) refreshBar(a.id); rerenderList();
  }

  /* ---- the bar under an app window ---------------------------------------------------------------------------- */
  function mountBar(body, id) {
    let bar = body.querySelector(':scope > .app-bar');
    if (!bar) {
      bar = document.createElement('form');
      bar.className = 'app-bar';
      bar.innerHTML = '<div class="app-bar-row"><input class="key-input app-change" maxlength="600" autocomplete="off" aria-label="Describe a change to this app" placeholder="Describe a change — e.g. show the source under each headline">' +
        '<button class="bb xs app-change-go" type="submit">CHANGE</button><button class="bb xs app-refresh" type="button" hidden>⟳ REFRESH</button></div>' +
        '<div class="app-bar-status"><span class="app-status"></span><button class="bb xs app-arm" type="button" hidden>TURN ON ROUTINES</button></div>';
      bar.addEventListener('submit', (e) => {
        e.preventDefault();
        const inp = bar.querySelector('.app-change');
        if (change(id, inp.value)) inp.value = '';
      });
      bar.querySelector('.app-refresh').addEventListener('click', () => refreshNow(id));
      bar.querySelector('.app-arm').addEventListener('click', () => turnOnRoutines());
      body.appendChild(bar);
    }
    paintBar(bar, find(id));
    if (!find(id)) load().then(() => paintBar(bar, find(id)));
  }
  function paintBar(bar, a) {
    if (!bar) return;
    bar.querySelector('.app-status').textContent = a ? statusOf(a) : '';
    const s = a && a.schedule;
    bar.querySelector('.app-refresh').hidden = !(s && s.jobId && !s.missing);
    bar.querySelector('.app-arm').hidden = !(s && !s.missing && !routinesOn);
  }
  function refreshBar(id) {
    load().then(() => {
      document.querySelectorAll('.term.plugin-app-win').forEach((w) => {
        const f = w.querySelector('iframe.plugin-frame');
        if (f && f.dataset.plugin === id) paintBar(w.querySelector('.app-bar'), find(id));
      });
    });
  }

  /* ---- the APPS window ---------------------------------------------------------------------------------------- */
  let listEl = null;
  function rerenderList() {
    if (!listEl || !listEl.isConnected) return;
    if (!list.length) { listEl.innerHTML = '<div class="ext-empty">No apps yet. Describe one above — your crew builds it in its own window.</div>'; return; }
    listEl.innerHTML = list.map((a) => '<div class="mc-row ext-row app-row" data-app="' + esc(a.id) + '">' +
      '<div class="mc-top"><b>' + esc(a.name) + '</b><span class="mc-state" style="color:' + (a.updatedAt ? 'var(--ok)' : 'var(--ph-dim)') + '">' + (a.updatedAt ? '● live' : '○ building') + '</span></div>' +
      (a.description ? '<div class="mc-hint">' + esc(a.description) + '</div>' : '') +
      '<div class="mc-hint">' + esc(statusOf(a)) + '</div>' +
      '<div class="mc-acts"><button class="bb xs" data-app-open="' + esc(a.id) + '">OPEN</button>' +
      (a.schedule && a.schedule.jobId && !a.schedule.missing ? '<button class="bb xs" data-app-refresh="' + esc(a.id) + '">⟳ REFRESH NOW</button>' : '') +
      '<button class="bb xs danger" data-app-delete="' + esc(a.id) + '">DELETE</button></div></div>').join('');
    listEl.querySelectorAll('[data-app-delete]').forEach((btn) => {
      const del = async () => {
        const r = await fetch('/api/apps/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: btn.dataset.appDelete }) });
        if (!r.ok) { notify('Could not delete that app.', 'warn'); return; }
        const ui = UI(); if (ui && ui.closeTerm) ui.closeTerm('app.' + btn.dataset.appDelete);
        await load(); rerenderList();
      };
      if (typeof ArmConfirm !== 'undefined' && ArmConfirm.wire) ArmConfirm.wire(btn, { armedLabel: 'SURE? DELETE', restLabel: 'DELETE', timeoutMs: 4000, onConfirm: del });
      else btn.addEventListener('click', del);
    });
  }
  function buildWindow(body) {
    body.innerHTML =
      '<section class="apps-new mc-form" aria-label="New app">' +
      '<div class="apps-h">▮ NEW APP</div>' +
      '<label for="app-name">Name</label>' +
      '<input id="app-name" class="key-input" maxlength="60" autocomplete="off" placeholder="e.g. AI News Brief">' +
      '<label for="app-what">What should it do?</label>' +
      '<textarea id="app-what" class="key-input apps-what" maxlength="600" rows="3" placeholder="e.g. A daily brief of the top AI news — headline, short summary and source for each. Refresh every 24h."></textarea>' +
      '<div class="apps-examples"><span class="mc-hint">Try:</span>' + EXAMPLES.map((e, i) => '<button class="bb xs" type="button" data-app-example="' + i + '">' + esc(e[0]) + '</button>').join('') + '</div>' +
      '<div class="mc-acts"><button class="bb sm" id="app-create" type="button">+ BUILD IT</button><span class="mc-hint apps-msg" role="status"></span></div>' +
      '</section>' +
      '<div class="apps-h">▮ YOUR APPS</div>' +
      '<div class="apps-list"><div class="mc-hint">loading…</div></div>';
    listEl = body.querySelector('.apps-list');
    const nameEl = body.querySelector('#app-name'), whatEl = body.querySelector('#app-what'), msg = body.querySelector('.apps-msg');
    body.querySelectorAll('[data-app-example]').forEach((b) => b.addEventListener('click', () => { const e = EXAMPLES[+b.dataset.appExample]; nameEl.value = e[0]; whatEl.value = e[1]; whatEl.focus(); }));
    body.querySelector('#app-create').addEventListener('click', async (ev) => {
      const name = nameEl.value.trim(), what = whatEl.value.trim();
      if (!name) { msg.textContent = 'Give it a name.'; nameEl.focus(); return; }
      if (!what) { msg.textContent = 'Say what it should do.'; whatEl.focus(); return; }
      const btn = ev.currentTarget;   // captured now: currentTarget is null once the handler awaits
      btn.disabled = true; msg.textContent = 'Creating…';
      try { await create(name, what); nameEl.value = ''; whatEl.value = ''; msg.textContent = 'Building — follow along in COMMS.'; rerenderList(); }
      catch (e) { msg.textContent = (e && e.message) || String(e); }
      finally { btn.disabled = false; }
    });
    body.addEventListener('click', (ev) => {
      const o = ev.target.closest('[data-app-open]');
      if (o) { const a = find(o.dataset.appOpen); if (a && typeof PluginHost !== 'undefined') PluginHost.openApp(a); return; }
      const r = ev.target.closest('[data-app-refresh]');
      if (r) refreshNow(r.dataset.appRefresh);
    });
    load().then(rerenderList);
  }
  function openNew() {
    const ui = UI(); if (!ui || !ui.openTerm) return;
    ui.openTerm('apps');
    setTimeout(() => { const n = document.getElementById('app-name'); if (n) n.focus(); }, 60);
  }

  /* ---- the crew changed something (station bridge verbs) ----------------------------------------------------- */
  async function onReload(id, digest) {
    await load();
    const a = find(id);
    if (typeof PluginHost !== 'undefined') PluginHost.appReload(id, (a && a.digest) || digest);
    rerenderList(); refreshBar(id);
    return { ok: true };
  }
  async function onData(id) {
    if (typeof PluginHost !== 'undefined') PluginHost.appData(id);
    await load(); rerenderList();
    return { ok: true };
  }

  function init() {
    const ui = UI();
    if (ui && ui.registerWindow) ui.registerWindow('apps', 'APPS', buildWindow, { className: 'apps-win' });
    const nb = document.getElementById('bb-newapp');
    if (nb) nb.addEventListener('click', openNew);
    load();
  }
  root.AppsUI = { load, list: () => list.slice(), create, change, refreshNow, turnOnRoutines, mountBar, refreshBar, openNew, onReload, onData, _test: { statusOf } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : this);
