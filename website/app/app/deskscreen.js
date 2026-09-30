/* STARNET — deskscreen.js : the DESK SCREEN (2026-09-29, Andrew: "click the computer, see the work from your agent").

   Click an agent's workstation on the live floor (world.js deskAt → onDesk) and the DESK SCREEN window opens on
   THAT agent's work:
     • WORKING — the task, every tool step as it happens (what it touched, ✓/✗, how long), the words it is writing,
       what it has made, the run's reconciled cost and clock — plus hands: tell it something mid-run (POST
       /api/run/steer), STOP (POST /api/cancel, two-step), open its chat, open its record.
     • NEEDS YOUR OK — a permission prompt is waiting on this agent (the approval card lives in COMMS).
     • IDLE — its last job from the server's run ledger (GET /api/runs): title, outcome, steps with their result
       summaries, the reply, the files it made (one click to the files), and the few jobs before it.

   TRUTH (the product's core law): every row is either a real bus event this page observed (agent.run.start /
   tool_call / tool_result / token / cost / run.end / permission.* / deliverable) or a server row. Liveness is
   cross-checked against GET /api/state/snapshot while the window is open. Where this page cannot know something it
   says so instead of guessing: a run joined mid-way says its earlier steps are not on this screen; a routine or
   channel run's tool arguments are not carried by the station's event bridge, so only the tool name shows.

   The fold (every agent, from boot) is always on and bounded. The view is a registered station WINDOW ('desk'): it
   rises from the bottom dock between CREW and COMMS, resizes and minimizes like every other window, and switches
   agents with the shared roster switcher. Never a popover beside the desk. */
'use strict';

