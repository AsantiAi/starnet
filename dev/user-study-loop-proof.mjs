// USER-STUDY LOOP live proof — real Chrome over CDP, a real seeded sidecar, a deterministic local mock model.
//   interview → confirmed first path → quests planned for THAT step → START QUEST runs real work (a real fs.write
//   tool call) → the artifact contract completes → the Commander reports the other quest → the sidecar settles the
//   step and the plan moves on → restart → what the station learned while the window was closed is offered.
// Owns only its child processes and a fresh scratch workspace. No paid service is called.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { launchChrome, connectCDP, evalJS, collectDiagnostics, sleep } from '../scripts/lib/cdp.mjs';
import { waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const port = Number(process.env.USL_PROOF_PORT || 9187), cdpPort = Number(process.env.USL_PROOF_CDP || 9587);
const url = `http://127.0.0.1:${port}/`, out = resolve('dev/.scratch-workspace-usl-proof');
const ws = join(out, 'ws'), profile = join(out, 'profile');
rmSync(out, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
let seed, chrome, cdp, log = '';
const requests = [];
const model = 'usl-proof/model';
const STEPS = ['Pick the newsletter niche', 'Write issue one', 'Get ten subscribers'];
const AGENT_Q = 'Draft the niche shortlist', HUMAN_Q = 'Ask three readers which niche';
const ARTIFACT = 'notes/niche-shortlist.md';

const reply = (parsed) => {
  const msgs = parsed.messages || [];
  const all = msgs.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')).join('\n');
  const lastUser = msgs.map(m => m.role).lastIndexOf('user');
  const user = lastUser >= 0 ? String(msgs[lastUser].content || '') : '';
  const calledNames = msgs.slice(lastUser + 1).filter(m => m.role === 'assistant').flatMap(m => m.tool_calls || []).map(t => t.function && t.function.name);
  if (user.includes('Help me with this quest')) {
    const names = (parsed.tools || []).map(t => t.function && t.function.name);
    const write = names.find(n => /^fs.?write$/.test(n || '')), brief = names.find(n => /^brief.?proceed$/.test(n || ''));
    // behave like a real model under the harness's Task Brief gate: settle the brief, then do the work.
    if (brief && !calledNames.includes(brief)) return { tool: { name: brief, args: { objective: 'Draft the niche shortlist', deliverable: ARTIFACT } } };
    if (write && !calledNames.includes(write)) return { tool: { name: write, args: { path: ARTIFACT, content: '# Niche shortlist\n- indie games\n- AI tools\n- local food\n' } } };
    return { text: 'Wrote the shortlist to ' + ARTIFACT + '.' };
  }
  // route on the LAST user message: evidence blocks quote earlier prompts, so a whole-transcript match misroutes.
  if (all.includes('quest master')) {
    if (user.includes('THE STEP YOU ARE PLANNING NOW: ' + STEPS[0])) return { text: [
      'NORTH_STAR: Launch a weekly newsletter about indie games',
      'QUEST: ' + AGENT_Q, 'DESC: Write a shortlist of three candidate niches.', 'REWARD: A concrete niche to choose from',
      'EXECUTION: agent', 'WHY_NOW: The first step is picking the niche.', 'DOMAIN: planning', 'CONTRACT: artifact ' + ARTIFACT,
      'WHY: The Commander wants to launch a newsletter about indie games',
      'QUEST: ' + HUMAN_Q, 'DESC: Message three readers and ask which niche they would read.', 'REWARD: Real reader signal',
      'EXECUTION: commander', 'WHY_NOW: The niche should be validated by readers.', 'DOMAIN: research', 'CONTRACT: attest',
      'WHY: The Commander wants to launch a newsletter about indie games'].join('\n') };
    return { text: 'NONE' };
  }
  if (user.includes('GOAL DECOMPOSITION')) return { text: STEPS.map((s, i) => (i + 1) + '. ' + s).join('\n') };
  if (all.includes('THE READ')) return { text: 'READ: you want a newsletter about indie games off the ground.\nPURPOSE: Launch a weekly newsletter about indie games\nSTACK: NONE' };
  if (all.includes('THE TUESDAY')) return { text: 'ACK: a newsletter — good, that is concrete.\nASK: NONE' };
  return { text: 'Ready.' };
};
const mock = createServer((req, res) => {
  if (req.url.includes('/models')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: model, context_length: 32000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] })); return; }
  let raw = ''; req.on('data', b => raw += b); req.on('end', () => {
    let parsed = {}; try { parsed = JSON.parse(raw); } catch {}
    requests.push(raw);
    const r = reply(parsed);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (r.tool) res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + requests.length, type: 'function', function: { name: r.tool.name, arguments: JSON.stringify(r.tool.args) } }] } }] }) + '\n\n');
    else res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: r.text } }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: r.tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 8 } }) + '\n\n'); res.end('data: [DONE]\n\n');
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const env = { ...process.env, SKYNET_PORT: String(port), SKYNET_DEFAULT_MODEL: model, APPDATA: profile, LOCALAPPDATA: profile, XDG_DATA_HOME: profile,
  SKYNET_OPENROUTER_KEY: 'usl-proof-local-key', SKYNET_OPENROUTER_BASE: `http://127.0.0.1:${mock.address().port}/api/v1`,
  SKYNET_REFLECTION: '0', SKYNET_NIGHTSHIFT: '0', SKYNET_CRON_ENABLED: '0' };
