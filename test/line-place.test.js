/* test/line-place.test.js — READY-MADE LINES LAID OUT TO FIT (conveyor-links plan, phase E, 2026-09-29).

   The shelf's lines are graphs (worldmodel blueprintGraph): where a line's DRAWN tile map will not go, the layout engine
   lays the same line out near the click — its tidy shape, else anchored on its INBOX round what stands there — through
   LineEdit.placeBlueprint, one undo. Locked here:
     · every ready-made line lands in a FRESH starter room this way (only 12 of the 20 drawn tile maps fit it) and each one
       routes EXACTLY as the stamped original (every step, dispatch, join, copy, turn, loop and escape);
     · the card's SET UP BEFORE YOU PLACE rides along (the daily cap on the INBOX, the review tries on the LOOP);
     · one UNDO takes the whole line back; a floor with no room for it changes nothing and says how big a room it needs;
     · Build mode: a click where the drawn shape will not go lays the line out there, a card whose drawn shape fits nowhere
       asks the engine (in the background) and says FITS LAID OUT, the ghost invites that click, MAKE ROOM is sized by it. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const P = require('../frontend/app/pipeline.js');
const WM = require('../frontend/app/worldmodel.js');
const LE = require('../frontend/app/lineedit.js');

const JUNC = { splitter: 1, filter: 1, merger: 1, joiner: 1, loop: 1 };
const TAGS = ['general', 'code', 'research'];
const key = (x, y) => x + ',' + y;
// what a floor DOES, keyed by the machines' order in the blueprint (so a stamped line and a laid-out one compare)
function routing(props, belts, links) {
  const plan = P.compileRoutingPlan({ props, belts, links }), jAt = {}, idx = {};
  props.forEach((p, i) => { idx[p.id] = 'm' + i; if (JUNC[p.t]) jAt[key(p.x, p.y)] = 'm' + i; });
  const d = id => (id == null ? null : (idx[id] || id));
  const m = v => (v && typeof v === 'object') ? d(v.dockId) : (v || null);
  const step = s => !s ? null : s.dockId ? { to: d(s.dockId) } : s.branches ? { branches: s.branches.map(b => d(b.dockId)).sort(), split: jAt[s.split] }
    : s.join ? { join: jAt[s.join], expect: s.expect, next: m(s.next) } : s.loop ? { loop: jAt[s.loop], max: s.max, backTo: m(s.backTo), esc: m(s.esc), next: m(s.next), when: s.when } : s;
  const out = { errors: plan.errors.filter(e => !e.warn).map(e => e.code).sort(), resolve: {}, steps: {}, junctions: {} };
  for (const t of TAGS) { const r = P.resolveDock(plan, { tag: t }); out.resolve[t] = r ? d(r.dockId) : null; }
  for (const dk of Object.keys(plan.dockChains || {}).sort((a, b) => d(a) < d(b) ? -1 : 1)) for (const t of TAGS) out.steps[d(dk) + '|' + t] = step(P.chainStepDock(plan, dk, { tag: t, lineId: P.lineOfDock(plan, dk) }, () => 0));
  for (const k of Object.keys(plan.junctions)) { const j = plan.junctions[k], g = (plan.gateDocks || {})[k] || {}; out.junctions[jAt[k]] = { kind: j.kind, fanout: !!j.fanout, expect: j.expect || 0, max: j.max || 0, when: j.when || null, backTo: d(g.backTo), escTo: d(g.escTo) }; }
  return out;
}
const crewed = props => props.map(p => p.t === 'bay' ? Object.assign({}, p, { agentId: 'a_' + p.id }) : p);

/* ---------- EVERY READY-MADE LINE, LAID OUT IN A FRESH STARTER ROOM ---------- */
let placed = 0, drawnFits = 0;
const wrong = [];
for (const bp of WM.BLUEPRINTS) {
  const st = WM.create(WM.starterDoc()), z = st.rooms()[0].rects[0];
  let fits = false;
  for (let y = z.y1; y <= z.y2 && !fits; y++) for (let x = z.x1; x <= z.x2 && !fits; x++) if (st.canPlaceBlueprint(bp.id, x, y).ok) fits = true;
  if (fits) drawnFits++;
  const before = new Set(st.props().map(p => p.id));
  const r = LE.placeBlueprint(st, bp.id, { x: (z.x1 + z.x2) >> 1, y: (z.y1 + z.y2) >> 1 }, { stamp: { maxIter: 2, limits: { maxUsdPerDay: 4 } } });
  if (!r.ok) { wrong.push(bp.id + ': not placed — ' + r.error); continue; }
  placed++;
  const mine = st.props().filter(p => !before.has(p.id));
  // it is the SAME line as the drawn one: machine for machine, and it routes exactly as the stamped tile map
  // (the drawn line as it stamps with the same card settings: its LOOP's passes are the card's tries)
  const drawn = bp.props.map((p, i) => Object.assign({ id: 'd' + i }, p, p.t === 'loop' ? { maxIter: 2 } : {}));
  const geoDrawn = { props: crewed(drawn), belts: bp.belts.map(b => ({ x: b.x, y: b.y, dir: b.d })) };
  const order = r.ids.map(id => st.propById(id));
  if (order.some(p => !p) || order.map(p => p.t).join() !== bp.props.map(p => p.t).join()) { wrong.push(bp.id + ': machines differ'); continue; }
  const geoLaid = { props: crewed(order.map(p => Object.assign({}, p))), belts: st.belts().map(b => ({ x: b.x, y: b.y, dir: b.dir })), links: st.links() };
  if (JSON.stringify(routing(geoLaid.props, geoLaid.belts, geoLaid.links)) !== JSON.stringify(routing(geoDrawn.props, geoDrawn.belts))) wrong.push(bp.id + ': routes differently');
  // the card's SET UP BEFORE YOU PLACE rode along
  const inbox = mine.find(p => p.t === 'intake'), loop = mine.find(p => p.t === 'loop');
  if (inbox && !(inbox.limits && inbox.limits.maxUsdPerDay === 4)) wrong.push(bp.id + ': the daily cap did not ride along');
  if (loop && loop.maxIter !== 2) wrong.push(bp.id + ': the review tries did not ride along');
  // every machine stands where the station allows
  for (const p of mine) if (!st.canPlaceProp(p.t, p.x, p.y, p.w, p.h, p.id).ok) wrong.push(bp.id + ': ' + p.t + ' stands where it may not');
  // one UNDO takes the whole line back
  st.undo();
  if (st.props().some(p => !before.has(p.id))) wrong.push(bp.id + ': one undo did not take it back');
}
A.eq(wrong, [], 'every ready-made line laid out to fit is the same line, routing exactly as drawn, with the card\'s cap and tries, one undo');
A.ok(placed === WM.BLUEPRINTS.length && placed > drawnFits, 'laid out to fit, ' + placed + ' of ' + WM.BLUEPRINTS.length + ' ready-made lines land in a fresh starter room (the drawn tile maps: ' + drawnFits + ')');

