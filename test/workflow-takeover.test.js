'use strict';
const assert = require('node:assert/strict');
const W = require('../sidecar/workflow-takeover.js');
const DAY = 86400000, now = 70 * DAY;
const prompts = ['Please compile the weekly client update from client notes',
  'Could you assemble weekly client update from the client notes', 'Prepare the weekly client update from client notes'];
function input() {
  return { now, briefs: prompts.map((text, i) => ({ id:'b'+i, runId:'r'+i, agentId:'agent', source:'interactive',
    originalDirective:text, status:'done', completedAt:now-(3-i)*DAY,
    settled:{ sources:['client-notes.md'], success:'Include every active client' },
    questions:[{text:'Which format?',answer:'Use a table'}] })),
    runs: prompts.map((_, i) => ({runId:'r'+i,agentId:'agent',reason:'done',toolsOk:1,projectRoot:''})), jobs:[] };
}
let x = input(), c = W.candidates(x)[0];
assert.ok(c); assert.equal(c.count, 3); assert.equal(c.evidence.length, 3);
assert.match(c.prompt, /client-notes.md/); assert.match(c.prompt, /Use a table/);
assert.equal(W.signature(prompts[0]),W.signature(prompts[1]));
assert.notEqual(W.signature('Send report from Alice to Bob'), W.signature('Send report from Bob to Alice'));
assert.notEqual(W.signature('Prepare the report for Acme'),W.signature('Prepare the report for Beta'));
assert.notEqual(W.signature('Send the weekly client report'),W.signature('Do not send the weekly client report'));
assert.equal(W.signature('Try again and prepare the weekly report'), '');
assert.equal(W.signature('Summarize the attached client document'), '');
x = input(); x.briefs.pop(); assert.equal(W.candidates(x).length,0);
x = input(); x.briefs.forEach((b,i)=>b.completedAt=now-i*1000); assert.equal(W.candidates(x).length,0);
x = input(); x.briefs.push(x.briefs[0]); assert.equal(W.candidates(x)[0].count,3,'duplicate brief/run is not another occasion');
x = input(); x.runs[1].reason='error'; assert.equal(W.candidates(x).length,0,'failure resets successful occasions');
for (const verdict of ['ok', 'miss']) {
  x = input(); x.ratings=[{runId:'r2',verdict}];
  assert.equal(W.candidates(x).length,0,'user correction overrides technical completion');
}
x = input(); x.ratings=[{runId:'r2',verdict:'great'}]; assert.equal(W.candidates(x).length,1);
x = input(); x.runs[2].toolsOk=0; assert.equal(W.candidates(x).length,0,'chat-only completion is not proven workflow work');
x = input(); x.runs[2].internal=true; assert.equal(W.candidates(x).length,0);
x = input(); x.runs[2].streamId='cron-test'; assert.equal(W.candidates(x).length,0);
x = input(); x.runs[2].completionEvidence={completionVerdict:'verification_required'}; assert.equal(W.candidates(x).length,0);
x = input(); x.runs[2].uncertainMutations=[{}]; assert.equal(W.candidates(x).length,0);
x = input(); x.runs[2].projectRoot='different-project'; assert.equal(W.candidates(x).length,0);
x = input(); x.briefs[2].source='autonomous'; assert.equal(W.candidates(x).length,0);
x = input(); x.enabled=false; assert.equal(W.candidates(x).length,0);
x = input(); x.redact=s=>s+'[redacted]'; assert.equal(W.candidates(x).length,0);
x = input(); x.state={forgottenAt:now-DAY}; assert.equal(W.candidates(x).length,0,'forget must not relearn old task history');
x = input(); x.state={decisions:[{id:c.id,until:now+DAY}]}; assert.equal(W.candidates(x).length,0);
x.state.decisions[0].until=now-1; assert.equal(W.candidates(x).length,1,'defer expires');
x.state.decisions[0].never=true; assert.equal(W.candidates(x).length,0);
x = input(); x.jobs=[{meta:{workflowTakeoverId:c.id},enabled:false}]; assert.equal(W.candidates(x).length,0,'paused routine is still an existing workflow');
x = input(); x.jobs=[{agentId:'agent',prompt:prompts[2]}]; assert.equal(W.candidates(x).length,0);
console.log('workflow-takeover: evidence, repetition, scope, outcomes, privacy, defer and duplicate scenarios passed');

