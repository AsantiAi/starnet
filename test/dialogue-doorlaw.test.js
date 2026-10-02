/* test/dialogue-doorlaw.test.js — THE DOOR LAW reaches the awakening and the quick tour (sweep 2026-10-02).

   On a fresh station the dock grows with use (systems.js): AUTOMATE and CONNECT start hidden. A line that names a system brings it
   online — but only COMMS lines did. The awakening ("its line is waiting for a crew: WORK › AUTOMATE › WORKFLOWS …") and the quick
   tour ("open WORK › AUTOMATE › WORKFLOWS", "BUILD › CONNECT › ABILITIES") speak through Dialogue.say / Dialogue.node, so they sent a
   brand-new Commander to a dock button that was not there. Dialogue now applies the door law to every line it speaks. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const store = new Map();
const ctx = vm.createContext({ console, module: { exports: {} }, localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) } });
vm.runInContext(rd('frontend/app/systems.js'), ctx, { filename: 'systems.js' });
const Systems = ctx.module.exports;
Systems.init({ epoch: 'fresh-1', fresh: true, crewCount: () => 1 });
A.ok(Systems.staged() && !Systems.isOnline('automate') && !Systems.isOnline('connect'), 'fixture: a fresh station starts with AUTOMATE and CONNECT hidden');

// the exact lines the awakening and the tour speak
const onb = rd('frontend/app/onboarding.js'), tut = rd('frontend/app/tutorial.js');
const built = 'done. the software studio is built, and its line is waiting for a crew: WORK › AUTOMATE › WORKFLOWS walks you through who works each step.';
A.ok(onb.indexOf("its line is waiting for a crew: WORK › AUTOMATE › WORKFLOWS walks you through who works each step.") >= 0, 'fixture: the awakening still says it');
A.ok(/WORK › AUTOMATE › WORKFLOWS/.test(tut) && /BUILD › CONNECT › ABILITIES/.test(tut), 'fixture: the tour still names both');
Systems.noticeReply(built);
A.ok(Systems.isOnline('automate'), 'the awakening line brings AUTOMATE online, so the button it names is there');
Systems.noticeReply('An ability is missing. Open BUILD › CONNECT › ABILITIES to equip it.');
A.ok(Systems.isOnline('connect'), 'the tour line naming ABILITIES brings CONNECT online');

// Dialogue speaks every say() and node() line (and a node's option labels) through the door law
const dlg = rd('frontend/app/dialogue.js');
A.ok(/function doorLaw\(segs, extra\) \{[\s\S]{0,200}Systems\.noticeReply\(segs\.map\(x => x\.text\)\.concat\(extra \|\| \[\]\)\.join\(' '\)\)/.test(dlg), 'doorLaw hands the spoken text to Systems.noticeReply');
A.ok(/const segs = norm\(lines\); doorLaw\(segs\);\s*\n\s*typeInto\(segs,/.test(dlg), 'say() applies it to every line');
A.ok(/const segs = norm\(cfg\.lines\); doorLaw\(segs, \(cfg\.options \|\| \[\]\)\.map\(/.test(dlg), 'node() applies it to its lines and options');
// and it still loads under node (the naming primitives other tests use)
const { Dialogue } = require('../frontend/app/dialogue.js');
A.ok(typeof Dialogue.say === 'function' && typeof Dialogue.node === 'function', 'dialogue.js still loads');

A.report('dialogue-doorlaw.test');
