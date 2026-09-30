/* test/line-edit-panel.test.js — THE WORKFLOW PANEL BUILDS THE LINE (conveyor-links plan, phase D, 2026-09-29).

   lineedit.js does the edits (test/line-edit.test.js); this locks that the panel and the floor editor OFFER them, the way
   the Commander meets them, and that nothing in the panel asks for an edit it cannot make:
     · the page loads the layout engine and the editor; the Build host runs every edit through ONE runner that lays a new
       line where the Commander is looking, flashes what it placed and recompiles at once;
     · the Conveyors tab has BUILD YOUR OWN LINE, which opens the new line's panel;
     · a BAY's card: ROLE chips (the step's name) and SHAPE THE LINE — earlier / later / a review / a second opinion (COPY) /
       share the load (TURNS) / remove; a lone BAY: MAKE IT A LINE; a LOOP gate: REMOVE THE REVIEW;
     · the + on a belt: a step by role, a BRANCH (copy / turns) and — only in front of a step or the OUTBOX — a SORTER;
     · a line that ends on a step shows + OUTBOX where its OUTBOX would be; the footer has TIDY LINE;
     · a button whose edit would fail is OFF with the reason as its tip (never a click that ends in an error);
     · a SPLITTER's card: ADD A BRANCH and a ✕ for each branch; a FILTER's card: + A STEP FOR a type it has no route for, and
       REMOVE THE SORTER;
     · an edit with no room where the line stands ARMS in place — a second click lays the line out afresh round it, one undo;
     · the floor shows what an edit moved (an outline glides from where the machine stood) and what it took out (red). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const WM = require('../frontend/app/worldmodel.js');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const html = read('frontend/index.html'), build = read('frontend/app/build.js'), panel = read('frontend/app/workflowpanel.js');
const at = (src, from, to) => { const a = src.indexOf(from); return a < 0 ? '' : src.slice(a, to ? src.indexOf(to, a) : a + 4000); };

// the page loads the engine and the editor (after the world model they build on)
const iW = html.indexOf('app/worldmodel.js'), iL = html.indexOf('app/linelayout.js'), iE = html.indexOf('app/lineedit.js');
A.ok(iW > 0 && iL > iW && iE > iL, 'index.html loads linelayout.js and lineedit.js after worldmodel.js');

// the Build host: one runner for every edit
const run = at(build, '  function lineEditRun(op, propId, args, how) {', '  /* pan the floor so a part');
A.ok(/LineEdit\.run\(station, propId, op, args, \{ near: viewCenterTile\(\), sizes: lineSizes\(\), tidy: !!\(how && how\.tidy\) \}\)/.test(run), 'every edit runs through LineEdit with the catalog sizes, a new line laid near the middle of the view (and the armed second click\'s TIDY)');
A.ok(/station\.lineGraph\(propId\)/.test(run) && /pushMoves\(moves\)/.test(run) && /pushFlash\(gone, true\)/.test(run), 'what an edit moved glides on the floor, what it took out flashes red');
A.ok(/if \(fl\.moves\) \{ drawMoves\(fl, k, t\); continue; \}/.test(build) && /function drawMoves\(fl, k, t\)/.test(build), '…drawn with the placement flashes');
A.ok(/pushFlash\(/.test(run) && /Tutorial\.onPropPlaced/.test(run) && /rebake\(\)/.test(run), '…what it placed flashes, the tutorial hears it, and the plan recompiles at once');
A.ok(/lineEdit: \(op, propId, args, how\) => lineEditRun\(op, propId, args, how\)/.test(build) && /canLineEdit: \(op, propId, args\) =>[^\n]*LineEdit\.check\(/.test(build), 'the panel host offers lineEdit and canLineEdit (the dry answer that greys a button out)');
const own = at(build, '      /* BUILD YOUR OWN (conveyor-links phase D)', '      /* START FROM INTENT');
A.ok(/BUILD YOUR OWN LINE/.test(own) && /lineEditRun\('newLine', null, \{\}\)/.test(own) && /openWorkflowPanel\(r\.focus\)/.test(own), 'the Conveyors tab has BUILD YOUR OWN LINE: a new line, its Workflow panel open on it');

// the panel's edits
const shape = at(panel, '  function shapeHTML(p) {', '  /* ---------- the footer');
for (const [op, what] of [['moveStep\', p.id, { id: p.id, dir: -1 }', '◂ EARLIER'], ['moveStep\', p.id, { id: p.id, dir: 1 }', 'LATER ▸'], ['addLoop', '⟲ ADD A REVIEW'],
  ["addBranch', p.id, { around: p.id, mode: 'copy' }", '⑂ SECOND OPINION'], ["addBranch', p.id, { around: p.id, mode: 'turns' }", '⑂ SHARE THE LOAD'], ['removeStep', '✕ REMOVE STEP'], ['wrapLine', '▸ MAKE IT A LINE']])
  A.ok(shape.indexOf("editBtn('" + op) >= 0 && shape.indexOf(what) >= 0, 'a BAY\'s card offers ' + what);
A.ok(/editBtn\('removeLoop', p\.id/.test(panel) && /REMOVE THE REVIEW/.test(panel), 'a LOOP gate\'s card offers REMOVE THE REVIEW');
const ins = at(panel, '  function inserterHTML(from, to, f) {', '  function nodeHTML(n, f) {');
A.ok(/editBtn\('addBranch', from, \{ from, to, mode: 'copy' \}/.test(ins) && /editBtn\('addBranch', from, \{ from, to, mode: 'turns' \}/.test(ins), 'the + on a belt offers a BRANCH either way');
A.ok(/\(B && !JN\[B\.t\] \? editBtn\('addSorter'/.test(ins), '…and a SORTER only in front of a step or the OUTBOX');
A.ok(/lineEdit\('insertStep', fromId, \{ from: fromId, to: toId, role: role \|\| null \}/.test(panel), 'a step from the + goes in as a line edit on a floor that builds by links');
A.ok(/editBtn\('addOutbox', n\.addAfter, \{ after: n\.addAfter \}, '\+ OUTBOX'/.test(panel), 'a line that ends on a step shows + OUTBOX where its OUTBOX would be');
A.ok(/editBtn\('tidy', S\.sel, \{\}, '⌗ TIDY LINE'/.test(panel), 'the footer offers TIDY LINE');
const btn = at(panel, '  function editBtn(op, id, args, label, tip, cls) {', '  function wireEdits(scope) {');
A.ok(/aria-disabled="true"/.test(btn) && /c\.msg \|\| tip/.test(btn) && /' off'/.test(btn), 'a button whose edit would fail is OFF, its reason in the tip');
const wire = at(panel, '  function wireEdits(scope) {', '  // a BAY\'s line edits');
A.ok(/classList\.contains\('off'\)/.test(wire) && /H\.flashTip\(b\.dataset\.tip, false\)/.test(wire), '…and clicking it says the reason instead of trying');
A.ok(/saveOpenFields\(\)/.test(at(panel, '  function lineEdit(op, id, args, okMsg, how) {', '  // one edit as a button')), 'a half-typed brief is saved before an edit changes the floor under it');
// the SPLITTER's and the FILTER's shape edits
A.ok(/editBtn\('addArm', p\.id, \{ split: p\.id \}, '⑂ ADD A BRANCH'/.test(panel) && /editBtn\('removeArm', p\.id, \{ split: p\.id, head: l\.dock \}, '✕ ' \+ branchLabel\(f, l\.dock\)/.test(panel), 'a SPLITTER\'s card offers ADD A BRANCH and a ✕ for each branch…');
A.ok(/'BAY ' \+ \(i \+ 1\) \+ \(d && d\.role \? ' · ' \+ d\.role : ''\)/.test(at(panel, '  function branchLabel(f, pid) {', '  function laneName(')), '…each named BAY n · ROLE, as the strip names it (two WRITER branches never read alike)');
A.ok(/editBtn\('addRoute', p\.id, \{ id: p\.id, tag \}, '\+ A STEP FOR ' \+ lbl/.test(panel) && /\.error !== 'HAS_ROUTE'/.test(panel), 'a FILTER\'s card offers a step for a type it has no route for (never one it has)');
A.ok(/editBtn\('removeSorter', p\.id, \{ id: p\.id \}, '✕ REMOVE THE SORTER'/.test(panel), '…and REMOVE THE SORTER');
const le = at(panel, '  function lineEdit(op, id, args, okMsg, how) {', '  // one edit as a button');
A.ok(/res\.canTidy && op !== 'tidy' && !\(how && how\.tidy\)/.test(le) && /S\.armTidy = \{ key, t: Date\.now\(\) \}/.test(le) && /click it again to TIDY the line round it/.test(le), 'no room where the line stands: the button ARMS in place and says a second click tidies round it');
A.ok(/'⌗ TIDY LINE TO FIT IT\?'/.test(btn) && /data-tidy-armed="1"/.test(btn), '…the armed button says what the second click does');
A.ok(/tidy \? \{ tidy: true \} : null/.test(wire), '…and the second click asks the editor to lay the line out afresh round the change');
A.ok(/res\.tidied \? ' · the whole line laid out afresh round it' : res\.relaid \? ' · the belts round it re-routed'/.test(le), 'the confirmation says when belts were re-routed or the line laid afresh');

// ROLE chips: a step's name, one undo, only real roles
A.ok(/data-role="' \+ r \+ '" aria-pressed=/.test(panel) && /setPropRole\(p\.id, b\.getAttribute\('aria-pressed'\) === 'true' \? '' : b\.dataset\.role\)/.test(panel), 'a BAY\'s ROLE chips set its role (clicking the pressed one clears it)');
{
  const st = WM.create(WM.starterDoc());
  const bay = st.addProp({ t: 'bay', x: 6, y: 5, w: 2, h: 2 });
  const s0 = JSON.stringify(st.props());
  const r = st.setPropRole(bay.id, 'WRITER');
  A.ok(r.ok && r.role === 'WRITER' && st.propById(bay.id).role === 'WRITER', 'setPropRole names the step');
  A.ok(st.setPropRole(bay.id, 'NOT_A_ROLE').ok && !st.propById(bay.id).role, '…an unknown role clears it rather than storing it');
  st.undo(); st.undo();
  A.eq(JSON.stringify(st.props()), s0, '…each change is one undo');
  A.ok(!st.setPropRole('nope', 'WRITER').ok && !st.setPropRole(st.props().find(p => p.t !== 'bay').id, 'WRITER').ok, '…and only a BAY has a role');
}

A.report('line-edit-panel.test');
