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
     run.text     { runId, text }                 the reply so far (coalesced, at most ~4 per second)
     run.tool     { runId, callId, name, summary } a step the agent took
     run.step     { runId, callId, ok, ms }       how that step went
     run.ended    { runId, agentId, streamId, reason, usd, error }
     approval.opened / approval.closed            from the shared registry
     station      { name, payload }               the station floor's own redacted feed (SSE tee) */
'use strict';

const TEXT_FLUSH_MS = 250;

function makeRemoteHost(d) {
  const now = d.now;
  if (typeof now !== 'function') throw new Error('makeRemoteHost needs an injected clock (deps.now)');
  const remoteRuns = new Map();   // runId -> { ac, agentId, streamId, deviceId, startedAt }
  const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
  const broadcast = (evt) => { try { d.broadcast(evt); } catch (_) {} };

  function agentsList() {
    return d.roster().map(a => ({ agentId: a.agentId, name: a.name || a.agentId, model: a.model || null, provider: a.provider || null }));
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

  async function threads(o) {
    const rows = d.transcript.streams({ limit: 100, previewChars: 140 }) || [];
    const out = [];
    for (const r of rows) {
      let agentId = r.agentId || '';
      if (!agentId) { try { const h = d.transcript.history(r.streamId, { limit: 1 }); agentId = (h[0] && h[0].agentId) || ''; } catch (_) {} }
      if (o.agentId && agentId !== o.agentId) continue;
      out.push({ streamId: r.streamId, agentId, turns: r.turns, lastAt: r.lastAt, preview: r.preview || '' });
      if (out.length >= o.limit) break;
    }
    return out;
  }

  async function thread(o) {
    const rows = d.transcript.history(o.streamId, { limit: o.limit }) || [];
    return rows.map(r => ({ role: r.role, agentId: r.agentId || null, ts: r.ts, content: typeof r.content === 'string' ? clip(r.content, 20000) : clip(JSON.stringify(r.content), 20000) }));
  }

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

    let history = [];
    try { history = d.transcript.reconstruct(streamId, { limit: 100 }) || []; } catch (_) { history = []; }
    const messages = history.concat([{ role: 'user', content: o.text }]);

    // the reply, coalesced: a phone on cellular gets a few frames a second, not one per token
    let buf = '', timer = null, errMsg = null, reason = null, usd = 0;
    const flush = () => { timer = null; broadcast({ type: 'run.text', runId, text: clip(buf, 20000) }); };
    const emit = (name, payload) => {
      const p = payload || {};
      if (name === 'agent.token') { buf += (p.delta || ''); if (!timer) timer = setTimeout(flush, TEXT_FLUSH_MS); }
      else if (name === 'agent.tool_call') { buf = ''; broadcast({ type: 'run.tool', runId, callId: String(p.callId || ''), name: clip(p.name, 80), summary: clip(p.argsSummary, 400) }); }
      else if (name === 'agent.tool_result') broadcast({ type: 'run.step', runId, callId: String(p.callId || ''), ok: !!p.ok && !p.isError, ms: Number(p.ms) || 0 });
      else if (name === 'agent.run.error') errMsg = clip(p.message || 'run error', 400);
      else if (name === 'agent.run.end') { reason = p.reason || null; if (typeof p.usd === 'number' && isFinite(p.usd)) usd = Math.max(usd, p.usd); }
    };
    const prompt = (call, tool) => d.askConsent({ agentId: o.agentId, runId, signal: ac.signal, call, tool, surface: 'remote', onPrompt: () => {} });

    broadcast({ type: 'run.started', runId, agentId: o.agentId, streamId });
    Promise.resolve().then(() => d.runOnce({
      key: cred.key, model: cred.model, provider: cred.provider, baseUrl: cred.baseUrl || '', reasoningEffort: cred.reasoningEffort,
      system: cred.system, messages, agentId: o.agentId, isTask: true,
      emit, signal: ac.signal, runId, streamId, trigger: 'event',
      surface: 'interactive', prompt, ownerTrusted: true, floorless: true, broadcast: true, reflect: true,
      taskKey: 'remote:' + (o.deviceId || 'phone'), taskSource: 'remote'
    })).catch((e) => { errMsg = errMsg || clip((e && e.message) || e, 400); })
      .finally(() => {
        if (timer) { clearTimeout(timer); flush(); }
        remoteRuns.delete(runId);
        broadcast({ type: 'run.ended', runId, agentId: o.agentId, streamId, reason: reason || (ac.signal.aborted ? 'stopped' : (errMsg ? 'error' : 'done')), usd, error: errMsg });
      });
    return { runId, streamId };
  }

  async function stop(o) {
    const r = remoteRuns.get(o.runId);
    if (r) { try { r.ac.abort(); } catch (_) {} return { ok: true }; }
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

  async function fetchFile(o) { return d.readFile(o.agentId, o.path, o.offset, o.length); }

  async function routines() {
    return (d.routines() || []).map(j => ({
      id: j.id, name: j.name || null, agentId: j.agentId || null, enabled: j.enabled !== false, inFlight: !!j.inFlight,
      schedule: j.scheduleDisplay || (j.schedule && (j.schedule.display || j.schedule.kind)) || null,
      nextRunAt: j.nextRunAt || null, lastRunAt: j.lastRunAt || null, lastStatus: j.lastStatus || null,
      prompt: clip(j.prompt, 200)
    }));
  }

  async function setRoutine(o) { return d.setRoutine(o.jobId, o.enabled); }

  function liveRemoteRuns() { return Array.from(remoteRuns, ([runId, r]) => ({ runId, agentId: r.agentId, startedAt: r.startedAt, source: 'remote' })); }

  return { status, threads, thread, send, stop, files, fetchFile, routines, setRoutine, liveRemoteRuns, _remoteRuns: remoteRuns };
}

module.exports = { makeRemoteHost };
