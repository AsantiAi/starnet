/* frontend/app/lineedit.js — EDITING A LINE AS A GRAPH (conveyor-links plan, phase D, 2026-09-29).

   Pure, zero-dep, UMD (node tests + the browser). The Workflow panel builds lines through this: every edit is a change
   to the line's GRAPH (its machines and the links between them), laid out by the layout engine (linelayout.js) and
   written back by the station in ONE undo slot (worldmodel applyLineLayout).

     LineEdit.run(station, propId, op, args, opts)   -> { ok, focus, ids } | { ok: false, error, msg }
       propId  any machine of the line (null for NEW_LINE)
       op      'insertStep' | 'appendStep' | 'addBranch' | 'addLoop' | 'addSorter' | 'removeStep' | 'removeLoop' |
               'moveStep' | 'tidy' | 'newLine'
       opts    { near: { x, y } }  where a NEW line should go (the middle of the view), sizes: { bay: [w, h], … }

   ONLY WHAT CHANGED MOVES (the plan's decision 2): every machine already on the floor is pinned where it stands and every
   belt the edit does not touch is handed to the engine with its path, so it stays exactly where it is. TIDY LINE is the one
   edit that re-lays the whole line (anchored on its INBOX). Each op checks the line is the shape it expects and refuses in
   plain words when it is not — never a half-edit. */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.LineEdit = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const JUNCTION = { splitter: 1, filter: 1, merger: 1, joiner: 1, loop: 1 };
  const fail = (error, msg) => ({ ok: false, error, msg });
  const clone = o => JSON.parse(JSON.stringify(o));
  function layoutModule() {
    let L = (typeof LineLayout !== 'undefined') ? LineLayout : null;
    if (!L && typeof require === 'function') { try { L = require('./linelayout.js'); } catch (_) { L = null; } }
    return L;
  }

  /* ---------- graph helpers ---------- */
  const nodeOf = (g, id) => g.nodes.find(n => n.id === id) || null;
  // a LOOP's way back: its out-link that is neither DONE nor the escape (the compiler infers it the same way)
  const isBack = (g, l) => { const a = nodeOf(g, l.from.node); return !!a && a.t === 'loop' && l.from.port !== 'done' && l.from.port !== 'esc'; };
  const outsOf = (g, id) => g.links.filter(l => l.from.node === id && !isBack(g, l));
  const insOf = (g, id) => g.links.filter(l => l.to.node === id && !isBack(g, l));
  const backsAt = (g, id) => g.links.filter(l => isBack(g, l) && (l.to.node === id || l.from.node === id));
  const drop = (g, ls) => { g.links = g.links.filter(l => ls.indexOf(l) < 0); };
  // a fresh id for a new machine / link — '+' marks it new (the station numbers it for real when it is laid)
  function fresh(g) {
    let n = 0;
    const used = new Set(g.nodes.map(x => x.id).concat(g.links.map(x => x.id)));
    return p => { let id; do { id = '+' + p + (++n); } while (used.has(id)); used.add(id); return id; };
  }
  const sizeOf = (opts, t) => { const s = opts && opts.sizes && opts.sizes[t]; return JUNCTION[t] ? [1, 1] : (Array.isArray(s) ? s : [2, 2]); };
  function box(g, id, t, opts, extra) {
    const [w, h] = sizeOf(opts, t);
    const n = Object.assign({ id, t, w, h }, extra || {});
    if (JUNCTION[t]) n.block = false;   // a junction stands ON its belt (the catalog's blocks: false, as every blueprint stamps it)
    g.nodes.push(n);
    return n;
  }
  // a link keeps its id (and what it carries — a FILTER tag, a LOOP port) when only its far end changed; its belt is re-laid
  const relink = (l, to) => ({ id: l.id, from: clone(l.from), to: { node: to } });
  const link = (id, from, to, port) => ({ id, from: { node: from, port: port || 'out' }, to: { node: to } });
  const bayRole = r => (typeof r === 'string' && r) ? r : undefined;

  /* ---------- the edits ---------- */
  const OPS = {
    /* ADD A STEP between two machines one link joins: A → B becomes A → [new BAY] → B */
    insertStep(g, a, o) {
      const l = g.links.find(q => q.from.node === a.from && q.to.node === a.to);
      if (!l) return fail('NO_LINK', 'those two machines are not joined by a belt');
      const id = fresh(g);
      const N = box(g, id('n'), 'bay', o, { role: bayRole(a.role) });
      drop(g, [l]);
      g.links.push(relink(l, N.id), link(id('l'), N.id, l.to.node));
      return { ok: true, graph: g, focus: N.id };
    },
    /* ADD A STEP after a machine: onto its one way out, or — at the end of the line — as its new last step */
    appendStep(g, a, o) {
      const outs = outsOf(g, a.after);
      if (outs.length === 1) return OPS.insertStep(g, { from: a.after, to: outs[0].to.node, role: a.role }, o);
      if (outs.length > 1) return fail('MANY_WAYS', 'this machine sends work several ways: use a + on the belt you mean');
      const A = nodeOf(g, a.after);
      if (!A || A.t === 'outbox') return fail('LINE_END', 'nothing comes after the OUTBOX');
      const id = fresh(g);
      const N = box(g, id('n'), 'bay', o, { role: bayRole(a.role) });
      g.links.push(link(id('l'), A.id, N.id));
      return { ok: true, graph: g, focus: N.id };
    },
    /* ADD A BRANCH. Around a step X (A → X → B): A → SPLITTER → { X, new BAY … } → JOINER / MERGER → B. Between two machines
       (A → B): A → SPLITTER → { new BAYs } → JOINER / MERGER → B. COPY TO EACH brings a JOINER (every branch gets the job,
       their results are combined); TAKE TURNS brings a MERGER (each job goes to one branch). */
    addBranch(g, a, o) {
      const n = Math.max(2, Math.min(3, (a.n | 0) || 2)), joinT = a.mode === 'turns' ? 'merger' : 'joiner';
      const id = fresh(g);
      let head, tail, keep = [];
      if (a.around) {
        const X = nodeOf(g, a.around);
        if (!X || X.t !== 'bay') return fail('NOT_A_STEP', 'pick a step (a BAY) to branch around');
        const ins = insOf(g, X.id), outs = outsOf(g, X.id);
        if (ins.length !== 1 || outs.length !== 1) return fail('NOT_SIMPLE', 'a branch goes round a step with one way in and one way out');
        head = ins[0]; tail = outs[0]; keep = [X.id];
      } else {
        const l = g.links.find(q => q.from.node === a.from && q.to.node === a.to);
        if (!l) return fail('NO_LINK', 'those two machines are not joined by a belt');
        head = l; tail = null;
      }
      const S = box(g, id('s'), 'splitter', o), J = box(g, id('j'), joinT, o);
      const kids = keep.slice();
      while (kids.length < n) kids.push(box(g, id('n'), 'bay', o, { role: bayRole(a.role) }).id);
      drop(g, [head].concat(tail ? [tail] : []));
      g.links.push(relink(head, S.id));
      for (const k of kids) g.links.push(link(id('l'), S.id, k));
      for (const k of kids) g.links.push(tail && k === keep[0] ? { id: tail.id, from: clone(tail.from), to: { node: J.id } } : link(id('l'), k, J.id));
      g.links.push(link(id('l'), J.id, tail ? tail.to.node : a.to));
      return { ok: true, graph: g, focus: S.id };
    },
    /* ADD A REVIEW LOOP round a step X (X → B): X → REVIEWER → LOOP; the LOOP sends the work back to X until the reviewer
       approves (or it has gone round `max` times), then on to B */
    addLoop(g, a, o) {
      const X = nodeOf(g, a.around);
      if (!X || X.t !== 'bay') return fail('NOT_A_STEP', 'pick a step (a BAY) to review');
      const outs = outsOf(g, X.id);
      if (outs.length !== 1) return fail('NOT_SIMPLE', 'a review loop goes round a step with one way out');
      if (backsAt(g, X.id).length) return fail('HAS_LOOP', 'this step already has a review loop');
      const max = Math.max(1, Math.min(20, (a.max | 0) || 3)), when = typeof a.when === 'string' && a.when ? a.when : 'approved';
      const id = fresh(g), next = outs[0];
      const R = box(g, id('n'), 'bay', o, { role: 'REVIEWER' });
      const G = box(g, id('g'), 'loop', o, { cfg: { maxIter: max, when } });
      drop(g, [next]);
      g.links.push(relink(next, R.id), link(id('l'), R.id, G.id), link(id('l'), G.id, next.to.node, 'done'), link(id('l'), G.id, X.id, 'back'));
      return { ok: true, graph: g, focus: G.id };
    },
    /* ADD A SORTER between two machines (A → B, B a step or the OUTBOX): A → FILTER; CODE work → a new ENGINEER step, RESEARCH
       → a new RESEARCHER step, EVERYTHING ELSE straight on to B; the new steps hand on to B too */
    addSorter(g, a, o) {
      const l = g.links.find(q => q.from.node === a.from && q.to.node === a.to);
      if (!l) return fail('NO_LINK', 'those two machines are not joined by a belt');
      const B = nodeOf(g, a.to);
      if (!B || JUNCTION[B.t]) return fail('NOT_BEFORE_STEP', 'put a sorter in front of a step or the OUTBOX');
      const routes = Array.isArray(a.routes) && a.routes.length ? a.routes.slice(0, 2) : [{ tag: 'code', role: 'ENGINEER' }, { tag: 'research', role: 'RESEARCHER' }];
      const id = fresh(g);
      const F = box(g, id('f'), 'filter', o);
      drop(g, [l]);
      g.links.push(relink(l, F.id));
      for (const r of routes) {
        const N = box(g, id('n'), 'bay', o, { role: bayRole(r.role) });
        g.links.push({ id: id('l'), from: { node: F.id, port: 'out', tags: [String(r.tag)] }, to: { node: N.id } }, link(id('l'), N.id, B.id));
      }
      g.links.push({ id: id('l'), from: { node: F.id, port: 'out', else: true }, to: { node: B.id } });
      return { ok: true, graph: g, focus: F.id };
    },
    /* REMOVE A STEP: its way in joins its way out (A → X → B becomes A → B). A branch left with one way through folds away. */
    removeStep(g, a) {
      const X = nodeOf(g, a.id);
      if (!X || X.t !== 'bay') return fail('NOT_A_STEP', 'only a step (a BAY) is removed this way');
      if (backsAt(g, X.id).length) return fail('LOOP_ANCHOR', 'a review loop sends work back to this step: remove the loop first');
      const ins = insOf(g, X.id), outs = outsOf(g, X.id);
      if (ins.length !== 1 || outs.length > 1) return fail('NOT_SIMPLE', 'this step has several ways in or out: remove its branch instead');
      const A = nodeOf(g, ins[0].from.node), B = outs[0] ? nodeOf(g, outs[0].to.node) : null;
      g.nodes = g.nodes.filter(n => n.id !== X.id);
      drop(g, ins.concat(outs));
      // X was one branch of a split: that branch goes; a split left with one way through folds away (SPLITTER and JOINER
      // go, the last branch joins the line), and one left with none closes up (what fed the split feeds what the join fed)
      if (A && A.t === 'splitter' && B && (B.t === 'joiner' || B.t === 'merger')) {
        const sOut = outsOf(g, A.id), jIn = insOf(g, B.id), into = insOf(g, A.id)[0], onward = outsOf(g, B.id)[0];
        const one = sOut.length === 1 && jIn.length === 1 && sOut[0].to.node === jIn[0].from.node;
        if (!one && sOut.length) return { ok: true, graph: g, focus: A.id };
        g.nodes = g.nodes.filter(n => n.id !== A.id && n.id !== B.id);
        drop(g, [into, onward].concat(sOut, jIn).filter(Boolean));
        const keep = one ? sOut[0].to.node : null;
        if (into && (keep || onward)) g.links.push(relink(into, keep || onward.to.node));
        if (keep && onward) g.links.push({ id: onward.id, from: { node: keep, port: 'out' }, to: { node: onward.to.node } });
        return { ok: true, graph: g, focus: keep || (into && into.from.node) };
      }
      if (outs.length === 1) g.links.push(relink(ins[0], outs[0].to.node));
      return { ok: true, graph: g, focus: ins[0].from.node };
    },
    /* REMOVE A REVIEW LOOP: the LOOP gate and the REVIEWER step that fed it go; the step it reviewed hands straight on */
    removeLoop(g, a) {
      const G = nodeOf(g, a.id);
      if (!G || G.t !== 'loop') return fail('NOT_A_LOOP', 'pick a LOOP gate');
      const into = insOf(g, G.id), done = g.links.find(l => l.from.node === G.id && l.from.port === 'done');
      const back = g.links.filter(l => l.from.node === G.id && isBack(g, l));
      if (into.length !== 1 || !done) return fail('NOT_SIMPLE', 'this LOOP gate is not a plain review loop: remove its belts by hand');
      let from = into[0].from.node, R = nodeOf(g, from);
      const rIns = R ? insOf(g, R.id) : [];
      const drops = [into[0], done].concat(back), gone = [G.id];
      // the REVIEWER goes with its loop when it is the plain one the loop was added with (one way in, the loop its only way out)
      if (R && R.t === 'bay' && rIns.length === 1 && outsOf(g, R.id).length === 1 && !backsAt(g, R.id).length) { drops.push(rIns[0]); gone.push(R.id); }
      g.nodes = g.nodes.filter(n => gone.indexOf(n.id) < 0);
      drop(g, drops);
      if (gone.length === 2) g.links.push(relink(rIns[0], done.to.node));
      else g.links.push(relink(into[0], done.to.node));
      return { ok: true, graph: g, focus: gone.length === 2 ? rIns[0].from.node : from };
    },
    /* MOVE A STEP one place earlier (dir -1) or later (+1) along a plain run of steps: A → P → X → B becomes A → X → P → B, and
       two steps the same size swap places on the floor */
    moveStep(g, a) {
      const X = nodeOf(g, a.id), dir = a.dir < 0 ? -1 : 1;
      if (!X || X.t !== 'bay') return fail('NOT_A_STEP', 'pick a step (a BAY)');
      const plain = n => n && n.t === 'bay' && insOf(g, n.id).length === 1 && outsOf(g, n.id).length === 1 && !backsAt(g, n.id).length;
      if (!plain(X)) return fail('NOT_SIMPLE', 'only a step with one way in and one way out moves along the line');
      const other = dir < 0 ? nodeOf(g, insOf(g, X.id)[0].from.node) : nodeOf(g, outsOf(g, X.id)[0].to.node);
      if (!plain(other)) return fail('NO_NEIGHBOUR', dir < 0 ? 'there is no step before it to swap with' : 'there is no step after it to swap with');
      const [P, Q] = dir < 0 ? [other, X] : [X, other];   // P → Q becomes Q → P
      const inP = insOf(g, P.id)[0], mid = outsOf(g, P.id)[0], outQ = outsOf(g, Q.id)[0];
      drop(g, [inP, mid, outQ]);
      g.links.push(relink(inP, Q.id), { id: mid.id, from: { node: Q.id, port: 'out' }, to: { node: P.id } }, { id: outQ.id, from: { node: P.id, port: 'out' }, to: { node: outQ.to.node } });
      if (P.w === Q.w && P.h === Q.h && P.pin && Q.pin) { const t = P.pin; P.pin = Q.pin; Q.pin = t; }
      return { ok: true, graph: g, focus: X.id };
    },
    /* TIDY LINE: the whole line laid out afresh, anchored where its INBOX stands */
    tidy(g) {
      const anchor = g.nodes.find(n => n.t === 'intake') || g.nodes[0];
      if (!anchor) return fail('EMPTY', 'there is no line here');
      for (const n of g.nodes) if (n !== anchor) delete n.pin;
      for (const l of g.links) delete l.path;
      return { ok: true, graph: g, focus: anchor.id };
    },
    /* A NEW LINE: INBOX → one step → OUTBOX, placed on clear floor near the middle of the view */
    newLine(g, a, o) {
      const id = fresh(g);
      const I = box(g, id('i'), 'intake', o, a && a.label ? { label: a.label } : null);
      const N = box(g, id('n'), 'bay', o, { role: bayRole(a && a.role) });
      const O = box(g, id('o'), 'outbox', o);
      g.links.push(link(id('l'), I.id, N.id), link(id('l'), N.id, O.id));
      return { ok: true, graph: g, focus: I.id };
    },
  };

  /* ---------- a layout answer, in the Commander's words ---------- */
  function why(L) {
    if (L.error === 'NO_ROOM') return fail('NO_ROOM', 'there is no clear floor big enough for this line — MAKE ROOM, or clear some space');
    if (L.error === 'NO_SPACE') return fail('NO_SPACE', 'there is no clear floor next to the line for the new machine — clear a little space round it and try again');
    if (L.why === 'SIDES') return fail('NO_SIDES', 'a junction there has no free side for every belt it needs — clear the tiles round it, or TIDY LINE');
    if (L.why === 'LANE_ORDER') return fail('NO_ROUTE', 'the belts could not keep this junction\'s lanes in order here — TIDY LINE, or clear space round it');
    return fail('NO_ROUTE', 'a belt could not find a way round what stands there — clear a path, or TIDY LINE');
  }

  /* ---------- run an edit on a station: graph → layout → one undo slot ---------- */
  function run(station, propId, op, args, opts) {
    const LL = layoutModule();
    if (!LL) return fail('NO_ENGINE', 'the layout engine is not loaded');
    if (!OPS[op]) return fail('BAD_OP', 'no such edit');
    if (!station || typeof station.lineGraph !== 'function') return fail('NO_STATION', 'this station cannot edit lines');
    const g = station.lineGraph(op === 'newLine' ? null : propId);
    if (!g || !g.ok) return g || fail('NOT_LINKED', 'this line cannot be edited here');
    const e = OPS[op](clone(g.graph), args || {}, opts || {});
    if (!e.ok) return e;
    const L = LL.layout(e.graph, g.floor, { near: opts && opts.near });
    if (!L.ok) return why(L);
    const r = station.applyLineLayout(e.graph, L);
    if (!r || !r.ok) return r || fail('NOT_APPLIED', 'the edit could not be laid');
    return { ok: true, focus: (r.ids && r.ids[e.focus]) || e.focus, ids: r.ids, removed: r.removed || [] };
  }
  // the same edit, answered without laying anything (the panel greys out what would only fail)
  function check(station, propId, op, args, opts) {
    const g = station && typeof station.lineGraph === 'function' ? station.lineGraph(op === 'newLine' ? null : propId) : null;
    if (!g || !g.ok) return g || fail('NOT_LINKED', 'this line cannot be edited here');
    return OPS[op] ? OPS[op](clone(g.graph), args || {}, opts || {}) : fail('BAD_OP', 'no such edit');
  }

  return { run, check, OPS, _internals: { why, isBack, outsOf, insOf } };
});
