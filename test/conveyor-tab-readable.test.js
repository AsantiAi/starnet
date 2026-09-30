/* test/conveyor-tab-readable.test.js — THE CONVEYORS TAB IS THE LIBRARY'S OWN GLASS (Andrew, 2026-09-30: "the long sentences
   underneath each machine like that I hate it … stop resorting back to the old ugly UI … it's the majority of the left side
   that's terrible"; earlier the same day: "users will not be able to read this from how small the text is").

   The tab is laid out like the Props tab beside it, and locked here so it cannot drift back:
     · two section keys — LINES · MACHINES — in the Props tab's section-key row (.refit-prop-sections), counts from the catalog;
     · MACHINES: three across, each the prop tile — the machine's own art, its name, its wiring drawn small; no sentence;
     · LINES: BUILD YOUR OWN LINE on top, then two across — the line's miniature, its plain name, one small line (steps · size,
       or its fit); no sentence, no catalog tag, no footnote;
     · every sentence a tile used to print is its hover tip (data-tip, the station tooltip) and its accessible description;
     · section names are names only (no blurb line), and no intro paragraph opens the tab or the BELT tool;
     · the tiles wear the prop tile's glass (one edge, the glass fill, 8px) and its type roles (names compact, small lines meta),
       so nothing on the tab is under 14px. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const build = rd('frontend/app/build.js'), app = rd('frontend/css/app.css'), polish = rd('frontend/css/refit-polish.css'), readable = rd('frontend/css/readability.css');
const at = (src, from, to) => { const a = src.indexOf(from); return a < 0 ? '' : src.slice(a, to ? src.indexOf(to, a) : a + 4000); };

/* ---------- the tab: section keys, no paragraph ---------- */
const branch = at(build, "} else if (tool === 'line' || ((tool === 'select' || tool === 'prop') && buildGroup === 'workflow')) {", '    if (pal.querySelector(\'.refit-linegrid\'))');
A.ok(branch.length > 400, 'found the Conveyors tab branch');
A.ok(/secs\.className = 'refit-prop-sections refit-conv-sections'/.test(branch) && /b\.className = 'bb refit-prop-section'/.test(branch), 'LINES · MACHINES are the Props tab\'s section keys');
A.ok(/\[\['lines', LINES_LABEL, blueprints\(\)\.length\], \['machines', MACHINES_LABEL, workflowMachines\(\)\.length\]\]/.test(branch), '…each counting the real catalog');
A.ok(/if \(convSection === 'machines'\) pal\.appendChild\(machinePalette\(\)\);/.test(branch), 'MACHINES shows the machine grid');
A.ok(/own\.className = 'bb refit-ownline'/.test(branch) && /'＋ BUILD YOUR OWN LINE'/.test(branch), 'LINES opens with BUILD YOUR OWN LINE');
A.ok(!/refit-lineintro|refit-linenote|LINE_SENTENCE/.test(branch) && !/LINE_SENTENCE/.test(build), 'no intro paragraph and no footnote on the tab');
A.ok(!/refit-lineintro/.test(build) && /note\.innerHTML = '<b>Connect machines<\/b><span>Click where work starts, then where it goes next\.<\/span>'/.test(build), 'the BELT tool opens on a title and one line, like the other tabs — not a paragraph');
A.ok(/if \(tool === 'line'\) convSection = 'lines';/.test(branch), 'an armed line always shows its card and its SET UP row');