/* ---------- NO ROOM: nothing changes, and it says how big a room the line needs ---------- */
{
  const st = WM.create(WM.starterDoc()), rm = st.rooms()[0].rects[0];
  for (let y = rm.y1; y <= rm.y2; y++) for (let x = rm.x1; x <= rm.x2; x++) if (st.canPlaceProp('crate', x, y, 1, 1).ok) st.addProp({ t: 'crate', x, y, w: 1, h: 1 });
  const s0 = JSON.stringify([st.props(), st.belts(), st.links()]);
  const r = LE.placeBlueprint(st, 'deep_dive', { x: 8, y: 5 });
  A.ok(!r.ok && r.error === 'NO_ROOM' && r.needs && r.needs.w > 0 && JSON.stringify([st.props(), st.belts(), st.links()]) === s0, 'a full deck: nothing changes, and it says the room the line needs (' + JSON.stringify(r.needs) + ')');
}

/* ---------- BUILD MODE: the click, the card, the ghost, MAKE ROOM ---------- */
{
  const build = fs.readFileSync(path.join(__dirname, '..', 'frontend/app/build.js'), 'utf8');
  const at = (from, to) => { const a = build.indexOf(from); return a < 0 ? '' : build.slice(a, build.indexOf(to, a)); };
  const stamp = at('  function stampLine(w, ev) {', '  /* NO STANDALONE CANVAS INVITATION');
  A.ok(/LineEdit\.placeBlueprint\(station, bp\.id, \{ x: w\.tx, y: w\.ty \}, \{ stamp: lineStampOpts\(bp\) \}\)/.test(stamp) && stamp.indexOf('station.stampBlueprint(') < stamp.indexOf('LineEdit.placeBlueprint('),
    'a click stamps the drawn tile map where it fits, and lays the same line out there (same cap and tries) where it does not');
  A.ok(/LAID OUT TO FIT HERE/.test(stamp), '…and says which it did');
  const fit = at('  function setLineTileFit(b, bp) {', '  let lineFitSyncT = 0;');
  // (2026-09-30: said on the tile's own small line — a line that fits laid out says its steps like any other; "needs more room" once the engine says no)
  A.ok(/queueLineLaid\(bp\.id\)/.test(fit) && !/fits laid out/.test(fit) && /'needs more room'/.test(fit) && /stat\.dataset\.rest/.test(fit), 'a card whose drawn shape fits nowhere asks the engine in the background, and says NEEDS MORE ROOM only once it has answered no');
  A.ok(/LineEdit\.canPlaceBlueprint\(station, id, lineNearTile\(\)\)/.test(build) && /lineLaidQueue\.length = 0/.test(at('  function clearLineFields() {', '  const lineLaidMemo')), '…one line at a time, forgotten whenever the floor changes');
  A.ok(/g\.laid \? ' — CLICK TO LAY IT OUT HERE'/.test(build), 'a red ghost invites the click only when the line fits laid out');
  A.ok(/const W = Math\.min\(bp\.w, need\.w\) \+ 2, H = Math\.min\(bp\.h, need\.h\) \+ 2;/.test(build), 'MAKE ROOM builds the room the laid-out line needs when that is smaller than the drawn one');
}

A.report('line-place.test');
