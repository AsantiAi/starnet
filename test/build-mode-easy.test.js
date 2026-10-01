/* test/build-mode-easy.test.js — BUILD MODE, EASIER + MORE FUN (2026-10-01 — Andrew: "lets also do a big upgrade on build mode overall,
   i feel it needs to be easier and more fun to use"). A newcomer's walk at 1440×900 found the Props tab showing ZERO props, a
   selection that hid the whole library, Delete/Backspace doing nothing, no duplicate or nudge keys, and a tooltip stuck on the glass.
   Locked here (source — build.js is the DOM-bound REFIT module):
     1. the library shows its props: one scroller for the tiles, MAKE A PROP resting as one row that opens in place and is held open
        while a paid job, a preview or a message waits (the props lane's rule), the credits key kept in that row;
     2. the selection card sits ABOVE the library (never hides it), shows the object's art, and every action wears its key;
     3. the editor keys: Delete/Backspace, Ctrl+D (a copy beside it, then selected), Ctrl+C / Ctrl+V (COPY's own pickup), the arrows
        (Shift: five), R/M on the selection — each one ordinary edit, one UNDO;
     4. the BUILD menu's tooltip never outlives opening REFIT;
     5. THE FEEL: a placed thing drops into its own shadow and settles with a low thunk (a whole line drops machine by machine), a
        deleted thing dissolves behind a sweeping cut line with a falling hiss, a hovered prop lifts a hair — drawn only (the model
        has already changed), from the station's own synth, no particles;
     6. MANY AT ONCE: a drag across empty floor in SELECT draws a box and selects everything it touches (Shift adds), Shift+click
        adds / drops one, Ctrl+A takes the floor; the group moves (drag any member, the arrows), duplicates (Ctrl+D) or goes (Delete)
        as ONE edit — one UNDO, all-or-nothing; a plain click on empty floor lets go, and with nothing selected opens the room. */
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
A.ok(/\.refit-overlay \.refit-selection-actions \{ display: grid; grid-template-columns: repeat\(3, minmax\(0,1fr\)\); gap: 5px; \}/.test(easy)
  && /@container \(max-width: 380px\) \{ \.refit-overlay \.refit-selection-actions \{ grid-template-columns: repeat\(2, minmax\(0,1fr\)\); \} \}/.test(easy),
  'actions three to a row, two where the dock is narrow (every key cap fits)');
