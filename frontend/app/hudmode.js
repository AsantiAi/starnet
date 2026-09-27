/* STARNET hudmode.js — HUD MODE: StarNet as a small always-on-top panel.
   For the Commander who is gaming or watching something and wants their agents one glance away
   without the whole station on screen.

   The HUD is NOT a second app. It is this same page with the station hidden, the world renderer
   stopped, and the REAL COMMS panel (ON THE LINE agent picker, group chat + ADD AGENTS, the
   transcript, the composer, STOP) filling a compact frame, so every send, stream and history row
   is the one COMMS already owns. On the desktop the Rust shell (src-tauri/src/hud_mode.rs) turns
   the window itself into a corner panel: small, pinned above other windows, and restored to the
   exact size/position/maximized/fullscreen state it had when the HUD closes.

   The deck above COMMS is the station at a glance, and it states only what the harness can prove:
     · LIVE rows are the runs the sidecar's GET /api/state/snapshot lists as running (the same
       authoritative ledger the world reconciles against), polled while the HUD is up and enriched by
       the real agent.run.* / agent.tool_call events on U.bus (the step a run is on). A run the
       snapshot stops listing is gone, whatever the last event said.
     · NEEDS YOU is the snapshot showing a permission prompt pending on that run.
     · the recent rows are agent.run.end / agent.run.error events this page actually received.
     · NO LINK is the snapshot poll itself failing. Before the first snapshot lands the deck says
       nothing rather than claiming IDLE.
   Everything is event/interval driven; the HUD adds no animation loop of its own. */
'use strict';

