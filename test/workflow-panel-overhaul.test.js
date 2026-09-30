/* test/workflow-panel-overhaul.test.js — THE WORKFLOW PANEL, OVERHAULED (Andrew, 2026-09-30: "an atrocious UX disaster. tiny
   text, doesnt … match the new gorgeous buttons and new style … the crate is ugly … easy to use, simplified, and the system
   viewer or wireframe view should look better as well … a UX overhaul clean experience consistent with the rest of starnet").

   What that became, locked here so it cannot drift back:
     · READABLE — the panel speaks at the station's size: 17px body, nothing a Commander reads under 14px, and the pieces it
       borrows from other cards (trigger rows, the add forms, the WHEN picker) are restated on that scale;
     · ONE MATERIAL — the Build Library's glass keys (8px, 36px tall), matte: no glow anywhere in the sheet;
     · SIMPLER — the header says each thing once (a cost only once a step was really tested; no hint repeating the
       sentence), and the INBOX card is one block per way to start the line, its add key on the block's own row;
     · THE MAP — the line diagram shows every part as the machine it is (its own floor art), the + sits on the belt, and a
       one-row diagram stays pinned at the top while the picked part's editor scrolls under it;
     · THE FLOOR — a caption is a plate (the ride's, the paused hand-off's, the projection's), set at a reading size on
       screen and kept on the visible glass; what waits at a paused hand-off is the same crate that rides the belts.
   (The crate's own art is locked in test/conveyor.test.js.) */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', 'frontend', f), 'utf8').replace(/\r\n/g, '\n');
const css = rd('css/workflow-panel.css'), panel = rd('app/workflowpanel.js'), build = rd('app/build.js'), ghost = rd('app/ghostline.js'), world = rd('app/world.js');
const at = (src, from, to) => { const a = src.indexOf(from); return a < 0 ? '' : src.slice(a, to ? src.indexOf(to, a) : a + 4000); };
// every rule block the exact selector opens (a selector may have more than one), joined as text
const rule = sel => { const out = []; let i = -1; while ((i = css.indexOf('\n' + sel + ' {', i + 1)) >= 0) out.push(css.slice(i + 1, css.indexOf('}', i) + 1)); return out.join('\n'); };
const sizeIn = block => { const m = /font-size:\s*([0-9.]+)px/.exec(block); return m ? +m[1] : null; };

/* ---------- readable ---------- */
const sizes = (css.match(/font-size:\s*[0-9.]+px/g) || []).map(s => +/([0-9.]+)px/.exec(s)[1]);
A.ok(sizes.length > 40 && Math.min.apply(null, sizes) >= 14, 'nothing in the panel is set under 14px (smallest: ' + Math.min.apply(null, sizes) + 'px)');
A.eq(sizeIn(rule('.wf-panel')), 17, 'the panel reads at the station\'s size: 17px');
A.ok(sizeIn(rule('.wf-sentence')) >= 17 && sizeIn(rule('.wf-help')) >= 17, 'the how-it-runs sentence and every help line read at 17px or more');
for (const [sel, min] of [['.wf-panel .trg-row', 16], ['.wf-panel .trg-row-meta', 15], ['.wf-panel .trg-form-k', 15], ['.wf-panel :is(.refit-input,.refit-brief)', 17],
  ['.wf-panel .trg-preview', 15], ['.wf-panel :is(.sp-mode,.sp-unit)', 16], ['.wf-panel .sp-day', 16], ['.wf-panel :is(.sp-lbl,.sp-tz,.sp-hint,.sp-note)', 15], ['.wf-panel .sp .sp-num', 16]]) {
  const n = sizeIn(rule(sel));
  A.ok(n != null && n >= min, sel + ' (a piece borrowed from another card) is restated on the panel\'s scale: ' + min + 'px or more (it is ' + n + 'px)');
}

