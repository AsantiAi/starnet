/* node test/feedbackmemory.test.js — THE COMMANDER'S TASTE (sidecar/feedbackmemory.js).

   Proves: each verdict maps to the right like/dislike belief (and a bare "close" teaches nothing); a record is
   user-confirmed, global, Preference-kind, origin 'feedback', trust-seeded; a later correction folds into the SAME
   record for that run (no second record, words accumulate, a repeated chip changes nothing); selectTaste returns
   the newest feedback first, ignores ordinary notes, and caps; the taste block renders through the real
   renderRecall. The live route + prompt seam is proven in test/feedbackmemory.http.test.js. */
'use strict';
const A = require('./_assert.js');
const FM = require('../sidecar/feedbackmemory.js');
const memcore = require('../sidecar/memcore.js');
const { renderRecall } = require('../sidecar/context.js');

const deps = (now) => ({ now, nextId: memcore.nextNoteId, nextTrust: memcore.nextTrust, trustDelta: 2 });

// ---- content(): verdict -> belief ----
A.ok(/^DISLIKED: "too long, 3 bullets"/.test(FM.content('miss', 'too long, 3 bullets', 'write the weekly report')), 'miss + words = DISLIKED in their words');
A.ok(/DISLIKED the result of: write the weekly report/.test(FM.content('miss', '', 'write the weekly report')), 'bare miss still teaches: that approach fell short');
A.ok(/^LIKED: "loved the table"/.test(FM.content('great', 'loved the table', 'x')), 'great + words = LIKED');
A.ok(/LIKED the result of: summarise the call/.test(FM.content('great', '', 'summarise the call')), 'bare great = keep that approach');
A.ok(/^WANTS: "add sources"/.test(FM.content('ok', 'add sources', 'x')), 'close + words = WANTS');
A.eq(FM.content('ok', '', 'x'), '', 'a bare "close" teaches nothing');
A.eq(FM.content('miss', '', ''), '', 'no words and no directive = nothing to learn');
A.ok(FM.content('miss', 'x'.repeat(2000), 'd').length < 600, 'words are capped');

// ---- apply(): one record per rated run ----
let r = FM.apply([{ id: 'note_1', kind: 'fact', body: 'uses pnpm', content: 'uses pnpm' }], { runId: 'run-a', verdict: 'miss', directive: 'write the weekly report' }, deps(1000));
A.ok(r && r.created, 'a miss creates a record');
const rec = r.rec;
A.eq(rec.id, 'note_2', 'collision-proof id from memcore');
A.eq(rec.origin, 'feedback', 'origin feedback'); A.eq(rec.kind, 'profile', 'Preference kind'); A.eq(rec.title, 'Preference', 'Preference title');
A.eq(rec.confirmation, 'user-confirmed', 'the Commander\'s own verdict is user-confirmed');
A.eq(rec.scope, 'global', 'taste is global (about the Commander, not one repo)');
A.ok(rec.trust > 0, 'trust seeded like a Keep');
A.eq(rec.sourceRunId, 'run-a', 'record names the run that taught it');
A.eq(r.list.length, 2, 'ordinary notes are kept');

let list = r.list;
r = FM.apply(list, { runId: 'run-a', verdict: 'miss', words: 'too long — tighter next time' }, deps(2000));
A.ok(r && !r.created, 'a correction updates the same run\'s record');
A.eq(r.list.length, 2, 'no second record for the same run');
A.ok(/^DISLIKED: "too long — tighter next time" \(on: write the weekly report\)/.test(r.rec.content), 'correction words replace the bare-miss line, directive kept');
A.eq(r.rec.updatedAt, 2000, 'updatedAt moves');
list = r.list;
r = FM.apply(list, { runId: 'run-a', verdict: 'miss', words: 'use bullet points' }, deps(3000));
A.ok(/too long — tighter next time · use bullet points/.test(r.rec.content), 'a typed message after a chip accumulates');
list = r.list;
A.eq(FM.apply(list, { runId: 'run-a', verdict: 'miss', words: 'use bullet points' }, deps(4000)), null, 'a repeated chip changes nothing');
A.eq(FM.apply(list, { runId: 'run-b', verdict: 'ok' }, deps(4000)), null, 'bare close writes nothing');
A.eq(FM.apply(list, { runId: '', verdict: 'miss', words: 'x y' }, deps(4000)), null, 'no runId = nothing');
A.eq(FM.apply(list, { runId: 'run-c', verdict: 'meh', words: 'x y' }, deps(4000)), null, 'unknown verdict = nothing');
r = FM.apply(list, { runId: 'run-b', verdict: 'ok', words: 'cite sources' }, deps(5000));
A.ok(r && r.created && /^WANTS: "cite sources"/.test(r.rec.content), 'close + later words creates its record then');
list = r.list;

// ---- selectTaste(): newest feedback first, ordinary notes ignored, capped ----
const picked = FM.selectTaste(list);
A.eq(picked.map(x => x.sourceRunId).join(','), 'run-b,run-a', 'newest feedback first');
A.ok(picked.every(FM.isTaste), 'only feedback records');
const many = [];
for (let i = 0; i < 20; i++) many.push({ id: 'n' + i, origin: 'feedback', content: 'LIKED: thing ' + i, createdAt: i });
A.eq(FM.selectTaste(many).length, FM.TASTE_LIMIT, 'capped at TASTE_LIMIT');
A.eq(FM.selectTaste(many)[0].id, 'n19', 'newest leads');
A.eq(FM.selectTaste(null).length, 0, 'null-safe');

// ---- the block renders through the real recall renderer with the taste header ----
const block = renderRecall(picked, { limit: FM.TASTE_CHARS, header: FM.TASTE_HEADER });
A.ok(block.text.indexOf('Commander\'s own verdicts') >= 0, 'taste header present');
A.ok(block.text.indexOf('DISLIKED: "too long') >= 0 && block.text.indexOf('WANTS: "cite sources"') >= 0, 'both beliefs render');
A.ok(block.text.indexOf('[user-confirmed reference]') >= 0, 'rendered as user-confirmed');
A.eq(block.usedIds.length, 2, 'both count as used');

A.report("feedbackmemory.test");
