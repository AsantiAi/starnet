/* STARNET — outputbrowser.js : the BROWSER window (2026-09-29, Andrew: "a built in browser … when creating output,
   maybe it's optional for the expandable window to actively show the output").

   A web page an agent makes (an .html it wrote into its workspace, or the entry page of an away-built workshop tool)
   now opens IN the station, in a normal docked window (StationUI 'browser', WIDE shell), instead of being handed to
   the OS browser. The page renders in an iframe from a sandboxed sidecar route — /view/ for a workspace file,
   /workshop-run/ for a workshop run — both served with `Content-Security-Policy: sandbox allow-scripts`, so its
   scripts run in an opaque origin that can never reach the app token or the API. The iframe adds its own sandbox
   (no allow-same-origin) as a second wall.

   FOLLOW (off by default, remembered per viewer): when on, a NEW web page an agent writes opens this window and shows
   it. Independent of FOLLOW, the page you are looking at reloads when its file (or anything in its folder: the css,
   the js) is rewritten — that is the real bytes on disk, never a guess.

   Truthful telemetry: the status line only says a page is loaded after the station confirmed the file exists (HEAD
   /api/file) and the frame fired load; a missing file says so. */
'use strict';
(function (root) {
  const FOLLOW_KEY = 'starnet.outputBrowser.follow';
  const RECENT_MAX = 8;
  const RELOAD_DEBOUNCE_MS = 400;
  const HTML_RE = /\.html?$/i;

  const state = {
    target: null,        // { agentId, path, runId?, source: 'workspace'|'workshop' }
    recent: [],          // newest first, same shape as target
    follow: false,
    ui: null,            // mounted element refs while the window is open
    reloadTimer: null,
    loadSeq: 0,
    loadedAt: 0,
    lastCause: ''
  };
  try { state.follow = !!(root.localStorage && root.localStorage.getItem(FOLLOW_KEY) === '1'); } catch (_) { state.follow = false; }

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = p => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const dirOf = p => { const n = norm(p); const i = n.lastIndexOf('/'); return i < 0 ? '' : n.slice(0, i); };
  const baseOf = p => { const n = norm(p); return n.slice(n.lastIndexOf('/') + 1); };
  const ASSET_RE = /\.(html?|css|m?js|json|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp3|wav|ogg|mp4|webm)$/i;
  // Does a write to `path` change what the page at `pagePath` renders? The page itself, or a web asset in its
  // folder tree (a page at the workspace root owns the whole tree).
  function feedsPage(path, pagePath) {
    if (path === pagePath) return true;
    if (!ASSET_RE.test(path)) return false;
    const d = dirOf(pagePath);
    return !d || path.indexOf(d + '/') === 0;
  }
  const keyOf = t =>t ? [t.source, t.agentId, t.runId || '', norm(t.path)].join('|') : '';
  function agentLabel(id) {
    if (typeof App !== 'undefined' && App && typeof App.agentName === 'function') { try { return App.agentName(id) || id; } catch (_) {} }
    return String(id || 'agent');
  }
  function tauriCore() { return (root.__TAURI__ && root.__TAURI__.core) ? root.__TAURI__.core : null; }
  function notify(msg, tone) { if (typeof StationUI !== 'undefined' && StationUI.notify) StationUI.notify(msg, tone || 'warn'); }

  // The jail-relative path the station's own /api/file route knows this file by (a workshop file lives under
  // workshop/<runId>/ — the same rel the deliverable library builds).
  function jailRel(t) { return t.source === 'workshop' ? 'workshop/' + t.runId + '/' + norm(t.path) : norm(t.path); }
  function pageUrl(t) {
    if (typeof ApiTicket === 'undefined') return '';
    return t.source === 'workshop' ? ApiTicket.runUrl(t.agentId, t.runId, norm(t.path)) : ApiTicket.viewUrl(t.agentId, norm(t.path));
  }
  function normalizeTarget(t) {
    if (!t || !t.path) return null;
    const source = t.source === 'workshop' && t.runId ? 'workshop' : 'workspace';
    return { agentId: String(t.agentId || 'agent'), path: norm(t.path), runId: source === 'workshop' ? String(t.runId) : '', source };
  }
  function remember(t) {
    const k = keyOf(t);
    state.recent = [t].concat(state.recent.filter(x => keyOf(x) !== k)).slice(0, RECENT_MAX);
  }

  // ---------- the window ----------
  function build(body) {
    body.innerHTML =
      '<div class="ob">'
      + '<div class="ob-bar">'
      + '<span class="ob-lamp" aria-hidden="true"></span>'
      + '<span class="ob-addr"></span>'
      + '<button type="button" class="bb sm ob-reload">RELOAD</button>'
      + '<button type="button" class="bb sm ob-follow" aria-pressed="false"></button>'
      + '<button type="button" class="bb sm ob-out">OPEN OUTSIDE</button>'
      + '</div>'
      + '<div class="ob-recent" hidden></div>'
      + '<div class="ob-stage">'
      + '<iframe class="ob-frame" title="Agent-made page" sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock"referrerpolicy="no-referrer" hidden></iframe>'
      + '<div class="ob-empty"></div>'
      + '</div>'
      + '<p class="ob-note" role="status"></p>'
      + '</div>';
    const q = s => body.querySelector(s);
    state.ui = { body, root: q('.ob'), addr: q('.ob-addr'), reload: q('.ob-reload'), follow: q('.ob-follow'), out: q('.ob-out'),
      recent: q('.ob-recent'), frame: q('.ob-frame'), empty: q('.ob-empty'), note: q('.ob-note') };
    const ui = state.ui;
    ui.reload.onclick = () => { if (state.target) load('reloaded'); };
    ui.follow.onclick = () => setFollow(!state.follow);
    ui.out.onclick = openOutside;
    ui.recent.addEventListener('click', ev => {
      const b = ev.target && ev.target.closest ? ev.target.closest('button[data-i]') : null;
      if (!b) return;
      const t = state.recent[Number(b.dataset.i)];
      if (t) { state.target = t; load('opened'); }
    });
    ui.frame.addEventListener('load', () => {
      if (!state.ui || ui.frame.hidden || !ui.frame.getAttribute('src')) return;
      state.loadedAt = Date.now();
      paintStatus();
    });
    paintBar();
    if (state.target) load('opened'); else paintEmpty();
  }
  function mounted() { return !!(state.ui && state.ui.body && state.ui.body.isConnected); }

  function paintBar() {
    if (!mounted()) return;
    const ui = state.ui, t = state.target;
    ui.addr.innerHTML = t
      ? '<b>' + esc(agentLabel(t.agentId).toUpperCase()) + '</b><span class="ob-sep">·</span><span class="ob-path" title="' + esc(t.path) + '">' + esc(t.path) + '</span>'
        + (t.source === 'workshop' ? '<span class="ob-tag">WORKSHOP</span>' : '')
      : '<span class="ob-path">no page open</span>';
    ui.reload.disabled = !t; ui.out.disabled = !t;
    ui.follow.textContent = state.follow ? 'FOLLOW: ON' : 'FOLLOW: OFF';
    ui.follow.setAttribute('aria-pressed', String(state.follow));
    ui.follow.classList.toggle('on', state.follow);
    ui.follow.title = state.follow
      ? 'On: when an agent makes a new web page, this window opens and shows it.'
      : 'Off: new pages wait for you to open them. Turn on to have this window show each new page as an agent makes it.';
    const others = state.recent.filter(x => keyOf(x) !== keyOf(t));
    ui.recent.hidden = !others.length;
    ui.recent.innerHTML = others.length
      ? '<span class="ob-rlab">RECENT</span>' + others.map(x => {
        const i = state.recent.indexOf(x);
        return '<button type="button" class="ob-chip" data-i="' + i + '" title="' + esc(agentLabel(x.agentId) + ' · ' + x.path) + '">' + esc(baseOf(x.path)) + '</button>';
      }).join('')
      : '';
  }
  function paintEmpty() {
    if (!mounted()) return;
    const ui = state.ui;
    ui.frame.hidden = true; ui.frame.removeAttribute('src');
    ui.empty.hidden = false;
    ui.empty.innerHTML = '<p>When an agent makes a web page, open it here to see it running.</p>'
      + '<p class="ob-dim">Click any <b>.html</b> file an agent wrote in COMMS or the LIBRARY. Turn on <b>FOLLOW</b> and this window shows each new page as it\'s made.</p>';
    ui.root.dataset.state = 'empty';
    ui.note.textContent = '';
  }
  function paintStatus() {
    if (!mounted() || !state.target) return;
    const ui = state.ui;
    ui.root.dataset.state = 'live';
    const when = new Date(state.loadedAt || Date.now()).toLocaleTimeString();
    ui.note.textContent = (state.lastCause === 'updated' ? 'Updated on disk, reloaded at ' : 'Showing the file on disk as of ') + when + '.';
  }

  // Confirm the file is really there before claiming a page (the frame's load event fires on a 404 too, and a
  // cross-origin frame can't be asked). HEAD on the station's own jailed file route answers for both sources.
  async function exists(t) {
    try {
      const r = await fetch('/api/file?agent=' + encodeURIComponent(t.agentId) + '&path=' + encodeURIComponent(jailRel(t)), { method: 'HEAD', cache: 'no-store' });
      return r.ok ? true : (r.status === 404 ? false : null);
    } catch (_) { return null; }
  }
  async function load(cause) {
    if (!mounted() || !state.target) return;
    const t = state.target, seq = ++state.loadSeq, ui = state.ui;
    state.lastCause = cause || 'opened';
    paintBar();
    ui.root.dataset.state = 'loading';
    ui.note.textContent = 'Loading…';
    const ok = await exists(t);
    if (seq !== state.loadSeq || !mounted()) return;
    if (ok === false) {
      ui.frame.hidden = true; ui.frame.removeAttribute('src');
      ui.empty.hidden = false;
      ui.empty.innerHTML = '<p>That page isn\'t on disk any more.</p><p class="ob-dim">' + esc(t.path) + ' was moved or deleted after the agent wrote it.</p>';
      ui.root.dataset.state = 'missing';
      ui.note.textContent = '';
      return;
    }
    const url = pageUrl(t);
    if (!url) {
      ui.frame.hidden = true; ui.empty.hidden = false;
      ui.empty.innerHTML = '<p>The station isn\'t reachable, so this page can\'t be shown right now.</p>';
      ui.root.dataset.state = 'missing'; ui.note.textContent = '';
      return;
    }
    ui.empty.hidden = true;
    ui.frame.hidden = false;
    ui.frame.src = url;   // a fresh ticket every load: the old one may be past its ten-minute life
  }
  function scheduleReload() {
    clearTimeout(state.reloadTimer);
    state.reloadTimer = setTimeout(() => { state.reloadTimer = null; load('updated'); }, RELOAD_DEBOUNCE_MS);
  }

  function openOutside() {
    const t = state.target; if (!t) return;
    const url = pageUrl(t);
    if (!url) { notify('could not open that — the station may be unreachable'); return; }
    const core = tauriCore();
    if (core && core.invoke) {
      Promise.resolve(core.invoke('open_external_url', { url })).catch(() => notify('could not open your browser'));
      return;
    }
    let win = null;
    try { win = root.open(url, '_blank', 'noopener'); } catch (_) {}
    if (!win) notify('your browser blocked the new tab — allow popups for the station, then try again');
  }

  function setFollow(on) {
    state.follow = !!on;
    try { if (root.localStorage) root.localStorage.setItem(FOLLOW_KEY, state.follow ? '1' : '0'); } catch (_) {}
    paintBar();
  }

  function showWindow() {
    if (typeof StationUI === 'undefined' || !StationUI.openTerm) return false;
    if (mounted()) return true;
    StationUI.openTerm('browser');
    return mounted();
  }

  // ---------- public ----------
  // Open a page in the window (the click path from COMMS, the LIBRARY, a workshop card).
  function open(target) {
    const t = normalizeTarget(target);
    if (!t) return false;
    remember(t);
    state.target = t;
    if (mounted()) { load('opened'); return true; }
    return showWindow();   // build() loads state.target
  }
  // Every file an agent writes lands here (the hero run's stream and the channel bridge both call it; a burst of
  // writes collapses into one reload). Only kind:'file' carries a real workspace path.
  function noteOutput(ev) {
    if (!ev || ev.kind !== 'file' || !ev.title) return;
    const agentId = String(ev.agentId || 'agent');
    const path = norm(ev.title);
    const t = state.target;
    const onScreen = !!(t && t.source === 'workspace' && t.agentId === agentId && mounted());
    // ANOTHER page (not the one on screen): it joins RECENT, and with FOLLOW on it takes the window
    if (HTML_RE.test(path) && !(onScreen && path === t.path)) {
      const nt = { agentId, path, source: 'workspace', runId: '' };
      remember(nt);
      if (state.follow) { open(nt); return; }
      if (mounted()) paintBar();   // the RECENT strip grows even when FOLLOW is off
      return;
    }
    // the page on screen was rewritten, or a web asset under its folder was (its css, its js) → show the new bytes
    if (onScreen && feedsPage(path, t.path)) scheduleReload();
  }

  let busWired = false;
  function init() {
    if (typeof StationUI !== 'undefined' && StationUI.registerWindow) {
      StationUI.registerWindow('browser', 'BROWSER', build, { wide: true, className: 'browser-win' });
    }
    if (!busWired && typeof U !== 'undefined' && U.bus && U.bus.on) {
      busWired = true;
      U.bus.on('deliverable', p => { try { noteOutput(p); } catch (_) {} });   // background (channel/routine) runs
    }
  }

  const api = { open, noteOutput, setFollow, isFollowing: () => state.follow, isHtml: p => HTML_RE.test(String(p || '')), init,
    _state: state, _test: { norm, dirOf, jailRel, normalizeTarget, feedsPage } };
  root.OutputBrowser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
