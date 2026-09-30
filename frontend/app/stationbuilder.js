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

  const MENU = ['line', 'shape', 'purpose', 'where', 'beside', 'side', 'hallway', 'name', 'steps', 'dailyCap', 'tries'];
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
    // doc.links: the authored links (conveyor links phase B) — a link-only edit is a floor change too
    const s = canon([doc._nid, doc.order, doc.rooms, doc.props, doc.belts, doc.edges || [], doc.links == null ? null : doc.links]);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16) + ':' + s.length;
  }

  // the card's drawing of a plan (planpreview.js): every room (those the plan adds or changes marked), what it adds, its new belts
  const MACHINE_T = /^(intake|bay|outbox|filter|merger|splitter|joiner|loop)$/;
  function previewOf(WM, before, after, zones, markRoomId) {
    const was = new Set(before.order || []), wasProps = new Set((before.props || []).map(p => p.id)), wasBelts = before.belts || {};
    return {
      rooms: (after.order || []).map(id => { const rm = after.rooms[id]; return { rects: rm.rects, mine: !was.has(id) || id === markRoomId, corridor: rm.kind === 'corridor', plank: rm.floorMat === 'plank' }; }),
      props: (after.props || []).filter(p => !wasProps.has(p.id)).map(p => ({ x: p.x, y: p.y, w: p.w || 1, h: p.h || 1, cap: !!(WM.capForProp && WM.capForProp(p.t)), machine: MACHINE_T.test(p.t) })),
      belts: Object.keys(after.belts || {}).filter(k => !wasBelts[k]).map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; }),
      zones: zones || []
    };
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

  /* what the floor routes, so a build can prove it changed no existing line. The routing plan speaks in the geometry's
     LOCAL tiles (counted from the station's top-left corner), and a room added north or west of everything moves that
     corner: so every tile here is put back into WORLD tiles, or such a room would read as "every line re-routed". */
  function floorFacts(st, P) {
    const geo = st.projectGeometry(), plan = P.compileRoutingPlan(geo), L = P.dockLayer ? P.dockLayer(plan) : {};
    const ox = (geo.origin && geo.origin.tx) || 0, oy = (geo.origin && geo.origin.ty) || 0;
    const world = t => (t && isFinite(t.x) && isFinite(t.y)) ? { x: t.x + ox, y: t.y + oy } : t;
    const errs = new Set((plan.errors || []).filter(e => e && !e.warn).map(e => { const t = world(e.tile); return e.code + ':' + (e.propId || '') + ':' + (t ? t.x + ',' + t.y : ''); }));
    const chains = {}, raw = L.dockChains || {};
    for (const d in raw) chains[d] = raw[d] && raw[d].tile ? Object.assign({}, raw[d], { tile: world(raw[d].tile) }) : raw[d];
    return { geo, plan, errs, chains, reach: L.reachDock || plan.reachDock || {} };
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
    if (spec && spec.kind === 'build') return buildParts(st, spec, WM);
    if (spec && spec.kind === 'swap') { const r = st.replaceLayout(spec.layout); return r && r.ok ? { ok: true, ids: [] } : refuse('the preset could not be applied' + (r && r.msg ? ' (' + r.msg + ')' : '')); }
    // a whole new layout: the station cleared to its main room exactly as the plan did it, then the layout built on it
    if (spec && spec.kind === 'relayout') {
      const r = st.replaceLayout(clone(spec.stripped));
      if (!r || !r.ok) return refuse('the station could not be cleared for the new layout' + (r && r.msg ? ' (' + r.msg + ')' : ''));
      return buildParts(st, spec.build, WM);
    }
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
    if (part.hall) { const h = st.placeHallway({ rect: part.hall }); if (!h || !h.ok) return refuse('the hallway could not be laid there' + (h && h.msg ? ' (' + h.msg + ')' : '')); }
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
    if (spec.hall) { const h = st.placeHallway({ rect: spec.hall }); if (!h || !h.ok) return refuse('the hallway could not be laid there' + (h && h.msg ? ' (' + h.msg + ')' : '')); }
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

  // a steps list the model sent ({ step | role, instructions, agent }), checked before any placement work
  function stepsListOk(reqSteps) {
    if (!Array.isArray(reqSteps)) return refuse('steps must be a list like [{ "step": 1, "instructions": "…", "agent": "NOVA" }].');
    for (const s of reqSteps) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return refuse('each step must be an object with: ' + STEP_KEYS.join(', ') + '.');
      const bad = Object.keys(s).filter(k => STEP_KEYS.indexOf(k) < 0);
      if (bad.length) return refuse('A step only takes: ' + STEP_KEYS.join(', ') + '. Not accepted: ' + bad.slice(0, 6).join(', ') + '.');
      if (s.instructions != null && typeof s.instructions !== 'string') return refuse('a step\'s instructions must be text.');
      if (s.agent != null && typeof s.agent !== 'string') return refuse('a step\'s agent must be a crew member\'s name or id.');
    }
    return { ok: true };
  }
  /* the line's steps in run order ({ step, role, brief, agentId }), told who works them and what to do: by step number or
     a unique role; "new" marks a recruit. A step left without instructions gets its role's standard ones (the Workflow
     panel's first starter chip), carrying the Commander's purpose when there is one. */
  function staffSteps(stepsOut, reqSteps, env, purpose) {
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
    for (const x of stepsOut) if (!x.brief) {
      const st = env.WorkflowLine.starters ? env.WorkflowLine.starters(x.role) : [];
      x.brief = ((st[0] && st[0].does) || '') + (purpose ? ' This line is for: "' + purpose + '".' : '');
    }
    return { ok: true };
  }

  function plan(doc, req, env) {
    const WM = env && env.WorldModel, P = env && env.Pipeline, W = env && env.WorkflowLine;
    if (!WM || !P || !W || !doc) return refuse('the station builder is not loaded on this page');
    if (!req || typeof req !== 'object' || Array.isArray(req)) return refuse('Send the request as an object with: ' + MENU.join(', ') + '.');
    const extra = Object.keys(req).filter(k => MENU.indexOf(k) < 0);
    if (extra.length) return refuse('StarNet chooses every position, belt and piece of furniture itself, so these fields are not accepted: '
      + extra.slice(0, 8).join(', ') + '. Use only: ' + MENU.join(', ') + '.');
    /* a CUSTOM line the Commander described (a SHAPE of steps: in order, at once, taking turns, sorted, reviewed): the whole
       of a room of its own, or of an existing room around what stands there, laid out by the layout engine through the
       same planner as a designed room's line zone */
    if (req.shape != null) {
      if (req.line != null) return refuse('Give a line from the menu or a shape of its own, not both.');
      const into = req.where != null && !/^(a )?new( room)?$/i.test(String(req.where).trim());
      const zone = { area: 'whole', shape: req.shape, staff: req.steps == null ? [] : req.steps };
      for (const k of ['name', 'purpose', 'dailyCap', 'tries']) if (req[k] !== undefined) zone[k] = req[k];
      const d = { zones: [zone] };
      if (req.where != null) d.where = req.where;
      if (!into && typeof req.name === 'string') d.name = req.name;
      const r = planDesign(doc, d, env);
      if (!r.ok) return r;
      const l = r.plan.lines[0] || {};
      return { ok: true, plan: Object.assign(r.plan, { line: { id: null, name: l.plain || 'a custom line', label: l.label || null }, ready: !!l.ready, blocking: l.blocking || [] }) };
    }
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
    const sl = stepsListOk(reqSteps); if (!sl.ok) return sl;

    // placement: StarNet's own choice, first one that passes every check
    const before = floorFacts(live, P);
    const base = { bpId: bp.id, opts, label: hasIntake ? label : '' };
    let placed = null, spec = null;
    if (!target) {
      // a room of its own: beside the asked room (the main room by default), on the asked side or the one that keeps the
      // station compact, joined by a hallway (the spatial builder's own placement)
      const tq = req.beside != null ? roomNamed(live, req.beside) : { ok: true, room: null }; if (!tq.ok) return tq;
      const sd = sideOf(req.side); if (!sd.ok) return sd;
      const hl = hallOf(req.hallway); if (!hl.ok) return hl;
      let none = null;
      for (const m of [1, 2]) {
        const Wd = Math.max(bp.w + 2 * m, MIN_W), Hd = Math.max(bp.h + 2 * m, MIN_H);
        const pl = roomPlacements(live, tq.room, Wd, Hd, { side: sd.side, len: hl.len, align: null, kind: 'hab', hangs: hangsOf(env) });
        if (!pl.ok) { none = none || pl; continue; }
        for (const cand of pl.list) {
          const rect = cand.rect;
          const s = Object.assign({}, base, { hall: cand.hall, placed: { side: cand.side, target: cand.target, len: cand.len }, room: { kind: 'hab', name: label.toUpperCase().slice(0, 24), rect },
            ox: rect.x1 + ((Wd - bp.w) >> 1), oy: rect.y1 + ((Hd - bp.h) >> 1) });
          const t = tryPlacement(doc, bp, s, env, before);
          if (t.ok) { placed = t; spec = s; break; }
        }
        if (placed) break;
      }
      if (!placed) return none || refuse('There is no clear space ' + (tq.room ? 'beside ' + tq.room.name : 'beside the station') + ' for a room that fits ' + plain + '. Try another side or another room (station.map shows what is free).');
    } else {
      if (['beside', 'side', 'hallway'].some(k => req[k] != null)) return refuse('beside, side and hallway place a NEW room; with where naming ' + target.name + ', leave them out.');
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
    const staffed = staffSteps(stepsOut, reqSteps, env, purpose); if (!staffed.ok) return staffed;
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
    const whereText = spec.room ? 'a new room ' + spec.placed.side + ' of ' + spec.placed.target + (spec.placed.len ? ', through a hallway' : ', open to it') : 'the ' + target.name + ' room';
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
      floorSig: sigOf(doc), resultSig: sigOf(finalProbe.serialize()), spec, preview: previewOf(WM, doc, finalProbe.serialize(), [], target ? target.id : null),
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
  const ROOM_MENU = ['zones', 'kit', 'preset', 'replace', 'where', 'beside', 'side', 'hallway', 'size', 'name', 'type', 'floorStyle', 'floorMat'];
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
    return { ok: true, plan: { floorSig: sigOf(doc), resultSig: sigOf(probe.serialize()), spec: { kind: 'swap', preset: pr.id, layout }, preview: previewOf(WM, doc, probe.serialize(), []), summary, notes: [], steps, line: null,
      where: 'the whole station', rooms: rooms.map(name => ({ name })), preset: { id: pr.id, name: pr.name }, lines } };
  }

  function planRoom(doc, req, env) {
    if (req && typeof req === 'object' && !Array.isArray(req) && req.zones != null) {
      if (req.kit != null || req.preset != null || req.replace != null) return refuse('zones describe a room part by part; kit, preset and replace build rooms as designed. Use one or the other.');
      return planDesign(doc, req, env);
    }
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
    // where new rooms go: beside the asked room (the main room by default), on the asked side or the compact one, by a hallway
    const bq = req.beside != null ? roomNamed(live, req.beside) : { ok: true, room: null }; if (!bq.ok) return bq;
    const sq = sideOf(req.side); if (!sq.ok) return sq;
    const hq = hallOf(req.hallway); if (!hq.ok) return hq;
    if (target && ['beside', 'side', 'hallway'].some(k => req[k] != null)) return refuse('beside, side and hallway place a NEW room; with where naming ' + target.name + ', leave them out.');
    if (req.size != null) return refuse('A preset room comes at its own size (18 × 11). For a room of another size use station.plan_build.');
    const besideRoom = bq.room, placeSide = sq.side, placeHall = hq.len;
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
        // beside the asked room, else wherever keeps the station compact (a preset's later rooms may stand beside its earlier ones)
        const T = besideRoom ? (sofar.rooms().find(r => r.id === besideRoom.id) || besideRoom) : null;
        const pl = roomPlacements(sofar, T, KIT_W, KIT_H, { side: placeSide, len: placeHall, align: null, kind: kit.kind, hangs: hangsOf(env) });
        if (!pl.ok) return pl;
        outer: for (const cand of pl.list) for (const mirror of mirrors) {
          const rect = cand.rect, props = kitProps(env, kit, rect.x1, rect.y1, mirror); if (!props) return refuse('this page is missing the furniture for ' + kit.name);
          const part = { hall: cand.hall, room: { kind: kit.kind, name: roomName, floorStyle: style.floorStyle || kit.floorStyle, floorMat: style.floorMat || kit.floorMat, rect },
            props, line: kitLine(env, kit, rect.x1, rect.y1), meta: { kit: kit.id, name: roomName, about: kit.about, existing: false, placed: { side: cand.side, target: cand.target, len: cand.len } } };
          if (tryKit(doc, { kind: 'rooms', parts: parts.concat([part]) }, env, before).ok) { found = part; break outer; }
        }
        if (!found) return refuse('There is no clear space ' + (besideRoom ? 'beside ' + besideRoom.name : 'beside the station') + ' for an 18 × 11 ' + kit.name + '. Try another side or another room (station.map shows what is free).');
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
      const equip = equipmentOf(env, part.props), gains = gainsOf(env, part.props);
      const line = built.lineIds.length ? readLine(finalProbe, built.lineIds, env, crewIds) : null;
      const roomName = pr ? pr.name : part.meta.name;
      let n = 0;
      if (line) for (const pid of line.order) {
        const b = finalProbe.props().find(q => q.id === pid);
        if (b && b.t === 'bay') steps.push({ step: ++n, role: titleCase(b.role) + (manyLines ? ' in ' + roomName : ''), agent: null, instructions: b.brief || '' });
      }
      return { name: roomName, kit: part.meta.kit, about: part.meta.about, where: part.room ? 'a new room ' + part.meta.placed.side + ' of ' + part.meta.placed.target + (part.meta.placed.len ? ', through a hallway' : ', open to it') : 'the ' + part.meta.name + ' room',
        equipment: equip, gains, line: line ? { label: part.line.label, ready: line.ready, blocking: line.blocking } : null };
    });
    const summary = view.map(v => (v.where.indexOf('a new room') === 0 ? v.name + ' (' + v.about + ') in ' + v.where : v.about.charAt(0).toUpperCase() + v.about.slice(1) + ', furnishing ' + v.where)
      + (v.equipment.length ? '. It brings equipment: ' + v.equipment.join(', ') + (v.gains.length ? '. What agents gain there: ' + v.gains.join('; ') : '') : '')
      + (v.line ? '. Its line "' + v.line.label + '" ' + (v.line.ready ? 'will be ready to run' : 'still needs: ' + v.line.blocking.join('; ')) : '') + '.').join(' ');
    return { ok: true, plan: { floorSig: sigOf(doc), resultSig: sigOf(finalProbe.serialize()), spec, preview: previewOf(WM, doc, finalProbe.serialize(), [], target ? target.id : null), rooms: view, summary, notes: [], steps, line: null, where: view.map(v => v.where).join('; ') } };
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
    return { ok: true, plan: { floorSig: sigOf(doc), resultSig: sigOf(probe.serialize()), spec, preview: previewOf(WM, doc, probe.serialize(), [], room.id), summary: 'Restyle ' + room.name + (style.type ? ' with the ' + style.type.label + ' floor' : '') + ': ' + changes.join(', ') + '. Nothing is added, moved or removed.',
      notes: name ? ['requests that name this room by its old name will need the new one'] : [], steps: [], line: null, where: 'the ' + room.name + ' room', rooms: [] } };
  }

  /* ================= VIBE DESIGN (2026-09-29): the Commander describes the room, part by part =================
     "The left side cozy, the right side a line that builds and tests code." The lead turns the words into ZONES: a part of
     the room (an AREA on a 2 × 2 grid) and what goes there, either a STYLE (RoomStyles: StarNet furnishes it from a
     hand-arranged set of the presets' own furniture) or a LINE (a shelf line, one picked from the Commander's words, or a
     custom SHAPE of steps), laid out inside that zone by the same layout engine the Workflow panel builds lines with. A new
     room is sized to hold what its zones need; an existing room is split down the middle. Lines go in first, then the
     furniture, which keeps doorways clear and every piece reachable. Every check the other plans run runs here too, on a
     copy, and the whole room lands in ONE undo. */
  const DESIGN_MENU = ['zones', 'where', 'name', 'size', 'beside', 'side', 'hallway', 'type', 'floorStyle', 'floorMat'];
  const ZONE_KEYS = ['area', 'style', 'line', 'purpose', 'shape', 'name', 'staff', 'dailyCap', 'tries'];
  // [column, row, columns, rows] on the room's 2 × 2 grid; the back is the far wall (the top of the floor)
  const AREAS = { whole: [0, 0, 2, 2], left: [0, 0, 1, 2], right: [1, 0, 1, 2], back: [0, 0, 2, 1], front: [0, 1, 2, 1],
    'back left': [0, 0, 1, 1], 'back right': [1, 0, 1, 1], 'front left': [0, 1, 1, 1], 'front right': [1, 1, 1, 1] };
  const AREA_LABEL = { whole: 'the whole room', left: 'the left half', right: 'the right half', back: 'the back half', front: 'the front half',
    'back left': 'the back-left corner', 'back right': 'the back-right corner', 'front left': 'the front-left corner', 'front right': 'the front-right corner' };
  const AREA_MENU = 'left, right, back, front, back-left, back-right, front-left, front-right, or whole';
  const DESIGN_MIN_ONE = [12, 8], DESIGN_MIN_MANY = [18, 10], DESIGN_MAX = [44, 26];

  // "the left side", "top right corner", "back-left" → an AREAS key (top = back, bottom = front), or null
  function areaOf(raw) {
    let n = norm(raw).replace(/\b(the|side|half|part|area|corner|of|room|wall|end|section)\b/g, ' ').replace(/\b(top|rear|far)\b/g, 'back')
      .replace(/\b(bottom|near)\b/g, 'front').replace(/\s+/g, ' ').trim();
    if (/^(whole|all|everything|entire|full|middle|center|centre)$/.test(n)) n = 'whole';
    const w = n.split(' ');
    if (w.length === 2 && (w[0] === 'left' || w[0] === 'right') && (w[1] === 'back' || w[1] === 'front')) n = w[1] + ' ' + w[0];
    return AREAS[n] ? n : null;
  }
  const sizesOf = env => { const S = env.PropSprites, o = {}; for (const t of ['intake', 'bay', 'outbox']) { const s = S && S.spec ? S.spec(t) : null; o[t] = s ? [s.w, s.h] : [2, 2]; } return o; };
  const roleOf = (WM, r) => { const n = String(r == null ? '' : r).toUpperCase().replace(/[^A-Z]/g, ''); return (WM.BAY_ROLES && WM.BAY_ROLES[n]) ? n : null; };
  function capOf(v, hasIntake, notes) {
    if (v === undefined) return { ok: true, limits: null };
    if (!hasIntake) { notes.push('this line has no Inbox, so dailyCap was ignored'); return { ok: true, limits: null }; }
    if (v === null || v === 0 || /^(none|no cap|off|0)$/i.test(String(v).trim())) return { ok: true, limits: { maxUsdPerDay: null } };
    const n = Number(String(v).replace(/[$,\s]/g, ''));
    if (!isFinite(n) || n <= 0 || n > 10000) return refuse('dailyCap must be a dollar amount above 0 (up to 10000), or null for no cap.');
    return { ok: true, limits: { maxUsdPerDay: Math.round(n * 100) / 100 } };
  }

  /* A CUSTOM LINE from a SHAPE (the plan's phase 4): stages in order, each laid in between the line's last machine and its
     OUTBOX through the Workflow panel's own graph edits (LineEdit.OPS), so a custom line is exactly a line the panel could
     have built by hand. */
  function shapeGraph(env, shape, label, limits) {
    const WM = env.WorldModel, E = env.LineEdit;
    if (!E || !E.OPS) return refuse('the line editor is not loaded on this page');
    const roles = Object.keys(WM.BAY_ROLES || {}).join(', ');
    const HOW = 'shape is a list of 1 to 6 stages in order: a role ("RESEARCHER"), { "together": [2 or 3 roles] } (each gets a copy of the job), '
      + '{ "turns": [2 or 3 roles] } (they take turns), { "sort": { "code": role, "research": role } } (everything else goes straight on), '
      + 'or { "review": true, "tries": 3 } (a reviewer sends the step before it back until it is right). Roles: ' + roles + '.';
    if (!Array.isArray(shape) || !shape.length || shape.length > 6) return refuse(HOW);
    const sizes = sizesOf(env), o = { sizes }, OPS = E.OPS, O = '+o0';
    const intake = { id: '+i0', t: 'intake', w: sizes.intake[0], h: sizes.intake[1], label };
    if (limits) intake.limits = limits;
    const g = { nodes: [intake, { id: O, t: 'outbox', w: sizes.outbox[0], h: sizes.outbox[1] }], links: [{ id: '+l0', from: { node: '+i0', port: 'out' }, to: { node: O } }] };
    const node = id => g.nodes.find(n => n.id === id);
    const done = e => e && e.ok ? e : refuse((e && e.msg) || HOW);
    let last = '+i0', lastBay = null, sort = null;
    for (const s of shape) {
      if (typeof s === 'string') {
        const role = roleOf(WM, s);
        if (!role) return refuse('"' + String(s).slice(0, 30) + '" is not a step. ' + HOW);
        const e = done(OPS.insertStep(g, { from: last, to: O, role }, o)); if (!e.ok) return e;
        if (sort) { const f = done(OPS.addSorter(g, { from: last, to: e.focus, routes: sort }, o)); if (!f.ok) return f; sort = null; }
        last = e.focus; lastBay = e.focus;
        continue;
      }
      if (!s || typeof s !== 'object' || Array.isArray(s)) return refuse(HOW);
      if (sort) return refuse('After a sort comes one step, or the end of the line. ' + HOW);
      const keys = Object.keys(s);
      if ((s.together || s.turns) && keys.length === 1) {
        const list = s.together || s.turns;
        if (!Array.isArray(list) || list.length < 2 || list.length > 3) return refuse('together and turns take 2 or 3 roles. ' + HOW);
        const rs = list.map(r => roleOf(WM, r));
        if (rs.some(r => !r)) return refuse('together and turns take roles from: ' + roles + '.');
        const e = done(OPS.addBranch(g, { from: last, to: O, n: rs.length, mode: s.turns ? 'turns' : 'copy', role: rs[0] }, o)); if (!e.ok) return e;
        g.links.filter(l => l.from.node === e.focus).forEach((l, j) => { const k = node(l.to.node); if (k && k.t === 'bay') k.role = rs[j]; });
        last = g.links.find(l => l.to.node === O).from.node; lastBay = null;
      } else if (s.sort && keys.length === 1) {
        const m = Array.isArray(s.sort) ? s.sort : Object.keys(s.sort).map(tag => ({ tag, role: s.sort[tag] }));
        sort = [];
        for (const r of m) {
          const tag = norm(r && r.tag), role = roleOf(WM, r && r.role);
          if ((tag !== 'code' && tag !== 'research') || !role || sort.some(x => x.tag === tag)) return refuse('sort sends "code" and/or "research" work to a role; everything else goes straight on. Roles: ' + roles + '.');
          sort.push({ tag, role });
        }
        if (!sort.length) return refuse('sort needs "code" or "research" and the role that takes it.');
        lastBay = null;
      } else if (s.review != null && keys.every(k => k === 'review' || k === 'tries')) {
        if (!lastBay) return refuse('A review goes right after one step (not first, and not after a branch or a sort).');
        const tries = s.tries == null ? 3 : Number(s.tries);
        if (!Number.isInteger(tries) || tries < 1 || tries > 5) return refuse('tries must be a whole number from 1 to 5.');
        const e = done(OPS.addLoop(g, { around: lastBay, max: tries }, o)); if (!e.ok) return e;
        if (typeof s.review === 'string') {
          const rr = roleOf(WM, s.review); if (!rr) return refuse('review names a role from: ' + roles + ', or is true for a REVIEWER.');
          const rv = g.links.find(l => l.to.node === e.focus && l.from.node !== lastBay && (node(l.from.node) || {}).t === 'bay');
          if (rv) node(rv.from.node).role = rr;
        }
        last = e.focus; lastBay = null;
      } else return refuse(HOW);
    }
    if (sort) { const f = done(OPS.addSorter(g, { from: last, to: O, routes: sort }, o)); if (!f.ok) return f; }
    const steps = g.nodes.filter(n => n.t === 'bay').length;
    if (!steps) return refuse('A line needs at least one step. ' + HOW);
    if (steps > 8) return refuse('A line holds up to 8 steps.');
    return { ok: true, graph: g };
  }

  // a LINE zone's graph: a custom shape, or a shelf line (by id or name, or picked from the Commander's words)
  function zoneLine(live, env, z, notes) {
    const WM = env.WorldModel, W = env.WorkflowLine;
    if (z.purpose != null && typeof z.purpose !== 'string') return refuse('purpose is the Commander\'s own words for what the line is for, as text.');
    const purpose = typeof z.purpose === 'string' ? z.purpose.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    const named = typeof z.name === 'string' ? z.name.replace(/\s+/g, ' ').trim().slice(0, 48) : '';
    if (z.shape != null) {
      if (z.line != null) return refuse('A zone takes a line from the menu or a shape of its own, not both.');
      if (z.tries != null) notes.push('tries belongs to a shape\'s { "review": true, "tries": n } stage, so it was ignored');
      const cap = capOf(z.dailyCap, true, notes); if (!cap.ok) return cap;
      const sg = shapeGraph(env, z.shape, named || 'A NEW LINE', cap.limits); if (!sg.ok) return sg;
      // no name given: the line is named for its steps ("RESEARCHER + WRITER + REVIEWER")
      const roles = [...new Set([].concat(...z.shape.map(st => typeof st === 'string' ? [roleOf(WM, st)] : st && (st.together || st.turns) ? (st.together || st.turns).map(r => roleOf(WM, r)) : st && st.sort ? (Array.isArray(st.sort) ? st.sort.map(r => roleOf(WM, r && r.role)) : Object.keys(st.sort).map(k => roleOf(WM, st.sort[k]))) : st && st.review != null ? [typeof st.review === 'string' ? roleOf(WM, st.review) : 'REVIEWER'] : [])).filter(Boolean))];
      const label = named || (roles.join(' + ').slice(0, 48) || 'A NEW LINE');
      sg.graph.nodes.find(n => n.t === 'intake').label = label;
      return { ok: true, graph: sg.graph, plain: 'a custom line', label, purpose, picked: null, loop: sg.graph.nodes.some(n => n.t === 'loop') };
    }
    let bp = resolveLine(WM, z.line), picked = null;
    if (!bp && z.line == null && purpose) {
      const s = W.suggestLineFor ? W.suggestLineFor(purpose) : null;
      bp = s ? resolveLine(WM, s.id) : null;
      if (!bp) return refuse('StarNet picks a line from the shape of the work (research then writing, a draft and a reviewer, code with tests or a review, two takes to compare), and "'
        + purpose.slice(0, 80) + '" names no such shape. Choose a line: ' + lineList(WM) + ', or give the zone a shape of its own.');
      picked = s.why;
    }
    if (!bp) return refuse((z.line != null ? 'There is no line called "' + String(z.line).slice(0, 60) + '".' : 'A line zone needs a line, a purpose, or a shape.') + ' The lines are: ' + lineList(WM) + '.');
    const hasIntake = bp.props.some(p => p.t === 'intake'), hasLoop = bp.props.some(p => p.t === 'loop');
    const cap = capOf(z.dailyCap, hasIntake, notes); if (!cap.ok) return cap;
    let maxIter;
    if (z.tries != null) {
      if (!hasLoop) notes.push('this line has no review loop, so tries was ignored');
      else { const n = Number(z.tries); if (!Number.isInteger(n) || n < 1 || n > 5) return refuse('tries must be a whole number from 1 to 5.'); maxIter = n; }
    }
    const b = live.blueprintGraph(bp.id, { limits: cap.limits || undefined, maxIter });
    if (!b || !b.ok) return refuse('the line ' + (bp.plain || bp.label) + ' could not be read');
    const plain = bp.plain || bp.label, label = named || plain.toUpperCase();
    const ip = b.graph.nodes.find(n => n.t === 'intake'); if (ip) ip.label = label;
    return { ok: true, graph: b.graph, plain, label: hasIntake ? label : null, purpose, picked, loop: hasLoop, bpId: bp.id };
  }

  // "a couch, a rug, two plants and a side table": the pieces a set really placed, in the props' own labels
  const pieceName = (env, t) => {
    const N = (env.RoomStyles && env.RoomStyles.NAMES) || {}, S = env.PropSprites, spec = S && S.spec ? S.spec(t) : null;
    if (N[t]) return N[t];
    return String((spec && spec.label) || t).toLowerCase().replace(/_/g, ' ').replace(/[\u2039\u203a]/g, ' ').replace(/\b(left|right)\b/g, ' ').replace(/ [a-z]$/, '').replace(/\s+/g, ' ').trim();
  };
  // "bookshelf" → "bookshelves", "stack of papers" → "stacks of papers"
  const plural = w => { const m = / of /.exec(w); if (m) return plural(w.slice(0, m.index)) + w.slice(m.index);
    return /(s|sh|ch|x|z)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : /fe?$/.test(w) ? w.replace(/fe?$/, 'ves') : w + 's'; };
  function piecesText(env, props) {
    const counts = [], idx = {};
    for (const p of props) {
      const label = pieceName(env, p.t);
      if (idx[label] == null) { idx[label] = counts.length; counts.push([label, 0]); }
      counts[idx[label]][1]++;
    }
    const NUM = ['', 'a', 'two', 'three', 'four', 'five', 'six'];
    const words = counts.map(([l, n]) => n === 1 ? (/^[aeiou]/.test(l) ? 'an ' : 'a ') + l : (NUM[n] || n) + ' ' + plural(l));
    return words.length > 1 ? words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1] : words.join('');
  }

  /* a style set's pieces at (x0, y0), as arranged or mirrored left to right (a chair facing east then faces west). Sizes come
     from the page's own catalog (the remastered desk is a tile wider than the classic one), so a FLAT decor piece that would
     then overlap another piece (a lamp beside a desk) is left out, and a set whose SOLID pieces would collide is not used.
     The catalog's mount rules hold (the page hands them to the world model): a piece that may stand on a table (stack, or
     mount 'surface') stands on the set's own table where the set puts it there, and one that MUST (a lava lamp) is left out
     when no table is under it. Tables are laid first, so what stands on them is placed after them. */
  function setProps(env, set, x0, y0, mirror) {
    const S = env.PropSprites, out = [], taken = new Map();
    const pieces = set.pieces.map(([t0, x, y, facing = 0]) => {
      let t = t0;
      if (mirror) t = /_r$/.test(t0) ? t0.slice(0, -2) : (S.spec(t0 + '_r') ? t0 + '_r' : t0);
      return { t, x, y, facing, spec: S.spec(t) };
    });
    if (pieces.some(p => !p.spec)) return null;
    // solid pieces claim their tiles first, then flat ones take what is left
    for (const pass of [true, false]) for (const p of pieces) {
      const solid = p.spec.blocks !== false;
      if (solid !== pass) continue;
      const px = x0 + (mirror ? set.w - p.x - p.spec.w : p.x), py = y0 + p.y, tiles = [];
      for (let yy = py; yy < py + p.spec.h; yy++) for (let xx = px; xx < px + p.spec.w; xx++) tiles.push(xx + ',' + yy);
      const onTop = !!(p.spec.stack || p.spec.mount === 'surface'), under = tiles.map(k => taken.get(k));
      const onTable = onTop && under.length > 0 && under.every(u => u && u.spec.surface);
      if (p.spec.mount === 'surface' && !onTable) continue;   // it has no business on bare deck
      if (!onTable && under.some(Boolean)) { if (solid) return null; continue; }
      if (!onTable) tiles.forEach(k => taken.set(k, p));
      const r = mirror ? (p.facing === 1 ? 3 : p.facing === 3 ? 1 : p.facing) : p.facing;
      out.push({ t: p.t, x: px, y: py, w: p.spec.w, h: p.spec.h, r, block: solid, order: pieces.indexOf(p) + (onTable ? 1000 : 0) });
    }
    return out.sort((q, w) => q.order - w.order).map(({ order, ...p }) => p);
  }
  // a solid piece can be walked up to: some tile on one of its sides is floor a walk from the spawn reaches
  function sideReachable(g, o, p) {
    if (!o) return true;
    const ox = g.origin.tx, oy = g.origin.ty;
    for (let y = p.y - 1; y <= p.y + p.h; y++) for (let x = p.x - 1; x <= p.x + p.w; x++) {
      const edgeY = y === p.y - 1 || y === p.y + p.h, edgeX = x === p.x - 1 || x === p.x + p.w;
      if (edgeY === edgeX) continue;   // the footprint itself, or a corner
      if (g.walkable(x - ox, y - oy) && g.path(o.x - ox, o.y - oy, x - ox, y - oy)) return true;
    }
    return false;
  }

  /* ================= THE SPATIAL BUILDER (2026-09-30): rooms where the Commander says, joined by hallways =================
     The first builder could not say WHERE a room goes: every room landed flush against the station's east wall, and the
     station grew into one long strip with no hallways (Andrew's test, 09-30). Now a room is placed on a named SIDE of a
     named ROOM, at a named SIZE, joined by a HALLWAY the way the presets join their wings (or flush, open plan). With no
     side given StarNet takes the one that keeps the station compact. One plan may hold several rooms, a later one attached
     to an earlier one; a room may stay EMPTY (floor for lines to come), be furnished by zones, or be filled with lines.
     The model names intent; StarNet computes every tile and refuses with what IS free. */
  const SIZES = { small: [12, 8], medium: [18, 11], large: [24, 14], giant: [36, 20] };
  const SIZE_WORDS = { tiny: 'small', little: 'small', normal: 'medium', standard: 'medium', regular: 'medium', big: 'large', huge: 'giant', massive: 'giant', enormous: 'giant' };
  const SIZE_MENU = 'small (12 × 8), medium (18 × 11), large (24 × 14), giant (36 × 20), or { "w": 6-' + 44 + ', "h": 5-' + 26 + ' }';
  const SIDES = ['east', 'south', 'west', 'north'];
  const SIDE_WORDS = { right: 'east', left: 'west', top: 'north', up: 'north', above: 'north', back: 'north', bottom: 'south', down: 'south', below: 'south', front: 'south', e: 'east', w: 'west', n: 'north', s: 'south' };
  const HALL_LEN = 3, HALL_W = { east: 3, west: 3, north: 4, south: 4 };   // the presets' own hallways (stationtemplates slots)
  const MAIN_WORDS = { bridge: 1, main: 1, hub: 1, home: 1, center: 1, centre: 1, station: 1, base: 1, core: 1, start: 1, 'main room': 1, 'first room': 1 };
  const BUILD_MENU = ['rooms', 'hallways'];
  const ROOM_KEYS = ['name', 'style', 'size', 'beside', 'side', 'hallway', 'align', 'into', 'type', 'floorStyle', 'floorMat', 'zones', 'lines'];
  const LINE_KEYS = ['line', 'purpose', 'shape', 'name', 'staff', 'dailyCap', 'tries'];

  const bboxOf = room => { let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const r of room.rects) { x1 = Math.min(x1, r.x1); y1 = Math.min(y1, r.y1); x2 = Math.max(x2, r.x2); y2 = Math.max(y2, r.y2); } return { x1, y1, x2, y2 }; };
  // the room every station starts from (the Commander may call it the bridge, the hub, the main room)
  function mainRoom(st) {
    const d = st.serialize(), id = (d.meta && (d.meta.trunkRoomId || d.meta.spawnRoomId)) || d.order[0];
    return st.rooms().find(r => r.id === id && r.kind !== 'corridor') || st.rooms().find(r => r.kind !== 'corridor') || null;
  }
  // a room by the name the Commander used: its own name, or a word for the main room when no room carries that name
  function roomNamed(st, raw) {
    const rooms = st.rooms().filter(r => r.kind !== 'corridor'), n = norm(raw), bare = n.replace(/^the /, '').replace(/ room$/, '');
    const m = rooms.filter(r => norm(r.name) === n || norm(r.name) === bare);
    if (m.length === 1) return { ok: true, room: m[0] };
    if (m.length > 1) return refuse('More than one room is called "' + String(raw).slice(0, 40) + '". Rename one first (station.plan_restyle).');
    if (MAIN_WORDS[bare]) { const main = mainRoom(st); if (main) return { ok: true, room: main }; }
    return refuse('There is no room called "' + String(raw).slice(0, 40) + '". Rooms: ' + rooms.map(r => r.name).join(', ') + '.');
  }
  function sizeOfRoom(raw) {
    if (raw == null) return { ok: true, size: null };
    let v = raw;
    if (typeof v === 'string') {
      const k = norm(v).replace(/ (room|size|sized)$/, ''), word = SIZE_WORDS[k] || k;
      if (SIZES[word]) return { ok: true, size: SIZES[word].slice(), word };
      const m = /^(\d+)\s*(?:x|×|by)\s*(\d+)$/.exec(v.toLowerCase().trim());
      if (m) v = { w: +m[1], h: +m[2] };
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const w = Number(v.w), h = Number(v.h);
      if (Number.isInteger(w) && Number.isInteger(h) && w >= 6 && h >= 5 && w <= DESIGN_MAX[0] && h <= DESIGN_MAX[1]) return { ok: true, size: [w, h] };
    }
    return refuse('size is ' + SIZE_MENU + '.');
  }
  function sideOf(raw) {
    if (raw == null) return { ok: true, side: null };
    const k = norm(raw).replace(/^(the|to the|on the) /, '').replace(/ (side|of|wall)$/, ''), s = SIDE_WORDS[k] || k;
    return SIDES.indexOf(s) >= 0 ? { ok: true, side: s } : refuse('side is north, south, east or west (north is the back wall, the top of the map).');
  }
  function hallOf(raw) {
    if (raw == null || raw === true || /^(yes|true|hall|hallway|corridor)$/i.test(String(raw))) return { ok: true, len: HALL_LEN };
    if (raw === false || raw === 0 || /^(no|none|false|flush|open|door|0)$/i.test(String(raw))) return { ok: true, len: 0 };
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 2 && n <= 8) return { ok: true, len: n };
    return refuse('hallway is true (a short hallway joins the rooms), false (the rooms touch, open plan), or a length from 2 to 8.');
  }

  /* What a new opening in a room's wall would run into. A HALLWAY's doorway (`door`): a solid piece on the tile just inside
     that wall. Any opening in a NORTH wall (the only wall boards and screens hang on): a piece that hangs there, which would
     be left hanging on nothing. `hangs` is the catalog's rule (type -> true when it mounts on a wall); without it every
     piece on that row counts. `from`..`to` runs along the wall. */
  const hangsOf = env => { const S = env && env.PropSprites; return S && S.spec ? (t => { const sp = S.spec(t); return !!(sp && sp.mount === 'wall'); }) : null; };
  function doorwayBlocked(st, side, B, from, to, door, hangs) {
    for (const p of st.props()) {
      const solid = door && p.block !== false, hung = side === 'north' && (hangs ? hangs(p.t) : true);
      if (!solid && !hung) continue;
      const px2 = p.x + (p.w || 1) - 1, py2 = p.y + (p.h || 1) - 1;
      const hit = side === 'east' ? (p.x <= B.x2 && px2 >= B.x2 && p.y <= to && py2 >= from)
        : side === 'west' ? (p.x <= B.x1 && px2 >= B.x1 && p.y <= to && py2 >= from)
        : side === 'south' ? (p.y <= B.y2 && py2 >= B.y2 && p.x <= to && px2 >= from)
        : (p.y <= B.y1 && py2 >= B.y1 && p.x <= to && px2 >= from);
      if (hit) return true;
    }
    return false;
  }
  // rooms that touch open onto each other, so a new rect may stand against the rooms in `allow` and no other: the first
  // other room it would touch (its name), or null
  function neighbourOf(st, r, allow) {
    const other = (x, y) => { const id = st.roomAt(x, y); return id && allow.indexOf(id) < 0 ? id : null; };
    let id = null;
    for (let x = r.x1; x <= r.x2 && !id; x++) id = other(x, r.y1 - 1) || other(x, r.y2 + 1);
    for (let y = r.y1; y <= r.y2 && !id; y++) id = other(r.x1 - 1, y) || other(r.x2 + 1, y);
    if (!id) return null;
    const rm = st.rooms().find(x => x.id === id);
    return !rm ? 'another room' : rm.kind === 'corridor' ? 'a hallway' : rm.name;
  }

  /* Every place a W × H room may stand on one SIDE of the room T: against T through a hallway `len` tiles long (0 = the
     rooms touch). The room slides ALONG the shared wall: centred first, then outward, or pinned by `align`. The hallway
     sits in the middle of the stretch both rooms face, and the wall it meets must really be T's floor (T may be L-shaped). */
  function placementsOn(st, T, side, W, H, len, align, kind, hangs) {
    const B = bboxOf(T), horiz = side === 'east' || side === 'west', out = [];
    const lo = horiz ? B.y1 : B.x1, hi = horiz ? B.y2 : B.x2, span = horiz ? H : W, centre = lo + ((hi - lo + 1 - span) >> 1);
    let offs, why = '';
    if (align === 'start') offs = [lo]; else if (align === 'end') offs = [hi - span + 1]; else if (align === 'center') offs = [centre];
    else { offs = [centre]; for (let d = 1; d <= Math.max(span, hi - lo + 1); d++) offs.push(centre - d, centre + d); }
    for (const a of offs) {
      const o1 = Math.max(lo, a), o2 = Math.min(hi, a + span - 1), facing = o2 - o1 + 1;
      if (facing < 2) continue;   // the two rooms must face each other across at least a doorway
      const w = len ? Math.min(HALL_W[side], facing) : facing, h1 = o1 + ((facing - w) >> 1);
      let rect, hall = null;
      if (side === 'east') { rect = { x1: B.x2 + 1 + len, y1: a, x2: B.x2 + len + W, y2: a + H - 1 }; if (len) hall = { x1: B.x2 + 1, y1: h1, x2: B.x2 + len, y2: h1 + w - 1 }; }
      else if (side === 'west') { rect = { x1: B.x1 - len - W, y1: a, x2: B.x1 - len - 1, y2: a + H - 1 }; if (len) hall = { x1: B.x1 - len, y1: h1, x2: B.x1 - 1, y2: h1 + w - 1 }; }
      else if (side === 'south') { rect = { x1: a, y1: B.y2 + 1 + len, x2: a + W - 1, y2: B.y2 + len + H }; if (len) hall = { x1: h1, y1: B.y2 + 1, x2: h1 + w - 1, y2: B.y2 + len }; }
      else { rect = { x1: a, y1: B.y1 - len - H, x2: a + W - 1, y2: B.y1 - len - 1 }; if (len) hall = { x1: h1, y1: B.y1 - len, x2: h1 + w - 1, y2: B.y1 - 1 }; }
      // T's own floor along the wall the hallway (or, flush, the doorway) meets
      let meets = 0;
      for (let i = h1; i < h1 + w; i++) {
        const tx = side === 'east' ? B.x2 : side === 'west' ? B.x1 : i, ty = side === 'south' ? B.y2 : side === 'north' ? B.y1 : i;
        if (st.roomAt(tx, ty) === T.id) meets++;
      }
      if (meets < (len ? w : 2)) { why = why || T.name + '\'s wall is not straight there'; continue; }
      // the doorway opens onto clear floor in T (open plan: only what hangs on a north wall matters)
      const inWay = m => /^overlaps CORRIDOR/i.test(m || '') ? 'a hallway is already there' : /^overlaps /.test(m || '') ? m.replace(/^overlaps /, '') + ' is in the way' : (m || 'it does not fit');
      if (hall) { const c = st.canPlaceHallway([hall]); if (!c.ok) { why = why || inWay(c.msg); continue; } }
      const c = st.canPlaceRoom([rect], kind || 'hab');
      if (!c.ok) { why = why || inWay(c.msg); continue; }
      // nothing built here stands against a room it was not asked to join
      const nb = (hall && neighbourOf(st, hall, [T.id])) || neighbourOf(st, rect, len ? [] : [T.id]);
      if (nb) { why = why || 'it would stand against ' + nb; continue; }
      // and the opening runs onto clear floor in T (open plan: only what hangs on a north wall matters)
      if (doorwayBlocked(st, side, B, h1, h1 + w - 1, !!len, hangs)) { why = why || (len ? 'furniture in ' + T.name + ' stands against that wall' : 'something hangs on ' + T.name + '\'s wall there'); continue; }
      out.push({ rect, hall, side, target: T.name, targetId: T.id, len });
      if (out.length >= 10) break;
    }
    return { list: out, why: why || 'there is no floor there for it' };
  }
  /* WHERE A NEW ROOM GOES. Beside the room T when the Commander named one, on the asked side, else on whichever side leaves
     the station most COMPACT (the smaller long side of its outline, then the smaller area) — never just "to the east", which
     is how a station becomes one long strip. With no room named (T null) every room is a candidate, the main room first on
     a tie. Answers every spot in preference order, or why there is none and what does fit. */
  function roomPlacements(st, T, W, H, o) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const r of st.rooms()) { const b = bboxOf(r); x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1); x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2); }
    const score = c => { const r = c.rect, w = Math.max(x2, r.x2) - Math.min(x1, r.x1) + 1, h = Math.max(y2, r.y2) - Math.min(y1, r.y1) + 1; return Math.max(w, h) * 100000 + w * h; };
    const main = mainRoom(st), hosts = T ? [T] : st.rooms().filter(r => r.kind !== 'corridor').sort((p, q) => (p === main ? -1 : q === main ? 1 : 0));
    const per = [];
    hosts.forEach((host, hi) => (o.side ? [o.side] : SIDES).forEach((side, si) => {
      const p = placementsOn(st, host, side, W, H, o.len, o.align, o.kind, o.hangs);
      per.push({ host, side, list: p.list, why: p.why, score: p.list.length ? score(p.list[0]) : Infinity, order: hi * 10 + si });
    }));
    // a named room on a named side is taken as asked; otherwise the most compact spot wins
    if (!(T && o.side)) per.sort((p, q) => p.score - q.score || p.order - q.order);
    const list = [].concat(...per.map(p => p.list));
    if (list.length) return { ok: true, list };
    const size = W + ' × ' + H, hall = o.len ? ' with a hallway' : '';
    if (!T) return refuse('There is no clear space beside any room for a ' + size + ' room' + (o.side ? ' on its ' + o.side + ' side' : '') + hall + '. Try a smaller size, or name the room and side (station.map shows what is free).');
    // nothing fits as asked: say why, and what does fit around T, or beside which other rooms it would fit
    const elsewhere = () => {
      const spots = [];
      for (const r of st.rooms()) { if (r === T || r.kind === 'corridor') continue; const sides = SIDES.filter(sd => placementsOn(st, r, sd, W, H, o.len, null, o.kind, o.hangs).list.length); if (sides.length) spots.push(r.name + ' (' + sides.join(', ') + ')'); if (spots.length >= 5) break; }
      return spots.length ? ' That size fits beside: ' + spots.join('; ') + '.' : ' Nothing that size fits beside any room; try a smaller one.';
    };
    const free = SIDES.filter(sd => (!o.side || sd !== o.side) && placementsOn(st, T, sd, W, H, o.len, null, o.kind, o.hangs).list.length);
    const smaller = Object.keys(SIZES).filter(k => SIZES[k][0] * SIZES[k][1] < W * H && (o.side ? [o.side] : SIDES).some(sd => placementsOn(st, T, sd, SIZES[k][0], SIZES[k][1], o.len, null, o.kind, o.hangs).list.length));
    return refuse('There is no room for a ' + size + ' room ' + (o.side ? o.side + ' of ' : 'beside ') + T.name + hall + ': ' + per.map(p => (o.side ? '' : p.side + ': ') + p.why).join('; ') + '.'
      + (free.length ? ' That size fits ' + free.join(', ') + ' of ' + T.name + '.' : '') + (smaller.length ? ' Sizes that fit ' + (o.side ? 'there' : 'beside it') + ': ' + smaller.join(', ') + '.' : '')
      + (!free.length ? elsewhere() : ''), { free, smaller });
  }

  /* A HALLWAY BETWEEN TWO ROOMS that face each other across a gap: straight, as wide as the presets' own, in the middle of
     the stretch both rooms face, sliding along it to find clear wall at both ends. */
  function hallBetween(st, A, Bm, hangs) {
    const a = bboxOf(A), b = bboxOf(Bm);
    const yo1 = Math.max(a.y1, b.y1), yo2 = Math.min(a.y2, b.y2), xo1 = Math.max(a.x1, b.x1), xo2 = Math.min(a.x2, b.x2);
    const pair = A.name + ' and ' + Bm.name;
    let horiz;
    if (yo2 - yo1 + 1 >= 2 && (a.x2 < b.x1 || b.x2 < a.x1)) horiz = true;
    else if (xo2 - xo1 + 1 >= 2 && (a.y2 < b.y1 || b.y2 < a.y1)) horiz = false;
    else return refuse(pair + ' do not face each other, and a hallway runs straight. Join rooms that stand side by side or one above the other (station.map shows where each room is).');
    const firstIsA = horiz ? a.x2 < b.x1 : a.y2 < b.y1, F = firstIsA ? A : Bm, S = firstIsA ? Bm : A, fb = firstIsA ? a : b, sb = firstIsA ? b : a;
    const g1 = (horiz ? fb.x2 : fb.y2) + 1, g2 = (horiz ? sb.x1 : sb.y1) - 1, gap = g2 - g1 + 1;
    if (gap < 1) return refuse(pair + ' already stand against each other: they are open to each other.');
    if (gap < 2) return refuse(pair + ' are one tile apart, and a hallway is at least two tiles long.');
    if (gap > 40) return refuse(pair + ' are ' + gap + ' tiles apart; a hallway runs at most 40.');
    const o1 = horiz ? yo1 : xo1, o2 = horiz ? yo2 : xo2, w = Math.min(horiz ? HALL_W.east : HALL_W.south, o2 - o1 + 1), centre = o1 + ((o2 - o1 + 1 - w) >> 1);
    const offs = [centre]; for (let d = 1; d <= o2 - o1; d++) offs.push(centre - d, centre + d);
    let why = '';
    for (const h1 of offs) {
      if (h1 < o1 || h1 + w - 1 > o2) continue;
      const rect = horiz ? { x1: g1, y1: h1, x2: g2, y2: h1 + w - 1 } : { x1: h1, y1: g1, x2: h1 + w - 1, y2: g2 };
      let meets = true;
      for (let i = h1; i < h1 + w && meets; i++) meets = horiz ? (st.roomAt(fb.x2, i) === F.id && st.roomAt(sb.x1, i) === S.id) : (st.roomAt(i, fb.y2) === F.id && st.roomAt(i, sb.y1) === S.id);
      if (!meets) { why = why || 'a wall is not straight there'; continue; }
      if (doorwayBlocked(st, horiz ? 'east' : 'south', fb, h1, h1 + w - 1, true, hangs)) { why = why || 'furniture in ' + F.name + ' stands against that wall'; continue; }
      if (doorwayBlocked(st, horiz ? 'west' : 'north', sb, h1, h1 + w - 1, true, hangs)) { why = why || 'furniture in ' + S.name + ' stands against that wall'; continue; }
      const c = st.canPlaceHallway([rect]);
      if (!c.ok) { why = why || (/^overlaps /.test(c.msg || '') ? 'something is already between them' : (c.msg || 'it does not fit')); continue; }
      const nb = neighbourOf(st, rect, [A.id, Bm.id]);
      if (nb) { why = why || 'it would stand against ' + nb; continue; }
      return { ok: true, rect };
    }
    return refuse('There is no clear straight run for a hallway between ' + pair + ': ' + (why || 'nothing fits') + '.');
  }

  // a room's zones, checked and measured: each a style or a line, no two on the same part of the room
  function parseZones(list, env, live, notes) {
    const RS = env.RoomStyles, styleMenu = RS.menu().map(s => s.id + ' (' + s.name + ': ' + s.about + ')').join('; ');
    const ZONE_HOW = 'zones is a list of 1 to 4 parts of the room, each { area, style } or { area, line | purpose | shape }. Areas: ' + AREA_MENU + '. Styles: ' + styleMenu + '.';
    if (!Array.isArray(list) || !list.length || list.length > 4) return refuse(ZONE_HOW);
    const zones = [], cells = {};
    for (const z of list) {
      if (!z || typeof z !== 'object' || Array.isArray(z)) return refuse(ZONE_HOW);
      const bad = Object.keys(z).filter(k => ZONE_KEYS.indexOf(k) < 0);
      if (bad.length) return refuse('A zone only takes: ' + ZONE_KEYS.join(', ') + '. Not accepted: ' + bad.slice(0, 6).join(', ') + '.');
      const area = areaOf(z.area);
      if (!area) return refuse((z.area == null ? 'Each zone needs an area.' : 'There is no area called "' + String(z.area).slice(0, 30) + '".') + ' Areas: ' + AREA_MENU + '.');
      const [c, r, cs, rs] = AREAS[area];
      for (let yy = r; yy < r + rs; yy++) for (let xx = c; xx < c + cs; xx++) {
        if (cells[xx + ',' + yy]) return refuse(AREA_LABEL[area] + ' overlaps ' + AREA_LABEL[cells[xx + ',' + yy]] + '. Give each part of the room one thing.');
        cells[xx + ',' + yy] = area;
      }
      const isLine = z.line != null || z.purpose != null || z.shape != null;
      if (isLine === (z.style != null)) return refuse('Each zone is a style or a line: ' + AREA_LABEL[area] + ' needs exactly one of style, or line / purpose / shape.');
      if (!isLine) {
        if (['name', 'staff', 'dailyCap', 'tries'].some(k => z[k] != null)) return refuse('name, staff, dailyCap and tries belong to a line zone, not to ' + AREA_LABEL[area] + '.');
        const id = RS.resolve(z.style);
        if (!id) return refuse('There is no style called "' + String(z.style).slice(0, 30) + '". Styles: ' + styleMenu + '.');
        const set0 = RS.STYLES[id].sets[0];
        zones.push({ area, kind: 'style', style: id, need: { w: set0.w + 3, h: set0.h + 2 } });
      } else {
        const ln = parseLine(z, env, live, notes); if (!ln.ok) return ln;
        zones.push(Object.assign({ area }, ln.line));
      }
    }
    return { ok: true, zones };
  }
  // one workflow line asked for (a zone's, or one of a room's `lines`): its graph, and the floor it takes laid out in the open
  function parseLine(z, env, live, notes) {
    if (!env.LineLayout || !env.LineLayout.layout) return refuse('the layout engine is not loaded on this page');
    const staff = z.staff == null ? [] : z.staff;
    const sl = stepsListOk(staff); if (!sl.ok) return refuse(sl.error.replace(/^steps /, 'staff '));
    for (const x of staff) if (x && x.agent != null) { const a = agentOf(env, x.agent); if (!a.ok) return a; }
    const zl = zoneLine(live, env, z, notes); if (!zl.ok) return zl;
    const L0 = env.LineLayout.layout(zl.graph, { rects: [{ x1: 0, y1: 0, x2: 119, y2: 79 }], blocked: [], belts: {}, junctions: [] });
    if (!L0.ok) return refuse('that line could not be laid out (' + (L0.error || 'no layout') + ')');
    return { ok: true, line: Object.assign({ kind: 'line', staff, need: { w: L0.box.x2 - L0.box.x1 + 1, h: L0.box.y2 - L0.box.y1 + 1 } }, zl) };
  }
  /* The floor a list of lines takes, laid the way the layout engine fills a room: left to right in a row while they fit,
     then a new row, a clear tile between neighbours. Of every row width it answers the one nearest a room's usual shape
     (about 1.7 wide to 1 tall) that StarNet can build at once. */
  function packLines(lines) {
    const shelf = maxW => { let w = 0, h = 0, rw = 0, rh = 0; for (const l of lines) { const lw = l.need.w, lh = l.need.h; if (rw && rw + 1 + lw > maxW) { w = Math.max(w, rw); h += rh + 1; rw = 0; rh = 0; } rw = rw ? rw + 1 + lw : lw; rh = Math.max(rh, lh); } return { w: Math.max(w, rw), h: h + rh }; };
    const widths = new Set(); let acc = 0;
    for (const l of lines) { acc = acc ? acc + 1 + l.need.w : l.need.w; widths.add(acc); widths.add(l.need.w); }
    let best = null, bs = Infinity;
    for (const mw of widths) { const p = shelf(mw), over = p.w > DESIGN_MAX[0] || p.h > DESIGN_MAX[1], sc = Math.max(p.w / 1.7, p.h) + (over ? 1000 : 0); if (sc < bs) { bs = sc; best = p; } }
    return best;
  }
  /* what a room's contents need: for zones, a 2 × 2 grid (each column as wide as its widest zone, each row as tall as its
     tallest; a zone across both shares them out) and where the grid splits, as fractions of the room; for a list of lines,
     the rows packLines lays them in (hardW × hardH: the least any room must be, its biggest single line) */
  function contentNeed(zones, lines) {
    if (lines.length) { const p = packLines(lines); return { w: p.w, h: p.h, fx: 1, fy: 1, one: true, hardW: Math.max(...lines.map(l => l.need.w)), hardH: Math.max(...lines.map(l => l.need.h)) }; }
    if (!zones.length) return { w: 0, h: 0, fx: 1, fy: 1, one: true };
    const colNeed = [0, 0], rowNeed = [0, 0];
    let spanW = 0, spanH = 0;
    for (const z of zones) {
      const [c, r, cs, rs] = AREAS[z.area];
      if (cs === 1) colNeed[c] = Math.max(colNeed[c], z.need.w); else spanW = Math.max(spanW, z.need.w);
      if (rs === 1) rowNeed[r] = Math.max(rowNeed[r], z.need.h); else spanH = Math.max(spanH, z.need.h);
    }
    const share = (need, span) => {
      let [a, b] = need;
      if (!a && !b) { a = Math.ceil(span / 2); b = span - a; }
      else if (!a) a = b; else if (!b) b = a;
      if (a + b < span) { const more = span - a - b; a += Math.ceil(more / 2); b += more >> 1; }
      return [a, b];
    };
    const one = zones.length === 1 && zones[0].area === 'whole';
    if (one) return { w: zones[0].need.w, h: zones[0].need.h, fx: 1, fy: 1, one: true };
    const [c0, c1] = share(colNeed, spanW), [r0, r1] = share(rowNeed, spanH);
    return { w: c0 + c1, h: r0 + r1, fx: c0 / (c0 + c1), fy: r0 / (r0 + r1), one: false };
  }

  /* FILL A ROOM on the probe: lines first (each laid inside its zone, or anywhere in the room, by the layout engine — never
     on a doorway's landing), then every style's furniture. `split` says where the 2 × 2 grid divides the room. Answers the
     part of the spec it built ({ lines, props }) and what the card will say about it; the probe holds the result. */
  function fillRoom(probe, env, roomId, R, zones, lines, split, roomLabel, recruitBase) {
    if (lines.length) {
      const cp = env.WorldModel.create(clone(probe.serialize()));
      if (fillRoomOnce(cp, env, roomId, R, zones, lines, split, roomLabel, recruitBase, true).ok) return fillRoomOnce(probe, env, roomId, R, zones, lines, split, roomLabel, recruitBase, true);
    }
    return fillRoomOnce(probe, env, roomId, R, zones, lines, split, roomLabel, recruitBase, false);
  }
  function fillRoomOnce(probe, env, roomId, R, zones, lines, split, roomLabel, recruitBase, centred) {
    const WM = env.WorldModel;
    const Wd = R.x2 - R.x1 + 1, Hd = R.y2 - R.y1 + 1;
    const cx = R.x1 + Math.max(1, Math.min(Wd - 1, Math.round(Wd * split.fx))), ry = R.y1 + Math.max(1, Math.min(Hd - 1, Math.round(Hd * split.fy)));
    const colX = [[R.x1, cx - 1], [cx, R.x2]], rowY = [[R.y1, ry - 1], [ry, R.y2]];
    const rectOf = a => { if (a == null || a === 'whole' || split.one) return { x1: R.x1, y1: R.y1, x2: R.x2, y2: R.y2 }; const [c, r, cs, rs] = AREAS[a]; return { x1: colX[c][0], x2: colX[c + cs - 1][1], y1: rowY[r][0], y2: rowY[r + rs - 1][1] }; };
    const land = landingTiles(probe, probe.projectGeometry(), roomId);
    const out = { lines: [], props: [], view: [], recruits: [] };
    const whereOf = z => z.area ? AREA_LABEL[z.area] + ' of ' + roomLabel : roomLabel;
    const lineList = zones.filter(q => q.kind === 'line').concat(lines);
    for (const z of lineList) {
      const zr = rectOf(z.area), fl = probe.lineGraph(null), nth = lines.indexOf(z);
      if (!fl || !fl.ok) return refuse('this floor does not build by links');
      /* lines are told apart by their belts TOUCHING (Pipeline.lineComponents), so a new line keeps a clear tile from every
         belt and every workflow machine already on the floor; and it never stands on a doorway's landing */
      const halo = [];
      for (const k in fl.floor.belts) { const [x, y] = k.split(',').map(Number); halo.push({ x: x - 1, y: y - 1, w: 3, h: 3 }); }
      for (const p of probe.props()) if (MACHINE_T.test(p.t)) halo.push({ x: p.x - 1, y: p.y - 1, w: (p.w || 1) + 2, h: (p.h || 1) + 2 });
      const floor = Object.assign({}, fl.floor, { rects: [zr], blocked: fl.floor.blocked.concat(halo, [...land].map(k => { const [x, y] = k.split(',').map(Number); return { x, y, w: 1, h: 1 }; })) });
      const near = { x: (zr.x1 + zr.x2) >> 1, y: (zr.y1 + zr.y2) >> 1 };
      let L = env.LineLayout.layout(z.graph, floor, z.area || (nth >= 0 && centred) ? { near } : undefined);
      if (!L.ok && env.LineEdit && env.LineEdit._internals && env.LineEdit._internals.layoutNear) L = env.LineEdit._internals.layoutNear(env.LineLayout, z.graph, floor, near, 12);
      if (!L.ok) return refuse(whereOf(z) + ' is ' + (zr.x2 - zr.x1 + 1) + ' × ' + (zr.y2 - zr.y1 + 1) + (z.area ? '' : ' and has no clear floor left') + '; ' + (z.plain === 'a custom line' ? 'that line' : z.plain) + ' needs ' + z.need.w + ' × ' + z.need.h + '.', { tooSmall: true });
      const a = probe.applyLineLayout(clone(z.graph), L);
      if (!a || !a.ok) return refuse('that line could not be laid in ' + whereOf(z) + (a && a.msg ? ' (' + a.msg + ')' : ''));
      // its steps in RUN ORDER (a stand-in crew on a copy, so the order follows the belts), then who works them
      const lineIds = z.graph.nodes.map(n => a.ids[n.id]).filter(Boolean), nodeOf = {};
      for (const n of z.graph.nodes) nodeOf[a.ids[n.id]] = n;
      const cp = WM.create(clone(probe.serialize())), bayIds = lineIds.filter(pid => (nodeOf[pid] || {}).t === 'bay');
      bayIds.forEach((pid, i) => cp.assignPropAgent(pid, '__sb_probe_' + i));
      const shape = readLine(cp, lineIds, env, null), runOrder = shape.order.length === bayIds.length ? shape.order : bayIds;
      const stepsOut = runOrder.map((pid, i) => ({ step: i + 1, role: (nodeOf[pid] || {}).role || 'STEP', node: nodeOf[pid].id, brief: '', agentId: '' }));
      const st = staffSteps(stepsOut, z.staff, env, z.purpose); if (!st.ok) return st;
      for (const x of stepsOut) {
        if (x.brief) probe.setPropBrief(a.ids[x.node], x.brief);
        if (x.agentId) probe.assignPropAgent(a.ids[x.node], x.agentId);
      }
      out.lines.push({ graph: clone(z.graph), L, steps: stepsOut.map(x => ({ node: x.node, brief: x.brief, agentId: x.agentId })) });
      stepsOut.filter(x => x.recruit).forEach(x => out.recruits.push({ line: out.lines.length - 1, node: x.node, role: x.role }));
      out.view.push({ area: z.area || null, kind: 'line', rect: zr, z, lineIds, shape, runOrder, stepsOut, line: out.lines.length - 1 });
    }
    for (const z of zones.filter(q => q.kind === 'style')) {
      const zr = rectOf(z.area), sets = env.RoomStyles.STYLES[z.style].sets, inner = { x1: zr.x1 + 1, y1: zr.y1 + 1, x2: zr.x2 - 1, y2: zr.y2 - 1 };
      const iw = inner.x2 - inner.x1 + 1, ih = inner.y2 - inner.y1 + 1, onRight = zr.x2 === R.x2 && zr.x1 !== R.x1;
      let placed = null;
      const belts = probe.serialize().belts;
      for (const set of sets) {
        if (set.w > iw || set.h > ih) continue;
        const wallX = onRight ? inner.x2 - set.w + 1 : inner.x1, xs = [...new Set([wallX, onRight ? wallX - 1 : wallX + 1, inner.x1 + ((iw - set.w) >> 1), onRight ? inner.x1 : inner.x2 - set.w + 1])].filter(x => x >= inner.x1 && x + set.w - 1 <= inner.x2);
        const ys = [...new Set([inner.y1, inner.y1 + 1, inner.y1 + ((ih - set.h) >> 1), inner.y2 - set.h + 1])].filter(y => y >= inner.y1 && y + set.h - 1 <= inner.y2);
        outer: for (const mirror of onRight ? [true, false] : [false, true]) for (const y0 of ys) for (const x0 of xs) {
          const props = setProps(env, set, x0, y0, mirror); if (!props) return refuse('this page is missing the furniture for ' + env.RoomStyles.STYLES[z.style].name);
          const clash = props.some(p => { for (let yy = p.y; yy < p.y + p.h; yy++) for (let xx = p.x; xx < p.x + p.w; xx++) {
            if (probe.roomAt(xx, yy) !== roomId || probe.propAt(xx, yy) || belts[xx + ',' + yy] || (p.block && land.has(xx + ',' + yy))) return true; }
            return false; });
          if (clash) continue;
          const cp = WM.create(clone(probe.serialize())), added = [];
          let ok = true;
          for (const p of props) { const r = cp.addProp({ t: p.t, x: p.x, y: p.y, w: p.w, h: p.h, r: p.r || 0, block: p.block }); if (!r || !r.ok) { ok = false; break; } added.push(r.id); }
          if (!ok) continue;
          const g = cp.projectGeometry(), o = spawnTile(cp.serialize(), g);
          if (added.some(pid => { const p = cp.propById(pid); return p && p.block !== false && !sideReachable(g, o, p); })) continue;
          placed = { props }; break outer;
        }
        if (placed) break;
      }
      if (!placed) return refuse(whereOf(z) + ' is ' + (zr.x2 - zr.x1 + 1) + ' × ' + (zr.y2 - zr.y1 + 1) + ', with no clear spot there for ' + env.RoomStyles.STYLES[z.style].name + ' (it needs ' + (sets[sets.length - 1].w + 2) + ' × ' + (sets[sets.length - 1].h + 2) + ' of clear floor).', { tooSmall: true });
      for (const p of placed.props) probe.addProp({ t: p.t, x: p.x, y: p.y, w: p.w, h: p.h, r: p.r || 0, block: p.block });
      out.props.push(...placed.props);
      out.view.push({ area: z.area, kind: 'style', rect: zr, z, props: placed.props });
    }
    return Object.assign({ ok: true }, out);
  }

  // the edit list of a build: each part its hallway, its room (or the existing room it fills), its lines, its furniture
  function buildParts(st, spec, WM) {
    const ids = [], parts = [];
    for (const part of spec.parts || []) {
      let roomId = part.roomId || null, hallId = null;
      if (part.hall) {
        const r = st.placeHallway({ rect: part.hall }); if (!r || !r.ok) return refuse('the hallway could not be laid there' + (r && r.msg ? ' (' + r.msg + ')' : '')); hallId = r.id;
        if (part.hallDeck) { const d = st.setDeck(hallId, part.hallDeck); if (!d || !d.ok) return refuse('the hallway floor could not be laid'); }
      }
      if (part.room) {
        const r = st.addRoom({ kind: part.room.kind, name: part.room.name, floorStyle: part.room.floorStyle, floorMat: part.room.floorMat, rect: part.room.rect });
        if (!r || !r.ok) return refuse('the room could not be added there' + (r && r.msg ? ' (' + r.msg + ')' : ''));
        roomId = r.id;
        if (part.room.walls) { const w = st.setWalls(roomId, part.room.walls); if (!w || !w.ok) return refuse('the walls could not be put up'); }
      }
      // lines first (the layout each was planned with was laid on exactly this floor), then the furniture
      const lines = [], mine = [];
      for (const ln of part.lines || []) {
        const a = st.applyLineLayout(clone(ln.graph), ln.L);
        if (!a || !a.ok) return refuse('a line could not be laid there' + (a && a.msg ? ' (' + a.msg + ')' : ''));
        const idOf = a.ids || {};
        for (const s of ln.steps || []) {
          const pid = idOf[s.node];
          if (!pid) return refuse('a step is missing');
          if (s.brief) { const r = st.setPropBrief(pid, s.brief); if (!r || !r.ok) return refuse('a step\'s instructions could not be saved'); }
          if (s.agentId) { const r = st.assignPropAgent(pid, s.agentId); if (!r || !r.ok) return refuse('a step\'s agent could not be assigned'); }
        }
        const lineIds = ln.graph.nodes.map(n => idOf[n.id]).filter(Boolean);
        mine.push(...lineIds);
        lines.push({ idOf, lineIds });
      }
      for (const p of part.props || []) {
        const r = st.addProp({ t: p.t, x: p.x, y: p.y, w: p.w, h: p.h, r: p.r || 0, block: p.block });
        if (!r || !r.ok) return refuse('a piece of furniture could not be placed there' + (r && r.msg ? ' (' + r.msg + ')' : ''));
        mine.push(r.id);
      }
      ids.push(...mine);
      parts.push({ roomId, hallId, lines, ids: mine });
    }
    return { ok: true, ids, parts, roomId: parts.length ? parts[0].roomId : null, lines: [].concat(...parts.map(p => p.lines)) };
  }
  // the same checks as every plan: no new routing problem, every existing line routes as before, and in each room nothing
  // solid on a doorway's landing and every new piece and machine reachable on foot (through the new hallways)
  function tryBuild(doc, spec, env, before) {
    const WM = env.WorldModel, P = env.Pipeline;
    const probe = WM.create(clone(doc));
    const b = buildParts(probe, spec, WM);
    if (!b.ok) return b;
    const after = floorFacts(probe, P), g = after.geo;
    for (const e of after.errs) if (!before.errs.has(e)) return refuse('that would add a routing problem (' + e.split(':')[0] + ')');
    for (const dock in before.chains) if (JSON.stringify(before.chains[dock]) !== JSON.stringify(after.chains[dock])) return refuse('that would change how an existing line routes');
    for (const dock in before.reach) if (!!before.reach[dock] !== !!after.reach[dock]) return refuse('that would change which existing steps an Inbox reaches');
    const o = spawnTile(probe.serialize(), g);
    for (const part of b.parts) {
      const land = landingTiles(probe, g, part.roomId || part.hallId);
      for (const pid of part.ids) {
        const p = probe.propById(pid);
        if (!p || p.block === false) continue;
        for (let yy = p.y; yy < p.y + p.h; yy++) for (let xx = p.x; xx < p.x + p.w; xx++) if (land.has(xx + ',' + yy)) return refuse('something would block a doorway');
        if (!sideReachable(g, o, p)) return refuse('something could not be walked up to');
      }
      if (o && part.hallId && !part.roomId) {
        const hr = probe.rooms().find(r => r.id === part.hallId), H = hr && hr.rects[0];
        if (H && !g.path(o.x - g.origin.tx, o.y - g.origin.ty, ((H.x1 + H.x2) >> 1) - g.origin.tx, ((H.y1 + H.y2) >> 1) - g.origin.ty)) return refuse('that hallway could not be walked into');
      }
      // an empty room must still be one the crew can walk into
      if (o && part.roomId && !part.ids.length) {
        const rm = probe.rooms().find(r => r.id === part.roomId), R = rm && rm.rects[0];
        if (R && !g.path(o.x - g.origin.tx, o.y - g.origin.ty, ((R.x1 + R.x2) >> 1) - g.origin.tx, ((R.y1 + R.y2) >> 1) - g.origin.ty)) return refuse('that room could not be walked into');
      }
    }
    return { ok: true, probe, built: b };
  }

  function planBuild(doc, req, env) {
    const WM = env && env.WorldModel, P = env && env.Pipeline, W = env && env.WorkflowLine, RS = env && env.RoomStyles;
    if (!WM || !P || !W || !doc || !env.PropSprites || !RS) return refuse('the station builder is not loaded on this page');
    if (req && typeof req === 'object' && !Array.isArray(req) && req.layout != null) return planLayout(doc, req, env);
    const HOW = 'Send { "rooms": [ … ] }: 1 to 6 rooms, each with ' + ROOM_KEYS.join(', ') + '; and/or { "hallways": [ { "from": room, "to": room } ] } to join rooms that face each other.';
    if (!req || typeof req !== 'object' || Array.isArray(req)) return refuse(HOW);
    const extra = Object.keys(req).filter(k => BUILD_MENU.indexOf(k) < 0);
    if (extra.length) return refuse('StarNet computes every tile itself, so these fields are not accepted: ' + extra.slice(0, 8).join(', ') + '. ' + HOW);
    const reqRooms = req.rooms == null ? [] : req.rooms, reqHalls = req.hallways == null ? [] : req.hallways;
    if (!Array.isArray(reqRooms) || reqRooms.length > 6 || !Array.isArray(reqHalls) || reqHalls.length > 6 || !(reqRooms.length + reqHalls.length)) return refuse(HOW);
    const notes = [], live = WM.create(clone(doc)), before = floorFacts(live, P);
    let probe = WM.create(clone(doc));
    const spec = { kind: 'build', parts: [], recruits: [] }, rooms = [], usedNames = {};
    for (let i = 0; i < reqRooms.length; i++) {
      const q = reqRooms[i], nth = 'Room ' + (i + 1);
      if (!q || typeof q !== 'object' || Array.isArray(q)) return refuse(HOW);
      const bad = Object.keys(q).filter(k => ROOM_KEYS.indexOf(k) < 0);
      if (bad.length) return refuse('StarNet computes every tile itself, so a room does not take: ' + bad.slice(0, 8).join(', ') + '. A room takes: ' + ROOM_KEYS.join(', ') + '.');
      const style = styleOf(WM, q); if (!style.ok) return style;
      // what goes in it: zones (by part of the room), or lines (anywhere in it), or nothing yet
      if (q.zones != null && q.lines != null) return refuse(nth + ' takes zones (what goes in each part of it) or lines (workflow lines anywhere in it), not both.');
      let zones = [], lines = [];
      if (q.zones != null) { const z = parseZones(q.zones, env, live, notes); if (!z.ok) return z; zones = z.zones; }
      if (q.lines != null) {
        if (!Array.isArray(q.lines) || !q.lines.length || q.lines.length > 6) return refuse('lines is a list of 1 to 6 workflow lines, each { line | purpose | shape, name, staff, dailyCap, tries }.');
        for (const l of q.lines) {
          if (!l || typeof l !== 'object' || Array.isArray(l)) return refuse('Each of a room\'s lines is an object with: ' + LINE_KEYS.join(', ') + '.');
          const lb = Object.keys(l).filter(k => LINE_KEYS.indexOf(k) < 0);
          if (lb.length) return refuse('A line only takes: ' + LINE_KEYS.join(', ') + '. Not accepted: ' + lb.slice(0, 6).join(', ') + '.');
          const ln = parseLine(l, env, live, notes); if (!ln.ok) return ln;
          lines.push(ln.line);
        }
      }
      // a whole-room style: its floor, walls and furniture from wall to wall, around any lines
      let rstyle = null;
      if (q.style != null) {
        rstyle = RS.resolveRoom ? RS.resolveRoom(q.style) : null;
        if (!rstyle) return refuse('There is no room style "' + String(q.style).slice(0, 40) + '". Styles: ' + (RS.ROOM_ORDER || []).join(', ') + '.');
        if (zones.length) return refuse(nth + ' takes a style (furnished whole) or zones (part by part), not both.');
        if (lines.length && rstyle !== 'works') return refuse(nth + ': lines go in a works room (a conveyor hall), so leave style out or set it to works.');
      }
      const rec = rstyle ? RS.ROOMS[rstyle] : null;
      const need = contentNeed(zones, lines);
      const given = typeof q.name === 'string' ? q.name.replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 24) : '';

      // an EXISTING room, furnished or filled where it stands
      if (q.into != null) {
        if (['size', 'beside', 'side', 'hallway', 'align'].some(k => q[k] != null)) return refuse(nth + ' fills an existing room (into), so it takes no size, beside, side, hallway or align.');
        if (given) return refuse('name names a NEW room; ' + String(q.into).slice(0, 40) + ' keeps its name (plan_restyle renames a room).');
        if (!zones.length && !lines.length && !rec) return refuse(nth + ' names an existing room (into) but nothing to put in it: give a style, zones or lines.');
        const t = roomNamed(probe, q.into); if (!t.ok) return t;
        const T = t.room;
        if (T.rects.length > 1) return refuse(T.name + ' is not a plain rectangle, so it cannot be split into zones. Build a new room instead.');
        const cp = WM.create(clone(probe.serialize())), R = T.rects[0];
        const f = fillRoom(cp, env, T.id, R, zones, lines, zones.length && !need.one ? { fx: 0.5, fy: 0.5, one: false } : { fx: 1, fy: 1, one: true }, T.name, 0);
        if (!f.ok) return f;
        const dr = rec ? dressRoom(cp, env, T.id, rstyle) : null;
        if (dr && !dr.ok) return dr;
        if (dr && !dr.props.length) return refuse(T.name + ' has no clear floor left for ' + rec.name + '.');
        probe = cp;
        spec.parts.push({ hall: null, room: null, roomId: T.id, lines: f.lines, props: f.props.concat(dr ? dr.props : []) });
        f.recruits.forEach(rc => spec.recruits.push(Object.assign({ part: spec.parts.length - 1 }, rc)));
        rooms.push({ part: spec.parts.length - 1, name: T.name, existing: true, R, view: f.view, placed: null, dressed: dr ? { style: rstyle, props: dr.props } : null });
        continue;
      }

      // a NEW room: its size, the room it stands beside, the side, the hallway
      const sz = sizeOfRoom(q.size); if (!sz.ok) return sz;
      const sd = sideOf(q.side); if (!sd.ok) return sd;
      const hl = hallOf(q.hallway); if (!hl.ok) return hl;
      let align = null;
      if (q.align != null) { align = { center: 'center', centre: 'center', middle: 'center', start: 'start', end: 'end' }[norm(q.align)]; if (!align) return refuse('align is center, start or end (where along the shared wall the room sits; start is the north or west end).'); }
      const minWH = zones.length > 1 ? DESIGN_MIN_MANY : (zones.length || lines.length) ? DESIGN_MIN_ONE : SIZES.medium;
      const tooSmall = () => refuse((given || nth) + ' at ' + sz.size[0] + ' × ' + sz.size[1] + ' is too small for what goes in it: that needs about ' + Math.max(need.w, minWH[0]) + ' × ' + Math.max(need.h, minWH[1]) + '. Leave size out, or ask for a bigger one.');
      if (sz.size && ((need.hardW || need.w) > sz.size[0] || (need.hardH || need.h) > sz.size[1])) return tooSmall();
      const RW = sz.size ? sz.size[0] : Math.max(need.w, minWH[0]), RH = sz.size ? sz.size[1] : Math.max(need.h, minWH[1]);
      if (RW > DESIGN_MAX[0] || RH > DESIGN_MAX[1]) return refuse('What goes in ' + (given || nth) + ' needs a ' + RW + ' × ' + RH + ' room, larger than the ' + DESIGN_MAX[0] + ' × ' + DESIGN_MAX[1] + ' StarNet builds at once. Split it into two rooms.');
      const tq = q.beside != null ? roomNamed(probe, q.beside) : { ok: true, room: null };   // no room named: beside whichever keeps the station compact
      if (!tq.ok) return tq;
      const kind = (style.type && style.type.id) || (rec && rec.kind) || 'hab';
      // no name given: the room is named for what fills it first (COZY, the line's own name), else ROOM n
      const z0 = zones[0] || lines[0], auto = !z0 ? 'ROOM ' + (live.rooms().filter(r => r.kind !== 'corridor').length + rooms.filter(r => !r.existing).length + 1) : z0.kind === 'style' ? z0.style.toUpperCase() : String(z0.label || z0.plain || 'WORKROOM').toUpperCase();
      const taken = nm => probe.rooms().some(r => r.kind !== 'corridor' && norm(r.name) === norm(nm)) || usedNames[norm(nm)];
      let name = (given || auto).slice(0, 24);
      if (given && taken(name)) return refuse('A room is already called ' + name + '. Give this one another name.');
      for (let k = 2; !given && taken(name) && k < 50; k++) name = (auto.slice(0, 21) + ' ' + k);
      usedNames[norm(name)] = 1;
      const roomSpec = { kind, name, floorStyle: style.floorStyle || (rec && !style.type ? rec.deck.style : undefined), floorMat: style.floorMat || (rec && !style.type ? rec.deck.mat : undefined), walls: rec ? rec.walls : undefined };
      // a size StarNet chose is an estimate: when the contents do not fit it, the room grows and tries again
      const tries = sz.size ? [[RW, RH]] : [[RW, RH], [RW + 2, RH + 1], [RW + 4, RH + 3], [RW + 7, RH + 5]].filter(([w, h], i) => !i || (w <= DESIGN_MAX[0] && h <= DESIGN_MAX[1]));
      let got = null, why = null;
      for (const [TW, TH] of tries) {
      const pl = roomPlacements(probe, tq.room, TW, TH, { side: sd.side, len: hl.len, align, kind, hangs: hangsOf(env) });
      if (!pl.ok) { why = why || pl; break; }
      let small = false;
      for (const cand of pl.list) {
        const cp = WM.create(clone(probe.serialize()));
        if (cand.hall) { const h = cp.placeHallway({ rect: cand.hall }); if (!h || !h.ok) { why = why || refuse('the hallway could not be laid there'); continue; } }
        const a = cp.addRoom(Object.assign({}, roomSpec, { rect: cand.rect }));
        if (!a || !a.ok) { why = why || refuse('the room could not be added there'); continue; }
        if (roomSpec.walls) cp.setWalls(a.id, roomSpec.walls);
        const f = fillRoom(cp, env, a.id, cand.rect, zones, lines, need, name, 0);
        if (!f.ok) { if (!why || f.tooSmall) why = f; if (f.tooSmall) { small = true; break; } continue; }
        const dr = rec ? dressRoom(cp, env, a.id, rstyle) : null;
        if (dr && !dr.ok) { why = why || dr; continue; }
        const part = { hall: cand.hall, room: Object.assign({}, roomSpec, { rect: cand.rect }), roomId: null, lines: f.lines, props: f.props.concat(dr ? dr.props : []) };
        const t = tryBuild(doc, { kind: 'build', parts: spec.parts.concat([part]) }, env, before);
        if (!t.ok) { why = why || t; continue; }
        got = { cand, f, part, cp, dr }; break;
      }
      if (got || !small) break;
      }
      if (!got && sz.size && why && why.tooSmall) return tooSmall();
      if (!got) return why || refuse('There is no clear space for ' + name + (tq.room ? ' beside ' + tq.room.name : '') + '.');
      probe = got.cp;
      spec.parts.push(got.part);
      got.f.recruits.forEach(rc => spec.recruits.push(Object.assign({ part: spec.parts.length - 1 }, rc)));
      rooms.push({ part: spec.parts.length - 1, name, existing: false, R: got.cand.rect, view: got.f.view, placed: got.cand, word: sz.word || null, dressed: got.dr ? { style: rstyle, props: got.dr.props } : null });
    }
    // hallways between rooms that already stand, or that this plan has just added
    const halls = [];
    for (const h of reqHalls) {
      if (!h || typeof h !== 'object' || Array.isArray(h) || h.from == null || h.to == null || Object.keys(h).some(k => k !== 'from' && k !== 'to')) return refuse('Each hallway is { "from": a room, "to": another room }. StarNet lays it straight between them.');
      const A = roomNamed(probe, h.from); if (!A.ok) return A;
      const B = roomNamed(probe, h.to); if (!B.ok) return B;
      if (A.room.id === B.room.id) return refuse('A hallway joins two different rooms.');
      const hb = hallBetween(probe, A.room, B.room, hangsOf(env)); if (!hb.ok) return hb;
      const r = probe.placeHallway({ rect: hb.rect }); if (!r || !r.ok) return refuse('the hallway could not be laid there');
      spec.parts.push({ hall: hb.rect, room: null, roomId: null, lines: [], props: [] });
      halls.push({ from: A.room.name, to: B.room.name, len: Math.max(hb.rect.x2 - hb.rect.x1, hb.rect.y2 - hb.rect.y1) + 1 });
    }
    const t = tryBuild(doc, spec, env, before);
    if (!t.ok) return t;

    // what the card says: each room (where it stands and how it is joined), what is in it, the equipment, what is still to do
    const fp = t.probe, built = t.built, crewIds = (env.crew || []).map(a => a && a.id).filter(Boolean);
    const rp = WM.create(clone(fp.serialize())), deskRooms = [];
    spec.recruits.forEach((rc, i) => {
      const id = '__sb_recruit_' + i, d = rp.ensureWorkstation(id);
      if (d && d.ok && d.roomId) { const rm = rp.roomById ? rp.roomById(d.roomId) : null; if (rm && deskRooms.indexOf(rm.name) < 0) deskRooms.push(rm.name); }
      rp.assignPropAgent(built.parts[rc.part].lines[rc.line].idOf[rc.node], id); crewIds.push(id);
    });
    const allLines = [].concat(...rooms.map(r => r.view.filter(v => v.kind === 'line')));
    const lines = [], steps = [], equipProps = [], zonesView = [];
    const roomText = rooms.map(r => {
      const Wd = r.R.x2 - r.R.x1 + 1, Hd = r.R.y2 - r.R.y1 + 1;
      const where = r.existing ? r.name + ' (' + Wd + ' × ' + Hd + ')'
        : r.name + ', a new ' + Wd + ' × ' + Hd + ' room ' + r.placed.side + ' of ' + r.placed.target + (r.placed.len ? ', through a hallway' : ', open to it');
      r.where = where;
      const order = (reqRooms[rooms.indexOf(r)].zones || []).map(z => areaOf(z.area));
      const body = r.view.slice().sort((a, b) => (a.area ? order.indexOf(a.area) : 99) - (b.area ? order.indexOf(b.area) : 99)).map(v => {
        const at = v.area && !(r.view.length === 1 && v.area === 'whole') ? AREA_LABEL[v.area] + ', ' : '';
        if (v.kind === 'style') {
          equipProps.push(...v.props);
          zonesView.push({ rect: v.rect, where: v.area ? AREA_LABEL[v.area].replace(/^the /, '') + (rooms.length > 1 ? ' of ' + r.name : '') : (rooms.length > 1 ? r.name : 'room'), label: env.RoomStyles.STYLES[v.z.style].name });
          return at + env.RoomStyles.STYLES[v.z.style].name + ' (' + piecesText(env, v.props) + ')';
        }
        const bl = built.parts[r.part].lines[v.line], ids = bl.lineIds, rd = readLine(rp, ids, env, crewIds);
        const recruitNodes = new Set(spec.recruits.filter(x => x.part === r.part && x.line === v.line).map(x => x.node));
        const stepsView = v.stepsOut.map(x => ({ step: x.step, role: titleCase(x.role), agent: recruitNodes.has(x.node) ? 'a new recruit' : x.agentId ? nameOf(env, x.agentId) : null, instructions: x.brief }));
        stepsView.forEach(s => steps.push(Object.assign({}, s, { role: s.role + (allLines.length > 1 ? ' on ' + (v.z.label || v.z.plain) : '') })));
        const capP = ids.map(id => fp.propById(id)).find(p => p && p.t === 'intake'), capNow = capP && capP.limits ? capP.limits.maxUsdPerDay : null;
        lines.push({ label: v.z.label, plain: v.z.plain, room: r.name, area: v.area, part: r.part, line: v.line, ready: rd.ready, blocking: rd.blocking, picked: v.z.picked });
        equipProps.push(...ids.map(id => fp.propById(id)).filter(Boolean));
        zonesView.push({ rect: v.area ? v.rect : r.R, where: v.area ? AREA_LABEL[v.area].replace(/^the /, '') + (rooms.length > 1 ? ' of ' + r.name : '') : (rooms.length > 1 ? r.name : 'room'), label: v.z.label || v.z.plain });
        return at + v.z.plain + (v.z.label ? ' ("' + v.z.label + '")' : '') + ': ' + flowText(v.shape.cols, v.runOrder, stepsView)
          + (v.z.graph.nodes.some(n => n.t === 'outbox') ? ' → Outbox' : '') + (capP ? (capNow != null ? ' · daily cap $' + capNow : ' · no daily cap') : '');
      });
      if (r.dressed) {
        equipProps.push(...r.dressed.props);
        const txt = piecesText(env, r.dressed.props).split(', '), pieces = txt.length > 7 ? txt.slice(0, 6).join(', ') + ' and more' : txt.join(', ');
        body.unshift(env.RoomStyles.ROOMS[r.dressed.style].name + (r.dressed.props.length && r.dressed.style !== 'works' ? ' (' + pieces + ')' : ''));
      }
      return where + ': ' + (body.length ? body.join('; ') : 'empty floor, ready for lines and furniture') + '.';
    });
    const equip = equipmentOf(env, equipProps), gains = gainsOf(env, equipProps);
    const blocking = [].concat(...lines.map(l => l.blocking.map(b => (lines.length > 1 ? (l.label || l.plain) + ': ' : '') + b)));
    const hallText = halls.map(h => 'A new hallway joins ' + h.from + ' and ' + h.to + '.');
    const summary = roomText.concat(hallText).join(' ')
      + (equip.length ? ' It brings equipment: ' + equip.join(', ') + (gains.length ? '. What agents gain there: ' + gains.join('; ') : '') + '.' : '')
      + (lines.length ? ' ' + (blocking.length ? 'Still to do after building: ' + blocking.join('; ') + '.' : (lines.length > 1 ? 'Its lines will be ready to run.' : 'It will be ready to run.')) : '')
      + (spec.recruits.length ? ' It adds ' + spec.recruits.length + ' crew member' + (spec.recruits.length > 1 ? 's' : '') + ': ' + spec.recruits.map(r => r.role).join(', ') + (deskRooms.length ? ', with a desk in ' + deskRooms.join(' and ') : '') + '. UNDO does not remove agents; DELETE AGENT in a Dossier does.' : '')
      + lines.filter(l => l.picked).map(l => ' Picked for ' + (l.label || l.plain) + ': ' + l.picked + '.').join('');
    const fpd = fp.serialize();
    const preview = previewOf(WM, doc, fpd, zonesView, null);
    for (const r of rooms) if (r.existing) { const pr = preview.rooms[fpd.order.indexOf(spec.parts[r.part].roomId)]; if (pr) pr.mine = true; }
    return { ok: true, plan: { floorSig: sigOf(doc), resultSig: sigOf(fpd), spec, summary, notes, steps,
      rooms: rooms.map(r => ({ name: r.name, where: r.where, existing: r.existing })), hallways: halls,
      where: rooms.map(r => r.where).concat(halls.map(h => 'a hallway between ' + h.from + ' and ' + h.to)).join('; '), lines, preview, line: null } };
  }

  /* ================= STATION LAYOUTS (2026-09-30): a whole station composed the way the hand-built showcases were =========
     Andrew, after seeing two stations laid out by hand ("this is so much better, can the agent reliably do this?"): the
     lead names a PATTERN and the rooms; StarNet composes the floor plan — the corridors, where every room sits, the halls
     that join them — furnishes each room from wall to wall in its style (floor, walls, feature wall, centrepiece, plants),
     and dresses the corridors. Two patterns:
       ring       a corridor loop around the hub room (the bridge) with a spoke in from each side; rooms around the outside
                  of the loop, two to the north, two to the south, one big room east and one west
       concourse  a wide corridor from one side of the hub, rooms on short halls down both sides, a big room at the far end
     Nothing is placed by the model. Added beside what stands (every check of a build holds), or with replace: true the
     whole station is laid out again around the hub (backed up for RESTORE PREVIOUS, like a preset swap). */
  const LAYOUT_KEYS = ['pattern', 'around', 'side', 'rooms'];
  const LAYOUT_ROOM_KEYS = ['name', 'style', 'size', 'lines', 'zones'];
  const PATTERNS = { diamond: 'diamond', ring: 'diamond', loop: 'diamond', circle: 'diamond', hub: 'diamond', star: 'diamond', cross: 'diamond', grid: 'diamond', concourse: 'concourse', corridor: 'concourse', spine: 'concourse', hallway: 'concourse', street: 'concourse', main: 'concourse' };
  const AUTO_NAME = { lounge: 'LOUNGE', cozy: 'DEN', games: 'ARCADE', library: 'LIBRARY', quarters: 'QUARTERS', garden: 'GARDEN', cafe: 'CAFE', desks: 'OFFICE',
    meeting: 'MEETING ROOM', lab: 'LAB', workshop: 'WORKSHOP', comms: 'COMMS', storage: 'STORES', gym: 'GYM', works: 'CONVEYOR HALL' };
  const CORRIDOR_DECK = { style: 'onyx', mat: 'runner' };

  // the tiles INSIDE a room (or hallway) where a doorway opens, and which way is into the room
  function doorTiles(st, g, roomId) {
    const out = [], ox = g.origin.tx, oy = g.origin.ty;
    for (const d of g.doorDefs || []) {
      const a = { x: d[0] + ox, y: d[1] + oy }, b = { x: d[2] + ox, y: d[3] + oy };
      const inA = st.roomAt(a.x, a.y) === roomId, inB = st.roomAt(b.x, b.y) === roomId;
      if (inA === inB) continue;
      const door = inA ? a : b, other = inA ? b : a;
      out.push({ x: door.x, y: door.y, dx: door.x - other.x, dy: door.y - other.y });
    }
    return out;
  }
  // take back any piece nobody can walk up to (and what stands on it), until every solid piece is reachable
  function pruneUnreachable(st, placed) {
    for (let pass = 0; pass < 4; pass++) {
      const g = st.projectGeometry(), o = spawnTile(st.serialize(), g);
      const drop = placed.filter(p => p.block && !sideReachable(g, o, p));
      if (!drop.length) return;
      for (const p of drop) {
        for (const q of placed) if (q !== p && !q.block && q.x >= p.x && q.x < p.x + p.w && q.y >= p.y && q.y < p.y + p.h) { st.removeProp(q.id); q.gone = true; }
        st.removeProp(p.id); p.gone = true;
      }
      for (let i = placed.length - 1; i >= 0; i--) if (placed[i].gone) placed.splice(i, 1);
    }
  }
  /* DRESS A ROOM from wall to wall in a whole-room style (RoomStyles.ROOMS), ON the probe: the feature wall is the one
     opposite the door (north unless a door is there), lined with the style's signature pieces; the centrepiece stands in
     the middle facing it; plants take the corners; accents stand along the side walls. Every doorway keeps a clear lane
     three tiles deep, nothing lands on a belt, and a piece nobody could walk up to is taken back out. Answers the pieces
     placed, in the order they were placed (a lamp after its table), for the build to lay again exactly. */
  function dressRoom(st, env, roomId, styleId) {
    const RS = env.RoomStyles, S = env.PropSprites, rec = RS && RS.ROOMS ? RS.ROOMS[styleId] : null;
    if (!rec) return refuse('there is no room style "' + styleId + '"');
    const rm = st.rooms().find(r => r.id === roomId); if (!rm) return refuse('the room is missing');
    const R = rm.rects[0], W = R.x2 - R.x1 + 1, H = R.y2 - R.y1 + 1;
    const g = st.projectGeometry(), doors = doorTiles(st, g, roomId), reserve = new Set(), onWall = { north: 0, south: 0, west: 0, east: 0 };
    for (const d of doors) {
      onWall[d.dy > 0 ? 'north' : d.dy < 0 ? 'south' : d.dx > 0 ? 'west' : 'east']++;
      for (let k = 0; k < 3; k++) reserve.add((d.x + d.dx * k) + ',' + (d.y + d.dy * k));
    }
    const flip = onWall.north > 0 && !onWall.south;   // the feature wall is the south one
    const belts = st.serialize().belts || {}, placed = [];
    // what already covers each tile: a rug ('flat') may lie under furniture, furniture ('solid') excludes anything but
    // what stands on a table
    const occ = new Map(), kindOf = sp => sp && sp.flat ? 'flat' : sp && sp.blocks === false ? 'other' : 'solid';
    const mark = (x, y, w, h, kind) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const k = xx + ',' + yy; if (kind !== 'flat' || !occ.has(k)) occ.set(k, kind); } };
    for (const p of st.props()) mark(p.x, p.y, p.w || 1, p.h || 1, kindOf(S.spec(p.t)));
    const blocks = (sp, x, y) => {
      const flat = !!sp.flat, onTop = !!(sp.stack || sp.mount === 'surface'), solid = sp.blocks !== false;
      for (let yy = y; yy < y + sp.h; yy++) for (let xx = x; xx < x + sp.w; xx++) {
        const k = xx + ',' + yy, o = occ.get(k);
        if (st.roomAt(xx, yy) !== roomId || belts[k] || (solid && reserve.has(k))) return true;
        if (flat ? o === 'flat' : (o && o !== 'flat' && !onTop)) return true;
      }
      return false;
    };
    const add = (t, x, y, r) => {
      const sp = S.spec(t); if (!sp || blocks(sp, x, y)) return false;
      const solid = sp.blocks !== false;
      const a = st.addProp({ t, x, y, w: sp.w, h: sp.h, r: r || 0, block: solid });
      if (!a || !a.ok) return false;
      placed.push({ id: a.id, t, x, y, w: sp.w, h: sp.h, r: r || 0, block: solid });
      mark(x, y, sp.w, sp.h, kindOf(sp));
      return true;
    };
    // the feature wall: its groups left, centre and right, each lined up against the wall
    const lineWall = (groups, wall) => {
      if (!groups) return 0;
      let depth = 0;
      const rowOf = h => wall === 'south' ? R.y2 - h + 1 : R.y1;
      // a run of pieces from x0 along the wall; a piece that meets a doorway's lane steps past it rather than being lost
      const run = (list, x0, dir) => {
        let x = x0;
        for (const t of list || []) {
          const s = S.spec(t); if (!s) continue;
          for (;;) {
            const px = dir > 0 ? x : x - s.w + 1;
            if (px < R.x1 + 1 || px + s.w - 1 > R.x2 - 1) return;
            if (add(t, px, rowOf(s.h), 0)) { depth = Math.max(depth, s.h); x = dir > 0 ? px + s.w : px - 1; break; }
            x += dir;
          }
        }
      };
      // the centre group first, so the wall's signature piece (the TV) takes the middle, or the nearest clear stretch of
      // wall beside a doorway there, before the side groups fill in
      const mid = groups.centre || [], ms = mid.map(t => S.spec(t)).filter(Boolean), mw = ms.reduce((n, sp) => n + sp.w, 0);
      if (ms.length) {
        const c0 = R.x1 + ((W - mw) >> 1), offs = [0];
        for (let k = 1; k < W; k++) offs.push(-k, k);
        for (const o of offs) {
          const x0 = c0 + o;
          if (x0 < R.x1 + 1 || x0 + mw - 1 > R.x2 - 1) continue;
          let x = x0, fits = true;
          for (const sp of ms) { if (blocks(sp, x, rowOf(sp.h))) { fits = false; break; } x += sp.w; }
          if (fits) { run(mid, x0, 1); break; }
        }
      }
      run(groups.left, R.x1 + 1, 1);
      run(groups.right, R.x2 - 1, -1);
      return depth;
    };
    const featureWall = flip ? 'south' : 'north';
    const depth = lineWall(rec.feature, featureWall);
    if (rec.front) lineWall(rec.front, flip ? 'north' : 'south');
    // the centrepiece: the largest cluster that fits the floor left, centred, facing the feature wall
    const top = flip ? R.y1 + 1 + (onWall.north ? 3 : 0) : R.y1 + depth + 1, bottom = flip ? R.y2 - depth - 1 : R.y2 - 1 - (onWall.south ? 2 : 0);
    let centred = null;
    for (const set of rec.centre || []) {
      if (set.w > W - 2 || set.h > bottom - top + 1) continue;
      const x0 = R.x1 + ((W - set.w) >> 1), y0 = top + ((bottom - top + 1 - set.h) >> 1);
      const tries = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-2, 0], [2, 0], [-3, 0], [3, 0], [-2, 1], [2, 1], [-2, -1], [2, -1]];
      for (const [dx, dy] of tries) {
        const ax = x0 + dx, ay = y0 + dy;
        const ps = set.pieces.map(([t, x, y, facing]) => { const sp = S.spec(t); return sp ? { t, x: ax + x, y: flip ? ay + set.h - y - sp.h : ay + y, r: facing || 0, sp } : null; }).filter(Boolean);
        // every solid piece must have its floor (what stands on a table is checked when its table is down)
        if (ps.some(p => p.sp.blocks !== false && !p.sp.stack && p.sp.mount !== 'surface' && blocks(p.sp, p.x, p.y))) continue;
        const before = placed.length, rank = p => p.sp.flat ? 0 : (p.sp.stack || p.sp.mount === 'surface') ? 2 : 1;
        for (const p of ps.slice().sort((a, b) => rank(a) - rank(b))) add(p.t, p.x, p.y, p.r);
        if (placed.length > before) { centred = set; break; }
      }
      if (centred) break;
    }
    // plants in the corners (the feature wall's corners first), accents along the side walls
    const corners = flip ? [[R.x1, R.y2, 1, -1], [R.x2, R.y2, -1, -1], [R.x1, R.y1, 1, 1], [R.x2, R.y1, -1, 1]] : [[R.x1, R.y1, 1, 1], [R.x2, R.y1, -1, 1], [R.x1, R.y2, 1, -1], [R.x2, R.y2, -1, -1]];
    (rec.corners || []).forEach((t, i) => {
      const s = S.spec(t), c = corners[i]; if (!s || !c) return;
      add(t, c[2] > 0 ? c[0] : c[0] - s.w + 1, c[3] > 0 ? c[1] : c[1] - s.h + 1, 0);
    });
    const cy = (R.y1 + R.y2) >> 1, offs = [0, 2, -2, 4, -4];
    (rec.sides || []).forEach((t, i) => {
      const s = S.spec(t); if (!s) return;
      const west = i % 2 === 0, x = west ? R.x1 : R.x2 - s.w + 1;
      const at = [0, 3, -3, 5, -5][i >> 1] || 0;
      for (const o of offs.map(v => v >> 1)) if (add(t, x, cy + at + o - (s.h >> 1), 0)) break;
    });
    pruneUnreachable(st, placed);
    return { ok: true, props: placed.map(({ id, gone, ...p }) => p), centre: !!centred, featureWall };
  }
  /* DRESS A CORRIDOR: planters, floor lights and benches along its edge rows — the outer edge of a 3-wide corridor, both
     edges of a wider one — never within a tile of a doorway, always two rows clear to walk. A corridor running north-south
     takes one-tile pieces only (a planter would half-block it). */
  function dressHall(st, env, hallId, outer) {
    const S = env.PropSprites, rm = st.rooms().find(r => r.id === hallId); if (!rm) return { ok: true, props: [] };
    const R = rm.rects[0], W = R.x2 - R.x1 + 1, H = R.y2 - R.y1 + 1, horiz = W >= H, thick = horiz ? H : W, len = horiz ? W : H;
    if (thick < 3 || len < 8) return { ok: true, props: [] };
    const g = st.projectGeometry(), doors = doorTiles(st, g, hallId);
    const rows = thick >= 4 ? ['a', 'b'] : [outer === 'north' || outer === 'west' ? 'a' : 'b'];
    const pattern = horiz ? ['industrial_planter', 'arc_floorlight', 'industrial_bench', 'arc_floorlight'] : ['tallplant', 'arc_floorlight', 'plant', 'arc_floorlight'];
    const placed = [];
    for (const row of rows) {
      // a piece keeps clear of every doorway that opens on its own row, and of the tile either side of it
      const line = horiz ? (row === 'a' ? R.y1 : R.y2) : (row === 'a' ? R.x1 : R.x2), near = new Set();
      for (const d of doors) if ((horiz ? d.y : d.x) === line) for (let q = -1; q <= 1; q++) near.add((horiz ? d.x : d.y) + q);
      let k = 0;
      for (let u = 1; u < len - 1; u += 4) {
        const t = pattern[k % pattern.length], s = S.spec(t); if (!s) continue;
        const span = horiz ? s.w : s.h;
        let ok = true;
        for (let q = u; q < u + span; q++) if (near.has((horiz ? R.x1 : R.y1) + q)) ok = false;
        if (!ok) continue;
        const x = horiz ? R.x1 + u : (row === 'a' ? R.x1 : R.x2 - s.w + 1), y = horiz ? (row === 'a' ? R.y1 : R.y2 - s.h + 1) : R.y1 + u;
        const a = st.addProp({ t, x, y, w: s.w, h: s.h, r: 0, block: s.blocks !== false });
        if (a && a.ok) { placed.push({ id: a.id, t, x, y, w: s.w, h: s.h, r: 0, block: s.blocks !== false }); k++; }
      }
    }
    pruneUnreachable(st, placed);
    return { ok: true, props: placed.map(({ id, gone, ...p }) => p) };
  }

  /* THE PATTERNS' GEOMETRY: pure rects around the hub's box B. Each answers { halls: [{ rect, dress, outer }], rooms:
     [{ i, rect, side }] } — halls in the order they are laid, `dress` on the corridors people walk along (not the short
     halls), and every room i of the request in its slot — or a refusal saying how many rooms the pattern holds. */
  /* THE DIAMOND (2026-09-30, after Andrew's test: "good at designing the rooms, terrible at judging where to place them…
     I still want it to keep the diamond shape even with the new rooms"). Every room stands on an EVEN GRID around the
     hub, the same size as the bridge, a hallway apart, and the grid is filled in diamond order — the four sides first,
     then the four corners and the far sides, then the next ring out — each room paired with the one opposite it, so the
     station keeps its diamond at every size. A room added later goes in the next free place of the same grid, so the
     shape holds as the station grows. At the centre, when the space round the hub is clear, a corridor loop with a
     hallway in from each side (the ring). Big rooms (a conveyor hall) take the east and west wings first, then north and
     south, anchored on the grid's inner edge. Each room is joined by a straight hallway to what faces it toward the hub
     (the ring, the hub, or the room one step in). Answers { halls, rooms } laid on `scratch`, or why a room found no place. */
  const CELL = [18, 11], DIAMOND_ROOMS = 16;
  function diamondOrder(maxD) {
    const out = [];
    for (let d = 1; d <= maxD; d++) {
      for (let a = 1; a < d; a++) { const b = d - a; out.push([a, -b], [-a, b], [-a, -b], [a, b]); }
      out.push([0, -d], [0, d], [d, 0], [-d, 0]);
    }
    return out;
  }
  function cellName(i, j) {
    const ns = j < 0 ? 'north' : j > 0 ? 'south' : '', ew = i < 0 ? 'west' : i > 0 ? 'east' : '', d = Math.abs(i) + Math.abs(j);
    return (d >= 2 && (!ns || !ew) ? 'far ' : d >= 3 ? 'outer ' : '') + (ns && ew ? ns + '-' + ew : ns || ew);
  }
  function diamondGeometry(scratch, hubId, want, hangs) {
    const hub = scratch.rooms().find(r => r.id === hubId);
    const B = bboxOf(hub), hw = B.x2 - B.x1 + 1, hh = B.y2 - B.y1 + 1, [CW, CH] = CELL;
    const PX = ((hw + CW) >> 1) + 10, PY = ((hh + CH) >> 1) + 10;   // a room 10 tiles off the hub: ring 4 out, 3 thick, a 3-tile hall
    const ox = B.x1 + ((hw - CW) >> 1), oy = B.y1 + ((hh - CH) >> 1);
    const halls = [], rooms = [];
    // the ring at the centre, when everything it needs is clear
    const gap = 4, t = 3, X1 = B.x1 - gap - t, X2 = B.x2 + gap + t, Y1 = B.y1 - gap - t, Y2 = B.y2 + gap + t;
    const cx = (B.x1 + B.x2) >> 1, cy = (B.y1 + B.y2) >> 1;
    const ring = [
      { rect: { x1: X1, y1: Y1, x2: X2, y2: Y1 + 2 }, dress: true, outer: 'north' }, { rect: { x1: X1, y1: Y2 - 2, x2: X2, y2: Y2 }, dress: true, outer: 'south' },
      { rect: { x1: X1, y1: Y1 + 3, x2: X1 + 2, y2: Y2 - 3 }, dress: true, outer: 'west' }, { rect: { x1: X2 - 2, y1: Y1 + 3, x2: X2, y2: Y2 - 3 }, dress: true, outer: 'east' },
      { rect: { x1: cx - 1, y1: B.y1 - gap, x2: cx + 2, y2: B.y1 - 1 } }, { rect: { x1: cx - 1, y1: B.y2 + 1, x2: cx + 2, y2: B.y2 + gap } },
      { rect: { x1: B.x2 + 1, y1: cy - 1, x2: B.x2 + gap, y2: cy + 1 } }, { rect: { x1: B.x1 - gap, y1: cy - 1, x2: B.x1 - 1, y2: cy + 1 } }];
    const ringFree = ring.every(h => scratch.canPlaceHallway([h.rect]).ok && !neighbourOf(scratch, h.rect, [hub.id]));
    if (ringFree) for (const h of ring) { const a = scratch.placeHallway({ rect: h.rect }); if (!a || !a.ok) return refuse('the ring could not be laid'); halls.push(h); }
    // where a room of w × h stands on cell (i, j): a normal room fills the cell; a big one is anchored on its inner edge
    const cellRect = (i, j) => ({ x1: ox + i * PX, y1: oy + j * PY, x2: ox + i * PX + CW - 1, y2: oy + j * PY + CH - 1 });
    const bigRect = (i, j, w, h) => {
      const c = cellRect(i, j);
      if (j === 0) { const y1 = B.y1 + ((hh - h) >> 1); return i > 0 ? { x1: c.x1, y1, x2: c.x1 + w - 1, y2: y1 + h - 1 } : { x1: c.x2 - w + 1, y1, x2: c.x2, y2: y1 + h - 1 }; }
      const x1 = B.x1 + ((hw - w) >> 1);
      return j > 0 ? { x1, y1: c.y1, x2: x1 + w - 1, y2: c.y1 + h - 1 } : { x1, y1: c.y2 - h + 1, x2: x1 + w - 1, y2: c.y2 };
    };
    // the first zone met walking from a room's inner edge toward the hub, along its middle
    const facing = (rect, dx, dy) => {
      const mx = (rect.x1 + rect.x2) >> 1, my = (rect.y1 + rect.y2) >> 1;
      let x = dx > 0 ? rect.x2 + 1 : dx < 0 ? rect.x1 - 1 : mx, y = dy > 0 ? rect.y2 + 1 : dy < 0 ? rect.y1 - 1 : my;
      for (let k = 0; k < Math.max(PX - CW, PY - CH) + 2; k++, x += dx, y += dy) { const id = scratch.roomAt(x, y); if (id) return scratch.rooms().find(r => r.id === id) || null; }
      return null;
    };
    const used = new Set(), key = (i, j) => i + ',' + j;
    let why = '';
    const place = (q, i, j, big) => {
      const rect = big ? bigRect(i, j, q.w, q.h) : cellRect(i, j);
      const c = scratch.canPlaceRoom([rect], 'hab');
      if (!c.ok) { why = why || (/^overlaps /.test(c.msg || '') ? c.msg.replace(/^overlaps /, '') + ' is in the way' : (c.msg || 'it does not fit')); return false; }
      const nb = neighbourOf(scratch, rect, []);
      if (nb) { why = why || 'it would stand against ' + nb; return false; }
      const a = scratch.addRoom({ kind: 'hab', name: q.name, rect });
      if (!a || !a.ok) return false;
      const room = scratch.rooms().find(r => r.id === a.id);
      // toward the hub: along the row first (to the room nearer the north-south line), then along the column
      const dirs = [];
      if (i) dirs.push([-Math.sign(i), 0]);
      if (j) dirs.push([0, -Math.sign(j)]);
      for (const [dx, dy] of dirs) {
        const Z = facing(rect, dx, dy);
        if (!Z || Z.id === a.id) continue;
        const hb = hallBetween(scratch, Z, room, hangs);
        if (!hb.ok) { why = why || hb.error; continue; }
        const h = scratch.placeHallway({ rect: hb.rect });
        if (!h || !h.ok) continue;
        halls.push({ rect: hb.rect, dress: true });
        rooms.push({ i: q.i, rect, side: cellName(i, j) });
        used.add(key(i, j));
        // a big room covers the next place out along its axis as well
        if (big) { const s = j === 0 ? [Math.sign(i), 0] : [0, Math.sign(j)]; for (let k = 1; k <= 2; k++) used.add(key(i + s[0] * k, j + s[1] * k)); }
        return true;
      }
      scratch.removeRoom(a.id);
      return false;
    };
    const wings = [[1, 0], [-1, 0], [0, -1], [0, 1], [2, 0], [-2, 0], [0, -2], [0, 2]], order = diamondOrder(4);
    for (const q of want.filter(r => r.big)) {
      if (!wings.some(([i, j]) => !used.has(key(i, j)) && place(q, i, j, true))) return refuse('There is no wing of the diamond around ' + hub.name + ' clear for ' + q.name + ' (' + (why || 'every wing is taken') + '). A diamond takes up to four big rooms.');
    }
    const normal = want.filter(r => !r.big);
    normal.forEach((q, n) => {
      // the order is a run of opposite pairs: the diamond is symmetric whenever its rooms come in pairs, and a room added
      // later lands exactly where it would have stood had it been asked for with the rest
      if (!order.some(([i, j]) => !used.has(key(i, j)) && place(q, i, j, false))) why = 'NOPLACE:' + q.name + ':' + (why || 'the grid is full');
    });
    const lost = /^NOPLACE:([^:]*):(.*)$/.exec(why || '');
    if (lost) return refuse('There is no free place left on the diamond around ' + hub.name + ' for ' + lost[1] + ' (' + lost[2] + ').');
    return { ok: true, halls, rooms, ring: ringFree };
  }
  const CONCOURSE_ROOMS = 8;
  function concourseGeometry(B, dir, want) {
    if (want.length > CONCOURSE_ROOMS) return refuse('A concourse holds ' + CONCOURSE_ROOMS + ' rooms (' + want.length + ' were asked).');
    const cw = 4, stub = 3, along = 3;
    const horiz = dir === 'east' || dir === 'west';
    // local frame: u runs along the corridor away from the hub (0 = the tile against the hub's wall), v across it
    const lo = horiz ? B.y1 : B.x1, hi = horiz ? B.y2 : B.x2, v1 = lo + ((hi - lo + 1 - cw) >> 1), v2 = v1 + cw - 1;
    const toWorld = (u1, u2, a, b) => {
      if (dir === 'east') return { x1: B.x2 + 1 + u1, x2: B.x2 + 1 + u2, y1: a, y2: b };
      if (dir === 'west') return { x1: B.x1 - 1 - u2, x2: B.x1 - 1 - u1, y1: a, y2: b };
      if (dir === 'south') return { y1: B.y2 + 1 + u1, y2: B.y2 + 1 + u2, x1: a, x2: b };
      return { y1: B.y1 - 1 - u2, y2: B.y1 - 1 - u1, x1: a, x2: b };
    };
    const ext = r => horiz ? { along: r.w, across: r.h } : { along: r.h, across: r.w };
    const endRoom = want.find(r => r.big), sideRooms = want.filter(r => r !== endRoom);
    const rooms = [], halls = [];
    let u = along;
    for (let j = 0; j < sideRooms.length; j += 2) {
      const pair = sideRooms.slice(j, j + 2), span = Math.max(...pair.map(r => ext(r).along));
      pair.forEach((r, q) => {
        const e = ext(r), u1 = u + ((span - e.along) >> 1), u2 = u1 + e.along - 1, hu = u1 + ((e.along - 4) >> 1);
        const left = q === 0;
        const rect = left ? toWorld(u1, u2, v1 - stub - e.across, v1 - stub - 1) : toWorld(u1, u2, v2 + stub + 1, v2 + stub + e.across);
        const hall = left ? toWorld(hu, hu + 3, v1 - stub, v1 - 1) : toWorld(hu, hu + 3, v2 + 1, v2 + stub);
        rooms.push({ i: r.i, rect, side: left ? (horiz ? 'north' : 'west') : (horiz ? 'south' : 'east') });
        halls.push({ rect: hall });
      });
      u += span + along;
    }
    const length = Math.max(u, 12);
    halls.unshift({ rect: toWorld(0, length - 1, v1, v2), dress: true });
    if (endRoom) {
      const e = ext(endRoom), c = (v1 + v2) >> 1, a = c - ((e.across - 1) >> 1);
      rooms.push({ i: endRoom.i, rect: toWorld(length, length + e.along - 1, a, a + e.across - 1), side: 'end' });
    }
    return { ok: true, halls, rooms };
  }

  // a layout's rooms, checked: a style (or lines, or zones), a size, a name
  function parseLayoutRooms(list, env, live, notes, usedNames) {
    const RS = env.RoomStyles, HOW = 'layout.rooms is a list of 1 to ' + DIAMOND_ROOMS + ' rooms, each { name, style, size, lines } (style: ' + RS.ROOM_ORDER.join(', ') + ').';
    if (!Array.isArray(list) || !list.length || list.length > DIAMOND_ROOMS) return refuse(HOW);
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      if (!q || typeof q !== 'object' || Array.isArray(q)) return refuse(HOW);
      const bad = Object.keys(q).filter(k => LAYOUT_ROOM_KEYS.indexOf(k) < 0);
      if (bad.length) return refuse('StarNet places and furnishes every room itself, so a layout room does not take: ' + bad.slice(0, 6).join(', ') + '. It takes: ' + LAYOUT_ROOM_KEYS.join(', ') + '.');
      let style = null;
      if (q.style != null) { style = RS.resolveRoom(q.style); if (!style) return refuse('There is no room style "' + String(q.style).slice(0, 40) + '". Styles: ' + RS.ROOM_ORDER.join(', ') + '.'); }
      else if (typeof q.name === 'string' && q.zones == null && q.lines == null) style = RS.resolveRoom(q.name);   // "Arcade", "Conveyor Hall"
      if (q.zones != null && (q.lines != null || q.style != null)) return refuse('A layout room takes a style (furnished whole), zones (part by part) or lines, not two of them (lines go in a works room: leave style out).');
      let lines = [], zones = [];
      if (q.lines != null) {
        if (!Array.isArray(q.lines) || !q.lines.length || q.lines.length > 6) return refuse('lines is a list of 1 to 6 workflow lines, each { line | purpose | shape, name, staff, dailyCap, tries }.');
        for (const l of q.lines) {
          if (!l || typeof l !== 'object' || Array.isArray(l)) return refuse('Each line is an object with: ' + LINE_KEYS.join(', ') + '.');
          const lb = Object.keys(l).filter(k => LINE_KEYS.indexOf(k) < 0);
          if (lb.length) return refuse('A line only takes: ' + LINE_KEYS.join(', ') + '. Not accepted: ' + lb.slice(0, 6).join(', ') + '.');
          const ln = parseLine(l, env, live, notes); if (!ln.ok) return ln;
          lines.push(ln.line);
        }
        if (style && style !== 'works') return refuse('Lines go in a works room (a conveyor hall): leave style out, or set it to works.');
        style = 'works';
      }
      if (q.zones != null) { const z = parseZones(q.zones, env, live, notes); if (!z.ok) return z; zones = z.zones; }
      if (!style && !zones.length) return refuse('Room ' + (i + 1) + ' of the layout needs a style (' + RS.ROOM_ORDER.join(', ') + '), zones, or lines.');
      const sz = sizeOfRoom(q.size); if (!sz.ok) return sz;
      const def = style === 'works' ? SIZES.giant : style === 'garden' ? [20, 15] : [18, 10];
      const need = contentNeed(zones, lines);
      let w = sz.size ? sz.size[0] : Math.max(def[0], need.w), h = sz.size ? sz.size[1] : Math.max(def[1], need.h);
      if (sz.size && (need.hardW || need.w) > w) return refuse('Room ' + (i + 1) + ' at ' + w + ' × ' + h + ' is too small for what goes in it. Leave size out, or ask for a bigger one.');
      if (w > DESIGN_MAX[0] || h > DESIGN_MAX[1]) return refuse('What goes in room ' + (i + 1) + ' needs more than the ' + DESIGN_MAX[0] + ' × ' + DESIGN_MAX[1] + ' StarNet builds at once.');
      const given = typeof q.name === 'string' ? q.name.replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 24) : '';
      const taken = nm => live.rooms().some(r => r.kind !== 'corridor' && norm(r.name) === norm(nm)) || usedNames[norm(nm)];
      let name = given || (style ? AUTO_NAME[style] : 'ROOM ' + (i + 1));
      if (given && taken(name)) return refuse('A room is already called ' + name + '. Give this one another name.');
      for (let k = 2; !given && taken(name) && k < 50; k++) name = (style ? AUTO_NAME[style] : 'ROOM').slice(0, 21) + ' ' + k;
      usedNames[norm(name)] = 1;
      const big = style === 'works' || lines.length > 0 || w * h >= 24 * 14;
      out.push({ i, name, style, zones, lines, w, h, big, need });
    }
    return { ok: true, rooms: out };
  }

  /* A WHOLE LAYOUT (station.plan's `layout`): the pattern's geometry is laid on a probe, every room filled (lines first,
     then its style from wall to wall, or its zones) and every corridor dressed; then the same checks as any build. */
  function planLayout(doc, req, env) {
    const WM = env.WorldModel, P = env.Pipeline, RS = env.RoomStyles;
    if (!RS || !RS.ROOMS) return refuse('the room styles are not loaded on this page');
    const HOW = 'Send { "layout": { "pattern": "ring" or "concourse", "rooms": [ { name, style, size, lines } ] } }, and "replace": true to lay out the whole station again around its main room.';
    const extra = Object.keys(req).filter(k => k !== 'layout' && k !== 'replace');
    if (extra.length) return refuse('A layout plans the whole floor, so leave out: ' + extra.slice(0, 6).join(', ') + '. ' + HOW);
    const L = req.layout;
    if (!L || typeof L !== 'object' || Array.isArray(L)) return refuse(HOW);
    const bad = Object.keys(L).filter(k => LAYOUT_KEYS.indexOf(k) < 0);
    if (bad.length) return refuse('StarNet computes every tile itself, so a layout does not take: ' + bad.slice(0, 6).join(', ') + '. It takes: ' + LAYOUT_KEYS.join(', ') + '.');
    const pattern = PATTERNS[norm(L.pattern)] || (L.pattern == null ? 'diamond' : null);
    if (!pattern) return refuse('pattern is diamond (rooms on an even grid all round the main room, a corridor loop at its centre) or concourse (a wide corridor with rooms down both sides and a big room at the end).');
    if (req.replace != null && typeof req.replace !== 'boolean') return refuse('replace is true (lay out the whole station again) or left out (add the layout beside what stands).');
    const replace = req.replace === true;
    const sd = sideOf(L.side); if (!sd.ok) return sd;
    // the floor it lands on: as it stands, or (replace) the main room alone, with everything beyond it cleared
    let base = clone(doc);
    const live0 = WM.create(clone(doc)), hubQ = L.around != null ? roomNamed(live0, L.around) : { ok: true, room: mainRoom(live0) };
    if (!hubQ.ok) return hubQ;
    if (!hubQ.room) return refuse('There is no room to lay the station out around.');
    if (replace && hubQ.room.id !== (mainRoom(live0) || {}).id) return refuse('replace lays the whole station out again around its main room (' + (mainRoom(live0) || {}).name + '), so leave around out.');
    let stripped = null;
    if (replace) {
      const cp = WM.create(clone(doc));
      for (const r of cp.rooms()) if (r.id !== hubQ.room.id) cp.removeRoom(r.id);
      stripped = cp.serialize();
      const ids = new Set(stripped.props.map(p => p.id));
      if (Array.isArray(stripped.links)) stripped.links = stripped.links.filter(l => l && l.from && l.to && (l.from.prop == null || ids.has(l.from.prop)) && (l.to.prop == null || ids.has(l.to.prop)));
      // exactly what station.build will do first: the page's own replaceLayout (it gives every agent that owned a desk one)
      const bp = WM.create(clone(doc)), rl = bp.replaceLayout(clone(stripped));
      if (!rl || !rl.ok) return refuse(hubQ.room.name + ' could not be kept as it stands (' + ((rl && (rl.msg || rl.error)) || 'it did not validate') + '), so nothing was changed.');
      base = bp.serialize();
    }
    const live = WM.create(clone(base)), notes = [], usedNames = {};
    if (pattern === 'diamond' && L.side != null) notes.push('A diamond goes all the way round its room, so side was left out.');
    const pr = parseLayoutRooms(L.rooms, env, live, notes, usedNames); if (!pr.ok) return pr;
    // on the diamond every room but a big one is the grid's own size, so the station reads as one consistent plan
    if (pattern === 'diamond') for (const q of pr.rooms) if (!q.big) { q.w = CELL[0]; q.h = CELL[1]; }
    if (replace && pr.rooms.some(r => [].concat(...r.lines.map(l => l.staff || []), ...r.zones.map(z => z.staff || [])).some(s => s && /^(new|recruit)/i.test(String(s.agent || ''))))) return refuse('A layout that replaces the station cannot recruit; staff the lines with the crew you have, or recruit after it is built.');
    const hub = live.rooms().find(r => r.id === hubQ.room.id), B = bboxOf(hub);
    const before = floorFacts(live, P);
    // the geometry: the ring round the hub, or the concourse off the side asked (else the first side it fits)
    const dirs = pattern === 'diamond' ? [null] : sd.side ? [sd.side] : SIDES.slice().sort((a, b) => { const free = s => placementsOn(live, hub, s, 12, 8, 3, null, 'hab').list.length ? 0 : 1; return free(a) - free(b); });
    let laid = null, why = null;
    for (const dir of dirs) {
      const geo = pattern === 'diamond' ? diamondGeometry(WM.create(clone(base)), hub.id, pr.rooms, hangsOf(env)) : concourseGeometry(B, dir, pr.rooms);
      if (!geo.ok) return geo;
      const probe = WM.create(clone(base)), hallIds = [], roomIds = {};
      let fail = null;
      for (const h of geo.halls) {
        const c = probe.canPlaceHallway([h.rect]);
        if (!c.ok) { fail = /^overlaps /.test(c.msg || '') ? c.msg.replace(/^overlaps /, '') + ' is in the way' : (c.msg || 'a corridor does not fit'); break; }
        const a = probe.placeHallway({ rect: h.rect }); if (!a || !a.ok) { fail = 'a corridor could not be laid'; break; }
        probe.setDeck(a.id, CORRIDOR_DECK); hallIds.push(a.id);
      }
      for (const r of fail ? [] : geo.rooms) {
        const q = pr.rooms.find(x => x.i === r.i), rec = q.style ? RS.ROOMS[q.style] : null;
        const c = probe.canPlaceRoom([r.rect], (rec && rec.kind) || 'hab');
        if (!c.ok) { fail = /^overlaps /.test(c.msg || '') ? c.msg.replace(/^overlaps /, '') + ' is in the way of ' + q.name : (c.msg || q.name + ' does not fit'); break; }
        const a = probe.addRoom({ kind: (rec && rec.kind) || 'hab', name: q.name, rect: r.rect, floorStyle: rec ? rec.deck.style : undefined, floorMat: rec ? rec.deck.mat : undefined });
        if (!a || !a.ok) { fail = q.name + ' could not be added'; break; }
        if (rec && rec.walls) probe.setWalls(a.id, rec.walls);
        roomIds[r.i] = a.id;
      }
      // nothing touches what it was not meant to: a room touches only its own hall (or, at a concourse's end, the corridor)
      if (!fail) for (const r of geo.rooms) {
        const mine = new Set([roomIds[r.i]].concat(hallIds));
        const other = neighbourOf(probe, r.rect, [...mine]);
        if (other) { fail = pr.rooms.find(x => x.i === r.i).name + ' would stand against ' + other; break; }
      }
      if (fail) { why = why || (pattern === 'diamond' ? 'The diamond around ' + hub.name + ' could not be laid (' + fail + ').' : 'A concourse ' + dir + ' of ' + hub.name + ' does not fit (' + fail + ').'); continue; }
      laid = { geo, probe, hallIds, roomIds, dir };
      break;
    }
    if (!laid) return refuse(why + (replace ? '' : ' Use replace: true to lay out the whole station again around ' + hub.name + (pattern === 'diamond' ? '.' : ', or the diamond pattern.')));
    // fill every room (lines first, then its style or zones), then dress the corridors
    const probe = laid.probe, parts = [], recruits = [], view = [];
    laid.geo.halls.forEach((h, j) => parts.push({ hall: h.rect, hallDeck: CORRIDOR_DECK, room: null, roomId: null, lines: [], props: [], dress: h.dress ? h.outer || null : undefined, hallId: laid.hallIds[j] }));
    for (const r of laid.geo.rooms) {
      const q = pr.rooms.find(x => x.i === r.i), id = laid.roomIds[r.i], rec = q.style ? RS.ROOMS[q.style] : null;
      let lines = [], props = [], fillView = [];
      if (q.lines.length || q.zones.length) {
        const f = fillRoom(probe, env, id, r.rect, q.zones, q.lines, q.zones.length && !q.need.one ? { fx: 0.5, fy: 0.5, one: false } : { fx: 1, fy: 1, one: true }, q.name, 0);
        if (!f.ok) return f.tooSmall ? refuse(q.name + ': ' + f.error) : f;
        lines = f.lines; props = f.props.slice(); fillView = f.view;
        f.recruits.forEach(rc => recruits.push(Object.assign({ part: parts.length }, rc)));
      }
      let dressed = null;
      if (rec) { dressed = dressRoom(probe, env, id, q.style); if (!dressed.ok) return dressed; props = props.concat(dressed.props); }
      parts.push({ hall: null, room: { kind: (rec && rec.kind) || 'hab', name: q.name, rect: r.rect, floorStyle: rec ? rec.deck.style : undefined, floorMat: rec ? rec.deck.mat : undefined, walls: rec ? rec.walls : undefined }, roomId: null, lines, props });
      view.push({ q, r, part: parts.length - 1, fillView, dressed });
    }
    for (const p of parts) if (p.dress !== undefined) { const d = dressHall(probe, env, p.hallId, p.dress); p.props = d.props; }
    for (const p of parts) { delete p.dress; delete p.hallId; }
    const spec = { kind: 'build', parts, recruits };
    const t = tryBuild(base, spec, env, before);
    if (!t.ok) return refuse('The layout did not pass its checks (' + t.error + '), so nothing would be built. Try fewer or smaller rooms, or the other pattern.');
    const fp = t.probe;
    // the card: the pattern, then each room where it sits and what is in it
    const built = t.built, crewIds = (env.crew || []).map(a => a && a.id).filter(Boolean), lines = [], steps = [];
    const short = props => { const txt = piecesText(env, props), parts2 = txt.split(', '); return parts2.length > 7 ? parts2.slice(0, 6).join(', ') + ' and more' : txt; };
    view.sort((a, b) => a.q.i - b.q.i);
    const roomText = view.map(v => {
      const Wd = v.r.rect.x2 - v.r.rect.x1 + 1, Hd = v.r.rect.y2 - v.r.rect.y1 + 1, at = v.r.side === 'end' ? 'at the far end' : v.r.side;
      const bits = [];
      if (v.dressed) bits.push(env.RoomStyles.ROOMS[v.q.style].name + (v.q.style === 'works' && !v.q.lines.length ? ', its floor kept for workflow lines' : ''));
      for (const fv of v.fillView) {
        if (fv.kind === 'style') { bits.push(AREA_LABEL[fv.area] + ', ' + env.RoomStyles.STYLES[fv.z.style].name); continue; }
        const bl = built.parts[v.part].lines[fv.line], rd = readLine(fp, bl.lineIds, env, crewIds);
        lines.push({ label: fv.z.label, plain: fv.z.plain, room: v.q.name, part: v.part, line: fv.line, ready: rd.ready, blocking: rd.blocking, picked: fv.z.picked });
        const stepsView = fv.stepsOut.map(x => ({ step: x.step, role: titleCase(x.role), agent: x.agentId ? nameOf(env, x.agentId) : null, instructions: x.brief }));
        stepsView.forEach(s => steps.push(Object.assign({}, s, { role: s.role + ' on ' + (fv.z.label || fv.z.plain) })));
        bits.push(fv.z.plain + (fv.z.label ? ' ("' + fv.z.label + '")' : '') + ': ' + flowText(fv.shape.cols, fv.runOrder, stepsView));
      }
      const brief = view.length > 4, pieces = !brief && v.dressed && v.dressed.props.length && v.q.style !== 'works' ? ' (' + short(v.dressed.props) + ')' : '';
      const size = brief && Wd === CELL[0] && Hd === CELL[1] ? '' : ', ' + Wd + ' × ' + Hd;
      return v.q.name + ' ' + at + size + ': ' + bits.join('; ') + pieces;
    });
    const wasRooms = live0.rooms().filter(x => x.kind !== 'corridor').length - 1, wasProps = live0.props().length - live.props().length;
    const head = pattern === 'diamond'
      ? (laid.geo.ring ? 'A DIAMOND around ' + hub.name + ': a corridor loop round it with a hallway in from each side, and ' + view.length + ' rooms on an even grid round the loop, each on its own planted, lit hallway. '
        : view.length + (view.length === 1 ? ' room' : ' rooms') + ' on the diamond grid around ' + hub.name + ', each in the next free place of the grid, on its own planted, lit hallway. ')
      : 'A CONCOURSE ' + laid.dir + ' from ' + hub.name + ': a wide corridor, planted and lit, and ' + view.length + ' rooms. ';
    const blocking = [].concat(...lines.map(l => l.blocking.map(b => (lines.length > 1 ? (l.label || l.plain) + ': ' : '') + b)));
    const summary = head + (view.length > 4 && pattern === 'diamond' ? 'Every room is 18 × 11 unless it says. ' : '') + roomText.join('. ') + '.'
      + (replace ? ' It replaces everything beyond ' + hub.name + ' (' + wasRooms + (wasRooms === 1 ? ' room' : ' rooms') + ' and ' + wasProps + ' props); ' + hub.name + ', agents and conversations stay, and every agent keeps a desk. Your current layout is backed up: RESTORE PREVIOUS in Build → Presets brings it back.' : '')
      + (lines.length ? ' ' + (blocking.length ? 'Still to do after building: ' + blocking.join('; ') + '.' : 'Its lines will be ready to run.') : '');
    const fpd = fp.serialize();
    const preview = previewOf(WM, doc, fpd, [], null);
    const roomsOut = view.map(v => ({ name: v.q.name, style: v.q.style || null, where: v.r.side, existing: false }));
    const plan = { floorSig: sigOf(doc), resultSig: sigOf(fpd), summary, notes, steps, rooms: roomsOut, hallways: [], lines, preview, line: null,
      where: (pattern === 'diamond' ? 'the diamond around ' : 'a concourse ' + laid.dir + ' of ') + hub.name, layout: { pattern, replace } };
    plan.spec = replace ? { kind: 'relayout', stripped, build: spec, pattern } : spec;
    if (replace) plan.preset = { id: 'layout-' + pattern, name: 'your new ' + pattern.toUpperCase() + ' layout' };
    return { ok: true, plan };
  }

  /* A ROOM DESCRIBED PART BY PART (station.plan_room's zones, 2026-09-29): one room of the spatial builder. `where` names an
     existing room to furnish; else a new room, sized for its zones, goes beside the main room on the side that keeps the
     station compact, joined by a hallway. */
  function planDesign(doc, req, env) {
    if (!req || typeof req !== 'object' || Array.isArray(req)) return refuse('Send the request as an object with: ' + DESIGN_MENU.join(', ') + '.');
    const extra = Object.keys(req).filter(k => DESIGN_MENU.indexOf(k) < 0);
    if (extra.length) return refuse('StarNet chooses every position and piece of furniture itself, so these fields are not accepted with zones: ' + extra.slice(0, 8).join(', ') + '. Use only: ' + DESIGN_MENU.join(', ') + '.');
    const into = req.where != null && !/^(a )?new( room)?$/i.test(String(req.where).trim());
    const room = { zones: req.zones };
    for (const k of ['type', 'floorStyle', 'floorMat', 'beside', 'side', 'hallway', 'size']) if (req[k] !== undefined) room[k] = req[k];
    if (into) room.into = req.where;
    if (req.name !== undefined) room.name = req.name;
    return planBuild(doc, { rooms: [room] }, env);
  }

  /* THE MAP (station.map): what the lead needs to SEE before it builds — every room's place and size, what joins it to
     what, what stands in it, which sizes of room fit on each of its sides, and the floor drawn in characters. x grows
     east, y grows south; north is the back wall (the top). Pure: it reads a doc and changes nothing. */
  function mapOf(doc, env) {
    const WM = env && env.WorldModel, P = env && env.Pipeline;
    if (!WM || !doc) return refuse('the station builder is not loaded on this page');
    const st = WM.create(clone(doc)), all = st.rooms(), rooms = all.filter(r => r.kind !== 'corridor'), halls = all.filter(r => r.kind === 'corridor');
    const main = mainRoom(st), touching = (a, b) => a.rects.some(p => b.rects.some(q => (p.x1 <= q.x2 && q.x1 <= p.x2 && (p.y2 + 1 === q.y1 || q.y2 + 1 === p.y1)) || (p.y1 <= q.y2 && q.y1 <= p.y2 && (p.x2 + 1 === q.x1 || q.x2 + 1 === p.x1))));
    const MACHINE = MACHINE_T, KIND = WM.ROOM_KINDS || {};
    let comps = [];
    try { comps = P && P.lineComponents ? P.lineComponents(st.projectGeometry()) : []; } catch (_) { comps = []; }
    const out = rooms.map(r => {
      const B = bboxOf(r), props = st.props().filter(p => st.roomAt(p.x, p.y) === r.id);
      const joined = new Set();
      for (const o of rooms) if (o !== r && touching(r, o)) joined.add(o.name + ' (open to it)');
      const seen = new Set(), queue = halls.filter(h => touching(r, h));
      while (queue.length) { const h = queue.shift(); if (seen.has(h)) continue; seen.add(h); for (const n of halls) if (!seen.has(n) && touching(h, n)) queue.push(n); }
      for (const h of seen) for (const o of rooms) if (o !== r && touching(h, o)) joined.add(o.name + ' (through a hallway)');
      const lineLabels = props.filter(p => p.t === 'intake').map(p => p.label || 'an unnamed line');
      const tiles = r.rects.reduce((s, q) => s + (q.x2 - q.x1 + 1) * (q.y2 - q.y1 + 1), 0), usedTiles = props.filter(p => p.block !== false).reduce((s, p) => s + (p.w || 1) * (p.h || 1), 0);
      const fits = {};
      for (const side of ['north', 'south', 'east', 'west']) fits[side] = Object.keys(SIZES).filter(k => placementsOn(st, r, side, SIZES[k][0], SIZES[k][1], HALL_LEN, null, 'hab', hangsOf(env)).list.length);
      return { name: r.name, main: r === main || undefined, type: (KIND[r.kind] && KIND[r.kind].label) || r.kind, x: B.x1, y: B.y1, w: B.x2 - B.x1 + 1, h: B.y2 - B.y1 + 1,
        joinedTo: [...joined], machines: props.filter(p => MACHINE.test(p.t)).length, furniture: props.filter(p => !MACHINE.test(p.t)).length, lines: lineLabels,
        clearFloor: Math.round(100 * (tiles - usedTiles) / Math.max(1, tiles)) + '%', roomForANewRoom: fits };
    });
    // the floor in characters: each room its letter, hallways '+', space for nothing
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const r of all) { const b = bboxOf(r); x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1); x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2); }
    const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', letter = {}, step = (x2 - x1 + 1) > 120 ? 2 : 1, rows = [];
    rooms.forEach((r, i) => { letter[r.id] = LETTERS[i % 26]; });
    for (let y = y1; y <= y2; y += step) { let row = ''; for (let x = x1; x <= x2; x += step) { const id = st.roomAt(x, y); row += !id ? ' ' : letter[id] || '+'; } rows.push(row.replace(/\s+$/, '')); }
    return { ok: true, map: { main: main ? main.name : null, rooms: out, hallways: halls.length,
      sizes: 'small 12 × 8, medium 18 × 11, large 24 × 14, giant 36 × 20',
      reading: 'x grows east, y grows south; north is the back wall (the top of the drawing). roomForANewRoom lists the sizes that fit on each side of a room, joined by a hallway.',
      legend: rooms.map(r => letter[r.id] + ' = ' + r.name).join(', ') + (halls.length ? ', + = a hallway' : '') + (step > 1 ? ' (one character is 2 × 2 tiles)' : ''),
      drawing: rows } };
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
        const pid = rc.propIndex != null ? b.ids[rc.propIndex] : (((((b.parts || [])[rc.part] || {}).lines || [])[rc.line] || {}).idOf || {})[rc.node];
        const s = st.assignPropAgent(pid, a.id);
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
    if (pl.spec.kind === 'build') {
      for (const x of recruited) crewIds.push(x.id);
      const lines = (pl.lines || []).map(l => { const ln = ((built.parts[l.part] || {}).lines || [])[l.line], rl = ln ? readLine(st, ln.lineIds, env, crewIds) : { ready: false, blocking: [] }; return { label: l.label || null, room: l.room, lineId: rl.comp ? rl.comp.key : null, ready: rl.ready, blocking: rl.blocking }; });
      return { ok: true, kind: 'build', summary: pl.summary, rooms: pl.rooms || [], hallways: pl.hallways || [], where: pl.where, lines, roomIds: built.parts.map(p => p.roomId).filter(Boolean), recruited };
    }
    if (pl.spec.kind === 'swap' || pl.spec.kind === 'relayout') return { ok: true, kind: 'swap', summary: pl.summary, rooms: pl.rooms || [], where: pl.where, lines: pl.lines || [], preset: pl.preset, roomIds: [] };
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

  return { MENU, STEP_KEYS, ROOM_MENU, STYLE_MENU, DESIGN_MENU, ZONE_KEYS, ROOM_KEYS, LINE_KEYS, LAYOUT_KEYS, LAYOUT_ROOM_KEYS, AREAS, SIZES, catalog, resolveLine, plan, planRoom, planRestyle, planDesign, planBuild, planLayout, mapOf, roomPlacements, dressRoom, shapeGraph, areaOf, apply, sigOf };
});
