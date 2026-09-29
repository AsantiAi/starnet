/* test/conveyor-link-tools.test.js — the floor builds LINKS (conveyor-links plan, phase B, 2026-09-28; Andrew: "yes merge it
   and start phase B").

   Phase A put links in the save and the compiler, copied exactly from the belts. Phase B makes them what the Commander builds:
     CONNECT   — BELT, click a machine then the next: the lane is a link between exactly those two. It ends on a tile that
                 belongs to the destination alone, so machines placed side by side connect (no TOO CLOSE refusal), and no
                 tile of it but its own ends sits beside a junction. The audit's two stranded shapes — split → two agents
                 → join, and INBOX → a BAY one tile below it → WRITER → REVIEWER — wire by clicks, clean.
     PASSING   — a belt that runs past a machine joins nothing: only the machines at its two ends.
     MOVE      — a machine's links come with it: lifted and re-laid from the new spot, same ids, same ports; a FILTER's
                 CODE lane is still its CODE lane whichever side it now leaves from.
     DELETE    — the machine's links go, its belts stay (loose); a machine put back where they end picks them up again.
     LOOSE     — a hand-laid belt that joins two machines becomes a link; one that joins none stays on the floor and in
                 no plan (the Commander's call: loose belts route nothing).
     STABLE    — every blueprint stamps to the very plan the ring rule gave it; reconciling twice changes nothing. */
'use strict';
const A = require('./_assert.js');
const WM = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/pipeline.js');

const plan = s => P.compileRoutingPlan(s.projectGeometry());
const codes = s => plan(s).errors.map(e => e.code);
const chainsOf = p => Object.fromEntries(Object.keys(p.chains).sort().map(a => [a, p.chains[a].next.concat(p.chains[a].outbox ? ['OUTBOX'] : [])]));
function fresh() { const s = WM.create(); s.projectGeometry(); s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 56, y2: 16 } }); return s; }
const inBox = (p, t) => t.x >= p.x - 1 && t.x <= p.x + p.w && t.y >= p.y - 1 && t.y <= p.y + p.h;

/* ---------- CONNECT: split → two agents → join, by clicks (the audit's W1 layout) ---------- */
{
  const s = fresh(), X = 31, Y = 1;
  const add = (t, x, y, w, h) => s.addProp({ t, x: X + x, y: Y + y, w, h, block: w > 1 || h > 1 }).id;
  const I = add('intake', 0, 6, 2, 2), SP = add('splitter', 3, 7, 1, 1), BA = add('bay', 6, 3, 2, 2), BB = add('bay', 6, 9, 2, 2);
  const J = add('joiner', 10, 7, 1, 1), BC = add('bay', 13, 6, 2, 2), O = add('outbox', 16, 6, 2, 2);
  s.assignPropAgent(BA, 'a'); s.assignPropAgent(BB, 'b'); s.assignPropAgent(BC, 'c');
  const pairs = [[I, SP], [SP, BA], [SP, BB], [BA, J], [J, BC], [BC, O], [BB, J]];
  const res = pairs.map(([a, b]) => s.connectBelt(a, b));
  A.ok(res.every(r => r.ok), 'every click connects: ' + res.map(r => r.ok ? 'ok' : r.msg).join(' | '));
  const L = s.links();
  A.eq(L.map(l => [l.from.prop, l.to.prop]), pairs, 'each click is ONE link, between exactly the two machines clicked');
  const p = plan(s);
  A.eq(p.errors, [], 'the line compiles clean (no JUNCTION_TOUCH, no JOIN_ONE_LANE, nothing to nag)');
  const split = Object.values(p.junctions).find(j => j.kind === 'split'), join = Object.values(p.junctions).find(j => j.kind === 'join');
  A.ok(split.fanout === true && join.expect === 2, 'the splitter copies to each branch and the joiner waits for both');
  A.eq(chainsOf(p), { a: ['c'], b: ['c'], c: ['OUTBOX'] }, 'A and B both hand to C, C ships');
}

