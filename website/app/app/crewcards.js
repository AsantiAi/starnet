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
  const runs = new Map();   // runId → { agentId, startedAt, tool }
  const asks = new Map();   // promptId → agentId

  const toolLabel = (name) => {
    const n = String(name || '').trim();
    const m = /^mcp__(.+?)__(.+)$/.exec(n);
    return (m ? m[1] + '.' + m[2] : n).replace(/[_-]+/g, '.').toLowerCase();
  };
  const fmtClock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0');
  };

  function forAgent(id) {
    let start = 0, tool = '';
    for (const r of runs.values()) {
      if (r.agentId !== id) continue;
      if (!start || r.startedAt < start) start = r.startedAt;
      if (r.tool) tool = r.tool;
    }
    let asking = false;
    for (const a of asks.values()) if (a === id) { asking = true; break; }
    return { start, tool, asking };
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
      const live = row.classList.contains('working');
      const st = live ? forAgent(row.dataset.agentId) : { start: 0, tool: '', asking: false };
      const clock = row.querySelector('.crew-clock'), step = row.querySelector('.crew-step');
      const ct = st.start ? fmtClock(now - st.start) : '';
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
    // review switch for the panel grit candidates (css/grit.css): ?grit=a | b | c
    try { const g = new URLSearchParams(location.search).get('grit'); if (/^[abc]$/.test(g || '')) document.body.classList.add('grit-' + g); } catch (_) {}
    seatSummary();
    if (typeof U !== 'undefined' && U.bus) {
      U.bus.on('agent.run.start', (p) => { if (p && p.runId && p.agentId) runs.set(String(p.runId), { agentId: String(p.agentId), startedAt: Date.now(), tool: '' }); paint(); });
      U.bus.on('agent.tool_call', (p) => { const r = p && runs.get(String(p.runId)); if (r && p.name) { r.tool = String(p.name); paint(); } });
      U.bus.on('agent.tool_result', (p) => { const r = p && runs.get(String(p.runId)); if (r) { r.tool = ''; paint(); } });
      const end = (p) => {
        const r = p && runs.get(String(p.runId));
        if (!r) return;
        runs.delete(String(p.runId));
        // a run that ends with a prompt still open (stopped, failed) can no longer be waiting on you
        if (![...runs.values()].some((x) => x.agentId === r.agentId)) for (const [k, a] of asks) if (a === r.agentId) asks.delete(k);
        paint();
      };
      U.bus.on('agent.run.end', end);
      U.bus.on('agent.run.error', end);
      U.bus.on('permission.prompt', (p) => { if (p && p.promptId && p.agentId) { asks.set(String(p.promptId), String(p.agentId)); paint(); } });
      U.bus.on('permission.response', (p) => { if (p && p.promptId && asks.delete(String(p.promptId))) paint(); });
    }
    const crew = document.getElementById('crew');
    if (crew) new MutationObserver(paint).observe(crew, { childList: true });
    setInterval(paint, 1000);
    paint();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