// ---- REPEAT SENSE (2026-10-01): paraphrased habits group; different work never does ----
const sim = (a, b) => W.similar(W.core(a), W.core(b));
assert.ok(sim("Summarize today's AI news for me", "what's new in AI today? give me a summary"), 'paraphrase of the same habit');
assert.ok(sim('Prepare the weekly client update from client notes', 'Draft the weekly client update from client-notes.md'));
assert.ok(!sim('Prepare the report for Acme', 'Prepare the report for Beta'), 'different target');
assert.ok(!sim('Send report from Alice to Bob', 'Send report from Bob to Alice'), 'swapped roles');
assert.ok(!sim('Send the weekly client report', 'Do not send the weekly client report'), 'negation');
assert.ok(!sim('Summarize AI news', 'Summarize crypto news'), 'different topic');
assert.ok(!sim('Summarize notes/a.md', 'Summarize notes/b.md'), 'different explicit path');
assert.equal(W.core('Try again and summarize the AI news'), null);
const habit = ["Summarize today's AI news for me", 'AI news recap please', "what's new in AI today? give me a summary"];
function habitInput() {
  return { now, briefs: habit.map((text, i) => ({ id:'h'+i, runId:'hr'+i, agentId:'agent', source:'interactive',
    originalDirective:text, status:'done', completedAt:now-(3-i)*DAY })),
    runs: habit.map((_, i) => ({runId:'hr'+i,agentId:'agent',reason:'done',toolsOk:2,projectRoot:''})), jobs:[] };
}
x = habitInput(); c = W.candidates(x)[0];
assert.ok(c, 'reworded habit earns an offer'); assert.equal(c.count, 3); assert.match(c.why, /different words/);
assert.ok(c.suggest && c.suggest.schedule, 'daily rhythm suggests a cadence'); assert.match(c.suggest.display, /every day|weekdays/);
assert.ok(c.core && c.core.words.length);
x = habitInput(); x.jobs = [{ agentId:'agent', prompt:'Every morning: summarize the latest AI news' }];
assert.equal(W.candidates(x).length, 0, 'an existing routine for the same work suppresses the offer');
x = habitInput(); x.state = { decisions:[{ id:'workflow-'+'0'.repeat(24), never:true, core:Object.assign({}, c.core) }] };
assert.equal(W.candidates(x).length, 0, '"never" follows the work even when the cluster id moved');
// notice(): the third occasion, seen while it is being asked
x = habitInput(); x.briefs.pop(); x.runs.pop();
let n = W.notice(Object.assign({}, x, { directive:'can you give me the AI news summary', agentId:'agent' }));
assert.ok(n, 'third ask is noticed'); assert.equal(n.count, 3); assert.equal(n.dates.length, 2);
assert.equal(W.notice(Object.assign({}, x, { directive:'Summarize crypto news', agentId:'agent' })), null, 'different work is not noticed');
assert.equal(W.notice(Object.assign({}, x, { directive:'AI news summary', agentId:'nova' })), null, 'other agent');
assert.equal(W.notice(Object.assign({}, x, { directive:'AI news summary', agentId:'agent', now: x.briefs[1].completedAt + 3600000 })), null, 'same session is a follow-up');
x.briefs.pop(); x.runs.pop();
assert.equal(W.notice(Object.assign({}, x, { directive:'AI news summary', agentId:'agent' })), null, 'second ask is not a habit yet');
x = habitInput(); x.briefs.pop(); x.runs.pop(); x.enabled = false;
assert.equal(W.notice(Object.assign({}, x, { directive:'AI news summary', agentId:'agent' })), null, 'personalization paused');
// cadence suggestions stay honest
const at = (d, h) => new Date(2026, 8, d, h, 10).getTime();
assert.equal(W.suggestCadence([at(7,9), at(14,9), at(21,10)]).schedule, '0 9 * * 1', 'same weekday weekly');
assert.equal(W.suggestCadence([at(1,8), at(2,8), at(3,9)]).schedule, '0 8 * * *');
assert.equal(W.suggestCadence([at(1,8), at(13,8), at(29,9)]), null, 'no honest rhythm -> no suggestion');
console.log('workflow-takeover: repeat sense (paraphrase, guards, notice, cadence) passed');
// The lead's notice block: offer once, create nothing unasked, name the cadence.
{
  const CC = require('../sidecar/commander-context.js');
  const block = CC.compose({ standingWork: { count: 3, dates: [now - 2 * DAY, now - DAY], quotes: ['AI news recap please'],
    suggest: { display: 'every day at 9 AM', why: 'you asked about daily 9 AM' } } });
  assert.match(block, /<standing_work_notice/); assert.match(block, /3 times on separate days/);
  assert.match(block, /every day at 9 AM/); assert.match(block, /Create nothing unless they say yes/);
  assert.equal(CC.compose({ standingWork: { count: 2, dates: [] } }), '', 'fewer than three occasions writes nothing');
  console.log('workflow-takeover: standing-work notice block passed');
}
// A chat-only follow-up between occasions is neutral: it neither counts nor resets the streak (live finding 10-01).
{
  const x2 = habitInput();
  x2.briefs.splice(1, 0, { id:'hn', runId:'hrn', agentId:'agent', source:'interactive', originalDirective:'AI news recap please', status:'done', completedAt: now-2*DAY+3600000 });
  x2.runs.push({ runId:'hrn', agentId:'agent', reason:'done', toolsOk:0, projectRoot:'' });
  assert.equal(W.candidates(x2)[0].count, 3, 'a neutral chat-only answer does not break the habit');
  x2.runs[x2.runs.length-1].reason = 'error';
  assert.equal(W.candidates(x2).length, 0, 'a real failure still does');
  console.log('workflow-takeover: neutral follow-ups passed');
}
// AUTOMATION ASK: the routine playbook rides only runs whose request asks for automation.
{
  const CC = require('../sidecar/commander-context.js');
  for (const t of ['every morning at 7 send me a summary of the top AI news', 'Set up whatever automations would help me run my shop',
    'can you automate this?', 'make this a weekly thing', 'remind me to stretch every 2 hours', 'keep an eye on hacker news for local LLM posts'])
    assert.ok(CC.automationIntent(t), 'automation ask: ' + t);
  for (const t of ['summarize this automation article', 'what is cron?', 'how do routines work?', 'write me a tweet about our launch', 'research soy wax suppliers'])
    assert.ok(!CC.automationIntent(t), 'not an automation ask: ' + t);
  const block = CC.compose({ automationAsk: true });
  assert.match(block, /<automation_request/); assert.match(block, /brief_proceed/); assert.match(block, /routine_create in the same turn/); assert.match(block, /Never wait on a connection/);
  assert.equal(CC.compose({ automationAsk: false }), '', 'no ask -> no block');
  console.log('workflow-takeover: automation-ask playbook passed');
}

