/* CREW CARDS — the CREW rail rows as agent cards (css/crew-glass.css): a housed lamp in the portrait well,
   a run clock beside the name while the agent works, the live step beside its status, and a gold frame
   while it waits on your OK. stationui.js still owns the rows and their WORKING / IDLE / IN CONVERSATION
   label (crewTick, locked by test/state-truth-overlap.test.js); this module only adds what it can prove:
     · clock  = the oldest run of that agent this page saw START (agent.run.start). A run already under way
                when the page loaded has no known start, so it shows no clock rather than a guessed one.
     · step   = the tool that run is in right now (agent.tool_call → agent.tool_result clears it).
     · asking = a permission.prompt for that agent with no permission.response yet. The card says only
                "needs your OK"; what is being asked stays in the session (the locked crew decision).
   Everything is gated on the row's own .working class, so a card never claims more than crewTick does. */
(() => {
  'use strict';
  const runs = new Map();   // runId → { agentId, startedAt, tool, pausedMs }
  const asks = new Map();   // promptId → { agentId, at }
  /* A run the page saw start but never saw END (Stop, E-STOP, a dropped stream: agent.run.end never reaches the bus)
     used to stay here forever — the agent's NEXT run showed the old run's clock, step and gold "needs your OK" frame
     (sweep 2026-10-02). crewTick's .working is the truth; once a row has been not-working for a short grace (the same
     8s agentLive allows a fresh start to land), that agent's leftover runs and asks are dropped. */
  const IDLE_GRACE_MS = 8000;
  const idleSince = new Map();   // agentId → when its row was first seen not working

  const toolLabel = (name) => {
    const n = String(name || '').trim();
    const m = /^mcp__(.+?)__(.+)$/.exec(n);
    return (m ? m[1] + '.' + m[2] : n).replace(/[_-]+/g, '.').toLowerCase();
  };
  const fmtClock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0');
  };

  /* THE CLOCK EXCLUDES WAITS ON YOU (the duration law COMMS keeps with Channels.elapsedOf): time a run spent with an
     open prompt is subtracted — closed waits from pausedMs, an open one up to now — so the card and COMMS agree. */
  function forAgent(id, now) {
    let oldest = null, tool = '';
    for (const r of runs.values()) {
      if (r.agentId !== id) continue;
      if (!oldest || r.startedAt < oldest.startedAt) oldest = r;
      if (r.tool) tool = r.tool;
    }
    let asking = false, openFrom = 0;
    for (const a of asks.values()) if (a.agentId === id) { asking = true; if (!openFrom || a.at < openFrom) openFrom = a.at; }
    let elapsed = 0;
    if (oldest) elapsed = Math.max(0, now - oldest.startedAt - (oldest.pausedMs || 0) - (openFrom ? Math.max(0, now - Math.max(openFrom, oldest.startedAt)) : 0));
    return { start: oldest ? oldest.startedAt : 0, elapsed, tool, asking };
  }
  // a wait on you closed (answered, denied, or its run ended): its span stops counting toward every run it paused
  function closeAsk(promptId, now) {
    const a = asks.get(promptId);
    if (!a) return false;
    asks.delete(promptId);
    for (const r of runs.values()) if (r.agentId === a.agentId) r.pausedMs = (r.pausedMs || 0) + Math.max(0, now - Math.max(a.at, r.startedAt));
    return true;
  }
  function dropAgent(id) {
    for (const [k, r] of runs) if (r.agentId === id) runs.delete(k);
    for (const [k, a] of asks) if (a.agentId === id) asks.delete(k);
  }

  function dress(row) {
    const portrait = row.querySelector('.crew-portrait'), dot = row.querySelector(':scope > .dot');
    if (portrait && dot) portrait.appendChild(dot);   // the lamp lives in the well's corner
    const name = row.querySelector('.crew-name');
    if (name && !name.querySelector('.crew-clock')) {
      const c = document.createElement('span'); c.className = 'crew-clock'; c.setAttribute('aria-hidden', 'true'); name.appendChild(c);
    }
    const status = row.querySelector('.crew-status');
    if (status && !row.querySelector('.crew-step')) {
      const s = document.createElement('span'); s.className = 'crew-step'; status.after(s);
    }
  }

  function paint() {
    const now = Date.now();
    document.querySelectorAll('#crew .crew-row[data-agent-id]').forEach((row) => {
      dress(row);
      const live = row.classList.contains('working'), id = row.dataset.agentId;
      if (live) idleSince.delete(id);
      else if (!idleSince.has(id)) idleSince.set(id, now);
      else if (now - idleSince.get(id) >= IDLE_GRACE_MS) dropAgent(id);
      const st = live ? forAgent(id, now) : { start: 0, elapsed: 0, tool: '', asking: false };
      const clock = row.querySelector('.crew-clock'), step = row.querySelector('.crew-step');
      const ct = st.start ? fmtClock(st.elapsed) : '';
      if (clock && clock.textContent !== ct) clock.textContent = ct;
      row.classList.toggle('has-clock', !!ct);
      row.classList.toggle('asking', st.asking);
      const sx = st.asking ? 'needs your OK' : st.tool ? toolLabel(st.tool) : '';
      if (step && step.textContent !== sx) step.textContent = sx;
    });
  }

  // the roster total moves up under the CREW title: "2 WORKING · 1 IDLE" (the same element, its writer unchanged)
  function seatSummary() {
    const h3 = document.querySelector('#left > h3'), sum = document.getElementById('crew-sum');
    if (!h3) return;
    if (sum && sum.parentElement !== h3) h3.appendChild(sum);
  }

  function wire() {
    seatSummary();
    if (typeof U !== 'undefined' && U.bus) {
      U.bus.on('agent.run.start', (p) => { if (p && p.runId && p.agentId) { idleSince.delete(String(p.agentId)); runs.set(String(p.runId), { agentId: String(p.agentId), startedAt: Date.now(), tool: '', pausedMs: 0 }); } paint(); });
      U.bus.on('agent.tool_call', (p) => { const r = p && runs.get(String(p.runId)); if (r && p.name) { r.tool = String(p.name); paint(); } });
      U.bus.on('agent.tool_result', (p) => { const r = p && runs.get(String(p.runId)); if (r) { r.tool = ''; paint(); } });
      const end = (p) => {
        const r = p && runs.get(String(p.runId));
        if (!r) return;
        runs.delete(String(p.runId));
        // a run that ends with a prompt still open (stopped, failed) can no longer be waiting on you
        if (![...runs.values()].some((x) => x.agentId === r.agentId)) for (const [k, a] of asks) if (a.agentId === r.agentId) asks.delete(k);
        paint();
      };
      U.bus.on('agent.run.end', end);
      U.bus.on('agent.run.error', end);
      U.bus.on('permission.prompt', (p) => { if (p && p.promptId && p.agentId && !asks.has(String(p.promptId))) { asks.set(String(p.promptId), { agentId: String(p.agentId), at: Date.now() }); paint(); } });
      U.bus.on('permission.response', (p) => { if (p && p.promptId && closeAsk(String(p.promptId), Date.now())) paint(); });
    }
    const crew = document.getElementById('crew');
    if (crew) new MutationObserver(paint).observe(crew, { childList: true });
    setInterval(paint, 1000);
    paint();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
