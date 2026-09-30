/* test/conveyor-tab-readable.test.js — THE CONVEYORS TAB IS READABLE (Andrew, 2026-09-30: "this is an absolute must fix, users
   will not be able to read this from how small the text is").

   Every sentence on Build mode's Conveyors tab — the intro, the MACHINES shelf, the ready-made line cards and their notes —
   sat at 10–12px VT323 (a tall, narrow pixel face) beside a Workflow panel that speaks at 15px. The tab is on the panel's
   scale now. Locked here so it cannot shrink again:
     · sentences a Commander has to read: 15px or more;
     · names and section headings: 15px or more;
     · the small tags, chips and notes: 13px or more — nothing on this tab goes under 13px;
     · a machine tile gives its description the tile's full width (name + wiring diagram share the row above it), and a
       ready-made line's plain name takes its whole row and wraps — never "Two doors, one age…". */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'css', 'app.css'), 'utf8').replace(/\r\n/g, '\n');

// every rule block for a selector (a selector may have more than one), as text
function blocks(sel) {
  const out = [];
  let i = -1;
  while ((i = css.indexOf('\n' + sel + ' {', i + 1)) >= 0) out.push(css.slice(i + 1, css.indexOf('}', i) + 1));
  return out;
}
const sizeOf = sel => {
  for (const b of blocks(sel)) { const m = /font-size:\s*([0-9.]+)px/.exec(b); if (m) return +m[1]; }
  return null;
};
const has = (sel, re) => blocks(sel).some(b => re.test(b));

const SENTENCES = ['.refit-lineintro', '.refit-machinetile-why', '.refit-linegroup-why', '.refit-linetile-why'];
const NAMES = ['.refit-machinetile-nm', '.refit-linegroup-nm', '.refit-machinegroup .nm', '.refit-linetile .refit-matname'];
const SMALL = ['.refit-machinegroup .why', '.refit-linetile-tag', '.refit-linetile-stat', '.refit-linetile-nofit', '.refit-linetile-makeroom',
  '.refit-lineprefs-hd', '.refit-lineprefs-k', '.refit-lineprefs-note', '.refit-linenote'];

for (const s of SENTENCES) { const n = sizeOf(s); A.ok(n != null && n >= 15, s + ' is a sentence the Commander reads: 15px or more (it is ' + n + 'px)'); }
for (const s of NAMES) { const n = sizeOf(s); A.ok(n != null && n >= 15, s + ' is a name or heading: 15px or more (it is ' + n + 'px)'); }
for (const s of SMALL) { const n = sizeOf(s); A.ok(n != null && n >= 13, s + ' is a small tag or note: 13px or more (it is ' + n + 'px)'); }
A.ok(SENTENCES.concat(NAMES, SMALL).every(s => sizeOf(s) >= 13), 'nothing a Commander reads on the Conveyors tab is under 13px');

// the machine tile: the description has the tile's full width, under the name + wiring diagram
A.ok(has('.refit-machinetile', /display:\s*grid/) && has('.refit-machinetile-txt', /display:\s*contents/), 'a machine tile is a grid whose text wrapper dissolves into it');
A.ok(has('.refit-machinetile-why', /grid-column:\s*2\s*\/\s*span 2/) && has('.refit-machinetile-nm', /grid-row:\s*1/) && has('.refit-machinediagram', /grid-column:\s*3;\s*grid-row:\s*1/),
  'the description spans the tile under the name and the wiring diagram (never squeezed between the thumbnail and the diagram)');
A.ok(has('.refit-machinetile-why', /white-space:\s*normal/), '…and wraps');

// the ready-made line card: the plain name takes its whole row and wraps
A.ok(has('.refit-linetile .refit-matname', /flex:\s*1 1 100%/) && has('.refit-linetile .refit-matname', /white-space:\s*normal/) && has('.refit-linetile .refit-matname', /text-overflow:\s*clip/),
  'a ready-made line\'s name takes the whole first row and wraps — it is never cut to an ellipsis');
A.ok(has('.refit-linetile-hd', /flex-wrap:\s*wrap/), '…with its catalog tag and size chip on the row under it');

A.report('conveyor-tab-readable.test');
