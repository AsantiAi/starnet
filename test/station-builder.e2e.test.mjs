/* node test/station-builder.e2e.test.mjs — THE AGENT STATION BUILDER end to end, in real Chromium (2026-09-29).

   A MOCK lead model calls station_plan_line (a line from the fixed menu) → the REAL sidecar tool → the REAL station bridge →
   the REAL page (StationBuilder.plan on a copy of the live WorldModel) → the plan comes back; the model then calls
   station_build with that planId → StationBuilder.apply in ONE transact. It holds the build to its promises: the
   floor has exactly the planned room + line, the Workflow panel reads it the way the tool did, Build mode open refuses,
   and one UNDO removes all of it. Then the same for a furnished room kit (station_plan_room) and a restyle
   (station_plan_restyle): the room holds exactly the kit's furniture, the restyle changes only the floor, one UNDO each. Isolated like station-layout.e2e (APPDATA / LOCALAPPDATA / USERPROFILE / HOME /
   HERMES_HOME to scratch, a fresh Chrome profile, OS-picked ports, a local mock model). Skips LOUDLY with no Chromium. */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { findChrome, connectCDP, evalJS, collectDiagnostics, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';
const require = createRequire(import.meta.url);
const { bootToken } = require('./_httpToken.js');

let chromePath = null;
try { chromePath = findChrome(); } catch (_) { chromePath = null; }
if (!chromePath) { console.log('station-builder.e2e: SKIPPED — no Chromium installed (this box cannot run the live bridge)'); process.exit(0); }

const failures = [];
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '')); if (!ok) failures.push(name); };
const freePort = () => new Promise((resolve, reject) => {
  const server = createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const a = server.address(); server.close(e => e ? reject(e) : resolve(a.port)); });
});
const stopChild = (child, graceful = false) => new Promise(resolve => {
  if (!child || child.exitCode != null) { resolve(); return; }
  let killTimer;
  const timer = setTimeout(resolve, 6000);
  child.once('exit', () => { clearTimeout(timer); clearTimeout(killTimer); resolve(); });
  const kill = () => {
    try {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { try { child.kill('SIGKILL'); } catch {} });
      } else child.kill('SIGKILL');
    } catch (_) { clearTimeout(timer); resolve(); }
  };
  if (graceful) killTimer = setTimeout(kill, 3000); else kill();
});

// the mock model: a lead that PLANS (mock.planTool with mock.planArgs), then BUILDS the planId it was given, then answers.
// A refusal (no planId in the tool result) ends the run in words — the way a real model reads REFUSED.
function startMock() {
  const mock = { requests: [], results: [], planTool: 'station_plan_line', planArgs: {} };
  const server = http.createServer((req, res) => {
    if (req.url.indexOf('/models') >= 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 64000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
    }
    if (req.url.indexOf('/chat/completions') < 0) { res.writeHead(404); return res.end(); }
    let body = ''; req.on('data', d => { body += d; }); req.on('end', () => {
      let p = {}; try { p = JSON.parse(body); } catch (_) {}
      mock.requests.push(p);
      const offered = (p.tools || []).some(t => t && t.function && t.function.name === 'station_plan_line');
      const answered = (p.messages || []).filter(m => m && m.role === 'tool').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const send = o => res.write('data: ' + JSON.stringify(o) + '\n\n');
      const call = (name, args) => {
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + name + '_' + mock.requests.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
        send({ choices: [{ finish_reason: 'tool_calls', delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } });
      };
      const say = text => {
        send({ choices: [{ delta: { content: text } }] });
        send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } });
      };
      if (offered && !answered.length) call(mock.planTool, mock.planArgs);
      else if (offered && answered.length === 1) {
        mock.results.push(answered[0]);
        let planId = null; try { planId = JSON.parse(answered[0]).planId; } catch (_) { planId = null; }
        if (planId) call('station_build', { planId }); else say('I could not plan that.');
      } else { for (const t of answered.slice(1)) mock.results.push(t); say('Done.'); }
      res.write('data: [DONE]\n\n'); res.end();
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => { mock.server = server; mock.base = 'http://127.0.0.1:' + server.address().port + '/api/v1'; r(mock); }));
}
async function leadRun(base, token, prompt) {
  const res = await fetch(base + '/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-StarNet-Token': token, Origin: base },
    body: JSON.stringify({ key: 'sk-or-v1-fake', model: 'test/model', agentId: 'agent', isTask: true, messages: [{ role: 'user', content: prompt }] }) });
  const text = await res.text();
  return { status: res.status, events: text.split('\n').map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean) };
}

