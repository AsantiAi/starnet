/* test/linedraft.test.js — SET IT UP FOR ME (sidecar/routing/linedraft.js, 2026-09-30): "what should it make?" becomes a line to place.
   Pure: what the window sends is bounded and checked, the one prompt carries every offered starter and the standing-instruction
   rules, and the model's reply is trusted only for a starter that was offered and the roles that starter really has. */
'use strict';
const A = require('./_assert.js');
const D = require('../sidecar/routing/linedraft.js');

const starters = [
  { id: 'research_line', name: 'Research + write', purpose: 'one agent digs up sources, the next writes the answer', roles: ['RESEARCHER', 'writer'] },
  { id: 'front_desk', name: 'One agent', purpose: 'one agent does each job', roles: ['GENERALIST'] },
  { id: 'Bad Id!', name: 'x', roles: ['X'] },
  { id: 'research_line', name: 'dup', roles: ['A'] },
  { id: 'no_roles', name: 'y', roles: [] },
];
const inp = D.normalizeInput({ want: '  a weekly   AI news digest\nfor my newsletter ', starters });
A.ok(inp.ok && inp.want === 'a weekly AI news digest for my newsletter', 'the description is flattened and bounded');
A.ok(inp.starters.map(s => s.id).join() === 'research_line,front_desk' && inp.starters[0].roles.join() === 'RESEARCHER,WRITER', 'only well-formed, distinct starters with roles are offered (roles upper-cased)');
A.ok(!D.normalizeInput({ want: ' ', starters }).ok && /say what you want/.test(D.normalizeInput({ starters }).error), 'no description → refused, with the reason');
A.ok(!D.normalizeInput({ want: 'x', starters: [] }).ok, 'nothing to choose from → refused');

const pr = D.buildPrompt(inp);
A.ok(/research_line \("Research \+ write"\): one agent digs up sources, the next writes the answer\. Steps, in order: RESEARCHER → WRITER/.test(pr.user) && pr.user.indexOf('a weekly AI news digest for my newsletter') > 0, 'the prompt carries the description and every offered starter with its steps');
A.ok(/STANDING: they must suit every job this line will ever get/.test(pr.system) && /Never copy the first job's topic or numbers/.test(pr.system), 'instructions are standing: they never bake in the first job (the linefix lesson)');
A.ok(/LAST step's instructions/.test(pr.system) && /Reply with JSON only/.test(pr.system), '…the result\'s shape goes in the LAST step; the answer is JSON');

const ok = D.parseDraft('Sure!\n```json\n' + JSON.stringify({ starter: 'research_line', name: '“AI news digest”', steps: { researcher: 'Find the week\'s AI news.\n\n  Hand on the facts.', WRITER: 'Write a short section.', EDITOR: 'not a step of this line' }, job: '  This week in AI  ' }) + '\n```', inp);
A.ok(ok.ok && ok.starter === 'research_line' && ok.name === 'AI news digest' && ok.job === 'This week in AI', 'a fenced reply is read; the name loses its quotes');
A.ok(JSON.stringify(Object.keys(ok.briefs)) === '["RESEARCHER","WRITER"]' && ok.briefs.RESEARCHER === 'Find the week\'s AI news.\nHand on the facts.', 'instructions only for the line\'s own roles (any case), tidied');
A.ok(!D.parseDraft(JSON.stringify({ starter: 'mission_control', steps: { X: 'y' } }), inp).ok && /not offered/.test(D.parseDraft(JSON.stringify({ starter: 'mission_control' }), inp).error), 'a line that was not offered is never trusted');
A.ok(!D.parseDraft(JSON.stringify({ starter: 'front_desk', steps: { WRITER: 'wrong role' } }), inp).ok, 'no instructions for the starter\'s own steps → refused');
A.ok(!D.parseDraft('I think you want a research line.', inp).ok, 'no JSON → refused');
const plain = D.parseDraft(JSON.stringify({ starter: 'front_desk', steps: { GENERALIST: 'Do the job well.' } }), inp);
A.ok(plain.ok && plain.name === 'One agent' && plain.job === '', 'no name → the starter\'s own name; no first job → empty');
A.ok(D.firstObject('a {not json} then {"a":{"b":"}"}} tail').a.b === '}', 'the first object that parses, braces in strings respected');

A.report('linedraft.test');
