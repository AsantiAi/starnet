/* node test/front-doors-tabs.test.js — the one-menu tab strip never throws away unsaved work (sweep 2026-10-02):
   · the lit tab again is a no-op (RECIPES used to close + reopen and drop a recipe in progress);
   · a tab in the SAME window (AUTOMATE's SCHEDULES / GOAL LOOPS / AWAY WORK) meets the unsaved guard (a half-typed
     schedule vanished);
   · the second click on an armed guard switches tabs (it used to close the whole menu);
   · BRIEF's SEE FULL ACCESS opens CONFIG at the ACCESS group (it landed on six folded groups). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const ui = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'stationui.js'), 'utf8');

const sw = ui.slice(ui.indexOf('function switchFamilyTab('), ui.indexOf('function swapInPlace('));
A.ok(sw.length > 0, 'switchFamilyTab exists');
A.ok(/const lit = familyActiveTab\(famId, fromKey\);\s*if \(tab\.k === fromKey && lit && lit\.id === tab\.id\) return;/.test(sw), 'the lit tab again does nothing');
const guard = sw.indexOf("if (w && windowDirty(w) && !w._closeArmed) { requestCloseTerm(fromKey); return; }");
A.ok(guard > 0, 'a dirty window arms the guard on the first click and never closes on it');
A.ok(guard < sw.indexOf("if (tab.k === fromKey) { openFamilyTab(famId, tab); return; }"), 'the guard also covers a tab in the same window');
A.ok(guard < sw.indexOf('swapInPlace(fromKey'), 'and a tab in another window');
A.ok(!/if \(w && windowDirty\(w\)\) \{ requestCloseTerm\(fromKey\); return; \}/.test(sw), 'an armed second click is not routed to close the menu');
// requestCloseTerm arms (never closes) a dirty, un-armed window: the guard's first click is safe
const rc = ui.slice(ui.indexOf('function requestCloseTerm('), ui.indexOf('function requestCloseTerm(') + 400);
A.ok(/if \(w\._closeArmed \|\| !windowDirty\(w\)\) \{ closeTerm\(key\); return; \}/.test(rc), 'requestCloseTerm closes only an armed or clean window');

A.ok(/\[data-access-full\]'\)\.onclick = \(\) => \{ cfOpen\.set\(a\.id \+ ':cf-grp-behaves', true\); consoleSection\['agents'\] = 'config';/.test(ui), 'SEE FULL ACCESS opens the ACCESS group');
A.ok(/\{ id: 'cf-grp-behaves', label: 'ACCESS' \}/.test(ui) && /const key = a\.id \+ ':' \+ g\.id;[\s\S]{0,200}cfOpen\.get\(key\) \? ' open'/.test(ui), 'the ACCESS group reads its open state from cfOpen by agent + group id');

A.report('front-doors-tabs');
