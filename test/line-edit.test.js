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
                           nothing and says why in plain words. */
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

A.report('line-edit.test');
