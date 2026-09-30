/* node test/deskscreen.test.js — DESK SCREEN (frontend/app/deskscreen.js): the per-agent run fold behind the card
   that opens when you click an agent's workstation. Pure — bus events in, read-outs out.

   Laws under test:
     • a run is WORKING only once agent.run.start (or a real tool step) proves it; tokens alone never open one
       (the harness's internal self-talk streams tokens with its start/end suppressed);
     • steps pair call → result by callId, keep the result summary + time, and never spin after the run ended;
     • the writing tail shows what it is writing NOW (prose before a tool call was narration);
     • a run that goes silent with no end is not asserted live forever;
     • runs, asks and deliverables stay per agent — another agent's run never shows at this desk. */
'use strict';
const A = require('./_assert.js');
const D = require('../frontend/app/deskscreen.js');

D._reset();
// ---- tokens alone never open a run ----
D._fold('agent.token', { agentId: 'nova', runId: 'x1', delta: 'thinking to myself' }, 1000);
A.eq(D._currentOf('nova', 1100), null, 'a token with no start/tool is not a job');

// ---- start → steps → result ----
D._fold('agent.run.start', { agentId: 'nova', runId: 'r1', trigger: 'directive', model: 'anthropic/claude-sonnet' }, 2000);
let r = D._currentOf('nova', 2100);
A.ok(r && r.runId === 'r1' && !r.partial, 'run.start opens a live, non-partial run');
D._fold('agent.token', { agentId: 'nova', runId: 'r1', delta: 'Let me look.' }, 2200);
D._fold('agent.tool_call', { agentId: 'nova', runId: 'r1', callId: 'c1', name: 'fs_read', argsSummary: '{"path":"src/app.js"}' }, 2300);
A.eq(r.text, '', 'a tool call resets the writing tail (that prose was narration)');
A.eq(r.steps.length, 1, 'the call is a step');
A.eq(r.steps[0].done, false, 'in flight until its result');
D._fold('agent.tool_result', { agentId: 'nova', runId: 'r1', callId: 'c1', ok: true, isError: false, ms: 42, summary: 'read 120 lines' }, 2400);
A.eq(r.steps[0].ok, true, 'result pairs by callId');
A.eq(r.steps[0].ms, 42, 'keeps the time');
A.eq(r.steps[0].summary, 'read 120 lines', 'keeps the result summary');
D._fold('agent.tool_call', { agentId: 'nova', runId: 'r1', callId: 'c2', name: 'web_search', argsSummary: '{"query":"otters' }, 2500);
D._fold('agent.tool_result', { agentId: 'nova', runId: 'r1', callId: 'c2', ok: false, isError: true, ms: 900, summary: 'blocked' }, 2600);
A.eq(r.steps[1].ok, false, 'an errored tool is a failed step');
D._fold('agent.token', { agentId: 'nova', runId: 'r1', delta: 'Here is ' }, 2700);
D._fold('agent.token', { agentId: 'nova', runId: 'r1', delta: 'the summary.' }, 2710);
A.eq(r.text, 'Here is the summary.', 'the writing tail accumulates after the last tool');
D._fold('agent.cost', { agentId: 'nova', runId: 'r1', usd: 0.01, reconciled: true }, 2800);
D._fold('agent.cost', { agentId: 'nova', runId: 'r1', usd: 0.005, reconciled: true }, 2900);
A.ok(Math.abs(r.usd - 0.015) < 1e-9, 'reconciled cost sums');

// ---- deliverable + ask are per agent ----
D._fold('deliverable', { agentId: 'nova', title: 'otters.md', kind: 'file' }, 3000);
A.eq(r.made.map(m => m.title), ['otters.md'], 'a deliverable lands on the agent\'s live run');
D._fold('deliverable', { agentId: 'quill', title: 'not mine' }, 3001);
A.eq(r.made.length, 1, 'another agent\'s deliverable never shows here');
D._fold('agent.run.start', { agentId: 'quill', runId: 'q1', trigger: 'schedule', model: 'm' }, 3002);
A.eq(D._currentOf('nova', 3003).runId, 'r1', 'another agent\'s run never shows at this desk');

