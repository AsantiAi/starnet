/* test/line-layout.test.js — THE LINE LAYOUT ENGINE (conveyor-links plan, phase C, 2026-09-29; Andrew: "merge it and start
   phase C").

   frontend/app/linelayout.js takes one line as a graph (machines + links) and the floor, and lays it out: where every
   machine stands, which belt every link rides. Locked here:
     ROUTES THE SAME — every blueprint, taken apart into its graph and laid out fresh, routes EXACTLY as the stamped
                       original: the same next step from every bay (for every task type), the same dispatch, the same
                       joins, copies, turn order, loop gates and escapes — and its links are ones the floor keeps.
     A REAL FLOOR    — belts only on clear deck, never under a machine, never on a belt already there; machines never
                       overlap; every belt tile points at the next.
     DETERMINISTIC   — the same graph and floor give the same layout, byte for byte.
     PINS NEVER MOVE — a machine the Commander placed stays exactly where it is; the rest of the line forms round it.
     IT FITS         — every blueprint lays out in a fresh station's starter room, or says how big a room it needs, and a
                       room that size grown beside the station takes it. */
'use strict';
const A = require('./_assert.js');
const P = require('../frontend/app/pipeline.js');
const WM = require('../frontend/app/worldmodel.js');
const LL = require('../frontend/app/linelayout.js');

const JUNC = { splitter: 1, filter: 1, merger: 1, joiner: 1, loop: 1 };
const TAGS = ['general', 'code', 'research'];
const key = (x, y) => x + ',' + y;

