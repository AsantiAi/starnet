/* test/worldmodel-moveprops.test.js — WorldModel.moveProps, Build Mode's group move (sweep 2026-10-02).

   Member by member, a group move was judged against pieces that had not moved yet: a table and the lamp standing on it could
   not step sideways (the table was refused by its own lamp), and a linked line's belts were re-laid against neighbours still at
   their old spot, so a legal move was refused as LINK_LOST depending on the order the members went in. moveProps moves the
   whole group at once, checks each member where it lands (members never block each other: the move is rigid), and re-lays
   every link once, after all have moved. One undo; a refusal changes nothing. */
'use strict';
const A = require('./_assert.js');
const WM = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/pipeline.js');
const Sp = require('../frontend/app/propsprites.js');
WM.setPropRules(t => { const s = Sp.spec(t); return s ? { mount: s.mount || null, stack: !!s.stack, surface: !!s.surface, flat: !!s.flat } : null; });

const add = (st, o) => { const s = Sp.spec(o.t); const r = st.addProp(Object.assign({ w: s.w || 1, h: s.h || 1, block: s.blocks !== false }, o)); A.ok(r && r.ok, 'fixture: ' + o.t + ' placed (' + JSON.stringify(r) + ')'); return r.id; };

// 1. a table and what stands on it step sideways together
{
  const st = WM.create(WM.starterDoc());
  const T = add(st, { t: 'longtable', x: 3, y: 7 }), L = add(st, { t: 'plasmaglobe', x: 4, y: 7 });
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const before = JSON.stringify(st.serialize());
    const r = st.moveProps([T, L], dx, dy);
    A.ok(r && r.ok, 'a table and the lamp on it move together by (' + dx + ', ' + dy + '): ' + JSON.stringify(r));
    A.ok(st.propById(T).x === 3 + dx && st.propById(L).x === 4 + dx && st.propById(L).y === 7 + dy, '…both land where they were sent');
    A.ok(st.undo().ok && JSON.stringify(st.serialize()) === before, '…and one undo puts them both back');
  }
  // a member landing on a piece OUTSIDE the group is refused, and nothing moves
  const B = add(st, { t: 'plant', x: 9, y: 7 });
  const before = JSON.stringify(st.serialize());
  const hit = st.moveProps([T, L], 4, 0);
  A.ok(hit && !hit.ok && hit.error === 'OVERLAP', 'a group landing on another piece is refused: ' + JSON.stringify(hit));
  A.eq(JSON.stringify(st.serialize()), before, '…and nothing moved');
  A.ok(st.moveProps([T, L, B], 4, 0).ok, 'with that piece in the group it moves');
  const off = st.moveProps([T, L, B], 0, -40);
  A.ok(off && !off.ok && off.error === 'OFF_DECK', 'a group pushed off the deck is refused: ' + JSON.stringify(off));
}

// 2. a split → two bays → join line moves whole, whatever the order its members are listed in
{
  const plan = s => P.compileRoutingPlan(s.projectGeometry());
  const topo = s => JSON.stringify(Object.entries(plan(s).chains).sort().map(([k, v]) => [k, v.next, v.outbox]));
  const fresh = () => {
    const s = WM.create(); s.projectGeometry(); s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 56, y2: 16 } });
    const at = (t, x, y, w, h) => s.addProp({ t, x: 31 + x, y: 1 + y, w, h, block: w > 1 || h > 1 }).id;
    const I = at('intake', 0, 6, 2, 2), SP = at('splitter', 3, 7, 1, 1), BA = at('bay', 6, 3, 2, 2), BB = at('bay', 6, 9, 2, 2);
    const J = at('joiner', 10, 7, 1, 1), BC = at('bay', 13, 6, 2, 2), O = at('outbox', 16, 6, 2, 2);
    s.assignPropAgent(BA, 'a'); s.assignPropAgent(BB, 'b'); s.assignPropAgent(BC, 'c');
    for (const [a, b] of [[I, SP], [SP, BA], [SP, BB], [BA, J], [J, BC], [BC, O], [BB, J]]) A.ok(s.connectBelt(a, b).ok, 'fixture: belt laid');
    return { s, ids: [I, SP, BA, BB, J, BC, O] };
  };
  const orders = [ids => ids, ids => ids.slice().reverse(), ids => [ids[3], ids[0], ids[5], ids[1], ids[6], ids[2], ids[4]]];
  for (const ord of orders) {
    const { s, ids } = fresh(), before = JSON.stringify(s.serialize()), nl = s.links().length, t0 = topo(s);
    const r = s.moveProps(ord(ids), 2, -2);
    A.ok(r && r.ok, 'the whole line moves (2, -2), members in any order: ' + JSON.stringify(r && (r.msg || r.error)));
    A.eq(s.links().length, nl, '…every link is kept');
    A.eq(topo(s), t0, '…and the line routes exactly as before');
    A.ok(s.undo().ok && JSON.stringify(s.serialize()) === before, '…one undo puts it all back');
  }
}

A.report('worldmodel-moveprops.test');
