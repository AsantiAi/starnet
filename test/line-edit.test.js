/* test/line-edit.test.js — BUILDING A LINE FROM THE PANEL (conveyor-links plan, phase D, 2026-09-29; Andrew: "finish up the
   rest before i try").

   frontend/app/lineedit.js turns each Workflow-panel edit into a change to the line's graph, lays it out with the layout
   engine and writes it back in ONE undo slot (worldmodel lineGraph + applyLineLayout). Locked here, on a real station:
     THE NEWSLETTER LINE — the 09-27 audit's goal ("research the news, write a draft, have someone review it") is built
                           from edits alone and routes INBOX → RESEARCHER → WRITER → REVIEWER ⟲ WRITER → OUTBOX.
     EVERY MACHINE        — a step, a branch (SPLITTER + JOINER for COPY, + MERGER for TAKE TURNS), a review LOOP, a sorting
                           FILTER, a new INBOX / OUTBOX: each added by an edit and each routing as it should.
     ONLY WHAT CHANGED    — every belt an edit does not touch stays exactly where it was; no machine that was there moves
                           (TIDY LINE is the one edit that re-lays the line).
     ONE UNDO             — each edit is one undo slot that puts the station back byte for byte; a refused edit changes
                           nothing and says why in plain words.
     A BRANCH MORE / LESS — another branch on a split (the JOINER then waits for three), a whole branch out as one piece
     SORTER ROUTES        — a step for a type of work the sorter has no route for, a route step out (that type then goes with
                           everything else), the sorter out as one piece. With no room where the line stands, the edit's own
                           lanes spread first (its machines never move); when only a fresh layout fits, the first click
                           changes nothing and the second (opts.tidy) lays the line out afresh round it. */
'use strict';
const A = require('./_assert.js');
const P = require('../frontend/app/pipeline.js');
const WM = require('../frontend/app/worldmodel.js');
const LE = require('../frontend/app/lineedit.js');

const fresh = () => WM.create(WM.starterDoc());
const snapOf = st => JSON.stringify(st.toJSON ? st.toJSON() : { props: st.props(), belts: st.belts(), links: st.links() });
const byRole = (st, role) => st.props().filter(p => p.t === 'bay' && p.role === role).map(p => p.id);
const one = (st, t) => st.props().filter(p => p.t === t).map(p => p.id);
// every BAY without an agent gets one (each assignment is its own undo slot: returns how many were made)
const crewAll = st => { let n = 0; for (const p of st.props()) if (p.t === 'bay' && !p.agentId) { st.assignPropAgent(p.id, 'ag_' + p.id); n++; } return n; };
const planOf = st => P.compileRoutingPlan(st.projectGeometry());
const next = (plan, dock, tag) => P.chainStepDock(plan, dock, { tag: tag || 'general', lineId: P.lineOfDock(plan, dock) }, () => 0);
const blocking = plan => plan.errors.filter(e => !e.warn).map(e => e.code);
const beltsOf = st => { const o = {}; for (const b of st.belts()) o[b.x + ',' + b.y] = b.dir; return o; };
const run = (st, id, op, args, opts) => LE.run(st, id, op, args, Object.assign({ near: { x: 8, y: 5 } }, opts || {}));

