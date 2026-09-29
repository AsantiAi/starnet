/* frontend/app/linelayout.js — THE LINE LAYOUT ENGINE (conveyor-links plan, phase C, 2026-09-29).

   Pure, zero-dep, UMD (node tests + the browser). Takes ONE line as a graph — its machines and the links between
   them — plus the floor it has to fit on, and answers where every machine stands and which belt every link rides:

     LineLayout.layout(graph, floor)
       -> { ok: true, nodes: { id: { x, y } }, links: [{ id, from, to, path: [{ x, y, d }] }], belts: [{ x, y, d }], box }
       -> { ok: false, error, needs?: { w, h } }        (needs: the room a line this size would take — MAKE ROOM's input)

     graph = { nodes: [{ id, t, w?, h?, pin?: { x, y } }],
               links: [{ id?, from: { node, port?, tags?, else? }, to: { node } }] }
     floor = { rects: [{ x1, y1, x2, y2 }]  (the deck, inclusive),
               blocked: [{ x, y, w, h }]     (whatever already stands there),
               belts: { 'x,y': dir }         (belts already laid),
               junctions: [{ x, y }]         (other lines' junctions — no new belt is laid beside one) }

   HOW A LINE IS DRAWN
     · left to right in step order: a machine's column is its longest path from the line's start, counting forward
       links only — a LOOP's way back (and any link that closes a cycle) never pushes a step to the right;
     · branches stacked: a SPLITTER's or FILTER's outputs spread above and below it, a LOOP's escape drops below, and a
       machine fed by several branches (a JOINER, a MERGER) sits back on their middle line;
     · two clear tiles between neighbours, so the belt between them is a straight run whose last tile belongs to the
       machine it feeds alone;
     · every belt is found on the grid (lowest cost first): a bend costs more than a step, a tile beside a third machine
       costs a little (tidy lines), and the BELT tool's connect rules hold — never on a machine or another belt, never
       beside a junction it does not serve, a junction entered and left through its four sides, and a lane into a BAY
       ending on a tile of that bay's alone. The line's main run is laid first; ways back go round it last.
   WHERE IT GOES
     · a PINNED machine (one the Commander placed or dragged) never moves: the line is laid out around the first pin,
       and a machine that would land on a pin, or off the deck, steps to the nearest clear lane;
     · with nothing pinned, the first clear spot on the floor that holds the whole line (rows top first, then columns)
       takes it; when no spot can, the answer says how big a room would (`needs`).
   DETERMINISM: no Math.random, no clock, every walk in a fixed order — the same graph and floor give the same layout. */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.LineLayout = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIRV = { E: [1, 0], S: [0, 1], W: [-1, 0], N: [0, -1] };
  const ORDER = ['E', 'S', 'W', 'N'];
  const BOX = { intake: 1, bay: 1, outbox: 1 };
  const JUNCTION = { splitter: 1, filter: 1, merger: 1, joiner: 1, loop: 1 };
  const GAP_X = 2;          // clear tiles between neighbouring columns (the straight belt between them)
  const PITCHES = [2, 3, 4];  // rows from one lane's belt row to the next — tightest first (2: branches stacked edge to edge,
                              // the way the hand-drawn lines pack them); a looser one only when the tight one cannot route
  const BEND = 2, NEAR = 1; // routing costs on top of 1 per step
  const key = (x, y) => x + ',' + y;
  const dirTo = (a, b) => (b.x > a.x ? 'E' : b.x < a.x ? 'W' : b.y > a.y ? 'S' : 'N');
  const sizeOf = n => (n.w && n.h) ? [n.w | 0, n.h | 0] : (JUNCTION[n.t] ? [1, 1] : [2, 2]);

  /* ---------- 1. the graph: which links run forward, each machine's column and lane ---------- */
  function analyze(graph) {
    const nodes = {}, order = [];
    for (const n of ((graph && graph.nodes) || [])) {
      if (!n || n.id == null || nodes[n.id] || !(BOX[n.t] || JUNCTION[n.t])) continue;
      const [w, h] = sizeOf(n);
      nodes[n.id] = { id: n.id, t: n.t, w, h, pin: (n.pin && isFinite(n.pin.x) && isFinite(n.pin.y)) ? { x: n.pin.x | 0, y: n.pin.y | 0 } : null, i: order.length };
      order.push(n.id);
    }
    const links = [];
    ((graph && graph.links) || []).forEach((l, i) => {
      if (!l || !l.from || !l.to) return;
      const a = l.from.node, b = l.to.node;
      if (!nodes[a] || !nodes[b] || a === b) return;
      links.push({ idx: i, id: l.id != null ? l.id : 'l' + (i + 1), from: l.from, to: l.to, a, b });
    });
    const out = {}, inn = {};
    for (const id of order) { out[id] = []; inn[id] = []; }
    for (const l of links) { out[l.a].push(l); inn[l.b].push(l); }
    // BACK LINKS: a port named 'back', and every link that closes a cycle in a depth-first walk from the line's start
    // (INBOXes first, then any machine nothing feeds, then whatever is left) — so a LOOP's way round never counts forward
    const back = new Set(links.filter(l => l.from.port === 'back'));
    const color = {};
    const roots = order.slice().sort((p, q) => {
      const rp = inn[p].length ? 2 : nodes[p].t === 'intake' ? 0 : 1, rq = inn[q].length ? 2 : nodes[q].t === 'intake' ? 0 : 1;
      return rp - rq || nodes[p].i - nodes[q].i;
    });
    for (const r of roots) {
      if (color[r]) continue;
      color[r] = 1;
      const stack = [{ id: r, k: 0 }];
      while (stack.length) {
        const f = stack[stack.length - 1], ls = out[f.id];
        if (f.k >= ls.length) { color[f.id] = 2; stack.pop(); continue; }
        const l = ls[f.k++];
        if (back.has(l)) continue;
        if (color[l.b] === 1) { back.add(l); continue; }
        if (!color[l.b]) { color[l.b] = 1; stack.push({ id: l.b, k: 0 }); }
      }
    }
    const fwd = l => !back.has(l);
    // COLUMNS: the longest forward path from the start (Kahn's order, ties by node order)
    const indeg = {}, rank = {}, topo = [];
    for (const id of order) { indeg[id] = inn[id].filter(fwd).length; rank[id] = 0; }
    const ready = order.filter(id => !indeg[id]);
    while (ready.length) {
      ready.sort((p, q) => nodes[p].i - nodes[q].i);
      const id = ready.shift();
      topo.push(id);
      for (const l of out[id]) {
        if (!fwd(l)) continue;
        rank[l.b] = Math.max(rank[l.b], rank[id] + 1);
        if (--indeg[l.b] === 0) ready.push(l.b);
      }
    }
    for (const id of order) if (topo.indexOf(id) < 0) topo.push(id);   // (unreachable in a DAG — kept total)
    // LANES: the start spreads around lane 0; a branch point's outputs spread around its own lane (a LOOP keeps its
    // done lane and drops its escape below); a machine fed by several branches sits back on their middle lane
    const spread = (k, i) => {
      const offs = [];
      for (let d = 1; offs.length < k; d++) offs.push(-d, d);
      const sym = (k % 2) ? [0].concat(offs.slice(0, k - 1)) : offs.slice(0, k);
      return sym.sort((a, b) => a - b)[i];
    };
    const lane = {}, taken = {};
    const claim = (id, want) => {
      let ln = want;
      for (let d = 0; ; d++) {
        const tryL = d === 0 ? want : (d % 2 ? want + ((d + 1) >> 1) : want - (d >> 1));
        if (!taken[rank[id] + '|' + tryL]) { ln = tryL; break; }
      }
      lane[id] = ln; taken[rank[id] + '|' + ln] = true;
    };
    const starts = topo.filter(id => !inn[id].some(fwd));
    starts.forEach((id, i) => claim(id, starts.length > 1 ? spread(starts.length, i) : 0));
    for (const id of topo) {
      if (lane[id] != null) continue;
      const parents = inn[id].filter(fwd).map(l => l.a).filter(p => lane[p] != null);
      if (!parents.length) { claim(id, 0); continue; }
      if (parents.length > 1) {
        // the middle of the lanes feeding it (an even count: the midpoint between the two middle ones, toward lane 0)
        const ls = parents.map(p => lane[p]).sort((a, b) => a - b), m = ls.length >> 1;
        claim(id, (ls.length % 2) ? ls[m] : Math.trunc((ls[m - 1] + ls[m]) / 2));
        continue;
      }
      const p = parents[0], kids = out[p].filter(fwd).map(l => l.b).filter((v, i, arr) => arr.indexOf(v) === i);
      const i = kids.indexOf(id);
      if (kids.length < 2) { claim(id, lane[p]); continue; }
      if (nodes[p].t === 'loop') {   // done (or the first exit) stays on the line; an escape drops below
        const doneKid = (out[p].find(l => fwd(l) && l.from.port === 'done') || {}).b;
        const rest = kids.filter(k => k !== doneKid);
        claim(id, id === doneKid ? lane[p] : lane[p] + 1 + rest.indexOf(id));
        continue;
      }
      /* which branch takes which side is not cosmetic: the compiler reads a junction's lanes E, S, W, N — a SPLITTER's
         first turn and a FILTER's fallback lane are the first of those — so the first link gets the side that order
         meets first (straight on, then below, then above, nearest first) and a line keeps the turn order it was drawn in */
      const offs = []; for (let j = 0; j < kids.length; j++) offs.push(spread(kids.length, j));
      const sideRank = o => (o === 0 ? 0 : o > 0 ? 1 + o / 100 : 2 - o / 100);
      offs.sort((p2, q2) => sideRank(p2) - sideRank(q2));
      claim(id, lane[p] + offs[i]);
    }
    return { nodes, order, links, out, inn, back, fwd, rank, lane, topo };
  }

  /* ---------- 2. relative geometry: columns by rank, rows by lane (null when this pitch makes machines overlap) ---------- */
  function arrange(a, pitch) {
    const colW = {};
    let maxR = 0;
    for (const id of a.order) { const r = a.rank[id]; maxR = Math.max(maxR, r); colW[r] = Math.max(colW[r] || 1, a.nodes[id].w); }
    const colX = { 0: 0 };
    for (let r = 1; r <= maxR; r++) colX[r] = colX[r - 1] + (colW[r - 1] || 1) + GAP_X;
    const pos = {};
    for (const id of a.order) {
      const n = a.nodes[id], row = a.lane[id] * pitch;
      pos[id] = { x: colX[a.rank[id]], y: row - (n.h - 1) };   // the machine's bottom row is its lane's belt row
    }
    const foot = {};
    for (const id of a.order) { const n = a.nodes[id], p = pos[id]; for (let y = p.y; y < p.y + n.h; y++) for (let x = p.x; x < p.x + n.w; x++) { if (foot[key(x, y)]) return null; foot[key(x, y)] = id; } }
    return pos;
  }

  /* ---------- the floor ---------- */
  function floorOf(floor) {
    const rects = (floor && floor.rects) || [];
    const blocked = new Set(), belts = new Set();
    for (const b of ((floor && floor.blocked) || [])) for (let y = b.y; y < b.y + (b.h || 1); y++) for (let x = b.x; x < b.x + (b.w || 1); x++) blocked.add(key(x, y));
    const beltDir = (floor && floor.belts) || {};
    for (const k in beltDir) belts.add(k);
    const junctions = new Set(((floor && floor.junctions) || []).map(j => key(j.x, j.y)));
    const onDeck = (x, y) => rects.some(r => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2);
    const free = (x, y) => onDeck(x, y) && !blocked.has(key(x, y)) && !belts.has(key(x, y));
    /* off limits to the new line even when clear: a tile an OLD belt runs into (that line's work would pour onto this
       one), and — for a belt — a tile beside another line's junction (that junction would read it as a lane) */
    const inflow = (x, y) => ORDER.some(d => { const nx = x + DIRV[d][0], ny = y + DIRV[d][1], bd = beltDir[key(nx, ny)]; return !!bd && nx + DIRV[bd][0] === x && ny + DIRV[bd][1] === y; });
    const nearJunction = (x, y) => ORDER.some(d => junctions.has(key(x + DIRV[d][0], y + DIRV[d][1])));
    return { rects, free, inflow, nearJunction };
  }

  /* ---------- 3. routing: one link, lowest cost first ---------- */
  function routeLink(l, at, a, used, fl, junctionTiles) {
    const A = a.nodes[l.a], B = a.nodes[l.b], pa = at[l.a], pb = at[l.b];
    const inFoot = (n, p, x, y) => x >= p.x && x < p.x + n.w && y >= p.y && y < p.y + n.h;
    const inBox = (n, p, x, y) => x >= p.x - 1 && x <= p.x + n.w && y >= p.y - 1 && y <= p.y + n.h;
    const footOfAny = {};
    for (const id of a.order) { const n = a.nodes[id], p = at[id]; for (let y = p.y; y < p.y + n.h; y++) for (let x = p.x; x < p.x + n.w; x++) footOfAny[key(x, y)] = id; }
    const nearJ = (x, y) => { const s = []; for (const d of ORDER) { const j = junctionTiles[key(x + DIRV[d][0], y + DIRV[d][1])]; if (j) s.push(j); } return s; };
    const open = (x, y) => fl.free(x, y) && !used.has(key(x, y)) && !footOfAny[key(x, y)] && !(fl.inflow && fl.inflow(x, y)) && !(fl.nearJunction && fl.nearJunction(x, y));
    const aJ = !!JUNCTION[A.t], bJ = !!JUNCTION[B.t];
    // a tile beside a junction serves only that junction, and only as the lane's own end
    const okNear = (x, y, role) => { const js = nearJ(x, y); if (!js.length) return true; return js.length === 1 && ((role === 'start' && aJ && js[0] === l.a) || (role === 'goal' && bJ && js[0] === l.b)); };
    const sideTiles = (n, p, corners) => {
      const t = [];
      for (let y = p.y - 1; y <= p.y + n.h; y++) for (let x = p.x - 1; x <= p.x + n.w; x++) {
        if (inFoot(n, p, x, y)) continue;
        const corner = (x < p.x || x >= p.x + n.w) && (y < p.y || y >= p.y + n.h);
        if (corner && !corners) continue;
        t.push({ x, y });
      }
      return t;
    };
    /* a junction's lane follows where the other end sits: a branch to a lane above leaves NORTH, below leaves SOUTH, one
       on its own lane runs straight EAST (and comes in from the WEST); a way back climbs out over the top. Taking the
       nearest free side instead let the first branch steal a straighter one's side and sent the last round the line. */
    const sideFor = (jId, otherId, out) => {
      const dl = a.lane[otherId] - a.lane[jId];
      if (a.back.has(l)) return out ? 'N' : 'S';
      return dl < 0 ? 'N' : dl > 0 ? 'S' : (out ? 'E' : 'W');
    };
    const around = (p, want) => {
      const all = ORDER.map(d => ({ d, x: p.x + DIRV[d][0], y: p.y + DIRV[d][1] }));
      return all.filter(t => t.d === want).concat(all.filter(t => t.d !== want));
    };
    let starts = (aJ ? around(pa, sideFor(l.a, l.b, true)) : sideTiles(A, pa, true)).filter(t => open(t.x, t.y) && okNear(t.x, t.y, 'start'));
    if (aJ && starts.length && starts[0].d === sideFor(l.a, l.b, true)) starts = [starts[0]];
    const own = B.t === 'bay' && !aJ;   // the tile work arrives on at a BAY is that bay's alone
    let goalList = (bJ ? around(pb, sideFor(l.b, l.a, false)) : sideTiles(B, pb, false))
      .filter(t => open(t.x, t.y) && okNear(t.x, t.y, 'goal') && !(own && inBox(A, pa, t.x, t.y)));
    if (bJ && goalList.length && goalList[0].d === sideFor(l.b, l.a, false)) goalList = [goalList[0]];
    const goals = new Set(goalList.map(t => key(t.x, t.y)));
    if (!starts.length || !goals.size) return null;
    // a tile in the ring of a machine that is neither end costs a little: belts keep clear of what they do not serve
    const nearOther = (x, y) => {
      for (const d of ORDER.concat(['NE', 'NW', 'SE', 'SW'])) {
        const v = d.length === 1 ? DIRV[d] : [DIRV[d[1]][0], DIRV[d[0]][1]];
        const id = footOfAny[key(x + v[0], y + v[1])];
        if (id != null && id !== l.a && id !== l.b) return true;
      }
      return false;
    };
    // Dijkstra over (tile, heading) with a binary heap — the grid is one line's worth of floor
    const heap = [], best = {}, prev = {};
    const push = (c, s) => { heap.push([c, s]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] < heap[i][0] || (heap[p][0] === heap[i][0] && heap[p][1] <= heap[i][1])) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l2 = 2 * i + 1, r2 = l2 + 1; let m = i; const lt = (u, v) => heap[u][0] < heap[v][0] || (heap[u][0] === heap[v][0] && heap[u][1] < heap[v][1]); if (l2 < heap.length && lt(l2, m)) m = l2; if (r2 < heap.length && lt(r2, m)) m = r2; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    for (const s of starts) { const st = key(s.x, s.y) + '|-'; if (best[st] == null) { best[st] = 0; prev[st] = null; push(0, st); } }
    let hit = null, guard = 0;
    while (heap.length && guard++ < 200000) {
      const [c, st] = pop();
      if (c !== best[st]) continue;
      const [tk, hd] = st.split('|'), q = tk.split(','), x = +q[0], y = +q[1];
      if (goals.has(tk)) { hit = st; break; }
      for (const d of ORDER) {
        const nx = x + DIRV[d][0], ny = y + DIRV[d][1], nk = key(nx, ny);
        if (!open(nx, ny)) continue;
        if (!okNear(nx, ny, goals.has(nk) ? 'goal' : 'mid')) continue;
        const nc = c + 1 + (hd !== '-' && hd !== d ? BEND : 0) + (nearOther(nx, ny) ? NEAR : 0);
        const ns = nk + '|' + d;
        if (best[ns] == null || nc < best[ns]) { best[ns] = nc; prev[ns] = st; push(nc, ns); }
      }
    }
    if (!hit) return null;
    const tiles = [];
    for (let s = hit; s; s = prev[s]) { const q = s.split('|')[0].split(','); tiles.unshift({ x: +q[0], y: +q[1] }); }
    const path = tiles.map((t, i) => ({ x: t.x, y: t.y, d: i + 1 < tiles.length ? dirTo(t, tiles[i + 1]) : null }));
    const last = path[path.length - 1];
    if (bJ) last.d = dirTo(last, pb);   // into the junction's tile
    else for (const d of ORDER) if (inFoot(B, pb, last.x + DIRV[d][0], last.y + DIRV[d][1])) { last.d = d; break; }   // into the machine
    if (!last.d) return null;
    return path;
  }

  // lay every link at one placement: the main run first (by column, then lane), ways back last
  function routeAll(a, at, fl) {
    const junctionTiles = {};
    for (const id of a.order) if (JUNCTION[a.nodes[id].t]) junctionTiles[key(at[id].x, at[id].y)] = id;
    const used = new Set(Object.keys(junctionTiles));
    const order = a.links.slice().sort((p, q) => (a.back.has(p) - a.back.has(q)) || (a.rank[p.a] - a.rank[q.a]) || (a.lane[p.a] - a.lane[q.a]) || (a.lane[p.b] - a.lane[q.b]) || (p.idx - q.idx));
    const paths = {};
    for (const l of order) {
      const path = routeLink(l, at, a, used, fl, junctionTiles);
      if (!path) return { ok: false, error: 'NO_ROUTE', link: l.id };
      for (const t of path) used.add(key(t.x, t.y));
      paths[l.id] = path;
    }
    return { ok: true, paths };
  }

  /* ---------- 4. where it goes ---------- */
  function boxOf(a, at, pad) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const id of a.order) { const n = a.nodes[id], p = at[id]; x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x + n.w - 1); y2 = Math.max(y2, p.y + n.h - 1); }
    return { x1: x1 - pad.l, y1: y1 - pad.t, x2: x2 + pad.r, y2: y2 + pad.b };
  }
  const shift = (rel, dx, dy) => { const o = {}; for (const id in rel) o[id] = { x: rel[id].x + dx, y: rel[id].y + dy }; return o; };

  function layout(graph, floor) {
    const a = analyze(graph);
    if (!a.order.length) return { ok: false, error: 'EMPTY' };
    const fl = floorOf(floor);
    const finish = (at, paths) => {
      const nodes = {};
      for (const id of a.order) nodes[id] = { x: at[id].x, y: at[id].y };
      const links = [], belts = [], seen = new Set();
      for (const l of a.links) {
        const path = paths[l.id];
        const from = { prop: l.a, port: l.from.port || 'out' };
        if (Array.isArray(l.from.tags) && l.from.tags.length) from.tags = l.from.tags.slice();
        if (l.from.else) from.else = true;
        links.push({ id: l.id, from, to: { prop: l.b, port: 'in' }, path: path.map(t => ({ x: t.x, y: t.y, d: t.d })) });
        for (const t of path) if (!seen.has(key(t.x, t.y))) { seen.add(key(t.x, t.y)); belts.push({ x: t.x, y: t.y, d: t.d }); }
      }
      // a junction's own tile is a belt too, aimed at its first way out (its arrow is the floor's, never the compiler's)
      for (const id of a.order) {
        if (!JUNCTION[a.nodes[id].t]) continue;
        const p = at[id], first = links.find(l => l.from.prop === id && l.path.length);
        const inl = links.find(l => l.to.prop === id && l.path.length);
        const d = first ? dirTo(p, first.path[0]) : inl ? inl.path[inl.path.length - 1].d : 'E';
        belts.push({ x: p.x, y: p.y, d });
      }
      return { ok: true, nodes, links, belts, box: boxOf(a, at, { l: 1, r: 1, t: 1, b: 1 }) };
    };
    // PINNED: the first pin anchors the line; every other machine steps to the nearest clear lane if it must, and the
    // belts are found on the real floor round what already stands there. Tightest lanes first, as below.
    const pinned = a.order.filter(id => a.nodes[id].pin);
    if (pinned.length) {
      let last = { ok: false, error: 'NO_SPACE' };
      for (const pitch of PITCHES) {
        const rel = arrange(a, pitch); if (!rel) continue;
        const p0 = pinned[0], at = shift(rel, a.nodes[p0].pin.x - rel[p0].x, a.nodes[p0].pin.y - rel[p0].y);
        for (const id of pinned) at[id] = { x: a.nodes[id].pin.x, y: a.nodes[id].pin.y };
        const occ = new Set();
        const mark = (id, p) => { const n = a.nodes[id]; for (let y = p.y - 1; y <= p.y + n.h; y++) for (let x = p.x - 1; x <= p.x + n.w; x++) occ.add(key(x, y)); };
        for (const id of pinned) mark(id, at[id]);
        const clear = (id, p) => { const n = a.nodes[id]; for (let y = p.y; y < p.y + n.h; y++) for (let x = p.x; x < p.x + n.w; x++) if (!fl.free(x, y) || occ.has(key(x, y)) || fl.inflow(x, y)) return false; return true; };
        let placed = true;
        for (const id of a.order) {
          if (a.nodes[id].pin) continue;
          let p = at[id];
          if (!clear(id, p)) {
            let found = null;
            for (let d = 1; d <= 12 && !found; d++) for (const sgn of [d, -d]) { const q = { x: p.x, y: p.y + sgn * pitch }; if (clear(id, q)) { found = q; break; } }
            if (!found) { placed = false; last = { ok: false, error: 'NO_SPACE', node: id }; break; }
            p = found;
          }
          at[id] = p; mark(id, p);
        }
        if (!placed) continue;
        const routed = routeAll(a, at, fl);
        if (routed.ok) return finish(at, routed.paths);
        last = { ok: false, error: routed.error, link: routed.link };
      }
      return last;
    }
    /* UNPINNED: route the line on an empty floor of its own first — that gives its exact SHAPE (every machine tile, every
       belt tile) — then put the shape at the first spot on the floor where every tile of it is clear, no old belt runs
       into it, and none of its belts sits beside another line's junction (rows top first, then columns). Tightest lanes
       first; the room a line needs is its tightest shape. A window with nothing in it at all (a prefix sum answers that
       at once) takes the shape without a tile-by-tile look. */
    if (!fl.rects.length) {
      for (const pitch of PITCHES) { const rel = arrange(a, pitch); if (!rel) continue; const b = boxOf(a, rel, { l: 0, r: 0, t: 0, b: 0 }); return { ok: false, error: 'NO_ROOM', needs: { w: b.x2 - b.x1 + 1, h: b.y2 - b.y1 + 1 } }; }
      return { ok: false, error: 'NO_ROUTE' };
    }
    let X1 = Infinity, Y1 = Infinity, X2 = -Infinity, Y2 = -Infinity;
    for (const r of fl.rects) { X1 = Math.min(X1, r.x1); Y1 = Math.min(Y1, r.y1); X2 = Math.max(X2, r.x2); Y2 = Math.max(Y2, r.y2); }
    const GW = X2 - X1 + 1, GH = Y2 - Y1 + 1, S = new Int32Array((GW + 1) * (GH + 1));
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++)
      S[(y + 1) * (GW + 1) + x + 1] = (fl.free(X1 + x, Y1 + y) && !fl.inflow(X1 + x, Y1 + y) && !fl.nearJunction(X1 + x, Y1 + y) ? 0 : 1) + S[y * (GW + 1) + x + 1] + S[(y + 1) * (GW + 1) + x] - S[y * (GW + 1) + x];
    const emptyWindow = (x, y, w, h) => { const u = x - X1, v = y - Y1; return S[(v + h) * (GW + 1) + u + w] - S[v * (GW + 1) + u + w] - S[(v + h) * (GW + 1) + u] + S[v * (GW + 1) + u] === 0; };
    let needs = null, routedAny = false;
    for (const pitch of PITCHES) {
      const rel = arrange(a, pitch); if (!rel) continue;
      const bb = boxOf(a, rel, { l: 3, r: 3, t: 3, b: 3 });
      const vacuum = { free: (x, y) => x >= bb.x1 && x <= bb.x2 && y >= bb.y1 && y <= bb.y2, inflow: () => false, nearJunction: () => false };
      const routed = routeAll(a, rel, vacuum);
      if (!routed.ok) continue;
      routedAny = true;
      const mach = [], belt = [], seen = new Set();
      for (const id of a.order) { const n = a.nodes[id], p = rel[id]; for (let y = p.y; y < p.y + n.h; y++) for (let x = p.x; x < p.x + n.w; x++) mach.push({ x, y }); }
      for (const lid in routed.paths) for (const t of routed.paths[lid]) if (!seen.has(key(t.x, t.y))) { seen.add(key(t.x, t.y)); belt.push(t); }
      let sx1 = Infinity, sy1 = Infinity, sx2 = -Infinity, sy2 = -Infinity;
      for (const t of mach.concat(belt)) { sx1 = Math.min(sx1, t.x); sy1 = Math.min(sy1, t.y); sx2 = Math.max(sx2, t.x); sy2 = Math.max(sy2, t.y); }
      const W = sx2 - sx1 + 1, H = sy2 - sy1 + 1;
      if (!needs) needs = { w: W, h: H };
      for (let y = Y1; y + H - 1 <= Y2; y++) for (let x = X1; x + W - 1 <= X2; x++) {
        const dx = x - sx1, dy = y - sy1;
        if (!emptyWindow(x, y, W, H)) {
          let ok = true;
          for (const t of mach) if (!fl.free(t.x + dx, t.y + dy) || fl.inflow(t.x + dx, t.y + dy)) { ok = false; break; }
          if (ok) for (const t of belt) { const bx = t.x + dx, by = t.y + dy; if (!fl.free(bx, by) || fl.inflow(bx, by) || fl.nearJunction(bx, by)) { ok = false; break; } }
          if (!ok) continue;
        }
        const at = shift(rel, dx, dy), paths = {};
        for (const lid in routed.paths) paths[lid] = routed.paths[lid].map(t => ({ x: t.x + dx, y: t.y + dy, d: t.d }));
        return finish(at, paths);
      }
    }
    return routedAny ? { ok: false, error: 'NO_ROOM', needs } : { ok: false, error: 'NO_ROUTE' };
  }

  return { layout, GAP_X, PITCHES, _internals: { analyze, arrange, routeLink, routeAll, floorOf, sizeOf } };
});