const DeskScreen = (() => {
  const STEP_CAP = 80, TEXT_TAIL = 900, RUNS_PER_AGENT = 4, STALE_MS = 10 * 60 * 1000;
  const runs = new Map();       // runId -> rec
  const byAgent = new Map();    // agentId -> [runId…] newest last (bounded)
  const asks = new Map();       // agentId -> { promptId, tool, at }
  const clock = () => Date.now();

  /* ---------------- the fold (pure over its maps; exported for tests) ---------------- */
  function remember(aid, rid) {
    const l = byAgent.get(aid) || [];
    if (l.indexOf(rid) < 0) l.push(rid);
    while (l.length > RUNS_PER_AGENT) runs.delete(l.shift());
    byAgent.set(aid, l);
  }
  function mk(p, partial, now) {
    const rec = { runId: p.runId, agentId: p.agentId, trigger: p.trigger || '', model: p.model || '', startedAt: now, lastAt: now,
      partial: !!partial, steps: [], dropped: 0, text: '', usd: 0, ended: false, reason: '', endedAt: 0, error: '', made: [], task: '', wsId: '' };
    runs.set(p.runId, rec); remember(p.agentId, p.runId);
    return rec;
  }
  function liveRecOf(aid) {
    const l = byAgent.get(aid) || [];
    for (let i = l.length - 1; i >= 0; i--) { const r = runs.get(l[i]); if (r && !r.ended) return r; }
    return null;
  }
  function fold(name, p, now) {
    if (!p || typeof p !== 'object') return;
    now = now || clock();
    if (name === 'permission.prompt') { if (p.agentId && p.promptId) asks.set(p.agentId, { promptId: p.promptId, tool: p.tool || '', at: now }); return; }
    if (name === 'permission.response') { for (const [aid, a] of asks) if (a.promptId === p.promptId) asks.delete(aid); return; }
    if (name === 'deliverable') {
      const r = p.agentId && liveRecOf(p.agentId);
      if (r && r.made.length < 20) r.made.push({ title: String(p.title || p.kind || 'deliverable') });
      return;
    }
    if (!p.agentId || !p.runId) return;
    let rec = runs.get(p.runId);
    if (name === 'agent.run.start') {
      if (!rec) rec = mk(p, false, now);
      else { rec.partial = false; rec.trigger = p.trigger || rec.trigger; rec.model = p.model || rec.model; }
      rec.lastAt = now; return;
    }
    // a tool step proves real work even when this page never saw the start (reload mid-run, or the SSE bridge
    // joined late) — open a PARTIAL record the card labels honestly. Tokens alone never open one: the harness's
    // internal self-talk streams tokens with its start/end suppressed, and must never read as an agent's job.
    if (!rec && name === 'agent.tool_call') rec = mk(p, true, now);
    if (!rec) return;
    rec.lastAt = now;
    if (name === 'agent.tool_call') {
      if (rec.ended) return;
      rec.steps.push({ callId: p.callId || '', name: String(p.name || 'tool'), args: String(p.argsSummary || ''), at: now, done: false, ok: null, ms: null, summary: '' });
      if (rec.steps.length > STEP_CAP) { rec.steps.shift(); rec.dropped++; }
      rec.text = '';   // prose before a tool call was narration; the tail shows what it is writing NOW
    } else if (name === 'agent.tool_result') {
      let s = null;
      for (let i = rec.steps.length - 1; i >= 0; i--) { const x = rec.steps[i]; if (!x.done && (!p.callId || !x.callId || x.callId === p.callId)) { s = x; break; } }
      if (!s) return;
      s.done = true; s.ok = !p.isError && p.ok !== false;
      if (typeof p.ms === 'number' && isFinite(p.ms)) s.ms = p.ms;
      if (p.summary) s.summary = String(p.summary);
    } else if (name === 'agent.token') {
      if (rec.ended || typeof p.delta !== 'string') return;
      rec.text = (rec.text + p.delta).slice(-TEXT_TAIL);
    } else if (name === 'agent.cost') {
      if (typeof p.usd === 'number' && isFinite(p.usd) && p.usd > 0) rec.usd += p.usd;
    } else if (name === 'agent.run.error') {
      rec.error = String(p.message || p.error || 'error');
    } else if (name === 'agent.run.end') {
      rec.ended = true; rec.reason = String(p.reason || 'done'); rec.endedAt = now;
      if (typeof p.usd === 'number' && isFinite(p.usd) && p.usd > rec.usd) rec.usd = p.usd;
      for (const s of rec.steps) if (!s.done) { s.done = true; s.ok = null; }   // never leave a step spinning after the run ended
    }
  }
  // a live record whose run went silent for STALE_MS with no end is not asserted live by the fold alone
  function currentOf(aid, now) {
    now = now || clock();
    const r = liveRecOf(aid);
    return r && now - r.lastAt < STALE_MS ? r : null;
  }
  function lastEndedOf(aid) {
    const l = byAgent.get(aid) || [];
    for (let i = l.length - 1; i >= 0; i--) { const r = runs.get(l[i]); if (r && r.ended) return r; }
    return null;
  }

  /* ---------------- display helpers ---------------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    const money = v => (typeof U !== 'undefined' && U.usd) ? U.usd(v) : '$' + (+v || 0).toFixed(4);
  const toolName = n => String(n || 'tool').replace(/^mcp__/, '').replace(/__/g, '.').replace(/_/g, '.');
  // the SALIENT argument (the file, the query, the url) — the COMMS chip's scan-don't-parse digest: argsSummary is a
  // capped JSON prefix, so only COMPLETE "key": value pairs are read; an unrecognised shape shows clipped raw text.
  const ARG_KEYS = ['path', 'file', 'filename', 'query', 'q', 'url', 'pattern', 'name', 'target', 'title', 'command', 'cmd', 'text', 'id'];
  const ARG_PAIR = /"([A-Za-z0-9_.-]+)"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?|true|false))/g;
  function argDigest(raw) {
    raw = String(raw == null ? '' : raw).trim();
    if (!raw) return '';
    const pairs = new Map(); let m; ARG_PAIR.lastIndex = 0;
    while ((m = ARG_PAIR.exec(raw))) {
      const v = m[2] !== undefined ? m[2] : m[3];
      const c = String(v == null ? '' : v).replace(/\\[nrt]/g, ' ').replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim();
      if (c && !pairs.has(m[1])) pairs.set(m[1], c);
    }
    for (const k of ARG_KEYS) if (pairs.get(k)) return clip(pairs.get(k), 60);
    if (pairs.size === 1) return clip(pairs.values().next().value, 60);
    return clip(raw, 60);
  }
  const dur = ms => { ms = Math.max(0, ms | 0); const s = Math.floor(ms / 1000); if (s < 60) return s + 's'; const m = Math.floor(s / 60); if (m < 60) return m + 'm ' + String(s % 60).padStart(2, '0') + 's'; return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
  const stepMs = ms => ms == null ? '' : ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's';
  function ago(ts, now) {
    if (!ts) return '';
    const d = Math.max(0, now - ts);
    if (d < 60000) return 'just now';
    const m = Math.floor(d / 60000); if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }
  const OUTCOME = { done: 'DONE', cancelled: 'STOPPED', error: 'FAILED', budget: 'HIT ITS BUDGET', max_iters: 'HIT ITS STEP LIMIT', refusal: 'REFUSED', empty: 'EMPTY REPLY', clarifying: 'ASKED YOU A QUESTION' };
  const outcomeState = r => r === 'done' ? 'done' : (r === 'error' || r === 'refusal' || r === 'empty') ? 'failed' : 'idle';
  const TRIGGER = { schedule: 'A scheduled routine', event: 'An incoming event', loop: 'A loop iteration', nightshift: 'Autonomy' };   // 'nightshift' stays the internal trigger id; the user-facing name is Autonomy
  const base = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');

  // the task this run is working: the Commander's own words when this page launched it (the workstream whose live
  // run IS this run — Channels.runIdOf), else an honest label for what started it. Never a guess.
  function taskOf(rec) {
    if (rec.task) return { text: rec.task, known: true };
    try {
      if (typeof Workstreams !== 'undefined' && typeof Channels !== 'undefined' && Channels.runIdOf) {
        for (const w of Workstreams.all()) {
          if (Channels.runIdOf(w.id) !== rec.runId) continue;
          rec.wsId = w.id;
          const h = Array.isArray(w.history) ? w.history : [];
          for (let i = h.length - 1; i >= 0; i--) if (h[i] && h[i].role === 'user' && h[i].content) { rec.task = String(h[i].content); break; }
          if (rec.task) return { text: rec.task, known: true };
        }
      }
    } catch (_) { /* a store mid-reload: fall through to the label */ }
    return { text: (TRIGGER[rec.trigger] || 'Started outside this window') + ' — the task text lands in the record when the run ends', known: false };
  }

  // the run's final words: the server's delivery text when it kept one, else the COMMS row this page stamped with the
  // run's id (chat.js persists the reply with sourceRunId) — never a neighbouring turn
  function replyOf(row) {
    if (row.deliveryText) return String(row.deliveryText);
    try {
      if (typeof Workstreams === 'undefined' || !row.runId) return '';
      const w = (row.streamId && Workstreams.get(row.streamId)) || null;
      for (const s of (w ? [w] : Workstreams.all())) {
        const h = Array.isArray(s.history) ? s.history : [];
        for (let i = h.length - 1; i >= 0; i--) if (h[i] && h[i].role === 'assistant' && h[i].sourceRunId === row.runId && h[i].content) return String(h[i].content);
      }
    } catch (_) { /* store mid-reload */ }
    return '';
  }

  /* ---------------- the window ----------------
     A registered station window ('desk'): it rises from the bottom dock between CREW and COMMS, resizes and
     minimizes like every other window, and switches agents with the shared roster switcher. The term system owns
     the chrome; this owns the body. The body is built once per agent and repainted in place each second (the
     mid-run note field is never rebuilt under the Commander's cursor). */
  let doors = {};                                              // openChat / openRecord / openFiles (app.js)
  let cur = null, timer = 0;                                   // cur = { agentId, name, body }
  let snap = null, snapAt = 0, snapBusy = false;               // /api/state/snapshot: this agent's server-proven live runs
  let hist = null, histFor = '', histAt = 0, histBusy = false; // /api/runs rows for this agent
  let steerNote = '', stopNote = '', stopAt = 0, wasLive = false;

  function getJson(u) { return fetch(u, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null); }
  function postJson(u, body) {
    return fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async r => { let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, ok: r.ok, body: j }; })
      .catch(() => ({ status: 0, ok: false, body: null }));
  }
  function pollSnap(force) {
    if (!cur || snapBusy || (!force && clock() - snapAt < 4000)) return;
    snapBusy = true; const want = cur;
    getJson('/api/state/snapshot').then(j => {
      snapBusy = false; if (cur !== want) return;
      snapAt = clock();
      snap = j && Array.isArray(j.runs) ? j.runs.filter(r => r && r.agentId === want.agentId) : null;
      paint();
    });
  }
  function pollHist(force) {
    if (!cur || histBusy) return;
    if (!force && histFor === cur.agentId && clock() - histAt < 15000) return;
    histBusy = true; const want = cur;
    getJson('/api/runs?agent=' + encodeURIComponent(want.agentId) + '&limit=12').then(j => {
      histBusy = false; if (cur !== want) return;
      histAt = clock(); histFor = want.agentId;
      hist = j && Array.isArray(j.runs) ? j.runs.filter(r => r && r.agentId === want.agentId && !r.internal && !r.stepTest) : null;
      paint();
    });
  }

  // what the window shows right now, resolved from the fold + the two server reads
  function view() {
    const now = clock(), aid = cur.agentId;
    let live = currentOf(aid, now);
    const serverLive = snap ? snap.map(r => r.runId) : null;
    // the snapshot outranks a fold record that never saw its end: not listed + quiet for 10 s = not asserted live
    if (live && serverLive && serverLive.indexOf(live.runId) < 0 && now - live.lastAt > 10000 && snapAt > live.lastAt) live = null;
    const unseen = !live && serverLive && serverLive.length ? snap[0] : null;   // live on the server, no event seen here yet
    return { now, aid, name: cur.name, live, unseen, ask: asks.get(aid) || null, last: hist && hist.length ? hist[0] : null, ended: lastEndedOf(aid) };
  }

  const sec = t => '<div class="sec"><span class="sec-l">' + esc(t) + '</span><span class="sec-r"></span><span class="sec-nd"></span></div>';
  const kv = rows => '<dl class="ds-kv">' + rows.filter(Boolean).map(r => '<dt>' + esc(r[0]) + '</dt><dd' + (r[2] ? ' class="' + r[2] + '"' : '') + '>' + esc(r[1]) + '</dd>').join('') + '</dl>';
  function stepsHtml(steps, bridged) {
    return '<ol class="ds-steps">' + steps.map(s => {
      const st = !s.done ? 'run' : s.ok === true ? 'ok' : s.ok === false ? 'bad' : 'end';
      const g = st === 'run' ? '▸' : st === 'ok' ? '✓' : st === 'bad' ? '✗' : '·';
      const arg = argDigest(s.args);
      return '<li class="ds-step" data-s="' + st + '"><span class="ds-g">' + g + '</span><span class="ds-n">' + esc(toolName(s.name)) + '</span>'
        + (arg ? '<span class="ds-a">' + esc(arg) + '</span>' : '') + '<span class="ds-ms">' + esc(st === 'run' ? 'working…' : stepMs(s.ms)) + '</span>'
        + (s.summary ? '<span class="ds-sum">' + esc(clip(s.summary, 200)) + '</span>' : '') + '</li>';
    }).join('') + '</ol>' + (bridged ? '<p class="ds-dim">This run was started outside this window, so the station only reports each tool\'s name and result here. The full detail is in the RECORD.</p>' : '');
  }

  function paint() {
    const body = cur && cur.body;
    if (!body || !body.isConnected) return;
    const v = view(), strip = body.querySelector('.ds-strip'), main = body.querySelector('.ds-main');
    let state, label, html = '';
    if (v.live) {
      const r = v.live, t = taskOf(r);
      state = v.ask ? 'ask' : 'running';
      label = (v.ask ? 'NEEDS YOUR OK' : 'WORKING') + ' · ' + dur(v.now - r.startedAt);
      html += kv([['TASK', clip(t.text, 400), t.known ? 'ds-task' : 'ds-task ds-dim'],
        r.usd > 0 ? ['SPENT', money(r.usd) + (r.model ? ' · ' + clip(String(r.model).split('/').pop(), 32) : '')] : null]);
      if (v.ask) html += '<p class="ds-ask">Waiting for your approval' + (v.ask.tool ? ' to use ' + esc(toolName(v.ask.tool)) : '') + '. Answer it in COMMS.</p>';
      if (r.partial) html += '<p class="ds-dim">Joined mid-run: steps from before this page was watching aren\'t shown here.</p>';
      html += sec('STEPS' + (r.steps.length ? ' · ' + (r.steps.length + r.dropped) : ''));
      html += r.steps.length ? stepsHtml(r.steps, !r.steps.some(s => s.args || s.summary) && !t.known) : '<p class="ds-dim">No tool steps yet. It\'s thinking.</p>';
      if (r.text.trim()) html += sec('WRITING') + '<p class="ds-text">' + esc(r.text.length >= TEXT_TAIL ? '…' + r.text.trim() : r.text.trim()) + '</p>';
      if (r.made.length) html += sec('MADE') + '<ul class="ds-made">' + r.made.map(m => '<li>' + esc(clip(m.title, 90)) + '</li>').join('') + '</ul>';
      if (stopNote && v.now - stopAt > 12000) stopNote = 'The station hasn\'t confirmed the stop yet. It is still running.';
    } else if (v.unseen) {
      state = 'running';
      label = 'WORKING' + (v.unseen.startedAt ? ' · ' + dur(v.now - v.unseen.startedAt) : '');
      html += '<p class="ds-dim">' + esc(v.name) + ' is on a run that started before this page was watching. Its steps show here as they happen, and the whole run lands in the RECORD when it ends.</p>';
    } else {
      const row = v.last, ended = v.ended;
      // a stop this window sent resolves only on the run's own end: 'Stopped.' when it ended cancelled, else the note clears
      if (stopAt && stopNote && stopNote !== 'Stopped.') stopNote = ended && ended.reason === 'cancelled' && ended.endedAt >= stopAt ? 'Stopped.' : '';
      if (row) {
        state = outcomeState(row.reason);
        label = (row.reason === 'done' ? 'IDLE' : (OUTCOME[row.reason] || 'IDLE')) + ' · last job ' + ago(row.endedAt || row.ts, v.now);
        html += kv([['LAST JOB', clip(row.title || 'Untitled run', 300), 'ds-task'],
          ['OUTCOME', [OUTCOME[row.reason] || String(row.reason || 'done').toUpperCase(), row.durationMs ? dur(row.durationMs) : '', row.usd > 0 ? money(row.usd) : ''].filter(Boolean).join(' · ')]]);
        const trace = Array.isArray(row.toolTrace) ? row.toolTrace : [];
        if (trace.length) {
          const shown = trace.slice(-20).map(s => ({ name: s.name, args: '', done: true, ok: s.isError ? false : s.ok !== false, ms: typeof s.ms === 'number' ? s.ms : null, summary: s.summary || '' }));
          html += sec('WHAT IT DID · ' + trace.length + ' step' + (trace.length === 1 ? '' : 's')) + stepsHtml(shown, false);
        }
        const reply = replyOf(row);
        if (reply) html += sec('ITS REPLY') + '<p class="ds-text">' + esc(clip(reply, 900)) + '</p>';
        const arts = Array.isArray(row.artifacts) ? row.artifacts : [];
        if (arts.length) html += sec('MADE') + '<ul class="ds-made">' + arts.slice(0, 8).map(a => '<li>' + esc(base(a.path || a.target)) + '</li>').join('') + (arts.length > 8 ? '<li class="ds-dim">+' + (arts.length - 8) + ' more</li>' : '') + '</ul>';
        const earlier = hist.slice(1, 5);
        if (earlier.length) html += sec('BEFORE THAT') + '<ul class="ds-earlier">' + earlier.map(e => '<li><span>' + esc(clip(e.title || 'Untitled run', 80)) + '</span><span class="ds-ms">' + esc((OUTCOME[e.reason] || 'DONE') + ' · ' + ago(e.endedAt || e.ts, v.now)) + '</span></li>').join('') + '</ul>';
      } else if (ended) {
        // it just finished here and the server's row hasn't landed yet
        state = outcomeState(ended.reason);
        label = (OUTCOME[ended.reason] || 'DONE') + ' · ' + ago(ended.endedAt, v.now);
        html += '<p class="ds-dim">Just finished. Writing the record…</p>' + (ended.steps.length ? stepsHtml(ended.steps, false) : '');
      } else if (hist) {
        state = 'idle'; label = 'IDLE';
        html += '<p class="ds-dim">No work recorded at this desk yet. Give ' + esc(v.name) + ' a task and you\'ll watch it happen here.</p>';
      } else {
        state = 'idle'; label = 'IDLE';
        html += '<p class="ds-dim">Reading the record…</p>';
      }
    }
    body.querySelector('.ds-screen').setAttribute('data-state', state);
    const stripHtml = '<span class="ds-lamp" aria-hidden="true"></span><b class="ds-name">' + esc(v.name) + '</b><span class="ds-st">' + esc(label) + '</span>';
    if (strip.__html !== stripHtml) { strip.innerHTML = stripHtml; strip.__html = stripHtml; }
    // keep the reader's place: stay pinned to the newest step only if they were already at the bottom
    if (main.__html !== html) {
      const pinned = body.scrollTop + body.clientHeight >= body.scrollHeight - 4, top = body.scrollTop;   // the window body is the scroller
      main.innerHTML = html; main.__html = html;
      body.scrollTop = (v.live && pinned) ? body.scrollHeight : top;
    }
    const liveRid = v.live && v.live.runId;
    body.querySelector('.ds-steer').hidden = !liveRid;
    body.querySelector('.ds-in').placeholder = 'Tell ' + v.name + ' something mid-run…';
    body.querySelector('.ds-stop').hidden = !liveRid;
    body.querySelector('[data-a="chat"]').textContent = v.live || v.unseen ? 'OPEN CHAT' : 'GIVE IT A TASK';
    body.querySelector('[data-a="files"]').hidden = !(!v.live && v.last && Array.isArray(v.last.artifacts) && v.last.artifacts.length && doors.openFiles);
    const note = [stopNote, steerNote].filter(Boolean).join(' ');
    const n = body.querySelector('.ds-note'); if (n.textContent !== note) n.textContent = note;
  }

  function tick() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      if (!cur || !cur.body || !cur.body.isConnected) { cur = null; return; }   // the window closed: stop polling
      const live = !!currentOf(cur.agentId);
      if (wasLive && !live) { pollHist(true); steerNote = ''; }   // a run just ended here: fetch its row; its steer receipt is history
      wasLive = live;
      pollSnap(false); if (!live) pollHist(false);
      paint(); tick();
    }, 1000);
  }

  // the window builder (StationUI calls it on open and on every roster switch / rerender)
  function build(body) {
    const H = StationUI.h, a = H.present[H.sel] || null;
    if (!a) { body.innerHTML = '<p class="ds-dim">No agent selected.</p>'; return; }
    const same = cur && cur.agentId === a.id;
    cur = { agentId: a.id, name: a.name || a.id, body };
    if (!same) { snap = null; hist = null; histFor = ''; steerNote = stopNote = ''; }
    wasLive = !!currentOf(a.id);
    body.innerHTML = H.rosterSwitchHtml(a.id)
      + '<div class="ds-screen" data-state="idle">'
      + '<div class="ds-strip"></div>'
      + '<div class="ds-main"></div>'
      + '<form class="ds-steer" hidden><input class="ds-in" type="text" maxlength="2000" autocomplete="off" aria-label="Tell this agent something mid-run">'
      + '<button type="submit" class="bb sm">SEND</button></form><p class="ds-note" role="status"></p>'
      + '<div class="ds-foot">'
      + '<button type="button" class="bb sm ds-stop" data-a="stop" hidden>STOP</button>'
      + '<button type="button" class="bb sm" data-a="chat">OPEN CHAT</button>'
      + '<button type="button" class="bb sm" data-a="files" hidden>FILES</button>'
      + '<button type="button" class="bb sm" data-a="record">RECORD</button></div></div>';
    H.wireRosterSwitch(body, 'desk');
    const aid = a.id;
    body.querySelector('.ds-foot').addEventListener('click', e => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const act = b.getAttribute('data-a');
      if (act === 'chat') { const v = view(); if (doors.openChat) doors.openChat(aid, v.live && v.live.wsId); }
      else if (act === 'record') { if (doors.openRecord) doors.openRecord(aid); }
      else if (act === 'files') { const v = view(); if (v.last && v.last.runId && doors.openFiles) doors.openFiles(v.last.runId, v.last.title || 'Last job'); }
    });
    const stop = body.querySelector('.ds-stop');
    const doStop = () => {
      const v = view(); const rid = v.live && v.live.runId; if (!rid) return;
      stopAt = clock(); stopNote = 'Stop sent. Waiting for the station to confirm…'; paint();
      postJson('/api/cancel', { runId: rid }).then(r => { if (!r.ok) { stopNote = 'The station refused the stop (http ' + r.status + ').'; paint(); } });
    };
    if (typeof ArmConfirm !== 'undefined' && ArmConfirm.wire) ArmConfirm.wire(stop, { armedLabel: 'CONFIRM STOP', onConfirm: doStop });
    else stop.addEventListener('click', doStop);
    body.querySelector('.ds-steer').addEventListener('submit', e => {
      e.preventDefault();
      const inp = body.querySelector('.ds-in'), text = inp.value.trim(), v = view(), rid = v.live && v.live.runId;
      if (!text || !rid) return;
      steerNote = 'Sending…'; paint();
      postJson('/api/run/steer', { runId: rid, text }).then(r => {
        if (r.ok) { steerNote = 'Sent. ' + v.name + ' reads it before its next step.'; if (inp.value.trim() === text) inp.value = ''; }
        else if (r.status === 404 || r.status === 409) steerNote = 'That run already finished. Use OPEN CHAT to give it a new task.';
        else if (r.status === 429) steerNote = 'It already has notes waiting. Give it a moment.';
        else steerNote = 'Not sent (http ' + r.status + ').';
        paint();
      });
    });
    paint(); pollSnap(true); pollHist(true); tick();
  }

  // open THIS agent's desk window (the StationUI core selects the agent, then opens or re-renders the window)
  function open(agentId) {
    if (!agentId || typeof StationUI === 'undefined' || !StationUI.openDesk) return false;
    return StationUI.openDesk(agentId);
  }

  // the fold listens from boot, so a desk opened mid-run already holds every step this page has seen
  let wired = false;
  function init(o) {
    if (o) doors = o;
    if (typeof StationUI !== 'undefined' && StationUI.registerWindow) StationUI.registerWindow('desk', 'DESK SCREEN', build, { className: 'desk-win' });
    if (wired || typeof U === 'undefined' || !U.bus) return;
    wired = true;
    for (const n of ['agent.run.start', 'agent.tool_call', 'agent.tool_result', 'agent.token', 'agent.cost', 'agent.run.error', 'agent.run.end', 'permission.prompt', 'permission.response', 'deliverable']) {
      U.bus.on(n, p => { try { fold(n, p); } catch (_) { /* a malformed event never breaks the bus */ } });
    }
  }

  const isOpen = () => !!(cur && cur.body && cur.body.isConnected);
  const text = () => (isOpen() ? cur.body.innerText : null);
  const agentOfOpen = () => (isOpen() ? cur.agentId : null);
  return { init, open, isOpen, text, agentOfOpen,
    _fold: fold, _currentOf: currentOf, _lastEndedOf: lastEndedOf, _argDigest: argDigest, _taskOf: taskOf,
    _reset: () => { runs.clear(); byAgent.clear(); asks.clear(); } };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = DeskScreen;