const boot = async () => {
  seed = spawn(process.execPath, ['dev/seed.js', '--keep', '--workspace', ws], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  seed.stdout.on('data', b => log += b); seed.stderr.on('data', b => log += b);
  assert(await waitUp(url), 'seeded sidecar did not start: ' + log.slice(-1500));
};
const stopSeed = async () => {
  if (!seed || seed.exitCode != null) return;
  if (process.platform === 'win32') await new Promise(r => { const k = spawn('taskkill', ['/PID', String(seed.pid), '/T', '/F'], { stdio: 'ignore' }); k.on('exit', r); });
  else seed.kill('SIGTERM');
  await sleep(700);
};
const ev = s => evalJS(cdp, s);
const until = async (expr, msg, tries = 100) => { for (let i = 0; i < tries; i++) { if (await ev(expr)) return; await sleep(250); } throw Error(msg); };
const api = (path, body) => ev(`(async () => { const r = await fetch(${JSON.stringify(path)}, ${body ? `{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(body))}}` : `{cache:'no-store'}`}); return r.json(); })()`);
const receipt = { steps: {} };
try {
  await boot();
  chrome = launchChrome({ cdpPort, profileDir: join(out, 'chrome') });
  cdp = await connectCDP(cdpPort); const diag = collectDiagnostics(cdp);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Page.navigate', { url });
  assert(await waitDevReady(cdp, evalJS, { url }), 'dev station did not enter game');

  // STEP 4 — a new station proposes by default (the sidecar owns the posture).
  receipt.steps.defaultPosture = (await api('/api/autonomy/posture')).summary;
  assert.equal(receipt.steps.defaultPosture.initiative, 'propose'); assert.equal(receipt.steps.defaultPosture.actsUnattended, false);

  // STEP 2 — the real interview (the deferred-interview door runs the same runLeadMeeting the awakening uses).
  await ev(`localStorage.setItem('starnet.interview.deferred.v1','1')`);
  await cdp.send('Page.reload'); assert(await waitDevReady(cdp, evalJS, { url }), 'reload failed');
  await until(`[...document.querySelectorAll('button')].some(b => /do it now/i.test(b.textContent))`, 'deferred interview offer did not appear', 320);
  await ev(`[...document.querySelectorAll('button')].find(b => /do it now/i.test(b.textContent)).click()`);
  const seen = []; let pathLines = null, done = false;
  for (let i = 0; i < 900 && !done; i++) {
    const s = JSON.parse(await ev(`JSON.stringify((() => { const p = document.querySelector('.fnv-dialogue.show'); if (!p) return { closed: true };
      return { line: (p.querySelector('.fnv-line') || {}).textContent || '', more: !!p.querySelector('.fnv-more.show'),
        opts: [...p.querySelectorAll('.fnv-opts .fnv-opt')].map(b => b.textContent.trim()), ta: !!p.querySelector('.fnv-custom-in') }; })())`));
    const has = re => s.opts && s.opts.findIndex(o => re.test(o));
    const clickOpt = async re => { await ev(`[...document.querySelectorAll('.fnv-dialogue.show .fnv-opts .fnv-opt')].find(b => ${re}.test(b.textContent)).click()`); seen.push(String(re)); };
    if (s.closed) { if (await ev(`!!(GoalStore.activeGoal && GoalStore.activeGoal())`)) done = true; await sleep(250); continue; }
    if (has(/A short conversation/) >= 0) await clickOpt(/A short conversation/);
    else if (s.ta && !seen.includes('opening answered') && /what made you want to set up an agent/.test(s.line)) {
      const sent = await ev(`(() => { const t = document.querySelector('.fnv-dialogue.show .fnv-custom-in'), b = document.querySelector('.fnv-dialogue.show .fnv-custom-send'); if (!t || !b) return false; t.value = 'I want to launch a weekly newsletter about indie games.'; t.dispatchEvent(new Event('input', {bubbles:true})); b.click(); return true; })()`);
      if (sent) seen.push('opening answered');
    }
    else if (has(/that’s me/) >= 0) await clickOpt(/that’s me/);
    else if (has(/Line up suggestions/) >= 0) await clickOpt(/Line up suggestions/);
    else if (has(/Confirm the path/) >= 0) {
      pathLines = await ev(`[...document.querySelectorAll('.fnv-dialogue.show .fnv-line, .fnv-dialogue.show .fnv-ink')].map(e => e.textContent).join(' | ')`);
      await clickOpt(/Confirm the path/);
    }
    else if (s.more) await ev(`document.querySelector('.fnv-dialogue.show .fnv-more').click()`);
    await sleep(200);
  }
  assert(done, 'the interview never produced a goal; seen=' + JSON.stringify(seen));
  receipt.steps.interview = { seen, goal: await ev(`(() => { const g = GoalStore.activeGoal(); return { text: g.text, steps: g.milestones.map(m => m.text) }; })()`) };
  assert.deepEqual(receipt.steps.interview.goal.steps, STEPS, 'the confirmed path is the drafted mission plan');
  assert.equal(receipt.steps.interview.goal.text, 'Launch a weekly newsletter about indie games');

  // STEP 1 — the sidecar holds the plan and the refresh plans THAT step.
  await until(`(async () => { const j = await (await fetch('/api/journey',{cache:'no-store'})).json(); return j.journey.activeGoal && j.journey.activeGoal.next === ${JSON.stringify(STEPS[0])}; })()`, 'the sidecar mirror did not get the plan');
  const refresh = await api('/api/quests/refresh/run', {});
  assert(refresh.ok && refresh.started, 'refresh refused: ' + JSON.stringify(refresh));
  await until(`(async () => { const j = await (await fetch('/api/quests',{cache:'no-store'})).json(); return j.quests.filter(q => q.status === 'open' && q.goalId).length >= 2; })()`, 'the refresh did not plan the step');
  receipt.steps.plannerSawStep = requests.some(r => r.includes('THE STEP YOU ARE PLANNING NOW: ' + STEPS[0]));
  assert(receipt.steps.plannerSawStep, 'the planner was not told which step it is planning');
  // the station studies the Commander, not itself: no internal self-talk reaches the planner's activity evidence.
  const plannerPrompt = requests.filter(r => r.includes('THE STEP YOU ARE PLANNING NOW')).map(r => { const m = JSON.parse(r).messages; return String(m[m.length - 1].content); }).pop() || '';
  const activity = (plannerPrompt.split('RECENT REAL ACTIVITY:')[1] || '').split('\n\n')[0];
  receipt.steps.plannerActivity = activity.trim().split('\n');
  assert(!/INTERNAL —/.test(activity), 'internal self-talk leaked into the planner activity: ' + activity);
  const quests = (await api('/api/quests')).quests.filter(q => q.goalId);
  receipt.steps.planned = quests.map(q => ({ title: q.title, milestoneId: q.milestoneId, contract: q.contract.type, mode: q.executionMode }));
  const firstMilestone = await ev(`GoalStore.activeGoal().milestones[0].id`);
  assert(quests.every(q => q.milestoneId === firstMilestone), 'every planned quest is bound to the current step');

  // STEP 5 — START QUEST on the agent quest runs real work in the quest's own session.
  await ev(`StationUI.openTerm('quests')`); await ev(`QuestLedgerStore.init()`); await sleep(600); await ev(`StationUI.rerender('quests', false)`);
  const agentQ = quests.find(q => q.title === AGENT_Q), humanQ = quests.find(q => q.title === HUMAN_Q);
  const selectQuest = async id => { await until(`!!document.querySelector('[data-quest-select="${id}"]')`, 'quest ' + id + ' not listed'); await ev(`document.querySelector('[data-quest-select="${id}"]').click()`); await sleep(300); };
  await selectQuest(agentQ.id);
  await until(`!!document.querySelector('.q-go[data-qid="${agentQ.id}"]')`, 'agent quest START not rendered');
  receipt.steps.startLabel = await ev(`document.querySelector('.q-go[data-qid="${agentQ.id}"]').textContent`);
  await ev(`document.querySelector('.q-go[data-qid="${agentQ.id}"]').click()`);
  const sessionAtStart = await ev(`(() => { const a = Workstreams.get(Workstreams.activeId()); return a && { title: a.title, agentId: a.agentId }; })()`);
  await until(`(async () => { const j = await (await fetch('/api/quests',{cache:'no-store'})).json(); return j.quests.some(q => q.id === ${JSON.stringify(agentQ.id)} && q.status === 'done'); })()`, 'the started quest never completed by its artifact contract', 200);
  receipt.steps.questRun = {
    session: sessionAtStart,
    sentByStart: requests.some(r => r.includes('Help me with this quest: ' + AGENT_Q)),
    artifactOnDisk: existsSync(join(ws, 'agent', ARTIFACT)) || existsSync(join(ws, 'workspaces', 'agent', ARTIFACT))
  };
  assert.equal(receipt.steps.questRun.session.title, 'quest: ' + AGENT_Q, 'START opened the quest session'); assert(receipt.steps.questRun.sentByStart, 'START QUEST did not send the work');

  // STEP 1 (cont.) — the Commander reports the other quest; the sidecar settles the step and the plan moves on.
  await ev(`StationUI.openTerm('quests'); StationUI.rerender('quests', false)`);
  await selectQuest(humanQ.id);
  await until(`!!document.querySelector('.q-life-quest[data-qid="${humanQ.id}"] .q-quest-report')`, 'commander quest report control not rendered');
  await ev(`(() => { const e = document.querySelector('.q-life-quest[data-qid="${humanQ.id}"] .q-quest-evidence'); e.value = 'Messaged three readers; two picked indie games'; e.dispatchEvent(new Event('input', {bubbles:true})); document.querySelector('.q-life-quest[data-qid="${humanQ.id}"] .q-quest-report').click(); })()`);
  await until(`(async () => { const j = await (await fetch('/api/journey',{cache:'no-store'})).json(); return j.journey.activeGoal && j.journey.activeGoal.next === ${JSON.stringify(STEPS[1])}; })()`, 'the sidecar did not advance the plan');
  const j1 = (await api('/api/journey')).journey;
  receipt.steps.settled = j1.milestones.find(m => m.milestoneId === firstMilestone);
  assert.equal(receipt.steps.settled.verifiedBy, 'harness-contract');
  await ev(`JourneyStore.sync(true)`); await sleep(800); await ev(`GoalStore.sync(); StationUI.rerender('quests', false)`);
  await until(`GoalStore.activeGoal().milestones[0].status === 'done'`, 'the page did not fold the settled step');
  receipt.steps.pageFold = await ev(`(() => { const g = GoalStore.activeGoal(); return { first: g.milestones[0].status, source: g.milestones[0].source, next: Goals.nextMilestone(g).text }; })()`);
  assert.equal(receipt.steps.pageFold.next, STEPS[1]);

  // STEP 3 — close the window, the station learns something on an unwatched run, reopen: it is offered.
  await cdp.send('Page.navigate', { url: 'about:blank' }); await stopSeed();
  const studyFile = join(ws, 'study.state.json');
  const study = existsSync(studyFile) ? JSON.parse(readFileSync(studyFile, 'utf8')) : { v: 1, byRun: {}, latest: {}, lastAt: {}, declined: {} };
  study.byRun = study.byRun || {};
  study.byRun.run_away_1 = { agentId: 'agent', runId: 'run_away_1', createdAt: Date.now(), proposals: [{ id: 'away1', dim: 'schedule', kind: 'add', text: 'Writes the newsletter on Sunday mornings', evidence: 'I always write it Sunday morning', evidenceRef: { runId: 'run_away_1', kind: 'directive' }, source: 'study', sourceRunId: 'run_away_1' }] };
  writeFileSync(studyFile, JSON.stringify(study));
  await boot(); await cdp.send('Page.navigate', { url }); assert(await waitDevReady(cdp, evalJS, { url }), 'restart failed');
  await until(`typeof GoalStore !== 'undefined' && !!GoalStore.activeGoal()`, 'goal did not survive the restart');
  receipt.steps.afterRestart = await ev(`(() => { const g = GoalStore.activeGoal(); return { next: Goals.nextMilestone(g).text, done: g.milestones.filter(m => m.status === 'done').length }; })()`);
  await until(`[...document.querySelectorAll('.cmsg.turnin')].some(e => /Sunday mornings/.test(e.textContent))`, 'the away study proposal was not offered on return', 120);
  receipt.steps.awayStudyCard = await ev(`[...document.querySelectorAll('.cmsg.turnin')].find(e => /Sunday mornings/.test(e.textContent)).textContent.replace(/\\s+/g,' ').slice(0, 240)`);
  receipt.exceptions = diag.exceptions; assert.deepEqual(receipt.exceptions, []);
  receipt.consoleErrors = (diag.consoleMsgs || []).filter(m => /error/i.test(String(m.type || m.level || '')));
  writeFileSync(join(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ ok: true, receipt: join(out, 'receipt.json'), steps: receipt.steps, consoleErrors: receipt.consoleErrors }, null, 2));
} catch (e) {
  let extra = '';
  extra += '\n---quest-run requests---\n' + requests.filter(r => r.includes('Help me with this quest')).map(r => { try { const p = JSON.parse(r); return JSON.stringify({ tools: (p.tools || []).map(t => t.function && t.function.name), roles: p.messages.map(m => m.role + (m.tool_calls ? '+calls' : '')), last: String(p.messages[p.messages.length - 1].content).slice(0, 300) }); } catch { return r.slice(0, 200); } }).join('\n');
  try { extra += '\n---active session---\n' + await ev(`JSON.stringify((() => { const a = Workstreams.get(Workstreams.activeId()); return a && { title: a.title, agentId: a.agentId, n: (a.messages || a.history || []).length }; })())`); } catch {}
  try { const agentDir = join(ws, 'agent'); extra += '\n---agent dir exists--- ' + existsSync(agentDir) + ' artifact@agent: ' + existsSync(join(agentDir, ARTIFACT)); } catch {}
  try { extra += '\n---quest dom---\n' + await ev(`JSON.stringify({ go: [...document.querySelectorAll('.q-go')].map(b => [b.dataset.qid, b.dataset.dest, b.textContent]), ledger: (typeof QuestLedgerStore !== 'undefined' && QuestLedgerStore.quests) ? QuestLedgerStore.quests().map(q => [q.id, q.title, q.status, q.executionMode]) : null, text: (document.querySelector('#term-quests, .gx-quests') || document.body).innerText.slice(0, 2500) })`); } catch (x) { extra += String(x); }
  try { extra += '\n---refresh---\n' + JSON.stringify(await api('/api/quests/refresh')).slice(0, 3000); } catch {}
  try { extra += '\n---quests---\n' + JSON.stringify(await api('/api/quests')).slice(0, 3000); } catch {}
  extra += '\n---planner requests---\n' + requests.filter(r => r.includes('quest master')).map(r => { try { const m = JSON.parse(r).messages; return m[m.length - 1].content; } catch { return r.slice(0, 300); } }).join('\n=====\n');
  mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'failure.txt'), String(e.stack) + '\n---receipt---\n' + JSON.stringify(receipt, null, 2) + extra + '\n---log---\n' + log.slice(-4000)); console.error(e.message); process.exitCode = 1;
}
finally { if (cdp) { try { await cdp.send('Browser.close'); } catch {} try { cdp.ws.close(); } catch {} } if (chrome) try { chrome.proc.kill(); } catch {} await stopSeed(); mock.close(); }
