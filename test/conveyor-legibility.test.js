/* test/conveyor-legibility.test.js — the conveyor pieces explain themselves (2026-09-27 first-run audit, lane 2).

   A first-time builder could not find the conveyors, was told three different things about what belts are, could not
   tell the five 1×1 junctions apart, and could not see whether a SPLITTER copies a job to every branch or makes the
   branches take turns (a JOINER somewhere downstream decides). Locked here, read from the shipped sources:
     F1 — WORK › WORKFLOWS opens the conveyor builder (Build.openWorkflows), and REFIT's subtitle names workflow lines;
     F2 — one account of belts everywhere: belts ARE the workflow (no "optional", no "to watch", no "no belts required");
     P1 — the splitter's mode is said where the Commander looks: its Workflow panel section, its hover card, its tag;
     P2 — every machine on the shelf carries a wiring diagram, and the shelf is grouped the way work meets it;
     P3 — JOINER and MERGER are named by outcome (waits + combines vs shares a belt, combines nothing);
     P4 — the FILTER says its real scope (code / research / everything else) and is edited in the docked panel. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const build = read('frontend/app/build.js'), panel = read('frontend/app/workflowpanel.js'), html = read('frontend/index.html');
const app = read('frontend/app/app.js'), tutorial = read('frontend/app/tutorial.js'), props = read('frontend/app/propsprites.js');
const Glossary = require('../frontend/app/glossary.js');
const PropSprites = require('../frontend/app/propsprites.js');

/* F1 — a door named for the job */
const workMenu = html.slice(html.indexOf('data-group="work"'), html.indexOf('data-group="build"'));
A.ok(/id="bb-workflows"[^>]*>[\s\S]{0,80}<b>WORKFLOWS<\/b>/.test(workMenu), 'WORK menu has a WORKFLOWS entry');
A.ok(/bbWorkflows\.onclick = [^\n]*Build\.openWorkflows\(\)/.test(app), 'WORKFLOWS opens the conveyor builder');
A.ok(/const api = \{ init, open, openWorkflows,/.test(build), 'Build exports openWorkflows');
const ow = build.slice(build.indexOf('function openWorkflows()'), build.indexOf('const api = {'));
A.ok(/pendingGroup = 'workflow'/.test(ow) && /rebake\(\)/.test(ow) && /openFlowCard\(first\.id\)/.test(ow), 'it opens on the Conveyors tab, compiles, and docks the line’s panel');
A.ok(/<b>REFIT STATION<\/b><small>[^<]*workflow lines<\/small>/.test(html), 'REFIT STATION’s subtitle names workflow lines');
A.ok(/workflow:\s/.test(read('frontend/app/glossary.js')) && Glossary.has('workflow') && /INBOX[\s\S]*BAY[\s\S]*OUTBOX/.test(Glossary.lookup('workflow')), 'the glossary explains a workflow in the order work meets it');

/* F2 — one account of belts */
for (const [where, src] of [['tutorial', tutorial], ['catalog', props]]) {
  A.ok(!/Conveyors are optional/.test(src), where + ' never calls conveyors optional');
  A.ok(!/no belts required/.test(src) && !/the inbox is for watching/.test(src), where + ' never calls belts decoration');
}
const cat = id => PropSprites.CATALOG.find(c => c.id === id);
A.ok(/Belts ARE the workflow/.test(cat('intake').desc), 'the INBOX card says belts are the workflow');
A.ok(/one step of a workflow/.test(cat('bay').desc), 'the BAY card calls a bay one step of a workflow');

/* P1 — the splitter says its mode */
const plain = panel.slice(panel.indexOf('  function paintPlain(body, f, p) {'), panel.indexOf('  function paintFilter('));
A.ok(/cfg\.fanout/.test(plain) && /Every branch gets a copy/.test(plain) && /Branches take turns/.test(plain), 'the splitter’s panel section reads the compiled mode and names it');
// (2026-09-28: switching is now a button pair — COPY TO EACH / TAKE TURNS — that swaps the JOINER/MERGER; conveyor-choices.test.js)
A.ok(/pick\('copy', 'COPY TO EACH'/.test(plain) && /pick\('turns', 'TAKE TURNS'/.test(plain) && /Switching swaps the JOINER or MERGER where the branches meet/.test(plain), '…and switching it is one click, which says what it does');
A.ok(/Every branch gets a copy: a JOINER follows the branches\./.test(build) && /Jobs take turns between the branches/.test(build), 'the splitter’s hover card says its live mode');
A.ok(/SPLITTER · COPY TO EACH/.test(build) && /SPLITTER · TAKES TURNS/.test(build), 'the splitter’s floor tag says its live mode');
A.ok(/p\.id !== hoverPropId && p\.id !== selectedPropId/.test(build), 'junction tags speak only for the hovered or selected junction (one voice, no wall of text)');
A.ok(/junctionTag: 0\.5/.test(build), 'the tag is the lowest voice in the arbiter');
A.ok(/onAdvance\(bx, \{ kind: 'split', tile: \{ x, y \}, lane: dir, fanout: !!jt\.fanout \}\)/.test(read('frontend/app/conveyor.js')), 'the belt sim reports each split with its mode');

/* P2 — the shelf draws each machine's wiring, grouped */
const diagramKeys = (build.slice(build.indexOf('const MACHINE_DIAGRAM = {'), build.indexOf('const machineDiagramSVG')).match(/\n\s+([a-z]+): '/g) || []).map(s => s.trim().replace(/: '$/, ''));
const machines = PropSprites.CATALOG.filter(c => c.cat === 'workflow').map(c => c.id);
A.ok(machines.length >= 8, 'the catalog lists the workflow machines');
for (const id of machines) A.ok(diagramKeys.indexOf(id) >= 0, 'the shelf draws a wiring diagram for ' + id);
const groups = build.slice(build.indexOf('const MACHINE_GROUPS = ['), build.indexOf('];', build.indexOf('const MACHINE_GROUPS = [')));
for (const id of machines) A.ok(groups.indexOf("'" + id + "'") >= 0, id + ' sits in a named shelf group');
A.ok(/b\.insertAdjacentHTML\('beforeend', machineDiagramSVG\(c\.id\)\)/.test(build), 'each shelf tile carries its diagram');

/* P3 — outcome names */
const purpose = build.slice(build.indexOf('const PALETTE_PURPOSE = {'), build.indexOf('};', build.indexOf('const PALETTE_PURPOSE = {')));
A.ok(/joiner: 'waits until every branch has finished, then sends ONE combined result on'/.test(purpose), 'JOINER: waits, one combined result');
A.ok(/merger: '[^']*nothing waits and nothing is combined/.test(purpose), 'MERGER: nothing waits, nothing combined');
A.ok(/use a JOINER instead/.test(cat('merger').desc), 'the MERGER card points at the JOINER for combining');

/* P4 — the filter's honest scope, edited in the panel */
A.ok(/filter: 'sorts by task type \(code, research or everything else\)/.test(purpose), 'the FILTER shelf line names its three types');
A.ok(/CODE, RESEARCH, or EVERYTHING ELSE/.test(cat('filter').desc), 'the FILTER card names its three types');
A.ok(/if \(t === 'filter'\) return typeof WorkflowPanel !== 'undefined' \? openFlowCard\(p\.id\)/.test(build), 'a FILTER opens the docked panel (the modal is only a fallback)');
const pf = panel.slice(panel.indexOf('  function paintFilter('), panel.indexOf('/* ===== THE STEP TEST'));
A.ok(/configureJunction\(p\.id, \{ routes: cur\.routes, def: cur\.def \}\)/.test(pf), 'the panel saves routes through the validated model path');
A.ok(/EVERYTHING ELSE so no task is left without a way out/.test(pf), 'the panel asks for the fallback belt');

A.report('conveyor-legibility.test');
