/* node test/crew-cards.test.js — the CREW cards (frontend/app/crewcards.js) show only what the harness proves (sweep 2026-10-02):
   · a run the page never saw END (Stop, E-STOP, a dropped stream) does not haunt the agent's NEXT run with its clock,
     step and gold "needs your OK" frame;
   · the run clock excludes time spent waiting on the Commander (the duration law COMMS keeps with Channels.elapsedOf);
   · a question or approval that was answered, denied or expired clears the frame. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'crewcards.js'), 'utf8');

function load() {
  const L = {};
  const bus = { on: (n, f) => (L[n] = L[n] || []).push(f) };
  const emit = (n, p) => (L[n] || []).forEach(f => f(p));
  let t = 1000000;
  const kids = {};
  const cl = new Set(['working']);
  const el = (c) => ({ className: c, textContent: '', after() {}, appendChild(x) { kids[x.className] = x; }, querySelector() { return null; }, setAttribute() {} });
  const name = el('crew-name'); name.querySelector = () => kids['crew-clock'] || null;
  const status = el('crew-status');
  const row = {
    dataset: { agentId: 'nova' }, _step: null,
    classList: { contains: c => cl.has(c), toggle: (c, on) => (on ? cl.add(c) : cl.delete(c)) },
    querySelector: s => s === '.crew-name' ? name : s === '.crew-status' ? status : s === '.crew-clock' ? kids['crew-clock'] : s === '.crew-step' ? row._step : null
  };
  status.after = x => { row._step = x; };
  let tick = null;
  const ctx = {
    U: { bus },
    Date: { now: () => t },
    document: { readyState: 'complete', querySelectorAll: () => [row], querySelector: () => null, getElementById: () => null,
      createElement: () => ({ className: '', textContent: '', setAttribute() {} }) },
    MutationObserver: class { observe() {} },
    setInterval: (fn) => { tick = fn; return 1; }
  };
  vm.runInNewContext(src, ctx);
  return {
    emit, cl,
    advance(ms) { t += ms; if (tick) tick(); },
    clock: () => (kids['crew-clock'] || {}).textContent,
    step: () => (row._step || {}).textContent,
    asking: () => cl.has('asking')
  };
}

// 1) a stopped run (no agent.run.end ever arrives) does not haunt the next run
{
  const c = load();
  c.emit('agent.run.start', { agentId: 'nova', runId: 'r1' });
  c.emit('permission.prompt', { promptId: 'p1', agentId: 'nova', tool: 'fs.write' });
  c.advance(120000);
  A.ok(c.asking(), 'fixture: the first run is waiting on the Commander');
  c.cl.delete('working'); c.advance(1000); c.advance(9000);   // Stop: the row goes idle, the run never reports its end
  c.advance(3600000);
  c.cl.add('working');
  c.emit('agent.run.start', { agentId: 'nova', runId: 'r2' });
  c.advance(5000);
  A.eq([c.clock(), c.step(), c.asking()], ['0:05', '', false], 'the next run starts its own clock, with no leftover step or "needs your OK"');
}
// 2) the clock excludes the wait on the Commander, then resumes
{
  const c = load();
  c.emit('agent.run.start', { agentId: 'nova', runId: 'r1' });
  c.advance(10000);
  c.emit('permission.prompt', { promptId: 'p1', agentId: 'nova', tool: 'fs.write' });
  c.advance(60000);
  A.eq([c.clock(), c.asking()], ['0:10', true], 'while it waits on you the clock holds');
  c.emit('permission.response', { promptId: 'p1', decision: 'once' });
  c.advance(5000);
  A.eq([c.clock(), c.asking()], ['0:15', false], 'answered: the frame clears and the clock resumes without the wait');
}
// 3) a short idle blip (a fresh start before .working lands) does not drop a live run
{
  const c = load();
  c.emit('agent.run.start', { agentId: 'nova', runId: 'r1' });
  c.cl.delete('working'); c.advance(2000); c.cl.add('working'); c.advance(1000);
  A.eq(c.clock(), '0:03', 'a run is kept through a brief not-working blip (8s grace)');
}

// 4) the page side: every way a question/approval is settled reaches the bus
{
  const chat = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'chat.js'), 'utf8');
  const clar = chat.slice(chat.indexOf('function clarifyRow('), chat.indexOf('function permissionRow('));
  A.ok((clar.match(/U\.bus\.emit\('permission\.response', ?\{ ?promptId: ?p\.promptId, ?decision: ?'once' ?\}\)/g) || []).length === 2,
    'both question paths (buttons and the conversation) announce the answer on the bus');
  const idx = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
  A.ok(/onAutoDeny: \(promptId\) => \{ try \{ emit\('permission\.response', \{ promptId, decision: 'deny', expired: true \}\);/.test(idx),
    'a prompt that expired or lost its run is announced on the run stream');
}

A.report('crew-cards');
