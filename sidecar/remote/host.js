/* sidecar/remote/host.js — what each gateway verb actually does on this station.

   index.js builds this with the SAME in-process functions the desktop and the channels use (the roster, the
   transcript store, runOnce, the channel consent waiter, the deliverable library, the fs jail, the cron store),
   so a phone's answer is the desk's answer and nothing here re-implements station logic.

   Remote runs are DETACHED: they belong to the station, not to the phone's connection. A phone that drops,
   sleeps or changes network mid-run changes nothing; the run finishes, its transcript lands in the same
   conversation, and the phone catches up by reading the thread when it comes back. That is the difference
   from a desktop /api/run, whose run dies with its socket by design.

   Events a phone sees:
     run.started  { runId, agentId, streamId }
     run.text     { runId, text } | { runId, at, add }   the reply so far, or what it grew by from `at` (≤ ~4 per second)
     run.tool     { runId, callId, name, summary } a step the agent took
     run.step     { runId, callId, ok, ms }       how that step went
     run.ended    { runId, agentId, streamId, reason, usd, error }
     approval.opened / approval.closed            from the shared registry
     station      { name, payload }               the station floor's own redacted feed (SSE tee) */
'use strict';

const { note } = require('../failopen.js');

const TEXT_FLUSH_MS = 250;

