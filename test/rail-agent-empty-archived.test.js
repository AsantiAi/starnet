/* node test/rail-agent-empty-archived.test.js — narrowed to one agent whose sessions are all ARCHIVED, the rail's empty
   line never says "No sessions with X yet." right above "▸ 2 archived" (QA 2026-10-02): it says they are archived below. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'app.js'), 'utf8');
const i = app.indexOf("ul.innerHTML = '<li class=\"proj-empty ws-agent-empty\"");
A.ok(i > 0, 'the narrowed-agent empty line exists');
const block = app.slice(i - 400, i + 400);
A.ok(block.includes('if (w.archived && railHasAgent(w, railAgentFilter)) archivedHere++;'), 'it counts that agent\'s archived sessions');
A.ok(block.includes("(archivedHere ? 'open sessions with ' + name + ' — ' + archivedHere + ' archived below.' : 'sessions with ' + name + ' yet.')"), 'and says "archived below" instead of "yet" when there are some');
A.report('rail-agent-empty-archived');