// a blueprint as the engine sees it: machines and the links between them (its derived links), nothing about tiles
function graphOf(bp) {
  const props = bp.props.map((p, i) => Object.assign({ id: 'n' + i }, p));
  const geo = { props, belts: bp.belts.map(b => ({ x: b.x, y: b.y, dir: b.d })) };
  const links = P.deriveLinks(geo).filter(l => !l.ring && l.from.prop != null && l.to.prop != null);
  const graph = { nodes: props.map(p => ({ id: p.id, t: p.t, w: p.w, h: p.h })),
    links: links.map(l => ({ id: l.id, from: { node: l.from.prop, port: l.from.port, tags: l.from.tags, else: l.from.else }, to: { node: l.to.prop } })) };
  return { geo, graph };
}
// what a floor DOES, keyed by machine: every bay's next step per task type, dispatch, joins/copies/loops, the findings
function routing(geo) {
  const plan = P.compileRoutingPlan(geo), jAt = {};
  for (const p of geo.props) if (JUNC[p.t]) jAt[key(p.x, p.y)] = p.id;
  const m = v => (v && typeof v === 'object') ? (v.dockId || null) : (v || null);
  const step = s => !s ? null : s.dockId ? { to: s.dockId }
    : s.branches ? { branches: s.branches.map(b => b.dockId).sort(), split: jAt[s.split] }
    : s.join ? { join: jAt[s.join], expect: s.expect, next: m(s.next) }
    : s.loop ? { loop: jAt[s.loop], max: s.max, backTo: m(s.backTo), esc: m(s.esc), next: m(s.next), when: s.when } : s;
  const out = { errors: plan.errors.map(e => e.code + (e.propId ? '@' + e.propId : '')).sort(), docks: {}, reach: {}, resolve: {}, steps: {}, junctions: {} };
  for (const d of Object.keys(plan.dockChains || {}).sort()) { const c = plan.dockChains[d]; out.docks[d] = { next: c.next.slice().sort(), outbox: !!c.outbox }; }
  for (const d of Object.keys(plan.reachDock || {}).sort()) out.reach[d] = plan.reachDock[d];
  for (const t of TAGS) { const r = P.resolveDock(plan, { tag: t }); out.resolve[t] = r ? r.dockId : null; }
  for (const d of Object.keys(plan.dockChains || {}).sort()) for (const t of TAGS) out.steps[d + '|' + t] = step(P.chainStepDock(plan, d, { tag: t, lineId: P.lineOfDock(plan, d) }, () => 0));
  const js = {};
  for (const k of Object.keys(plan.junctions)) { const j = plan.junctions[k], g = (plan.gateDocks || {})[k] || {}; js[jAt[k]] = { kind: j.kind, fanout: !!j.fanout, expect: j.expect || 0, max: j.max || 0, when: j.when || null, backTo: g.backTo || null, escTo: g.escTo || null }; }
  for (const id of Object.keys(js).sort()) out.junctions[id] = js[id];   // keyed by machine, in machine order (a moved line keeps its answer)
  return out;
}
const crew = props => props.map(p => p.t === 'bay' ? Object.assign({}, p, { agentId: 'a_' + p.id }) : p);
// a laid-out line as a floor: machines where the engine put them (compass config dropped — the links carry it), its belts, its links
function laidGeo(geo, L) {
  const props = geo.props.map(p => { const o = Object.assign({}, p, L.nodes[p.id]); delete o.routes; delete o.def; delete o.done; delete o.esc; return o; });
  return { props: crew(props), belts: L.belts.map(b => ({ x: b.x, y: b.y, dir: b.d })), links: L.links };
}
// the floor a real station offers: its deck, whatever stands on it, the belts already laid, the junctions on it
function floorOf(st) {
  const rects = []; for (const r of st.rooms()) for (const rc of r.rects) rects.push(rc);
  const belts = {}; for (const b of st.belts()) belts[key(b.x, b.y)] = b.dir;
  return { rects, blocked: st.props().map(p => ({ x: p.x, y: p.y, w: p.w || 1, h: p.h || 1 })), belts,
    junctions: st.props().filter(p => JUNC[p.t]).map(p => ({ x: p.x, y: p.y })) };
}
// the STATION's own rules take the layout: every machine passes its placement check, every belt tile its belt check
function stationTakes(name, st, geo, L) {
  const errs = [], laid = {};
  for (const b of st.belts()) laid[key(b.x, b.y)] = true;
  for (const p of geo.props) { const at = L.nodes[p.id], v = st.canPlaceProp(p.t, at.x, at.y, p.w || 1, p.h || 1); if (!v.ok) errs.push(p.t + ' ' + v.error); }
  for (const b of L.belts) { const v = st.canPlaceBeltRun({ tx: b.x, ty: b.y }, { tx: b.x, ty: b.y }); if (!v.ok || laid[key(b.x, b.y)]) errs.push('belt ' + key(b.x, b.y) + ' ' + (v.error || 'ON_BELT')); }
  A.eq(errs.slice(0, 4), [], name + ': the station itself takes it (every machine and belt passes its own placement check)');
}
function sane(name, geo, L, floor) {
  const foot = {}, errs = [];
  for (const p of geo.props) { const at = L.nodes[p.id]; for (let y = at.y; y < at.y + (p.h || 1); y++) for (let x = at.x; x < at.x + (p.w || 1); x++) { if (foot[key(x, y)]) errs.push('overlap ' + key(x, y)); foot[key(x, y)] = p.id; } }
  const onDeck = (x, y) => floor.rects.some(r => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2);
  const blocked = new Set(); for (const b of (floor.blocked || [])) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) blocked.add(key(x, y));
  const junctionTile = {}; for (const p of geo.props) if (JUNC[p.t]) junctionTile[key(L.nodes[p.id].x, L.nodes[p.id].y)] = true;
  for (const b of L.belts) {
    const k = key(b.x, b.y);
    if (!onDeck(b.x, b.y)) errs.push('belt off deck ' + k);
    if (blocked.has(k)) errs.push('belt under something already there ' + k);
    if ((floor.belts || {})[k]) errs.push('belt on a belt already laid ' + k);
    if (foot[k] && !junctionTile[k]) errs.push('belt under a machine ' + k);
  }
  for (const l of L.links) for (let i = 1; i < l.path.length; i++) {
    const a = l.path[i - 1], b = l.path[i], v = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] }[a.d];
    if (!v || a.x + v[0] !== b.x || a.y + v[1] !== b.y) errs.push('path breaks in ' + l.id);
  }
  A.eq(errs.slice(0, 4), [], name + ': a real floor (no overlaps, belts on clear deck, every arrow to the next tile)');
}

