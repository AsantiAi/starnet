/* Furnished station builds. Room count excludes connecting corridors.
   WORK presets (2026-09-28 reimagining) also stamp one ready line from the Lines shelf (WorldModel.BLUEPRINTS), with
   every step's instructions written and a sample job to try — so the station a Commander picks for their kind of work
   can run that work. LOOK presets are rooms and furniture only. No preset ever hires staff: every Bay stamps unbound,
   carrying its shelf ROLE, and the setup guide (Build mode) is where the Commander picks or recruits who works it. */
'use strict';
const StationTemplates = (() => {
  /* `purpose` is the kind of work a WORK preset is for, and `purposeLabel` names it in the onboarding purpose question's own
     words (Code & build / Research & brief / Write & edit / Run tasks & ops / A bit of everything), so the station question
     that follows speaks the same vocabulary. */
  const catalog = [
    { id: 'software', group: 'work', purpose: 'code', purposeLabel: 'Code & build', name: 'SOFTWARE STUDIO', rooms: 5, pitch: 'a builder makes each change and a tester checks it', description: 'A workshop, a Build & Test room, a review room and a library. A Builder makes each change and a Tester sends it back until it passes.', wings: [['engineering','west'],['buildTest','north'],['review','east'],['reading','south']] },
    { id: 'research', group: 'work', purpose: 'research', purposeLabel: 'Research & brief', name: 'RESEARCH STATION', rooms: 3, pitch: 'one agent digs up sources and the next writes the brief', description: 'An analysis lab with a Research → Write line, and a reference archive. One agent digs up sources, the next writes the brief.', wings: [['researchLab','north'],['archive','east']] },
    { id: 'creative', group: 'work', purpose: 'write', purposeLabel: 'Write & edit', name: 'CREATIVE STUDIO', rooms: 3, pitch: 'a drafter writes it and a reviewer sends it back until it is right', description: 'A design studio and a Draft & Review room. A Drafter writes it, and a Reviewer sends it back until it meets your brief.', wings: [['creative','north'],['creativeReview','east']] },
    { id: 'operations', group: 'work', purpose: 'ops', purposeLabel: 'Run tasks & ops', name: 'OPERATIONS STATION', rooms: 5, pitch: 'each request goes to a code, research or general specialist', description: 'Dispatch, comms, archive and review rooms. Each incoming request is sorted to a code, research or general specialist.', wings: [['archive','west'],['comms','east'],['dispatch','north'],['review','south']] },
    { id: 'cozy', group: 'work', purpose: 'general', purposeLabel: 'A bit of everything', name: 'COZY WORKSHOP', rooms: 3, pitch: 'one agent handles any job, with a $5-a-day spending cap', description: 'Warm wood floors, a furnished lounge, and a front desk where one agent handles any job within a $5-a-day cap.', wings: [['cozyWorkshop','north'],['cozyLounge','south']] },
    { id: 'default', group: 'look', name: 'DEFAULT', rooms: 1, description: 'One open room. All five essentials, your workstation, and space to grow.', wings: [] },
    { id: 'retreat', group: 'look', name: 'QUIET RETREAT', rooms: 2, description: 'Your home station with a quiet library and lounge to the south.', wings: [['reading','south']] }
  ];
  /* a room's `line` stamps a shelf blueprint at (x, y) in room tiles: `label` names its INBOX (the guide finds its line
     by that name) and `briefs` fills each Bay's standing instructions by the Bay's shelf ROLE (one Bay per role). */
  const rooms = {
    cozyWorkshop: { name: 'WORKROOM', kind: 'factory', floorStyle: 'walnut', floorMat: 'plank', props: [['plant',1,1],['plant',16,1],['desk',2,7],['industrial_drawerbank',12,7],['bookshelf',14,9]],
      line: { bp: 'allowance_desk', x: 3, y: 1, label: 'COZY · FRONT DESK', briefs: {
        GENERALIST: 'Do what the incoming request asks, then summarize what you did in plain words. If something you need is missing, say exactly what it is.'
      } } },
    cozyLounge: { name: 'LOUNGE', kind: 'quarters', floorStyle: 'walnut', floorMat: 'plank', props: [['tv',2,1],['rug',1,2],['couch',1,5],['industrial_roundtable',11,4],['dinerchair',10,4,3],['dinerchair',13,4,1],['coffee',14,4],['bookshelf',12,1],['plant',16,1],['bunk',13,7],['plant',1,8]] },
    reading: { name: 'LIBRARY', kind: 'quarters', floorStyle: 'walnut', floorMat: 'plank', props: [['couch',1,1],['bookshelf',13,1],['plant',16,8],['industrial_roundtable',2,4]] },
    creative: { name: 'DESIGN STUDIO', kind: 'lab', floorStyle: 'walnut', floorMat: 'plank', props: [['desk',2,1],['easel',11,1],['plant',0,1],['plant',16,1],['bookshelf',1,8],['industrial_drawerbank',1,6],['industrial_roundtable',12,7],['dinerchair',11,7,3],['dinerchair',14,7,1]] },
    creativeReview: { name: 'DRAFT & REVIEW', kind: 'hab', floorStyle: 'ash', floorMat: 'plank', props: [['desk',3,1],['industrial_roundtable',10,2],['dinerchair',9,2,3],['dinerchair',12,2,1],['bookshelf',15,1],['plant',17,3]],
      line: { bp: 'revision_loop', x: 0, y: 4, label: 'CREATIVE · DRAFT & REVIEW', briefs: {
        WRITER: 'Draft a response to the incoming creative brief. Follow its audience, format, tone, and constraints. Make a complete first draft and flag assumptions. If the reviewer sent it back, fix exactly what they asked for. Pass the draft and the original requirements to the reviewer.',
        REVIEWER: 'Review the incoming draft against the original creative brief. Check clarity, consistency, tone, and unsupported claims while preserving the requested voice. If it meets the brief, return the finished version (small corrections are fine) and end with VERDICT: approved. If it needs another pass, list exactly what to fix and end with VERDICT: revise.'
      } } },
    review: { name: 'REVIEW', kind: 'hab', floorStyle: 'ash', floorMat: 'resin', props: [['desk',2,1],['whiteboard',11,0],['plant',16,1],['industrial_roundtable',7,4]] },
    researchLab: { name: 'ANALYSIS', kind: 'lab', floorStyle: 'teal', floorMat: 'resin', props: [['desk',3,1],['research_samplecart',12,1],['plant',16,1],['bookshelf',2,8],['bookshelf',12,8]],
      line: { bp: 'research_line', x: 0, y: 4, label: 'RESEARCH · DIG & WRITE', briefs: {
        RESEARCHER: 'Research the incoming question. Find three to five credible, recent sources and pull the key facts from each, with a link for every claim. Note where the sources disagree. Pass your notes and the original question to the writer.',
        WRITER: 'Turn the research notes into a short brief that answers the original question: the answer in one line first, then the key points with their links, then any open questions. Plain English, and no claim without a source.'
      } } },
    engineering: { name: 'WORKSHOP', kind: 'factory', floorStyle: 'hull', floorMat: 'tread', props: [['desk',3,1],['fabricator',11,1],['industrial_drawerbank',2,8],['crate',13,8]] },
    /* BUILD & TEST — from PR #47 by @mvanhorn (Matt Van Horn): his Builder and Tester instructions and slugify sample,
       on the shelf's BUILD & TEST loop instead of a one-off belt run, so a failing change goes back to the Builder. */
    buildTest: { name: 'BUILD & TEST', kind: 'factory', floorStyle: 'hull', floorMat: 'tread', props: [['desk',1,6],['desk',5,6],['rack',13,6],['industrial_roundtable',12,9],['dinerchair',11,9,3],['dinerchair',14,9,1],['plant',17,6]],
      line: { bp: 'build_test', x: 1, y: 0, label: 'SOFTWARE · BUILD & TEST', briefs: {
        ENGINEER: 'Build what the incoming request asks for. Restate the acceptance criteria, make the smallest complete change that meets them, and note how you checked it. If the tester sent it back, fix exactly what failed. Pass the change, your checks, and the original request to the tester.',
        TESTER: 'Test the incoming change against the original request. Check each acceptance criterion and edge case, and say which checks you actually ran. If everything passes, deliver the final change with a short test note and end with VERDICT: pass. If anything fails, say exactly what failed and end with VERDICT: revise.'
      } } },
    dispatch: { name: 'DISPATCH', kind: 'bridge', floorStyle: 'cobalt', floorMat: 'resin', props: [['consoleL',1,9],['desk',12,9],['plant',17,1]],
      line: { bp: 'triage_desk', x: 1, y: 0, label: 'OPERATIONS · TRIAGE', briefs: {
        ENGINEER: 'Handle the incoming coding request: make the change or answer the technical question, keep it small, and say how you checked it.',
        GENERALIST: 'Handle the incoming request: do what it asks, then summarize what you did in plain words and anything that still needs a decision.',
        RESEARCHER: 'Handle the incoming research request: find credible sources, answer the question plainly, and link every claim.'
      } } },
    comms: { name: 'COMMS', kind: 'bridge', floorStyle: 'hull', floorMat: 'resin', props: [['consoleL',3,1],['screens',10,0],['rack',12,1],['plant',16,1]] },
    archive: { name: 'ARCHIVE', kind: 'hab', floorStyle: 'walnut', floorMat: 'plank', props: [['bookshelf',2,1],['bookshelf',6,1],['bookshelf',10,1],['plant',16,1],['desk',3,7]] }
  };
  const slots = {
    east: { x:21, y:0, hall:{x1:18,y1:4,x2:20,y2:6} },
    west: { x:-21, y:0, hall:{x1:-3,y1:4,x2:-1,y2:6} },
    north: { x:0, y:-14, hall:{x1:7,y1:-3,x2:10,y2:-1} },
    south: { x:0, y:14, hall:{x1:7,y1:11,x2:10,y2:13} }
  };
  /* THE SETUP GUIDE's copy, one per WORK preset: which line it guides (the INBOX label), what the line is for, the
     flow in plain words, a sample job, and a name + duty for each step keyed by the Bay's shelf ROLE. */
  const guides = {
    software: Object.freeze({
      title: 'Software Studio', label: 'SOFTWARE · BUILD & TEST',
      purpose: 'Send in a coding task: a Builder makes the change, and a Tester checks it and sends it back until it passes.',
      flow: ['Your task', 'Builder', 'Tester', 'Outbox'],
      sample: 'SAMPLE JOB: Write a JavaScript function slugify(title) that lowercases the title, trims it, and joins words with single hyphens, dropping characters other than letters, digits, and spaces. Include three example inputs with their expected outputs. The tester should check every example and send back anything that fails.',
      roles: { ENGINEER: { name: 'Builder', description: 'Makes the requested change, notes how it was checked, and passes it to the tester.' },
               TESTER: { name: 'Tester', description: 'Checks the change against your request and sends it back to the builder until it passes.' } }
    }),
    research: Object.freeze({
      title: 'Research Station', label: 'RESEARCH · DIG & WRITE',
      purpose: 'Ask a question: one agent digs up sources, and the next writes a brief you can read in a minute.',
      flow: ['Your question', 'Researcher', 'Writer', 'Outbox'],
      sample: 'SAMPLE JOB: Compare three popular note-taking apps for a small team: price, collaboration features, and one drawback each. Link a source for every claim.',
      roles: { RESEARCHER: { name: 'Researcher', description: 'Finds credible sources and pulls the key facts, with a link for each.' },
               WRITER: { name: 'Writer', description: 'Turns the notes into a short brief that answers your question.' } }
    }),
    creative: Object.freeze({
      title: 'Creative Studio', label: 'CREATIVE · DRAFT & REVIEW',
      purpose: 'Turn a short creative brief into a draft, then have a reviewer send it back until it meets the brief.',
      flow: ['Your brief', 'Drafter', 'Reviewer', 'Outbox'],
      sample: 'SAMPLE JOB: Write a friendly launch announcement for a fictional community garden. Include a headline and three short sentences. Do not invent a date, location, or website. The reviewer should check those constraints and deliver the finished announcement.',
      roles: { WRITER: { name: 'Drafter', description: 'Writes the first version from your brief and passes it to the reviewer.' },
               REVIEWER: { name: 'Reviewer', description: 'Checks the draft against your brief and sends it back for another pass until it is right.' } }
    }),
    operations: Object.freeze({
      title: 'Operations Station', label: 'OPERATIONS · TRIAGE',
      purpose: 'Requests arrive at one Inbox, and a sorter hands each one to the specialist that fits: code, research, or everything else.',
      flow: ['A request', 'Sorter', 'The right specialist', 'Outbox'],
      sample: 'SAMPLE JOB: Find three simple, well-sourced ways a small team can cut its monthly cloud bill, and link a source for each.',
      roles: { ENGINEER: { name: 'Code specialist', description: 'Takes the requests about code.' },
               RESEARCHER: { name: 'Researcher', description: 'Takes the requests that need looking into.' },
               GENERALIST: { name: 'Generalist', description: 'Takes everything else.' } }
    }),
    cozy: Object.freeze({
      title: 'Cozy Workshop', label: 'COZY · FRONT DESK',
      purpose: 'One agent handles whatever you send in, and this line can never spend more than $5 a day.',
      flow: ['Your request', 'Assistant', 'Outbox'],
      sample: 'SAMPLE JOB: Turn this to-do list into a simple plan for the week, most important first: renew the car insurance, plan a friend\'s birthday dinner, clean out the garage, answer three work emails.',
      roles: { GENERALIST: { name: 'Assistant', description: 'Does any job you send, within the line\'s $5-a-day cap.' } }
    })
  };
  /* example(doc, model, pipeline, workflowLine) -> the setup guide's reading of the CURRENT floor, or null when this
     station is not a work preset. Never mutates `doc`. Step order is the Workflow panel's own run order
     (WorkflowLine.lineFlow) read on a probe copy with every Bay crewed, so it follows the belts — not the save's array
     order, and not who happens to be assigned yet. Readiness is WorkflowLine.readiness on the real floor: the same
     blocking list the Workflow panel's pill shows, with compute judged per Bay. One agent may work several steps. */
  function example(doc, model, pipeline, workflowLine) {
    const g = guides[doc.meta?.templateId];
    if (!g) return null;
    const live = model.create(structuredClone(doc)), geo = live.projectGeometry();
    const inbox = live.props().find(p=>p.t==='intake' && p.label===g.label);
    const comp = inbox && pipeline.lineComponents(geo).find(c=>c.intakes.includes(inbox.id));
    const fail = issue => ({...g,issue,roles:[],blocking:[],ready:false,key:comp?.key,inboxId:inbox?.id||null});
    if (!comp || comp.intakes.length!==1 || !comp.outboxes.length || !comp.bays.length)
      return fail('Reconnect the original Inbox, its Bays and the Outbox to use this guide. You can still edit the workflow normally.');
    const W = workflowLine;
    if (!W || !W.lineFlow || !W.readiness) return fail('The workflow reader is not loaded.');
    const probe = model.create(structuredClone(doc));
    comp.bays.forEach((b,i)=>probe.assignPropAgent(b.propId,'preset_probe_'+i));
    const pgeo = probe.projectGeometry(), pplan = pipeline.compileRoutingPlan(pgeo);
    const pcomp = pipeline.lineComponents(pgeo).find(c=>c.key===comp.key) || comp;
    const order = W.lineFlow(pplan, pcomp, pipeline, pgeo.props).order.filter(pid=>comp.bays.some(b=>b.propId===pid));
    if (order.length!==comp.bays.length) return fail('The belts no longer connect every step of this line. Check their direction and connections.');
    const roles = order.map(pid => {
      const p = live.propById(pid), meta = (p.role && g.roles[p.role]) || { name: p.role || 'Step', description: '' };
      return { ...meta, role: p.role || null, propId: pid, agentId: p.agentId || '' };
    });
    const plan = pipeline.compileRoutingPlan(geo);
    const flow = W.lineFlow(plan, comp, pipeline, geo.props);
    const r = W.readiness(flow, comp, { errors: plan.errors, hasCompute: (aid, pid) => live.bayObjects(aid, pid).includes('computer') });
    const unstaffed = roles.filter(x=>!x.agentId);
    const issue = r.ready ? '' : unstaffed.length ? 'Choose an agent for ' + unstaffed.map(x=>x.name).join(', ') + '.' : r.blocking[0].what;
    return {...g,roles,key:comp.key,inboxId:inbox.id,ready:r.ready,blocking:r.blocking.map(b=>b.what),issue};
  }
  /* recommend(text) -> a WORK preset id, or null: the station for what the Commander said they want help with. The five
     onboarding purpose chips map one to one (Code & build → software, Research & brief → research, Write & edit →
     creative, Run tasks & ops → operations, A bit of everything → cozy); typed words are read for the same five kinds of
     work, first clear match wins (code before writing, so "write code" is code). Nothing clear → null, and the caller
     recommends starting simple: never a guess. */
  const PURPOSE_WORDS = [
    ['general', /\b(general[- ]purpose|a bit of everything|whatever comes up|all[- ]rounder)\b/i],
    ['code', /\b(code|coding|coder|software|debug\w*|program(s|ming|mer)?|developers?|apps?|websites?|bugs?|repos?|pull requests?|ship(ping)? (it|features?|software|code))\b/i],
    ['research', /\b(research\w*|brief(ing|s)?|sources?|investigat\w*|analy[sz]\w*|stud(y|ies))\b/i],
    ['write', /\b(writ(e|es|ing)|edit(s|ing)?|content|drafts?|blog\w*|newsletters?|copywriting|posts?|articles?|stories)\b/i],
    ['ops', /\b(ops|operations|day[- ]to[- ]day|tasks?|inbox|customers?|support|schedul\w*|admin|emails?|errands?)\b/i],
  ];
  function recommend(text) {
    const t = String(text == null ? '' : text);
    if (!t.trim()) return null;
    for (const [purpose, re] of PURPOSE_WORDS) if (re.test(t)) { const c = catalog.find(x => x.group === 'work' && x.purpose === purpose); if (c) return c.id; }
    return null;
  }
  function build(id, model, sprites, nextId) {
    const entry = catalog.find(c => c.id === id);
    if (!entry) throw new Error('Unknown station build');
    const station = model.create(model.starterDoc());
    const requireOK = r => { if (!r.ok) throw new Error(r.msg || r.error); return r; };
    entry.wings.forEach(([type, side]) => {
      const r = rooms[type], slot = slots[side];
      // Every room retains the familiar 18 x 11 size for straightforward expansion.
      requireOK(station.addRoom({kind:r.kind,name:r.name,floorStyle:r.floorStyle,floorMat:r.floorMat,
        rect:{x1:slot.x,y1:slot.y,x2:slot.x+17,y2:slot.y+10}}));
      requireOK(station.placeHallway({rect:slot.hall}));
      for (const [t,x,y,facing=0] of r.props) {
        const spec = sprites.spec(t);
        if (!spec) throw new Error('Missing station furniture: '+t);
        requireOK(station.addProp({t,x:slot.x+x,y:slot.y+y,w:spec.w,h:spec.h,r:facing,block:spec.blocks!==false}));
      }
      if (r.line) {
        // the SAME stamp the Lines shelf places (one validated mutation); ids come back in the blueprint's prop order
        const L = r.line, bp = (model.BLUEPRINTS || []).find(b => b.id === L.bp);
        if (!bp) throw new Error('Missing station line: '+L.bp);
        const res = requireOK(station.stampBlueprint(L.bp,slot.x+L.x,slot.y+L.y));
        res.ids.forEach((pid,i) => {
          const s = bp.props[i];
          if (s.t==='intake' && L.label) requireOK(station.setPropLabel(pid,L.label));
          if (s.t==='bay' && s.role && L.briefs && L.briefs[s.role]) requireOK(station.setPropBrief(pid,L.briefs[s.role]));
        });
      }
    });
    const doc = station.serialize();
    doc.meta.name = entry.name;
    doc.meta.templateId = entry.id;
    if (Number.isInteger(nextId) && nextId > doc._nid) {
      const ids = {};
      for (const rid of doc.order) ids[rid] = 'r' + nextId++;
      const remapped = {};
      for (const rid of doc.order) { const room = doc.rooms[rid]; room.id = ids[rid]; remapped[room.id] = room; }
      doc.rooms = remapped; doc.order = doc.order.map(rid => ids[rid]);
      doc.meta.spawnRoomId = ids[doc.meta.spawnRoomId]; doc.meta.trunkRoomId = ids[doc.meta.trunkRoomId];
      const pidMap = {};
      doc.props.forEach(p => { const n = 'p' + nextId++; pidMap[p.id] = n; p.id = n; });
      doc._nid = nextId;
      // the links name their machines by id: carry every end through the renumbering (conveyor links phase B keeps the
      // floor's links as built, so a preset's lines arrive linked exactly as stamped)
      const end = e => (e && e.prop && pidMap[e.prop]) ? Object.assign({}, e, { prop: pidMap[e.prop] }) : e;
      if (Array.isArray(doc.links)) doc.links = doc.links.map(l => Object.assign({}, l, { from: end(l.from), to: end(l.to) }));
    }
    return doc;
  }
  return { catalog: catalog.map(({wings,...entry}) => Object.freeze(entry)), guides, build, example, recommend };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = StationTemplates;