A.ok(/c\.width = 84; c\.height = 54;/.test(fn('propArtInto')) && /\.refit-sel-art \{ display: grid; place-items: center; width: 84px; height: 54px;/.test(easy),
  'the art well is 84x54, drawn at that size (a taller card squeezed the tile grid back to a sliver at 1440x900)');
A.ok(/addKey\('POSITION','',\(\)=>\{positionOpen=!positionOpen;renderSelection\(\);\},'refit-sel-pos'\)/.test(sel) && /if\(!positionOpen\)return;/.test(sel) && /aria-label="Object grid X"/.test(sel),
  'typing an exact tile is its own key in the grid; the X / Y fields appear only when asked');

/* ---------- 3. the editor keys ---------- */
const key = fn('onKey');
A.ok(/if \(\(selectedPropId \|\| groupIds\.length\) && tool === 'select'\) \{/.test(key), 'the editor keys act on the SELECTED object (or the selected group) only');
A.ok(/ev\.key === 'Delete' \|\| ev\.key === 'Backspace'\) \{ ev\.preventDefault\(\); deleteSelected/.test(key), 'Delete / Backspace remove it');
A.ok(/\(ev\.ctrlKey \|\| ev\.metaKey\) && \(ev\.key === 'd' \|\| ev\.key === 'D'\)\) \{ ev\.preventDefault\(\); duplicateSelected/.test(key), 'Ctrl+D duplicates it');
A.ok(/\(ev\.key === 'c' \|\| ev\.key === 'C'\)\) \{ ev\.preventDefault\(\); copySelected/.test(key) && /\(ev\.key === 'v' \|\| ev\.key === 'V'\) && lastCopy\)/.test(key), 'Ctrl+C picks it up as a stamp; Ctrl+V picks the last copy up again');
A.ok(/ArrowLeft: \[-1, 0\], ArrowRight: \[1, 0\], ArrowUp: \[0, -1\], ArrowDown: \[0, 1\]/.test(key) && /const n = ev\.shiftKey \? 5 : 1;/.test(key), 'the arrows nudge a tile (Shift: five)');
A.ok(key.indexOf("if ((selectedPropId || groupIds.length) && tool === 'select')") > 0 && key.indexOf("if ((selectedPropId || groupIds.length) && tool === 'select')") < key.indexOf("const map = { '0': 'select'"), '…before the number keys pick tools');
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

/* ---------- 5. the feel ---------- */
A.ok(/const LAND_MS = 340, LAND_RISE = 14;/.test(build) && /function landProps\(ids, stagger\)/.test(build) && /function landState\(id, now\)/.test(build),
  'a placed thing lands: dropped from a little over a tile up, 340ms');
const land = fn('landState');
A.ok(/k < 0\.62 \? -LAND_RISE \* \(1 - \(k \/ 0\.62\) \* \(k \/ 0\.62\)\)/.test(land) && /-LAND_RISE \* 0\.16 \* Math\.sin/.test(land) && /if \(k >= 1\) \{ landings\.delete\(id\); return null; \}/.test(land),
  '…it falls under gravity, settles with ONE small bounce, and is forgotten when it has landed');
A.ok(/const land = landings\.size \? landState\(p\.id, now\) : null;/.test(build) && /hoverPropId === p\.id \? -1\.5 : 0;/.test(build) && /try \{ PropSprites\.draw\(dp, true\); \} finally \{ ctx\.restore\(\); \}/.test(build),
  'the floor pass draws a landing prop in the air and a hovered one lifted a hair (and always restores the canvas)');
for (const [where, rx] of [
  ['the prop tool\'s stamp', /pushFlash\(\[\{ x1: px, y1: py, x2: px \+ s\.w - 1, y2: py \+ s\.h - 1 \}\], false\);\n\s*landProps\(\[res\.id\]\);/],
  ['COPY\'s stamp', /pushFlash\(dupeRectsAt\(w\.tx, w\.ty\), false\);\n\s*landProps\(\[res\.id\]\);/],
  ['Ctrl+D', /pushFlash\(\[\{ x1: at\.x, y1: at\.y, x2: at\.x \+ spec\.w - 1, y2: at\.y \+ spec\.h - 1 \}\], false\);\n\s*landProps\(\[res\.id\]\);/],
  ['a whole line (machine by machine, left to right)', /landProps\(\(res\.ids \|\| \[\]\)\.map\(id => station\.propById\(id\)\)\.filter\(Boolean\)\.sort\(\(a, b\) => a\.x - b\.x \|\| a\.y - b\.y\)\.map\(p => p\.id\), 70\);/],
  ['a dragged move', /if\(moved && moved\.ok\)\{selectedPropId=d\.propId;renderSelection\(\);landProps\(\[d\.propId\]\);\}/],
]) A.ok(rx.test(build), 'lands: ' + where);
A.ok(/vanishProp\(was\); flashUndo\(\);/.test(build) && /vanishProp\(was\); \}/.test(fn('deleteSelected')), 'the DELETE tool and Delete on a selection dissolve what they remove');
const dv = fn('drawVanishing');
A.ok(/cut = top \+ \(bot - top\) \* k;/.test(dv) && /ctx\.clip\(\);/.test(dv) && /ctx\.globalAlpha = Math\.max\(0, 1 - k \* 1\.15\);/.test(dv) && /vanishing\.splice\(i, 1\)/.test(dv),
  '…a cut line sweeps down through it and it fades behind the cut, then is gone');
