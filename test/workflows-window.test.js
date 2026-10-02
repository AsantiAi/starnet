/* test/workflows-window.test.js — WORK › WORKFLOWS, its own docked window (frontend/app/windows/workflows.js, 2026-09-30 — Andrew: "the
   easiest conveyor system we can possibly put together. It should be clear as day to the user how to use it").

   Run for real against a REAL station model (worldmodel + the layout engine + the routing compiler), the window's own code in a vm:
     1. a fresh one-agent station: NEW WORKFLOW → pick "Research + write" → that one agent does every step → CREATE lays the line on
        the floor (LineEdit.placeBlueprint), crewed, with each step's instructions and the line's name, READY TO RUN — no Build Mode;
     2. a line is READY only by WorkflowLine.readiness over the compiled plan, with the facts the Workflow panel and the lead's
        station.layout use; an unstaffed step makes it NEEDS SETUP;
     3. SEND IT A JOB posts the line, the job and its name to the job route after the plan gate, folds a clean delivery into the
        OUTBOX, and shows the job's server record; a refusal says why and shows no job;
   and source-locked: the WORK menu opens this window (never Build Mode), the OUTBOX opens a job's record here, the station's glass. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const P = require('../frontend/app/pipeline.js');
const WL = require('../frontend/app/workflowline.js');
const LE = require('../frontend/app/lineedit.js');
const WM = require('../frontend/app/worldmodel.js');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const src = rd('frontend/app/windows/workflows.js');
const tick = () => new Promise(r => setTimeout(r, 15));

(async () => {
  const st = WM.create(WM.starterDoc());
  const registered = {}, opened = [], folded = [], fetches = [];
  let replyFor = () => ({ ok: true, jobs: [] });
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, JSON, Math, Date, Set, Map, encodeURIComponent,
    module: { exports: {} }, window: {}, document: { activeElement: null, querySelector: () => null },
    StationUI: { registerWindow: (k, t, fn, o) => { registered[k] = { t, fn, o }; }, openTerm: k => opened.push(k),
      h: { present: [{ id: 'nova', name: 'NOVA' }], sfx() {}, notify() {}, navigateWork: (from, to) => opened.push(from + '>' + to) } },
    App: { station: () => st },
    Pipeline: P, WorkflowLine: WL, LineEdit: LE, WorldModel: WM,
    Build: { nagWhy: c => 'nag:' + c, lineSchematic: () => null, machineStill: () => '',
      lineWords: () => ({ plain: { research_line: 'Research + write', front_desk: 'One agent', revision_loop: 'Draft + review', build_test: 'Build + test' }, purpose: { research_line: 'one agent digs up sources, the next writes the answer' } }) },
    World: { syncPlan: () => Promise.resolve({ errors: [] }), bayLive: () => null },
    ReturnStore: { foldRow: row => { folded.push(row); return true; }, pendingRows: () => [] },
    fetch: (url, init) => { fetches.push({ url, init }); const r = replyFor(url, init); return Promise.resolve({ status: r.__status || 200, json: () => Promise.resolve(r) }); },
  });
  vm.runInContext(src, ctx, { filename: 'workflows.js' });
  const WW = ctx.module.exports, S = WW._state;
  A.ok(registered.workflows && registered.workflows.t === 'WORKFLOWS' && registered.workflows.o.className === 'wfw-win', 'it is a station window: StationUI.registerWindow(\'workflows\', \'WORKFLOWS\', …) — the dock raises it from the bottom like every other');

  /* ---------- 1. a fresh one-agent station: a workflow in three clicks, no Build Mode ---------- */
  A.ok(WW._floor().lines.length === 0, 'a fresh station has no workflows (the window opens on "Make your first workflow")');
  WW._pick('research_line');
  A.ok(S.pick && S.pick.bp === 'research_line' && S.pick.name === 'Research + write', 'picking a starter names it the way the Build Library does');
  A.ok(JSON.stringify(S.pick.agents) === '["nova","nova"]', 'one agent does every step — a one-agent station needs no recruiting');
  A.ok(S.pick.briefs.RESEARCHER.does === WL.defaultBrief('RESEARCHER').does && S.pick.briefs.WRITER.does === WL.defaultBrief('WRITER').does, 'each step comes with its instructions written');
  const propsBefore = st.props().length;
  WW._create();
  const f = WW._floor(), line = f.lines[0];
  A.ok(f.lines.length === 1 && st.props().length > propsBefore, 'CREATE lays the line on the floor');
  A.ok(line.name === 'Research + write' && st.propById(line.intakeId).label === 'Research + write', '…named on its INBOX (one name, the shelf\'s)');
  A.ok(line.steps.map(s => s.role + ':' + s.agentId).join() === 'RESEARCHER:nova,WRITER:nova', '…every step crewed by the one agent');
  A.ok(line.steps[0].brief === WL.defaultBrief('RESEARCHER').does && line.steps[1].brief === WL.defaultBrief('WRITER').does, '…with each step\'s instructions');
  A.ok(line.ready.ready && !line.ready.blocking.length, '…and READY TO RUN: the router can run it now (' + JSON.stringify(line.ready.blocking) + ')');
  A.ok(S.view === 'line' && S.line === line.key && S.pick === null, 'the window opens the new workflow, on its job box');
  A.ok(S.msg && /Research \+ write is on your floor/.test(S.msg.text) && !S.msg.bad, '…saying so in the window (a toast would sit over the SEND key)');

  /* ---------- 2. status is the compiled plan's readiness ---------- */
  st.assignPropAgent(line.steps[1].id, '');
  const unready = WW._floor().lines[0];
  A.ok(!unready.ready.ready && unready.ready.blocking.some(b => /BAY 2 \(WRITER\) needs an agent/.test(b.what)), 'an unstaffed step: NEEDS SETUP, and which step needs whom');
  st.assignPropAgent(line.steps[1].id, 'nova');
  A.ok(WW._floor().lines[0].ready.ready, 'crewed again: READY');

  /* ---------- 3. SEND IT A JOB ---------- */
  const job = { id: 'job-0123456789ab', line: line.key, name: line.name, text: 'three facts about the moon', status: 'delivered', runs: [{ runId: 'r2', agentId: 'nova', dockId: line.steps[1].id, reason: 'done', usd: 0.001 }], output: 'The moon…', usd: 0.002, notes: [], startedAt: 1, endedAt: 2 };
  replyFor = (url, init) => {
    if (/\/api\/routing\/sample$/.test(url)) return { ok: true, jobId: job.id, delivered: { runId: 'r2', reason: 'done', streamId: 'sample-1' }, runs: job.runs, replies: ['The moon…'], totalUsd: 0.002 };
    if (/\/api\/line-jobs\/job-/.test(url)) return { ok: true, job };
    return { ok: true, jobs: [Object.assign({}, job, { steps: 1 })] };
  };
  WW._send(WW._floor().lines[0], 'three facts about the moon', null);
  A.ok(S.out && S.out.text === 'three facts about the moon', 'the job goes out at once (the window shows it riding the line)');
  for (let i = 0; i < 8; i++) await tick();
  const post = fetches.find(x => /\/api\/routing\/sample$/.test(x.url));
  A.ok(post && JSON.parse(post.init.body).line === line.key && JSON.parse(post.init.body).text === 'three facts about the moon' && JSON.parse(post.init.body).name === 'Research + write', 'it posts the line, the job and the line\'s name to the job route');
  A.ok(folded.length === 1 && folded[0].runId === 'r2', 'a clean delivery is folded into the OUTBOX');
  A.ok(S.out === null && S.job && S.job.id === job.id && S.job.status === 'delivered', 'the result shown is the job\'s server record');
  // a refusal: nothing went down the line — the window says why and shows no job
  replyFor = url => /\/api\/routing\/sample$/.test(url) ? { __status: 409, ok: false, error: 'a sample job is already riding the line (started 4s ago) — wait for it to deliver.' } : { ok: true, jobs: [] };
  S.job = null;
  WW._send(WW._floor().lines[0], 'again', null);
  for (let i = 0; i < 8; i++) await tick();
  A.ok(S.out === null && S.job === null && S.msg && S.msg.bad && /already riding the line/.test(S.msg.text), 'a refused job says why, and no result is shown');
  // the plan gate: a floor the station refused is never run
  ctx.World.syncPlan = () => Promise.resolve({ errors: [{ code: 'CYCLE' }] });
  fetches.length = 0;
  WW._send(WW._floor().lines[0], 'gated', null);
  for (let i = 0; i < 8; i++) await tick();
  A.ok(!fetches.some(x => /\/api\/routing\/sample$/.test(x.url)) && S.msg && /nag:CYCLE/.test(S.msg.text), 'a floor with a blocking problem is not sent — the floor\'s own words say why');

  /* ---------- NEEDS CHANGES → USE THIS / PUT IT BACK: each field's note keeps its OWN before and after ---------- */
  {
    const step = WW._floor().lines[0].steps[1], dockId = step.id, wasDoes = st.propById(dockId).brief || '', wasHands = st.propById(dockId).hands || '';
    const noteBodies = () => fetches.filter(x => /\/note$/.test(x.url)).map(x => JSON.parse(x.init.body));
    replyFor = () => ({ ok: true, job });
    S.job = job;
    // a fix that changes only the hand-off
    S.fix = { jobId: job.id, open: true, state: 'done', fixes: [{ dockId, hands: 'Pass only the final draft.', why: 'shorter hand-off', was: wasDoes, wasHands }] };
    fetches.length = 0; WW._useFix(job, 0, false); WW._useFix(job, 0, true);
    for (let i = 0; i < 4; i++) await tick();
    const hb = noteBodies();
    A.ok(hb.length === 2 && hb.every(n => n.field === 'hands'), 'a hand-off fix and its put-back are both noted on the hand-off: ' + JSON.stringify(hb.map(n => n.field)));
    A.ok(hb[1] && hb[1].kind === 'putback' && hb[1].text === wasHands && hb[1].was === 'Pass only the final draft.', 'putting a hand-off back records the OLD HAND-OFF, never the old instructions: ' + JSON.stringify(hb[1]));
    A.ok((st.propById(dockId).hands || '') === wasHands, 'and the hand-off is back as it was');
    // a fix that changes both: one note per field
    S.fix = { jobId: job.id, open: true, state: 'done', fixes: [{ dockId, does: 'Two facts, one line each.', hands: 'Pass the facts only.', why: 'tighter', was: wasDoes, wasHands }] };
    fetches.length = 0; WW._useFix(job, 0, false);
    for (let i = 0; i < 4; i++) await tick();
    const both = noteBodies();
    A.ok(both.length === 2 && both.some(n => n.field === 'does' && n.text === 'Two facts, one line each.' && n.was === wasDoes) && both.some(n => n.field === 'hands' && n.text === 'Pass the facts only.' && n.was === wasHands), 'a fix that changes both is noted for both: ' + JSON.stringify(both.map(n => [n.field, n.text])));
    WW._useFix(job, 0, true); S.fix = null; S.job = null;
    // a style kept in the Workflow panel (★ KEEP AS THE EXAMPLE notes no job): STYLE KEPT · PUT IT BACK takes the example out
    const plain = st.propById(dockId).brief || '';
    st.setPropBrief(dockId, WW._exampleBrief(plain, job.output));
    const noNotes = Object.assign({}, job, { notes: [] });
    A.ok(WW._styleKept(noNotes), 'fixture: the window reads the panel-kept example as STYLE KEPT');
    WW._putStyleBack(noNotes);
    A.ok((st.propById(dockId).brief || '') === plain && !WW._styleKept(noNotes), 'PUT IT BACK takes the panel-kept example out (it silently did nothing): ' + JSON.stringify((st.propById(dockId).brief || '').slice(-80)));
    for (let i = 0; i < 4; i++) await tick();
  }

  /* ---------- source locks ---------- */
  const html = rd('frontend/index.html'), app = rd('frontend/app/app.js'), build = rd('frontend/app/build.js'), outbox = rd('frontend/app/windows/outbox.js');
  const css = rd('frontend/css/workflows-window.css'), glass = rd('frontend/app/glass-demo.js'), sc = rd('frontend/app/stationcommands.js');
  A.ok(/<button class="bb" id="bb-automate" data-family="automate"/.test(html) && /\{ id: 'workflows', k: 'workflows', label: 'WORKFLOWS'/.test(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'stationui.js'), 'utf8')) && !/bbWorkflows\.onclick/.test(app), 'WORK › AUTOMATE › WORKFLOWS opens this window through the dock (never Build Mode)');
  A.ok(html.indexOf('app/windows/workflows.js') > html.indexOf('app/stationui.js') && /css\/workflows-window\.css/.test(html), 'it loads after the window manager, with its stylesheet');
  A.ok(/function editLine\(propId\) \{[\s\S]{0,400}openFlowCard\(propId\)/.test(build) && /lineWords: \(\) => \(\{ plain: LINE_PLAIN, purpose: LINE_PURPOSE \}\)/.test(build), 'EDIT WORKFLOW opens the full editor on this line; the window speaks the shelf\'s own words');
  A.ok(/class="consent-btn ob-wf">OPEN IN WORKFLOWS<\/button>/.test(outbox) && /WorkflowsWindow\.openByStream\(rw\.streamId, 'outbox'\)/.test(outbox), 'the OUTBOX opens a workflow job\'s own record here');
  A.ok(/const work = w\.classList\.contains\('wfw-win'\);/.test(glass) && /work \? available \* \.8/.test(glass), 'it opens tall enough for the job and its result');
  // the window's status reads the panel's facts — the ones station.layout gives the lead (stationcommands.js describeLayout)
  A.ok(/hasCompute = \(aid, pid\) => [^\n]*bayObjects\(aid, pid\)[^\n]*'computer'/.test(src) && /toolsAt = \(aid, pid\) => [^\n]*bayObjects\(aid, pid\)/.test(sc) && /hasCompute = \(aid, pid\) => !!aid && toolsAt\(aid, pid\)\.indexOf\('computer'\) >= 0/.test(sc),
    'the window and station.layout read compute the same way: PER BAY (bayObjects(agent, bay) has a computer)');
  for (const fact of [/errors: plan\.errors \|\| \[\]/, /isCrew/, /briefOf/]) A.ok(fact.test(src) && fact.test(sc), 'the window and station.layout read the same readiness fact: ' + fact);
  A.ok(/labelOf = code => \(B\(\) && B\(\)\.nagWhy\) \? B\(\)\.nagWhy\(code\) : code/.test(src), '…and the floor\'s own nag copy');
  // KEEP THIS STYLE writes the panel's own example block, so the panel and the window both see it
  const panel = rd('frontend/app/workflowpanel.js');
  A.ok(WW.EX_HEAD === (panel.match(/const EX_HEAD = '([^']+)';/) || [])[1], 'KEEP THIS STYLE uses the Workflow panel\'s exact example block');
  // station UI laws: hover tips are the station tooltip (data-tip), keys are the current glass, no native popups
  A.ok(!/\stitle="/.test(src) && !/window\.(alert|confirm|prompt)\(/.test(src) && !/<select/.test(src) && !/key-input/.test(src), 'no OS tooltip, no native dialog, no native select, no old CRT field');
  A.ok(/\.term\.wfw-win \.bb \{[\s\S]{0,400}min-height: 36px;[\s\S]{0,200}border-radius: 8px;/.test(css) && /--refit-glass: linear-gradient\(125deg/.test(css), 'its keys are the Build Library / Workflow panel glass key (36px, 8px), on the panel\'s own glass tokens');
  A.ok(/\.term\.wfw-win \.bb:hover::before, \.term\.wfw-win \.bb:hover::after \{ content: none; \}/.test(css), 'never the old pip-boy [ ] hover brackets');

  A.report('workflows-window.test');
})().catch(e => { console.error(e); process.exit(1); });