(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HudMode = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const PREF_KEY = 'starnet.hud';          // { pinned, rect } — per machine, a convenience only
  const POLL_MS = 4000;                    // snapshot cadence while the HUD is up (local sidecar, tiny JSON)
  const START_GRACE_MS = 8000;             // an event-only run the snapshot has not caught up with yet
  const RECENT_MAX = 3;                    // finished rows kept under the live ones
  const RECENT_TTL_MS = 15 * 60 * 1000;    // a finish older than this is history, not "recent"
  const LIVE_MAX = 5;                      // live rows shown; the rest fold into "+N MORE"
  const TAURI_EVENT = 'starnet-hud';       // hud_mode.rs emits { active } from the tray menu

  /* ---------------- pure feed model (unit-tested in test/hudmode.test.js) ---------------- */

  function createFeed() {
    return { runs: new Map(), recent: [], prompts: new Set(), queues: new Map(), snapAt: 0, snapOk: null };
  }

  function touchRun(feed, p, now) {
    const id = String(p.runId);
    let r = feed.runs.get(id);
    if (!r) {
      r = { runId: id, agentId: String(p.agentId || ''), startedAt: null, seenAt: now, tool: '', callId: '', writing: false, trigger: '', confirmed: false };
      feed.runs.set(id, r);
    }
    if (p.agentId) r.agentId = String(p.agentId);
    r.seenAt = now;
    return r;
  }

  function onRunStart(feed, p, now) {
    if (!p || !p.runId || !p.agentId) return;
    const r = touchRun(feed, p, now);
    if (!r.startedAt) r.startedAt = now;
    if (p.trigger) r.trigger = String(p.trigger);
  }

  function onToolCall(feed, p, now) {
    if (!p || !p.runId || !p.name) return;
    const r = touchRun(feed, p, now);
    r.tool = String(p.name);
    r.callId = String(p.callId || '');
    r.writing = false;
  }

  /* The tool came back: the run is with the model again, so the row stops naming the tool.
     Returns whether the row changed (callers re-render only then). */
  function onToolResult(feed, p, now) {
    if (!p || !p.runId) return false;
    const r = feed.runs.get(String(p.runId));
    if (!r || !r.tool || (r.callId && p.callId && String(p.callId) !== r.callId)) return false;
    r.tool = ''; r.callId = ''; r.seenAt = now;
    return true;
  }

  /* Reply text is streaming (only the page that started a run receives its tokens — the SSE tee never
     carries them — so this lights for COMMS turns sent from this window, never guessed for others). */
  function onToken(feed, p, now) {
    if (!p || !p.runId) return false;
    const r = feed.runs.get(String(p.runId));
    if (!r) return false;
    r.seenAt = now;
    if (r.writing && !r.tool) return false;
    r.writing = true; r.tool = ''; r.callId = '';
    return true;
  }

  function pushRecent(feed, row) {
    feed.recent.unshift(row);
    if (feed.recent.length > RECENT_MAX) feed.recent.length = RECENT_MAX;
  }

  function onRunEnd(feed, p, now) {
    if (!p || !p.runId) return;
    const r = feed.runs.get(String(p.runId));
    feed.runs.delete(String(p.runId));
    const agentId = String(p.agentId || (r && r.agentId) || '');
    if (!agentId) return;
    // One row per run: a run.error already recorded for it is superseded by the run's own end.
    feed.recent = feed.recent.filter(x => x.runId !== String(p.runId));
    pushRecent(feed, { runId: String(p.runId), agentId, reason: String(p.reason || 'done'), at: now });
  }

  function onRunError(feed, p, now) {
    if (!p || !p.runId) return;
    const r = feed.runs.get(String(p.runId));
    feed.runs.delete(String(p.runId));
    const agentId = String(p.agentId || (r && r.agentId) || '');
    if (!agentId) return;
    // run.error is usually followed by run.end{error} for the same run: keep ONE row for it.
    feed.recent = feed.recent.filter(x => x.runId !== String(p.runId));
    pushRecent(feed, { runId: String(p.runId), agentId, reason: 'error', at: now });
  }

  /* The snapshot is the authority on WHAT is running. Event-only runs survive a short grace (the
     snapshot may simply be older than the run.start that arrived a moment ago); anything else the
     snapshot does not list is dropped. */
  function applySnapshot(feed, snap, now) {
    if (!snap || !Array.isArray(snap.runs)) return false;
    const live = new Set();
    for (const s of snap.runs) {
      if (!s || !s.runId) continue;
      const id = String(s.runId);
      live.add(id);
      const r = touchRun(feed, { runId: id, agentId: s.agentId }, now);
      const started = Number(s.startedAt);
      if (isFinite(started) && started > 0) r.startedAt = started;
      else if (!r.startedAt) r.startedAt = now;
      r.confirmed = true;
      if (s.source) r.source = String(s.source);
    }
    for (const [id, r] of feed.runs) {
      if (live.has(id)) continue;
      if (r.confirmed || now - r.seenAt > START_GRACE_MS) feed.runs.delete(id);
    }
    feed.prompts = new Set((Array.isArray(snap.prompts) ? snap.prompts : []).map(p => p && String(p.runId)).filter(Boolean));
    feed.queues = new Map();
    for (const q of (Array.isArray(snap.queues) ? snap.queues : [])) {
      if (q && q.agentId && (q.depth | 0) > 0) feed.queues.set(String(q.agentId), q.depth | 0);
    }
    feed.snapAt = now;
    feed.snapOk = true;
    return true;
  }

  function snapshotFailed(feed) { feed.snapOk = false; }

  /** mcp__github__create_issue → GITHUB::CREATE.ISSUE, web_search → WEB.SEARCH (the CAM-HUD spelling). */
  function toolLabel(name) {
    let n = String(name || '').trim();
    if (!n) return '';
    const m = /^mcp__(.+?)__(.+)$/.exec(n);
    if (m) n = m[1] + '::' + m[2];
    return n.replace(/[_-]+/g, '.').toUpperCase();
  }

  function fmtElapsed(ms) {
    if (!isFinite(ms) || ms < 0) return '';
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
    const h = Math.floor(m / 60);
    return h + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  }

  function fmtAgo(ms) {
    if (!isFinite(ms) || ms < 0) return '';
    const s = Math.floor(ms / 1000);
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    return Math.round(m / 60) + 'h ago';
  }

  // run.end reasons in the HUD's words. 'clarifying' is the agent asking the Commander a question:
  // the one finish a glancing Commander most needs to catch.
  const END_WORDS = {
    done: { text: 'DONE', tone: 'ok' },
    clarifying: { text: 'ASKED YOU', tone: 'ask' },
    cancelled: { text: 'STOPPED', tone: 'dim' },
    error: { text: 'FAULT', tone: 'bad' },
    budget: { text: 'SPEND CAP', tone: 'bad' },
    max_iters: { text: 'TURN LIMIT', tone: 'bad' },
    refusal: { text: 'REFUSED', tone: 'bad' },
    empty: { text: 'EMPTY REPLY', tone: 'bad' }
  };

  /** The deck's rows + summary from the feed. `who(agentId)` → { name, color } or null. */
  function view(feed, who, now) {
    const name = id => { const w = who(id); return (w && w.name) || (id ? String(id).slice(0, 10).toUpperCase() : 'AGENT'); };
    const color = id => { const w = who(id); return (w && w.color) || ''; };
    const live = Array.from(feed.runs.values())
      .sort((a, b) => (a.startedAt || now) - (b.startedAt || now))
      .map(r => {
        const waiting = feed.prompts.has(r.runId);
        return {
          kind: 'live', runId: r.runId, agentId: r.agentId, name: name(r.agentId), color: color(r.agentId),
          waiting,
          step: waiting ? 'NEEDS YOUR OK' : r.tool ? toolLabel(r.tool) : r.writing ? 'WRITING REPLY' : 'RUNNING',
          trigger: r.trigger === 'schedule' ? 'ROUTINE' : r.trigger === 'nightshift' ? 'NIGHT SHIFT' : r.trigger === 'loop' ? 'LOOP' : '',
          elapsed: r.startedAt ? fmtElapsed(now - r.startedAt) : '',
          queued: feed.queues.get(r.agentId) || 0
        };
      });
    const recent = feed.recent
      .filter(x => now - x.at <= RECENT_TTL_MS)
      .map(x => {
        const w = END_WORDS[x.reason] || { text: String(x.reason || '').toUpperCase(), tone: 'dim' };
        return { kind: 'recent', runId: x.runId, agentId: x.agentId, name: name(x.agentId), color: color(x.agentId), text: w.text, tone: w.tone, ago: fmtAgo(now - x.at) };
      });
    const waiting = live.filter(r => r.waiting).length;
    const working = live.length;
    let summary;
    if (feed.snapOk === false) summary = { text: 'NO LINK', tone: 'bad' };
    else if (feed.snapOk == null && !working) summary = { text: '…', tone: 'dim' };
    else if (waiting) summary = { text: waiting + ' NEED' + (waiting === 1 ? 'S' : '') + ' YOU', tone: 'ask' };
    else if (working) summary = { text: working + ' WORKING', tone: 'live' };
    else summary = { text: 'STATION IDLE', tone: 'dim' };
    return {
      summary,
      live: live.slice(0, LIVE_MAX),
      more: Math.max(0, live.length - LIVE_MAX),
      recent
    };
  }

  /* ---------------- preferences (localStorage is a convenience; failures read as defaults) ---------------- */

  function readPrefs(store) {
    try {
      const raw = store && store.getItem(PREF_KEY);
      const p = raw ? JSON.parse(raw) : null;
      const rect = p && p.rect && ['x', 'y', 'w', 'h'].every(k => isFinite(Number(p.rect[k]))) ? {
        x: Math.round(Number(p.rect.x)), y: Math.round(Number(p.rect.y)), w: Math.round(Number(p.rect.w)), h: Math.round(Number(p.rect.h))
      } : null;
      return { pinned: !(p && p.pinned === false), rect };
    } catch (_) { return { pinned: true, rect: null }; }
  }

  function writePrefs(store, prefs) {
    try { if (store) store.setItem(PREF_KEY, JSON.stringify({ pinned: !!prefs.pinned, rect: prefs.rect || null })); } catch (_) {}
  }

  /* ---------------- desktop bridge (Tauri) ---------------- */

  function tauriCore(win) {
    const t = win && win.__TAURI__;
    return t && t.core && typeof t.core.invoke === 'function' ? t.core : null;
  }

  /* ---------------- DOM + lifecycle (browser only) ---------------- */

  const doc = root && root.document;
  const S = {
    active: false, folded: false, pinned: true, desktop: false, busy: false,
    worldStopped: false, pollT: 0, tickT: 0, feed: createFeed(), deck: null, els: null, bound: false, fetching: false
  };

  const now = () => Date.now();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function who(id) {
    try {
      if (typeof App === 'undefined' || !App.agents) return null;
      const a = App.agents().find(x => x && x.id === id);
      return a ? { name: String(a.name || a.id).toUpperCase(), color: a.color || '' } : null;
    } catch (_) { return null; }
  }

  function gameScreen() { return doc && doc.getElementById('screen-game'); }
  function inGame() { const g = gameScreen(); return !!(g && g.classList.contains('active')); }

  function buildDeck() {
    if (S.deck) return S.deck;
    const g = gameScreen();
    if (!g) return null;
    const deck = doc.createElement('section');
    deck.id = 'hud-deck';
    deck.setAttribute('aria-label', 'StarNet HUD');
    deck.innerHTML =
      '<div class="hud-bar" data-tauri-drag-region>' +
        '<span class="hud-mark" data-tauri-drag-region>◆ HUD</span>' +
        '<span class="hud-sum" id="hud-sum" data-tauri-drag-region role="status" aria-live="polite"></span>' +
        '<span class="hud-ctl">' +
          '<button type="button" class="hud-btn" id="hud-pin" aria-pressed="true" title="Keep the HUD above other windows" hidden>PIN</button>' +
          '<button type="button" class="hud-btn" id="hud-fold" aria-pressed="false" aria-controls="chat-panel" title="Fold the conversation away and keep only the station feed">FOLD</button>' +
          '<button type="button" class="hud-btn" id="hud-min" title="Minimize the HUD" hidden>MIN</button>' +
          '<button type="button" class="hud-btn hud-exit" id="hud-exit" title="Back to the full station">STATION</button>' +
        '</span>' +
      '</div>' +
      '<ol class="hud-feed" id="hud-feed" aria-label="What your agents are doing right now"></ol>';
    g.insertBefore(deck, g.firstChild);
    S.deck = deck;
    S.els = {
      sum: deck.querySelector('#hud-sum'), feed: deck.querySelector('#hud-feed'),
      pin: deck.querySelector('#hud-pin'), fold: deck.querySelector('#hud-fold'),
      min: deck.querySelector('#hud-min'), exit: deck.querySelector('#hud-exit')
    };
    S.els.exit.addEventListener('click', () => exit());
    S.els.fold.addEventListener('click', () => setFolded(!S.folded));
    S.els.pin.addEventListener('click', () => setPinned(!S.pinned));
    S.els.min.addEventListener('click', () => {
      try { const w = root.__TAURI__.window.getCurrentWindow(); Promise.resolve(w.minimize()).catch(() => {}); } catch (_) {}
    });
    // A row names an agent: clicking it puts that agent ON THE LINE (the same switch the COMMS picker makes).
    S.els.feed.addEventListener('click', e => {
      const row = e.target && e.target.closest && e.target.closest('[data-agent]');
      if (!row) return;
      const id = row.getAttribute('data-agent');
      if (S.folded) setFolded(false);
      try { if (typeof App !== 'undefined' && App.selectAgent) App.selectAgent(id); } catch (_) {}
      try { const input = doc.getElementById('chat-input'); if (input) input.focus(); } catch (_) {}
    });
    return deck;
  }

  function render() {
    if (!S.els) return;
    const v = view(S.feed, who, now());
    S.els.sum.textContent = v.summary.text;
    S.els.sum.className = 'hud-sum hud-tone-' + v.summary.tone;
    const rows = [];
    const cells = (r, step, time) =>
      '<span class="hud-dot"' + (r.color ? ' style="--hud-suit:' + esc(r.color) + '"' : '') + ' aria-hidden="true"></span>' +
      '<b class="hud-name">' + esc(r.name) + '</b>' +
      '<span class="hud-step">' + step + '</span>' +
      '<span class="hud-time">' + esc(time) + '</span>';
    for (const r of v.live) {
      const step = esc(r.step) + (r.trigger ? ' <i>· ' + esc(r.trigger) + '</i>' : '') + (r.queued ? ' <i>· +' + r.queued + ' queued</i>' : '');
      rows.push({ key: 'live:' + r.runId, cls: 'hud-row hud-live' + (r.waiting ? ' hud-waiting' : ''), agent: r.agentId, tip: 'Talk to ' + r.name, html: cells(r, step, r.elapsed) });
    }
    if (v.more) rows.push({ key: 'more', cls: 'hud-row hud-more', html: '+' + v.more + ' MORE RUNNING' });
    for (const r of v.recent) {
      rows.push({ key: 'end:' + r.runId, cls: 'hud-row hud-recent hud-tone-' + r.tone, agent: r.agentId, tip: 'Talk to ' + r.name, html: cells(r, esc(r.text), r.ago) });
    }
    if (!rows.length && S.feed.snapOk) rows.push({ key: 'empty', cls: 'hud-row hud-empty', html: 'No agent is running. Ask one below.' });
    // Keyed patch, not a wholesale innerHTML swap: the clocks tick every second, and replacing the row
    // under the pointer would drop its hover card (tooltip.js adopts [title] on hover) every tick.
    const list = S.els.feed;
    const have = new Map();
    for (const li of Array.from(list.children)) have.set(li.getAttribute('data-key'), li);
    let prev = null;
    for (const row of rows) {
      let li = have.get(row.key);
      if (li) have.delete(row.key);
      else {
        li = doc.createElement('li');
        li.setAttribute('data-key', row.key);
        if (row.agent) { li.setAttribute('data-agent', row.agent); li.setAttribute('title', row.tip); }
      }
      if (li.className !== row.cls) li.className = row.cls;
      if (li.innerHTML !== row.html) li.innerHTML = row.html;
      const want = prev ? prev.nextSibling : list.firstChild;
      if (want !== li) list.insertBefore(li, want);
      prev = li;
    }
    for (const li of have.values()) li.remove();
    refitFolded();
  }

  function poll() {
    if (!S.active || S.fetching || typeof fetch !== 'function') return;
    S.fetching = true;
    fetch('/api/state/snapshot', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(snap => { if (!applySnapshot(S.feed, snap, now())) snapshotFailed(S.feed); })
      .catch(() => snapshotFailed(S.feed))
      .then(() => { S.fetching = false; render(); });
  }

  function bindBus() {
    if (S.bound || typeof U === 'undefined' || !U.bus) return;
    S.bound = true;
    // Always listening (cheap), so the recent rows are real even when the HUD opens mid-run.
    U.bus.on('agent.run.start', p => { onRunStart(S.feed, p, now()); if (S.active) render(); });
    U.bus.on('agent.tool_call', p => { onToolCall(S.feed, p, now()); if (S.active) render(); });
    U.bus.on('agent.tool_result', p => { if (onToolResult(S.feed, p, now()) && S.active) render(); });
    U.bus.on('agent.token', p => { if (onToken(S.feed, p, now()) && S.active) render(); });
    U.bus.on('agent.run.end', p => { onRunEnd(S.feed, p, now()); if (S.active) render(); });
    U.bus.on('agent.run.error', p => { onRunError(S.feed, p, now()); if (S.active) render(); });
  }

  function invoke(cmd, args) {
    const core = tauriCore(root);
    if (!core) return Promise.resolve(null);
    return Promise.resolve(core.invoke(cmd, args || {})).catch(err => {
      try { root.console && root.console.warn && root.console.warn('[hud] ' + cmd + ' failed', err); } catch (_) {}
      return null;
    });
  }

  function syncButtons() {
    if (!S.els) return;
    S.els.pin.hidden = !S.desktop;
    S.els.min.hidden = !S.desktop;
    S.els.pin.textContent = S.pinned ? 'PINNED' : 'PIN';
    S.els.pin.setAttribute('aria-pressed', String(S.pinned));
    S.els.pin.classList.toggle('on', S.pinned);
    S.els.fold.textContent = S.folded ? 'UNFOLD' : 'FOLD';
    S.els.fold.setAttribute('aria-pressed', String(S.folded));
  }

  function announceLayout() { try { root.dispatchEvent(new root.Event('resize')); } catch (_) {} }

  // The window height a folded HUD needs: the deck's bottom edge plus the frame's bottom padding,
  // in viewport px (= the window's logical px).
  function deckHeight() {
    try { return Math.ceil(S.deck.getBoundingClientRect().bottom + 6); } catch (_) { return 0; }
  }

  // Folded, the window hugs the deck, so a new row (another agent starts) must grow it, and a row
  // leaving must shrink it back. Only asks the shell when the needed height actually moved.
  function refitFolded() {
    if (!S.active || !S.folded || !S.desktop) return;
    const h = deckHeight();
    if (!h || Math.abs(h - (S.foldedH || 0)) < 3) return;
    S.foldedH = h;
    invoke('starnet_hud_fold', { folded: true, height: h });
  }

  function enter() {
    if (S.active || S.busy || !doc || !inGame()) return Promise.resolve(false);
    if (!buildDeck()) return Promise.resolve(false);
    S.busy = true;
    const prefs = readPrefs(root.localStorage);
    S.pinned = prefs.pinned;
    S.folded = false;
    S.desktop = !!tauriCore(root);
    S.active = true;
    bindBus();
    const expandBtn = doc.getElementById('comms-expand');
    if (expandBtn && gameScreen().classList.contains('comms-expanded')) expandBtn.click();   // HUD owns the frame now
    doc.body.classList.add('hud-mode');
    doc.body.classList.remove('hud-folded');
    // The station is not on screen: stop the world renderer so a game in the foreground gets the GPU.
    // (World.start() on exit resumes the same floor; nothing about the station's state lives in frames.)
    try { if (typeof World !== 'undefined' && World.stop) { World.stop(); S.worldStopped = true; } } catch (_) {}
    syncButtons();
    render();
    poll();
    S.pollT = root.setInterval(poll, POLL_MS);
    S.tickT = root.setInterval(render, 1000);   // elapsed clocks + "ago" words only; no data invented between polls
    announceLayout();
    return invoke('starnet_hud_set', { active: true, pinned: S.pinned, rect: prefs.rect })
      .then(v => { if (v) { S.pinned = !!v.pinned; syncButtons(); } return true; })
      .finally(() => {
        S.busy = false;
        try { const input = doc.getElementById('chat-input'); if (input) input.focus(); } catch (_) {}
      });
  }

  function exit() {
    if (!S.active || S.busy) return Promise.resolve(false);
    S.busy = true;
    return invoke('starnet_hud_set', { active: false })
      .then(v => {
        if (v && v.rect) { const prefs = readPrefs(root.localStorage); prefs.rect = v.rect; writePrefs(root.localStorage, prefs); }
      })
      .finally(() => {
        S.active = false;
        S.folded = false;
        root.clearInterval(S.pollT); root.clearInterval(S.tickT); S.pollT = S.tickT = 0;
        doc.body.classList.remove('hud-mode', 'hud-folded');
        if (S.worldStopped) {
          S.worldStopped = false;
          try { if (inGame() && typeof World !== 'undefined' && World.start) World.start(); } catch (_) {}
        }
        announceLayout();
        S.busy = false;
      });
  }

  function setFolded(folded) {
    if (!S.active) return Promise.resolve(false);
    S.folded = !!folded;
    doc.body.classList.toggle('hud-folded', S.folded);
    syncButtons();
    announceLayout();
    // Folded, the window hugs the deck; unfolded, it returns to the height it had.
    S.foldedH = S.folded ? deckHeight() : 0;
    return invoke('starnet_hud_fold', { folded: S.folded, height: S.folded ? S.foldedH : null }).then(() => true);
  }

  function setPinned(pinned) {
    if (!S.active) return Promise.resolve(false);
    return invoke('starnet_hud_pin', { pinned: !!pinned }).then(v => {
      if (v) S.pinned = !!v.pinned;   // the shell's read-back, never the request
      const prefs = readPrefs(root.localStorage); prefs.pinned = S.pinned; writePrefs(root.localStorage, prefs);
      syncButtons();
      return S.pinned;
    });
  }

  function toggle() { return S.active ? exit() : enter(); }

  function wire() {
    if (!doc) return;
    bindBus();
    const btn = doc.getElementById('comms-hud');
    if (btn) {
      btn.hidden = false;
      btn.addEventListener('click', () => { enter(); });
    }
    // Ctrl+Shift+H toggles the HUD from anywhere in the app (Alt+H stays the help overlay's).
    doc.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.code === 'KeyH' || e.key === 'H' || e.key === 'h')) {
        e.preventDefault();
        toggle();
      }
    });
    // The tray's HUD Mode / Open StarNet items (hud_mode.rs) ask the page to switch.
    try {
      const ev = root.__TAURI__ && root.__TAURI__.event;
      if (ev && typeof ev.listen === 'function') {
        ev.listen(TAURI_EVENT, e => { const on = !!(e && e.payload && e.payload.active); if (on) enter(); else exit(); });
      }
    } catch (_) {}
    // A reload (or a WebView2 crash rebuild) inside HUD mode: the shell still holds the HUD window,
    // so the page puts its HUD layout back instead of drawing the full station into a tiny frame.
    invoke('starnet_hud_status').then(v => {
      if (!v || !v.active) return;
      const tryEnter = (n) => { if (inGame()) enter(); else if (n > 0) root.setTimeout(() => tryEnter(n - 1), 500); };
      tryEnter(40);
    });
  }

  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', wire, { once: true });
    else wire();
  }

  return {
    enter, exit, toggle, setFolded, setPinned,
    active: () => S.active, folded: () => S.folded, pinned: () => S.pinned,
    // pure model — exported for tests
    createFeed, onRunStart, onToolCall, onToolResult, onToken, onRunEnd, onRunError, applySnapshot, snapshotFailed, view, toolLabel, fmtElapsed, fmtAgo, readPrefs, writePrefs,
    _feed: () => S.feed, _render: render, _poll: poll
  };
});
