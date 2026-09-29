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
  const RECENT_MAX = 12;                   // finishes kept (one per run): enough for every agent's latest
  const RECENT_TTL_MS = 15 * 60 * 1000;    // a finish older than this is history, not "recent"
  const LIVE_MAX = 5;                      // live rows shown; the rest fold into "+N MORE"
  const TAURI_EVENT = 'starnet-hud';       // hud_mode.rs emits { active } from the tray menu

  /* ---------------- pure feed model (unit-tested in test/hudmode.test.js) ---------------- */

  function createFeed() {
    return { runs: new Map(), recent: [], prompts: new Set(), queues: new Map(), unread: new Map(), snapAt: 0, snapOk: null };
  }

  /* UNREAD: an agent whose run finished while the Commander was on someone else's line. It is the
     run.end this page received, nothing inferred; putting that agent on the line clears it. A run the
     Commander stopped themselves is not news. Tone ranks what a glance must catch: a question over a
     fault over a plain finish, so a later DONE never hides an earlier ASKED YOU. */
  const UNREAD_RANK = { ok: 1, bad: 2, ask: 3 };
  function markUnread(feed, agentId, tone) {
    if (!agentId || !UNREAD_RANK[tone]) return;
    const had = feed.unread.get(agentId);
    if (!had || UNREAD_RANK[tone] >= UNREAD_RANK[had]) feed.unread.set(agentId, tone);
  }
  function clearUnread(feed, agentId) { return feed.unread.delete(String(agentId || '')); }

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
    const reason = String(p.reason || 'done');
    pushRecent(feed, { runId: String(p.runId), agentId, reason, at: now });
    markUnread(feed, agentId, (END_WORDS[reason] || { tone: 'dim' }).tone);
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
    markUnread(feed, agentId, 'bad');
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

  /** The HUD's crew: one row per agent, in roster order, carrying the one line a glance needs.
      `agents` = [{ id, name, color, skin }], `onLine` = the agent COMMS is talking to.
      lamp: 'ask' (a permission prompt is pending on one of its runs) · 'live' (a run the snapshot or a
      watched run.start proves) · 'idle'. status/tone: what that run is doing, else its latest finish this
      page received (within the recent window), else IDLE. unread: the tone of a finish not yet looked at.
      A running agent missing from the roster still gets a row, under its id, never a made-up name. */
  function crew(feed, agents, onLine, now, seen) {
    const read = seen === undefined ? onLine : seen;   // whose finish is on screen, so not news
    const t = isFinite(now) ? now : Date.now();
    const runsOf = new Map();
    for (const r of Array.from(feed.runs.values()).sort((x, y) => (x.startedAt || t) - (y.startedAt || t))) {
      if (!runsOf.has(r.agentId)) runsOf.set(r.agentId, []);
      runsOf.get(r.agentId).push(r);
    }
    const list = (Array.isArray(agents) ? agents : []).filter(a => a && a.id).map(a => ({ id: String(a.id), name: String(a.name || a.id).toUpperCase(), color: a.color || '', skin: a.skin || '' }));
    for (const id of runsOf.keys()) if (id && !list.some(a => a.id === id)) list.push({ id, name: String(id).slice(0, 10).toUpperCase(), color: '', skin: '' });
    return list.map(a => {
      const runs = runsOf.get(a.id) || [];
      const asking = runs.find(r => feed.prompts.has(r.runId));
      const unread = a.id === read ? null : (feed.unread.get(a.id) || null);
      const row = { id: a.id, name: a.name, color: a.color, skin: a.skin, online: a.id === onLine, unread, lamp: 'idle', status: 'IDLE', tone: 'dim', time: '' };
      if (runs.length) {
        const r = asking || runs[0];
        row.lamp = asking ? 'ask' : 'live';
        row.tone = asking ? 'ask' : 'live';
        const bits = [asking ? 'NEEDS YOUR OK' : r.tool ? toolLabel(r.tool) : r.writing ? 'WRITING REPLY' : 'WORKING'];
        const trig = r.trigger === 'schedule' ? 'ROUTINE' : r.trigger === 'nightshift' ? 'NIGHT SHIFT' : r.trigger === 'loop' ? 'LOOP' : '';
        if (trig) bits.push(trig);
        if (runs.length > 1) bits.push('+' + (runs.length - 1) + ' MORE');
        const q = feed.queues.get(a.id) || 0;
        if (q) bits.push('+' + q + ' QUEUED');
        row.status = bits.join(' · ');
        row.time = r.startedAt ? fmtElapsed(t - r.startedAt) : '';
        return row;
      }
      const end = feed.recent.find(x => x.agentId === a.id && t - x.at <= RECENT_TTL_MS);
      if (end) {
        const w = END_WORDS[end.reason] || { text: String(end.reason || '').toUpperCase(), tone: 'dim' };
        row.status = w.text; row.tone = w.tone === 'ok' && !unread ? 'dim' : w.tone; row.time = fmtAgo(t - end.at);
      }
      return row;
    });
  }

  /** The compact strip's one line: the agent a glance most needs, from the crew rows.
      Priority: needs your OK > working > an unread finish > the agent on the line > the first agent.
      An idle pick shows what it last SAID (`replyOf(id)` = the newest reply in its own conversation,
      '' when it has none), else its status word. `busy` counts agents with a live or asking lamp. */
  function glance(rows, replyOf) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return null;
    const pick = list.find(r => r.lamp === 'ask') || list.find(r => r.lamp === 'live') ||
      list.find(r => r.unread) || list.find(r => r.online) || list[0];
    const out = { id: pick.id, name: pick.name, color: pick.color, lamp: pick.lamp, text: pick.status, tone: pick.tone, time: pick.time,
      busy: list.filter(r => r.lamp !== 'idle').length };
    if (pick.lamp === 'idle') {
      let said = '';
      try { said = replyOf ? String(replyOf(pick.id) || '') : ''; } catch (_) { said = ''; }
      if (said) { out.text = said; out.tone = pick.unread === 'ok' ? 'live' : pick.tone; }
    }
    return out;
  }

  /** The newest reply in a COMMS history (the rows COMMS itself renders), flattened to one line for
      the folded glance. Error / stopped rows are the transcript's markers, not what the agent said. */
  function lastReply(history, max) {
    const cap = max || 160;
    const rows = Array.isArray(history) ? history : [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (!r || r.role !== 'assistant' || r.error || r.stopped) continue;
      const text = String(typeof r.content === 'string' ? r.content : '')
        .replace(/```[\s\S]*?```/g, ' [code] ')
        .replace(/[#>*_`~|]+/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\s+/g, ' ').trim();
      if (!text) continue;
      return text.length > cap ? text.slice(0, cap - 1).replace(/\s+\S*$/, '') + '…' : text;
    }
    return '';
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

  function roster() {
    try { return (typeof App !== 'undefined' && App.agents) ? (App.agents() || []) : []; } catch (_) { return []; }
  }

  function who(id) {
    const a = roster().find(x => x && x.id === id);
    return a ? { name: String(a.name || a.id).toUpperCase(), color: a.color || '' } : null;
  }

  // The agent COMMS is talking to right now: the conversation's own binding, else the focused hero.
  function onLineId() {
    try { const ref = typeof Chat !== 'undefined' && Chat.contextRef ? Chat.contextRef() : null; if (ref && ref.agentId) return String(ref.agentId); } catch (_) {}
    try { if (typeof App !== 'undefined' && App.heroId) return String(App.heroId()); } catch (_) {}
    return '';
  }

  function switchTo(id) {
    if (!id) return;
    clearUnread(S.feed, id);
    if (S.folded) setFolded(false);
    // A chip means "back to MY conversation with that agent": open the agent's own most recent stream.
    // App.selectAgent alone would, from a blank thread (a just-summoned specialist's), rebind that thread
    // to the picked agent instead, stranding the conversation the Commander came back for.
    try {
      if (id !== onLineId() && typeof App !== 'undefined') {
        const mine = typeof Workstreams !== 'undefined' && Workstreams.list ? Workstreams.list().filter(w => (w.agentId || 'agent') === id) : [];
        if (mine.length && App.openWorkstream) App.openWorkstream(mine[0].id);
        else if (App.selectAgent) App.selectAgent(id);
      }
    } catch (_) {}
    try { const input = doc.getElementById('chat-input'); if (input) input.focus(); } catch (_) {}
    render();
  }

  function gameScreen() { return doc && doc.getElementById('screen-game'); }
  function inGame() { const g = gameScreen(); return !!(g && g.classList.contains('active')); }

  const ICON = {
    grow: 'M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9',
    shrink: 'M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5l4-4M6.5 9.5l-4 4',
    pin: 'M6 2.5h4M7 2.5v4l-2.5 2.5h7L9 6.5v-4M8 9v4.5',
    station: 'M2 3.5h12v9H2zM2 6.5h12'
  };
  const icon = k => '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4"><path d="' + ICON[k] + '"/></svg>';
  const TILE_MAX = 5;   // more agents than this: the rest fold into a +N tile (which opens the HUD)

  function buildDeck() {
    if (S.deck) return S.deck;
    const g = gameScreen();
    if (!g) return null;
    const deck = doc.createElement('section');
    deck.id = 'hud-deck';
    deck.setAttribute('aria-label', 'StarNet HUD');
    // The HUD is ONE glass strip: the crew as portraits with their lamps, one line on the agent a glance most
    // needs, and three icons. It opens SMALL (the strip alone). Clicking an agent (or grow) opens that
    // agent's conversation under the strip; shrink puts it away again. The strip is the window's drag handle.
    deck.innerHTML =
      '<div class="hud-mini" data-tauri-drag-region>' +
        '<div class="hud-tiles" id="hud-tiles" role="group" aria-label="Your crew: open a conversation"></div>' +
        '<button type="button" class="hud-line" id="hud-line" hidden></button>' +
        '<span class="hud-mini-ctl">' +
          '<button type="button" class="hud-icon" id="hud-fold" aria-controls="chat-panel"></button>' +
          '<button type="button" class="hud-icon" id="hud-pin" aria-pressed="true" hidden>' + icon('pin') + '</button>' +
          '<button type="button" class="hud-icon" id="hud-exit" aria-label="Back to the full station" title="Back to the full station">' + icon('station') + '</button>' +
        '</span>' +
      '</div>';
    g.insertBefore(deck, g.firstChild);
    S.deck = deck;
    S.els = {
      tiles: deck.querySelector('#hud-tiles'), line: deck.querySelector('#hud-line'),
      fold: deck.querySelector('#hud-fold'), pin: deck.querySelector('#hud-pin'), exit: deck.querySelector('#hud-exit')
    };
    S.els.exit.addEventListener('click', () => exit());
    S.els.fold.addEventListener('click', () => setFolded(!S.folded));
    S.els.pin.addEventListener('click', () => setPinned(!S.pinned));
    // Any agent opens that agent's conversation; the +N tile just opens the HUD.
    const pickAgent = e => {
      const el = e.target && e.target.closest && e.target.closest('[data-agent],[data-more]');
      if (!el) return;
      if (el.hasAttribute('data-more')) { if (S.folded) setFolded(false); return; }
      switchTo(el.getAttribute('data-agent'));
    };
    S.els.tiles.addEventListener('click', pickAgent);
    S.els.line.addEventListener('click', pickAgent);
    return deck;
  }

  const UNREAD_WORDS = { ok: 'new reply', ask: 'asked you something', bad: 'hit a fault' };
  const tileWords = c => c.name + ' · ' + c.status.toLowerCase() + (c.time ? ' ' + c.time : '') + (c.unread ? ' · ' + UNREAD_WORDS[c.unread] : '') + (c.online ? ' · on the line' : '');

  // A tile: the crew rail's portrait well + the station .dot lamp + the unread mark, nothing else.
  function tileHTML(c) {
    if (c.more) return '<button type="button" class="hud-tile hud-more" data-more aria-label="' + c.more + ' more agents: open the HUD" title="' + c.more + ' more agents">+' + c.more + '</button>';
    return '<button type="button" class="hud-tile hud-lamp-' + c.lamp + (c.online ? ' on' : '') + (c.unread ? ' hud-unread hud-unread-' + c.unread : '') + '"' +
        ' data-agent="' + esc(c.id) + '" aria-pressed="' + c.online + '" aria-label="' + esc(tileWords(c)) + '" title="' + esc(c.name + ' · ' + c.status + (c.time ? ' ' + c.time : '')) + '">' +
      '<span class="hud-portrait" aria-hidden="true"><img alt="" draggable="false" hidden></span>' +
      '<span class="dot' + (c.lamp === 'ask' ? ' alert' : '') + '" aria-hidden="true"></span>' +
      (c.unread ? '<span class="hud-pip" aria-hidden="true"></span>' : '') +
    '</button>';
  }

  // Keyed patch: a tile is rewritten only when its own content moved, so the 1s clock tick never replaces
  // the tile under the pointer (its hover card would drop) or the one holding keyboard focus, and its
  // portrait is painted once, not re-cropped every second.
  function patchTiles(list, rows, agents) {
    const key = c => c.more ? '+more' : c.id;
    const have = new Map();
    for (const el of Array.from(list.children)) have.set(el.__hudKey, el);
    let prev = null;
    for (const c of rows) {
      const h = tileHTML(c);
      let el = have.get(key(c));
      if (el) have.delete(key(c));
      if (!el || el.__hudHtml !== h) {
        const tmp = doc.createElement('div'); tmp.innerHTML = h;
        const fresh = tmp.firstChild;
        const hadFocus = el && doc.activeElement === el;
        if (el) el.replaceWith(fresh);
        el = fresh; el.__hudHtml = h; el.__hudKey = key(c);
        const a = !c.more && agents.find(x => x && x.id === c.id);
        try { if (a && typeof AgentPortraits !== 'undefined') AgentPortraits.paint(el.querySelector('.hud-portrait img'), a); } catch (_) {}
        if (hadFocus) el.focus();
      }
      const want = prev ? prev.nextSibling : list.firstChild;
      if (want !== el) list.insertBefore(el, want);
      prev = el;
    }
    for (const el of have.values()) el.remove();
  }

  // What an agent last said: the newest reply in its own conversation (the one on screen for the agent on
  // the line, else its most recent stream), flattened to one line. '' when it has said nothing yet.
  function replyOf(id) {
    try {
      if (id === onLineId() && typeof Chat !== 'undefined' && Chat.getHistory) return lastReply(Chat.getHistory(), 140);
      if (typeof Workstreams === 'undefined' || !Workstreams.list) return '';
      for (const w of Workstreams.list()) {
        if ((w.agentId || 'agent') !== id) continue;
        const said = lastReply(w.history, 140);
        if (said) return said;
      }
    } catch (_) {}
    return '';
  }

  function render() {
    if (!S.els) return;
    const v = view(S.feed, who, now());
    // Anything waiting on the Commander turns the strip's edge gold: the one state a glance from across
    // the room must catch. An edge change, never a glow (matte glass).
    S.deck.classList.toggle('hud-asking', v.summary.tone === 'ask');
    S.deck.classList.toggle('hud-nolink', v.summary.tone === 'bad' && v.summary.text === 'NO LINK');
    const line = onLineId();
    // The conversation on the line is being read only while it IS on screen (the HUD is open).
    if (!S.folded) clearUnread(S.feed, line);
    const agents = roster();
    const rows = crew(S.feed, agents, line, now(), S.folded ? null : line);
    const shown = rows.length > TILE_MAX ? rows.slice(0, TILE_MAX - 1).concat([{ more: rows.length - (TILE_MAX - 1) }]) : rows;
    patchTiles(S.els.tiles, shown, agents);
    const g = glance(rows, replyOf);
    const el = S.els.line;
    if (!g) { el.hidden = true; el.removeAttribute('data-agent'); }
    else {
      const top = v.summary.text === 'NO LINK' ? '<i class="hud-tone-bad">NO LINK</i>' : g.busy > 1 ? '<i>' + g.busy + ' WORKING</i>' : '';
      const html =
        '<span class="hud-line-top"><b' + (g.color ? ' style="color:' + esc(g.color) + '"' : '') + '>' + esc(g.name) + '</b>' + top +
          '<span class="hud-time">' + esc(g.time) + '</span></span>' +
        '<span class="hud-line-text hud-tone-' + g.tone + '">' + esc(g.text) + '</span>';
      if (el.__hudHtml !== html) { el.innerHTML = html; el.__hudHtml = html; }
      el.hidden = false;
      el.setAttribute('data-agent', g.id);
      el.setAttribute('aria-label', 'Open ' + g.name + ': ' + g.text);
    }
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
    const f = S.els.fold, grow = S.folded;
    f.innerHTML = icon(grow ? 'grow' : 'shrink');
    f.setAttribute('aria-label', grow ? 'Open the conversation' : 'Shrink the HUD to the strip');
    f.setAttribute('title', grow ? 'Open the conversation' : 'Shrink the HUD to the strip');
    f.setAttribute('aria-expanded', String(!grow));
    S.els.pin.hidden = !S.desktop;
    S.els.pin.setAttribute('aria-pressed', String(S.pinned));
    S.els.pin.setAttribute('aria-label', S.pinned ? 'Pinned above other windows: unpin' : 'Keep the HUD above other windows');
    S.els.pin.setAttribute('title', S.pinned ? 'Pinned above other windows' : 'Keep the HUD above other windows');
    S.els.pin.classList.toggle('on', S.pinned);
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
    // The HUD opens SMALL: the crew strip only. Clicking an agent (or the grow icon) opens the conversation.
    S.folded = true;
    S.desktop = !!tauriCore(root);
    S.active = true;
    bindBus();
    doc.body.classList.add('hud-mode', 'hud-folded');
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
      // a remembered rect the shell cannot take must never strand the HUD layout in a full-size window
      .then(v => v || (prefs.rect && S.desktop ? invoke('starnet_hud_set', { active: true, pinned: S.pinned }) : v))
      .then(v => { if (v) { S.pinned = !!v.pinned; syncButtons(); } return true; })
      // the shell opened the HUD at its full rect: now hug the strip
      .then(ok => { S.foldedH = deckHeight(); return invoke('starnet_hud_fold', { folded: true, height: S.foldedH }).then(() => ok); })
      .finally(() => { S.busy = false; });
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
    render();   // lay the strip (or the open deck) out before the window hugs it
    announceLayout();
    // Small, the window hugs the strip; open, it returns to the height it had.
    S.foldedH = S.folded ? deckHeight() : 0;
    if (!S.folded) { try { const input = doc.getElementById('chat-input'); if (input) input.focus(); } catch (_) {} }
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
      // The HUD's point is a panel that stays above a game: only the desktop shell can do that, so a
      // browser tab gets no header button (Ctrl+Shift+H still folds the page for anyone who wants it).
      btn.hidden = !tauriCore(root);
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
    createFeed, markUnread, clearUnread, crew, glance, lastReply, onRunStart, onToolCall, onToolResult, onToken, onRunEnd, onRunError, applySnapshot, snapshotFailed, view, toolLabel, fmtElapsed, fmtAgo, readPrefs, writePrefs,
    _feed: () => S.feed, _render: render, _poll: poll
  };
});