/* ---------- THE NEWSLETTER LINE, from edits alone ---------- */
{
  const st = fresh();
  const r0 = run(st, null, 'newLine', { role: 'RESEARCHER' });
  A.ok(r0.ok, 'a new line is laid: INBOX → a step → OUTBOX' + (r0.ok ? '' : ' — ' + JSON.stringify(r0)));
  const [I] = one(st, 'intake'), [O] = one(st, 'outbox'), [R] = byRole(st, 'RESEARCHER');
  A.ok(!!I && !!O && !!R, '…an INBOX, a RESEARCHER step and an OUTBOX stand on the floor');
  const r1 = run(st, R, 'appendStep', { after: R, role: 'WRITER' });
  A.ok(r1.ok, 'a WRITER step is added after the RESEARCHER' + (r1.ok ? '' : ' — ' + JSON.stringify(r1)));
  const [W] = byRole(st, 'WRITER');
  const r2 = run(st, W, 'addLoop', { around: W, max: 3, when: 'approved' });
  A.ok(r2.ok, 'a review loop goes round the WRITER' + (r2.ok ? '' : ' — ' + JSON.stringify(r2)));
  const [V] = byRole(st, 'REVIEWER'), [G] = one(st, 'loop');
  crewAll(st);
  const plan = planOf(st);
  A.eq(blocking(plan), [], 'the newsletter line compiles clean');
  A.eq((P.resolveDock(plan, { tag: 'general' }) || {}).dockId, R, 'work enters at the RESEARCHER');
  A.eq((next(plan, R) || {}).dockId, W, 'the RESEARCHER hands to the WRITER');
  A.eq((next(plan, W) || {}).dockId, V, 'the WRITER hands to the REVIEWER');
  const lp = next(plan, V) || {};
  A.ok(!!lp.loop && lp.max === 3 && lp.when === 'approved' && (lp.backTo || {}).dockId === W, 'the REVIEWER\'s verdict goes to the LOOP: back to the WRITER until approved, 3 times at most — ' + JSON.stringify({ max: lp.max, when: lp.when, backTo: lp.backTo }));
  A.ok(lp.next === null && !!plan.dockChains[V] && plan.dockChains[V].outbox === true, '…and when it passes, the work ships to the OUTBOX (the stamped revision loop compiles the same)');
  const prop = id => st.propById(id);
  A.ok(prop(G) && prop(G).maxIter === 3 && prop(G).when === 'approved', 'the LOOP gate carries its passes and its verdict');
  A.ok(st.links().some(l => l.from.prop === G && l.from.port === 'done' && l.to.prop === O), 'the LOOP\'s DONE lane runs to the OUTBOX');
  // every machine and every belt stands where the station itself allows
  for (const p of st.props()) if ({ intake: 1, bay: 1, outbox: 1, loop: 1 }[p.t]) A.ok(st.canPlaceProp(p.t, p.x, p.y, p.w, p.h, p.id).ok, p.t + ' ' + p.id + ' stands where the station allows');
}

/* ---------- ONLY WHAT CHANGED MOVES, ONE UNDO PUTS IT BACK ---------- */
{
  const st = fresh();
  run(st, null, 'newLine', { role: 'WRITER' });
  const [I] = one(st, 'intake'), [W] = byRole(st, 'WRITER');
  const posBefore = JSON.stringify(st.props().map(p => [p.id, p.x, p.y]));
  const beltsBefore = beltsOf(st), linksBefore = st.links();
  const doc0 = snapOf(st);
  const r = run(st, I, 'insertStep', { from: I, to: W, role: 'RESEARCHER' });
  A.ok(r.ok, 'a step is inserted between the INBOX and the WRITER' + (r.ok ? '' : ' — ' + JSON.stringify(r)));
  const kept = linksBefore.filter(l => l.from.prop === W);   // WRITER → OUTBOX was not touched
  const now = st.links();
  A.ok(kept.every(k => { const n = now.find(l => l.id === k.id); return n && JSON.stringify(n.path) === JSON.stringify(k.path); }), 'the belt the edit did not touch stays exactly where it was');
  A.eq(JSON.stringify(st.props().filter(p => p.id !== r.focus).map(p => [p.id, p.x, p.y])), posBefore, 'no machine that was there moves');
  A.ok(st.undo().ok !== false && snapOf(st) === doc0, 'ONE undo puts the station back exactly');
  A.eq(beltsOf(st), beltsBefore, '…belts included');
}

