/* test/buildmode-halls.test.js — Build Mode keeps the hallway rule the station builder keeps (sweep 2026-10-02).

   A hallway joins two rooms. The station builder refuses an edit that leaves one leading nowhere (strandedHalls), but Build
   Mode's own room MOVE / nudge / RESIZE / DELETE went straight to the world model and stranded hallways freely. build.js now
   runs each of them through keepsHalls: the edit happens inside one transact, a hallway it newly strands rolls it back, and a
   hallway already stranded before is not its doing. This drives that exact rule against a real station. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const WM = require('../frontend/app/worldmodel.js');
const SB = require('../frontend/app/stationbuilder.js');

A.ok(typeof SB.strandedHalls === 'function', 'StationBuilder exports strandedHalls');

// the same wrapper build.js runs (keepsHalls), against a real station
function keepsHalls(station, op) {
  const before = new Set(SB.strandedHalls(station));
  return station.transact(() => {
    const r = op(); if (!r || !r.ok) return r;
    const now = SB.strandedHalls(station).filter(id => !before.has(id));
    if (!now.length) return r;
    return { ok: false, error: 'STRANDS_HALL' };
  });
}
function fresh() {
  const s = WM.create(); s.projectGeometry();
  const a = s.addRoom({ kind: 'hab', rect: { x1: 40, y1: 0, x2: 49, y2: 9 } });
  const b = s.addRoom({ kind: 'hab', rect: { x1: 60, y1: 0, x2: 69, y2: 9 } });
  const h = s.placeHallway({ rect: { x1: 50, y1: 4, x2: 59, y2: 5 } });
  A.ok(a.ok && b.ok && h && h.ok, 'fixture: two rooms joined by a hallway');
  A.eq(SB.strandedHalls(s), [], 'fixture: nothing stranded');
  return { s, a: a.id, b: b.id, h: h.id };
}

// shrinking a room away from its hallway (the reviewer's case): refused, nothing changes
{
  const { s, a } = fresh(), before = JSON.stringify(s.serialize());
  const r = keepsHalls(s, () => s.resizeRoom(a, { x1: 40, y1: 0, x2: 46, y2: 9 }));
  A.ok(r && !r.ok && r.error === 'STRANDS_HALL', 'a resize that leaves the hallway leading nowhere is refused: ' + JSON.stringify(r));
  A.eq(JSON.stringify(s.serialize()), before, '…and nothing changed');
  A.ok(keepsHalls(s, () => s.resizeRoom(a, { x1: 38, y1: 0, x2: 49, y2: 9 })).ok, 'growing it away from the hallway (still joined) is fine');
}
// moving a room off its hallway, and deleting one of the two rooms it joins
{
  const { s, b } = fresh(), before = JSON.stringify(s.serialize());
  const mv = keepsHalls(s, () => s.moveRoom(b, 5, 0));
  A.ok(mv && !mv.ok && mv.error === 'STRANDS_HALL', 'a move that pulls a room off its hallway is refused: ' + JSON.stringify(mv));
  const del = keepsHalls(s, () => s.removeRoom(b));
  A.ok(del && !del.ok && del.error === 'STRANDS_HALL', 'deleting a room its hallway needs is refused: ' + JSON.stringify(del));
  A.eq(JSON.stringify(s.serialize()), before, '…and nothing changed either time');
}
// deleting the hallway itself is fine, and one undo puts a permitted edit back
{
  const { s, h, a } = fresh();
  A.ok(keepsHalls(s, () => s.removeRoom(h)).ok, 'the hallway itself can be deleted');
  const before = JSON.stringify(s.serialize());
  A.ok(keepsHalls(s, () => s.moveRoom(a, 0, 2)).ok, 'with no hallway, the room moves');
  A.ok(s.undo().ok && JSON.stringify(s.serialize()) === before, 'one undo puts it back');
}

// Build Mode runs all four room edits through keepsHalls
const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'build.js'), 'utf8');
A.ok(/function keepsHalls\(op\) \{[\s\S]{0,400}StationBuilder\.strandedHalls\(station\)[\s\S]{0,300}error: 'STRANDS_HALL'/.test(src), 'build.js has the hallway guard');
for (const [what, re] of [['delete', /keepsHalls\(\(\) => station\.removeRoom\(roomId\)\)/], ['drag move', /keepsHalls\(\(\) => station\.moveRoom\(d\.roomId, s\.dx, s\.dy\)\)/],
  ['nudge', /keepsHalls\(\(\) => station\.moveRoom\(rm\.id, dx, dy\)\)/], ['resize', /keepsHalls\(\(\) => station\.resizeRoom\(rm\.id, nr\)\)/]]) A.ok(re.test(src), 'Build Mode ' + what + ' keeps the hallway rule');

A.report('buildmode-halls.test');