// UPGRADE (sweep 2026-10-02): a decision 0.12.5 saved has no core, and its id was idFor([agent, project, signature(text)]).
// "Don't offer this again" and a snooze from 0.12.5 still hold in 0.13 — the new id rule (the cluster's oldest member) never
// matched them, so a NEVER was re-offered the day the Commander upgraded.
{
  const crypto = require('node:crypto');
  const legacy = text => 'workflow-' + crypto.createHash('sha256').update(['agent', '', W.signature(text)].join('\n')).digest('hex').slice(0, 24);
  const x0 = input();
  assert.ok(W.candidates(x0).length === 1, 'fixture: the workflow is offered');
  for (const d of [{ never: true }, { until: now + 30 * DAY }]) {
    for (const text of prompts) {
      const xi = input(); xi.state = { v: 1, decisions: [Object.assign({ id: legacy(text), offers: 1, at: now - DAY }, d)] };
      assert.equal(W.candidates(xi).length, 0, 'a 0.12.5 ' + (d.never ? 'NEVER' : 'snooze') + ' (signature of "' + text + '") still holds');
    }
  }
  const other = input(); other.state = { v: 1, decisions: [{ id: legacy('Prepare the quarterly board deck from finance notes'), never: true, offers: 1 }] };
  assert.equal(W.candidates(other).length, 1, 'a 0.12.5 decision about OTHER work never hides this one');
  console.log('workflow-takeover: 0.12.5 decisions survive the upgrade');
}