/* ---------- EVERY MACHINE, BY AN EDIT ---------- */
{
  // BRANCH: COPY TO EACH (SPLITTER + JOINER) round a step — the step and a new one both get the job, their results combine
  const st = fresh();
  run(st, null, 'newLine', { role: 'WRITER' });
  const [W] = byRole(st, 'WRITER'), [O] = one(st, 'outbox');
  const doc0 = snapOf(st);
  const r = run(st, W, 'addBranch', { around: W, mode: 'copy' });
  A.ok(r.ok, 'a COPY branch goes round a step' + (r.ok ? '' : ' — ' + JSON.stringify(r)));
  const s1 = snapOf(st); st.undo();
  A.ok(snapOf(st) === doc0, 'one undo removes the whole branch'); st.redo();
  A.ok(snapOf(st) === s1, '…and REDO lays it again');
  const crewed = crewAll(st);
  const [S] = one(st, 'splitter'), [J] = one(st, 'joiner'), plan = planOf(st);
  A.eq(blocking(plan), [], '…it compiles clean');
  const js = Object.values(plan.junctions), bays = st.props().filter(p => p.t === 'bay').map(p => p.id);
  A.ok(!!S && !!J && js.some(j => j.kind === 'split' && j.fanout === true) && js.some(j => j.kind === 'join' && j.expect === 2), 'a SPLITTER copies the job to both steps, a JOINER waits for the two — ' + JSON.stringify(plan.junctions));
  A.ok(bays.length === 2 && bays.indexOf(W) >= 0 && bays.every(b => plan.dockChains[b] && plan.dockChains[b].outbox), '…both the step and the new one hand on through the JOINER to the OUTBOX');
  A.ok(st.links().some(l => l.from.prop === J && l.to.prop === O), '…and the JOINER\'s belt runs to the OUTBOX');
  for (let i = 0; i < crewed; i++) st.undo();   // the crew assignments, then the branch
  st.undo();

  // TAKE TURNS brings a MERGER
  A.ok(snapOf(st) === doc0, '(back to the plain line)');
  const t = run(st, W, 'addBranch', { around: W, mode: 'turns' });
  A.ok(t.ok && one(st, 'merger').length === 1 && one(st, 'joiner').length === 0, 'a TAKE TURNS branch brings a MERGER, not a JOINER');
  st.undo();

  // SORTER between the WRITER and the OUTBOX: CODE → ENGINEER, RESEARCH → RESEARCHER, everything else straight on
  const s = run(st, W, 'addSorter', { from: W, to: O });
  A.ok(s.ok, 'a sorting FILTER goes in front of the OUTBOX' + (s.ok ? '' : ' — ' + JSON.stringify(s)));
  crewAll(st);
  const [F] = one(st, 'filter'), [E] = byRole(st, 'ENGINEER'), [RS] = byRole(st, 'RESEARCHER'), pl = planOf(st);
  A.eq(blocking(pl), [], '…it compiles clean');
  const to = tag => (next(pl, W, tag) || {}).dockId || (next(pl, W, tag) || {}).to || null;
  A.eq([to('code'), to('research')], [E, RS], 'CODE work goes to the ENGINEER, RESEARCH to the RESEARCHER');
  const gen = next(pl, W, 'general');
  A.ok(!gen || !gen.dockId || gen.dockId === null || gen.outbox || gen === 'OUTBOX' || (gen && !byRole(st, 'ENGINEER').includes(gen.dockId)), 'everything else goes straight on — ' + JSON.stringify(gen));
  A.ok(st.links().some(l => l.from.prop === F && l.from.else && l.to.prop === O), 'the FILTER\'s EVERYTHING ELSE lane runs to the OUTBOX');
  A.ok(!!st.propById(F).routes && st.propById(F).routes.code && !!st.propById(F).def, 'the FILTER takes its routes from its lanes');
  st.undo();
}

