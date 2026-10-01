/* test/build-mode-easy.test.js — BUILD MODE, EASIER + MORE FUN (2026-10-01 — Andrew: "lets also do a big upgrade on build mode overall,
   i feel it needs to be easier and more fun to use"). A newcomer's walk at 1440×900 found the Props tab showing ZERO props, a
   selection that hid the whole library, Delete/Backspace doing nothing, no duplicate or nudge keys, and a tooltip stuck on the glass.
   Locked here (source — build.js is the DOM-bound REFIT module):
     1. the library shows its props: one scroller for the tiles, MAKE A PROP resting as one row that opens in place and is held open
        while a paid job, a preview or a message waits (the props lane's rule), the credits key kept in that row;
     2. the selection card sits ABOVE the library (never hides it), shows the object's art, and every action wears its key;
     3. the editor keys: Delete/Backspace, Ctrl+D (a copy beside it, then selected), Ctrl+C / Ctrl+V (COPY's own pickup), the arrows
        (Shift: five), R/M on the selection — each one ordinary edit, one UNDO;
     4. the BUILD menu's tooltip never outlives opening REFIT. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const build = rd('frontend/app/build.js'), easy = rd('frontend/css/refit-easy.css'), kit = rd('frontend/css/refit-kit.css'), html = rd('frontend/index.html');
const fn = name => { const i = build.indexOf('function ' + name + '('); if (i < 0) return ''; const j = build.indexOf('\n  }\n', i); return build.slice(i, j + 4); };

/* ---------- 1. the library shows its props ---------- */
A.ok(/\.refit-overlay \.refit-propbrowser \{ overflow: hidden; min-height: 0; \}/.test(easy) && /\.refit-overlay #refit-propgrid-host \{ height: auto; flex: 1 1 0; min-height: 0; overflow-y: auto; \}/.test(easy),
  'ONE scroller holds the tiles (the browser column no longer scrolls around a 160px grid)');
A.ok(/browser\.append\(makePropMount\(\)\)/.test(build) && !/browser\.append\(makePropPanel\(\)\)/.test(build), 'MAKE A PROP mounts through the compact row');
const mount = fn('makePropMount');
A.ok(/const box = makePropPanel\(\);/.test(mount), '…which wraps the props lane\'s own panel, untouched');
A.ok(/makeJob && makeJob\.status !== 'done' && makeJob\.status !== 'failed'\) \|\| !!makePreview \|\| !!makeMsg/.test(mount) && /const open = makeOpen \|\| busy;/.test(mount),
  '…held OPEN while a paid job runs, a preview or a message waits (a job the Commander paid for is never hidden behind a key)');
