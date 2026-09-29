/* StarNet Remote — the phone deck.

   Every number, lamp and label here comes from the station over the sealed channel: status, approvals,
   threads, files, routines and live run events. Nothing is assumed. When the link is down the deck says so and
   shows when it last heard from the station, and it never shows a run as working unless the station said so.
   All station text is rendered with textContent, never as HTML. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
  const S = {
    rec: null, client: null, linkState: 'connecting', lastOkAt: 0, latency: null,
    status: null, approvals: [], threads: [], files: [], routines: [],
    tab: 'crew', thread: null, file: null, target: null,
    live: new Map(),            // runId -> { streamId, agentId, text, steps:[], ended }
    seen: new Set(), retryMs: 1000, retryTimer: null, pingTimer: null, statusTimer: null, arrivedAt: new Map()
  };

  /* ---------- helpers ---------- */
  function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + 's';
    const m = Math.round(s / 60); if (m < 60) return m + 'm';
    const h = Math.round(m / 60); if (h < 48) return h + 'h';
    return Math.round(h / 24) + 'd';
  }
  function clock(ms) { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function agentName(id) { const a = S.status && S.status.agents.find(x => x.agentId === id); return (a && a.name) || id || 'AGENT'; }
  let toastT = null;
  function toast(msg, bad) {
    const t = $('toast'); t.textContent = msg; t.className = bad ? 'bad' : ''; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function b64uDecode(s) { const str = String(s).replace(/-/g, '+').replace(/_/g, '/'); return atob(str + '==='.slice((str.length + 3) % 4)); }

  /* ---------- the link lamp ---------- */
  function paintLamp() {
    const lamp = $('lamp'), label = lamp.querySelector('span');
    lamp.className = 'lamp';
    if (S.linkState === 'open') { lamp.classList.add('ok'); label.textContent = 'LINKED' + (S.latency != null ? ' · ' + S.latency + 'MS' : ''); }
    else if (S.linkState === 'offline') { lamp.classList.add('down'); label.textContent = 'STATION OFFLINE' + (S.lastOkAt ? ' · ' + ago(Date.now() - S.lastOkAt).toUpperCase() : ''); }
    else if (S.linkState === 'removed') { lamp.classList.add('down'); label.textContent = 'NOT PAIRED'; }
    else { lamp.classList.add('busy'); label.textContent = 'CONNECTING'; }
  }

  /* ---------- connection ---------- */
  function connect() {
    clearTimeout(S.retryTimer);
    if (S.client) { try { S.client.close(); } catch (_) {} }
    const r = S.rec;
    const c = PhoneClient.connectRelay({ relay: r.station.relay, stationPub: r.station.stationPub, deviceId: r.station.deviceId, relayToken: r.station.relayToken, key: r.key });
    S.client = c;
    c.onEvent(onEvent);
    c.onStatus((s, detail) => {
      if (c !== S.client) return;
      if (s === 'open') { S.linkState = 'open'; S.retryMs = 1000; }
      else if (s === 'closed') {
        const code = detail && detail.code;
        S.linkState = code === 4401 ? 'removed' : (code === 4404 ? 'offline' : (S.lastOkAt ? 'offline' : 'connecting'));
        S.latency = null;
        if (S.linkState !== 'removed') scheduleReconnect();
      } else S.linkState = 'connecting';
      paintLamp(); render();
    });
    c.open().then(() => { S.lastOkAt = Date.now(); refreshAll(); }).catch(() => {});
  }
  function scheduleReconnect() {
    clearTimeout(S.retryTimer);
    S.retryTimer = setTimeout(connect, S.retryMs);
    S.retryMs = Math.min(S.retryMs * 2, 30000);
  }
  async function call(verb, args) {
    const r = await S.client.call(verb, args);
    S.lastOkAt = Date.now();
    return r;
  }
  async function ping() {
    if (S.linkState !== 'open') return;
    const t = performance.now();
    try { await call('ping'); S.latency = Math.round(performance.now() - t); } catch (_) {}
    paintLamp();
  }

  async function refreshStatus() { try { const r = await call('status'); if (r.ok) S.status = r.data; } catch (_) {} }
  async function refreshApprovals() { try { const r = await call('approvals'); if (r.ok) { S.approvals = r.data; for (const a of S.approvals) if (!S.arrivedAt.has(a.promptId)) S.arrivedAt.set(a.promptId, Date.now()); } } catch (_) {} }
  async function refreshThreads() { try { const r = await call('threads', { limit: 30 }); if (r.ok) S.threads = r.data; } catch (_) {} }
  async function refreshFiles() { try { const r = await call('files', { limit: 40 }); if (r.ok) S.files = r.data; } catch (_) {} }
  async function refreshRoutines() { try { const r = await call('routines'); if (r.ok) S.routines = r.data; } catch (_) {} }
  async function refreshAll() {
    await refreshStatus(); await refreshApprovals();
    if (!S.target && S.status && S.status.agents.length) S.target = S.status.agents[0].agentId;
    render();
    await Promise.all([refreshThreads(), refreshRoutines()]);
    render();
  }

  let statusSoon = null;
  function statusSoonish() { clearTimeout(statusSoon); statusSoon = setTimeout(() => refreshStatus().then(render), 400); }

  function onEvent(e) {
    if (!e || !e.type) return;
    if (e.type === 'approval.opened') {
      if (!S.approvals.some(a => a.promptId === e.approval.promptId)) { S.approvals.push(e.approval); S.arrivedAt.set(e.approval.promptId, Date.now()); }
      try { if (navigator.vibrate) navigator.vibrate(60); } catch (_) {}
      render(); return;
    }
    if (e.type === 'approval.closed') { S.approvals = S.approvals.filter(a => a.promptId !== e.promptId); render(); return; }
    if (e.type === 'run.started') { S.live.set(e.runId, { streamId: e.streamId, agentId: e.agentId, text: '', steps: [], ended: null }); statusSoonish(); render(); return; }
    const L = e.runId && S.live.get(e.runId);
    if (e.type === 'run.text' && L) { L.text = e.text; if (S.thread && S.thread.streamId === L.streamId) renderLive(); return; }
    if (e.type === 'run.tool' && L) { L.steps.push({ callId: e.callId, name: e.name, ok: null }); if (S.thread && S.thread.streamId === L.streamId) renderLive(); return; }
    if (e.type === 'run.step' && L) { const s = L.steps.find(x => x.callId === e.callId && x.ok === null); if (s) s.ok = e.ok; if (S.thread && S.thread.streamId === L.streamId) renderLive(); return; }
    if (e.type === 'run.ended') {
      if (L) L.ended = e;
      statusSoonish();
      if (e.error) toast(agentName(e.agentId) + ': ' + e.error, true);
      if (S.thread && L && S.thread.streamId === L.streamId) openThread(S.thread.streamId, S.thread.agentId, true);
      refreshThreads().then(render);
      return;
    }
    if (e.type === 'station' && (e.name === 'agent.run.start' || e.name === 'agent.run.end')) statusSoonish();
  }

  /* ---------- rendering ---------- */
  function setTab(t) {
    S.tab = t; S.thread = null; S.file = null;
    for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
    if (t === 'threads') refreshThreads().then(render);
    if (t === 'files') refreshFiles().then(render);
    if (t === 'crew') refreshRoutines().then(render);
    render();
  }

  function render() {
    const v = $('view');
    const needs = S.approvals.length;
    $('n-needs').textContent = needs ? '· ' + needs : '';
    $('back').hidden = !(S.thread || S.file);
    $('bar-title').textContent = S.thread ? agentName(S.thread.agentId) : S.file ? (S.file.name || 'FILE') : ((S.status && S.status.station) || 'STATION');
    $('compose').hidden = !(S.tab === 'crew' || S.thread) || S.file != null || S.linkState === 'removed';
    const target = S.thread ? S.thread.agentId : S.target;
    $('compose-to').textContent = target ? 'TO ' + agentName(target).toUpperCase() : '';
    $('compose-send').disabled = S.linkState !== 'open' || !target;
    v.replaceChildren();
    if (S.linkState === 'removed') { v.appendChild(removedCard()); return; }
    if (S.file) return renderFile(v);
    if (S.thread) return renderThread(v);
    if (S.tab === 'crew') return renderCrew(v);
    if (S.tab === 'threads') return renderThreads(v);
    if (S.tab === 'files') return renderFiles(v);
    return renderMore(v);
  }

  function section(title, gold) {
    const s = el('div', 'sect');
    s.appendChild(el('div', 'sect-h' + (gold ? ' gold' : ''), '▮ ' + title));
    const p = el('div', 'panel' + (gold ? ' gold' : ''));
    s.appendChild(p);
    return { s, p };
  }

  function removedCard() {
    const { s, p } = section('This phone was removed', true);
    const box = el('div', 'ask');
    box.appendChild(el('div', 'what', 'The station no longer knows this phone. Pair it again from SETTINGS → DEVICES on your desktop.'));
    const b = el('button', 'btn', 'Pair again'); b.type = 'button';
    b.onclick = async () => { await RemoteStore.forget(); location.reload(); };
    const row = el('div', 'btns'); row.appendChild(b); box.appendChild(row); p.appendChild(box);
    return s;
  }

  function askCard(a) {
    const box = el('div', 'ask');
    const isQ = a.kind === 'question';
    box.appendChild(el('div', 'who', agentName(a.agentId) + (isQ ? ' · QUESTION' : ' · ' + (a.scope || 'write').toUpperCase() + ' CHECK') + (a.surface === 'desk' ? ' · DESK RUN' : a.surface === 'channel' ? ' · CHANNEL' : '')));
    const arrived = S.arrivedAt.get(a.promptId) || Date.now();
    if (isQ) {
      let q = {}; try { q = JSON.parse(a.argsSummary || '{}'); } catch (_) {}
      box.appendChild(el('div', 'what', q.question || 'Your agent has a question.'));
      const opts = el('div', 'btns');
      for (const o of (q.options || []).slice(0, 6)) {
        const b = el('button', 'btn', o); b.type = 'button';
        b.onclick = () => replyQ(a, o, box);
        opts.appendChild(b);
      }
      if (opts.childNodes.length) box.appendChild(opts);
      const ta = el('textarea'); ta.rows = 2; ta.placeholder = 'Or type an answer…'; box.appendChild(ta);
      const row = el('div', 'btns'); const send = el('button', 'btn go', 'Answer'); send.type = 'button';
      send.onclick = () => { if (ta.value.trim()) replyQ(a, ta.value, box); };
      row.appendChild(send); box.appendChild(row);
    } else {
      box.appendChild(el('div', 'what', agentName(a.agentId) + ' wants to use ' + a.tool));
      if (a.argsSummary) box.appendChild(el('pre', null, a.argsSummary));
      const row = el('div', 'btns');
      const mk = (label, cls, decision) => { const b = el('button', 'btn ' + cls, label); b.type = 'button'; b.onclick = () => decide(a, decision, box); row.appendChild(b); };
      mk('Once', 'go', 'once'); mk('This session', '', 'session'); mk('Deny', 'no', 'deny');
      box.appendChild(row);
      box.appendChild(el('div', 'note', 'Arrived ' + clock(Date.now() - arrived) + ' ago. "Always" and full access are set at the desk.'));
    }
    // it is on a screen a person is looking at: earn the one bounded extension, once
    if (document.visibilityState === 'visible' && !S.seen.has(a.promptId)) { S.seen.add(a.promptId); call('seen', { runId: a.runId, promptId: a.promptId }).catch(() => {}); }
    return box;
  }
  async function decide(a, decision, box) {
    for (const b of box.querySelectorAll('button')) b.disabled = true;
    try {
      const r = await call('decide', { runId: a.runId, promptId: a.promptId, decision });
      if (!r.ok) { toast(r.error, true); for (const b of box.querySelectorAll('button')) b.disabled = false; return; }
      S.approvals = S.approvals.filter(x => x.promptId !== a.promptId);
      toast(decision === 'deny' ? 'Denied' : 'Approved');
    } catch (e) { toast(e.message, true); for (const b of box.querySelectorAll('button')) b.disabled = false; return; }
    render();
  }
  async function replyQ(a, text, box) {
    for (const b of box.querySelectorAll('button')) b.disabled = true;
    try {
      const r = await call('reply', { runId: a.runId, promptId: a.promptId, text: String(text) });
      if (!r.ok) { toast(r.error, true); for (const b of box.querySelectorAll('button')) b.disabled = false; return; }
      S.approvals = S.approvals.filter(x => x.promptId !== a.promptId);
      toast('Answered');
    } catch (e) { toast(e.message, true); for (const b of box.querySelectorAll('button')) b.disabled = false; return; }
    render();
  }

  function renderCrew(v) {
    if (S.approvals.length) {
      const { s, p } = section('Needs you · ' + S.approvals.length, true);
      for (const a of S.approvals) p.appendChild(askCard(a));
      v.appendChild(s);
    }
    const { s, p } = section('Crew');
    const agents = (S.status && S.status.agents) || [];
    if (!agents.length) p.appendChild(el('div', 'empty', S.linkState === 'open' ? 'No agents on this station yet.' : 'Waiting for the station…'));
    for (const a of agents) {
      const row = el('button', 'row' + (S.target === a.agentId ? ' sel' : '')); row.type = 'button';
      const well = el('span', 'well', (a.name || a.agentId).slice(0, 1).toUpperCase());
      well.appendChild(el('i', 'dot' + (a.state === 'working' ? ' work' : '')));
      row.appendChild(well);
      const t = el('span', 't');
      t.appendChild(el('b', null, (a.name || a.agentId).toUpperCase()));
      t.appendChild(el('span', null, a.state === 'working' ? 'working' + (a.source === 'interactive' ? ' at the desk' : a.source === 'remote' ? ' on your task' : '') : 'idle' + (a.model ? ' · ' + a.model : '')));
      row.appendChild(t);
      if (a.state === 'working' && a.since) row.appendChild(el('span', 'd', ago(Date.now() - a.since)));
      row.onclick = () => { S.target = a.agentId; const th = S.threads.find(x => x.agentId === a.agentId); if (th) openThread(th.streamId, a.agentId); else render(); };
      p.appendChild(row);
    }
    v.appendChild(s);
    if (S.routines.length) {
      const r = section('Routines');
      for (const j of S.routines) {
        const row = el('div', 'row');
        row.appendChild(el('i', 'dot' + (j.inFlight ? ' work' : j.enabled ? ' ok' : '')));
        const t = el('span', 't');
        t.appendChild(el('b', null, (j.name || j.prompt || j.id).toUpperCase()));
        t.appendChild(el('span', null, (j.enabled ? (j.schedule || 'scheduled') : 'paused') + (j.agentId ? ' · ' + agentName(j.agentId) : '')));
        row.appendChild(t);
        const b = el('button', 'btn', j.enabled ? 'Pause' : 'Resume'); b.type = 'button';
        b.onclick = async (ev) => {
          ev.stopPropagation(); b.disabled = true;
          try { const res = await call('routine', { jobId: j.id, enabled: !j.enabled }); if (!res.ok) toast(res.error, true); else toast(res.data.enabled ? 'Resumed' : 'Paused'); } catch (e) { toast(e.message, true); }
          await refreshRoutines(); render();
        };
        row.appendChild(b);
        r.p.appendChild(row);
      }
      v.appendChild(r.s);
    }
  }

  function renderThreads(v) {
    const { s, p } = section('Conversations');
    if (!S.threads.length) p.appendChild(el('div', 'empty', 'No conversations yet. Send a task from CREW.'));
    for (const t of S.threads) {
      const row = el('button', 'row'); row.type = 'button';
      row.appendChild(el('span', 'well', (agentName(t.agentId) || '?').slice(0, 1).toUpperCase()));
      const tt = el('span', 't'); tt.appendChild(el('b', null, agentName(t.agentId).toUpperCase())); tt.appendChild(el('span', null, t.preview || '(no preview)'));
      row.appendChild(tt);
      row.appendChild(el('span', 'd', t.lastAt ? ago(Date.now() - t.lastAt) : ''));
      row.onclick = () => openThread(t.streamId, t.agentId);
      p.appendChild(row);
    }
    v.appendChild(s);
  }

  async function openThread(streamId, agentId, keepScroll) {
    S.thread = { streamId, agentId, turns: S.thread && S.thread.streamId === streamId ? S.thread.turns : null };
    S.target = agentId;
    render();
    try { const r = await call('thread', { streamId, limit: 80 }); if (r.ok && S.thread && S.thread.streamId === streamId) S.thread.turns = r.data; } catch (e) { toast(e.message, true); }
    render();
    if (!keepScroll) { const v = $('view'); v.scrollTop = v.scrollHeight; }
  }

  function renderThread(v) {
    const log = el('div', 'log');
    const turns = S.thread.turns;
    if (!turns) log.appendChild(el('div', 'empty', 'Loading…'));
    else for (const t of turns) {
      if (t.role !== 'user' && t.role !== 'assistant') continue;
      if (!t.content || t.content === 'null') continue;
      const m = el('div', 'msg ' + (t.role === 'user' ? 'user' : 'agent'));
      m.appendChild(el('span', 'who', t.role === 'user' ? 'YOU' : agentName(t.agentId || S.thread.agentId).toUpperCase()));
      m.appendChild(el('div', 'body', t.content));
      log.appendChild(m);
    }
    const mine = S.approvals.filter(a => [...S.live.entries()].some(([rid, L]) => rid === a.runId && L.streamId === S.thread.streamId));
    for (const a of mine) log.appendChild(askCard(a));
    const liveBox = el('div', 'log'); liveBox.id = 'live'; log.appendChild(liveBox);
    v.appendChild(log);
    renderLive();
  }

  function renderLive() {
    const box = $('live'); if (!box || !S.thread) return;
    box.replaceChildren();
    for (const [, L] of S.live) {
      if (L.streamId !== S.thread.streamId || L.ended) continue;
      for (const s of L.steps.slice(-6)) {
        const d = el('div', 'step'); const mark = el('b', s.ok === false ? 'x' : null, s.ok === null ? '…' : s.ok ? '✓' : '✕');
        d.appendChild(mark); d.appendChild(document.createTextNode(' ' + s.name)); box.appendChild(d);
      }
      if (L.text) { const m = el('div', 'msg agent'); m.appendChild(el('span', 'who', agentName(L.agentId).toUpperCase())); m.appendChild(el('div', 'body', L.text)); box.appendChild(m); }
      else box.appendChild(el('div', 'live', agentName(L.agentId).toUpperCase() + ' is working…'));
      const stop = el('button', 'btn no', 'Stop'); stop.type = 'button';
      const runId = [...S.live.entries()].find(([, x]) => x === L)[0];
      stop.onclick = async () => { stop.disabled = true; try { const r = await call('stop', { runId }); toast(r.ok ? 'Stopped' : r.error, !r.ok); } catch (e) { toast(e.message, true); } };
      const row = el('div', 'btns'); row.appendChild(stop); box.appendChild(row);
    }
  }

  function renderFiles(v) {
    const { s, p } = section('Delivered');
    if (!S.files.length) p.appendChild(el('div', 'empty', 'Nothing delivered yet.'));
    for (const d of S.files) {
      for (const f of (d.files || []).slice(0, 4)) {
        const row = el('button', 'row file'); row.type = 'button';
        const ext = (f.path.split('.').pop() || '').slice(0, 4).toUpperCase();
        row.appendChild(el('span', 'well', ext));
        const t = el('span', 't'); t.appendChild(el('b', null, f.path.split('/').pop())); t.appendChild(el('span', null, (d.title || '') + (d.agentId ? ' · ' + agentName(d.agentId) : '')));
        row.appendChild(t);
        row.appendChild(el('span', 'd', d.createdAt ? ago(Date.now() - d.createdAt) : ''));
        row.onclick = () => openFile(d.agentId, f.path);
        p.appendChild(row);
      }
    }
    v.appendChild(s);
  }

  async function openFile(agentId, filePath) {
    S.file = { agentId, path: filePath, name: filePath.split('/').pop(), loading: true };
    render();
    const parts = []; let meta = null, offset = 0;
    try {
      for (let i = 0; i < 80; i++) {   // 80 × 256 KB = 20 MB ceiling on a phone
        const r = await call('fetch', { agentId, path: filePath, offset });
        if (!r.ok) throw new Error(r.error);
        meta = r.data; const bin = atob(meta.data); const u8 = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
        parts.push(u8); offset += meta.bytes;
        if (meta.eof || !meta.bytes) break;
      }
      if (!S.file || S.file.path !== filePath) return;
      S.file = Object.assign(S.file, { loading: false, mime: meta.mime, active: meta.active, blob: new Blob(parts, { type: meta.active ? 'application/octet-stream' : meta.mime }), size: meta.size, name: meta.name || S.file.name });
    } catch (e) { S.file.loading = false; S.file.error = e.message; }
    render();
  }

  function renderFile(v) {
    const f = S.file, box = el('div', 'viewer');
    if (f.loading) { box.appendChild(el('div', 'empty', 'Fetching ' + f.name + '…')); v.appendChild(box); return; }
    if (f.error) { box.appendChild(el('div', 'err-line', f.error)); v.appendChild(box); return; }
    const url = URL.createObjectURL(f.blob);
    if (!f.active && /^image\//.test(f.mime)) { const img = el('img'); img.src = url; img.alt = f.name; box.appendChild(img); }
    else if (!f.active && /^(text\/|application\/json)/.test(f.mime)) { const pre = el('pre'); f.blob.text().then(t => { pre.textContent = t.slice(0, 200000); }); box.appendChild(pre); }
    else box.appendChild(el('div', 'empty', f.active ? 'This file can run code, so it is not opened here. Save it and open it yourself if you trust it.' : 'No preview for this type.'));
    const a = el('a', 'btn', 'Save to phone'); a.href = url; a.download = f.name; a.style.textAlign = 'center'; a.style.textDecoration = 'none';
    const row = el('div', 'btns'); row.appendChild(a); box.appendChild(row);
    box.appendChild(el('div', 'hint', Math.round(f.size / 1024) + ' KB · ' + f.mime));
    v.appendChild(box);
  }

  function renderMore(v) {
    const { s, p } = section('This phone');
    const r = S.rec && S.rec.station;
    const lines = [
      ['Station', (S.status && S.status.station) || (r && r.stationId) || '—'],
      ['Phone name', (r && r.name) || '—'],
      ['Phone code', (r && r.fingerprint) || '—'],
      ['Relay', (r && r.relay) || '—'],
      ['Link', S.linkState === 'open' ? 'linked' + (S.latency != null ? ', ' + S.latency + ' ms' : '') : S.linkState]
    ];
    for (const [k, val] of lines) { const row = el('div', 'row'); const t = el('span', 't'); t.appendChild(el('span', null, k)); t.appendChild(el('b', null, val)); row.appendChild(t); p.appendChild(row); }
    const box = el('div', 'ask'); box.style.borderColor = 'var(--gd-edge)';
    box.appendChild(el('div', 'what', 'Forget this station on this phone. You can pair again from the desk.'));
    const b = el('button', 'btn no', 'Forget station'); b.type = 'button';
    let armed = false;
    b.onclick = async () => {
      if (!armed) { armed = true; b.textContent = 'Tap again to forget'; setTimeout(() => { armed = false; b.textContent = 'Forget station'; }, 4000); return; }
      try { S.client && S.client.close(); } catch (_) {}
      await RemoteStore.forget(); location.replace(location.pathname);
    };
    const row = el('div', 'btns'); row.appendChild(b); box.appendChild(row); p.appendChild(box);
    v.appendChild(s);
  }

  /* ---------- composer ---------- */
  async function send() {
    const ta = $('compose-text'); const text = ta.value.trim();
    const agentId = S.thread ? S.thread.agentId : S.target;
    if (!text || !agentId) return;
    $('compose-send').disabled = true;
    try {
      const r = await call('send', { agentId, text, streamId: S.thread ? S.thread.streamId : undefined });
      if (!r.ok) { toast(r.error, true); return; }
      ta.value = ''; autosize();
      S.live.set(r.data.runId, S.live.get(r.data.runId) || { streamId: r.data.streamId, agentId, text: '', steps: [], ended: null });
      await openThread(r.data.streamId, agentId);
    } catch (e) { toast(e.message, true); }
    finally { $('compose-send').disabled = S.linkState !== 'open'; }
  }
  function autosize() { const ta = $('compose-text'); ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; }

  /* ---------- pairing ---------- */
  function showSetup(pairing) { $('setup').hidden = false; $('setup-pairing').hidden = !pairing; $('setup-howto').hidden = !!pairing; for (const id of ['bar', 'view', 'compose', 'tabs']) $(id).hidden = true; }
  function showDeck() { $('setup').hidden = true; for (const id of ['bar', 'view', 'tabs']) $(id).hidden = false; }

  async function pairFrom(blob) {
    let p; try { p = JSON.parse(b64uDecode(blob)); } catch (_) { throw new Error('That pairing link is damaged. Make a new one on the desktop.'); }
    if (!p || p.v !== PhoneClient.VERSION || !p.s || !p.p || !p.c) throw new Error('That pairing link is from a different version of StarNet.');
    const relay = p.r || location.origin;
    showSetup(true);
    $('setup-fp').textContent = await PhoneClient.fingerprint(p.s);
    const key = await PhoneClient.makeDeviceKey();
    const name = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'Phone';
    const res = await PhoneClient.pairRelay({ relay, stationPub: p.s, pairingId: p.p, code: p.c, name, key });
    const rec = { key, station: { stationId: res.stationId || p.i, stationPub: p.s, deviceId: res.deviceId, relayToken: res.relayToken, relay, name, fingerprint: res.fingerprint, pairedAt: Date.now() } };
    await RemoteStore.save(rec);
    return rec;
  }

  async function boot() {
    const m = /[#&]pair=([A-Za-z0-9_-]+)/.exec(location.hash || '');
    if (m) {
      history.replaceState(null, '', location.pathname);   // the one-time code leaves the address bar at once
      try { S.rec = await pairFrom(m[1]); toast('Paired'); }
      catch (e) { showSetup(true); $('setup-err').textContent = e.message; $('setup-err').hidden = false; $('setup-retry').hidden = false; return; }
    } else {
      try { S.rec = await RemoteStore.load(); } catch (_) { S.rec = null; }
    }
    if (!S.rec) return showSetup(false);
    showDeck(); paintLamp(); render(); connect();
    S.pingTimer = setInterval(ping, 20000);
    S.statusTimer = setInterval(() => { if (S.linkState === 'open' && document.visibilityState === 'visible') refreshStatus().then(render); paintLamp(); }, 10000);
  }

  $('setup-go').onclick = () => { const v = $('setup-link').value.trim(); const m = /#pair=([A-Za-z0-9_-]+)/.exec(v); if (!m) { toast('Paste the whole pairing link from the desktop', true); return; } location.hash = 'pair=' + m[1]; location.reload(); };
  $('setup-retry').onclick = () => location.replace(location.pathname);
  $('compose-send').onclick = send;
  $('compose-text').addEventListener('input', autosize);
  $('compose-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); send(); } });
  $('back').onclick = () => { S.thread = null; S.file = null; render(); };
  for (const b of document.querySelectorAll('.tab')) b.onclick = () => setTab(b.dataset.tab);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.rec) { if (S.linkState !== 'open') connect(); else refreshAll(); } });

  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!window.isSecureContext || !(window.crypto && crypto.subtle)) {
    showSetup(false);
    $('setup-howto').replaceChildren(el('p', 'err-line', 'This page must be opened over HTTPS. Open the pairing link your desktop shows.'));
    return;
  }
  boot();
})();