/* ---------- REMOVE, MOVE, TIDY ---------- */
{
  const st = fresh();
  run(st, null, 'newLine', { role: 'RESEARCHER' });
  const [R] = byRole(st, 'RESEARCHER');
  run(st, R, 'appendStep', { after: R, role: 'WRITER' });
  const [W] = byRole(st, 'WRITER'), [I] = one(st, 'intake'), [O] = one(st, 'outbox');
  crewAll(st);

  // MOVE: the WRITER one place earlier → INBOX → WRITER → RESEARCHER → OUTBOX
  const m = run(st, W, 'moveStep', { id: W, dir: -1 });
  A.ok(m.ok, 'a step moves one place earlier' + (m.ok ? '' : ' — ' + JSON.stringify(m)));
  let plan = planOf(st);
  A.eq([(P.resolveDock(plan, { tag: 'general' }) || {}).dockId, (next(plan, W) || {}).dockId], [W, R], '…the line now runs INBOX → WRITER → RESEARCHER');
  st.undo();

  // REMOVE a step: its way in joins its way out
  const d = run(st, W, 'removeStep', { id: W });
  A.ok(d.ok && !st.propById(W), 'a step is removed' + (d.ok ? '' : ' — ' + JSON.stringify(d)));
  plan = planOf(st);
  A.ok(st.links().some(l => l.from.prop === R && l.to.prop === O), '…and the step before it now hands to the OUTBOX');
  st.undo();

  // a LOOP: the step it sends work back to cannot be removed first; REMOVE LOOP takes the gate and its REVIEWER
  run(st, W, 'addLoop', { around: W });
  const [G] = one(st, 'loop'), [V] = byRole(st, 'REVIEWER');
  const refused = snapOf(st), no = run(st, W, 'removeStep', { id: W });
  A.ok(!no.ok && /loop/i.test(no.msg || '') && snapOf(st) === refused, 'removing a step a loop sends work back to is refused in plain words, and nothing changes — ' + (no.msg || ''));
  const rl = run(st, G, 'removeLoop', { id: G });
  A.ok(rl.ok && !st.propById(G) && !st.propById(V) && st.links().some(l => l.from.prop === W && l.to.prop === O), 'REMOVE LOOP takes the gate and its REVIEWER; the WRITER hands straight on');

  // a branch member removed: the split folds away when one way is left
  run(st, W, 'addBranch', { around: W, mode: 'copy' });
  const [S] = one(st, 'splitter');
  const extra = st.props().find(p => p.t === 'bay' && p.id !== W && p.id !== R);
  const f = run(st, extra.id, 'removeStep', { id: extra.id });
  A.ok(f.ok && one(st, 'splitter').length === 0 && one(st, 'joiner').length === 0 && st.links().some(l => l.from.prop === R && l.to.prop === W) && st.links().some(l => l.from.prop === W && l.to.prop === O),
    'removing one of two branches folds the SPLITTER and JOINER away: RESEARCHER → WRITER → OUTBOX again');

  // TIDY LINE re-lays the whole line, anchored on its INBOX; it still routes the same
  const at0 = st.propById(I);
  const before = JSON.stringify([(P.resolveDock(planOf(st), { tag: 'general' }) || {}).dockId, (next(planOf(st), R) || {}).dockId]);
  const td = run(st, I, 'tidy', {});
  A.ok(td.ok, 'TIDY LINE lays the line out afresh' + (td.ok ? '' : ' — ' + JSON.stringify(td)));
  A.ok(st.propById(I).x === at0.x && st.propById(I).y === at0.y, '…its INBOX stays where it stood');
  A.eq(JSON.stringify([(P.resolveDock(planOf(st), { tag: 'general' }) || {}).dockId, (next(planOf(st), R) || {}).dockId]), before, '…and it routes exactly as before');
}