A.ok(/drawVanishing\(now\);\n  \}/.test(build), '…drawn after the floor\'s props, every frame it lasts');
A.ok(/SFX\.voice\(\{ freq: 140, glide: 62,/.test(fn('sfxLand')) && /SFX\.noise\(\{ dur: 0\.26,/.test(fn('sfxVanish')) && /!SFX\.ctx\) return;/.test(fn('sfxLand')) && /!SFX\.ctx\) return;/.test(fn('sfxVanish')),
  'a low thunk to land, a falling hiss to dissolve — the station\'s own synth, silent until audio is unlocked');
const feelBlock = build.slice(build.indexOf('THINGS LAND, THINGS DISSOLVE'), build.indexOf('function drawFlashes('));
A.ok(feelBlock.length > 0 && !/confetti|particle|sparkle/i.test(feelBlock.replace(/no particles, no confetti/, '')), 'eerie, not cute: no particles, no confetti');
A.ok(/feel: \(\) => \(\{ landing: \[\.\.\.landings\.keys\(\)\], vanishing: vanishing\.length, selected: selectedPropId \}\)/.test(build), 'CDP proof can read what is landing / dissolving mid-animation');

/* ---------- 6. many at once ---------- */
const down = fn('onDown');
A.ok(/if \(p && groupIds\.includes\(p\.id\)\) \{ drag=\{mode:'grouppress',propId:p\.id,start:w,cur:w,moved:false,add:ev\.shiftKey\};return; \}/.test(down)
  && /if \(p\) \{ drag=\{mode:'selectpress',propId:p\.id,start:w,cur:w,moved:false,add:ev\.shiftKey\};return; \}/.test(down),
  'pressing a member of the group grabs the group; pressing anything else grabs just it (Shift remembered)');
A.ok(/drag = \{ mode: 'boxpress', start: w, cur: w, moved: false, add: ev\.shiftKey, roomId: station\.roomAt\(w\.tx, w\.ty\) \};/.test(down) && !/openRoomCard\(/.test(down),
  'a press on empty floor can become a box — the room card waits for the release, never opens on the press');
A.ok(/if\(drag\.mode==='grouppress'&&drag\.moved\)drag\.mode='groupmove';/.test(build) && /if\(drag\.mode==='boxpress'&&drag\.moved\)drag\.mode='box';/.test(build), '…a press that moves becomes a group drag or a box');
const up = fn('onUp');
A.ok(/if \(d\.mode === 'selectpress' \|\| d\.mode === 'grouppress'\) return d\.add \? toggleInSelection\(d\.propId\) : onInspect\(/.test(up)
  && /if \(d\.mode === 'groupmove'\) return commitGroupMove\(d, ev\);/.test(up) && /if \(d\.mode === 'boxpress'\) return clickEmptyFloor\(d, ev\);/.test(up) && /if \(d\.mode === 'box'\) return commitBox\(d, ev\);/.test(up),
  'releases: Shift+click toggles, a click inspects one, a group drag commits, a box selects, a plain floor click lets go');
A.ok(/if \(!d\.add && selectionIds\(\)\.length\) \{ setSelection\(\[\]\); sfx\('click'\); return; \}\n    if \(d\.roomId\) openRoomCard\(d\.roomId, ev\);/.test(fn('clickEmptyFloor')),
  'a plain click on empty floor lets go of a selection first; with nothing selected the room still opens its card');
A.ok(/rectsMeet\(propRect\(p\), r\)/.test(fn('propsInBox')) && /setSelection\(d\.add \? selectionIds\(\)\.concat\(ids\) : ids\);/.test(fn('commitBox')),
  'the box takes everything it TOUCHES; Shift adds to what was already selected');
A.ok(/groupIds = live\.length > 1 \? live : \[\];/.test(fn('setSelection')) && /selectedPropId = live\.length === 1 \? live\[0\] : null;/.test(fn('setSelection')),
  'one is a selection, two or more a group (never both)');
A.ok(/groupIds=\[\];selectedPropId=p\.id;renderSelection\(\);/.test(fn('onInspect')) && /movingPropId=null;selectedPropId=null;groupIds=\[\];renderSelection\(\);/.test(build),
  'inspecting one thing, or arming any tool, lets go of the group');
const mg = fn('moveGroupBy');
A.ok(/return station\.transact\(\(\) => \{/.test(mg) && /sort\(\(a, b\) => \(b\.x \* dx \+ b\.y \* dy\) - \(a\.x \* dx \+ a\.y \* dy\)\)/.test(mg)
  && /if \(next\.length === pending\.length\) return last/.test(mg) && /error: 'LINK_LOST'/.test(mg),
  'a group moves as ONE transact: front-first, members wait for each other, and a stuck member or a lost belt link puts it all back');
A.ok(/!ids\.has\(q\.id\) && !propSpec\(q\.t\)\.flat && rectsMeet\(propRect\(q\), to\)/.test(fn('groupFit')), 'the drag ghost counts only things OUTSIDE the group as in the way');
A.ok(/const fit = groupFit\(/.test(fn('refusalOf')) && /refusalOf\(res, ids, dx, dy\)/.test(fn('commitGroupMove')) && /refusalOf\(res, ids, dx, dy\)\.msg/.test(fn('nudgeGroup')),
  'a refused group move names what is in the way, as the ghost did');
const dg = fn('deleteGroup');
A.ok(/station\.transact\(\(\) => \{ for \(const p of was\) \{ const r = station\.removeProp\(p\.id\);/.test(dg) && /was\.forEach\(p => vanishProp\(p\)\)/.test(dg),
  'Delete removes the whole group in one transact (one UNDO), and every member dissolves');
A.ok(/if \(n - lastVanishSfx < 80\) return;/.test(fn('sfxVanish')), '…on one hiss, not a hiss per member');
const dup2 = fn('duplicateGroup');
A.ok(/tries\.push\(\[W \+ gap, 0\], \[0, H \+ gap\], \[-\(W \+ gap\), 0\], \[0, -\(H \+ gap\)\]\)/.test(dup2) && /const res = station\.transact\(/.test(dup2)
  && /sort\(\(a, b\) => onTable\(a\) - onTable\(b\)\)/.test(dup2) && /setSelection\(made\);/.test(dup2) && /copySpecOf\(p\)/.test(dup2),
  'Ctrl+D lays the whole arrangement again beside itself (one transact, tables before what stands on them), and the copies become the selection');
for (const fname of ['deleteSelected', 'duplicateSelected', 'nudgeSelected']) A.ok(/if \(groupIds\.length\) return /.test(fn(fname)), fname + ' speaks for the group when there is one');
A.ok(/COPY holds one thing at a time/.test(fn('copySelected')), 'Ctrl+C on a group says COPY holds one thing and points at Ctrl+D');
const gc = fn('renderGroupCard');
A.ok(/key\('MOVE', 'drag'/.test(gc) && /key\('DUPLICATE', 'Ctrl\+D'/.test(gc) && /key\('DELETE', 'Del'/.test(gc) && /ps\.slice\(0, 3\)\.forEach\(p => propArtInto\(art, p\)\)/.test(gc),
  'the group card: up to three of them in the art well, then MOVE / DUPLICATE / DELETE wearing their keys');
A.ok(/\(ev\.key === 'a' \|\| ev\.key === 'A'\) && tool === 'select'\) \{ ev\.preventDefault\(\); selectAllProps/.test(key), 'Ctrl+A takes the whole floor');
A.ok(/if \(selectedPropId \|\| movingPropId \|\| groupIds\.length\) \{ selectTool\('select'\); return; \}/.test(key), 'Esc lets go of a group');
A.ok(/for\(const id of groupIds\)\{const gp=station\.propById\(id\);if\(gp\)drawPropSelection\(gp,t,'rgba\(244,200,112,\.9\)',false\);\}/.test(fn('drawHover')), 'every member wears the selection gold');
A.ok(/if \(drag && drag\.mode === 'box'\) \{ drawSelectBox\(t\); return; \}/.test(build) && /if \(g\.group\) \{ drawGroupGhost\(t, now, g\); return; \}/.test(build), 'the box and a group drag each draw their own ghost');
A.ok(/RELEASE TO SELECT/.test(fn('drawSelectBox')) && /' THINGS'\]/.test(fn('drawGroupGhost')), '…the box says how many it will take; the group ghost says how far and how many');
A.ok(/groupmove: 1 \}/.test(build), 'a group drag ticks tile by tile like any move');
A.ok(/<span><b>Drag a box<\/b> Select several<\/span>/.test(build), 'HELP teaches the box');
A.ok(/selection: \(\) => selectionIds\(\),/.test(build), 'CDP proof can read the selection');

A.report('build-mode-easy.test');
