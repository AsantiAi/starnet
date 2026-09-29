/* StationBuilder — the lead agent builds a room and a ready-made line EXACTLY (2026-09-29, the Agent Station Builder plan).

   WHY IT IS SHAPED THIS WAY: models are bad at spatial layout, and a weak one laying belts by hand would break a
   Commander's station. So the model never sends a position, a belt or a piece of furniture. It fills a FIXED MENU —
   one of the Lines shelf's tested lines, where it goes, a name, what each step does and who works it, a daily spending
   cap, review tries — and StarNet does all the placing with the same code Build mode uses (roomSpots, stampBlueprint).

   plan(doc, request, env) builds the request on a PROBE COPY and checks it: every new machine reachable, no new routing
   error anywhere, every existing line's compiled routing unchanged. It returns a plain summary and the new line's
   readiness (WorkflowLine.readiness — the Workflow panel's own blocking list). It never touches the live station.
   apply(station, plan, env) replays EXACTLY those edits on the live station inside ONE transact (one undo slot,
   all-or-nothing): it refuses when the floor changed since the plan, and undoes itself if the result differs from the
   plan by a single tile. Add-only: nothing already on the station can be moved, changed or removed.

   env = { WorldModel, Pipeline, WorkflowLine, crew: [{ id, name }], heroId }. Pure: no DOM, no clock, no globals. */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.StationBuilder = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MENU = ['line', 'where', 'name', 'steps', 'dailyCap', 'tries'];
  const STEP_KEYS = ['step', 'role', 'instructions', 'agent'];
  const LEAD_WORDS = { lead: 1, me: 1, you: 1, yourself: 1, overseer: 1, hero: 1 };
  const MIN_W = 12, MIN_H = 7, MAX_TRIES_IN_ROOM = 600;
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const clone = o => JSON.parse(JSON.stringify(o));
  const refuse = (error, extra) => Object.assign({ ok: false, error }, extra || {});
  const titleCase = s => String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  /* a floor fingerprint over what an edit can change (never meta or derived links), in CANONICAL form: object keys
     sorted, because a live prop that gained agentId after role and the same prop read back from a save (migrate
     normalizes key order) are the same floor */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function sigOf(doc) {
    const s = canon([doc._nid, doc.order, doc.rooms, doc.props, doc.belts, doc.edges || []]);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16) + ':' + s.length;
  }

  /* THE MENU, read from the shelf catalog (WorldModel.BLUEPRINTS) — never hand-kept here, so a new shelf line is a new
     choice and a removed one can never be built. */
  function catalog(WM) {
    return (WM.BLUEPRINTS || []).map(bp => ({
      id: bp.id, name: bp.plain || bp.label, label: bp.label, work: bp.work || null,
      roles: bp.props.filter(p => p.t === 'bay').map(p => p.role || 'STEP'),
      reviewLoop: bp.props.some(p => p.t === 'loop'), inbox: bp.props.some(p => p.t === 'intake')
    }));
  }
  function resolveLine(WM, raw) {
    const n = norm(raw);
    if (!n) return null;
    return (WM.BLUEPRINTS || []).find(bp => norm(bp.id) === n || norm(bp.plain) === n || norm(bp.label) === n) || null;
  }
  const lineList = WM => catalog(WM).map(l => l.id + ' (' + l.name + ')').join(', ');

  // the Commander's existing crew, by id or name; "lead"/"me"/"you" is the lead
  function agentOf(env, raw) {
    const n = norm(raw), crew = (env.crew || []).filter(a => a && a.id);
    if (!n) return { ok: true, id: '' };
    if (LEAD_WORDS[n] && env.heroId) return { ok: true, id: env.heroId };
    const hit = crew.filter(a => norm(a.id) === n || norm(a.name) === n);
    if (hit.length === 1) return { ok: true, id: hit[0].id };
    return refuse((hit.length ? 'More than one crew member matches "' : 'Nobody on the crew is called "') + String(raw).slice(0, 40) + '".'
      + ' Leave agent empty to staff it later, or use one of: ' + (crew.map(a => a.name || a.id).join(', ') || 'no crew yet') + '.');
  }
  const nameOf = (env, id) => { const a = (env.crew || []).find(x => x && x.id === id); return a ? (a.name || a.id) : id; };

  // what the floor routes, so a build can prove it changed no existing line
  function floorFacts(st, P) {
    const geo = st.projectGeometry(), plan = P.compileRoutingPlan(geo), L = P.dockLayer ? P.dockLayer(plan) : {};
    const errs = new Set((plan.errors || []).filter(e => e && !e.warn).map(e => e.code + ':' + (e.propId || '') + ':' + (e.tile ? e.tile.x + ',' + e.tile.y : '')));
    return { geo, plan, errs, chains: L.dockChains || {}, reach: L.reachDock || plan.reachDock || {} };
  }
  // where a walk starts: the walkable tile nearest the middle of the spawn room (a desk may stand on the middle itself)
  function spawnTile(doc, g) {
    const rm = doc.rooms[doc.meta && doc.meta.spawnRoomId] || doc.rooms[doc.order[0]];
    const r = rm && rm.rects && rm.rects[0];
    if (!r) return null;
    const cx = (r.x1 + r.x2) >> 1, cy = (r.y1 + r.y2) >> 1;
    let best = null, bd = Infinity;
    for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) {
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d < bd && g.walkable(x - g.origin.tx, y - g.origin.ty)) { bd = d; best = { x, y }; }
    }
    return best;
  }

  /* one placement, tried on its own probe: the room (when new) + the stamped line. It passes only when every new solid
     machine can be walked up to, no NEW routing error appears anywhere, and every existing dock routes exactly as before. */
  function tryPlacement(doc, bp, spec, env, before) {
    const WM = env.WorldModel, P = env.Pipeline;
    const probe = WM.create(clone(doc));
    const b = buildInto(probe, Object.assign({}, spec, { steps: [] }), WM);
    if (!b.ok) return b;
    const after = floorFacts(probe, P), g = after.geo;
    for (const e of after.errs) if (!before.errs.has(e)) return refuse('that spot would add a routing problem (' + e.split(':')[0] + ')');
    for (const dock in before.chains) if (JSON.stringify(before.chains[dock]) !== JSON.stringify(after.chains[dock])) return refuse('that spot would change how an existing line routes');
    for (const dock in before.reach) if (!!before.reach[dock] !== !!after.reach[dock]) return refuse('that spot would change which existing steps the Inbox reaches');
    const o = spawnTile(probe.serialize(), g);
    if (o) for (const pid of b.ids) {
      const p = probe.propById(pid);
      if (!p || p.block === false) continue;
      if (!g.path(o.x - g.origin.tx, o.y - g.origin.ty, p.x - g.origin.tx, p.y + p.h - g.origin.ty)) return refuse('a machine there could not be walked up to');
    }
    return { ok: true, probe, ids: b.ids };
  }

  /* the ONE edit list, run on a probe by plan() and on the live station by apply(): the new room (optional), the stamped
     line (with its cap + tries), the Inbox's name, each step's instructions and agent. Every setter's answer is checked. */
  function buildInto(st, spec, WM) {
    const bp = (WM.BLUEPRINTS || []).find(x => x.id === spec.bpId);
    if (!bp) return refuse('unknown line');
    if (spec.room) {
      const r = st.addRoom({ kind: spec.room.kind, name: spec.room.name, rect: spec.room.rect });
      if (!r || !r.ok) return refuse('the room could not be added there' + (r && r.msg ? ' (' + r.msg + ')' : ''));
    }
    const s = st.stampBlueprint(bp.id, spec.ox, spec.oy, spec.opts || {});
    if (!s || !s.ok) return refuse('the line could not be placed there' + (s && s.msg ? ' (' + s.msg + ')' : ''));
    let intakeId = null;
    for (let i = 0; i < s.ids.length; i++) if (bp.props[i].t === 'intake') {
      intakeId = intakeId || s.ids[i];
      if (spec.label) { const r = st.setPropLabel(s.ids[i], spec.label); if (!r || !r.ok) return refuse('the line could not be named'); }
    }
    for (const step of (spec.steps || [])) {
      const pid = s.ids[step.propIndex];
      if (!pid) return refuse('a step is missing');
      if (step.brief) { const r = st.setPropBrief(pid, step.brief); if (!r || !r.ok) return refuse('a step\'s instructions could not be saved'); }
      if (step.agentId) { const r = st.assignPropAgent(pid, step.agentId); if (!r || !r.ok) return refuse('a step\'s agent could not be assigned'); }
    }
    return { ok: true, ids: s.ids, intakeId };
  }

  // the new line as the Workflow panel reads it: its steps in run order, and WorkflowLine.readiness
  function readLine(st, ids, env, crewIds) {
    const P = env.Pipeline, W = env.WorkflowLine;
    const geo = st.projectGeometry(), plan = P.compileRoutingPlan(geo);
    const mine = new Set(ids);
    const comp = P.lineComponents(geo).find(c => (c.props || []).some(pid => mine.has(pid)) || c.bays.some(b => mine.has(b.propId)));
    if (!comp) return { comp: null, order: [], ready: false, blocking: ['the line is not connected'] };
    const flow = W.lineFlow(plan, comp, P, geo.props);
    const r = W.readiness(flow, comp, { errors: plan.errors, hasCompute: (aid, pid) => st.bayObjects(aid, pid).indexOf('computer') >= 0,
      isCrew: aid => !crewIds || !crewIds.length || crewIds.indexOf(aid) >= 0 });
    // the run columns as the Workflow panel groups them: one step, several at once (all), one of them (oneof / turns)
    const cols = (flow.cols || []).map(c => ({ mode: c.mode, docks: (c.docks || []).map(d => d.propId).filter(pid => mine.has(pid)) })).filter(c => c.docks.length);
    return { comp, order: flow.order.filter(pid => mine.has(pid)), cols, ready: r.ready, blocking: r.blocking.map(b => b.what) };
  }

  /* the steps as they RUN: "A → B" in sequence, "A + B (at once)" for a fan-out, "A or B" where a sorter or a splitter
     sends each job to one of them — never a sequence that is really a choice */
  function flowText(cols, runOrder, stepsView) {
    const view = pid => { const x = stepsView[runOrder.indexOf(pid)]; return x ? x.role + ' (' + (x.agent || 'nobody yet') + ')' : '?'; };
    if (!cols || !cols.length) return stepsView.map(x => x.role + ' (' + (x.agent || 'nobody yet') + ')').join(' → ');
    return cols.map(c => c.docks.length === 1 ? view(c.docks[0]) : c.mode === 'all' ? c.docks.map(view).join(' + ') + ' (at once)' : c.docks.map(view).join(' or ')).join(' → ');
  }

  function plan(doc, req, env) {
    const WM = env && env.WorldModel, P = env && env.Pipeline, W = env && env.WorkflowLine;
    if (!WM || !P || !W || !doc) return refuse('the station builder is not loaded on this page');
    if (!req || typeof req !== 'object' || Array.isArray(req)) return refuse('Send the request as an object with: ' + MENU.join(', ') + '.');
    const extra = Object.keys(req).filter(k => MENU.indexOf(k) < 0);
    if (extra.length) return refuse('StarNet chooses every position, belt and piece of furniture itself, so these fields are not accepted: '
      + extra.slice(0, 8).join(', ') + '. Use only: ' + MENU.join(', ') + '.');
    const bp = resolveLine(WM, req.line);
    if (!bp) return refuse((req.line ? 'There is no line called "' + String(req.line).slice(0, 60) + '".' : 'Choose a line.') + ' The lines are: ' + lineList(WM) + '.',
      { lines: catalog(WM).map(l => ({ id: l.id, name: l.name, roles: l.roles })) });
    const plain = bp.plain || bp.label;
    const label = (typeof req.name === 'string' ? req.name : '').replace(/\s+/g, ' ').trim().slice(0, 48) || plain.toUpperCase();
    const notes = [];

    // daily cap: undefined keeps the line's own, null/"none"/0 is no cap, a positive dollar amount caps it
    const hasIntake = bp.props.some(p => p.t === 'intake'), hasLoop = bp.props.some(p => p.t === 'loop');
    const opts = {};
    if (req.dailyCap !== undefined) {
      if (!hasIntake) notes.push('this line has no Inbox, so dailyCap was ignored');
      else if (req.dailyCap === null || req.dailyCap === 0 || /^(none|no cap|off|0)$/i.test(String(req.dailyCap).trim())) opts.limits = { maxUsdPerDay: null };
      else {
        const n = Number(String(req.dailyCap).replace(/[$,\s]/g, ''));
        if (!isFinite(n) || n <= 0 || n > 10000) return refuse('dailyCap must be a dollar amount above 0 (up to 10000), or null for no cap.');
        opts.limits = { maxUsdPerDay: Math.round(n * 100) / 100 };
      }
    }
    if (req.tries !== undefined && req.tries !== null) {
      if (!hasLoop) notes.push('this line has no review loop, so tries was ignored');
      else {
        const n = Number(req.tries);
        if (!Number.isInteger(n) || n < 1 || n > 5) return refuse('tries must be a whole number from 1 to 5.');
        opts.maxIter = n;
      }
    }

    // where: a new room (default), or an existing room by name where the line fits on clear floor
    const live = WM.create(clone(doc));
    const rooms = live.rooms().filter(r => r.kind !== 'corridor');
    const whereRaw = req.where == null ? '' : String(req.where).trim();
    let target = null;
    if (whereRaw && !/^(a )?new( room)?$/i.test(whereRaw)) {
      const m = rooms.filter(r => norm(r.name) === norm(whereRaw));
      if (m.length !== 1) return refuse((m.length ? 'More than one room is called "' + whereRaw.slice(0, 40) + '".' : 'There is no room called "' + whereRaw.slice(0, 40) + '".')
        + ' Use "new room", or one of: ' + rooms.map(r => r.name).join(', ') + '.');
      target = m[0];
    }

    // steps: validated against the crew BEFORE any placement work
    const reqSteps = req.steps == null ? [] : req.steps;
    if (!Array.isArray(reqSteps)) return refuse('steps must be a list like [{ "step": 1, "instructions": "…", "agent": "NOVA" }].');
    for (const s of reqSteps) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return refuse('each step must be an object with: ' + STEP_KEYS.join(', ') + '.');
      const bad = Object.keys(s).filter(k => STEP_KEYS.indexOf(k) < 0);
      if (bad.length) return refuse('A step only takes: ' + STEP_KEYS.join(', ') + '. Not accepted: ' + bad.slice(0, 6).join(', ') + '.');
      if (s.instructions != null && typeof s.instructions !== 'string') return refuse('a step\'s instructions must be text.');
      if (s.agent != null && typeof s.agent !== 'string') return refuse('a step\'s agent must be a crew member\'s name or id.');
    }

    // placement: StarNet's own choice, first one that passes every check
    const before = floorFacts(live, P);
    const base = { bpId: bp.id, opts, label: hasIntake ? label : '' };
    let placed = null, spec = null;
    if (!target) {
      for (const m of [1, 2]) {
        const Wd = Math.max(bp.w + 2 * m, MIN_W), Hd = Math.max(bp.h + 2 * m, MIN_H);
        for (const rect of live.roomSpots(Wd, Hd, 'hab', 24)) {
          const s = Object.assign({}, base, { room: { kind: 'hab', name: label.toUpperCase().slice(0, 24), rect },
            ox: rect.x1 + ((Wd - bp.w) >> 1), oy: rect.y1 + ((Hd - bp.h) >> 1) });
          const t = tryPlacement(doc, bp, s, env, before);
          if (t.ok) { placed = t; spec = s; break; }
        }
        if (placed) break;
      }
      if (!placed) return refuse('There is no clear space beside the station for a room that fits ' + plain + '. Remove something or choose a smaller line.');
    } else {
      let tries = 0;
      // every machine and belt must stand inside THIS room: a stamp that fits the floor can still run through a doorway
      // into the next room, and "in the HOME room" would then be a lie
      const inRoom = (x, y) => target.rects.some(q => x >= q.x1 && x <= q.x2 && y >= q.y1 && y <= q.y2);
      const staysInside = (ox, oy) => bp.props.every(p => { for (let yy = 0; yy < p.h; yy++) for (let xx = 0; xx < p.w; xx++) if (!inRoom(ox + p.x + xx, oy + p.y + yy)) return false; return true; })
        && bp.belts.every(b => inRoom(ox + b.x, oy + b.y));
      outer: for (const r of target.rects) for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) {
        if (!staysInside(x, y) || !live.canPlaceBlueprint(bp.id, x, y).ok) continue;
        if (++tries > MAX_TRIES_IN_ROOM) break outer;
        const s = Object.assign({}, base, { room: null, roomId: target.id, ox: x, oy: y });
        const t = tryPlacement(doc, bp, s, env, before);
        if (t.ok) { placed = t; spec = s; break outer; }
      }
      if (!placed) return refuse(plain + ' does not fit on clear floor in ' + target.name + '. Use "new room", or clear some floor there first.');
    }

    // the line's steps in RUN ORDER (a stand-in crew on the probe, so order follows the belts, not who is assigned)
    const crewProbe = env.WorldModel.create(clone(placed.probe.serialize()));
    const bays = placed.ids.filter((pid, i) => bp.props[i].t === 'bay');
    bays.forEach((pid, i) => crewProbe.assignPropAgent(pid, '__sb_probe_' + i));
    const shape = readLine(crewProbe, placed.ids, env, null), order = shape.order;
    const runOrder = order.length === bays.length ? order : bays;
    const stepsOut = runOrder.map((pid, i) => {
      const propIndex = placed.ids.indexOf(pid), role = bp.props[propIndex].role || 'STEP';
      return { step: i + 1, role, propIndex, brief: '', agentId: '' };
    });
    const used = {};
    for (const s of reqSteps) {
      let hit = null;
      if (s.step != null) {
        const n = Number(s.step);
        hit = Number.isInteger(n) ? stepsOut[n - 1] : null;
        if (!hit) return refuse('This line has steps 1 to ' + stepsOut.length + ': ' + stepsOut.map(x => x.step + ' ' + titleCase(x.role)).join(', ') + '.');
      } else if (s.role != null) {
        const m = stepsOut.filter(x => norm(x.role) === norm(s.role));
        if (m.length !== 1) return refuse((m.length ? 'This line has more than one ' + titleCase(s.role) + ' step: use "step" instead.' : 'This line has no ' + String(s.role).slice(0, 30) + ' step.')
          + ' Its steps are: ' + stepsOut.map(x => x.step + ' ' + titleCase(x.role)).join(', ') + '.');
        hit = m[0];
      } else return refuse('Each step needs "step" (a number) or "role". Its steps are: ' + stepsOut.map(x => x.step + ' ' + titleCase(x.role)).join(', ') + '.');
      if (used[hit.step]) return refuse('Step ' + hit.step + ' was given twice.');
      used[hit.step] = 1;
      if (s.instructions != null) hit.brief = String(s.instructions).trim().slice(0, 2000);
      if (s.agent != null) { const a = agentOf(env, s.agent); if (!a.ok) return a; hit.agentId = a.id; }
    }
    // a step with no instructions gets its role's standard ones (the Workflow panel's first starter chip)
    for (const x of stepsOut) if (!x.brief) { const st = env.WorkflowLine.starters ? env.WorkflowLine.starters(x.role) : []; x.brief = (st[0] && st[0].does) || ''; }
    spec = Object.assign({}, spec, { steps: stepsOut.map(x => ({ propIndex: x.propIndex, brief: x.brief, agentId: x.agentId })) });

    // the whole build on one more probe: its fingerprint is what apply() must reproduce exactly
    const finalProbe = WM.create(clone(doc));
    const fb = buildInto(finalProbe, spec, WM);
    if (!fb.ok) return fb;
    const crewIds = (env.crew || []).map(a => a && a.id).filter(Boolean);
    const rd = readLine(finalProbe, fb.ids, env, crewIds);
    const neighbour = spec.room ? (() => {
      const R = spec.room.rect, adj = rooms.find(rm => rm.rects.some(q => q.x1 <= R.x2 + 1 && q.x2 >= R.x1 - 1 && q.y1 <= R.y2 + 1 && q.y2 >= R.y1 - 1));
      return adj ? adj.name : null;
    })() : null;
    const whereText = spec.room ? 'a new room' + (neighbour ? ' beside ' + neighbour : '') : 'the ' + target.name + ' room';
    const stepsView = stepsOut.map(x => ({ step: x.step, role: titleCase(x.role), agent: x.agentId ? nameOf(env, x.agentId) : null, instructions: x.brief }));
    const capNow = (() => { const ip = fb.ids.map(id => finalProbe.propById(id)).find(p => p && p.t === 'intake'); return ip && ip.limits ? ip.limits.maxUsdPerDay : null; })();
    const summary = plain + (hasIntake ? ' ("' + label + '")' : '') + ' in ' + whereText + ': '
      + flowText(shape.cols, runOrder, stepsView)
      + (bp.props.some(p => p.t === 'outbox') ? ' → Outbox' : '')
      + (hasIntake ? (capNow != null ? ' · daily cap $' + capNow : ' · no daily cap') : '')
      + (hasLoop ? ' · up to ' + (opts.maxIter || (bp.props.find(p => p.t === 'loop') || {}).maxIter || 3) + ' review tries' : '')
      + '. ' + (rd.ready ? 'It will be ready to run.' : 'Still to do after building: ' + rd.blocking.join('; ') + '.');
    return { ok: true, plan: {
      floorSig: sigOf(doc), resultSig: sigOf(finalProbe.serialize()), spec,
      line: { id: bp.id, name: plain, label: hasIntake ? label : null }, where: whereText,
      steps: stepsView, ready: rd.ready, blocking: rd.blocking, notes, summary
    } };
  }

  function apply(st, pl, env) {
    const WM = env && env.WorldModel;
    if (!WM || !env.Pipeline || !env.WorkflowLine) return refuse('the station builder is not loaded on this page');
    if (!pl || !pl.spec || !pl.floorSig || !pl.resultSig) return refuse('There is no such plan. Plan the line again.');
    if (!st || !st.transact) return refuse('the station is not ready');
    if (sigOf(st.serialize()) !== pl.floorSig) return refuse('Your station changed since this plan was made, so nothing was built. Plan it again.');
    let built = null;
    const r = st.transact(() => {
      const b = buildInto(st, pl.spec, WM);
      if (!b.ok) return b;
      if (sigOf(st.serialize()) !== pl.resultSig) return refuse('The build did not match its plan, so nothing was changed. Plan it again.');
      built = b;
      return { ok: true };
    });
    if (!r || !r.ok || !built) return refuse((r && r.error) || 'The build failed, so nothing was changed.');
    const crewIds = (env.crew || []).map(a => a && a.id).filter(Boolean);
    const rd = readLine(st, built.ids, env, crewIds);
    return { ok: true, summary: pl.summary, line: pl.line, where: pl.where, steps: pl.steps, intakeId: built.intakeId,
      lineKey: rd.comp ? rd.comp.key : null, ready: rd.ready, blocking: rd.blocking };
  }

  return { MENU, STEP_KEYS, catalog, resolveLine, plan, apply, sigOf };
});
