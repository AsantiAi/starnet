/* test/conveyor-choices.test.js — hidden behaviour made an explicit choice, and starting from intent (2026-09-28, Andrew:
   "do 3 and 4 now").

   3a — THE SPLITTER'S MODE IS A SWITCH. A split COPIES when a JOINER is where its branches meet and TAKES TURNS when a
        MERGER is; COPY TO EACH / TAKE TURNS in the Workflow panel swaps that one junction in place (same tile, same belts,
        one undo). A choice the floor cannot make (the branches never meet) says why.
   3b — ONE TEST CONTROL. The four test buttons became one TEST with three named modes: WATCH IT · FREE, STEP THROUGH ·
        REAL, RUN ONE REAL JOB. The top bar's TEST opens that view and still plays the free walkthrough in one click.
   4a — START FROM INTENT. The Commander's own onboarding goal is read for the SHAPE of the work and the matching
        ready-made line leads the Conveyors tab, their words quoted ("FOR YOUR GOAL").
   4b — SAVE, AND TURN IT ON. While scheduling is off, saving a schedule offers the switch in the same click. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const WM = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/pipeline.js');
const W = require('../frontend/app/workflowline.js');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const build = read('frontend/app/build.js'), panel = read('frontend/app/workflowpanel.js');

function stampCrewed(id) {
  const s = WM.create(), z = s.rooms()[0].rects[0];
  s.addRoom({ kind: 'hab', rect: { x1: z.x2 + 1, y1: z.y1, x2: z.x2 + 40, y2: z.y1 + 30 } });
  let ok = null;
  for (let y = z.y1; y < z.y1 + 25 && !ok; y++) for (let x = z.x1; x < z.x2 + 30 && !ok; x++) { const r = s.stampBlueprint(id, x, y); if (r.ok) ok = r; }
  A.ok(!!ok, 'fixture: ' + id + ' stamps');
  for (const b of s.props().filter(p => p.t === 'bay')) s.assignPropAgent(b.id, 'a_' + b.id);
  return s;
}
const splitOf = plan => Object.keys(plan.junctions).find(k => plan.junctions[k].kind === 'split');

/* ---------- 3a: where the branches meet, and the swap ---------- */
{
  const so = stampCrewed('second_opinion'), plan = P.compileRoutingPlan(so.projectGeometry()), sk = splitOf(plan);
  const lanes = P.rejoinOf(plan, sk).lanes;
  A.ok(lanes.length === 2 && lanes.every(l => l.kind === 'join' && l.at === lanes[0].at), 'SECOND OPINION: both branches meet at one JOINER');
  A.ok(plan.junctions[sk].fanout === true, '…so its split copies');
  const lb = stampCrewed('load_balancer'), lplan = P.compileRoutingPlan(lb.projectGeometry());
  const llanes = P.rejoinOf(lplan, splitOf(lplan)).lanes;
  A.ok(llanes.length === 2 && llanes.every(l => l.kind === 'merge' && l.at === llanes[0].at), 'LOAD BALANCER: both branches meet at one MERGER (it takes turns)');
  const pc = stampCrewed('parallel_crew'), pplan = P.compileRoutingPlan(pc.projectGeometry());
  A.ok(P.rejoinOf(pplan, splitOf(pplan)).lanes.every(l => l.at === null), 'PARALLEL CREW: the branches never meet — nothing to swap');
  A.eq(P.rejoinOf(plan, 'nope').lanes, [], 'not a split: no lanes');

  // the swap is the mode switch, in place, one undo
  const joiner = so.props().find(p => p.t === 'joiner');
  const before = { x: joiner.x, y: joiner.y, belts: JSON.stringify(so.belts()) };
  const r = so.swapJoinerMerger(joiner.id);
  A.ok(r.ok && r.t === 'merger', 'a JOINER swaps to a MERGER');
  const after = so.propById(joiner.id);
  A.ok(after && after.t === 'merger' && after.x === before.x && after.y === before.y && JSON.stringify(so.belts()) === before.belts, '…same prop id, same tile, same belts');
  const plan2 = P.compileRoutingPlan(so.projectGeometry());
  A.ok(!plan2.junctions[splitOf(plan2)].fanout, '…and the split now takes turns');
  so.undo();
  A.ok(so.propById(joiner.id).t === 'joiner' && P.compileRoutingPlan(so.projectGeometry()).junctions[sk].fanout === true, 'one UNDO puts the JOINER (and the copies) back');
  A.ok(!so.swapJoinerMerger(so.props().find(p => p.t === 'splitter').id).ok, 'only a JOINER or a MERGER swaps');

  // the host + panel wiring
  A.ok(/function splitModeInfo\(splitId\)/.test(build) && /Pipeline\.rejoinOf\(plan, lk\)\.lanes/.test(build) && /const plan = probePlanOnceCrewed\(\);/.test(build), 'the switch reads the once-crewed plan (a fresh stamp answers like a crewed one)');
  A.ok(/meet && meet\.kind === 'merge' && propAt\(meet\.at\) \? \{ ok: true, swap: \[propAt\(meet\.at\)\] \}/.test(build), 'COPY swaps the one MERGER where every branch meets');
  A.ok(/the branches never meet at one MERGER/.test(build), '…and says why when there is none');
  A.ok(/station\.swapJoinerMerger\(step\.swap\[0\]\)/.test(build) && /splitModeInfo: id => splitModeInfo\(id\)/.test(build) && /setSplitMode: \(id, mode\) => setSplitMode\(id, mode\)/.test(build), 'the panel reaches it through the host');
  A.ok(/pick\('copy', 'COPY TO EACH'/.test(panel) && /pick\('turns', 'TAKE TURNS'/.test(panel) && /H\.setSplitMode\(p\.id, b\.dataset\.smode\)/.test(panel), 'the SPLITTER section carries the switch');
  A.ok(/aria-disabled="true" data-tip="' \+ esc\(\(step && step\.msg\)/.test(panel), 'a choice the floor cannot make is greyed with its reason');
}

/* ---------- 3b: one TEST control ---------- */
{
  A.ok(/const PREVIEW_LABEL = '▶ TEST';/.test(build) && /root\.querySelector\('#refit-test'\)\.onclick = \(e\) => openTest\(e\);/.test(build), 'the top bar has ONE TEST control');
  const ot = build.slice(build.indexOf('  function openTest(e) {'), build.indexOf('  function sendTestBoxes(ev, auto, agentId) {'));
  A.ok(/WP\.showTest\('watch'\)/.test(ot) && /return sendTestBoxes\(e\);/.test(ot), 'TEST opens the TEST view AND plays the free walkthrough (one click, as before)');
  A.ok(/preview: \(\) => sendTestBoxes\(null\)/.test(build), 'WATCH IT drives the same walkthrough');
  A.ok(/\['watch', 'WATCH IT · FREE'/.test(panel) && /\['step', 'STEP THROUGH · REAL'/.test(panel) && /\['real', 'RUN ONE REAL JOB'/.test(panel), 'three named modes');
  A.ok(/return m === 'step' && S\.seam !== true \? 'real' : m;/.test(panel), 'no step-test seam: STEP THROUGH steps aside for RUN ONE REAL JOB');
  A.ok(/id="wf-test">' \+ \(s && W\.isLive\(s\) \? '▶ TEST · '/.test(panel) && !/id="wf-steptest"/.test(panel) && !/id="wf-sample"/.test(panel), 'the footer has ONE TEST button (the step-test and sample buttons are gone)');
  A.ok(/showTest, _state: S/.test(panel), 'the panel exposes showTest for the top bar');
  A.ok(/'TEST IT AGAIN' : 'TEST THIS STEP'/.test(panel), 'the per-step button says what it tests');
}

/* ---------- 4a: start from intent ---------- */
{
  const s = t => { const r = W.suggestLineFor(t); return r ? r.id : null; };
  A.eq(s('research the news every morning, write a draft, and have someone review it before I publish'), 'revision_loop', 'a draft someone reviews: REVISION LOOP');
  A.ok(/RESEARCHER in front/.test(W.suggestLineFor('research the news, write a draft, and have it reviewed').why), '…with research named: add a RESEARCHER in front');
  A.ok(/on your schedule/.test(W.suggestLineFor('write my weekly newsletter and have an editor check it').why), '…a cadence in the words points at the INBOX schedule');
  A.eq(s('research competitors and write up a report'), 'research_line', 'research written up: RESEARCH LINE');
  A.eq(s('fix bugs in my repo and have them reviewed'), 'code_foundry', 'code that gets reviewed: CODE FOUNDRY');
  A.eq(s('ship features in my repo and test each change'), 'build_test', 'code that gets tested: BUILD & TEST');
  A.eq(s('fix bugs and write tests for my app'), 'build_test', '…tests named: BUILD & TEST, not the review loop');
  A.eq(s('pressure-test the code I write'), 'second_opinion', '"pressure-test" is a second opinion, never QA');
  A.eq(s('I want a second opinion on big decisions'), 'second_opinion', 'two takes: SECOND OPINION');
  A.eq(s('help me with emails'), null, 'one kind of work: no suggestion (never a guess)');
  A.eq(s('newsletter'), null, '"news" inside "newsletter" is not research (word boundaries)');
  A.eq(s(''), null, 'no words, no card');
  for (const id of ['revision_loop', 'research_line', 'code_foundry', 'build_test', 'second_opinion']) A.ok(WM.BLUEPRINTS.some(b => b.id === id), 'the suggested line exists in the catalog: ' + id);
  A.ok(/for \(const k of \['goals', 'ambition', 'pain'\]\)/.test(build) && /WorkflowLine\.suggestLineFor\(t\)/.test(build), 'the goal is the Commander\'s own dossier words');
  // (2026-09-30: the quote is the goal tile's hover tip and accessible description — no sentence under a tile)
  A.ok(/FOR YOUR GOAL/.test(build) && /addLineCell\(grid, goal\.bp, '“' \+ goal\.quote \+ '” — ' \+ goal\.why, true\)/.test(build) && /b\.dataset\.tip = name [^\n]*\(why \? '\\n' \+ why : ''\)/.test(build), 'the card quotes them and is the same line card (fit + MAKE ROOM included)');
}

/* ---------- 4b: save, and turn scheduling on ---------- */
{
  A.ok(/\(S\.cron && !S\.cron\.enabled && !S\.cron\.halted\)/.test(panel) && /id="trg-create" data-arm="1"/.test(panel) && /▸ SAVE · TURN SCHEDULING ON/.test(panel) && /id="trg-create-only"/.test(panel), 'scheduling off: the save button turns it on too, SAVE ONLY beside it');
  A.ok(/Turning it on lets every saved schedule run at its time\./.test(panel), '…and says the switch is station-wide');
  A.ok(/if \(arm && !armedNow && !cur\.halted && saved\.enabled\) \{/.test(panel) && /api\('\/api\/cron\/arm', 'POST', \{ enabled: true \}\)/.test(panel), 'it arms on the same route the switch uses, never lifting an E-STOP');
  A.ok(/'✓ schedule saved and scheduling is on — fires at '/.test(panel) && /could not be turned on: press TURN SCHEDULING ON above/.test(panel), 'the result is said as it happened');
  A.ok(/\$\('#trg-create'\)\.onclick = \(\) => create\(!!\$\('#trg-create'\)\.dataset\.arm\);/.test(panel) && /createOnly\.onclick = \(\) => create\(false\)/.test(panel), 'both buttons share one save path');
}

/* ---------- 2026-09-28: the shelf by kind of work, plain names, and SET UP BEFORE YOU PLACE ---------- */
{
  // the names and kinds live ON the catalog (WorldModel.BLUEPRINTS .plain / .work, 2026-09-29): one source for the shelf and the agent's builder
  for (const bp of WM.BLUEPRINTS) {
    A.ok(typeof bp.plain === 'string' && bp.plain.length >= 3 && bp.plain.length <= 20, bp.id + ': a plain name of 20 characters or fewer');
    A.ok(['any', 'write', 'code', 'research', 'volume', 'decide'].indexOf(bp.work) >= 0, bp.id + ': a kind of work on the shelf');
  }
  A.ok(/for \(const bp of \(\(typeof WorldModel !== 'undefined' && WorldModel\.BLUEPRINTS\) \|\| \[\]\)\) \{ if \(bp\.plain\) LINE_PLAIN\[bp\.id\] = bp\.plain; if \(bp\.work\) LINE_WORK\[bp\.id\] = bp\.work; \}/.test(build), 'the shelf reads the names and kinds from the catalog');
  A.ok(/LINE_WORK_GROUPS\.some\(g => g\.id === LINE_WORK\[bp\.id\]\)/.test(build), 'the shelf groups by kind of work (an unknown line falls into the last section)');
  A.ok(/station\.stampBlueprint\(bp\.id, o\.x, o\.y, lineStampOpts\(bp\)\)/.test(build), 'placing a line carries the card\'s cap and tries INTO the one stamp');
  A.ok(/if \(tool === 'line' && bp\.id === lineType\) grid\.appendChild\(linePrefsEl\(bp\)\)/.test(build), 'the armed card shows its settings right under it');
}

A.report('conveyor-choices.test');
