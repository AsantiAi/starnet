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
const sendDyn = at(panel, '  function sendDynHTML(f) {', '  function jobResultHTML(');
A.ok(/'▶ SEND IT DOWN THE LINE'/.test(sendDyn) && /H\.runSample\(cc, \{ text: t, onUpdate: \(\) => paint\(false\) \}\);/.test(sendDyn) && /if \(!t\) \{ H\.sfx\('bad'\); H\.flashTip\('write the job first/.test(sendDyn),
  '…the same real job as RUN ONE REAL JOB, with the typed text (an empty job is refused with the reason)');
A.ok(/S\.testJob\[S\.lineKey\] = job\.value; saveTests\(\);/.test(trig) && !/id="wf-job"/.test(panel), '…and the typed job is the line\'s test job (one box, not two)');
A.ok(/id="wf-send-stop"/.test(sendDyn) && /H\.stopSample\(\)/.test(sendDyn), '…and a job riding the line can be stopped from there');
/* found walking a fresh station: the job ran, and a card whose job box kept the cursor never showed it riding or what came back */
A.ok(/'<div data-live="send">' \+ sendDynHTML\(f\) \+ '<\/div><\/section>'/.test(trig) && /LIVE\.send = \(f, n\) => \(n\.contains\(document\.activeElement\) \? null : sendDynHTML\(f\)\);/.test(panel),
  'the SEND box\'s moving parts are a LIVE region: they follow the job whatever has focus, never rebuilt under the cursor');
A.ok(/const h = fn\(f, n\); if \(h != null\) n\.innerHTML = h;/.test(panel) && /function wireLive\(\) \{[^\n]*wireSend\(\); \}/.test(panel) && /if \(!send \|\| send\._wired\) return;/.test(sendDyn),
  '…a live region can be left as it is, and a rebuilt one is wired again (once per element)');
A.ok(/job\.blur\(\);/.test(sendDyn) && /const nrIn = \$\('#wf-nr-in'\); if \(nrIn\) nrIn\.blur\(\);/.test(panel) && /if \(si\) si\.blur\(\);/.test(panel),
  '…and SEND, SUGGEST FIXES and RUN ONE REAL JOB take the cursor out of their box first (WebKit keeps it there on a click)');

/* ---------- the job, read back ---------- */
const res = at(panel, '  function jobResultHTML(mine, f) {', '  function testModeNow() {');
A.ok(/const runs = \(mine\.runs \|\| \[\]\)\.slice\(\)\.reverse\(\);/.test(res) && /THE RESULT/.test(res) && /HOW EACH STEP DID IT/.test(res), 'a job comes back as the whole result, then how each step did it, in line order');
A.ok(/P\.stripVerdictLine\(out\)/.test(res) && !/slice\(0, 80\)/.test(res), '…the whole result (a reviewer\'s VERDICT line is the loop\'s signal, not the work) — never cut to 80 characters');
A.ok(/const pr = r\.dockId \? prop\(r\.dockId\) : null, role = \(pr && pr\.role\) \|\| null,/.test(res), '…each step named by the BAY it ran at');
const rd = at(panel, '  function readStep(r, streamId) {', '  function jobResultHTML(');
A.ok(/api\('\/api\/transcript\?stream=' \+ encodeURIComponent\(streamId \|\| r\.streamId \|\| ''\) \+ '&agent=' \+ encodeURIComponent\(r\.agentId \|\| 'agent'\) \+ '&runId=' \+ encodeURIComponent\(r\.runId\) \+ '&limit=50'\)/.test(rd),
  'each step\'s reply is read from its own run (the transcript by runId — the OUTBOX window\'s read)');
A.ok(/done\(\{ err: 'this step’s reply could not be read' \}\)/.test(rd), '…and a reply that cannot be read says so');
A.ok((panel.match(/\? jobResultHTML\(mine, /g) || []).length === 2 && (panel.match(/    wireJob\(\);/g) || []).length === 2, 'the SEND block and the TEST view both read the job back');

/* ---------- NOT RIGHT? — say what's wrong, get exact changes, use them, run the same job again ---------- */
const nr = at(panel, '  function notRightHTML(mine, f) {', '  function testModeNow() {');
A.ok(/notRightHTML\(mine, f\) \+ '<\/div>';/.test(res) && /NOT RIGHT\?/.test(nr) && /SUGGEST FIXES/.test(nr), 'under a delivered job: NOT RIGHT? — a box to say what is wrong');
A.ok(/api\('\/api\/routing\/fix-suggest', 'POST', \{ complaint, job: mine\.text \|\| '', result: mine\.output \|\| '', steps \}\)/.test(nr), '…sent with the job, the result and every step (what it was told, what it produced)');
A.ok(/for \(const r of \(mine\.runs \|\| \[\]\)\.slice\(\)\.reverse\(\)\) \{ if \(!r\.dockId\) continue; const got = stepOut\[r\.runId\]; byDock\.set\(r\.dockId/.test(nr), '…each BAY once, with its LAST reply (a looping line runs a BAY more than once)');
A.ok(/const r = st\.setPropBrief\(x\.dockId, x\.does\);/.test(nr) && /st\.setPropHands\(x\.dockId, x\.hands\)/.test(nr) && /✓ USE THIS/.test(nr), 'USE THIS is the ordinary brief edit (saved, one UNDO) — nothing changes on its own');
A.ok(/↻ RUN THE SAME JOB AGAIN/.test(nr) && /S\.prevJob = \{ text: mine\.text, output: mine\.output, stamp: mine\.stamp \};/.test(nr) && /H\.runSample\(cc, \{ text: mine\.text/.test(nr), '…then the same job runs again');
A.ok(/const prev = S\.prevJob && S\.prevJob\.stamp !== mine\.stamp && S\.prevJob\.text === mine\.text \? S\.prevJob : null;/.test(res) && /Last time, before your fix/.test(res), '…and what it gave last time stays one click away beside the new result');
A.ok(/Suggested by ' \+ esc\(fx\.model/.test(nr) && /\$' \+ \(\+fx\.usd\)\.toFixed\(4\)/.test(nr), 'the suggestion says which model made it and what it cost');
/* ---------- ★ KEEP AS THE EXAMPLE — consistency: the last step matches a result the Commander liked ---------- */
const ex = at(panel, '  const EX_HEAD = ', '  // after a job\'s card is painted');
A.ok(/const last = \(mine\.runs \|\| \[\]\)\[0\], dockId = last && last\.dockId/.test(ex) && /H\.station\(\)\.setPropBrief\(dockId, next\)/.test(ex),
  'KEEP AS THE EXAMPLE writes the result into the instructions of the step whose reply shipped (the delivered run), one UNDO');
A.ok(/replace\(\/\\n\*MATCH THIS EXAMPLE of a good result\[\\s\\S\]\*\$\/, ''\)/.test(ex) && /Math\.min\(1200, room\)/.test(ex) && /if \(room < 300\) return null;/.test(ex),
  '…as one marked block that replaces any earlier example, bounded to fit the 2000-character brief');
A.ok(/★ KEEP AS THE EXAMPLE/.test(res) && /★ THE LINE’S EXAMPLE/.test(res), '…a key under the result, then a tag saying it is the line\'s example');
/* ---------- the loop's machine note, in words ---------- */
const ln = at(panel, '  const LOOP_NOTE = ', '  function jobResultHTML(');
A.ok(/The review loop used all ' \+ n \+ ' tries without an approval, so the last version shipped as it was\./.test(ln) && /const ln = loopNotes\(/.test(res) && /ln\.notes\.map\(t => '<div class="wf-warnline">⚠ '/.test(res),
  'a loop that ran out of tries is said in words over the result, and lifted out of the result box');
A.ok(/text = loopNotes\(/.test(ex), '…and never becomes part of a kept example');
A.ok(/\(pass > 1 \? ' · pass ' \+ pass : ''\)/.test(res), 'a looping line\'s repeated steps say which pass they were');
/* ---------- where the job is now ---------- */
const live = at(panel, '  let liveTimer = 0, liveSeen = false;', '  const LOOP_NOTE = ');
const world = read('frontend/app/world.js');
A.ok(/const w = at\('working'\);/.test(live) && /'Now: step ' \+ \(w\.i \+ 1\) \+ ' of ' \+ order\.length/.test(live) && /is working/.test(live), 'while a job rides, the send box names the step working it now — "Now: step 2 of 3 · REVIEWER · NOVA is working"');
A.ok(/bayLive: id => \{ const w = lineWatch\(\);/.test(world) && /bayLive: id => \(opts\.world && opts\.world\.bayLive\) \? opts\.world\.bayLive\(id\) : null/.test(build), '…read from the floor\'s own bay lamps (LineWatch: WORKING only once the sidecar confirmed the run)');
A.ok(/'Sending the job into the line…'/.test(live) && /'Handing the job on to the next step…'/.test(live), '…and between steps it says so — it never guesses a step');
A.ok(/function markWorking\(id\)/.test(live) && /n\.classList\.toggle\('working', !!id && n\.dataset\.node === id\)/.test(live) && /markWorking\(null\); return;/.test(live), 'the diagram\'s tile of the working step wears the working lamp, cleared when the job is back');
A.ok(/\.wf-node\.working \.dot \{ background: #ffb23e;/.test(css) && !/\.wf-node\.working \{[^}]*var\(--gold\)/.test(css), '…the floor lamp\'s working amber on the tile\'s own lamp — never the selection\'s gold');
/* ---------- nothing claims what an UNDO took back; the live lamp holds on every card ---------- */
A.ok(/const fixInUse = x => \{ const p = prop\(x\.dockId\) \|\| \{\}; return \(x\.does == null \|\| \(p\.brief \|\| ''\) === x\.does\) && \(x\.hands == null \|\| \(p\.hands \|\| ''\) === x\.hands\); \};/.test(panel) && !/x\.applied/.test(panel),
  'a fix says IN USE only while the step says exactly what it suggested (an UNDO puts USE THIS back)');
A.ok(/S\.exampleStamp === mine\.stamp && exampleKept\(mine\)/.test(panel) && /String\(p\.brief \|\| ''\)\.indexOf\(EX_HEAD\) >= 0/.test(panel), '…and the example tag only while the step still holds its example');
A.ok(/if \(!el \|\| !sr \|\| !sr\.pending\) \{ clearInterval\(liveTimer\); liveTimer = 0; markWorking\(null\); return; \}/.test(panel) && /if \(n\) n\.textContent = now\.text;/.test(panel) && (panel.match(/startLive\(\);/g) || []).length >= 4,
  'the live read-out runs while a job is out whatever card is open, so the diagram\'s working lamp stays true');
/* ---------- the header's numbers say what they count; the line sentence names the way to run it ---------- */
const tips = at(panel, '  function todayTip(k) {', '  let todayTimer');
A.ok(/'<span data-tip="' \+ esc\(todayTip\(c\[0\]\)\) \+ '">/.test(panel) && /one job through a 3-step line is 3 runs/.test(tips) && /A text-only answer is still delivered to the OUTBOX, but it is not counted here/.test(tips),
  'each TODAY number has a tip saying what it counts (RUNS are step runs; SHIPPED is proven work — a text answer is delivered, not counted)');
A.ok(/; it runs when you send it a job\. /.test(read('frontend/app/workflowline.js')) && !/runs when you test it/.test(read('frontend/app/workflowline.js') + panel),
  'a line nothing starts by itself "runs when you send it a job" (the INBOX card sends one), not only "when you test it"');
/* ---------- a job whose steps ran but did not all finish clean (a real model: a RESEARCHER answered, then its model sent empty
   turns — "empty" — and the card said only "REFUSED — sample job did not complete cleanly", hiding a good delivered answer) ---------- */
A.ok(/if \(v\.stopped \|\| \(!v\.ok && !runs\.length\)\) return '<div class="wf-sample-res">' \+ H\.sampleHTML\(v\) \+ '<\/div>';/.test(res), 'STOPPED, or REFUSED before any step ran, keeps the server\'s own verdict card');
A.ok(/⚠ FINISHED WITH A PROBLEM/.test(res) && /const bad = v\.ok \? null : runs\.find\(r => r\.reason && r\.reason !== 'done'\);/.test(res) && /runEnd\(bad\.reason\) \+ ', so this job did not finish cleanly and was not put in the OUTBOX\. Sending it again often works\.'/.test(res),
  'a job whose steps ran but did not finish clean names the step and what happened, in words — never just REFUSED');
A.ok(/v\.ok \? 'THE RESULT' : 'WHAT CAME OUT'/.test(res) && /\(!v\.ok \? '' : '<div class="wf-row">'/.test(res), '…still shows what came out and every step (no KEEP AS THE EXAMPLE on a problem job)');
A.ok(/empty: 'gave no final answer', error: 'hit an error', max_iters: 'ran out of turns'/.test(panel) && /esc\(runEnd\(r\.reason\)\)/.test(res), 'each step says how its run ended in words, never the raw reason code');
A.ok(/placeholder="e\.g\. Find this week’s AI news and summarize the three biggest stories\.">' \+ esc\(S\.testJob\[S\.lineKey\] \|\| ''\) \+ '<\/textarea>'/.test(panel), 'a new schedule\'s task starts as the job this line was last sent ("do that every morning" is one click)');
/* ---------- a READY line says what to do next — and its pill keeps the station's word (station-layout.e2e: panel pill == the status an
   agent reads with station.layout) ---------- */
A.ok(/<button type="button" class="bb sm refit-primary" id="wf-sendnow" hidden>▶ SEND IT A JOB<\/button>/.test(panel) && /sendNow\.hidden = !sendTo \|\| S\.sel === sendTo; sendNow\.onclick = toSend;/.test(panel),
  'a READY line shows ▶ SEND IT A JOB beside its pill, taking you to the send box (hidden while the INBOX card is open)');
A.ok(/if \(r\) \{ pill\.textContent = W\.pillText\(r\);/.test(panel) && !/READY · SEND IT A JOB ▸/.test(panel), '…and the pill itself says exactly what an agent reads: READY TO RUN');
/* ---------- the LAST stage is told its reply IS the result (found on a real model: a WRITER asked for three short stories wrote an
   essay about "the upstream report", because every stage was told to produce output "for the next stage … build on it") ---------- */
const P = require('../frontend/app/pipeline.js'), Chain = require('../sidecar/routing/chain.js');
const mid = P.handoffPrompt('3 AI stories, keep it short', 'researcher', 'the notes', 1, 'Write it up.');
const last = P.handoffPrompt('3 AI stories, keep it short', 'researcher', 'the notes', 1, 'Write it up.', '', true);
A.ok(/produce the output for the next stage/.test(mid) && !/LAST stage/.test(mid), 'a middle stage keeps its hand-off (and every old caller composes byte-identical turns)');
A.ok(/You are the LAST stage: your reply is the finished result the requester receives\. Give them exactly what the original request asks for — its format, length and tone/.test(last) && !/next stage|build on it/.test(last),
  'the stage whose reply leaves the line is told it IS the result: the request\'s format, length and tone, never "for the next stage"');
A.ok(P.parseHandoff(last) && P.parseHandoff(last).original === '3 AI stories, keep it short', '…and the OUTBOX still reads the original request out of it');
A.ok(!/LAST stage/.test(P.handoffPrompt('req', 'writer', 'draft', 1, 'be picky', 'YOUR VERDICT DECIDES…', true)), 'a stage a review loop reads keeps its verdict instruction, never the last-stage one');
const turnAt = lastStage => Chain.hopTurn({ originalText: 'req', from: 'a', upstream: 'up', hop: 1, target: 'w', targetDock: 'd2', lineId: 'L', lastStage });
A.ok(/LAST stage/.test(turnAt((a, d) => a === 'w' && d === 'd2')) && !/LAST stage/.test(turnAt(() => false)) && !/LAST stage/.test(turnAt(undefined)), 'the chain asks lastStage(target, dock) — no helper, no change');
A.ok(/lastStage: \(agentId, dockId\) => router\.chainShipsToOutbox\(agentId, dockId\)/.test(sidecar) && /lastStage: \(a, d\) => router\.chainShipsToOutbox\(a, d\)/.test(sidecar),
  '…and the station answers it for real runs and step tests alike: the dock whose lane ships to the OUTBOX');
// the one billed station call NOT RIGHT? and SET IT UP FOR ME share (2026-09-30: stationOneShot)
const oneShot = at(sidecar, 'async function stationOneShot(prompt, tag, failLead) {', 'async function handleRoutingFixSuggest(req, res) {');
const route = at(sidecar, 'async function handleRoutingFixSuggest(req, res) {', 'async function stepTestRunDock(h) {');
A.ok(/\{ m: 'POST', exact: '\/api\/routing\/fix-suggest', h: handleRoutingFixSuggest \}/.test(sidecar), 'POST /api/routing/fix-suggest is a route');
A.ok(oneShot.indexOf('budget.check(null, \'agent\', 0, Date.now(), null)') > 0 && oneShot.indexOf('budget.check(') < oneShot.indexOf('provider.stream('), '…the spending cap is read BEFORE the model call');
A.ok(/cfg = sampleRunConfigFor\('agent'\)/.test(oneShot) && /ledger\.record\(\{ runId: tag \+ '-' \+ crypto\.randomUUID\(\), agentId: 'station'/.test(oneShot) && /catch \(e\) \{ failNote\(tag \+ '\.ledger', e\); \}/.test(oneShot)
  && /stationOneShot\(LineFix\.buildPrompt\(input\), 'linefix', /.test(route), '…one call on the station default model, its spend booked on the ledger (a failed booking is noted)');
// (sweep 10-02) a call that times out or errors after usage arrived still books it — those tokens were billed
A.ok(/\} catch \(e\) \{\s*book\(\);\s*return \{ ok: false, status: 502/.test(oneShot) && /\} finally \{ clearTimeout\(timer\); \}\s*book\(\);/.test(oneShot), '…and a failed or timed-out call books the usage it already used');
A.ok(/const parsed = LineFix\.parseFixes\(call\.out, input\);/.test(route) && /return json\(400, \{ ok: false, error: input\.error \}\);/.test(route), '…the reply checked (LineFix), bad input refused');
A.ok(/dockId: r\.dockId \|\| null, lineId: r\.lineId \|\| null/.test(sidecar), 'the server names the BAY each stage ran at');

/* ---------- the OUTBOX is told ---------- */
const settle = at(build, '    const settle = (view, response) => {', '    const bad = reason =>');
A.ok(/if \(view\.ok && response && response\.delivered && response\.delivered\.reason === 'done'\) \{ try \{ if \(typeof ReturnStore !== 'undefined' && ReturnStore\.foldRow\) folded = !!ReturnStore\.foldRow\(response\.delivered\); \} catch \(_\) \{\} \}/.test(settle),
  'a clean delivered job is folded into the OUTBOX\'s ledger (only a clean \'done\', as COMMS does)');
A.ok(/output: Array\.isArray\(response\?\.replies\) \? response\.replies\.join\(''\) : ''/.test(settle) && /runs: Array\.isArray\(response\?\.runs\) \? response\.runs : \[\], streamId: response\?\.streamId \|\| null, folded/.test(settle),
  '…and the server\'s answer is kept whole: every stage\'s run, the stream, and the full delivered text (all its chunks)');
A.ok(/\.wf-job-out \{ max-height: 320px; \}/.test(css) && /\.wf-step-out summary \{ display: flex;/.test(css), 'the result reads in its own box; each step opens to its reply');

A.report('conveyor-ease.test');
