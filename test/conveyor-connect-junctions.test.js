/* test/conveyor-connect-junctions.test.js — the BELT tool's click-to-connect on the shapes a first-time user builds
   (2026-09-27 first-run conveyor audit, findings W1 + B4).

   W1 — THE SECOND BRANCH INTO A JOINER / MERGER. Split → two agents → join, wired with clicks: every connection
   worked except the second branch into the joiner, refused with "that lane would not enter the JOINER — the belt
   must run INTO its tile". connectBelt's pre-lay check read path[len-2] as the tile feeding the junction; for a
   junction already ON a line the lane ends on a free 4-neighbour, so the feeder is path[len-1], and whenever the
   lane turned on its last step path[len-2] sat diagonal to the junction and a correct lane was refused. The only
   escape was hand-dragging belts, which nothing on screen mentioned.

   B4 — MACHINES PLACED TOO CLOSE. A BAY placed a tile below the INBOX got a ONE-TILE lane that sat in both rings:
   the job was born on it and a job is never delivered on its birth tile, so the floor said NOT FED under a belt
   that visibly ran into the bay. connectBelt now starts outside the destination's ring and ends outside the
   source's ring (or refuses: TOO_CLOSE), and the compiler names a hand-laid too-close lane BAY_TOO_CLOSE. */
'use strict';
const A = require('./_assert.js');
const WM = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/pipeline.js');

function floor() {
  const s = WM.create();
  const r = s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 50, y2: 14 } });
  A.ok(r.ok, 'test deck placed');
  return s;
}
const X = 31, Y = 1;
function add(s, t, x, y, w, h) {
  const q = s.addProp({ t, x: X + x, y: Y + y, w, h, block: w > 1 || h > 1 });
  A.ok(q && q.ok, 'placed ' + t + ' at ' + x + ',' + y + (q && q.msg ? ' — ' + q.msg : ''));
  return q.id;
}

/* ---------- W1: split → two agents → JOINER / MERGER, all wired by clicks ---------- */
for (const junction of ['joiner', 'merger']) {
  const s = floor();
  const I = add(s, 'intake', 0, 6, 2, 2), SP = add(s, 'splitter', 3, 7, 1, 1);
  const BA = add(s, 'bay', 6, 3, 2, 2), BB = add(s, 'bay', 6, 9, 2, 2);
  const J = add(s, junction, 10, 7, 1, 1), BC = add(s, 'bay', 13, 6, 2, 2), O = add(s, 'outbox', 16, 6, 2, 2);
  s.assignPropAgent(BA, 'a'); s.assignPropAgent(BB, 'b'); s.assignPropAgent(BC, 'c');
  // the exact click order from the audit: the joiner is ON a line (A→J, J→C) before B's branch arrives
  for (const [a, b, n] of [[I, SP, 'INBOX->SPLITTER'], [SP, BA, 'SPLITTER->BAY A'], [SP, BB, 'SPLITTER->BAY B'],
    [BA, J, 'BAY A->' + junction], [J, BC, junction + '->BAY C'], [BC, O, 'BAY C->OUTBOX'], [BB, J, 'BAY B->' + junction + ' (second in-lane)']]) {
    const c = s.connectBelt(a, b);
    A.ok(c && c.ok, 'click-connect ' + n + (c && c.msg ? ' (' + c.msg + ')' : ''));
  }
  const plan = P.compileRoutingPlan(s.projectGeometry());
  A.eq(plan.errors.filter(e => !e.warn).length, 0, junction + ' line: no blocking finding');
  A.ok(!plan.errors.some(e => e.code === 'JOIN_ONE_LANE'), junction + ' line: the junction counts both branches (no JOIN_ONE_LANE)');
  const jk = Object.keys(plan.junctions).find(k => plan.junctions[k].kind === (junction === 'joiner' ? 'join' : 'merge'));
  A.ok(!!jk, junction + ' compiled');
  const inl = P._internals.inLanes(plan.belts, +jk.split(',')[0], +jk.split(',')[1]);
  A.eq(inl.length, 2, junction + ' has exactly two in-lanes, one per branch');
  if (junction === 'joiner') {
    A.eq(plan.junctions[jk].expect, 2, 'the JOINER waits for both branches (expect 2)');
    const sk = Object.keys(plan.junctions).find(k => plan.junctions[k].kind === 'split');
    A.ok(plan.junctions[sk].fanout === true, 'a split with a JOINER downstream sends every branch a copy (fanout)');
  }
}

