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
    if (spec && spec.kind === 'design') return buildDesign(st, spec, WM);
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
  const ROOM_MENU = ['zones', 'kit', 'preset', 'replace', 'where', 'name', 'type', 'floorStyle', 'floorMat'];
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
  const DESIGN_MENU = ['zones', 'where', 'name', 'type', 'floorStyle', 'floorMat'];
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
     then overlap another piece (a lamp beside a desk) is left out, and a set whose SOLID pieces would collide is not used. */
  function setProps(env, set, x0, y0, mirror) {
    const S = env.PropSprites, out = [], taken = new Set();
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
      if (tiles.some(k => taken.has(k))) { if (solid) return null; continue; }
      tiles.forEach(k => taken.add(k));
      const r = mirror ? (p.facing === 1 ? 3 : p.facing === 3 ? 1 : p.facing) : p.facing;
      out.push({ t: p.t, x: px, y: py, w: p.spec.w, h: p.spec.h, r, block: solid, order: set.pieces.indexOf(set.pieces[pieces.indexOf(p)]) });
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

  function buildDesign(st, spec, WM) {
    let roomId = spec.roomId || null;
    const ids = [], lines = [];
    if (spec.room) {
      const before = new Set(st.rooms().map(r => r.id));
      const r = st.addRoom({ kind: spec.room.kind, name: spec.room.name, floorStyle: spec.room.floorStyle, floorMat: spec.room.floorMat, rect: spec.room.rect });
      if (!r || !r.ok) return refuse('the room could not be added there' + (r && r.msg ? ' (' + r.msg + ')' : ''));
      roomId = (st.rooms().find(x => !before.has(x.id)) || {}).id || null;
    }
    // lines first (the layout each was planned with was laid on exactly this floor), then the furniture
    for (const ln of spec.lines || []) {
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
      ids.push(...lineIds);
      lines.push({ idOf, lineIds });
    }
    for (const p of spec.props || []) {
      const r = st.addProp({ t: p.t, x: p.x, y: p.y, w: p.w, h: p.h, r: p.r || 0, block: p.block });
      if (!r || !r.ok) return refuse('a piece of furniture could not be placed there' + (r && r.msg ? ' (' + r.msg + ')' : ''));
      ids.push(r.id);
    }
    return { ok: true, ids, roomId, lines, propIds: ids.slice(ids.length - (spec.props || []).length) };
  }

  // the same checks as every plan: no new routing problem, every existing line routes as before, and in the room nothing
  // solid on a doorway's landing and every new piece and machine reachable on foot
  function tryDesign(doc, spec, env, before) {
    const WM = env.WorldModel, P = env.Pipeline;
    const probe = WM.create(clone(doc));
    const b = buildDesign(probe, spec, WM);
    if (!b.ok) return b;
    const after = floorFacts(probe, P), g = after.geo;
    for (const e of after.errs) if (!before.errs.has(e)) return refuse('that would add a routing problem (' + e.split(':')[0] + ')');
    for (const dock in before.chains) if (JSON.stringify(before.chains[dock]) !== JSON.stringify(after.chains[dock])) return refuse('that would change how an existing line routes');
    for (const dock in before.reach) if (!!before.reach[dock] !== !!after.reach[dock]) return refuse('that would change which existing steps an Inbox reaches');
    const o = spawnTile(probe.serialize(), g), land = landingTiles(probe, g, b.roomId);
    for (const pid of b.ids) {
      const p = probe.propById(pid);
      if (!p || p.block === false) continue;
      for (let yy = p.y; yy < p.y + p.h; yy++) for (let xx = p.x; xx < p.x + p.w; xx++) if (land.has(xx + ',' + yy)) return refuse('something would block a doorway');
      if (!sideReachable(g, o, p)) return refuse('something could not be walked up to');
    }
    return { ok: true, probe, built: b };
  }

  function planDesign(doc, req, env) {
    const WM = env && env.WorldModel, P = env && env.Pipeline, W = env && env.WorkflowLine, RS = env && env.RoomStyles;
    if (!WM || !P || !W || !doc || !env.PropSprites || !RS) return refuse('the station builder is not loaded on this page');
    if (!req || typeof req !== 'object' || Array.isArray(req)) return refuse('Send the request as an object with: ' + DESIGN_MENU.join(', ') + '.');
    const extra = Object.keys(req).filter(k => DESIGN_MENU.indexOf(k) < 0);
    if (extra.length) return refuse('StarNet chooses every position and piece of furniture itself, so these fields are not accepted with zones: ' + extra.slice(0, 8).join(', ') + '. Use only: ' + DESIGN_MENU.join(', ') + '.');
    const styleMenu = RS.menu().map(s => s.id + ' (' + s.name + ': ' + s.about + ')').join('; ');
    const ZONE_HOW = 'zones is a list of 1 to 4 parts of the room, each { area, style } or { area, line | purpose | shape }. Areas: ' + AREA_MENU + '. Styles: ' + styleMenu + '.';
    if (!Array.isArray(req.zones) || !req.zones.length || req.zones.length > 4) return refuse(ZONE_HOW);
    const style = styleOf(WM, req); if (!style.ok) return style;
    const notes = [], zones = [], cells = {};
    const live = WM.create(clone(doc));
    for (const z of req.zones) {
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
        if (!env.LineLayout || !env.LineLayout.layout) return refuse('the layout engine is not loaded on this page');
        const staff = z.staff == null ? [] : z.staff;
        const sl = stepsListOk(staff); if (!sl.ok) return refuse(sl.error.replace(/^steps /, 'staff '));
        const zl = zoneLine(live, env, z, notes); if (!zl.ok) return zl;
        // what the line takes laid out on open floor (the engine's own box: its machines, belts and a walking ring)
        const L0 = env.LineLayout.layout(zl.graph, { rects: [{ x1: 0, y1: 0, x2: 119, y2: 79 }], blocked: [], belts: {}, junctions: [] });
        if (!L0.ok) return refuse('that line could not be laid out (' + (L0.error || 'no layout') + ')');
        zones.push(Object.assign({ area, kind: 'line', staff, need: { w: L0.box.x2 - L0.box.x1 + 1, h: L0.box.y2 - L0.box.y1 + 1 } }, zl));
      }
    }
    for (const s of zones) for (const x of s.staff || []) if (x && x.agent != null) { const a = agentOf(env, x.agent); if (!a.ok) return a; }
    const roomName = typeof req.name === 'string' ? req.name.replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 24) : '';

    // where: a new room sized for the zones (default), or an existing plain room split down the middle
    const rooms = live.rooms().filter(r => r.kind !== 'corridor');
    const whereRaw = req.where == null ? '' : String(req.where).trim();
    let target = null;
    if (whereRaw && !/^(a )?new( room)?$/i.test(whereRaw)) {
      const m = rooms.filter(r => norm(r.name) === norm(whereRaw));
      if (m.length !== 1) return refuse((m.length ? 'More than one room is called "' + whereRaw.slice(0, 40) + '".' : 'There is no room called "' + whereRaw.slice(0, 40) + '".') + ' Use "new room", or one of: ' + rooms.map(r => r.name).join(', ') + '.');
      target = m[0];
      if (target.rects.length > 1) return refuse(target.name + ' is not a plain rectangle, so it cannot be split into zones. Use "new room".');
      if (roomName) return refuse('name names a NEW room; ' + target.name + ' keeps its name (plan_restyle renames a room).');
    }
    // the grid: each column as wide as its widest zone, each row as tall as its tallest; a zone across both shares them out
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
    let [c0, c1] = one ? [zones[0].need.w, 0] : share(colNeed, spanW), [r0, r1] = one ? [zones[0].need.h, 0] : share(rowNeed, spanH);
    const minWH = zones.length > 1 ? DESIGN_MIN_MANY : DESIGN_MIN_ONE;
    const RW = Math.max(minWH[0], c0 + c1), RH = Math.max(minWH[1], r0 + r1);
    if (!target && (RW > DESIGN_MAX[0] || RH > DESIGN_MAX[1])) return refuse('Those zones need a ' + (c0 + c1) + ' × ' + (r0 + r1) + ' room, larger than the ' + DESIGN_MAX[0] + ' × ' + DESIGN_MAX[1] + ' StarNet builds at once. Split it into two rooms.');
    if (!one) { c0 += (RW - c0 - c1) >> 1; r0 += (RH - r0 - r1) >> 1; }   // any extra room goes evenly to both sides

    const before = floorFacts(live, P);
    const kind = (style.type && style.type.id) || 'hab';
    function attempt(R, roomSpec, roomId) {
      const probe = WM.create(clone(doc));
      if (roomSpec) {
        const was = new Set(probe.rooms().map(r => r.id));
        const a = probe.addRoom(Object.assign({}, roomSpec, { rect: R }));
        if (!a || !a.ok) return refuse('the room could not be added there');
        roomId = (probe.rooms().find(x => !was.has(x.id)) || {}).id;
      }
      const Wd = R.x2 - R.x1 + 1, Hd = R.y2 - R.y1 + 1;
      const cx = target ? R.x1 + (Wd >> 1) : R.x1 + (one ? Wd : c0), ry = target ? R.y1 + (Hd >> 1) : R.y1 + (one ? Hd : r0);
      const colX = [[R.x1, cx - 1], [cx, R.x2]], rowY = [[R.y1, ry - 1], [ry, R.y2]];
      const rectOf = a => { const [c, r, cs, rs] = AREAS[a]; return { x1: a === 'whole' ? R.x1 : colX[c][0], x2: a === 'whole' ? R.x2 : colX[c + cs - 1][1], y1: a === 'whole' ? R.y1 : rowY[r][0], y2: a === 'whole' ? R.y2 : rowY[r + rs - 1][1] }; };
      const land = landingTiles(probe, probe.projectGeometry(), roomId);
      const spec = { kind: 'design', room: roomSpec ? Object.assign({}, roomSpec, { rect: R }) : null, roomId: roomSpec ? null : roomId, lines: [], props: [] };
      const view = [], recruits = [];
      // 1. every line, laid out inside its zone by the engine (never on a doorway's landing)
      for (const z of zones.filter(q => q.kind === 'line')) {
        const zr = rectOf(z.area), fl = probe.lineGraph(null);
        if (!fl || !fl.ok) return refuse('this floor does not build by links');
        const floor = Object.assign({}, fl.floor, { rects: [zr], blocked: fl.floor.blocked.concat([...land].map(k => { const [x, y] = k.split(',').map(Number); return { x, y, w: 1, h: 1 }; })) });
        const near = { x: (zr.x1 + zr.x2) >> 1, y: (zr.y1 + zr.y2) >> 1 };
        let L = env.LineLayout.layout(z.graph, floor, { near });
        if (!L.ok && env.LineEdit && env.LineEdit._internals && env.LineEdit._internals.layoutNear) L = env.LineEdit._internals.layoutNear(env.LineLayout, z.graph, floor, near, 12);
        if (!L.ok) return refuse(AREA_LABEL[z.area] + ' of ' + (roomSpec ? 'the new room' : target.name) + ' is ' + (zr.x2 - zr.x1 + 1) + ' × ' + (zr.y2 - zr.y1 + 1) + '; ' + (z.plain === 'a custom line' ? 'that line' : z.plain) + ' needs ' + z.need.w + ' × ' + z.need.h + '.', { tooSmall: true });
        const a = probe.applyLineLayout(clone(z.graph), L);
        if (!a || !a.ok) return refuse('that line could not be laid in ' + AREA_LABEL[z.area] + (a && a.msg ? ' (' + a.msg + ')' : ''));
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
        spec.lines.push({ graph: clone(z.graph), L, steps: stepsOut.map(x => ({ node: x.node, brief: x.brief, agentId: x.agentId })) });
        stepsOut.filter(x => x.recruit).forEach(x => recruits.push({ line: spec.lines.length - 1, node: x.node, role: x.role }));
        view.push({ area: z.area, kind: 'line', rect: zr, z, lineIds, shape, runOrder, stepsOut, line: spec.lines.length - 1 });
      }
      // 2. every style: its largest set that fits, against the room's outer walls first, as arranged or mirrored
      for (const z of zones.filter(q => q.kind === 'style')) {
        const zr = rectOf(z.area), sets = env.RoomStyles.STYLES[z.style].sets, inner = { x1: zr.x1 + 1, y1: zr.y1 + 1, x2: zr.x2 - 1, y2: zr.y2 - 1 };
        const iw = inner.x2 - inner.x1 + 1, ih = inner.y2 - inner.y1 + 1, onRight = zr.x2 === R.x2 && zr.x1 !== R.x1;
        let placed = null;
        const belts = probe.serialize().belts;
        for (const set of sets) {
          if (set.w > iw || set.h > ih) continue;
          const wallX = onRight ? inner.x2 - set.w + 1 : inner.x1, xs = [...new Set([wallX, onRight ? wallX - 1 : wallX + 1, inner.x1 + ((iw - set.w) >> 1), onRight ? inner.x1 : inner.x2 - set.w + 1])].filter(x => x >= inner.x1 && x + set.w - 1 <= inner.x2);
          const ys = [inner.y1, inner.y1 + ((ih - set.h) >> 1), inner.y2 - set.h + 1];
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
            placed = { props, cp }; break outer;
          }
          if (placed) break;
        }
        if (!placed) return refuse(AREA_LABEL[z.area] + ' of ' + (roomSpec ? 'the new room' : target.name) + ' is ' + (zr.x2 - zr.x1 + 1) + ' × ' + (zr.y2 - zr.y1 + 1) + ', with no clear spot there for ' + env.RoomStyles.STYLES[z.style].name + ' (it needs ' + (sets[sets.length - 1].w + 2) + ' × ' + (sets[sets.length - 1].h + 2) + ' of clear floor).', { tooSmall: true });
        for (const p of placed.props) probe.addProp({ t: p.t, x: p.x, y: p.y, w: p.w, h: p.h, r: p.r || 0, block: p.block });
        spec.props.push(...placed.props);
        view.push({ area: z.area, kind: 'style', rect: zr, z, props: placed.props });
      }
      const t = tryDesign(doc, spec, env, before);
      if (!t.ok) return t;
      return { ok: true, spec, view, recruits, R, roomId: t.built.roomId, final: t.probe, built: t.built };
    }
    let got = null, why = null;
    if (target) {
      got = attempt(target.rects[0], null, target.id);
      if (!got.ok) return got;
    } else {
      // no name given: the room is named for what fills it first (COZY, LIBRARY, or the line's own name)
      const z0 = zones[0], autoName = z0.kind === 'style' ? z0.style.toUpperCase() : String(z0.label || z0.plain || 'WORKROOM').toUpperCase();
      const roomSpec = { kind, name: (roomName || autoName).slice(0, 24), floorStyle: style.floorStyle || undefined, floorMat: style.floorMat || undefined };
      for (const R of live.roomSpots(RW, RH, kind, 24)) {
        const a = attempt(R, roomSpec, null);
        if (a.ok) { got = a; break; }
        if (!why || a.tooSmall) why = a;
      }
      if (!got) return why && why.tooSmall ? why : refuse('There is no clear space beside the station for a ' + RW + ' × ' + RH + ' room with those zones. Remove something, or ask for fewer zones.');
    }

    // what the card says: where the room goes, each zone in plain words, the equipment, and what is still to do
    const fp = got.final, crewIds = (env.crew || []).map(a => a && a.id).filter(Boolean);
    const rp = WM.create(clone(fp.serialize())), deskRooms = [];
    got.recruits.forEach((rc, i) => {
      const id = '__sb_recruit_' + i, d = rp.ensureWorkstation(id);
      if (d && d.ok && d.roomId) { const rm = rp.roomById ? rp.roomById(d.roomId) : null; if (rm && deskRooms.indexOf(rm.name) < 0) deskRooms.push(rm.name); }
      rp.assignPropAgent(got.built.lines[rc.line].idOf[rc.node], id); crewIds.push(id);
    });
    const room = fp.rooms().find(r => r.id === got.roomId);
    const neighbour = target ? null : (() => { const R = got.R; const adj = rooms.find(rm => rm.rects.some(q => q.x1 <= R.x2 + 1 && q.x2 >= R.x1 - 1 && q.y1 <= R.y2 + 1 && q.y2 >= R.y1 - 1)); return adj ? adj.name : null; })();
    const lines = [], steps = [], equipProps = [];
    const zoneText = got.view.sort((a, b) => req.zones.findIndex(z => areaOf(z.area) === a.area) - req.zones.findIndex(z => areaOf(z.area) === b.area)).map(v => {
      if (v.kind === 'style') { equipProps.push(...v.props); return AREA_LABEL[v.area] + ', ' + env.RoomStyles.STYLES[v.z.style].name + ' (' + piecesText(env, v.props) + ')'; }
      const built = got.built.lines[v.line], ids = built.lineIds, rd = readLine(rp, ids, env, crewIds);
      const recruitNodes = new Set(got.recruits.filter(r => r.line === v.line).map(r => r.node));
      const stepsView = v.stepsOut.map(x => ({ step: x.step, role: titleCase(x.role), agent: recruitNodes.has(x.node) ? 'a new recruit' : x.agentId ? nameOf(env, x.agentId) : null, instructions: x.brief }));
      stepsView.forEach(s => steps.push(Object.assign({}, s, { role: s.role + (got.view.filter(q => q.kind === 'line').length > 1 ? ' on ' + (v.z.label || v.z.plain) : '') })));
      const capP = ids.map(id => fp.propById(id)).find(p => p && p.t === 'intake'), capNow = capP && capP.limits ? capP.limits.maxUsdPerDay : null;
      lines.push({ label: v.z.label, plain: v.z.plain, area: v.area, ready: rd.ready, blocking: rd.blocking, picked: v.z.picked });
      return AREA_LABEL[v.area] + ', ' + v.z.plain + (v.z.label ? ' ("' + v.z.label + '")' : '') + ': ' + flowText(v.shape.cols, v.runOrder, stepsView)
        + (v.z.graph.nodes.some(n => n.t === 'outbox') ? ' → Outbox' : '') + (capP ? (capNow != null ? ' · daily cap $' + capNow : ' · no daily cap') : '');
    });
    for (const v of got.view) if (v.kind === 'line') equipProps.push(...v.lineIds.map(id => fp.propById(id)).filter(Boolean));
    const equip = equipmentOf(env, equipProps), gains = gainsOf(env, equipProps);
    const blocking = [].concat(...lines.map(l => l.blocking.map(b => (lines.length > 1 ? (l.label || l.plain) + ': ' : '') + b)));
    const Wd = got.R.x2 - got.R.x1 + 1, Hd = got.R.y2 - got.R.y1 + 1;
    const where = target ? target.name + ' (' + Wd + ' × ' + Hd + ')' : (room ? room.name : roomName || 'NEW ROOM') + ', a new ' + Wd + ' × ' + Hd + ' room' + (neighbour ? ' beside ' + neighbour : '');
    const summary = where + ': ' + zoneText.join('; ') + '.'
      + (equip.length ? ' It brings equipment: ' + equip.join(', ') + (gains.length ? '. What agents gain there: ' + gains.join('; ') : '') + '.' : '')
      + (lines.length ? ' ' + (blocking.length ? 'Still to do after building: ' + blocking.join('; ') + '.' : (lines.length > 1 ? 'Its lines will be ready to run.' : 'It will be ready to run.')) : '')
      + (got.recruits.length ? ' It adds ' + got.recruits.length + ' crew member' + (got.recruits.length > 1 ? 's' : '') + ': ' + got.recruits.map(r => r.role).join(', ') + (deskRooms.length ? ', with a desk in ' + deskRooms.join(' and ') : '') + '. UNDO does not remove agents; DELETE AGENT in a Dossier does.' : '')
      + lines.filter(l => l.picked).map(l => ' Picked for the ' + AREA_LABEL[l.area].replace(/^the /, '') + ': ' + l.picked + '.').join('');
    // the card's drawing: the station's rooms, this room lit, each zone outlined and numbered, what will stand there
    const fpd = fp.serialize();
    const preview = previewOf(WM, doc, fpd, got.view.map(v => ({ rect: v.rect, where: AREA_LABEL[v.area].replace(/^the /, ''), label: v.kind === 'style' ? env.RoomStyles.STYLES[v.z.style].name : (v.z.label || v.z.plain) })), got.roomId);
    return { ok: true, plan: { floorSig: sigOf(doc), resultSig: sigOf(fpd), spec: Object.assign({}, got.spec, { recruits: got.recruits }), summary, notes, steps,
      rooms: [{ name: room ? room.name : roomName, where }], where, lines, preview, line: null } };
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
        const pid = rc.propIndex != null ? b.ids[rc.propIndex] : ((((b.lines || [])[rc.line]) || {}).idOf || {})[rc.node];
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
    if (pl.spec.kind === 'design') {
      for (const x of recruited) crewIds.push(x.id);
      const lines = (built.lines || []).map((ln, i) => { const rl = readLine(st, ln.lineIds, env, crewIds); return { label: (pl.lines[i] || {}).label || null, lineId: rl.comp ? rl.comp.key : null, ready: rl.ready, blocking: rl.blocking }; });
      return { ok: true, kind: 'design', summary: pl.summary, rooms: pl.rooms || [], where: pl.where, lines, roomIds: built.roomId ? [built.roomId] : [], recruited };
    }
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

  return { MENU, STEP_KEYS, ROOM_MENU, STYLE_MENU, DESIGN_MENU, ZONE_KEYS, AREAS, catalog, resolveLine, plan, planRoom, planRestyle, planDesign, shapeGraph, areaOf, apply, sigOf };
});
