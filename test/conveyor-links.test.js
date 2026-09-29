/* test/conveyor-links.test.js — explicit connections, phase A of the conveyor-links plan (2026-09-28, Andrew: "merge it,
   then start phase A").

   A LINK is one belt from one machine to the next: { id, from: { prop, port }, to: { prop, port }, path: [{ x, y, d }] }.
   Phase A puts links in the model and the compiler without moving a single line:
     PARITY    — every floor the routing tests compile (test/fixtures/multibay-parity.json) and every blueprint, crewed and
                 uncrewed, compiles through its DERIVED links to the very same plan, hash and executor answers as through
                 the ring rule; a seeded fuzz of messy floors (shared rings, loops, stubs, junction clusters) holds it too.
     THE MODEL — a v1 save loads, routes identically and saves as v2 with its links, adopted only when they compile to
                 the identical plan. From then on the floor KEEPS its links (phase B): a save's garbage links drop and
                 the belts are linked by what they join; a cut belt drops its link and its stubs route nothing.
                 The sidecar's station store reads a v1 save the same way.
     SEMANTICS — what a linked floor MEANS, locked now for the link tools (phase B): a belt that passes a machine's ring
                 hooks nothing; FILTER routes and LOOP exits follow their links' ports, not compass points; a belt beside
                 a junction that is not one of its links is JUNCTION_TOUCH; a passing belt is not a line. */
'use strict';
const A = require('./_assert.js');
const P = require('../frontend/app/pipeline.js');
const WM = require('../frontend/app/worldmodel.js');
const { answersFor } = require('./_multibay-parity.js');
const fx = require('./fixtures/multibay-parity.json');
const { makeStationStore } = require('../sidecar/station-store.js');

const plain = geo => { const g = Object.assign({}, geo); delete g.links; return g; };
const same = (geo, links, msg) => {
  const g2 = Object.assign({}, plain(geo), { links });
  A.eq(P.compileRoutingPlan(g2), P.compileRoutingPlan(plain(geo)), msg + ': the plan');
  A.eq(answersFor(P, g2), answersFor(P, plain(geo)), msg + ': every executor answer');
  A.eq(P.lineComponents(g2), P.lineComponents(plain(geo)), msg + ': the lines');
};
function stamp(ids, crewed) {
  const s = WM.create(), z = s.rooms()[0].rects[0];
  s.addRoom({ kind: 'hab', rect: { x1: z.x2 + 1, y1: z.y1 - 30, x2: z.x2 + 120, y2: z.y1 + 90 } });
  for (const id of ids) {
    let ok = null;
    for (let y = z.y1 - 30; y < z.y1 + 85 && !ok; y++) for (let x = z.x1; x < z.x2 + 110 && !ok; x++) { const r = s.stampBlueprint(id, x, y); if (r.ok) ok = r; }
    A.ok(!!ok, 'fixture: ' + id + ' stamps');
  }
  if (crewed) for (const b of s.props().filter(p => p.t === 'bay')) s.assignPropAgent(b.id, 'a_' + b.id);
  return s;
}

/* ---------- PARITY: the routing corpus ---------- */
{
  let rings = 0;
  fx.cases.forEach((c, i) => { const L = P.deriveLinks(c.geo); rings += L.filter(l => l.ring).length; same(c.geo, L, 'fixture floor #' + i); });
  A.ok(fx.cases.length >= 150, 'the corpus is the whole routing fixture set (' + fx.cases.length + ' floors)');
  A.eq(rings, 0, 'no corpus floor needs a ring link: the flow walk explains every hookup');
}

/* ---------- PARITY: every blueprint, through the model ---------- */
for (const bp of WM.BLUEPRINTS) for (const crewed of [false, true]) {
  const s = stamp([bp.id], crewed), g = s.projectGeometry();
  A.ok(Array.isArray(g.links) && g.links.length > 0, bp.id + (crewed ? ' (crewed)' : '') + ': the model adopts its links');
  same(g, g.links, bp.id + (crewed ? ' (crewed)' : ''));
  A.ok(g.links.every(l => !l.ring), bp.id + ': every link runs machine to machine');
}
{ // all nineteen on one deck
  const s = stamp(WM.BLUEPRINTS.map(b => b.id), true), g = s.projectGeometry();
  same(g, g.links, 'every blueprint on one floor');
}

