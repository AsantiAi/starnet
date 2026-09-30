/* test/linefix.test.js — NOT RIGHT? (sidecar/routing/linefix.js): a Commander's "what's wrong" becomes concrete, checked changes to a
   line's step instructions. The module is pure: what the panel sends is bounded and checked, the one prompt carries every step's
   instructions AND what it produced, and the model's reply is only trusted for steps of THIS line that it really changes. */
'use strict';
const A = require('./_assert.js');
const L = require('../sidecar/routing/linefix.js');

const body = {
  complaint: 'Way too long. I wanted two short sentences.',
  job: 'Write about why sleep matters.',
  result: 'Sleep matters for many reasons. ' .repeat(20),
  steps: [
    { dockId: 'p11', role: 'WRITER', agent: 'NOVA', does: 'Write a 200-word digest.', hands: 'a 200-word draft', output: 'A long draft…' },
    { dockId: 'p11', role: 'WRITER', agent: 'NOVA', does: 'dup', hands: '', output: 'a second pass of the same BAY' },
    { dockId: 'bad id!', role: 'X', does: '', output: '' },
    { dockId: 'p13', role: 'REVIEWER', agent: 'NOVA', does: 'Check the draft.', hands: '', output: 'Looks fine. VERDICT: approved' }
  ]
};

/* ---------- normalizeInput ---------- */
const inp = L.normalizeInput(body);
A.ok(inp.ok && inp.steps.length === 2 && inp.steps[0].dockId === 'p11' && inp.steps[1].dockId === 'p13', 'each BAY is kept once, in order; a malformed step id is dropped');
A.ok(inp.steps[0].does === 'Write a 200-word digest.', '…the first entry for a BAY is the one kept (the panel sends each BAY once, with its last reply)');
A.ok(!L.normalizeInput(Object.assign({}, body, { complaint: '   ' })).ok && /say what is wrong/.test(L.normalizeInput({ steps: body.steps }).error), 'no complaint → refused with the reason');
A.ok(!L.normalizeInput({ complaint: 'x', steps: [] }).ok, 'no steps → refused');
A.ok(L.normalizeInput(Object.assign({}, body, { complaint: 'x'.repeat(5000) })).complaint.length <= L.MAX.complaint + 10, 'the complaint is bounded');

/* ---------- buildPrompt ---------- */
const p = L.buildPrompt(inp);
A.ok(/Reply with ONE JSON object and nothing else/.test(p.system) && /never write one/.test(p.system), 'the system prompt asks for JSON only and leaves VERDICT lines to the line itself');
A.ok(/WHAT THE USER SAYS IS WRONG:\nWay too long/.test(p.user) && /THE RESULT THE LINE DELIVERED:/.test(p.user), 'the prompt carries the complaint and the result');
A.ok(/step id "p11" — WRITER \(agent NOVA\)/.test(p.user) && /DOES: Write a 200-word digest\./.test(p.user) && /HANDS OFF: a 200-word draft/.test(p.user) && /WHAT IT PRODUCED: A long draft/.test(p.user),
  '…and every step: what it was told and what it actually produced');

/* ---------- parseFixes ---------- */
const reply = 'Sure! ```json\n' + JSON.stringify({ diagnosis: 'The writer wrote 200 words.', fixes: [
  { step: 'p11', does: 'Answer in two short sentences.', hands: 'two short sentences', why: 'The writer sets the length.' },
  { step: 'p99', does: 'not a step of this line' },
  { step: 'p13', does: 'Check the draft.' },                      // no change → dropped
  { dockId: 'p13', hands: 'x'.repeat(400), why: 'a hands-only fix' }
] }) + '\n```';
const r = L.parseFixes(reply, inp);
A.ok(r.ok && r.diagnosis === 'The writer wrote 200 words.', 'a fenced JSON reply is read, with its diagnosis');
A.ok(r.fixes.length === 2 && r.fixes[0].dockId === 'p11' && r.fixes[0].does === 'Answer in two short sentences.' && r.fixes[0].hands === 'two short sentences', 'a fix names a step of THIS line and what changes');
A.ok(!r.fixes.some(f => f.dockId === 'p99'), 'a fix for a step that is not on the line is dropped');
A.ok(r.fixes[1].dockId === 'p13' && r.fixes[1].does === undefined && r.fixes[1].hands.length === L.MAX.hands, '…one that changes nothing is dropped (the unchanged DOES), and HANDS OFF is bounded');
const many = L.parseFixes(JSON.stringify({ fixes: [1, 2, 3, 4].map(i => ({ step: i % 2 ? 'p11' : 'p13', does: 'new ' + i })) }), inp);
A.ok(many.ok && many.fixes.length === 2, 'one fix per step at most');
A.ok(!L.parseFixes('I cannot help with that.', inp).ok && /did not answer with suggestions/.test(L.parseFixes('no json here', inp).error), 'a reply with no JSON is refused with the reason');
A.ok(!L.parseFixes('{"diagnosis": "It is fine as is.", "fixes": []}', inp).ok && /It is fine as is/.test(L.parseFixes('{"diagnosis": "It is fine as is.", "fixes": []}', inp).error), 'no change to suggest says why');
A.ok(L.firstObject('x {"a": "}{"} y') === '{"a": "}{"}', 'braces inside strings do not end the JSON early');
const leaky = L.parseFixes(JSON.stringify({ diagnosis: 'Step p11 produced an essay.', fixes: [{ step: 'p11', does: 'Three bullets.', why: 'p11 decides the length.' }] }), inp);
A.ok(leaky.ok && leaky.diagnosis === 'the WRITER step produced an essay.' && leaky.fixes[0].why === 'the WRITER step decides the length.', 'a step id that slips into the diagnosis or a why becomes the step\'s role (the Commander never reads "p11")');
A.ok(/name a step by its role/.test(L.SYSTEM), '…and the prompt asks for roles, not ids');
const already = L.parseFixes(JSON.stringify({ diagnosis: 'd', fixes: [{ step: 'p11', does: 'Write a 200-word digest.', hands: 'a 200-word draft' }] }), inp);
A.ok(!already.ok && /already in this line's steps/.test(already.error), 'a suggestion the line already has (a fix already used) says so, instead of "no change"');

A.report('linefix.test');
