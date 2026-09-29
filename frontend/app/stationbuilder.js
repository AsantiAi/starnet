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

  const MENU = ['line', 'purpose', 'where', 'name', 'steps', 'dailyCap', 'tries'];
  const STEP_KEYS = ['step', 'role', 'instructions', 'agent'];
  const LEAD_WORDS = { lead: 1, me: 1, you: 1, yourself: 1, overseer: 1, hero: 1 };
  // "recruit someone for this step": the build summons that role's specialist (Build's own summonForRole) and seats it
  const NEW_WORDS = { new: 1, recruit: 1, 'new agent': 1, 'a new one': 1, 'new recruit': 1, 'someone new': 1, 'a new agent': 1 };
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
    if (NEW_WORDS[n]) return env.canRecruit ? { ok: true, id: '', recruit: true } : refuse('Recruiting is not available on this page. Staff the step with a crew member, or leave agent empty.');
    const hit = crew.filter(a => norm(a.id) === n || norm(a.name) === n);
    if (hit.length === 1) return { ok: true, id: hit[0].id };
    return refuse((hit.length ? 'More than one crew member matches "' : 'Nobody on the crew is called "') + String(raw).slice(0, 40) + '".'
      + ' Leave agent empty to staff it later, say "new" to recruit a specialist for it, or use one of: ' + (crew.map(a => a.name || a.id).join(', ') || 'no crew yet') + '.');
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

  /* the ONE edit list, run on a probe by plan() and on the live station by apply(). Three plan kinds:
     a LINE (spec.bpId: the new room if any, the stamped line, its name, each step's instructions and agent), ROOMS
     (spec.parts: each a room kit — a new room or an existing one, its furniture, its own line), and a RESTYLE (one
     room's floor, material or name). Every setter's answer is checked; one failure fails the whole edit. */
  function buildInto(st, spec, WM) {
    if (spec && spec.kind === 'restyle') return restyleInto(st, spec);
    if (spec && spec.kind === 'swap') { const r = st.replaceLayout(spec.layout); return r && r.ok ? { ok: true, ids: [] } : refuse('the preset could not be applied' + (r && r.msg ? ' (' + r.msg + ')' : '')); }
    if (spec && spec.kind === 'rooms') {
      const ids = [], parts = [];
      for (const part of spec.parts || []) { const r = buildKit(st, part, WM); if (!r.ok) return r; ids.push(...r.ids); parts.push(r); }
      return { ok: true, ids, parts };
    }
    return buildLine(st, spec, WM);
  }
  function buildKit(st, part, WM) {
    const ids = [];
    let roomId = part.roomId || null;
    if (part.room) {
      const before = new Set(st.rooms().map(r => r.id));
      const r = st.addRoom({ kind: part.room.kind, name: part.room.name, floorStyle: part.room.floorStyle, floorMat: part.room.floorMat, rect: part.room.rect });
      if (!r || !r.ok) return refuse('the room could not be added there' + (r && r.msg ? ' (' + r.msg + ')' : ''));
      roomId = (st.rooms().find(x => !before.has(x.id)) || {}).id || null;
    }
    for (const p of part.props || []) {
      const r = st.addProp({ t: p.t, x: p.x, y: p.y, w: p.w, h: p.h, r: p.r || 0, block: p.block });
      if (!r || !r.ok) return refuse('a piece of furniture could not be placed there' + (r && r.msg ? ' (' + r.msg + ')' : ''));
      ids.push(r.id);
    }
    let line = null;
    if (part.line) {
      line = buildLine(st, Object.assign({}, part.line, { room: null }), WM);
      if (!line.ok) return line;
      ids.push(...line.ids);
    }
    return { ok: true, ids, roomId, lineIds: line ? line.ids : [], intakeId: line ? line.intakeId : null };
  }
  function restyleInto(st, spec) {
    if (spec.floorStyle) { const r = st.setFloor(spec.roomId, spec.floorStyle); if (!r || !r.ok) return refuse('the floor could not be changed'); }
    if (spec.floorMat) { const r = st.setMaterial(spec.roomId, spec.floorMat); if (!r || !r.ok) return refuse('the floor material could not be changed'); }
    if (spec.name) { const r = st.renameRoom(spec.roomId, spec.name); if (!r || !r.ok) return refuse('the room could not be renamed'); }
    return { ok: true, ids: [] };
  }
  function buildLine(st, spec, WM) {
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
    // purpose: the Commander's own words. With no line named, StarNet picks one with the reader behind FOR YOUR GOAL
    // (WorkflowLine.suggestLineFor: the SHAPE of the work), and every step's standard instructions carry those words
    if (req.purpose != null && typeof req.purpose !== 'string') return refuse('purpose is the Commander\'s own words for what the line is for, as text.');
    const purpose = typeof req.purpose === 'string' ? req.purpose.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    let bp = resolveLine(WM, req.line), picked = null;
    const lines = { lines: catalog(WM).map(l => ({ id: l.id, name: l.name, roles: l.roles })) };
    if (!bp && req.line == null && purpose) {
      const s = W.suggestLineFor ? W.suggestLineFor(purpose) : null;
      bp = s ? resolveLine(WM, s.id) : null;
      if (!bp) return refuse('StarNet picks a line from the shape of the work (research then writing, a draft and a reviewer, code with tests or a review, two takes to compare), and "'
        + purpose.slice(0, 80) + '" names no such shape. Choose a line: ' + lineList(WM) + '.', lines);
      picked = s.why;
    }
    if (!bp) return refuse((req.line ? 'There is no line called "' + String(req.line).slice(0, 60) + '".' : 'Choose a line, or give its purpose in the Commander\'s words.') + ' The lines are: ' + lineList(WM) + '.', lines);
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
      if (s.agent != null) { const a = agentOf(env, s.agent); if (!a.ok) return a; hit.agentId = a.id; hit.recruit = !!a.recruit; }
    }
    // a step with no instructions gets its role's standard ones (the Workflow panel's first starter chip), with the purpose
    for (const x of stepsOut) if (!x.brief) {
      const st = env.WorkflowLine.starters ? env.WorkflowLine.starters(x.role) : [];
      x.brief = ((st[0] && st[0].does) || '') + (purpose ? ' This line is for: "' + purpose + '".' : '');
    }
    const recruits = stepsOut.filter(x => x.recruit).map(x => ({ propIndex: x.propIndex, role: x.role }));
    spec = Object.assign({}, spec, { steps: stepsOut.map(x => ({ propIndex: x.propIndex, brief: x.brief, agentId: x.agentId })), recruits });

    // the whole build on one more probe: its fingerprint is what apply() must reproduce exactly
    const finalProbe = WM.create(clone(doc));
    const fb = buildInto(finalProbe, spec, WM);
    if (!fb.ok) return fb;
    const crewIds = (env.crew || []).map(a => a && a.id).filter(Boolean);
    // readiness counts the recruits: on a copy, each gets the desk its summon seeds (ensureWorkstation) and its step
    const rp = WM.create(clone(finalProbe.serialize())), deskRooms = [];
    recruits.forEach((rc, i) => {
      const id = '__sb_recruit_' + i, d = rp.ensureWorkstation(id);
      if (d && d.ok && d.roomId) { const rm = rp.roomById ? rp.roomById(d.roomId) : null; if (rm && deskRooms.indexOf(rm.name) < 0) deskRooms.push(rm.name); }
      rp.assignPropAgent(fb.ids[rc.propIndex], id); crewIds.push(id);
    });
    const rd = readLine(rp, fb.ids, env, crewIds);
    const neighbour = spec.room ? (() => {
      const R = spec.room.rect, adj = rooms.find(rm => rm.rects.some(q => q.x1 <= R.x2 + 1 && q.x2 >= R.x1 - 1 && q.y1 <= R.y2 + 1 && q.y2 >= R.y1 - 1));
      return adj ? adj.name : null;
    })() : null;
    const whereText = spec.room ? 'a new room' + (neighbour ? ' beside ' + neighbour : '') : 'the ' + target.name + ' room';
    const stepsView = stepsOut.map(x => ({ step: x.step, role: titleCase(x.role), agent: x.recruit ? 'a new recruit' : x.agentId ? nameOf(env, x.agentId) : null, instructions: x.brief }));
    const capNow = (() => { const ip = fb.ids.map(id => finalProbe.propById(id)).find(p => p && p.t === 'intake'); return ip && ip.limits ? ip.limits.maxUsdPerDay : null; })();
    const summary = plain + (hasIntake ? ' ("' + label + '")' : '') + ' in ' + whereText + ': '
      + flowText(shape.cols, runOrder, stepsView)
      + (bp.props.some(p => p.t === 'outbox') ? ' → Outbox' : '')
      + (hasIntake ? (capNow != null ? ' · daily cap $' + capNow : ' · no daily cap') : '')
      + (hasLoop ? ' · up to ' + (opts.maxIter || (bp.props.find(p => p.t === 'loop') || {}).maxIter || 3) + ' review tries' : '')
      + '. ' + (rd.ready ? 'It will be ready to run.' : 'Still to do after building: ' + rd.blocking.join('; ') + '.')
      + (recruits.length ? ' It adds ' + recruits.length + ' crew member' + (recruits.length > 1 ? 's' : '') + ': ' + recruits.map(r => r.role).join(', ')
        + (deskRooms.length ? ', with a desk in ' + deskRooms.join(' and ') : '') + '. UNDO does not remove agents; DELETE AGENT in a Dossier does.' : '')
      + (picked ? ' Picked for "' + purpose.slice(0, 80) + '": ' + picked + '.' : '');
    return { ok: true, plan: {
      floorSig: sigOf(doc), resultSig: sigOf(finalProbe.serialize()), spec,
      line: { id: bp.id, name: plain, label: hasIntake ? label : null }, where: whereText,
      steps: stepsView, ready: rd.ready, blocking: rd.blocking, notes, summary, recruits: recruits.map(r => r.role), picked
    } };
  }

  /* ================= ROOMS & DECOR (phase 2, 2026-09-29) =================
     The same rule as lines: the agent picks from curated options and never places furniture. A ROOM KIT is one of the
     hand-designed rooms the presets are made of (StationTemplates.kits) — its furniture, and for some a ready line with
     written steps. planRoom places a kit in a NEW room (the shared room finder), FURNISHES an existing room that has
     clear floor for the whole kit, or adds every room of a PRESET beside the station — always add-only. A kit is tried
     as designed and mirrored (never a kit with a line: mirroring would reverse its belts) until every piece can be
     walked up to and no piece blocks a doorway. planRestyle is the one cosmetic change: a room's floor, material or
     name, from fixed lists. The card says what equipment a kit brings (a desk is a computer: object = capability). */
  const ROOM_MENU = ['kit', 'preset', 'replace', 'where', 'name', 'type', 'floorStyle', 'floorMat'];
  const STYLE_MENU = ['room', 'name', 'type', 'floorStyle', 'floorMat'];
  const KIT_W = 18, KIT_H = 11;
  const kitsOf = env => (env.StationTemplates && env.StationTemplates.kits) ? env.StationTemplates.kits() : [];
  const kitMenu = env => kitsOf(env).map(k => k.name + ' (' + k.about + ')').join('; ');
  const presetsOf = env => ((env.StationTemplates && env.StationTemplates.catalog) || []).filter(c => env.StationTemplates.presetKits(c.id).length);
  function resolveKit(env, raw) { const n = norm(raw); return n ? kitsOf(env).find(k => norm(k.id) === n || norm(k.name) === n) || null : null; }
  function resolvePreset(env, raw) { const n = norm(raw); return n ? presetsOf(env).find(c => norm(c.id) === n || norm(c.name) === n) || null : null; }
  function styleOf(WM, req) {
    const styles = Object.keys(WM.FLOOR_STYLES || {}).filter(s => s !== 'corridor'), mats = Object.keys(WM.FLOOR_MATERIALS || {});
    const pick = (raw, list, field) => {
      if (raw == null) return { ok: true, value: null };
      const v = String(raw).toLowerCase().replace(/[^a-z]/g, '');
      return list.indexOf(v) >= 0 ? { ok: true, value: v } : refuse(field + ' must be one of: ' + list.join(', ') + '.');
    };
    const fs = pick(req.floorStyle, styles, 'floorStyle'); if (!fs.ok) return fs;
    const fm = pick(req.floorMat, mats, 'floorMat'); if (!fm.ok) return fm;
    // a room TYPE is a deck, as in Build mode's TYPE palette: its floor and material (a floorStyle or floorMat given too wins)
    let type = null;
    if (req.type != null) {
      const K = WM.ROOM_KINDS || {}, order = (WM.KIND_ORDER || Object.keys(K)).filter(k => k !== 'corridor' && K[k]), v = norm(req.type);
      const k = order.find(id => norm(id) === v || norm(K[id].label) === v);
      if (!k) return refuse('type must be one of: ' + order.map(id => K[id].label).join(', ') + '.');
      type = { id: k, label: K[k].label, floor: K[k].floor, mat: K[k].mat };
    }
    return { ok: true, floorStyle: fs.value || (type && type.floor) || null, floorMat: fm.value || (type && type.mat) || null, type };
  }
  // a kit's furniture at (x0, y0), as designed or mirrored left-to-right (a chair facing east then faces west)
  function kitProps(env, kit, x0, y0, mirror) {
    const S = env.PropSprites, out = [];
    for (const [t, x, y, facing = 0] of kit.props) {
      const spec = S && S.spec ? S.spec(t) : null;
      if (!spec) return null;
      const r = mirror ? (facing === 1 ? 3 : facing === 3 ? 1 : facing) : facing;
      out.push({ t, x: x0 + (mirror ? KIT_W - x - spec.w : x), y: y0 + y, w: spec.w, h: spec.h, r, block: spec.blocks !== false });
    }
    return out;
  }
  // a kit's own line, with the kit's written steps (its briefs, by role) and nobody assigned yet
  function kitLine(env, kit, x0, y0) {
    if (!kit.line) return null;
    const bp = (env.WorldModel.BLUEPRINTS || []).find(b => b.id === kit.line.bp);
    if (!bp) return null;
    const steps = [];
    bp.props.forEach((p, i) => {
      if (p.t !== 'bay') return;
      const st = env.WorkflowLine.starters ? env.WorkflowLine.starters(p.role) : [];
      steps.push({ propIndex: i, brief: (kit.line.briefs && kit.line.briefs[p.role]) || (st[0] && st[0].does) || '', agentId: '' });
    });
    return { bpId: bp.id, ox: x0 + kit.line.x, oy: y0 + kit.line.y, opts: {}, label: kit.line.label || '', steps };
  }
  // the tiles a room's doorways need clear: each door tile inside the room and the one tile past it
  function landingTiles(st, g, roomId) {
    const out = new Set(), ox = g.origin.tx, oy = g.origin.ty;
    for (const d of g.doorDefs || []) {
      const a = { x: d[0] + ox, y: d[1] + oy }, b = { x: d[2] + ox, y: d[3] + oy };
      const inA = st.roomAt(a.x, a.y) === roomId, inB = st.roomAt(b.x, b.y) === roomId;
      if (inA === inB) continue;
      const door = inA ? a : b, other = inA ? b : a;
      out.add(door.x + ',' + door.y); out.add((2 * door.x - other.x) + ',' + (2 * door.y - other.y));
    }
    return out;
  }
  // the same checks as a line's placement, plus: no piece of furniture on a doorway's landing
  function tryKit(doc, spec, env, before) {
    const WM = env.WorldModel, P = env.Pipeline;
    const probe = WM.create(clone(doc));
    const b = buildInto(probe, spec, WM);
    if (!b.ok) return b;
    const after = floorFacts(probe, P), g = after.geo;
    for (const e of after.errs) if (!before.errs.has(e)) return refuse('that spot would add a routing problem (' + e.split(':')[0] + ')');
    for (const dock in before.chains) if (JSON.stringify(before.chains[dock]) !== JSON.stringify(after.chains[dock])) return refuse('that spot would change how an existing line routes');
    for (const dock in before.reach) if (!!before.reach[dock] !== !!after.reach[dock]) return refuse('that spot would change which existing steps the Inbox reaches');
    const o = spawnTile(probe.serialize(), g);
    for (const part of b.parts) {
      const land = landingTiles(probe, g, part.roomId);
      for (const pid of part.ids) {
        const p = probe.propById(pid);
        if (!p || p.block === false) continue;
        for (let yy = p.y; yy < p.y + p.h; yy++) for (let xx = p.x; xx < p.x + p.w; xx++) if (land.has(xx + ',' + yy)) return refuse('a piece of furniture would block a doorway');
        if (o && !g.path(o.x - g.origin.tx, o.y - g.origin.ty, p.x - g.origin.tx, p.y + p.h - g.origin.ty)) return refuse('a piece of furniture could not be walked up to');
      }
    }
    return { ok: true, probe, parts: b.parts };
  }
  // the kit's furniture that is EQUIPMENT (object = capability): "a desk (COMPUTE)", by the prop's own label
  const equipmentOf = (env, props) => {
    const WM = env.WorldModel, S = env.PropSprites, seen = {}, out = [];
    for (const p of props) {
      const cap = WM.capForProp ? WM.capForProp(p.t) : null; if (!cap) continue;
      const k = cap + ':' + p.t; if (seen[k]) continue; seen[k] = 1;
      const spec = S && S.spec ? S.spec(p.t) : null, label = String((spec && spec.label) || p.t).toLowerCase().replace(/_/g, ' ').replace(/ [a-z]$/, '');   // "CONSOLE L" (its shape) reads as a console
      out.push((/^[aeiou]/.test(label) ? 'an ' : 'a ') + label + ' (' + ((WM.CAP_LABEL || {})[cap] || cap) + ')');
    }
    return out;
  };
  // what agents gain in the room, in EquipmentHelp's own words (the one plain-English source for each ability)
  const gainsOf = (env, props) => {
    const WM = env.WorldModel, H = env.EquipmentHelp, out = [];
    if (!H || !H.PURPOSE) return out;
    for (const p of props) {
      const cap = WM.capForProp ? WM.capForProp(p.t) : null, said = cap && H.PURPOSE[cap]; if (!said) continue;
      const g = cap === 'computer' ? 'a place to work' : said.replace(/\.$/, '').replace(/^./, c => c.toLowerCase());
      if (out.indexOf(g) < 0) out.push(g);
    }
    return out;
  };

  /* THE WHOLE-STATION SWAP ("build me a research station", replace: true): exactly Build mode's Presets apply
     (StationTemplates.build → replaceLayout, which keeps every agent's workstation). The page backs the current layout up
     to Build mode's own slot first, so RESTORE PREVIOUS in Build → Presets brings it back; one UNDO does too. */
  function planSwap(doc, req, env) {
    const WM = env.WorldModel, P = env.Pipeline, T = env.StationTemplates;
    if (req.kit) return refuse('replace swaps the whole station for a preset; a kit is one room. Use preset, or leave replace out to add the kit as a room.');
    const extra = Object.keys(req).filter(k => k !== 'preset' && k !== 'replace');
    if (extra.length) return refuse('A swap puts in a preset exactly as designed, so leave out: ' + extra.slice(0, 8).join(', ') + '.');
    const all = T.catalog || [], n = norm(req.preset), pr = n ? all.find(c => norm(c.id) === n || norm(c.name) === n) : null;
    if (!pr) return refuse('There is no preset called "' + String(req.preset || '').slice(0, 40) + '". Presets: ' + all.map(c => c.name).join(', ') + '.');
    const layout = T.build(pr.id, WM, env.PropSprites, (doc._nid || 0) + 100);
    const probe = WM.create(clone(doc)), r = probe.replaceLayout(layout);
    if (!r || !r.ok) return refuse(pr.name + ' could not replace this station (' + ((r && (r.msg || r.error)) || 'it did not fit') + '), so nothing was changed.');
    if (floorFacts(probe, P).errs.size) return refuse(pr.name + ' would not route cleanly on this station, so nothing was changed.');
    const crewIds = (env.crew || []).map(a => a && a.id).filter(Boolean), geo = probe.projectGeometry();
    const steps = [], lines = [];
    const comps = P.lineComponents(geo).filter(c => (c.bays || []).length);
    for (const c of comps) {
      const line = readLine(probe, c.bays.map(b => b.propId), env, crewIds);
      const intake = probe.props().find(p => p.t === 'intake' && (c.props || []).indexOf(p.id) >= 0);
      const label = (intake && intake.label) || 'the line';
      lines.push({ label, ready: line.ready, blocking: line.blocking });
      let k = 0;
      for (const pid of line.order) {
        const b = probe.props().find(q => q.id === pid);
        if (b && b.t === 'bay') steps.push({ step: ++k, role: titleCase(b.role) + (comps.length > 1 ? ' on ' + label : ''), agent: b.agentId ? nameOf(env, b.agentId) : null, instructions: b.brief || '' });
      }
    }
    const was = WM.create(clone(doc)), wasRooms = was.rooms().filter(x => x.kind !== 'corridor').length, wasProps = was.props().length;
    const rooms = probe.rooms().filter(x => x.kind !== 'corridor').map(x => x.name);
    const equip = equipmentOf(env, probe.props()), gains = gainsOf(env, probe.props());
    const summary = 'Swap your whole station for ' + pr.name + ' (' + rooms.join(', ') + '). Your ' + wasRooms + (wasRooms === 1 ? ' room' : ' rooms') + ' and ' + wasProps + ' props are replaced; agents and conversations stay, and every agent keeps a desk. '
      + 'Your current layout is backed up: RESTORE PREVIOUS in Build → Presets brings it back.'
      + (equip.length ? ' It brings equipment: ' + equip.join(', ') + (gains.length ? '. What agents gain there: ' + gains.join('; ') : '') + '.' : '')
      + lines.map(l => ' Its line "' + l.label + '" ' + (l.ready ? 'will be ready to run' : 'still needs: ' + l.blocking.join('; ')) + '.').join('');
    return { ok: true, plan: { floorSig: sigOf(doc), resultSig: sigOf(probe.serialize()), spec: { kind: 'swap', preset: pr.id, layout }, summary, notes: [], steps, line: null,
      where: 'the whole station', rooms: rooms.map(name => ({ name })), preset: { id: pr.id, name: pr.name }, lines } };
  }

  function planRoom(doc, req, env) {
    const WM = env && env.WorldModel, P = env && env.Pipeline, W = env && env.WorkflowLine;
    if (!WM || !P || !W || !doc || !env.StationTemplates || !env.PropSprites) return refuse('the station builder is not loaded on this page');
    if (!req || typeof req !== 'object' || Array.isArray(req)) return refuse('Send the request as an object with: ' + ROOM_MENU.join(', ') + '.');
    if (req.replace != null && req.replace !== false && !/^(false|no)$/i.test(String(req.replace))) {
      if (req.replace !== true && !/^(true|yes)$/i.test(String(req.replace))) return refuse('replace is true (swap the whole station for the preset) or left out (add rooms).');
      return planSwap(doc, req, env);
    }
    const extra = Object.keys(req).filter(k => ROOM_MENU.indexOf(k) < 0);
    if (extra.length) return refuse('StarNet chooses every position and piece of furniture itself, so these fields are not accepted: ' + extra.slice(0, 8).join(', ') + '. Use only: ' + ROOM_MENU.join(', ') + '.');
    const presetNames = presetsOf(env).map(c => c.name).join(', ');
    if (!!req.kit === !!req.preset) return refuse('Choose one: kit (one room) or preset (every room of a preset, added beside your station). Kits: ' + kitMenu(env) + '. Presets: ' + presetNames + '.');
    const style = styleOf(WM, req); if (!style.ok) return style;
    let list;
    if (req.kit) { const k = resolveKit(env, req.kit); if (!k) return refuse('There is no room kit called "' + String(req.kit).slice(0, 40) + '". Kits: ' + kitMenu(env) + '.'); list = [k]; }
    else {
      const pr = resolvePreset(env, req.preset);
      if (!pr) return refuse('There is no preset called "' + String(req.preset).slice(0, 40) + '". Presets: ' + presetNames + '.');
      list = env.StationTemplates.presetKits(pr.id).map(id => kitsOf(env).find(k => k.id === id)).filter(Boolean);
    }
    const name = typeof req.name === 'string' ? req.name.replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 24) : '';
    if (name && list.length > 1) return refuse('name names one room; a preset adds several rooms under their own names. Leave name out.');
    const live = WM.create(clone(doc));
    const rooms = live.rooms().filter(r => r.kind !== 'corridor');
    const whereRaw = req.where == null ? '' : String(req.where).trim();
    let target = null;
    if (whereRaw && !/^(a )?new( room)?$/i.test(whereRaw)) {
      if (list.length > 1) return refuse('A preset\'s rooms are always added as new rooms. Leave where out.');
      const m = rooms.filter(r => norm(r.name) === norm(whereRaw));
      if (m.length !== 1) return refuse((m.length ? 'More than one room is called "' + whereRaw.slice(0, 40) + '".' : 'There is no room called "' + whereRaw.slice(0, 40) + '".') + ' Use "new room", or one of: ' + rooms.map(r => r.name).join(', ') + '.');
      target = m[0];
    }
    const before = floorFacts(live, P), parts = [];
    for (const kit of list) {
      let found = null;
      const mirrors = kit.line ? [false] : [false, true];
      if (target) {
        const R = target.rects[0], Wd = R.x2 - R.x1 + 1, Hd = R.y2 - R.y1 + 1;
        if (target.rects.length > 1 || Wd < KIT_W || Hd < KIT_H) return refuse(target.name + ' is ' + Wd + ' × ' + Hd + '; a ' + kit.name + ' needs a plain 18 × 11 room. Use "new room".');
        const x0 = R.x1 + ((Wd - KIT_W) >> 1), y0 = R.y1 + ((Hd - KIT_H) >> 1);
        for (const mirror of mirrors) {
          const props = kitProps(env, kit, x0, y0, mirror); if (!props) return refuse('this page is missing the furniture for ' + kit.name);
          const part = { room: null, roomId: target.id, props, line: kitLine(env, kit, x0, y0), meta: { kit: kit.id, name: target.name, about: kit.about, existing: true } };
          if (tryKit(doc, { kind: 'rooms', parts: parts.concat([part]) }, env, before).ok) { found = part; break; }
        }
        if (!found) return refuse(kit.name + ' does not fit in ' + target.name + ': every piece needs clear floor, a way to walk up to it, and its doorways open. Use "new room".');
      } else {
        const sofar = WM.create(clone(doc));
        if (parts.length) { const b = buildInto(sofar, { kind: 'rooms', parts }, WM); if (!b.ok) return b; }
        const roomName = name || kit.name;
        outer: for (const rect of sofar.roomSpots(KIT_W, KIT_H, kit.kind, 24)) for (const mirror of mirrors) {
          const props = kitProps(env, kit, rect.x1, rect.y1, mirror); if (!props) return refuse('this page is missing the furniture for ' + kit.name);
          const part = { room: { kind: kit.kind, name: roomName, floorStyle: style.floorStyle || kit.floorStyle, floorMat: style.floorMat || kit.floorMat, rect },
            props, line: kitLine(env, kit, rect.x1, rect.y1), meta: { kit: kit.id, name: roomName, about: kit.about, existing: false } };
          if (tryKit(doc, { kind: 'rooms', parts: parts.concat([part]) }, env, before).ok) { found = part; break outer; }
        }
        if (!found) return refuse('There is no clear space beside the station for an 18 × 11 ' + kit.name + '. Remove something, or try a smaller build.');
      }
      parts.push(found);
    }
    const spec = { kind: 'rooms', parts };
    const finalProbe = WM.create(clone(doc)), fb = buildInto(finalProbe, spec, WM);
    if (!fb.ok) return fb;
    const crewIds = (env.crew || []).map(a => a && a.id).filter(Boolean);
    // a kit's line writes instructions every later run obeys: the card lists them, step by step in run order
    const steps = [], manyLines = fb.parts.filter(b => b.lineIds.length).length > 1;
    const view = parts.map((part, i) => {
      const built = fb.parts[i], pr = finalProbe.rooms().find(r => r.id === built.roomId);
      const neighbour = part.room ? (() => { const R = part.room.rect; const adj = finalProbe.rooms().find(rm => rm.id !== built.roomId && rm.kind !== 'corridor' && rm.rects.some(q => q.x1 <= R.x2 + 1 && q.x2 >= R.x1 - 1 && q.y1 <= R.y2 + 1 && q.y2 >= R.y1 - 1)); return adj ? adj.name : null; })() : null;
      const equip = equipmentOf(env, part.props), gains = gainsOf(env, part.props);
      const line = built.lineIds.length ? readLine(finalProbe, built.lineIds, env, crewIds) : null;
      const roomName = pr ? pr.name : part.meta.name;
      let n = 0;
      if (line) for (const pid of line.order) {
        const b = finalProbe.props().find(q => q.id === pid);
        if (b && b.t === 'bay') steps.push({ step: ++n, role: titleCase(b.role) + (manyLines ? ' in ' + roomName : ''), agent: null, instructions: b.brief || '' });
      }
      return { name: roomName, kit: part.meta.kit, about: part.meta.about, where: part.room ? 'a new room' + (neighbour ? ' beside ' + neighbour : '') : 'the ' + part.meta.name + ' room',
        equipment: equip, gains, line: line ? { label: part.line.label, ready: line.ready, blocking: line.blocking } : null };
    });
    const summary = view.map(v => (v.where.indexOf('a new room') === 0 ? v.name + ' (' + v.about + ') in ' + v.where : v.about.charAt(0).toUpperCase() + v.about.slice(1) + ', furnishing ' + v.where)
      + (v.equipment.length ? '. It brings equipment: ' + v.equipment.join(', ') + (v.gains.length ? '. What agents gain there: ' + v.gains.join('; ') : '') : '')
      + (v.line ? '. Its line "' + v.line.label + '" ' + (v.line.ready ? 'will be ready to run' : 'still needs: ' + v.line.blocking.join('; ')) : '') + '.').join(' ');
    return { ok: true, plan: { floorSig: sigOf(doc), resultSig: sigOf(finalProbe.serialize()), spec, rooms: view, summary, notes: [], steps, line: null, where: view.map(v => v.where).join('; ') } };
  }

  function planRestyle(doc, req, env) {
    const WM = env && env.WorldModel;
    if (!WM || !doc) return refuse('the station builder is not loaded on this page');
    if (!req || typeof req !== 'object' || Array.isArray(req)) return refuse('Send the request as an object with: ' + STYLE_MENU.join(', ') + '.');
    const extra = Object.keys(req).filter(k => STYLE_MENU.indexOf(k) < 0);
    if (extra.length) return refuse('A restyle only changes a room\'s floor, material or name, so these fields are not accepted: ' + extra.slice(0, 8).join(', ') + '. Use only: ' + STYLE_MENU.join(', ') + '.');
    const live = WM.create(clone(doc)), rooms = live.rooms().filter(r => r.kind !== 'corridor');
    const m = rooms.filter(r => norm(r.name) === norm(req.room));
    if (m.length !== 1) return refuse((req.room ? (m.length ? 'More than one room is called "' + String(req.room).slice(0, 40) + '".' : 'There is no room called "' + String(req.room).slice(0, 40) + '".') : 'Say which room.') + ' Rooms: ' + rooms.map(r => r.name).join(', ') + '.');
    const room = m[0], style = styleOf(WM, req); if (!style.ok) return style;
    const name = typeof req.name === 'string' ? req.name.replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 24) : '';
    if (name && rooms.some(r => r.id !== room.id && norm(r.name) === norm(name))) return refuse('Another room is already called ' + name + '.');
    const changes = [];
    if (style.floorStyle && style.floorStyle !== room.floorStyle) changes.push('floor ' + (room.floorStyle || 'default') + ' → ' + style.floorStyle);
    if (style.floorMat && style.floorMat !== room.floorMat) changes.push('material ' + (room.floorMat || 'default') + ' → ' + style.floorMat);
    if (name && name !== room.name) changes.push('renamed to ' + name);
    if (!changes.length) return refuse('Nothing would change. Give a new floorStyle, floorMat or name for ' + room.name + '.');
    const spec = { kind: 'restyle', roomId: room.id, floorStyle: style.floorStyle, floorMat: style.floorMat, name: name || null };
    const probe = WM.create(clone(doc)), r = buildInto(probe, spec, WM);
    if (!r.ok) return r;
    return { ok: true, plan: { floorSig: sigOf(doc), resultSig: sigOf(probe.serialize()), spec, summary: 'Restyle ' + room.name + (style.type ? ' with the ' + style.type.label + ' floor' : '') + ': ' + changes.join(', ') + '. Nothing is added, moved or removed.',
      notes: name ? ['requests that name this room by its old name will need the new one'] : [], steps: [], line: null, where: 'the ' + room.name + ' room', rooms: [] } };
  }

  function apply(st, pl, env) {
    const WM = env && env.WorldModel;
    if (!WM || !env.Pipeline || !env.WorkflowLine) return refuse('the station builder is not loaded on this page');
    if (!pl || !pl.spec || !pl.floorSig || !pl.resultSig) return refuse('There is no such plan. Plan the line again.');
    if (!st || !st.transact) return refuse('the station is not ready');
    if (sigOf(st.serialize()) !== pl.floorSig) return refuse('Your station changed since this plan was made, so nothing was built. Plan it again.');
    let built = null;
    const recruited = [], recruits = pl.spec.recruits || [];
    if (recruits.length && typeof env.recruit !== 'function') return refuse('Recruiting is not available on this page, so nothing was built. Plan it again without "new".');
    const r = st.transact(() => {
      const b = buildInto(st, pl.spec, WM);
      if (!b.ok) return b;
      if (sigOf(st.serialize()) !== pl.resultSig) return refuse('The build did not match its plan, so nothing was changed. Plan it again.');
      // recruits come AFTER the exact-match check (their ids are minted now), inside the same undo step: each one's desk
      // and its seat on the step are floor edits UNDO takes back; the agent itself is not (DELETE AGENT in its Dossier)
      for (const rc of recruits) {
        let a = null;
        try { a = env.recruit(rc.role); } catch (_) { a = null; }
        if (!a || !a.id) return refuse('StarNet could not recruit a ' + rc.role + ', so nothing was built.');
        recruited.push({ id: a.id, name: a.name || a.id, role: rc.role });
        const s = st.assignPropAgent(b.ids[rc.propIndex], a.id);
        if (!s || !s.ok) return refuse('The new ' + rc.role + ' could not be seated at its step, so nothing was built.');
      }
      built = b;
      return { ok: true };
    });
    if (!r || !r.ok || !built) {
      const kept = recruited.length ? ' ' + recruited.map(x => x.name).join(', ') + (recruited.length > 1 ? ' were' : ' was') + ' recruited and stays on the crew (DELETE AGENT in a Dossier removes an agent).' : '';
      return refuse(((r && r.error) || 'The build failed, so nothing was changed.') + kept, { recruited });
    }
    const crewIds = (env.crew || []).map(a => a && a.id).filter(Boolean);
    if (pl.spec.kind === 'swap') return { ok: true, kind: 'swap', summary: pl.summary, rooms: pl.rooms || [], where: pl.where, lines: pl.lines || [], preset: pl.preset, roomIds: [] };
    if (pl.spec.kind === 'rooms' || pl.spec.kind === 'restyle') {
      const lines = (built.parts || []).filter(p => p.lineIds && p.lineIds.length).map(p => { const rl = readLine(st, p.lineIds, env, crewIds); return { lineId: rl.comp ? rl.comp.key : null, ready: rl.ready, blocking: rl.blocking }; });
      return { ok: true, kind: pl.spec.kind, summary: pl.summary, rooms: pl.rooms || [], where: pl.where, lines,
        roomIds: pl.spec.kind === 'restyle' ? [pl.spec.roomId] : (built.parts || []).map(p => p.roomId) };
    }
    for (const x of recruited) crewIds.push(x.id);
    const rd = readLine(st, built.ids, env, crewIds), first = st.props().find(p => p.id === built.ids[0]);
    return { ok: true, summary: pl.summary, line: pl.line, where: pl.where, steps: pl.steps, intakeId: built.intakeId, roomIds: first ? [st.roomAt(first.x, first.y)].filter(Boolean) : [],
      lineKey: rd.comp ? rd.comp.key : null, ready: rd.ready, blocking: rd.blocking, recruited };
  }

  return { MENU, STEP_KEYS, ROOM_MENU, STYLE_MENU, catalog, resolveLine, plan, planRoom, planRestyle, apply, sigOf };
});
