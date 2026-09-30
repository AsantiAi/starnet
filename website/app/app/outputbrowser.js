/* STARNET — outputbrowser.js : the BROWSER window.

   Andrew, 2026-09-29/30: "a built in browser … when creating output, maybe it's optional for the expandable window to
   actively show the output" → "a browser button integrated cleanly in comms, so users can easily open it up to see
   what the agent is doing … should also allow the user to type a URL in".

   ONE docked window (StationUI 'browser', WIDE shell), three things it can show:
     · PAGE   a web page an agent MADE (an .html in its workspace, or a workshop tool's entry page). Rendered in a
              sandboxed iframe from /view/ or /workshop-run/ (CSP `sandbox allow-scripts`, opaque origin — the page
              can never reach the app token or the API; the iframe adds its own sandbox as a second wall).
     · WATCH  the browser an agent is USING right now: a live picture of the run's own headless Chrome (sidecar
              browser-view.js). View only — the agent drives. When it needs you, the STEP IN door appears here and
              the wheel changes hands in STEP-IN (frontend/app/stepin.js), never silently.
     · WEB    an address YOU type: opens in a station-owned browser (real Chrome, streamed; your mouse and keys are
              forwarded). Temporary profile: what you sign in to there lasts until the window closes.

   The COMMS header carries the door (#comms-browser): one click opens this window on the agent you're talking to —
   its live browser if it has one, else the last page it made, else an empty address bar. The button's lamp is lit
   only while the station confirms that agent has a browser page open.

   FOLLOW (off by default, remembered per viewer): when on, a NEW page an agent makes — or an agent starting to
   browse — opens this window and shows it. Independent of FOLLOW, the PAGE on screen reloads when its file (or a
   web asset in its folder) is rewritten: the real bytes on disk, never a guess.

   Truthful telemetry: PAGE says "loaded" only after the station confirmed the file exists and the frame fired load;
   WATCH/WEB show only frames the station sent, and the address shown is the one the browser itself reports. */