/* ---------- ROUTES THE SAME: every blueprint, laid out fresh ---------- */
const OPEN = { rects: [{ x1: 0, y1: 0, x2: 79, y2: 39 }], blocked: [], belts: {} };
for (const bp of WM.BLUEPRINTS) {
  const { geo, graph } = graphOf(bp);
  const L = LL.layout(graph, OPEN);
  A.ok(L.ok, bp.id + ': lays out on an open deck' + (L.ok ? '' : ' — ' + JSON.stringify(L)));
  if (!L.ok) continue;
  const g2 = laidGeo(geo, L);
  A.eq(routing(g2), routing({ props: crew(geo.props), belts: geo.belts }), bp.id + ': routes EXACTLY as the stamped original (every step, dispatch, join, copy, turn and loop)');
  // (reconcileLinks is phase B's — it runs once this lane is synced past it)
  if (typeof P.reconcileLinks === 'function') { const r = P.reconcileLinks(g2); A.ok(r.dropped.length === 0 && r.added.length === 0, bp.id + ': every link it lays is one the floor keeps'); }
  const meets = l => { const a = geo.props.find(p => p.id === l.from.prop), b = geo.props.find(p => p.id === l.to.prop), pa = L.nodes[a.id], pb = L.nodes[b.id], f = l.path[0], t = l.path[l.path.length - 1];
    const inBox = (p, q, n) => q.x >= p.x - 1 && q.x <= p.x + (n.w || 1) && q.y >= p.y - 1 && q.y <= p.y + (n.h || 1), adj = (p, q) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1;
    return (JUNC[a.t] ? adj(pa, f) : inBox(pa, f, a)) && (JUNC[b.t] ? adj(pb, t) : inBox(pb, t, b)); };
  A.ok(L.links.every(meets), bp.id + ': every link leaves its machine and arrives at the next (a side, or beside a junction)');
  sane(bp.id, geo, L, OPEN);
  A.eq(JSON.stringify(LL.layout(graph, OPEN)), JSON.stringify(L), bp.id + ': the same graph and floor give the same layout');
}

/* ---------- the shape of a line ---------- */
{
  const { graph } = graphOf(WM.BLUEPRINTS.find(b => b.id === 'second_opinion'));
  const L = LL.layout(graph, OPEN), y = id => L.nodes[id].y, x = id => L.nodes[id].x;
  const byT = t => graph.nodes.filter(n => n.t === t).map(n => n.id);
  const [I] = byT('intake'), [S] = byT('splitter'), [J] = byT('joiner'), [O] = byT('outbox'), bays = byT('bay');
  A.ok(x(I) < x(S) && x(S) < x(bays[0]) && x(bays[0]) < x(J) && x(J) < x(O), 'left to right in step order: INBOX, SPLITTER, the branches, JOINER, OUTBOX');
  A.ok(y(bays[0]) !== y(bays[1]) && Math.min(y(bays[0]), y(bays[1])) < y(S) && Math.max(y(bays[0]), y(bays[1])) > y(S), 'the branches stack above and below the splitter');
  A.ok(y(J) === y(S), 'the JOINER sits back on the middle line');
  A.eq(x(bays[0]) - (x(S) + 1), 2, 'two clear tiles between neighbours');
  const loop = graphOf(WM.BLUEPRINTS.find(b => b.id === 'revision_loop')).graph, LLp = LL.layout(loop, OPEN);
  const lp = loop.nodes.find(n => n.t === 'loop').id, w = loop.nodes.find(n => n.t === 'bay').id;
  A.ok(LLp.nodes[w].x < LLp.nodes[lp].x, 'a LOOP’s way back never pushes a step right: the WRITER stays before the gate');
  const back = LLp.links.find(l => l.from.prop === lp && l.to.prop === w);
  A.ok(back && Math.min(...back.path.map(t => t.y)) < Math.min(...loop.nodes.map(n => LLp.nodes[n.id].y)), '…and the way back goes round over the top of the line');
}