A.ok(/inp\.addEventListener\('focus', \(\) => \{ makeOpen = true;/.test(mount) && /door\.onclick = \(\) => \{ makeOpen = true; chooseLibrarySection\('decoration'\);/.test(build),
  '…and opens when its field takes the focus, or the EQUIPMENT/ABILITIES door sends the Commander to it');
A.ok(/\.refit-makeprop\.is-compact > :not\(\.refit-makeprop-head\):not\(\.refit-makeprop-cta\) \{ display: none !important; \}/.test(easy) && /\.is-compact \.refit-makeprop-cta \.bb \{/.test(easy),
  'at rest it is ONE row: the title and the credits key (conversion stays in view)');
A.ok(/\.refit-overlay\[data-catalog="true"\] \.refit-hint \.refit-hint-keys \{ display: none; \}/.test(easy) && /white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/.test(easy),
  'the status strip is one quiet line while the catalog is up (the tiles get the room)');

/* ---------- 2. the selection card ---------- */
A.ok(!/\.has-selection\[data-tool="select"\] #refit-option-section \{ display:none; \}/.test(kit), 'a selection never hides the library any more');
const sel = fn('renderSelection');
A.ok(/propArtInto\(host\.querySelector\('\.refit-sel-art'\),p\)/.test(sel) && /refit-sel-x/.test(sel), 'the card shows the selected object\'s own art and a ✕ to deselect');
for (const [label, key] of [['MOVE', 'drag'], ['TURN', 'R'], ['FLIP', 'M'], ['DUPLICATE', 'Ctrl\\+D'], ['COPY', 'Ctrl\\+C'], ['DELETE', 'Del']])
  A.ok(new RegExp("addKey\\('" + label + "','" + key + "'").test(sel), 'the ' + label + ' key wears its shortcut (' + key.replace(/\\/g, '') + ')');
A.ok(/finally \{ if \(ctx\) PropSprites\.setCtx\(ctx\); \}/.test(fn('propArtInto')), 'drawing the card art hands PropSprites back to the floor canvas');
A.ok(/\.refit-overlay \.refit-selection-actions \{ display: grid; grid-template-columns: repeat\(2, minmax\(0,1fr\)\); gap: 6px; \}/.test(easy), 'actions in two columns: every key cap fits');

/* ---------- 3. the editor keys ---------- */
const key = fn('onKey');
A.ok(/if \(selectedPropId && tool === 'select'\) \{/.test(key), 'the editor keys act on the SELECTED object only');
A.ok(/ev\.key === 'Delete' \|\| ev\.key === 'Backspace'\) \{ ev\.preventDefault\(\); deleteSelected/.test(key), 'Delete / Backspace remove it');
A.ok(/\(ev\.ctrlKey \|\| ev\.metaKey\) && \(ev\.key === 'd' \|\| ev\.key === 'D'\)\) \{ ev\.preventDefault\(\); duplicateSelected/.test(key), 'Ctrl+D duplicates it');
A.ok(/\(ev\.key === 'c' \|\| ev\.key === 'C'\)\) \{ ev\.preventDefault\(\); copySelected/.test(key) && /\(ev\.key === 'v' \|\| ev\.key === 'V'\) && lastCopy\)/.test(key), 'Ctrl+C picks it up as a stamp; Ctrl+V picks the last copy up again');
A.ok(/ArrowLeft: \[-1, 0\], ArrowRight: \[1, 0\], ArrowUp: \[0, -1\], ArrowDown: \[0, 1\]/.test(key) && /const n = ev\.shiftKey \? 5 : 1;/.test(key), 'the arrows nudge a tile (Shift: five)');
A.ok(key.indexOf("if (selectedPropId && tool === 'select')") < key.indexOf("const map = { '0': 'select'"), '…before the number keys pick tools');
const dup = fn('duplicateSelected');
A.ok(/const spec = copySpecOf\(p\), at = freeSpotNear\(spec, p\.x, p\.y\);/.test(dup) && /if \(res\.id\) \{ selectedPropId = res\.id; renderSelection\(\); \}/.test(dup), 'a duplicate lands in the nearest clear spot and becomes the selection (Ctrl+D again makes a row)');
A.ok(!/agentId/.test(fn('copySpecOf')), '…a copy never carries an agent binding (the COPY tool\'s own rule)');
A.ok(/if \(res && res\.ok\) \{ selectedPropId = null;/.test(fn('deleteSelected')), 'a delete that was refused keeps the selection');
A.ok(/station\.propById\(hoverPropId \|\| selectedPropId\)/.test(build), 'R / M turn and flip the selected object (a hovered one still wins)');
A.ok(/if \(id !== 'select' && !\(o && o\.keepGroup\)\) buildGroup =/.test(build), 'Ctrl+C from the Props tab keeps the Props tab up');

/* ---------- 4. no stuck tooltip ---------- */
A.ok(/raf = requestAnimationFrame\(frame\);\n[^\n]*\n[^\n]*\n    try \{ document\.dispatchEvent\(new Event\('scroll'\)\); \} catch \(_\) \{\}/.test(build), 'opening REFIT sends the station tooltip its hide signal');
A.ok(/<link rel="stylesheet" href="css\/refit-easy\.css">/.test(html) && html.indexOf('css/refit-easy.css') > html.indexOf('css/refit-polish.css'), 'the stylesheet loads after the REFIT glass it refines');
A.ok(/\.refit-library-tabs \.bb:hover::before, \.refit-overlay \.refit-library-tabs \.bb:hover::after/.test(easy), 'the library tabs never wear the old [ ] hover brackets');

A.report('build-mode-easy.test');