/* ---------- one material: the Build Library's glass keys, matte ---------- */
const bb = rule('.wf-panel .bb');
A.ok(/min-height:\s*36px/.test(bb) && /border-radius:\s*8px/.test(bb) && /background:\s*var\(--refit-glass/.test(bb) && /border:\s*1px solid var\(--wf-edge\)/.test(bb), 'every key in the panel is the Build Library\'s glass key: 36px tall, 8px, one hairline');
A.ok(!/--ph-glow/.test(css) && !(css.match(/text-shadow:\s*[^;]+/g) || []).some(s => !/text-shadow:\s*none/.test(s)), 'matte: no phosphor glow and no text-shadow anywhere in the sheet');
const chip = rule('.wf-chip');
A.ok(/min-height:\s*34px/.test(chip) && /border-radius:\s*8px/.test(chip) && sizeIn(chip) >= 16, 'a chip is a key too (34px, 8px, 16px type)');

/* ---------- simpler: the header says each thing once ---------- */
const head = at(panel, '  function paintHead(f) {', '  /* ---------- the flow strip');
A.ok(/\$\('#wf-est'\)\.textContent = est && est\.tested \? est\.text : '';/.test(head), 'a cost is shown only once a step was really tested (never an instruction in its place)');
A.ok(/r\.hints\.filter\(h => !\/\^nothing starts it\/\.test\(h\.what\)\)/.test(head) && /hints\.hidden = !tips\.length;/.test(head), 'no hint repeats what the sentence already says about what starts the line; no hints, no row');
A.ok(/\(i === 0 && intake\) \? '<span class="wf-st" data-go="' \+ esc\(intake\.id\) \+ '">'/.test(head), 'the sentence\'s first clause (what starts the line) opens the INBOX');
A.ok(/'WORKFLOW · ' \+ nSteps \+ ' STEP' \+ \(nSteps === 1 \? '' : 'S'\);/.test(head), 'the kicker says what this is and how long, nothing else');

/* ---------- simpler: the INBOX card is one block per way to start the line ---------- */
const trig = at(panel, '  function paintTrigger(body, f, p) {', '  /* WORKING FOLDER');
A.ok(/startHead\('A schedule', !S\.cron \? 'reading…' : routines\.length \? '' : 'none yet', 'rt',/.test(trig) && /startHead\('A channel message', !S\.chans \? 'checking…' : tr\.chanRows\.length \? '' : 'none connected', 'ch',/.test(trig),
  'a schedule and a channel are blocks whose header says what they have and carries their add key');
const lts = at(panel, '  function ltSectionHtml() {', '  const ltSay');
A.ok(/startHead\('A file lands in a folder', ltNote\('folder'\), 'fo',/.test(lts) && /startHead\('A webhook is called', ltNote\('webhook'\), 'wh',/.test(lts), '…and so are a watched folder and a webhook');
A.ok(/\(hooked \? '<p class="wf-help dim">A webhook address lives on this computer/.test(lts), 'where a webhook can be reached from is said where a webhook IS (one on the line, or one being made)');
A.ok(/return S\.lt \? ltMine\(\)\.filter\(t => t\.kind === kind\)\.map\(ltRowHtml\)\.join\(''\) : '';/.test(panel), 'an empty list shows nothing: its block\'s header says "none yet"');
A.ok(/noteEl\.textContent = ltNote\(rowKind\);/.test(at(panel, '  function ltPatch() {', '  // the one thing that moves')), '…and the 5 s re-read keeps that header note true');
A.ok(/const startHead = \(name, note, id, keys\) => '<div class="wf-start"><div class="wf-start-h"><h4>' \+ name \+ '<\/h4><span class="wf-start-n" id="wf-start-n-' \+ id \+ '">' \+ esc\(note\) \+ '<\/span>'/.test(panel), 'one builder makes every block\'s header row');
A.ok(/display:\s*flex/.test(rule('.wf-start-h')) && /border-radius:\s*10px/.test(rule('.wf-start')) && /\.wf-start \.trg-list:empty \{ display: none; \}/.test(css), 'a block is a glass card with its header on one row; an empty list takes no room');

/* ---------- the map: real machines, the + on the belt, pinned ---------- */
A.ok(/<div class="wf-strip-wrap" id="wf-map">/.test(panel), 'the diagram\'s well is the panel\'s map');
A.ok(/const mthumb = t => \{ const u = \(t && H\.machineStill\) \? H\.machineStill\(t\) : '';/.test(panel) && /<img class="wf-mthumb" src="' \+ u \+ '" alt="" aria-hidden="true" draggable="false">/.test(panel), 'a part\'s card leads with the machine\'s own floor art (no art: the name alone)');
const node = at(panel, '  function nodeHTML(n, f) {', '  function drawArcs(');
A.ok(/partHead\(n\.propId \? n\.mach : null, n\.k, dot\(n\.ok\), n\.t\)/.test(node) && /partHead\(g\.kind === 'loop' \? 'loop' : 'joiner',/.test(node) && /partHead\('bay', 'BAY ' \+ i, dot\(ok\), esc\(d\.role \|\| 'STEP'\)\)/.test(node),
  'the INBOX, every BAY, a gate and the OUTBOX are all shown as their machine, with their lamp');
A.ok(/mach: 'intake'/.test(panel) && /mach: 'outbox'/.test(panel), 'the INBOX and OUTBOX cards name their machines');
A.ok(/machineStill: type => machineStill\(type\)/.test(build), 'the Build host offers a machine\'s art to the panel');
const still = at(build, '  function machineStill(type) {', '  function setLibraryPlacement(');
A.ok(/PropSprites\.draw\(\{ t: c\.id, x: 0, y: 0, w: c\.w, h: c\.h \}, true\)/.test(still) && /off\.toDataURL\('image\/png'\)/.test(still), '…drawn by the same sprite the floor draws, kept as a still');
A.ok(/if \(had && had\.rev === rev\) return had\.url;/.test(still) && /machineStills\[key\] = \{ rev, url \};/.test(still), '…one per machine, made again when the authored art finishes loading');
A.ok(/finally \{ if \(ctx\) PropSprites\.setCtx\(ctx\); \}/.test(still), '…and the sprite module\'s draw context goes back to the floor\'s canvas');
A.ok(/grid-template-columns:\s*36px minmax\(0,1fr\)/.test(rule('.wf-node .hd.art')) && /width:\s*36px;\s*height:\s*36px/.test(rule('.wf-node .wf-mthumb')), 'the art sits beside the part\'s name at 36px');
A.ok(/\.wf-belt :is\(\.rail,\.wf-plus\) \{ grid-row: 2; grid-column: 1; \}/.test(css), 'the + sits ON its belt');
A.ok(/overflow-wrap:\s*break-word/.test(rule('.wf-belt .carry')) && /max-width:\s*112px/.test(rule('.wf-belt')), 'what a belt carries wraps between words, never inside one');
A.ok(/\.wf-strip-wrap\.pin \{ position: sticky; top: 0; z-index: 3; \}/.test(css), 'a pinned map holds the top of the scroll');
A.ok(/var\(--panel2\)/.test(rule('.wf-strip-wrap')), '…over an opaque well (the panel\'s own sheet is translucent: text scrolling under it would show through)');
A.ok(/strip\.parentNode\.classList\.toggle\('pin', !nodes\.some\(n => n\.kind === 'col' && n\.col\.docks\.length > 1\)\);/.test(panel), 'only a one-row diagram is pinned (stacked branches would hold too much of the panel)');
A.ok(/function toCard\(always\) \{\s*const sc = \$\('#wf-scroll'\), head = \$\('#wf-head'\);\s*if \(sc && head && \(always \|\| sc\.scrollTop > head\.offsetHeight\)\) sc\.scrollTop = head\.offsetHeight;\s*\}/.test(panel), 'toCard brings the view back so the map sits at the top with the card under it');
A.ok(/S\.sel = propId; S\.insertAt = null; S\.view = 'edit';\s*paint\(true\);\s*toCard\(\);/.test(panel), 'picking a part brings its card under the map');
A.ok(/if \(newLine\) \{ const sc = \$\('#wf-scroll'\); if \(sc\) sc\.scrollTop = 0; \} else toCard\(\);/.test(panel), 'a floor click does too; a new line starts at its top');
A.ok(/paintStrip\(flow\(\)\); if \(S\.insertAt != null\) toCard\(\);/.test(panel) && /S\.view = 'edit'; paint\(true\); toCard\(\);/.test(panel), 'the + inserter and SETUP open in view');
A.ok((panel.match(/S\.view = 'test'; paint\(true\); toCard\(true\);/g) || []).length === 2, 'TEST (the footer key and the top bar\'s) always opens with the map at the top: its modes and RUN key are not pushed under the fold');

/* ---------- the floor: captions are plates ---------- */
const notes = at(build, '  function drawTestNotes(now, t) {', '  /* A FLOOR CAPTION IS A PLATE');
A.ok(/captionBox\(n\.text, \(n\.x \+ 0\.5\) \* t, n\.y \* t - 5 \/ zoom - rise\)/.test(notes) && /captionPlate\(c, n\.text, box, n\.col, alpha\)/.test(notes) && !/shadowBlur/.test(notes), 'a ride caption is a plate over its tile: no bare glowing text');
A.ok(/const alpha = k < 0\.12 \? k \/ 0\.12 : k > 0\.75 \? \(1 - k\) \/ 0\.25 : 1;/.test(notes), '…fully lit while it is read, fading only at the end');
const cap = at(build, '  /* A FLOOR CAPTION IS A PLATE', '  /* ---------- FINISH THE LINE');
A.ok(/const capFs = \(\) => 17 \* \(dpr \|\| 1\) \* \(\(typeof U !== 'undefined' && U\.uiZoom && U\.uiZoom\(\)\) \|\| 1\) \/ zoom;/.test(cap), 'a caption is set at a reading size ON SCREEN (17px, by pixel ratio and TEXT SIZE), whatever the camera zoom');
A.ok(/function captionFit\(box\)/.test(cap) && /const left = \(ins\.l - panX\) \/ zoom \+ m, right = \(cv\.width - \(ins\.r \|\| 0\) - panX\) \/ zoom - m;/.test(cap), '…and kept on the visible glass (never under the Build Library or the docked panel)');
A.ok(/c\.fillStyle = 'rgba\(4,6,8,0\.86\)'; c\.fillRect\(box\.x, box\.y, box\.w, box\.h\);/.test(cap) && /c\.strokeRect\(/.test(cap) && !/shadowBlur/.test(cap), 'the plate is the gesture badge\'s: a dark field, a hairline in the caption\'s colour, plain text');
const marks = at(build, '  function drawWorkflowMarks(t, now) {', '  /* ---------- WORKSTATION agent-picker');
A.ok(/Conveyor\.drawCrate\(ctx, Math\.round\(x \+ t \/ 2\), Math\.round\(y \+ t \/ 2\) \+ 1, 'product'\)/.test(marks), 'what waits at a paused hand-off is the same crate that rides the belts');
A.ok(/captionPlate\(c, label, box, '#5fd8ff'\)/.test(marks) && !/shadowBlur/.test(marks), '…and its label is a plate');
A.ok(/ghost\.draw\(ctx, now, t, capFs\(\), \(box, paint\) => voiceSay\('ghostCaption', box, box, paint\), captionFit\);/.test(build), 'the projection\'s captions take the same size and stay on the glass');
const gdraw = at(ghost, '    function draw(ctx, nowMs, T, fontPx, say, fit) {', '    function reset()');
A.ok(/ctx\.fillStyle = 'rgba\(4,6,8,0\.86\)'; ctx\.fillRect\(b\.x, b\.y, b\.w, b\.h\);/.test(gdraw) && /ctx\.setLineDash\(\[3 \* px1, 2 \* px1\]\)/.test(gdraw) && !/shadowBlur/.test(ghost), 'a WOULD-caption is a plate edged with a DASHED hairline (dashed = projected), with no glow');
A.ok(/return \(fit && fit\(b\)\) \|\| b;/.test(gdraw), '…placed by the caller\'s fit when it gives one');
A.ok(/k < 0\.12 \? k \/ 0\.12 : k > 0\.75 \? \(1 - k\) \/ 0\.25 : 1/.test(gdraw), '…and lit while it is read');
const wait = at(world, '  function drawWaitCrate(cx, cy) {', '  /* SHIPPED TODAY'), ship = at(world, '  function drawShipCrate(cx, cy, pop) {', '  // E2 verification hooks');
A.ok(/Conveyor\.drawCrate\(ctx, Math\.round\(cx\), Math\.round\(cy\), 'ore'\)/.test(wait) && /Conveyor\.drawCrate\(ctx, x, y, 'product'\)/.test(ship), 'the INBOX\'s waiting jam and the OUTBOX\'s shipped pallet park the same crate');

A.report('workflow-panel-overhaul.test');