/* ---------- PINS NEVER MOVE ---------- */
{
  const { geo, graph } = graphOf(WM.BLUEPRINTS.find(b => b.id === 'revision_loop'));
  const w = graph.nodes.find(n => n.t === 'bay').id;
  const pinned = { nodes: graph.nodes.map(n => n.id === w ? Object.assign({}, n, { pin: { x: 30, y: 20 } }) : n), links: graph.links };
  const L = LL.layout(pinned, OPEN);
  A.ok(L.ok && L.nodes[w].x === 30 && L.nodes[w].y === 20, 'a pinned WRITER stays exactly where it was put');
  A.eq(routing(laidGeo(geo, L)), routing({ props: crew(geo.props), belts: geo.belts }), '…and the line formed round it routes the same');
  sane('pinned', geo, L, OPEN);
  // two pins far from where the layout would put them: both stay, the rest steps round them
  const nodes2 = graph.nodes.map(n => n.t === 'outbox' ? Object.assign({}, n, { pin: { x: 60, y: 30 } }) : n.id === w ? Object.assign({}, n, { pin: { x: 30, y: 20 } }) : n);
  const L2 = LL.layout({ nodes: nodes2, links: graph.links }, OPEN), o = graph.nodes.find(n => n.t === 'outbox').id;
  A.ok(L2.ok && L2.nodes[w].x === 30 && L2.nodes[w].y === 20 && L2.nodes[o].x === 60 && L2.nodes[o].y === 30, 'two pins, both kept exactly');
  if (L2.ok) sane('two pins', geo, L2, OPEN);
}

/* ---------- A REAL FLOOR: what is already there is never built over ---------- */
{
  const { geo, graph } = graphOf(WM.BLUEPRINTS.find(b => b.id === 'triage_desk'));
  const floor = { rects: [{ x1: 0, y1: 0, x2: 39, y2: 19 }], blocked: [{ x: 3, y: 3, w: 2, h: 2 }, { x: 10, y: 8, w: 1, h: 6 }], belts: { '20,2': 'E', '21,2': 'E' } };
  const L = LL.layout(graph, floor);
  A.ok(L.ok, 'a line lays out round what already stands on the deck');
  if (L.ok) { sane('cluttered deck', geo, L, floor); A.eq(routing(laidGeo(geo, L)), routing({ props: crew(geo.props), belts: geo.belts }), '…and routes the same'); }
  const tiny = LL.layout(graph, { rects: [{ x1: 0, y1: 0, x2: 7, y2: 5 }] });
  A.ok(!tiny.ok && tiny.error === 'NO_ROOM' && tiny.needs && (tiny.needs.w > 8 || tiny.needs.h > 6), 'a deck too small says so — and how big a room the line needs (' + JSON.stringify(tiny.needs) + ')');
}