/* ---------- EXACT BY CONSTRUCTION: messy floors ---------- */
{
  let seed = 20260928;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const ri = n => Math.floor(rnd() * n), pick = a => a[ri(a.length)];
  const DIRS = ['E', 'S', 'W', 'N'], DV = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };
  let bad = 0, rings = 0;
  for (let i = 0; i < 600; i++) {
    const W = 6 + ri(14), H = 4 + ri(10), props = [], belts = {};
    for (let n = ri(7) + 1, id = 1; id <= n; id++) {
      const t = pick(['intake', 'bay', 'bay', 'bay', 'outbox', 'splitter', 'joiner', 'merger', 'filter', 'loop']), big = /intake|bay|outbox/.test(t) && rnd() < 0.5;
      const p = { id: 'p' + id, t, x: ri(W), y: ri(H), w: big ? 1 + ri(2) : 1, h: big ? 1 + ri(2) : 1 };
      if (t === 'bay' && rnd() < 0.7) p.agentId = 'a' + ri(4);
      if (t === 'filter') { if (rnd() < 0.7) p.routes = { code: pick(DIRS) }; if (rnd() < 0.6) p.def = pick(DIRS); }
      if (t === 'loop' && rnd() < 0.5) p.done = pick(DIRS);
      props.push(p);
    }
    for (let r = ri(5) + 1; r > 0; r--) {
      let x = ri(W), y = ri(H), d = pick(DIRS);
      for (let len = 2 + ri(14); len > 0; len--) { belts[x + ',' + y] = d; if (rnd() < 0.25) d = pick(DIRS); x += DV[d][0]; y += DV[d][1]; }
    }
    for (const p of props) if (/splitter|joiner|merger|filter|loop/.test(p.t) && rnd() < 0.7) { const ks = Object.keys(belts), k = pick(ks).split(','); p.x = +k[0]; p.y = +k[1]; }
    const geo = { props, belts: Object.keys(belts).map(k => { const q = k.split(','); return { x: +q[0], y: +q[1], dir: belts[k] }; }) };
    const L = P.deriveLinks(geo), g2 = Object.assign({}, geo, { links: L });
    rings += L.filter(l => l.ring).length;
    // (answers compared as the executor gives them — a floor that loops two gates into each other overflows the stack either way)
    const answers = x => { try { return JSON.stringify(answersFor(P, x)); } catch (e) { return 'threw ' + (e && e.name); } };
    if (JSON.stringify(P.compileRoutingPlan(g2)) !== JSON.stringify(P.compileRoutingPlan(geo)) || answers(g2) !== answers(geo) || JSON.stringify(P.lineComponents(g2)) !== JSON.stringify(P.lineComponents(geo))) bad++;
  }
  A.eq(bad, 0, '600 messy floors: every one compiles identically through its derived links');
  A.ok(rings > 0, '…and the messy ones are where the ring rule\'s accidental hookups get written down as `ring` links');
}