// ---- end: steps stop spinning, total cost from the end payload when larger ----
D._fold('agent.tool_call', { agentId: 'nova', runId: 'r1', callId: 'c3', name: 'fs_write', argsSummary: '{"path":"otters.md","content":"# O' }, 3100);
D._fold('agent.run.end', { agentId: 'nova', runId: 'r1', reason: 'done', turns: 3, usd: 0.02 }, 3200);
A.eq(D._currentOf('nova', 3300), null, 'an ended run is not live');
const e = D._lastEndedOf('nova');
A.eq(e && e.runId, 'r1', 'the ended run is remembered for the just-finished view');
A.eq(e.steps[2].done, true, 'an unanswered step never spins after the run ended');
A.eq(e.steps[2].ok, null, '…and is not claimed as ok or failed');
A.ok(Math.abs(e.usd - 0.02) < 1e-9, 'run.end usd is the authoritative total when larger');
D._fold('agent.tool_call', { agentId: 'nova', runId: 'r1', callId: 'c4', name: 'late' }, 3400);
A.eq(e.steps.length, 3, 'no steps land on an ended run');

// ---- joined mid-run: a real tool step opens a PARTIAL run ----
D._fold('agent.tool_call', { agentId: 'mira', runId: 'm1', callId: 'k1', name: 'browser_open' }, 5000);
const m = D._currentOf('mira', 5100);
A.ok(m && m.partial, 'a tool step with no seen start opens a partial run (labelled joined mid-run)');
A.eq(D._currentOf('mira', 5000 + 11 * 60 * 1000), null, 'a run silent for 10+ minutes with no end is not asserted live');

// ---- permission asks ----
D._fold('permission.prompt', { promptId: 'p1', agentId: 'quill', tool: 'shell_exec', scope: 'once' }, 6000);
D._fold('permission.response', { promptId: 'p1', decision: 'allow' }, 6100);

// ---- the salient-argument digest (argsSummary is a capped JSON prefix) ----
A.eq(D._argDigest('{"path":"src/app.js","content":"x'), 'src/app.js', 'the file wins over the content');
A.eq(D._argDigest('{"query":"sea otters","n":5}'), 'sea otters', 'the query');
A.eq(D._argDigest('{"content":"cut mid'), '{"content":"cut mid', 'an unterminated value is never shown as whole');
A.eq(D._argDigest(''), '', 'no args, no digest');

// ---- the task label never guesses ----
const t = D._taskOf({ runId: 'zz', trigger: 'schedule', task: '' });
A.eq(t.known, false, 'a routine run with no local conversation has no known task text');
A.ok(/scheduled routine/i.test(t.text), 'it says what started it instead');

// ---- the agent's screen: transcript rows → screens (full args before the tool runs, full result after) ----
const rows = [
  { role: 'user', content: 'do it' },
  { role: 'assistant', content: '', toolCalls: JSON.stringify([{ id: 'c1', type: 'function', function: { name: 'fs_write', arguments: JSON.stringify({ path: 'notes.md', content: '# Notes\nline two' }) } }]) },
  { role: 'tool', toolCallId: 'c1', content: 'wrote notes.md (18 B)' },
  { role: 'assistant', content: '', toolCalls: JSON.stringify([{ id: 'c2', type: 'function', function: { name: 'shell_exec', arguments: JSON.stringify({ command: 'echo hi' }) } }]) },
  { role: 'tool', toolCallId: 'c2', content: 'ERROR: exit 1' },
  { role: 'assistant', content: '', toolCalls: JSON.stringify([{ id: 'c3', type: 'function', function: { name: 'fs_edit', arguments: JSON.stringify({ path: 'a.js', find: 'old', replace: 'new' }) } }]) }
];
const scr = D._parseScreens(rows);
A.eq(scr.map(x => x.callId), ['c1', 'c2', 'c3'], 'one screen per tool call, in order');
A.eq(scr[0].done, true, 'a call with its result row is done');
A.eq(scr[2].done, false, 'a call whose result has not been checkpointed yet is still working');
A.eq(scr[1].isError, true, 'an ERROR: result is a failed step');
A.eq(scr[1].result, 'exit 1', '…with the prefix stripped');
const ed = D._screenOf(scr[0]);
A.eq([ed.app, ed.target, ed.kind, ed.body], ['EDITOR', 'notes.md', 'code', '# Notes\nline two'], 'fs.write → the editor showing the FULL file it wrote');
const term = D._screenOf(scr[1]);
A.eq([term.app, term.kind], ['TERMINAL', 'term'], 'shell → the terminal');
A.ok(term.body.startsWith('$ echo hi\n'), 'the terminal shows the command it ran');
const diff = D._screenOf(scr[2]);
A.eq([diff.app, diff.kind, diff.body, diff.note], ['EDITOR', 'diff', '- old\n+ new', 'working…'], 'fs.edit → a diff, marked working until its result lands');
A.eq(D._parseScreens([{ role: 'tool', toolCallId: 'zz', content: 'orphan' }]).length, 0, 'a result with no call is never shown as a screen');
A.eq(D._screenOf({ name: 'web_search', args: { query: 'otters' }, result: '1. Otters', done: true }).target, 'otters', 'web search → the query + its results');

A.report();