/* ---------- B4: an INBOX and the BAY it feeds placed one tile apart ---------- */
{
  const s = floor();
  const I = add(s, 'intake', 0, 6, 2, 2);
  const B = add(s, 'bay', 2, 9, 2, 2);   // its ring overlaps the INBOX ring on row 8
  s.assignPropAgent(B, 'near');
  const c = s.connectBelt(I, B);
  if (c.ok) {
    // a lane was found that starts outside the BAY's ring and ends outside the INBOX's ring — it must actually feed
    const plan = P.compileRoutingPlan(s.projectGeometry());
    A.ok(plan.reachDock && plan.reachDock[B], 'the connected too-close BAY is really fed by the INBOX (' + JSON.stringify(plan.errors.map(e => e.code)) + ')');
    A.ok(!plan.errors.some(e => e.code === 'BAY_NOT_FED' || e.code === 'BAY_TOO_CLOSE'), 'and nothing says NOT FED');
  } else {
    A.eq(c.error, 'TOO_CLOSE', 'or the connect refuses honestly: TOO_CLOSE, never a belt that carries nothing');
    A.eq(s.belts().length, 0, 'a refusal lays nothing');
  }
}
{
  /* the pre-fix floor from the audit, laid BY HAND: a new BAY placed a tile before an existing one (so the UPSTREAM bay
     has the newer prop id) and a one-tile belt inside both rings. That tile is claimed by the upstream bay, so its
     result never reaches the downstream bay — which then sat under "NOT FED — BELT INTO IT". The compiler now names
     the real fix. */
  const s = floor();
  const I = add(s, 'intake', 0, 2, 2, 2);
  const DOWN = add(s, 'bay', 7, 2, 2, 2);   // placed first: the older id
  const UP = add(s, 'bay', 4, 2, 2, 2);     // placed later, one tile before it: rings overlap on column 6
  s.assignPropAgent(DOWN, 'down'); s.assignPropAgent(UP, 'up');
  s.setBelt(X + 2, Y + 3, 'E'); s.setBelt(X + 3, Y + 3, 'E');   // INBOX -> UP, a proper two-tile lane
  s.setBelt(X + 6, Y + 3, 'E');                                  // UP -> DOWN: one tile inside BOTH rings
  const plan = P.compileRoutingPlan(s.projectGeometry());
  A.ok(plan.reachDock[UP], 'the INBOX feeds the upstream bay');
  A.eq((plan.dockChains[UP] || {}).next || [], [], 'the one shared tile does not carry the upstream result on (the bug the user saw)');
  const tc = plan.errors.find(e => e.code === 'BAY_TOO_CLOSE' && e.propId === DOWN);
  A.ok(!!tc, 'the compiler says BAY_TOO_CLOSE for the starved bay (' + JSON.stringify(plan.errors.map(e => e.code)) + ')');
  A.ok(!plan.errors.some(e => e.code === 'BAY_NOT_FED' && e.propId === DOWN), '…instead of NOT FED, which sent the user to redo the belt they had laid');
  A.ok(tc && tc.warn === true, 'a warning, never a blocker (same standing as BAY_NOT_FED)');
  // and the click-connect would never have laid that tile: with the belt lifted, BELT routes around or refuses
  s.removeBelt(X + 6, Y + 3);
  const c = s.connectBelt(UP, DOWN);
  if (c.ok) {
    const p2 = P.compileRoutingPlan(s.projectGeometry());
    A.eq((p2.dockChains[UP] || {}).next || [], [DOWN], 'the click-laid lane really hands UP -> DOWN');
  } else A.eq(c.error, 'TOO_CLOSE', 'or BELT refuses honestly with TOO_CLOSE');
}
{
  // a BAY one tile from the BAY it hands to: the connect never lays a lane that starts in the receiver's ring
  const s = floor();
  const I = add(s, 'intake', 0, 2, 2, 2), B1 = add(s, 'bay', 4, 2, 2, 2), B2 = add(s, 'bay', 7, 2, 2, 2);
  s.assignPropAgent(B1, 'one'); s.assignPropAgent(B2, 'two');
  A.ok(s.connectBelt(I, B1).ok, 'INBOX -> BAY 1');
  const c = s.connectBelt(B1, B2);
  const plan = P.compileRoutingPlan(s.projectGeometry());
  if (c.ok) {
    A.eq((plan.dockChains[B1] || {}).next || [], [B2], 'BAY 1 hands to BAY 2 on the lane the click laid');
  } else {
    A.eq(c.error, 'TOO_CLOSE', 'or refuses honestly');
  }
}
{
  // no regression: machines with room between them still connect on the short lane
  const s = floor();
  const I = add(s, 'intake', 0, 6, 2, 2), B = add(s, 'bay', 5, 6, 2, 2), O = add(s, 'outbox', 10, 6, 2, 2);
  s.assignPropAgent(B, 'far');
  A.ok(s.connectBelt(I, B).ok && s.connectBelt(B, O).ok, 'a spaced INBOX -> BAY -> OUTBOX line connects');
  const plan = P.compileRoutingPlan(s.projectGeometry());
  A.ok(plan.reachDock[B] && plan.dockChains[B].outbox, 'and runs door to door');
  A.eq(plan.errors.length, 0, 'with no finding at all');
}
A.report('conveyor-connect-junctions.test');