/* ---------- A CLUTTERED DECK: furniture and old belt runs everywhere, lines still form — and still route the same ---------- */
{
  // a fixed scatter (a plain LCG, so every run sees the same decks): crates on a loose grid, a few six-tile belt runs
  const clutter = k => {
    let seed = 1000 + k; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const blocked = [], belts = {};
    for (let y = 1; y < 34; y += 4) for (let x = 1; x < 58; x += 4) if (rnd() < 0.35) blocked.push({ x: x + Math.floor(rnd() * 2), y: y + Math.floor(rnd() * 2), w: 1 + Math.floor(rnd() * 2), h: 1 + Math.floor(rnd() * 2) });
    for (let i = 0; i < 6; i++) { let x = Math.floor(rnd() * 50), y = Math.floor(rnd() * 34); const d = rnd() < 0.5 ? 'E' : 'S'; for (let j = 0; j < 6; j++) { belts[key(x, y)] = d; if (d === 'E') x++; else y++; } }
    return { rects: [{ x1: 0, y1: 0, x2: 59, y2: 35 }], blocked, belts, junctions: [] };
  };
  let tried = 0, laid = 0;
  const wrong = [];
  for (let k = 0; k < 4; k++) {
    const floor = clutter(k), fl = LL._internals.floorOf(floor);
    for (const bp of WM.BLUEPRINTS) {
      const { geo, graph } = graphOf(bp), want = JSON.stringify(routing({ props: crew(geo.props), belts: geo.belts }));
      // one machine pinned where the Commander might have put it: the clear spot nearest the middle of the deck
      const i = k % graph.nodes.length, n = graph.nodes[i], w = n.w || (JUNC[n.t] ? 1 : 2), h = n.h || w;
      let pin = null;
      for (let r = 0; r < 20 && !pin; r++) for (let dy = -r; dy <= r && !pin; dy++) for (let dx = -r; dx <= r && !pin; dx++) {
        let c = true; for (let yy = 16 + dy; yy < 16 + dy + h; yy++) for (let xx = 20 + dx; xx < 20 + dx + w; xx++) if (!fl.free(xx, yy) || fl.inflow(xx, yy)) c = false;
        if (c) pin = { x: 20 + dx, y: 16 + dy };
      }
      for (const g of [graph, { nodes: graph.nodes.map((m, j) => j === i ? Object.assign({}, m, { pin }) : m), links: graph.links }]) {
        tried++;
        const L = LL.layout(g, floor);
        if (!L.ok) continue;
        laid++;
        if (g !== graph && (L.nodes[n.id].x !== pin.x || L.nodes[n.id].y !== pin.y)) wrong.push(bp.id + ': the pin moved');
        if (JSON.stringify(routing(laidGeo(geo, L))) !== want) wrong.push(bp.id + (g === graph ? '' : ' (pinned)') + ' deck ' + k + ': routes differently');
        sane(bp.id + ' on cluttered deck ' + k + (g === graph ? '' : ' (pinned)'), geo, L, floor);
      }
    }
  }
  A.eq(wrong, [], 'on a cluttered deck every line it lays routes EXACTLY as the original, and pins stay put');
  // (the misses: a BAY pinned just above an old belt run, the rest of the line anchored below it in a pocket that belt
  // closes — two of its belts cannot both get out; the answer names the link, it never lays a line that routes wrong)
  A.ok(laid >= Math.ceil(tried * 0.95), 'and it lays out ' + laid + ' of ' + tried + ' (every blueprint, free and with one machine pinned, on four cluttered decks)');
}