/* ---------- a machine tile: art, name, wiring — the purpose is its tip ---------- */
const mp = at(build, '  function machinePalette() {', '  const THUMB_PAD');
A.ok(/const DW = 76, DH = 50/.test(mp), 'the machine\'s art sits in the prop tile\'s 76×50 well');
A.ok(/b\.append\(cvEl, nm\);/.test(mp) && /machineDiagramSVG\(c\.id\)/.test(mp), '…with its name and its wiring');
A.ok(!/refit-machinetile-why|refit-machinetile-txt/.test(build), 'no sentence is printed under a machine');
A.ok(/b\.dataset\.tip = c\.label \+ \(purpose \? '\\n' \+ purpose : ''\) \+ \(how \? '\\n' \+ how : ''\);/.test(mp) && /b\.setAttribute\('aria-description', purpose/.test(mp), 'what a machine does (and its group\'s how-to) is its hover tip and accessible description');
A.ok(/gh\.textContent = MACHINE_GROUPS\[gi\]\[0\];/.test(mp) && !/class="why"/.test(mp), 'a group heading is its name only');

/* ---------- a line tile: miniature, name, one small line — the purpose is its tip ---------- */
const lt = at(build, '  function makeLineTile(bp, why) {', '  /* DECK-FIT HONESTY');
A.ok(/view\.appendChild\(lineSchematic\(bp\)\)/.test(lt) && /nm\.className = 'refit-matname'/.test(lt) && /stat\.className = 'refit-linetile-stat'/.test(lt), 'a line tile is its miniature, its name and one small line');
A.ok(/docks \+ \(docks === 1 \? ' step' : ' steps'\) \+ ' · ' \+ bp\.w \+ ' × ' \+ bp\.h/.test(lt), '…the small line reads steps · size, from the catalog');
A.ok(!/refit-linetile-why|refit-linetile-tag|refit-linetile-nofit/.test(build), 'no purpose sentence, catalog tag or NO ROOM sentence is printed on a line tile');
A.ok(/b\.dataset\.tip = name /.test(lt) && /b\.setAttribute\('aria-description'/.test(lt), 'the purpose, catalog name and (goal) quote are its tip and accessible description');
A.ok(!/b\.title = /.test(lt), '…never a native title bubble');
A.ok(/function lineGroupHd\(label, cls\) \{[\s\S]{0,200}hd\.textContent = label;/.test(build) && !/refit-linegroup-why/.test(build), 'a section heading is its name only');
A.ok(/const S = Math\.max\(4, Math\.min\(12, Math\.floor\(160 \/ bp\.w\), Math\.floor\(56 \/ bp\.h\)\)\);/.test(build), 'the miniature is sized for a two-across tile (whole pixels, never scaled)');

/* ---------- the CSS: grids, the prop tile's glass, its type ---------- */
A.ok(/\.refit-machinegrid \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/.test(app), 'machines are three across');
A.ok(/\.refit-linegrid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/.test(app), 'lines are two across');
A.ok(/\.refit-overlay \.refit-prop-sections\.refit-conv-sections \{ grid-template-columns: 1fr 1fr; width: 100%; \}/.test(polish), 'the two section keys span the palette');
A.ok(/\.refit-overlay :is\(\.refit-linetile,\.refit-machinetile\) \{ border: 1px solid var\(--refit-edge\); border-radius: 8px; background: var\(--refit-glass\); box-shadow: none; \}/.test(polish), 'the tiles wear the prop tile\'s glass');
A.ok(/\.refit-overlay :is\(\.refit-linetile,\.refit-machinetile\)\.active \{ border-color: var\(--ph\); background: rgba\(var\(--ph-rgb\),\.12\); box-shadow: none; \}/.test(polish), '…and its lit active face (matte, no glow)');
A.ok(/\.refit-machinetile-nm,\.refit-linetile \.refit-matname,/.test(readable) && /\.refit-linetile-stat,\.refit-linegroup,\.refit-machinegroup,\.refit-lineprefs-hd,\.refit-lineprefs-k\)/.test(readable), 'names take the prop tile\'s compact role (15px) and small lines its meta role (14px)');
const convCss = app.slice(app.indexOf('/* THE CONVEYORS TAB (Build Library)'), app.indexOf('/* the guide card\'s lead'));
A.ok(convCss.length > 500 && !/text-shadow:\s*0 0|--ph-glow/.test(convCss), 'the tab\'s own CSS carries no glow');
const px = (convCss.match(/font-size:\s*([0-9.]+)px/g) || []).map(s => +/([0-9.]+)/.exec(s)[1]);
A.ok(px.every(n => n >= 14), 'nothing the tab sets itself is under 14px (' + px.join(', ') + ')');

A.report('conveyor-tab-readable.test');