/* ---------- CONNECT: machines placed close (the audit's B4) ---------- */
{
  const s = fresh(), X = 31, Y = 1;
  const add = (t, x, y) => s.addProp({ t, x: X + x, y: Y + y, w: 2, h: 2, block: true }).id;
  const I = add('intake', 0, 0), RB = add('bay', 0, 3), W = add('bay', 5, 3), RV = add('bay', 10, 3), O = add('outbox', 15, 3);
  for (const [b, a] of [[RB, 'researcher'], [W, 'writer'], [RV, 'reviewer']]) s.assignPropAgent(b, a);
  const res = [[I, RB], [RB, W], [W, RV], [RV, O]].map(([a, b]) => s.connectBelt(a, b));
  A.ok(res.every(r => r.ok), 'a BAY one tile below the INBOX connects — no TOO CLOSE: ' + res.map(r => r.ok ? 'ok' : r.msg).join(' | '));
  const p = plan(s);
  A.ok(p.reach.researcher === true, 'the close BAY is fed by the INBOX above it');
  A.eq(chainsOf(p), { researcher: ['writer'], reviewer: ['OUTBOX'], writer: ['reviewer'] }, 'INBOX → RESEARCHER → WRITER → REVIEWER → OUTBOX');
  A.eq(p.errors, [], 'nothing to nag: no NOT FED, no TOO CLOSE');
  for (const l of s.links()) {
    const to = s.propById(l.to.prop), from = s.propById(l.from.prop), last = l.path[l.path.length - 1];
    if (to.t !== 'bay') continue;
    A.ok(inBox(to, last) && !inBox(from, last), 'the tile work arrives on at ' + to.agentId + ' is that bay’s alone');
  }
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend/app/worldmodel.js'), 'utf8');
  const connect = src.slice(src.indexOf('    function planBelt(A, B, linked) {'), src.indexOf('    function layBelt('));
  A.ok(/\} else if \(!aJ && !bJ && B\.t === 'bay' && \(A\.t === 'intake' \|\| A\.t === 'bay'\)\) \{/.test(connect) && /const tooClose = /.test(connect), 'TOO CLOSE survives only for a floor whose links were never adopted');
}

/* ---------- PASSING: a belt that runs past a machine joins nothing ---------- */
{
  const s = fresh(), X = 31, Y = 4;
  const I = s.addProp({ t: 'intake', x: X, y: Y, w: 2, h: 2, block: true }).id;
  const B1 = s.addProp({ t: 'bay', x: X + 4, y: Y + 2, w: 2, h: 2, block: true }).id;
  const B2 = s.addProp({ t: 'bay', x: X + 9, y: Y, w: 2, h: 2, block: true }).id;
  s.assignPropAgent(B1, 'passed'); s.assignPropAgent(B2, 'target');
  // hand-laid, straight past B1's ring (row Y+1 is B1's top ring row)
  A.ok(s.placeBeltRun({ tx: X + 2, ty: Y + 1 }, { tx: X + 8, ty: Y + 1 }).ok, 'fixture: a belt from the INBOX, past BAY 1, into BAY 2');
  A.eq(s.links().map(l => [l.from.prop, l.to.prop]), [[I, B2]], 'it links the INBOX to BAY 2 — nothing it passes');
  const p = plan(s);
  A.ok(p.reach.target === true && !('passed' in p.reach), 'work reaches BAY 2; BAY 1, which the belt only passes, is not on it');
  A.ok(p.errors.some(e => e.code === 'ORPHAN_BAY' && e.propId === B1), '…and BAY 1 says it is on no line');
}

/* ---------- MOVE: the belts come with the machine ---------- */
{
  const s = fresh(), X = 31, Y = 1;
  const add = (t, x, y) => s.addProp({ t, x: X + x, y: Y + y, w: 2, h: 2, block: true }).id;
  const I = add('intake', 0, 3), W = add('bay', 5, 3), RV = add('bay', 10, 3), O = add('outbox', 15, 3);
  s.assignPropAgent(W, 'writer'); s.assignPropAgent(RV, 'reviewer');
  for (const [a, b] of [[I, W], [W, RV], [RV, O]]) s.connectBelt(a, b);
  const before = s.links(), beltsBefore = s.belts().length, chainBefore = chainsOf(plan(s));
  const mv = s.moveProp(W, 0, 4);
  A.ok(mv.ok && mv.lost.length === 0 && mv.relaid.length === 2, 'moving the WRITER re-lays both its links');
  const after = s.links();
  A.eq(after.map(l => l.id).sort(), before.map(l => l.id).sort(), 'the links keep their ids');
  A.eq(chainsOf(plan(s)), chainBefore, 'the line reads the same: INBOX → WRITER → REVIEWER → OUTBOX');
  const onLinks = new Set(); for (const l of after) for (const t of l.path) onLinks.add(t.x + ',' + t.y);
  A.ok(s.belts().every(b => onLinks.has(b.x + ',' + b.y)), 'no belt is left behind at the old spot (every belt on the floor is a link)');
  A.ok(s.belts().length >= beltsBefore - 2, 'fixture: the re-laid lanes are real belts');
  A.eq(plan(s).errors, [], 'still nothing to nag');
  s.undo();
  A.eq(s.links(), before, 'one UNDO puts the WRITER and both its belts back');
}

