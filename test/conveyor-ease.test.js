/* test/conveyor-ease.test.js — CONVEYORS YOU CAN UNDERSTAND AND FIX (Andrew, 2026-09-30: "I constantly get messages of people
   confused about conveyors … if the output is terrible and not consistent … how the user can fix the conveyor system to their
   liking" → "EASE OF USE AND UNDERSTANDABILITY the BIGGEST major concern").

   Locked here:
     · A STEP'S INSTRUCTIONS SAY WHAT THEY ARE — issue #28 asked "are these BAY instructions being used instead of the Agent's
       Purpose or in addition to it?": the BAY card names the agent, quotes its own purpose, and says DOES is ADDED on top;
     · SEND IT A JOB — the INBOX card opens on the plain way to put work into a line (#28: "I still haven't figured out how to add a
       new work item to an INBOX"): the same real job as RUN ONE REAL JOB, the typed text is also the line's test job;
     · THE JOB, READ BACK — the whole result (never 80 characters) and every step's own reply, read from its run by runId;
     · THE OUTBOX IS TOLD — the panel promised "the result lands in the OUTBOX"; a clean delivered job is now folded into the
       OUTBOX's ledger (only COMMS' INBOX card did that before). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const panel = read('frontend/app/workflowpanel.js'), build = read('frontend/app/build.js'), css = read('frontend/css/workflow-panel.css'), sidecar = read('sidecar/index.js');
const at = (src, from, to) => { const a = src.indexOf(from); return a < 0 ? '' : src.slice(a, to ? src.indexOf(to, a) : a + 4000); };

/* ---------- a step's instructions are ADDED to the agent's own purpose ---------- */
const adds = at(panel, '  function addsOnTopHTML(p) {', '  function paintBay(');
A.ok(/typeof a\.purpose === 'string'/.test(adds) && /' keeps their own purpose' \+ q \+ ' and skills\. <b>DOES<\/b> is added on top, for every job at this step/.test(adds),
  'the BAY card says the agent keeps its own purpose and skills, and DOES is added on top');
A.ok(/should do everywhere in ' \+ \(a \? 'their' : 'the agent’s'\) \+ ' dossier\./.test(adds), '…and where each kind of instruction belongs (this step here, everywhere in the dossier)');
A.ok(/'<p class="wf-help wf-adds">' \+ addsOnTopHTML\(p\) \+ '<\/p>'/.test(panel), '…right under the step\'s DOES / HANDS OFF');

/* ---------- SEND IT A JOB ---------- */
const trig = at(panel, '  function paintTrigger(body, f, p) {', '  // LINE BUDGET: one save');
A.ok(/const sendHTML = '<section class="wf-sec wf-send"><h3><span class="n">INBOX<\/span>Send it a job<\/h3>'/.test(trig) && /body\.innerHTML = sendHTML \+ '<section class="wf-sec"><h3>Or start it automatically<\/h3>'/.test(trig),
  'the INBOX card opens on SEND IT A JOB; the automatic starts follow it');
A.ok(/'▶ SEND IT DOWN THE LINE'/.test(trig) && /H\.runSample\(cc, \{ text: t, onUpdate: \(\) => paint\(false\) \}\);/.test(trig) && /if \(!t\) \{ H\.sfx\('bad'\); H\.flashTip\('write the job first/.test(trig),
  '…the same real job as RUN ONE REAL JOB, with the typed text (an empty job is refused with the reason)');
A.ok(/S\.testJob\[S\.lineKey\] = job\.value; saveTests\(\);/.test(trig) && !/id="wf-job"/.test(panel), '…and the typed job is the line\'s test job (one box, not two)');
A.ok(/id="wf-send-stop"/.test(trig) && /H\.stopSample\(\)/.test(trig), '…and a job riding the line can be stopped from there');

/* ---------- the job, read back ---------- */
const res = at(panel, '  function jobResultHTML(mine, f) {', '  function testModeNow() {');
A.ok(/const runs = \(mine\.runs \|\| \[\]\)\.slice\(\)\.reverse\(\);/.test(res) && /THE RESULT/.test(res) && /HOW EACH STEP DID IT/.test(res), 'a job comes back as the whole result, then how each step did it, in line order');
A.ok(/P\.stripVerdictLine\(out\)/.test(res) && !/slice\(0, 80\)/.test(res), '…the whole result (a reviewer\'s VERDICT line is the loop\'s signal, not the work) — never cut to 80 characters');
A.ok(/const pr = r\.dockId \? prop\(r\.dockId\) : null, role = \(pr && pr\.role\) \|\| null;/.test(res), '…each step named by the BAY it ran at');
const rd = at(panel, '  function readStep(r, streamId) {', '  function jobResultHTML(');
A.ok(/api\('\/api\/transcript\?stream=' \+ encodeURIComponent\(streamId \|\| r\.streamId \|\| ''\) \+ '&agent=' \+ encodeURIComponent\(r\.agentId \|\| 'agent'\) \+ '&runId=' \+ encodeURIComponent\(r\.runId\) \+ '&limit=50'\)/.test(rd),
  'each step\'s reply is read from its own run (the transcript by runId — the OUTBOX window\'s read)');
A.ok(/done\(\{ err: 'this step’s reply could not be read' \}\)/.test(rd), '…and a reply that cannot be read says so');
A.ok((panel.match(/\? jobResultHTML\(mine, /g) || []).length === 2 && (panel.match(/readJobSteps\(\);/g) || []).length === 2, 'the SEND block and the TEST view both read the job back');
A.ok(/dockId: r\.dockId \|\| null, lineId: r\.lineId \|\| null/.test(sidecar), 'the server names the BAY each stage ran at');

/* ---------- the OUTBOX is told ---------- */
const settle = at(build, '    const settle = (view, response) => {', '    const bad = reason =>');
A.ok(/if \(view\.ok && response && response\.delivered && response\.delivered\.reason === 'done'\) \{ try \{ if \(typeof ReturnStore !== 'undefined' && ReturnStore\.foldRow\) folded = !!ReturnStore\.foldRow\(response\.delivered\); \} catch \(_\) \{\} \}/.test(settle),
  'a clean delivered job is folded into the OUTBOX\'s ledger (only a clean \'done\', as COMMS does)');
A.ok(/output: Array\.isArray\(response\?\.replies\) \? response\.replies\.join\(''\) : ''/.test(settle) && /runs: Array\.isArray\(response\?\.runs\) \? response\.runs : \[\], streamId: response\?\.streamId \|\| null, folded/.test(settle),
  '…and the server\'s answer is kept whole: every stage\'s run, the stream, and the full delivered text (all its chunks)');
A.ok(/\.wf-job-out \{ max-height: 320px; \}/.test(css) && /\.wf-step-out summary \{ display: flex;/.test(css), 'the result reads in its own box; each step opens to its reply');

A.report('conveyor-ease.test');
