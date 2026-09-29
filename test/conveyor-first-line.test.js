/* test/conveyor-first-line.test.js — getting a first-time builder to a first working line (2026-09-27 audit, lane 3).

   B1 — 8 of the 19 ready-made lines never fit the starter room: the card said NO ROOM and the red ghost still said
        "CLICK TO STAMP". The card now offers MAKE ROOM FOR IT (a room big enough, touching the station, one undo),
        and a red ghost never invites the click.
   B2 — after a stamp the kit said "Nothing is selected yet"; the Workflow panel now opens on the line's first BAY.
   T1 — a saved schedule with scheduling OFF read as "no schedule". lineStarts names it apart (offSchedules), the
        sentence and the INBOX node say it is scheduled but OFF, and the panel carries the switch that turns it on.
   Plus the once-crewed split mode every WOULD-voice reads (a stamped line's split must not say "turns" while the
   strip says "all run"). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const W = require('../frontend/app/workflowline.js');
const WM = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/pipeline.js');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const build = read('frontend/app/build.js'), panel = read('frontend/app/workflowpanel.js');

/* B1 — the way out of NO ROOM */
// (the card's fit lives in setLineTileFit since the 2026-09-28 retest — kept current as the floor changes; conveyor-retest.test.js)
const tiles = build.slice(build.indexOf('  function setLineTileFit(b, bp) {'), build.indexOf('  function makeRoomFor(bpId, ev) {'));
A.ok(/const fits = lineFits\(bp\.id\)/.test(tiles) && /MAKE ROOM FOR IT/.test(tiles) && /mk\.onclick = e => makeRoomFor\(bp\.id, e\)/.test(tiles), 'a card with NO ROOM carries MAKE ROOM FOR IT');
A.ok(/b\.after\(mk\)/.test(tiles), '…as a sibling button (never a button inside the card button)');
const mr = build.slice(build.indexOf('  function makeRoomFor(bpId, ev) {'), build.indexOf('  function stampLine(w, ev) {'));
A.ok(/const W = bp\.w \+ 2, H = bp\.h \+ 2;/.test(mr), 'the room is the line plus a tile of walking room');
A.ok(/touches\(c\.x, c\.y\)/.test(mr) && /station\.addRoom\(\{ kind: 'hab'/.test(mr), 'it only builds a room that touches the station (auto-doors join it)');
A.ok(/lineType = bp\.id; selectTool\('line'\)/.test(mr) && /UNDO removes the room/.test(mr), 'then arms the line over it and says how to take it back');
A.ok(/\(ok \? ' — CLICK TO STAMP' : ''\)/.test(build), 'a red line ghost never says CLICK TO STAMP');
// the real model agrees: a room that touches the starter room is accepted and the blueprint then fits
{
  const s = WM.create(), z = s.rooms()[0].rects[0];
  const bp = WM.BLUEPRINTS.find(b => b.id === 'deep_dive');
  let fits = false;
  for (let y = z.y1; y <= z.y2 && !fits; y++) for (let x = z.x1; x <= z.x2 && !fits; x++) if (s.canPlaceBlueprint('deep_dive', x, y).ok) fits = true;
  A.ok(!fits, 'fixture: THE DEEP DIVE does not fit the starter room');
  const r = s.addRoom({ kind: 'hab', rect: { x1: z.x2 + 1, y1: z.y1, x2: z.x2 + bp.w + 2, y2: z.y1 + bp.h + 1 } });
  A.ok(r.ok, 'a room of the line’s size touching the starter room is accepted');
  let ok = false;
  for (let y = z.y1; y <= z.y1 + bp.h + 1 && !ok; y++) for (let x = z.x2 + 1; x <= z.x2 + bp.w + 2 && !ok; x++) if (s.stampBlueprint('deep_dive', x, y).ok) ok = true;
  A.ok(ok, '…and THE DEEP DIVE then stamps into it');
}

/* B2 — the panel opens on the first BAY after a stamp */
const st = build.slice(build.indexOf('  function stampLine(w, ev) {'), build.indexOf('NO STANDALONE CANVAS INVITATION'));
A.ok(/let firstBay = null;/.test(st) && /rebake\(\); openFlowCard\(firstBay\)/.test(st), 'a successful stamp compiles and docks the panel on the first BAY');
A.ok(/choose who works each BAY in the panel/.test(st), '…and the tip points at the panel');

/* T1 — a saved schedule with scheduling OFF is named, and the switch is right there */
// a REAL compiled line (the panel reads lineFlow's output): a FRONT DESK with its one bay crewed
const fd = WM.create(), fz = fd.rooms()[0].rects[0];
let fdOk = null;
for (let y = fz.y1; y <= fz.y2 && !fdOk; y++) for (let x = fz.x1; x <= fz.x2 && !fdOk; x++) { const r = fd.stampBlueprint('front_desk', x, y); if (r.ok) fdOk = r; }
A.ok(!!fdOk, 'fixture: FRONT DESK stamps');
const fdBay = fd.props().find(p => p.t === 'bay'); fd.assignPropAgent(fdBay.id, 'a1');
const fdGeo = fd.projectGeometry(), fdPlan = P.compileRoutingPlan(fdGeo);
const f = W.lineFlow(fdPlan, P.lineComponents(fdGeo)[0], P, fdGeo.props);
const job = { id: 'j1', name: 'news', enabled: true, agentId: 'a1', dockId: fdBay.id, runsLine: true, scheduleDisplay: '0 9 * * *' };
const off = W.lineStarts(f, { cron: { enabled: false, jobs: [job] }, human: () => 'every day at 9:00 AM' });
A.eq(off.schedules, [], 'scheduling OFF: the schedule does not count as a start…');
A.eq(off.offSchedules, ['every day at 9:00 AM'], '…but it is named apart');
const on = W.lineStarts(f, { cron: { enabled: true, jobs: [job] }, human: () => 'every day at 9:00 AM' });
A.eq(on.schedules, ['every day at 9:00 AM'], 'scheduling ON: it starts the line');
A.eq(on.offSchedules, [], '…and is not listed as off');
const said = W.sentenceText(W.howItRuns(f, { triggers: off, nameOf: a => String(a).toUpperCase() }));
// (the station.layout audit, 2026-09-28, folded this into ONE "paused starts" sentence — the fact it must carry is unchanged)
A.ok(/^Nothing starts it right now \(its routine "news" \(every day at 9:00 AM\) is saved but the scheduler is off\)/.test(said), 'the sentence says it is scheduled but the scheduler is OFF (' + said.slice(0, 110) + ')');
A.ok(!/no schedule/.test(said), '…never "no schedule"');
A.ok(/'SCHEDULE · OFF'/.test(panel) && /scheduling is off' : 'no trigger yet'/.test(panel), 'the INBOX node says SCHEDULE · OFF');
A.ok(/id="trg-arm">▶ TURN SCHEDULING ON/.test(panel) && /api\('\/api\/cron\/arm', 'POST', \{ enabled: true \}\)/.test(panel), 'the panel carries the switch, on the same route AUTOMATION uses');
A.ok(/refreshServerFacts\(\);\s*\}\)\.catch/.test(panel.slice(panel.indexOf('const wireArm'), panel.indexOf('const wireArm') + 900)), '…and re-reads the truth after pressing it');

/* the once-crewed split mode */
A.ok(/function fanoutOnceCrewed\(\)/.test(build) && /agentId: '__probe_' \+ p\.id/.test(build), 'split mode for the WOULD-voices comes from a stand-in-crew compile');
{
  // the fact it rests on: an uncrewed split-then-join compiles as TURNS; crewed (or probe-crewed) as COPIES
  const s = WM.create(), z = s.rooms()[0].rects[0];
  s.addRoom({ kind: 'hab', rect: { x1: z.x2 + 1, y1: z.y1, x2: z.x2 + 40, y2: z.y1 + 30 } });
  let ok = null;
  for (let y = z.y1; y < z.y1 + 25 && !ok; y++) for (let x = z.x1; x < z.x2 + 30 && !ok; x++) { const r = s.stampBlueprint('second_opinion', x, y); if (r.ok) ok = r; }
  A.ok(!!ok, 'fixture: SECOND OPINION stamps');
  const split = pl => Object.values(pl.junctions).find(j => j.kind === 'split');
  const geo = s.projectGeometry();
  A.ok(!split(P.compileRoutingPlan(geo)).fanout, 'uncrewed: the real plan reads the split as turns');
  const probe = P.compileRoutingPlan(Object.assign({}, geo, { props: geo.props.map(p => p.t === 'bay' && !p.agentId ? Object.assign({}, p, { agentId: '__probe_' + p.id }) : p) }));
  A.ok(split(probe).fanout === true, 'the stand-in crew compile reads it as copies — what it WILL do');
}
A.report('conveyor-first-line.test');