function makeRemoteHost(d) {
  const now = d.now;
  if (typeof now !== 'function') throw new Error('makeRemoteHost needs an injected clock (deps.now)');
  const remoteRuns = new Map();   // runId -> { ac, agentId, streamId, deviceId, startedAt }
  const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
  const broadcast = (evt) => { try { d.broadcast(evt); } catch (e) { note('remote.host.d.broadcast', e); } };

  function agentsList() {
    let looks = {};
    try { looks = (d.crewLooks && d.crewLooks()) || {}; } catch (e) { note('remote.host.crewLooks', e); looks = {}; }
    return d.roster().map(a => ({ agentId: a.agentId, name: a.name || a.agentId, model: a.model || null, provider: a.provider || null,
      skin: clip((looks[a.agentId] && looks[a.agentId].skin) || '', 40), color: clip((looks[a.agentId] && looks[a.agentId].color) || '', 16) }));
  }

  async function status() {
    const live = d.liveRuns();
    for (const [runId, r] of remoteRuns) if (!live.some(x => x.runId === runId)) live.push({ runId, agentId: r.agentId, startedAt: r.startedAt, source: 'remote' });
    const busy = new Map();
    for (const r of live) if (!busy.has(r.agentId)) busy.set(r.agentId, r);
    const agents = agentsList().map(a => {
      const r = busy.get(a.agentId);
      return Object.assign(a, r ? { state: 'working', runId: r.runId, since: r.startedAt, source: r.source || null } : { state: 'idle' });
    });
    return { station: d.stationName ? d.stationName() : 'StarNet', at: now(), agents, runs: live.map(r => ({ runId: r.runId, agentId: r.agentId, startedAt: r.startedAt, source: r.source || null })) };
  }

  /* SESSIONS. The desk keeps its sessions (title, agent, history) in the station save; the transcript store holds
     what runs wrote. A phone must see the SAME sessions the desk shows and continue them under the same id, so:
       · the list = the desk's sessions (save.workstreams) ∪ any transcript stream the desk has not adopted yet
       · a thread = the desk's history for that session, plus any newer turns the station recorded that the desk
         page has not merged yet (a phone turn sent while the desk was closed)
     The desk reconciles the other way on its own: opening a session merges the station's transcript into it. */
  const isProse = (m) => m && (m.role === 'user' || m.role === 'assistant') && !m.sys && typeof m.content === 'string' && m.content.trim();
  function deskSessions() {
    let list = [];
    try { list = (d.deskSessions && d.deskSessions()) || []; } catch (e) { note('remote.host.deskSessions', e); list = []; }
    return Array.isArray(list) ? list.filter(w => w && typeof w.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(w.id) && !w.archived && w.conversationMode !== 'group') : [];
  }
  function stationTurns(streamId, limit) {
    try { return (d.transcript.history(streamId, { limit: limit || 200 }) || []).filter(isProse); }
    catch (e) { note('remote.host.stationTurns', e); return []; }
  }
  // desk history first (it is the longer memory), then station turns the desk has not merged yet
  function mergedTurns(streamId, limit) {
    const w = deskSessions().find(x => x.id === streamId);
    const base = w && Array.isArray(w.history) ? w.history.filter(isProse) : [];
    const st = stationTurns(streamId, 200);
    if (!base.length) return st.slice(-(limit || 200));
    const seen = new Set(base.map(m => m.rowId).filter(x => x != null));
    const lastTs = base.reduce((t, m) => Math.max(t, Number(m.ts) || 0), 0);
    const tail = base.slice(-4).map(m => m.role + '\u0000' + m.content);
    const extra = st.filter(m => !(m.rowId != null && seen.has(m.rowId)) && (Number(m.ts) || 0) > lastTs && tail.indexOf(m.role + '\u0000' + m.content) < 0);
    return base.concat(extra).slice(-(limit || 200));
  }
  const lastUserLine = (turns) => { for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'user') return clip(turns[i].content.replace(/\s+/g, ' ').trim(), 140); return ''; };

  async function threads(o) {
    const out = [], seen = new Set();
    const names = new Map(agentsList().map(a => [a.agentId, String(a.name || '').toLowerCase()]));
    for (const w of deskSessions()) {
      const agentId = String(w.agentId || 'agent');
      const hist = Array.isArray(w.history) ? w.history.filter(isProse) : [];
      seen.add(w.id);
      if (o.agentId && agentId !== o.agentId) continue;
      // an untouched blank session (no title, or only the agent's own name as one) is noise on a phone
      if (!hist.length && (!w.title || String(w.title).trim().toLowerCase() === (names.get(agentId) || agentId.toLowerCase()))) continue;
      out.push({ streamId: w.id, agentId, title: w.title ? clip(w.title, 80) : '', turns: hist.length, lastAt: Number(w.lastActiveAt) || 0, preview: lastUserLine(hist), source: 'desk' });
    }
    const rows = d.transcript.streams({ limit: 100, previewChars: 140 }) || [];
    for (const r of rows) {
      if (seen.has(r.streamId)) {   // the station may have newer turns than the desk save: surface the later time
        const row = out.find(x => x.streamId === r.streamId);
        if (row && Number(r.lastAt) > row.lastAt) { row.lastAt = Number(r.lastAt); if (r.preview) row.preview = r.preview; }
        continue;
      }
      if (r.streamId === 'global' || /^(cron|nightshift|workshop)-/.test(r.streamId)) continue;   // background work has its own surfaces
      let agentId = r.agentId || '';
      if (!agentId) { try { const h = d.transcript.history(r.streamId, { limit: 1 }); agentId = (h[0] && h[0].agentId) || ''; } catch (e) { note('remote.host.threadAgent', e); } }
      if (o.agentId && agentId !== o.agentId) continue;
      out.push({ streamId: r.streamId, agentId, title: '', turns: r.turns, lastAt: r.lastAt, preview: r.preview || '', source: /^remote_/.test(r.streamId) ? 'phone' : 'station' });
    }
    out.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
    return out.slice(0, o.limit);
  }

  // newest turns first into a byte budget, so a long conversation always fits one sealed frame through the relay
  const THREAD_BUDGET = 180 * 1024;
  async function thread(o) {
    const rows = mergedTurns(o.streamId, o.limit).map(r => ({ role: r.role, agentId: r.agentId || null, ts: r.ts || null, content: clip(r.content, 20000) }));
    let used = 0, keep = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) { used += Buffer.byteLength(rows[i].content) + 80; if (used > THREAD_BUDGET && i < rows.length - 1) break; keep = i; }
    return rows.slice(keep);
  }

  // what the desk needs to show a phone conversation as one of its own sessions (GET /api/remote/recent)
  const recent = [];   // newest last, bounded
  function noteRecent(row) {
    const i = recent.findIndex(x => x.runId === row.runId);
    if (i >= 0) recent[i] = Object.assign(recent[i], row); else recent.push(row);
    while (recent.length > 60) recent.shift();
  }
  function recentRuns() { return recent.slice().reverse(); }

  async function send(o) {
    const who = agentsList().find(a => a.agentId === o.agentId);
    if (!who) return { ok: false, error: 'there is no agent called ' + o.agentId + ' on this station' };
    const cred = d.credentials(o.agentId);
    if (!cred || !cred.ok) return { ok: false, error: (cred && cred.error) || 'this agent has no model set up yet' };
    const streamId = o.streamId || ('remote_' + String(o.agentId).replace(/[^A-Za-z0-9_-]/g, '_') + '_' + now().toString(36)).slice(0, 64);
    const runId = d.newId();
    const ac = new AbortController();
    const rec = { ac, agentId: o.agentId, streamId, deviceId: o.deviceId || '', startedAt: now() };
    remoteRuns.set(runId, rec);

    // the conversation so far: the desk's memory of this session plus anything the station recorded since
    const messages = mergedTurns(streamId, 100).map(m => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: o.text }]);
    let isTask = true;
    // the agent's last turn rides along, as on COMMS and the channels: "yes" to "want me to draft it?" is a TASK (tools),
    // not chat that can only promise (sweep 2026-10-02)
    let priorAgentTurn = '';
    for (let i = messages.length - 2; i >= 0; i--) if (messages[i] && messages[i].role === 'assistant') { priorAgentTurn = String(messages[i].content || ''); break; }
    try { if (typeof d.classify === 'function') isTask = !!d.classify(o.text, { priorAgentTurn }); } catch (e) { note('remote.host.classify', e); }
    noteRecent({ runId, agentId: o.agentId, streamId, title: clip(o.text.replace(/\s+/g, ' ').trim(), 80), startedAt: rec.startedAt, endedAt: null, live: true });

    // the reply, coalesced: a phone on cellular gets a few frames a second, not one per token
    let buf = '', timer = null, errMsg = null, reason = null, usd = 0;
    /* The reply only GROWS, so a frame carries only what is new (and where it starts): resending the whole reply four
       times a second made a long answer cost its full size every quarter second on the station's uplink. Every eighth
       frame (two seconds) is the whole text again, so a phone that missed a piece is put right at once. */
    let sent = 0, flushes = 0;
    const flush = () => {
      timer = null;
      const full = clip(buf, 20000);
      flushes += 1;
      if (sent > 0 && full.length >= sent && flushes % 8) { if (full.length > sent) broadcast({ type: 'run.text', runId, at: sent, add: full.slice(sent) }); }
      else broadcast({ type: 'run.text', runId, text: full });
      sent = full.length;
    };
    const emit = (name, payload) => {
      const p = payload || {};
      // a delegated worker's lifecycle rides the lead's emit (orchestration forwards it): a worker that errored and
      // was recovered from must not turn THIS run's phone result red — the same runId filter harness.js applies.
      if ((name === 'agent.run.error' || name === 'agent.run.end') && p.runId && p.runId !== runId) return;
      if (name === 'agent.token') { buf += (p.delta || ''); if (!timer) timer = setTimeout(flush, TEXT_FLUSH_MS); }
      else if (name === 'agent.tool_call') { buf = ''; sent = 0; broadcast({ type: 'run.tool', runId, callId: String(p.callId || ''), name: clip(p.name, 80), summary: clip(p.argsSummary, 400) }); }
      else if (name === 'agent.tool_result') broadcast({ type: 'run.step', runId, callId: String(p.callId || ''), ok: !!p.ok && !p.isError, ms: Number(p.ms) || 0 });
      else if (name === 'agent.run.error') errMsg = clip(p.message || 'run error', 400);
      else if (name === 'agent.run.end') { reason = p.reason || null; if (typeof p.usd === 'number' && isFinite(p.usd)) usd = Math.max(usd, p.usd); }
    };
    const prompt = (call, tool) => d.askConsent({ agentId: o.agentId, runId, signal: ac.signal, call, tool, surface: 'remote', onPrompt: () => {} });

    broadcast({ type: 'run.started', runId, agentId: o.agentId, streamId });
    // setImmediate, not a microtask: runOnce does a second or more of synchronous set-up before its first await,
    // and the phone's "accepted" reply must leave first (measured: the ack took 1.3 s behind a microtask start).
    new Promise((resolve) => setImmediate(resolve)).then(() => d.runOnce({
      key: cred.key, model: cred.model, provider: cred.provider, baseUrl: cred.baseUrl || '', reasoningEffort: cred.reasoningEffort,
      system: cred.system, messages, agentId: o.agentId, isTask,
      emit, signal: ac.signal, runId, streamId, trigger: 'event',
      surface: 'interactive', prompt, ownerTrusted: true, floorless: true, broadcast: true, reflect: true,
      // A PHONE WORKS WITH THE DESK'S PERMISSIONS (Andrew 2026-10-02: "full access so I can vibe code on the go"): an
      // agent on Full Access acts from the phone without asking, exactly as at the desk. A phone the Commander marked
      // ALWAYS ASK (desk > Remote > that phone) never inherits Full Access or the station bypass: every gated step asks
      // on the phone. Host-minted, never from text, and it rides into delegated workers (run-origin.js). If the
      // setting cannot be read, the phone asks (never more power on an error).
      connectorAuthority: { withholdHostPower: phoneAsksFirst(o.deviceId) },
      taskKey: 'remote:' + (o.deviceId || 'phone'), taskSource: 'remote'
    })).catch((e) => { errMsg = errMsg || clip((e && e.message) || e, 400); })
      .finally(() => {
        if (timer) { clearTimeout(timer); flush(); }
        remoteRuns.delete(runId);
        noteRecent({ runId, endedAt: now(), live: false, ok: !errMsg });
        broadcast({ type: 'run.ended', runId, agentId: o.agentId, streamId, reason: reason || (ac.signal.aborted ? 'stopped' : (errMsg ? 'error' : 'done')), usd, error: errMsg });
      });
    return { runId, streamId };
  }

  async function stop(o) {
    const r = remoteRuns.get(o.runId);
    if (r) { try { r.ac.abort(); } catch (e) { note('remote.host.r.ac.abort', e); } return { ok: true }; }
    return d.stopRun(o.runId) ? { ok: true } : { ok: false, error: 'that run is not running' };
  }

  async function files(o) {
    let rows = await d.deliverables();
    if (o.query) rows = rows.filter(r => [r.title, r.summary, r.ask, r.agentId].join(' ').toLowerCase().indexOf(o.query) >= 0);
    rows = rows.slice().sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)).slice(0, o.limit);
    return rows.map(r => ({
      id: r.id, title: r.title || null, kind: r.kind || null, status: r.status || null, agentId: r.agentId || null, createdAt: r.createdAt || null,
      summary: clip(r.summary, 300),
      files: (Array.isArray(r.files) ? r.files : []).slice(0, 20).map(f => ({ path: f.path, bytes: Number.isFinite(f.bytes) ? f.bytes : null }))
    }));
  }

  /* A PHONE READS WHAT THE STATION SHOWED IT, nothing else: a file inside that agent's own workspace (a relative
     path), or a file outside it only when one of that agent's runs or deliverables recorded it (the file chips the
     phone was given). A free-form absolute path is refused even under a folder the agents may use at the desk. */
  const isAbsPath = (p) => /^([A-Za-z]:|[\\/])/.test(String(p || ''));
  async function shownPaths(agentId) {
    const set = new Set();
    let rows = [];
    try { rows = (d.runHistory && d.runHistory(300)) || []; } catch (e) { note('remote.host.shownRuns', e); rows = []; }
    for (const r of rows) {
      if (!r || r.agentId !== agentId) continue;
      for (const a of Array.isArray(r.artifacts) ? r.artifacts : []) if (a && a.path) set.add(String(a.path).slice(0, 300));
      if (r.deliverable && r.deliverable.main) set.add(String(r.deliverable.main).slice(0, 300));
    }
    let dl = [];
    try { dl = (await d.deliverables()) || []; } catch (e) { note('remote.host.shownDeliverables', e); dl = []; }
    for (const r of dl) if (r && r.agentId === agentId) for (const f of Array.isArray(r.files) ? r.files : []) if (f && f.path) set.add(String(f.path));
    return set;
  }
  function phoneAsksFirst(deviceId) {
    if (typeof d.phoneAsksFirst !== 'function') return false;
    try { return d.phoneAsksFirst(deviceId) === true; } catch (e) { note('remote.host.phoneAsksFirst', e); return true; }
  }
  async function fetchFile(o) {
    if (!agentsList().some(a => a.agentId === o.agentId)) return { ok: false, error: 'unknown file' };   // never make a folder for a made-up agent
    if (isAbsPath(o.path) && !(await shownPaths(o.agentId)).has(String(o.path))) return { ok: false, error: 'unknown file' };
    return d.readFile(o.agentId, o.path, o.offset, o.length);
  }

  async function routines() {
    return (d.routines() || []).map(j => ({
      id: j.id, name: j.name || null, agentId: j.agentId || null, enabled: j.enabled !== false, inFlight: !!j.inFlight,
      schedule: j.scheduleDisplay || (j.schedule && (j.schedule.display || j.schedule.kind)) || null,
      nextRunAt: j.nextRunAt || null, lastRunAt: j.lastRunAt || null, lastStatus: j.lastStatus || null,
      prompt: clip(j.prompt, 200)
    }));
  }

  async function setRoutine(o) { return d.setRoutine(o.jobId, o.enabled); }

  /* THE STATION VIEW. The desk page draws the still (the sidecar has no renderer); this hands it to a phone in
     sealed chunks and notes that a phone is looking, which is what makes the desk keep it fresh. The phone gets
     the time the desk drew it and shows that age: an old picture is never passed off as live. */
  async function view(o) {
    if (!d.view) return { none: true, now: now() };
    d.view.want(o.deviceId);
    const m = d.view.meta();
    let desk = false;
    try { desk = !!(d.deskOpen && d.deskOpen()); } catch (e) { note('remote.host.deskOpen', e); }
    if (!m) return { none: true, desk, now: now() };
    // `now` is this station's clock at the moment of the answer: the phone works out the picture's age from
    // (now - at), so a phone whose own clock is off still shows the right age
    if (!o.offset && o.have && o.have === m.at) return { at: m.at, checked: m.checkedAt || m.at, now: now(), same: true, crewPaused: !!m.crewPaused };
    if (o.offset && o.at !== m.at) return { at: m.at, now: now(), changed: true };   // the desk drew a newer one mid-read: start over
    const buf = d.view.read(o.offset, o.length);
    const out = { at: m.at, now: now(), w: m.w, h: m.h, mime: m.mime, size: m.size, offset: o.offset, bytes: buf.length, eof: o.offset + buf.length >= m.size, data: buf.toString('base64') };
    if (!o.offset) { out.checked = m.checkedAt || m.at; out.crewPaused = !!m.crewPaused; out.bodies = m.bodies; out.crewFree = !!m.crewFree; out.scale = m.scale || 0; out.crew = d.view.crew ? d.view.crew() : null; }
    return out;
  }

  // an agent's own sprite (the same art the desk's crew list shows), so the phone draws the real crew
  async function portrait(o) {
    const a = agentsList().find(x => x.agentId === o.agentId);
    if (!a || !d.portrait) return { ok: false, error: 'unknown agent' };
    const p = d.portrait(a.skin);
    return p ? { agentId: a.agentId, skin: p.skin, mime: p.mime, data: p.data } : { ok: false, error: 'no portrait' };
  }

  // every drawing of one sprite track, so the phone can draw a crew member exactly as the stage does
  async function sprite(o) {
    const t = d.sprites ? d.sprites(o.key) : null;
    return t ? t : { ok: false, error: 'unknown sprite' };
  }

  /* ACTIVITY: the station's work in one list, newest first — what is running now (and what the phone knows of its
     steps), then what finished, with its result line and the files it made. Background self-talk is left out.
     It reads the same run history the desk's activity feed reads; nothing here is inferred. */
  async function activity(o) {
    const live = (await status()).runs.map(r => {
      const rec = recent.find(x => x.runId === r.runId);
      return { runId: r.runId, agentId: r.agentId, state: 'working', startedAt: r.startedAt || null, source: r.source || null,
        title: rec ? rec.title : '', streamId: rec ? rec.streamId : (r.streamId || '') };
    });
    let rows = [];
    try { rows = (d.runHistory && d.runHistory(o.limit + 20)) || []; } catch (e) { note('remote.host.runHistory', e); rows = []; }
    const liveIds = new Set(live.map(r => r.runId));
    const done = [], resultOf = new Set();
    for (const r of rows) {
      if (!r || r.internal || r.parentRunId || liveIds.has(r.runId)) continue;
      const files = [];
      for (const a of Array.isArray(r.artifacts) ? r.artifacts : []) if (a && a.path && files.length < 6) files.push(String(a.path).slice(0, 300));
      if (r.deliverable && r.deliverable.main && files.indexOf(r.deliverable.main) < 0 && files.length < 6) files.push(String(r.deliverable.main).slice(0, 300));
      let said = String(r.deliveryText || (r.deliverable && r.deliverable.summary) || '').replace(/\s+/g, ' ').trim();
      // a conversational reply has no delivery note: its result line is the newest reply in that conversation (only
      // the newest finished run of a conversation is shown against it, so that is this run's own reply)
      if (!said && r.reason === 'done' && r.streamId && !resultOf.has(r.streamId)) {
        resultOf.add(r.streamId);
        const turns = stationTurns(r.streamId, 6);
        for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'assistant') { said = turns[i].content.replace(/\s+/g, ' ').trim(); break; }
      }
      done.push({ runId: r.runId, agentId: r.agentId, state: r.reason === 'done' ? 'done' : r.reason === 'cancelled' || r.reason === 'stopped' ? 'stopped' : 'failed',
        title: clip(String(r.sessionTitle || r.title || '').replace(/\s+/g, ' ').trim(), 140), result: clip(said, 240),
        error: r.reason === 'done' ? '' : clip(r.failureCode || r.reason || '', 80),
        startedAt: r.startedAt || null, endedAt: r.endedAt || null, usd: Number(r.usd) || 0, streamId: r.streamId || '', files });
      if (done.length >= o.limit) break;
    }
    return { at: now(), live, done };
  }

  function liveRemoteRuns() { return Array.from(remoteRuns, ([runId, r]) => ({ runId, agentId: r.agentId, startedAt: r.startedAt, source: 'remote' })); }

  return { status, threads, thread, send, stop, files, fetchFile, routines, setRoutine, view, portrait, sprite, activity, liveRemoteRuns, recentRuns, _remoteRuns: remoteRuns };
}

module.exports = { makeRemoteHost };