/* ---------- A JUNCTION AGAINST A WALL: its lanes keep their order, or it says no ---------- */
{
  // pin every junction on an open deck with ONE side blocked, each side in turn. A junction carrying three links still
  // seats them (its lanes re-sided so a SPLITTER's turns and a FILTER's fallback keep their order); one carrying four
  // cannot — and the answer is NO_ROUTE, never a line that quietly routes differently.
  let three = 0, threeOk = 0, four = 0, fourRefused = 0;
  const wrong = [];
  for (const bp of WM.BLUEPRINTS) {
    const { geo, graph } = graphOf(bp), want = JSON.stringify(routing({ props: crew(geo.props), belts: geo.belts }));
    const an = LL._internals.analyze(graph);
    graph.nodes.forEach((n, i) => {
      if (!JUNC[n.t]) return;
      const deg = an.inn[n.id].length + an.out[n.id].length;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const pin = { x: 30, y: 18 }, floor = { rects: [{ x1: 0, y1: 0, x2: 79, y2: 39 }], blocked: [{ x: pin.x + dx, y: pin.y + dy, w: 1, h: 1 }], belts: {} };
        const L = LL.layout({ nodes: graph.nodes.map((m, j) => j === i ? Object.assign({}, m, { pin }) : m), links: graph.links }, floor);
        if (deg >= 4) { four++; if (!L.ok && L.error === 'NO_ROUTE') fourRefused++; continue; }
        three++;
        if (!L.ok) continue;
        threeOk++;
        if (JSON.stringify(routing(laidGeo(geo, L))) !== want) wrong.push(bp.id + ' ' + n.t + ' blocked ' + dx + ',' + dy);
      }
    });
  }
  A.eq(wrong, [], 'a junction against a wall never reorders its lanes: every line laid round one routes EXACTLY as the original');
  A.ok(three > 0 && threeOk === three, 'a junction with three links and one side blocked always seats them (' + threeOk + '/' + three + ')');
  A.ok(four > 0 && fourRefused === four, 'a junction with four links and one side blocked says NO_ROUTE (' + fourRefused + '/' + four + ')');
  // …and one asked to carry five links (a junction has four sides) is named, with the reason
  const five = LL.layout({ nodes: [{ id: 's', t: 'splitter' }, { id: 'i', t: 'intake' }].concat(['a', 'b', 'c', 'd'].map(id => ({ id, t: 'bay' }))),
    links: [{ from: { node: 'i' }, to: { node: 's' } }].concat(['a', 'b', 'c', 'd'].map(id => ({ from: { node: 's' }, to: { node: id } }))) }, OPEN);
  A.ok(!five.ok && five.error === 'NO_ROUTE' && five.why === 'SIDES' && five.node === 's', 'a SPLITTER with five links cannot seat them — the answer names it and why (' + JSON.stringify(five) + ')');
}

/* ---------- IT FITS: the starter room, or a room grown for it ---------- */
{
  const grown = [];
  for (const bp of WM.BLUEPRINTS) {
    const st = WM.create(WM.starterDoc()), { geo, graph } = graphOf(bp);
    let floor = floorOf(st), L = LL.layout(graph, floor);
    if (!L.ok) {
      A.ok(L.error === 'NO_ROOM' && L.needs, bp.id + ': too big for the starter room, it says how big a room it needs');
      // MAKE ROOM's rule (build.js makeRoomFor): the line's size plus a tile of walking room round it, touching the station
      const W = L.needs.w + 2, H = L.needs.h + 2, b = st.bounds(), r = st.addRoom({ kind: 'hab', rect: { x1: b.maxTx + 1, y1: b.minTy, x2: b.maxTx + W, y2: b.minTy + H - 1 } });
      A.ok(r.ok, bp.id + ': a ' + W + '×' + H + ' room beside the station is legal');
      floor = floorOf(st); L = LL.layout(graph, floor);
      grown.push(bp.id);
    }
    A.ok(L.ok, bp.id + ': lays out in the starter room or the room grown for it');
    if (L.ok) { sane(bp.id + ' (starter station)', geo, L, floor); stationTakes(bp.id, st, geo, L); }
  }
  // …and the engine packs lines at least as tightly as the hand-drawn blueprints: no fewer fit a fresh starter room
  const handFit = WM.BLUEPRINTS.filter(bp => { const st = WM.create(WM.starterDoc()), z = st.rooms()[0].rects[0]; for (let y = z.y1; y <= z.y2; y++) for (let x = z.x1; x <= z.x2; x++) if (st.canPlaceBlueprint(bp.id, x, y).ok) return true; return false; }).length;
  const engineFit = WM.BLUEPRINTS.length - grown.length;
  A.ok(engineFit >= handFit, engineFit + ' of ' + WM.BLUEPRINTS.length + ' lines fit the starter room as it is — no fewer than the ' + handFit + ' hand-drawn blueprints that do');
}

A.report('line-layout.test');