/* ---------- DERIVED LINKS READ LIKE THE LINE ---------- */
{
  const s = stamp(['revision_loop'], false), L = s.links(), t = id => s.propById(id).t + (s.propById(id).role ? ':' + s.propById(id).role : '');
  const read = L.map(l => t(l.from.prop) + '.' + l.from.port + '>' + t(l.to.prop)).sort();
  A.eq(read, ['bay:REVIEWER.out>loop', 'bay:WRITER.out>bay:REVIEWER', 'intake.out>bay:WRITER', 'loop.done>outbox', 'loop.out>bay:WRITER'].sort(), 'REVISION LOOP derives as five links, INBOX to OUTBOX, with the gate\'s back belt to the WRITER');
  A.ok(L.every(l => l.path.every((p, i) => i === 0 || Math.abs(p.x - l.path[i - 1].x) + Math.abs(p.y - l.path[i - 1].y) === 1)), 'every path is a walk of neighbouring belt tiles');
  const belts = s.serialize().belts;
  A.ok(L.every(l => l.path.every(p => belts[p.x + ',' + p.y] === p.d)), 'every path tile is the belt on the floor, arrow and all (links are in world tiles)');
  const back = L.find(l => s.propById(l.from.prop).t === 'loop' && l.from.port === 'out');
  A.ok(back && back.path.length > 10, 'the back belt is the gate\'s own link; an unconfigured exit is left for the compiler to infer (port \'out\'), never guessed into a port');
}

/* ---------- THE MODEL: v1 -> v2, then the floor keeps its links ---------- */
{
  const v1 = stamp(['revision_loop', 'second_opinion'], true).serialize();
  v1.version = 1; delete v1.links;
  const tilePlan = P.compileRoutingPlan(plain(WM.deserialize(v1).projectGeometry()));
  const st = WM.deserialize(v1), out = st.serialize();
  A.eq(out.version, 2, 'a v1 save loads and saves as v2');
  A.ok(Array.isArray(out.links) && out.links.length === st.links().length && out.links.length >= 10, '…carrying its links');
  const g = st.projectGeometry();
  A.eq(P.compileRoutingPlan(g).hash, tilePlan.hash, '…and routes identically: same plan hash, so no station re-arms');
  A.eq(P.compileRoutingPlan(g), tilePlan, '…same plan, field for field');
  A.eq(WM.defaultDoc().version, 2, 'a new station starts at v2');

  // a save's links are KEPT — only those the floor no longer stands behind drop, and every loose belt that joins two
  // machines is linked afresh, so a save an older build edited still routes by what is drawn
  const tampered = JSON.parse(JSON.stringify(out));
  tampered.links = [{ id: 'l1', from: { prop: null, port: 'out' }, to: { prop: null, port: 'in' }, path: [] }];
  const st2 = WM.deserialize(tampered);
  A.ok(st2.links().length >= 10 && st2.links().every(l => l.from.prop != null && l.to.prop != null), 'garbage links in a save are dropped; its belts are linked by the machines they join');
  A.eq(P.compileRoutingPlan(st2.projectGeometry()), tilePlan, '…so the floor still routes exactly by what is drawn');
  A.eq(WM.deserialize(Object.assign({}, out, { links: 'garbage' })).links(), st.links(), 'a malformed links field loads as a floor that never had links (derived exactly)');

  // the floor keeps its links: a cut belt drops its link, and the stubs it leaves route nothing
  const before = st.links();
  const w = st.props().find(p => p.role === 'WRITER'), rv = st.props().find(p => p.role === 'REVIEWER');
  const hand = before.find(l => l.from.prop === w.id && l.to.prop === rv.id);
  A.ok(!!hand, 'fixture: WRITER hands to REVIEWER on a link');
  const mid = hand.path[1];
  st.removeBelt(mid.x, mid.y);
  A.ok(!st.links().some(l => l.from.prop === w.id && l.to.prop === rv.id), 'cut the belt: the WRITER -> REVIEWER link is gone');
  const cutPlan = P.compileRoutingPlan(st.projectGeometry()), wc = cutPlan.chains[w.agentId];
  A.ok(!(wc && wc.next.indexOf(rv.agentId) >= 0), '…the WRITER no longer hands to the REVIEWER');
  A.ok(!cutPlan.belts[hand.path[0].x + ',' + hand.path[0].y] && !cutPlan.belts[hand.path[2].x + ',' + hand.path[2].y], '…and the two stubs it leaves are in no plan (loose belts route nothing)');
  st.undo();
  A.eq(st.links(), before, 'UNDO: the link is back, the same');

  // a floor that never had links adopts them only when exact: a derivation that would move a line is refused
  const real = P.deriveLinks;
  P.deriveLinks = () => [];
  try {
    const legacy = WM.deserialize(v1);
    A.eq(legacy.links(), null, 'a v1 floor whose derived links would not reproduce it adopts none');
    A.ok(!('links' in legacy.projectGeometry()), '…the geometry carries none, so the compiler keeps the ring rule');
  } finally { P.deriveLinks = real; }
  A.eq(WM.deserialize(v1).links(), st.links(), '…and one they do reproduce adopts them');

  // the sidecar reads a v1 save the same way (station-store loads the same model and compiler)
  const store = makeStationStore(), r = store.setStation(v1);
  A.ok(r.ok, 'the sidecar accepts a v1 save');
  A.eq(store.getRoutingPlan().hash, tilePlan.hash, '…routes it identically');
  A.ok(store.getStation().version === 2 && Array.isArray(store.getStation().links), '…and holds it as v2 with its links');
}