/* ---------- A REFUSED EDIT CHANGES NOTHING ---------- */
{
  const st = fresh();
  run(st, null, 'newLine', {});
  const [I] = one(st, 'intake'), [O] = one(st, 'outbox'), [B] = one(st, 'bay');
  const s0 = snapOf(st);
  const bad = [
    run(st, O, 'appendStep', { after: O }),
    run(st, I, 'insertStep', { from: I, to: O }),
    run(st, I, 'addLoop', { around: I }),
    run(st, B, 'moveStep', { id: B, dir: -1 }),
    run(st, B, 'addSorter', { from: B, to: B }),
  ];
  A.ok(bad.every(r => !r.ok && typeof r.msg === 'string' && r.msg.length > 10), 'every edit that cannot be made says why in plain words — ' + bad.map(r => r.error).join(', '));
  A.ok(snapOf(st) === s0, '…and the station is untouched');
  // a floor with no room left: the new line is refused, never half-laid
  const full = fresh(), rm = full.rooms()[0].rects[0];
  for (let y = rm.y1; y <= rm.y2; y++) for (let x = rm.x1; x <= rm.x2; x++) if (full.canPlaceProp('crate', x, y, 1, 1).ok) full.addProp({ t: 'crate', x, y, w: 1, h: 1 });
  const f0 = snapOf(full), nl = run(full, null, 'newLine', {});
  A.ok(!nl.ok && nl.error === 'NO_ROOM' && snapOf(full) === f0, 'a full deck refuses a new line in plain words and changes nothing — ' + (nl.msg || ''));
}