const root = mkdtempSync(join(tmpdir(), 'starnet-builder-e2e-'));
const iso = {};
for (const [k, d] of [['APPDATA', 'appdata'], ['LOCALAPPDATA', 'localappdata'], ['USERPROFILE', 'home'], ['HOME', 'home'], ['HERMES_HOME', 'hermes']]) { iso[k] = join(root, 'iso', d); mkdirSync(iso[k], { recursive: true }); }
const workspace = join(root, 'workspace'), profile = join(root, 'profile');
const mock = await startMock();
const appPort = await freePort(), cdpPort = await freePort();
const base = 'http://127.0.0.1:' + appPort;
materializeSeedWorkspace(workspace, 'test/model');
const sidecar = bootSeededSidecar({ port: appPort, scratchDir: workspace, model: 'test/model', key: 'sk-or-v1-fake', env: Object.assign({ SKYNET_OPENROUTER_BASE: mock.base }, iso) });
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--hide-scrollbars', '--mute-audio',
  '--remote-debugging-port=' + cdpPort, '--window-size=1440,900', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });

let cdp = null;
try {
  check('isolated seeded sidecar starts', await waitUp(base + '/'));
  const token = await bootToken(base, base);
  cdp = await connectCDP(cdpPort);
  cdp.timeoutMs = 45000;
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const diagnostics = collectDiagnostics(cdp);
  // a throttled frame pump: the world still recompiles + posts, without a software canvas starving every evaluate
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 60); window.cancelAnimationFrame = id => clearTimeout(id);' });
  await cdp.send('Page.navigate', { url: base + '/' });
  check('the real page reaches the live floor', await waitDevReady(cdp, evalJS, { url: base + '/', tries: 60 }));


  const before = await evalJS(cdp, `(() => { const st = App.station(); return { rooms: st.rooms().filter(r => r.kind !== 'corridor').map(r => r.name), hero: App.heroId() }; })()`);
  // the page must be LISTENING on the bridge before a tool asks it anything (the SSE opens after the floor paints)
  let link = null;
  for (let i = 0; i < 60; i++) { link = await evalJS(cdp, "World._dbgLinkState()"); if (link && link.readyState === 1 && link.lastEventMsAgo != null) break; await sleep(500); }
  check("the page is listening on the station bridge", !!link && link.readyState === 1 && link.lastEventMsAgo != null, JSON.stringify(link));
  let sync = null;
  for (let i = 0; i < 40; i++) { sync = await evalJS(cdp, 'World.planStatus()'); if (sync && !sync.pending && !sync.inflight && !sync.stale) break; await sleep(500); }

  // 1. the lead plans a line from the fixed menu, then builds exactly that plan (full access: no approval card here)
  mock.planArgs = { line: 'Build + test', name: 'SHIP IT', steps: [{ step: 1, agent: 'lead' }, { step: 2, agent: 'lead' }], dailyCap: 5 };
  const run1 = await leadRun(base, token, 'make me a new room with a line that builds features and tests them');
  const end1 = run1.events.filter(e => e.name === 'agent.run.end').pop();
  check('the lead run completes', run1.status === 200 && !!end1 && end1.payload.reason === 'done', JSON.stringify(end1 && end1.payload && end1.payload.reason));
  const leadReq = mock.requests.find(r => JSON.stringify(r.messages || []).indexOf('builds features and tests them') >= 0) || {};
  const offeredNames = JSON.stringify(leadReq.tools || []);
  check('the lead is offered the planners and station_build', ['station_plan_line', 'station_plan_room', 'station_plan_restyle', 'station_build'].every(n => offeredNames.indexOf('"' + n + '"') >= 0));
  let PL = null; try { PL = JSON.parse(mock.results[0] || ''); } catch (_) { PL = null; }
  check('the plan came back from a copy of the station: nothing built yet', !!PL && /^plan-/.test(PL.planId) && /Nothing has been built yet/.test(PL.next), (mock.results[0] || '').slice(0, 200));
  check('the plan speaks plainly and says it will be ready', !!PL && /^Build \+ test \("SHIP IT"\) in a new room beside HOME: Engineer \(.+\) → Tester \(.+\) → Outbox · daily cap \$5 · up to 3 review tries\. It will be ready to run\.$/.test(PL.summary) && PL.ready === true, PL && PL.summary);
  let BL = null; try { BL = JSON.parse(mock.results[1] || ''); } catch (_) { BL = null; }
  check('the build answered: built, ready to run, and how to undo it', !!BL && BL.built === true && BL.ready === true && /one UNDO/.test(BL.undo), (mock.results[1] || '').slice(0, 200));

  // 2. the floor really has it — named, capped, staffed by the lead — and nothing else moved
  const floor = await evalJS(cdp, `(() => { const st = App.station(), hero = App.heroId();
    const ip = st.props().find(p => p.t === 'intake' && p.label === 'SHIP IT');
    const bays = st.props().filter(p => p.t === 'bay');
    return { rooms: st.rooms().filter(r => r.kind !== 'corridor').map(r => r.name), intake: ip && ip.id, cap: ip && ip.limits && ip.limits.maxUsdPerDay,
      bays: bays.map(b => [b.role, b.agentId === hero, (b.brief || '').slice(0, 20)]), loop: (st.props().find(p => p.t === 'loop') || {}).maxIter }; })()`);
  check('a new room named for the line, beside the station', floor.rooms.length === before.rooms.length + 1 && floor.rooms.includes('SHIP IT'), JSON.stringify(floor.rooms));
  check('the Inbox is named and carries the $5 daily cap', !!floor.intake && floor.cap === 5, JSON.stringify(floor));
  check('both steps are staffed by the lead with their standard instructions', floor.bays.length === 2 && floor.bays.every(b => b[1] && b[2].length > 5) && floor.loop === 3, JSON.stringify(floor.bays));

  // 3. parity: the Workflow panel on that line says what the tool said
  await evalJS(cdp, `(() => { Build.openAssign(${JSON.stringify(floor.intake)}); return true; })()`);
  let panel = null;
  for (let i = 0; i < 30; i++) {
    panel = await evalJS(cdp, `(() => { try { WorkflowPanel.refresh && WorkflowPanel.refresh(); } catch (e) {}
      const p = document.getElementById('wf-pill'); return { open: WorkflowPanel.isOpen(), pill: p && p.textContent }; })()`);
    if (panel && panel.open && panel.pill === 'READY TO RUN') break;   // the first paint lands before Build mode has compiled the line
    await sleep(500);
  }
  check('the Workflow panel agrees: READY TO RUN', !!panel && panel.pill === 'READY TO RUN', JSON.stringify(panel));

  // 4. Build mode open: the Commander owns the floor, so the builder refuses (and the model is told why)
  const run2 = await leadRun(base, token, 'add another build and test line');
  check('a second run completes', run2.status === 200);
  check('with Build mode open, planning is refused in plain words', /^REFUSED: Build mode is open, so the Commander is editing the floor/.test(mock.results[2] || ''), (mock.results[2] || '').slice(0, 160));

  // 5. one UNDO removes the room, the line and every setting
  const undone = await evalJS(cdp, `(() => { const st = App.station(); const r = st.undo(); return { ok: r && r.ok, rooms: st.rooms().filter(r => r.kind !== 'corridor').map(r => r.name), line: !!st.props().find(p => p.t === 'intake' && p.label === 'SHIP IT') }; })()`);
  check('one UNDO removes all of it', undone.ok && JSON.stringify(undone.rooms) === JSON.stringify(before.rooms) && !undone.line, JSON.stringify(undone));
  await evalJS(cdp, `(() => { if (WorkflowPanel.isOpen()) WorkflowPanel.close(); Build.close(); return true; })()`);

  // 6. a furnished room kit: the lead picks LOUNGE from the menu, StarNet places every piece
  const kit = await evalJS(cdp, `(() => { const k = StationTemplates.kits().find(x => x.id === 'cozyLounge'); return { name: k.name, n: k.props.length, types: k.props.map(p => p[0]).sort() }; })()`);
  mock.planTool = 'station_plan_room'; mock.planArgs = { kit: kit.name };
  let at = mock.results.length;
  const run3 = await leadRun(base, token, 'add a lounge');
  check('the room run completes', run3.status === 200);
  let RP = null, RB = null; try { RP = JSON.parse(mock.results[at] || ''); RB = JSON.parse(mock.results[at + 1] || ''); } catch (_) {}
  check('the room plan speaks plainly', !!RP && RP.summary.indexOf(kit.name + ' (') === 0 && / in a new room beside HOME/.test(RP.summary) && /Nothing has been built yet/.test(RP.next), (mock.results[at] || '').slice(0, 240));
  check('the room build answered with the room and how to undo it', !!RB && RB.ok !== false && (RB.rooms || []).some(r => r.name === kit.name) && /one UNDO/.test(RB.undo || ''), (mock.results[at + 1] || '').slice(0, 240));
  const lib = await evalJS(cdp, `(() => { const st = App.station(), r = st.rooms().find(x => x.name === ${JSON.stringify(kit.name)}); if (!r) return null;
    return { types: st.props().filter(p => st.roomAt(p.x, p.y) === r.id).map(p => p.t).sort(), style: r.floorStyle }; })()`);
  check('the new room holds exactly the kit\'s furniture', !!lib && JSON.stringify(lib.types) === JSON.stringify(kit.types), JSON.stringify(lib));

  // 7. a restyle: only the floor changes
  mock.planTool = 'station_plan_restyle'; mock.planArgs = { room: kit.name, floorStyle: 'teal', floorMat: 'tile' };
  at = mock.results.length;
  const propsBefore = await evalJS(cdp, 'JSON.stringify(App.station().serialize().props)');
  const run4 = await leadRun(base, token, 'make the lounge floor teal tile');
  check('the restyle run completes', run4.status === 200);
  let SP = null; try { SP = JSON.parse(mock.results[at] || ''); } catch (_) {}
  check('the restyle plan says nothing is added, moved or removed', !!SP && /Nothing is added, moved or removed\.$/.test(SP.summary), (mock.results[at] || '').slice(0, 200));
  const styled = await evalJS(cdp, `(() => { const st = App.station(), r = st.rooms().find(x => x.name === ${JSON.stringify(kit.name)}); return { style: r && r.floorStyle, mat: r && r.floorMat, same: JSON.stringify(st.serialize().props) === ${JSON.stringify(propsBefore)} }; })()`);
  check('the room is restyled and no prop changed', styled.style === 'teal' && styled.mat === 'tile' && styled.same, JSON.stringify(styled));

  // 8. two UNDOs: the restyle, then the whole room
  const undone2 = await evalJS(cdp, `(() => { const st = App.station(); const a = st.undo(), b = st.undo(); return { ok: a.ok && b.ok, rooms: st.rooms().filter(r => r.kind !== 'corridor').map(r => r.name) }; })()`);
  check('one UNDO each removes the restyle and the furnished room', undone2.ok && JSON.stringify(undone2.rooms) === JSON.stringify(before.rooms), JSON.stringify(undone2));

  check('the mock carried every model call (no real provider)', mock.requests.length >= 11, String(mock.requests.length));
  check('no page exceptions', diagnostics.exceptions.length === 0, JSON.stringify(diagnostics.exceptions.slice(0, 3)));
} catch (error) {
  console.log('FAIL harness :: ' + (error && error.stack || error));
  failures.push('harness');
} finally {
  try { if (cdp) await Promise.race([cdp.send('Browser.close'), sleep(2000)]); } catch {}
  try { cdp?.ws.close(); } catch {}
  await Promise.all([stopChild(chrome, true), stopChild(sidecar)]);
  try { mock.server.close(); } catch {}
  const resolvedRoot = root.replace(/\\/g, '/');
  if (resolvedRoot.startsWith(tmpdir().replace(/\\/g, '/') + '/') && /starnet-builder-e2e-/.test(resolvedRoot)) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try { rmSync(root, { recursive: true, force: true }); break; }
      catch (error) { if (attempt === 9) console.log('(could not remove ' + root + ': ' + error.message + ')'); await sleep(300); }
    }
  }
}

console.log('\n=== ' + (failures.length ? 'FAILURES: ' + failures.join(', ') : 'station-builder.e2e: ALL CHECKS PASSED') + ' ===');
process.exit(failures.length ? 1 : 0);