/* ---------- MOVE: a FILTER's routes ride its links ---------- */
{
  const s = fresh(), X = 38, Y = 6;
  const I = s.addProp({ t: 'intake', x: X - 5, y: Y, w: 2, h: 2, block: true }).id;
  const F = s.addProp({ t: 'filter', x: X, y: Y, w: 1, h: 1, block: false }).id;
  const C = s.addProp({ t: 'bay', x: X + 5, y: Y - 4, w: 2, h: 2, block: true }).id, G = s.addProp({ t: 'bay', x: X + 5, y: Y + 4, w: 2, h: 2, block: true }).id;
  s.assignPropAgent(C, 'coder'); s.assignPropAgent(G, 'generalist');
  for (const [a, b] of [[I, F], [F, C], [F, G]]) A.ok(s.connectBelt(a, b).ok, 'fixture: connect ' + a + ' → ' + b);
  const laneTo = to => { const l = s.links().find(k => k.from.prop === F && k.to.prop === to), f = s.propById(F), t = l.path[0]; return t.x > f.x ? 'E' : t.x < f.x ? 'W' : t.y > f.y ? 'S' : 'N'; };
  A.ok(s.configureJunction(F, { routes: { code: laneTo(C) }, def: laneTo(G) }).ok, 'fixture: CODE down the lane to the coder, everything else to the generalist');
  const tagged = s.links().find(l => l.from.prop === F && l.to.prop === C);
  A.eq([tagged.from.tags, !!tagged.from.else], [['code'], false], 'the panel’s route lands on the link it names');
  const route = () => { const p = plan(s); return [P.resolveTarget(p, { tag: 'code' }), P.resolveTarget(p, { tag: 'general' })]; };
  A.eq(route(), ['coder', 'generalist'], 'CODE → coder, the rest → generalist');
  const mv = s.moveProp(F, 3, 0);
  A.ok(mv.ok && mv.lost.length === 0, 'the FILTER moves with its three links');
  A.eq(route(), ['coder', 'generalist'], '…and CODE still goes to the coder, the rest to the generalist');
  const f = s.propById(F);
  A.eq([f.routes, f.def], [{ code: laneTo(C) }, laneTo(G)], 'its compass config follows the lanes it now leaves on (an older build reads the same)');
}

/* ---------- DELETE: links go, belts stay loose, a machine put back picks them up ---------- */
{
  const s = fresh(), X = 31, Y = 1;
  const add = (t, x, y) => s.addProp({ t, x: X + x, y: Y + y, w: 2, h: 2, block: true }).id;
  const I = add('intake', 0, 3), M = add('bay', 5, 3), W = add('bay', 10, 3);
  s.assignPropAgent(M, 'middle'); s.assignPropAgent(W, 'writer');
  s.connectBelt(I, M); s.connectBelt(M, W);
  const spot = { x: s.propById(M).x, y: s.propById(M).y }, belts = s.belts().length;
  A.ok(s.removeProp(M).ok, 'fixture: remove the middle BAY');
  A.eq(s.links(), [], 'its links go with it');
  A.eq(s.belts().length, belts, 'its belts stay on the floor');
  const p = plan(s);
  A.ok(Object.keys(p.belts).length === 0 && p.reach.writer !== true, '…loose: in no plan, carrying nothing');
  const nb = s.addProp({ t: 'bay', x: spot.x, y: spot.y, w: 2, h: 2, block: true }).id;
  s.assignPropAgent(nb, 'replacement');
  A.eq(s.links().map(l => [l.from.prop, l.to.prop]), [[I, nb], [nb, W]], 'a BAY put back where they end picks both belts up again');
  A.eq(chainsOf(plan(s)), { replacement: ['writer'], writer: [] }, '…and the line runs through it');
}