/* ---------- ANOTHER BRANCH ON A SPLIT, A WHOLE BRANCH OUT ---------- */
{
  const st = fresh();
  run(st, null, 'newLine', { role: 'WRITER' });
  const [W] = byRole(st, 'WRITER'), [I] = one(st, 'intake'), [O] = one(st, 'outbox');
  run(st, W, 'addBranch', { around: W, mode: 'copy' });
  const [S] = one(st, 'splitter'), [J] = one(st, 'joiner');
  run(st, S, 'tidy', {});
  const links0 = st.links(), pos0 = JSON.stringify(st.props().map(p => [p.id, p.x, p.y])), doc0 = snapOf(st);
  const inS = links0.find(l => l.to.prop === S), outJ = links0.find(l => l.from.prop === J);
  const r = run(st, S, 'addArm', { split: S });
  A.ok(r.ok, 'ADD A BRANCH puts a third branch on the SPLITTER' + (r.ok ? '' : ' — ' + JSON.stringify(r)));
  const N = r.focus, bays = st.props().filter(p => p.t === 'bay').map(p => p.id);
  A.ok(bays.length === 3 && st.propById(N).role === 'WRITER', '…a new step, named like the branches beside it');
  A.eq(JSON.stringify(st.props().filter(p => p.id !== N).map(p => [p.id, p.x, p.y])), pos0, '…no machine that was there moves');
  const same = k => { const n = st.links().find(l => l.id === k.id); return !!n && n.from.prop === k.from.prop && n.to.prop === k.to.prop && JSON.stringify(n.path) === JSON.stringify(k.path); };
  A.ok(same(inS) && same(outJ), '…the belts into the split and out of the join keep their ids and their tiles (only the branches\' own lanes spread)');
  A.ok(links0.every(k => st.links().some(l => l.id === k.id && l.from.prop === k.from.prop && l.to.prop === k.to.prop)), '…and every link that was there keeps its id');
  const crewed = crewAll(st), plan = planOf(st);
  A.eq(blocking(plan), [], '…it compiles clean');
  const js = Object.values(plan.junctions);
  A.ok(js.some(j => j.kind === 'split' && j.fanout === true) && js.some(j => j.kind === 'join' && j.expect === 3), 'the SPLITTER copies each job to all three, the JOINER waits for three — ' + JSON.stringify(plan.junctions));
  A.ok(bays.every(b => plan.dockChains[b] && plan.dockChains[b].outbox), '…and every branch hands on through the JOINER to the OUTBOX');
  const s3 = snapOf(st), four = run(st, S, 'addArm', { split: S });
  A.ok(!four.ok && /three/.test(four.msg || '') && snapOf(st) === s3, 'a fourth branch is refused in plain words — a splitter has one belt in and three out — and nothing changes: ' + (four.msg || ''));
  for (let i = 0; i < crewed; i++) st.undo();
  st.undo();
  A.ok(snapOf(st) === doc0, 'one undo takes the third branch back, byte for byte');

  // a branch of two steps comes out whole; the split keeps its other two
  run(st, S, 'addArm', { split: S });
  const arm3 = st.props().filter(p => p.t === 'bay').map(p => p.id).find(b => !JSON.parse(doc0).props.some(p => p.id === b));
  const ins = run(st, arm3, 'insertStep', { from: arm3, to: J, role: 'TESTER' });
  A.ok(ins.ok, 'fixture: a second step on the new branch' + (ins.ok ? '' : ' — ' + JSON.stringify(ins)));
  const [T] = byRole(st, 'TESTER');
  const ra = run(st, S, 'removeArm', { split: S, head: arm3 });
  A.ok(ra.ok && !st.propById(arm3) && !st.propById(T) && one(st, 'splitter').length === 1 && one(st, 'joiner').length === 1, 'REMOVE A BRANCH takes both its steps out as one piece; the split keeps its other two' + (ra.ok ? '' : ' — ' + JSON.stringify(ra)));
  crewAll(st);
  A.ok(Object.values(planOf(st).junctions).some(j => j.kind === 'join' && j.expect === 2), '…and the JOINER waits for two again');

  // the other branch out: the split folds away, the line runs INBOX → WRITER → OUTBOX
  const other = st.props().find(p => p.t === 'bay' && p.id !== W);
  const rf = run(st, S, 'removeArm', { split: S, head: other.id });
  A.ok(rf.ok && !one(st, 'splitter').length && !one(st, 'joiner').length && st.links().some(l => l.from.prop === I && l.to.prop === W) && st.links().some(l => l.from.prop === W && l.to.prop === O),
    'a split left with one branch folds away: INBOX → WRITER → OUTBOX' + (rf.ok ? '' : ' — ' + JSON.stringify(rf)));
}
// the split folds round a branch of several steps too, and TAKE TURNS gets its third hand
{
  const st = fresh();
  run(st, null, 'newLine', { role: 'WRITER' });
  const [W] = byRole(st, 'WRITER'), [I] = one(st, 'intake'), [O] = one(st, 'outbox');
  run(st, W, 'addBranch', { around: W, mode: 'turns' });
  const [S] = one(st, 'splitter'), [M] = one(st, 'merger');
  run(st, S, 'tidy', {});
  const t = run(st, S, 'addArm', { split: S });
  A.ok(t.ok && one(st, 'merger').length === 1 && st.links().filter(l => l.from.prop === S).length === 3, 'TAKE TURNS gets a third hand: three belts out of the SPLITTER, a MERGER where they meet' + (t.ok ? '' : ' — ' + JSON.stringify(t)));
  crewAll(st);
  const sp = Object.values(planOf(st).junctions).find(j => j.kind === 'split');
  A.ok(!!sp && !sp.fanout, '…and the split still takes turns');
  // one new branch grows a second step; the other two branches come out: the split folds round the two-step branch left
  const nb = st.props().filter(p => p.t === 'bay' && p.id !== W).map(p => p.id);
  run(st, nb[0], 'insertStep', { from: nb[0], to: M, role: 'TESTER' });
  const [T] = byRole(st, 'TESTER');
  run(st, S, 'removeArm', { split: S, head: nb[1] });
  const rw = run(st, S, 'removeArm', { split: S, head: W });
  A.ok(rw.ok && !one(st, 'splitter').length && !one(st, 'merger').length && !st.propById(W), 'the last-but-one branch out folds the split round the branch of two steps that is left' + (rw.ok ? '' : ' — ' + JSON.stringify(rw)));
  crewAll(st);
  const pl = planOf(st);
  A.eq(blocking(pl), [], '…it compiles clean');
  A.eq([(P.resolveDock(pl, { tag: 'general' }) || {}).dockId, (next(pl, nb[0]) || {}).dockId], [nb[0], T], '…INBOX → the branch\'s first step → its second step');
  A.ok(!!pl.dockChains[T] && pl.dockChains[T].outbox === true && st.links().some(l => l.from.prop === I) && st.links().some(l => l.to.prop === O), '…→ the OUTBOX');
}
// a split in a cramped corner: the first click changes nothing and says TIDY; the second lays the line out afresh round it
{
  const st = fresh();
  run(st, null, 'newLine', { role: 'WRITER' });
  const [W] = byRole(st, 'WRITER'), [I] = one(st, 'intake');
  run(st, W, 'addBranch', { around: W, mode: 'copy' });
  const [S] = one(st, 'splitter');
  const s0 = snapOf(st), at0 = [st.propById(I).x, st.propById(I).y];
  const r1 = run(st, S, 'addArm', { split: S });
  if (r1.ok) A.ok(true, '(the as-built split had room for a third branch here)');
  else {
    A.ok(r1.error === 'NEEDS_TIDY' && r1.canTidy === true && snapOf(st) === s0, 'no room where the line stands: the first click changes nothing and says a TIDY would fit it — ' + r1.msg);
    const r2 = run(st, S, 'addArm', { split: S }, { tidy: true });
    A.ok(r2.ok && r2.tidied === true && st.links().filter(l => l.from.prop === S).length === 3, 'the second click (tidy) lays the line out afresh with the third branch' + (r2.ok ? '' : ' — ' + JSON.stringify(r2)));
    A.eq([st.propById(I).x, st.propById(I).y], at0, '…its INBOX stays where it stood');
    crewAll(st);
    A.eq(blocking(planOf(st)), [], '…and it compiles clean');
  }
}