/* ---------- SEMANTICS: what a linked floor means (the contract the link tools build on) ---------- */
const path = (pts, d) => pts.map(p => ({ x: p[0], y: p[1], d: p[2] || d }));
const beltsOf = pts => pts.map(p => ({ x: p[0], y: p[1], dir: p[2] }));
{ // a belt that passes a machine's ring hooks nothing
  const props = [{ id: 'i', t: 'intake', x: 0, y: 0, w: 1, h: 1 }, { id: 'b1', t: 'bay', x: 3, y: 1, w: 1, h: 1, agentId: 'nova' }, { id: 'b2', t: 'bay', x: 9, y: 0, w: 1, h: 1, agentId: 'orin' }];
  const run = [[1, 0, 'E'], [2, 0, 'E'], [3, 0, 'E'], [4, 0, 'E'], [5, 0, 'E'], [6, 0, 'E'], [7, 0, 'E'], [8, 0, 'E']];
  const ring = P.compileRoutingPlan({ props, belts: beltsOf(run) });
  A.ok(ring.reach.nova === true && ring.reach.orin === false, 'fixture: by the ring rule the belt feeds the bay it merely passes');
  const geo = { props, belts: beltsOf(run), links: [{ id: 'l1', from: { prop: 'i', port: 'out' }, to: { prop: 'b2', port: 'in' }, path: path(run) }] };
  const plan = P.compileRoutingPlan(geo);
  A.ok(plan.reach.orin === true && !('nova' in plan.reach), 'linked: the INBOX feeds the bay its link goes to — the bay it passes is not even a belt dock');
  A.eq(P.resolveTarget(plan, { tag: 'general' }), 'orin', '…and dispatch goes where the link goes');
  A.ok(plan.errors.some(e => e.code === 'ORPHAN_BAY' && e.propId === 'b1'), '…the passed bay says it is on no line');
  A.ok(!Object.values(plan.bayTileToDock).includes('b1'), '…and owns no hookup tile');
  const lines = P.lineComponents(geo);
  A.ok(lines.length === 1 && lines[0].props.indexOf('b1') < 0 && lines[0].props.indexOf('b2') >= 0, 'a passing belt is not a line: the passed bay is on none');
  const d = P.deriveLinks({ props, belts: beltsOf(run) });
  same({ props, belts: beltsOf(run) }, d, 'the same floor derived (today\'s reading: the bay it passes takes the work, then hands on)');
  A.ok(d.some(l => l.from.prop === 'i' && l.to.prop === 'b1') && d.some(l => l.from.prop === 'b1' && l.to.prop === 'b2'), '…written down as two links, INBOX -> BAY 1 -> BAY 2');
}
{ // FILTER routes follow their links' ports, not compass points
  const props = [{ id: 'i', t: 'intake', x: 0, y: 0, w: 1, h: 1 }, { id: 'f', t: 'filter', x: 2, y: 0, w: 1, h: 1, routes: { code: 'E' }, def: 'S' },
    { id: 'be', t: 'bay', x: 5, y: 0, w: 1, h: 1, agentId: 'east' }, { id: 'bs', t: 'bay', x: 2, y: 3, w: 1, h: 1, agentId: 'south' }];
  const bl = [[1, 0, 'E'], [2, 0, 'E'], [3, 0, 'E'], [4, 0, 'E'], [2, 1, 'S'], [2, 2, 'S']];
  const ring = P.compileRoutingPlan({ props, belts: beltsOf(bl) });
  A.eq([P.resolveTarget(ring, { tag: 'code' }), P.resolveTarget(ring, { tag: 'general' })], ['east', 'south'], 'fixture: by compass, CODE goes east and everything else south');
  const links = [
    { id: 'l1', from: { prop: 'i', port: 'out' }, to: { prop: 'f', port: 'in' }, path: path([[1, 0, 'E']]) },
    { id: 'l2', from: { prop: 'f', port: 'out', else: true }, to: { prop: 'be', port: 'in' }, path: path([[3, 0, 'E'], [4, 0, 'E']]) },
    { id: 'l3', from: { prop: 'f', port: 'out', tags: ['code'] }, to: { prop: 'bs', port: 'in' }, path: path([[2, 1, 'S'], [2, 2, 'S']]) }];
  const plan = P.compileRoutingPlan({ props, belts: beltsOf(bl), links });
  const jc = plan.junctions['2,0'];
  A.eq([jc.routes, jc.def], [{ code: 'S' }, 'E'], 'linked: the route is the link carrying the tag, EVERYTHING ELSE the link marked else');
  A.eq([P.resolveTarget(plan, { tag: 'code' }), P.resolveTarget(plan, { tag: 'general' })], ['south', 'east'], '…and work follows the links, whatever the compass config says');
  A.ok(!plan.errors.some(e => e.code === 'FILTER_NO_DEFAULT'), '…the else link is the default');
  const keep = P.compileRoutingPlan({ props, belts: beltsOf(bl), links: links.map(l => Object.assign({}, l, { from: { prop: l.from.prop, port: 'out' } })) });
  A.eq([keep.junctions['2,0'].routes, keep.junctions['2,0'].def], [{ code: 'E' }, 'S'], 'links that name no route leave the prop\'s compass config standing');
  const d = P.deriveLinks({ props, belts: beltsOf(bl) });
  A.ok(d.some(l => l.from.prop === 'f' && l.to.prop === 'be' && JSON.stringify(l.from.tags) === '["code"]') && d.some(l => l.from.prop === 'f' && l.to.prop === 'bs' && l.from.else === true), 'derivation writes the compass config onto the links as their ports');
}
{ // LOOP exits follow their links' ports
  const props = [{ id: 'g', t: 'loop', x: 5, y: 5, w: 1, h: 1, done: 'E' }];
  const bl = [[4, 5, 'E'], [5, 5, 'E'], [6, 5, 'E'], [5, 6, 'S'], [5, 4, 'N']];
  const lk = (port, pt) => ({ id: 'x' + port, from: { prop: 'g', port }, to: { prop: null, port: 'in' }, path: path([pt]) });
  const ring = P.compileRoutingPlan({ props, belts: beltsOf(bl) }).junctions['5,5'];
  A.eq([ring.done, ring.back, ring.esc], ['E', 'S', 'N'], 'fixture: by compass, done E, then back S and escape N by lane order');
  const named = P.compileRoutingPlan({ props, belts: beltsOf(bl), links: [lk('done', [6, 5, 'E']), lk('back', [5, 4, 'N']), lk('out', [5, 6, 'S'])] });
  const jc = named.junctions['5,5'];
  A.eq([jc.done, jc.back, jc.esc], ['E', 'N', 'S'], 'linked: the link named BACK is the back lane; the exit left over is the escape');
  const moved = P.compileRoutingPlan({ props, belts: beltsOf(bl), links: [lk('done', [5, 6, 'S']), lk('out', [6, 5, 'E']), lk('out', [5, 4, 'N'])] }).junctions['5,5'];
  A.eq(moved.done, 'S', 'the link named DONE wins over the prop\'s compass `done`');
  A.ok(!P.compileRoutingPlan({ props, belts: beltsOf(bl), links: [lk('done', [5, 6, 'S'])] }).errors.some(e => e.code === 'LOOP_NO_DONE'), '…and a done the link names is no finding');
}
{ // a belt beside a junction that is not one of its links
  const props = [{ id: 'i', t: 'intake', x: 0, y: 0, w: 1, h: 1 }, { id: 's', t: 'splitter', x: 2, y: 0, w: 1, h: 1 }];
  const bl = [[1, 0, 'E'], [2, 0, 'E'], [3, 0, 'E'], [2, 1, 'S'], [2, -1, 'E']];
  const links = [{ id: 'l1', from: { prop: 'i', port: 'out' }, to: { prop: 's', port: 'in' }, path: path([[1, 0, 'E']]) },
    { id: 'l2', from: { prop: 's', port: 'out' }, to: { prop: null, port: 'in' }, path: path([[3, 0, 'E']]) },
    { id: 'l3', from: { prop: 's', port: 'out' }, to: { prop: null, port: 'in' }, path: path([[2, 1, 'S']]) }];
  const loosePlan = P.compileRoutingPlan({ props, belts: beltsOf(bl), links });
  A.ok(!loosePlan.belts['2,-1'] && !loosePlan.errors.some(e => e.code === 'JUNCTION_TOUCH'), 'linked: a LOOSE stray belt against the SPLITTER is in no plan — no lane, nothing to warn about (loose belts route nothing)');
  A.ok(!loosePlan.errors.some(e => e.code === 'SPLIT_ONE_LANE') && Object.keys(loosePlan.belts).length === 4, '…the splitter keeps exactly its two linked lanes');
  const passing = links.concat([{ id: 'l4', from: { prop: null, port: 'out' }, to: { prop: null, port: 'in' }, path: path([[2, -1, 'E']]) }]);
  const touch = P.compileRoutingPlan({ props, belts: beltsOf(bl), links: passing }).errors.filter(e => e.code === 'JUNCTION_TOUCH');
  A.eq(touch, [{ code: 'JUNCTION_TOUCH', propId: 's', tile: { x: 2, y: -1 }, warn: true }], 'a LINKED belt that brushes the SPLITTER is named where it touches (the junction would still read it as a lane)');
  A.ok(!P.compileRoutingPlan({ props, belts: beltsOf(bl) }).errors.some(e => e.code === 'JUNCTION_TOUCH'), 'the ring rule never says it (it cannot tell)');
  const d = P.deriveLinks({ props, belts: beltsOf(bl) });
  A.ok(!P.compileRoutingPlan({ props, belts: beltsOf(bl), links: d }).errors.some(e => e.code === 'JUNCTION_TOUCH'), '…and a derived floor never has one: every belt round a junction is one of its links');
}
{ // hookup reads stay total on odd links
  const props = [{ id: 'i', t: 'intake', x: 0, y: 0, w: 1, h: 1 }, { id: 'b', t: 'bay', x: 3, y: 0, w: 1, h: 1, agentId: 'nova' }];
  const bl = [[1, 0, 'E'], [2, 0, 'E']];
  A.notThrows(() => P.compileRoutingPlan({ props, belts: beltsOf(bl), links: [null, {}, { from: { prop: 'nope' }, to: {}, path: 'x' }, { id: 'l', from: { prop: 'i', port: 'out' }, to: { prop: 'b', port: 'in' }, path: path(bl) }] }), 'malformed links are skipped, never thrown on');
  const none = P.compileRoutingPlan({ props, belts: beltsOf(bl), links: [] });
  A.ok(!none.sources.length && !none.bays.length && none.errors.some(e => e.code === 'ORPHAN_SOURCE'), 'a linked floor with no links hooks nothing: no feed mouth, no belt dock');
}

A.report('conveyor-links.test');