/* ---------- LOOSE: a belt that joins no two machines ---------- */
{
  const s = fresh(), X = 31, Y = 4;
  const I = s.addProp({ t: 'intake', x: X, y: Y, w: 2, h: 2, block: true }).id, B = s.addProp({ t: 'bay', x: X + 6, y: Y, w: 2, h: 2, block: true }).id;
  s.assignPropAgent(B, 'hand');
  s.placeBeltRun({ tx: X + 2, ty: Y }, { tx: X + 5, ty: Y });
  A.eq(s.links().map(l => [l.from.prop, l.to.prop]), [[I, B]], 'a hand-laid belt from the INBOX into the BAY is a link');
  s.placeBeltRun({ tx: X + 2, ty: Y + 5 }, { tx: X + 4, ty: Y + 5 });
  A.eq(s.links().length, 1, 'a stub that joins nothing is not');
  A.ok(!plan(s).belts[(X + 3) + ',' + (Y + 5)], '…and is in no plan: loose belts route nothing');
}

/* ---------- STABLE: blueprints, and reconciling twice ---------- */
{
  let bad = [];
  for (const bp of WM.BLUEPRINTS) {
    const s = WM.create(), z = s.rooms()[0].rects[0];
    s.projectGeometry();
    s.addRoom({ kind: 'hab', rect: { x1: z.x2 + 1, y1: z.y1 - 30, x2: z.x2 + 120, y2: z.y1 + 90 } });
    let ok = null;
    for (let y = z.y1 - 30; y < z.y1 + 85 && !ok; y++) for (let x = z.x1; x < z.x2 + 110 && !ok; x++) { const r = s.stampBlueprint(bp.id, x, y); if (r.ok) ok = r; }
    for (const b of s.props().filter(p => p.t === 'bay')) s.assignPropAgent(b.id, 'a_' + b.id);
    const g = s.projectGeometry(), g0 = Object.assign({}, g); delete g0.links;
    if (!ok || JSON.stringify(P.compileRoutingPlan(g)) !== JSON.stringify(P.compileRoutingPlan(g0))) bad.push(bp.id);
    const r1 = P.reconcileLinks(g), r2 = P.reconcileLinks(Object.assign({}, g, { links: r1.links }));
    if (JSON.stringify(r2.links) !== JSON.stringify(r1.links) || r2.added.length || r2.dropped.length) bad.push(bp.id + ':unstable');
  }
  A.eq(bad, [], 'every blueprint stamps to the plan the ring rule gave it, and its links reconcile to themselves');
}

/* ---------- THE FLOOR SAYS IT (source locks — build.js, world.js and ghostline.js are browser modules) ---------- */
{
  const fs = require('fs'), path = require('path');
  const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const build = read('frontend/app/build.js'), world = read('frontend/app/world.js'), ghost = read('frontend/app/ghostline.js'), wm = read('frontend/app/worldmodel.js');
  A.ok(/RING_DOCK_T\[propType\] && !linkedFloor\(\)\) \{/.test(build), 'the "LEAVE 2 TILES" spacing tip is gone on a linked floor (machines may stand side by side)');
  A.ok(/This belt is <b>loose<\/b> — it joins no two machines, so nothing rides it\./.test(build) && /This belt runs from <b>' \+ esc\(machineName\(l\.from\.prop\)\) \+ '<\/b> to <b>'/.test(build), 'the belt card names the link a belt is — or says it is loose');
  A.ok(/its belts stay, loose — nothing rides them until a machine stands where they end/.test(build), 'DELETE says the belts stay, loose');
  A.ok(/if \(Array\.isArray\(currentLinks\(\)\)\) return linkedPreview\(cand\);/.test(wm) && /const probe = makeStation\(clone\(doc\)\);/.test(wm), 'the placement ghost asks a DRY RUN of the real edit (a probe copy) on a linked floor');
  A.ok(/const src = routingPlan && routingPlan\.sources && routingPlan\.sources\[0\];/.test(world), 'unaddressed INBOX work spawns on the plan’s own feed mouth, never a loose belt beside the INBOX');
  A.ok(/if \(!map\[k\] \|\| \(!b\.agentId && ubt && ubt\[k\] !== b\.propId\)\) continue;/.test(ghost), 'the ghost ride stops at an uncrewed bay only where the plan hooks it (a passing link rides on)');
}

A.report('conveyor-link-tools.test');