'use strict';
(function (root) {
  const FOLLOW_KEY = 'starnet.outputBrowser.follow';
  const RECENT_MAX = 8;
  const RELOAD_DEBOUNCE_MS = 400;
  const LIVE_DEBOUNCE_MS = 500;
  const HTML_RE = /\.html?$/i;
  const ASSET_RE = /\.(html?|css|m?js|json|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp3|wav|ogg|mp4|webm)$/i;

  const state = {
    mode: 'empty',       // 'empty' | 'page' | 'watch' | 'web'
    target: null,        // PAGE: { agentId, path, runId?, source: 'workspace'|'workshop' }
    watch: null,         // WATCH: { agentId, runId, target }
    recent: [],          // pages made this session, newest first
    live: { agents: [], commander: { open: false, remembered: false, available: true } },   // station truth (GET /api/browser/view)
    liveLoaded: false,
    page: null,          // WATCH/WEB: the address the browser itself reports { url, title }
    follow: false,
    ui: null,
    reloadTimer: null, liveTimer: null,
    loadSeq: 0, opSeq: 0, loadedAt: 0, lastCause: '', note: '', busy: false
  };
  try { state.follow = !!(root.localStorage && root.localStorage.getItem(FOLLOW_KEY) === '1'); } catch (_) { state.follow = false; }

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = p => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const dirOf = p => { const n = norm(p); const i = n.lastIndexOf('/'); return i < 0 ? '' : n.slice(0, i); };
  const baseOf = p => { const n = norm(p); return n.slice(n.lastIndexOf('/') + 1); };
  // Does a write to `path` change what the page at `pagePath` renders? The page itself, or a web asset in its
  // folder tree (a page at the workspace root owns the whole tree).
  function feedsPage(path, pagePath) {
    if (path === pagePath) return true;
    if (!ASSET_RE.test(path)) return false;
    const d = dirOf(pagePath);
    return !d || path.indexOf(d + '/') === 0;
  }
  const keyOf = t => t ? [t.source, t.agentId, t.runId || '', norm(t.path)].join('|') : '';
  function agentLabel(id) {
    if (typeof App !== 'undefined' && App && typeof App.agentName === 'function') { try { return App.agentName(id) || id; } catch (_) { /* fall through to the id */ } }
    try {
      const list = (typeof StationUI !== 'undefined' && StationUI.h) ? StationUI.h.present : [];
      const a = (list || []).find(x => x && x.id === id);
      if (a && a.name) return String(a.name);
    } catch (_) { /* fall through to the id */ }
    return String(id || 'agent');
  }
  const apiBase = () => String(root.__STARNET_API__ || '');
  function tauriCore() { return (root.__TAURI__ && root.__TAURI__.core) ? root.__TAURI__.core : null; }
  function notify(msg, tone) { if (typeof StationUI !== 'undefined' && StationUI.notify) StationUI.notify(msg, tone || 'warn'); }
  function getJson(path, signal) {
    return fetch(apiBase() + path, { cache: 'no-store', signal }).then(async r => { let j = null; try { j = await r.json(); } catch (_) { j = null; } return { status: r.status, body: j || {} }; });
  }
  function postJson(path, body) {
    return fetch(apiBase() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(async r => { let j = null; try { j = await r.json(); } catch (_) { j = null; } return { status: r.status, body: j || {} }; });
  }

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
  function liveAgent(agentId) { return (state.live.agents || []).find(a => a && a.agentId === agentId) || null; }

  // ---------- icons (drawn, never a glyph: symbol characters fall back to the OS font) ----------
  const ICON = {
    back: 'M10 3L5 8l5 5', forward: 'M6 3l5 5-5 5', reload: 'M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3',
    globe: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM1.5 8h13M8 1.5c-2 2-2 11 0 13M8 1.5c2 2 2 11 0 13'
  };
  function icon(kind) {
    return '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4" data-ob-icon="' + kind + '"><path d="' + ICON[kind] + '"/></svg>';
  }

  // ---------- the window ----------
  function build(body) {
    body.innerHTML =
      '<div class="ob" data-mode="empty">'
      + '<form class="ob-bar" autocomplete="off">'
      + '<button type="button" class="bb sm ob-ic ob-back" aria-label="Back">' + icon('back') + '</button>'
      + '<button type="button" class="bb sm ob-ic ob-fwd" aria-label="Forward">' + icon('forward') + '</button>'
      + '<button type="button" class="bb sm ob-ic ob-reload" aria-label="Reload">' + icon('reload') + '</button>'
      + '<div class="ob-addr"><span class="ob-lamp" aria-hidden="true"></span><span class="ob-who"></span>'
      + '<input class="ob-url" type="text" spellcheck="false" autocapitalize="off" autocorrect="off" maxlength="2000" aria-label="Address" placeholder="Type an address or search"></div>'
      + '</form>'
      + '<div class="ob-strip"><div class="ob-recent"></div>'
      + '<button type="button" class="bb sm ob-follow" aria-pressed="false"></button>'
      + '<button type="button" class="bb sm ob-out">OPEN OUTSIDE</button></div>'
      + '<div class="ob-stage">'
      + '<iframe class="ob-frame" title="Agent-made page" sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock" referrerpolicy="no-referrer" hidden></iframe>'
      + '<div class="ob-vp" tabindex="0" role="application" aria-label="Live browser picture" hidden><img class="ob-live" alt="" draggable="false"></div>'
      + '<div class="ob-empty"></div>'
      + '</div>'
      + '<p class="ob-note" role="status"></p>'
      + '</div>';
    const q = s => body.querySelector(s);
    const ui = state.ui = { body, root: q('.ob'), bar: q('.ob-bar'), back: q('.ob-back'), fwd: q('.ob-fwd'), reload: q('.ob-reload'),
      who: q('.ob-who'), url: q('.ob-url'), follow: q('.ob-follow'), out: q('.ob-out'), recent: q('.ob-recent'),
      frame: q('.ob-frame'), vp: q('.ob-vp'), img: q('.ob-live'), empty: q('.ob-empty'), note: q('.ob-note'), watchStream: null, webStream: null };
    if (typeof BrowserStream !== 'undefined') {
      const ended = mode => b => { if (state.mode === mode) streamEnded(b || {}); };
      const onPage = p => { state.page = p; paintBar(); };
      ui.watchStream = BrowserStream.create({ vp: ui.vp, img: ui.img, onPage, onEnd: ended('watch'),
        poll: (seq, signal) => getJson('/api/browser/view/frame?target=' + encodeURIComponent(state.watch ? state.watch.target : '') + '&after=' + seq, signal) });
      ui.webStream = BrowserStream.create({ vp: ui.vp, img: ui.img, onPage, onEnd: ended('web'),
        poll: (seq, signal) => getJson('/api/browser/view/frame?target=commander&after=' + seq, signal),
        send: events => postJson('/api/browser/view/input', { events }) });
    }
    ui.bar.addEventListener('submit', ev => { ev.preventDefault(); go(ui.url.value); });
    ui.url.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Escape') { ev.preventDefault(); paintBar(true); ui.url.blur(); } });
    ui.url.addEventListener('focus', () => { try { ui.url.select(); } catch (_) { /* selection is a nicety */ } });
    ui.reload.onclick = () => reload();
    ui.back.onclick = () => webNav('back');
    ui.fwd.onclick = () => webNav('forward');
    ui.follow.onclick = () => setFollow(!state.follow);
    ui.out.onclick = openOutside;
    ui.recent.addEventListener('click', ev => {
      const b = ev.target && ev.target.closest ? ev.target.closest('button[data-k]') : null;
      if (!b) return;
      if (b.dataset.k === 'page') { const t = state.recent[Number(b.dataset.i)]; if (t) showPage(t, 'opened'); }
      else if (b.dataset.k === 'agent') { const a = (state.live.agents || [])[Number(b.dataset.i)]; if (a) showWatch(a); }
      else if (b.dataset.k === 'web') showWeb();
    });
    ui.empty.addEventListener('click', ev => {
      const b = ev.target && ev.target.closest ? ev.target.closest('button[data-act]') : null;
      if (!b) return;
      if (b.dataset.act === 'stepin' && typeof StepIn !== 'undefined' && StepIn.open) StepIn.open(b.dataset.id || '');
    });
    ui.frame.addEventListener('load', () => {
      if (!state.ui || state.mode !== 'page' || ui.frame.hidden || !ui.frame.getAttribute('src')) return;
      state.loadedAt = Date.now();
      setNote((state.lastCause === 'updated' ? 'Updated on disk, reloaded at ' : 'Showing the file on disk as of ') + new Date(state.loadedAt).toLocaleTimeString() + '.');
      ui.root.dataset.state = 'live';
    });
    paintBar();
    render('opened');
    refreshLive();
  }
  function mounted() { return !!(state.ui && state.ui.body && state.ui.body.isConnected); }
  function setNote(text) { state.note = String(text || ''); if (mounted() && state.ui.note.textContent !== state.note) state.ui.note.textContent = state.note; }
  function stopStreams() { const ui = state.ui; if (!ui) return; if (ui.watchStream) ui.watchStream.stop(); if (ui.webStream) ui.webStream.stop(); }
  function stage(which) {   // 'frame' | 'live' | 'empty'
    const ui = state.ui;
    ui.frame.hidden = which !== 'frame'; if (which !== 'frame') ui.frame.removeAttribute('src');
    ui.vp.hidden = which !== 'live'; if (which !== 'live') ui.img.removeAttribute('src');
    ui.empty.hidden = which !== 'empty';
  }

  function paintBar(forceUrl) {
    if (!mounted()) return;
    const ui = state.ui, m = state.mode, t = state.target;
    ui.root.dataset.mode = m;
    const who = m === 'page' && t ? agentLabel(t.agentId) : m === 'watch' && state.watch ? agentLabel(state.watch.agentId) : m === 'web' ? 'YOU' : '';
    ui.who.textContent = who ? who.toUpperCase() : '';
    ui.who.hidden = !who;
    // never overwrite what the Commander is typing
    if (forceUrl || root.document.activeElement !== ui.url) {
      ui.url.value = m === 'page' && t ? t.path : (m === 'watch' || m === 'web') && state.page ? (state.page.url || '') : '';
    }
    ui.url.title = m === 'page' && t ? t.path + (t.source === 'workshop' ? ' (workshop)' : '') : (state.page && state.page.title) || '';
    ui.back.disabled = ui.fwd.disabled = m !== 'web' || state.busy;
    ui.reload.disabled = !(m === 'page' || m === 'web') || state.busy;
    ui.out.disabled = !((m === 'page' && t) || ((m === 'watch' || m === 'web') && state.page && /^https?:/i.test(state.page.url || '')));
    ui.follow.textContent = state.follow ? 'FOLLOW: ON' : 'FOLLOW: OFF';
    ui.follow.setAttribute('aria-pressed', String(state.follow));
    ui.follow.classList.toggle('on', state.follow);
    ui.follow.title = state.follow
      ? 'On: when an agent makes a web page or starts browsing, this window opens and shows it.'
      : 'Off: nothing opens by itself. Turn on to have this window show each page an agent makes, and its browser when it starts browsing.';
    paintStrip();
  }
  function paintStrip() {
    if (!mounted()) return;
    const ui = state.ui, parts = [];
    (state.live.agents || []).forEach((a, i) => {
      const on = state.mode === 'watch' && state.watch && state.watch.runId === a.runId;
      parts.push('<button type="button" class="ob-chip ob-livechip' + (on ? ' on' : '') + '" data-k="agent" data-i="' + i + '" title="' + esc(agentLabel(a.agentId)) + (a.handoff ? ' needs you in its browser' : ' is browsing: watch it') + '">'
        + '<span class="ob-dot' + (a.handoff ? ' ask' : '') + '" aria-hidden="true"></span>' + esc(agentLabel(a.agentId).toUpperCase()) + (a.handoff ? ' · NEEDS YOU' : ' · LIVE') + '</button>');
    });
    if (state.live.commander && state.live.commander.open) {
      parts.push('<button type="button" class="ob-chip' + (state.mode === 'web' ? ' on' : '') + '" data-k="web" title="The browser you opened">YOUR BROWSER</button>');
    }
    const others = state.recent.filter(x => !(state.mode === 'page' && keyOf(x) === keyOf(state.target)));
    if (others.length) parts.push('<span class="ob-rlab">PAGES</span>' + others.map(x => '<button type="button" class="ob-chip" data-k="page" data-i="' + state.recent.indexOf(x) + '" title="' + esc(agentLabel(x.agentId) + ' · ' + x.path) + '">' + esc(baseOf(x.path)) + '</button>').join(''));
    const html = parts.join('');
    if (ui.recent.innerHTML !== html) ui.recent.innerHTML = html;
  }

  // ---------- what the stage shows ----------
  function render(cause) {
    if (!mounted()) return;
    if (state.mode === 'page' && state.target) return loadPage(cause);
    if (state.mode === 'watch' && state.watch) return startWatch();
    if (state.mode === 'web') return startWeb();
    state.mode = 'empty';
    stopStreams(); stage('empty');
    state.ui.root.dataset.state = 'empty';
    state.ui.empty.innerHTML = '<p>Type an address above to browse, or open a page an agent made.</p>'
      + '<p class="ob-dim">When an agent is using its browser you can watch it here. Turn on <b>FOLLOW</b> and this window shows each page an agent makes, and its browser when it starts browsing.</p>';
    setNote('');
    paintBar();
  }

  // Confirm the file is really there before claiming a page (the frame's load event fires on a 404 too, and a
  // cross-origin frame can't be asked). HEAD on the station's own jailed file route answers for both sources.
  async function exists(t) {
    try {
      const r = await fetch('/api/file?agent=' + encodeURIComponent(t.agentId) + '&path=' + encodeURIComponent(jailRel(t)), { method: 'HEAD', cache: 'no-store' });
      return r.ok ? true : (r.status === 404 ? false : null);
    } catch (_) { return null; }
  }
  async function loadPage(cause) {
    if (!mounted() || !state.target) return;
    const t = state.target, seq = ++state.loadSeq, ui = state.ui;
    state.lastCause = cause || 'opened';
    stopStreams();
    paintBar(true);
    ui.root.dataset.state = 'loading';
    setNote('Loading…');
    const ok = await exists(t);
    if (seq !== state.loadSeq || !mounted() || state.mode !== 'page') return;
    if (ok === false) {
      stage('empty');
      ui.empty.innerHTML = '<p>That page isn\'t on disk any more.</p><p class="ob-dim">' + esc(t.path) + ' was moved or deleted after the agent wrote it.</p>';
      ui.root.dataset.state = 'missing'; setNote('');
      return;
    }
    const url = pageUrl(t);
    if (!url) {
      stage('empty');
      ui.empty.innerHTML = '<p>The station isn\'t reachable, so this page can\'t be shown right now.</p>';
      ui.root.dataset.state = 'missing'; setNote('');
      return;
    }
    stage('frame');
    ui.frame.src = url;   // a fresh ticket every load: the old one may be past its ten-minute life
  }
  function scheduleReload() {
    clearTimeout(state.reloadTimer);
    state.reloadTimer = setTimeout(() => { state.reloadTimer = null; if (state.mode === 'page') loadPage('updated'); }, RELOAD_DEBOUNCE_MS);
  }

  function startWatch() {
    const ui = state.ui, w = state.watch;
    ui.frame.hidden = true; ui.frame.removeAttribute('src');
    if (ui.webStream) ui.webStream.stop();
    state.page = null;
    const a = liveAgent(w.agentId);
    if (a && a.handoff) return showHandoff(w.agentId);
    stage('live');
    ui.root.dataset.state = 'live';
    setNote('Watching ' + agentLabel(w.agentId) + '\'s browser. View only: the agent is driving.');
    paintBar(true);
    if (ui.watchStream) ui.watchStream.start();
  }
  function showHandoff(agentId) {
    const ui = state.ui;
    stopStreams(); stage('empty');
    ui.root.dataset.state = 'ask';
    const name = esc(agentLabel(agentId).toUpperCase());
    let id = '';
    try { const l = (typeof StepIn !== 'undefined' && typeof StepIn.live === 'function') ? StepIn.live() : []; const h = l.find(x => x && x.agentId === agentId); if (h) id = String(h.id); } catch (_) { id = ''; }
    const canOpen = typeof StepIn !== 'undefined' && typeof StepIn.open === 'function';
    ui.empty.innerHTML = '<p>' + name + ' needs you in its browser.</p>'
      + '<p class="ob-dim">It is paused on a page only you can get past (a sign-in, a code, a human check). Take its browser in STEP-IN, then hand it back.</p>'
      + (canOpen ? '<button type="button" class="bb sm" data-act="stepin" data-id="' + esc(id) + '">STEP IN</button>' : '');
    setNote('');
    paintBar(true);
  }
  function streamEnded(b) {
    if (!mounted()) return;
    const ui = state.ui, code = b && b.code;
    if (state.mode === 'watch' && state.watch) {
      const agentId = state.watch.agentId;
      if (code === 'handoff') { refreshLive(); return showHandoff(agentId); }
      stage('empty');
      ui.root.dataset.state = 'ended';
      ui.empty.innerHTML = '<p>' + esc(agentLabel(agentId).toUpperCase()) + '\'s browser closed.</p><p class="ob-dim">' + (code === 'ended' ? 'The run finished, and its browser went with it.' : code === 'closed' ? 'It has no page open right now.' : esc((b && b.error) || 'The picture stopped.')) + '</p>';
      setNote(''); state.page = null; paintBar(true); refreshLive();
      return;
    }
    if (state.mode === 'web') {
      stage('empty');
      ui.root.dataset.state = 'ended';
      ui.empty.innerHTML = '<p>Your browser closed.</p><p class="ob-dim">' + (code === 'closed' ? 'It closes itself after ten minutes unused. Type an address to open it again.' : esc((b && b.error) || 'The picture stopped.')) + '</p>';
      setNote(''); state.page = null; paintBar(true); refreshLive();
    }
  }
  function startWeb() {
    const ui = state.ui;
    ui.frame.hidden = true; ui.frame.removeAttribute('src');
    if (ui.watchStream) ui.watchStream.stop();
    stage('live');
    ui.root.dataset.state = 'live';
    setNote('Your browser. Sign-ins here last until this window closes. Click the page to type in it.');
    paintBar(true);
    if (ui.webStream) ui.webStream.start();
  }

  // ---------- the address bar ----------
  async function go(text) {
    const raw = String(text || '').trim();
    if (!raw || !mounted()) return;
    const ui = state.ui;
    // the page on screen, retyped or untouched → just reload it
    if (state.mode === 'page' && state.target && raw === state.target.path) { loadPage('reloaded'); return; }
    // a typed address always wins: it supersedes a back/forward/reload (or an earlier address) still in flight
    const op = ++state.opSeq;
    state.busy = true; paintBar();
    setNote('Opening…');
    const r = await postJson('/api/browser/view/open', { url: raw }).catch(() => ({ status: 0, body: {} }));
    if (op !== state.opSeq) return;
    state.busy = false;
    if (!mounted()) return;
    if (r.status !== 200 || !r.body.ok) {
      setNote('Could not open that: ' + ((r.body && r.body.error) || 'the station did not answer') + '.');
      paintBar();
      return;
    }
    state.mode = 'web'; state.watch = null;
    state.page = { url: r.body.url || '', title: '' };
    state.live.commander = Object.assign({}, state.live.commander, { open: true });
    try { ui.url.blur(); } catch (_) { /* focus is best-effort */ }
    startWeb();
    try { ui.vp.focus(); } catch (_) { /* focus is best-effort */ }
  }
  async function webNav(action) {
    if (state.mode !== 'web' || state.busy) return;
    const op = ++state.opSeq;
    state.busy = true; paintBar();
    const r = await postJson('/api/browser/view/nav', { action }).catch(() => ({ status: 0, body: {} }));
    if (op !== state.opSeq) return;
    state.busy = false;
    if (r.status !== 200) setNote('Could not go ' + action + ': ' + ((r.body && r.body.error) || 'the station did not answer') + '.');
    paintBar();
  }
  function reload() {
    if (state.mode === 'page' && state.target) loadPage('reloaded');
    else if (state.mode === 'web') webNav('reload');
  }
  function openOutside() {
    let url = '';
    if (state.mode === 'page' && state.target) url = pageUrl(state.target);
    else if ((state.mode === 'watch' || state.mode === 'web') && state.page && /^https?:/i.test(state.page.url || '')) url = state.page.url;
    if (!url) { notify('could not open that — the station may be unreachable'); return; }
    const core = tauriCore();
    if (core && core.invoke) { Promise.resolve(core.invoke('open_external_url', { url })).catch(() => notify('could not open your browser')); return; }
    let win = null;
    try { win = root.open(url, '_blank', 'noopener'); } catch (_) { win = null; }
    if (!win) notify('your browser blocked the new tab — allow popups for the station, then try again');
  }

  function setFollow(on) {
    state.follow = !!on;
    try { if (root.localStorage) root.localStorage.setItem(FOLLOW_KEY, state.follow ? '1' : '0'); } catch (_) { /* a private window has no storage: FOLLOW just isn't remembered */ }
    paintBar();
  }

  // ---------- station truth: who has a browser open ----------
  function refreshLive() {
    return getJson('/api/browser/view').then(r => {
      if (r.status !== 200 || !r.body || !r.body.ok) return;
      const before = new Set((state.live.agents || []).map(a => a.runId));
      state.live = { agents: Array.isArray(r.body.agents) ? r.body.agents : [], commander: r.body.commander || { open: false } };
      const first = !state.liveLoaded; state.liveLoaded = true;
      paintDoor();
      if (mounted()) {
        paintStrip();
        if (state.mode === 'watch' && state.watch) {
          const a = liveAgent(state.watch.agentId);
          if (a && a.handoff && state.ui.root.dataset.state !== 'ask') showHandoff(state.watch.agentId);
          else if (a && !a.handoff && (state.ui.root.dataset.state === 'ask' || state.ui.root.dataset.state === 'ended')) { state.watch = { agentId: a.agentId, runId: a.runId, target: a.target }; startWatch(); }
        }
      }
      // FOLLOW: an agent that just started browsing takes the window (never on the first read after a page load)
      if (state.follow && !first) {
        const fresh = state.live.agents.find(a => !before.has(a.runId) && !a.handoff);
        if (fresh && state.mode !== 'web') showWatch(fresh);
      }
    }).catch(() => { /* the station is unreachable: the door simply shows no lamp */ });
  }
  function scheduleLive() {
    clearTimeout(state.liveTimer);
    state.liveTimer = setTimeout(() => { state.liveTimer = null; refreshLive(); }, LIVE_DEBOUNCE_MS);
  }

  function showWindow() {
    if (typeof StationUI === 'undefined' || !StationUI.openTerm) return false;
    if (mounted()) return true;
    StationUI.openTerm('browser');
    return mounted();
  }
  function showPage(t, cause) {
    remember(t);
    state.mode = 'page'; state.target = t; state.watch = null;
    if (mounted()) { loadPage(cause || 'opened'); return true; }
    return showWindow();
  }
  function showWatch(a) {
    state.mode = 'watch'; state.watch = { agentId: a.agentId, runId: a.runId, target: a.target };
    if (mounted()) { startWatch(); return true; }
    return showWindow();
  }
  function showWeb() {
    state.mode = 'web'; state.watch = null;
    if (mounted()) { startWeb(); return true; }
    return showWindow();
  }

  // ---------- public ----------
  // Open a page in the window (the click path from COMMS, the LIBRARY, a workshop card, the desk screen).
  function open(target) {
    const t = normalizeTarget(target);
    if (!t) return false;
    return showPage(t, 'opened');
  }
  // The COMMS door: open on the agent the Commander is talking to — its live browser, else the last page it made,
  // else the address bar.
  async function openFor(agentId) {
    const aid = String(agentId || 'agent');
    await refreshLive();
    const a = liveAgent(aid);
    if (a) return showWatch(a);
    const last = state.recent.find(x => x.agentId === aid);
    if (last) return showPage(last, 'opened');
    if (state.live.commander && state.live.commander.open) return showWeb();
    if (!mounted()) { if (state.mode !== 'page' || !state.target) state.mode = 'empty'; showWindow(); }
    if (mounted() && state.mode === 'empty') { try { state.ui.url.focus(); } catch (_) { /* focus is best-effort */ } }
    return mounted();
  }
  // Every file an agent writes lands here (the hero run's stream and the channel bridge both call it; a burst of
  // writes collapses into one reload). Only kind:'file' carries a real workspace path.
  function noteOutput(ev) {
    if (!ev || ev.kind !== 'file' || !ev.title) return;
    const agentId = String(ev.agentId || 'agent');
    const path = norm(ev.title);
    const t = state.target;
    const onScreen = !!(state.mode === 'page' && t && t.source === 'workspace' && t.agentId === agentId && mounted());
    // ANOTHER page (not the one on screen): it joins the PAGES strip, and with FOLLOW on it takes the window
    if (HTML_RE.test(path) && !(onScreen && path === t.path)) {
      const nt = { agentId, path, source: 'workspace', runId: '' };
      remember(nt);
      if (state.follow && state.mode !== 'web') { open(nt); return; }
      if (mounted()) paintStrip();
      return;
    }
    // the page on screen was rewritten, or a web asset under its folder was (its css, its js) → show the new bytes
    if (onScreen && feedsPage(path, t.path)) scheduleReload();
  }

  // ---------- the COMMS door ----------
  function lineAgent() {
    try { const sel = root.document.getElementById('comms-agent-select'); if (sel && sel.value) return String(sel.value); } catch (_) { /* no COMMS header */ }
    return 'agent';
  }
  function paintDoor() {
    const b = root.document && root.document.getElementById('comms-browser');
    if (!b) return;
    const aid = lineAgent(), a = liveAgent(aid), name = agentLabel(aid);
    b.classList.toggle('live', !!a && !a.handoff);
    b.classList.toggle('ask', !!(a && a.handoff));
    const tip = a ? (a.handoff ? name + ' needs you in its browser' : name + ' is browsing: watch it') : 'Browser: see what ' + name + ' is doing, or type an address';
    b.setAttribute('aria-label', tip);
    if (b.hasAttribute('data-tip')) b.setAttribute('data-tip', tip); else b.title = tip;
  }
  function mountDoor() {
    const doc = root.document; if (!doc) return false;
    const bar = doc.getElementById('comms-idbar');
    if (!bar || doc.getElementById('comms-browser')) return !!bar;
    const b = doc.createElement('button');
    b.type = 'button'; b.id = 'comms-browser'; b.className = 'comms-browser';
    b.innerHTML = icon('globe') + '<span class="cb-lamp" aria-hidden="true"></span>';
    b.addEventListener('click', () => { openFor(lineAgent()); });
    const add = doc.getElementById('gc-add-agents');
    if (add && add.parentNode === bar) bar.insertBefore(b, add); else bar.appendChild(b);
    const sel = doc.getElementById('comms-agent-select');
    if (sel) sel.addEventListener('change', paintDoor);
    paintDoor();
    return true;
  }

  let busWired = false;
  function init() {
    if (typeof StationUI !== 'undefined' && StationUI.registerWindow) {
      StationUI.registerWindow('browser', 'BROWSER', build, { wide: true, className: 'browser-win', onClose: () => {
        stopStreams();
        // the Commander's own browser is a whole Chrome: it goes when the window goes
        if (state.live.commander && state.live.commander.open) postJson('/api/browser/view/close', {}).then(() => refreshLive()).catch(() => { /* it idles out on its own */ });
        if (state.mode === 'web') state.mode = state.target ? 'page' : 'empty';
        state.ui = null;
      } });
    }
    if (!busWired && typeof U !== 'undefined' && U.bus && U.bus.on) {
      busWired = true;
      U.bus.on('deliverable', p => { try { noteOutput(p); } catch (_) { /* a bad event never breaks the bus */ } });   // background (channel/routine) runs
      // who has a browser open changes when an agent uses a browser tool, when a run ends, and around a handoff —
      // ask the station then (never poll, never guess from the event itself)
      U.bus.on('agent.tool_call', p => { if (p && /^browser[._]/.test(String(p.name || ''))) scheduleLive(); });
      U.bus.on('agent.tool_result', p => { if (p && /^browser[._]/.test(String(p.name || ''))) scheduleLive(); });
      ['agent.run.end', 'agent.run.error', 'browser.handoff'].forEach(n => U.bus.on(n, () => scheduleLive()));
    }
    if (root.document) {
      const boot = () => { if (!mountDoor()) return; refreshLive(); };
      if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
    }
  }

  const api = { open, openFor, noteOutput, setFollow, isFollowing: () => state.follow, isHtml: p => HTML_RE.test(String(p || '')), init,
    _state: state, _test: { norm, dirOf, jailRel, normalizeTarget, feedsPage } };
  root.OutputBrowser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