/* ---------- A SORTER'S ROUTES IN AND OUT, THE SORTER OUT AS ONE PIECE ---------- */
{
  const st = fresh();
  run(st, null, 'newLine', { role: 'WRITER' });
  const [W] = byRole(st, 'WRITER'), [O] = one(st, 'outbox');
  run(st, W, 'addSorter', { from: W, to: O, routes: [{ tag: 'code', role: 'ENGINEER' }] });
  const [F] = one(st, 'filter'), [E] = byRole(st, 'ENGINEER');
  const r = run(st, F, 'addRoute', { id: F, tag: 'research' });
  A.ok(r.ok && st.propById(r.focus).role === 'RESEARCHER', 'a sorter with no route for RESEARCH gets one: a RESEARCHER step' + (r.ok ? '' : ' — ' + JSON.stringify(r)));
  const [R] = byRole(st, 'RESEARCHER');
  A.ok(st.links().some(l => l.from.prop === R && l.to.prop === O), '…that hands on to where everything else goes');
  const s1 = snapOf(st), again = run(st, F, 'addRoute', { id: F, tag: 'code' });
  A.ok(!again.ok && again.error === 'HAS_ROUTE' && snapOf(st) === s1, 'a type that already has its own way out is refused, nothing changes — ' + (again.msg || ''));
  let n = crewAll(st), pl = planOf(st);
  const to = tag => { const s = next(pl, W, tag) || {}; return s.dockId || null; };
  A.eq(blocking(pl), [], '…it compiles clean');
  A.eq([to('code'), to('research')], [E, R], 'CODE work goes to the ENGINEER, RESEARCH to the new RESEARCHER');
  for (let i = 0; i < n; i++) st.undo();

  // a route step out: that type of work then goes with everything else — never a second belt beside EVERYTHING ELSE
  const d = run(st, E, 'removeStep', { id: E });
  A.ok(d.ok && !st.propById(E), 'the ENGINEER route step comes out' + (d.ok ? '' : ' — ' + JSON.stringify(d)));
  const outs = st.links().filter(l => l.from.prop === F);
  A.ok(outs.length === 2 && outs.some(l => l.from.else && l.to.prop === O) && outs.some(l => (l.from.tags || []).join() === 'research' && l.to.prop === R), '…the FILTER keeps its RESEARCH route and EVERYTHING ELSE, and no CODE belt — ' + JSON.stringify(outs.map(l => [l.from.tags, !!l.from.else, l.to.prop])));
  A.ok(!(st.propById(F).routes || {}).code, '…and its routes no longer name CODE');
  n = crewAll(st); pl = planOf(st);
  A.ok(!byRole(st, 'ENGINEER').length && to('code') !== E && to('research') === R, 'CODE work now goes with everything else; RESEARCH still to the RESEARCHER');
  for (let i = 0; i < n; i++) st.undo();

  // the last route step out: a sorter sorting nothing folds away
  const f = run(st, R, 'removeStep', { id: R });
  A.ok(f.ok && !one(st, 'filter').length && st.links().some(l => l.from.prop === W && l.to.prop === O), 'a sorter left sorting nothing folds away: the WRITER hands straight to the OUTBOX' + (f.ok ? '' : ' — ' + JSON.stringify(f)));
}
{
  // REMOVE THE SORTER: the FILTER and both its route steps go as one piece, one undo brings them all back
  const st = fresh();
  run(st, null, 'newLine', { role: 'WRITER' });
  const [W] = byRole(st, 'WRITER'), [O] = one(st, 'outbox');
  run(st, W, 'addSorter', { from: W, to: O });
  const [F] = one(st, 'filter'), s0 = snapOf(st);
  const r = run(st, F, 'removeSorter', { id: F });
  A.ok(r.ok && !one(st, 'filter').length && !byRole(st, 'ENGINEER').length && !byRole(st, 'RESEARCHER').length && st.links().some(l => l.from.prop === W && l.to.prop === O),
    'REMOVE THE SORTER takes the FILTER and its ENGINEER and RESEARCHER steps; the WRITER hands straight to the OUTBOX' + (r.ok ? '' : ' — ' + JSON.stringify(r)));
  st.undo();
  A.ok(snapOf(st) === s0, '…and one undo brings the whole sorter back');
}
{
  // refusals, on the graph alone: a route that does not rejoin, a branch that is not one, the wrong machine
  const g = { nodes: [{ id: 'A', t: 'bay' }, { id: 'F', t: 'filter' }, { id: 'E', t: 'bay' }, { id: 'B', t: 'bay' }, { id: 'O', t: 'outbox' }, { id: 'O2', t: 'outbox' }],
    links: [{ id: 'l1', from: { node: 'A', port: 'out' }, to: { node: 'F' } }, { id: 'l2', from: { node: 'F', port: 'out', tags: ['code'] }, to: { node: 'E' } },
      { id: 'l3', from: { node: 'E', port: 'out' }, to: { node: 'O2' } }, { id: 'l4', from: { node: 'F', port: 'out', else: true }, to: { node: 'B' } }, { id: 'l5', from: { node: 'B', port: 'out' }, to: { node: 'O' } }] };
  const x = LE.OPS.removeSorter(JSON.parse(JSON.stringify(g)), { id: 'F' });
  A.ok(!x.ok && /rejoin/.test(x.msg), 'a sorter whose route runs elsewhere is not removed as one piece — ' + x.msg);
  const y = LE.OPS.removeArm(JSON.parse(JSON.stringify(g)), { split: 'F', head: 'E' });
  const z = LE.OPS.addArm(JSON.parse(JSON.stringify(g)), { split: 'A' });
  const w = LE.OPS.addRoute(JSON.parse(JSON.stringify(g)), { id: 'F', tag: 'general' });
  A.ok(!y.ok && !z.ok && !w.ok && [y, z, w].every(q => typeof q.msg === 'string' && q.msg.length > 10), 'the wrong machine, or a type the sorter does not know, is refused in plain words — ' + [y, z, w].map(q => q.error).join(', '));
  // a new lane may read in any place among its junction's lanes: the alternatives move only that link
  const alts = LE._internals.laneAlts({ nodes: g.nodes, links: g.links.concat([{ id: 'n', from: { node: 'F', port: 'out', tags: ['research'] }, to: { node: 'B' } }]) }, 'F', 'n');
  A.eq(alts.map(h => h.links.filter(l => l.from.node === 'F').map(l => l.id).join()), ['l2,n,l4', 'n,l2,l4'], 'another lane is tried in every place among its junction\'s lanes');
}

A.report('line-edit.test');
