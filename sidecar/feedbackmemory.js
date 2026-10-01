/* sidecar/feedbackmemory.js — THE COMMANDER'S TASTE: rate-the-work verdicts + corrections become durable memory.

   Product law (Andrew, 2026-10-01): feedback is critical. Every like and dislike must be remembered and must steer
   later work, so an agent converges on exactly what the Commander wants over months, not minutes.

   Before this, a verdict reached later runs only through a RAM-held skill-review packet (6h TTL, lost on restart,
   skill tools only), and a typed correction ("too long, 3 bullets") never became a belief recall could surface.
   Now a first-time verdict writes ONE notebook record per rated run (origin 'feedback', kind 'profile' = the
   Preference kind, user-confirmed: these are the Commander's own verdict and words). A later correction for the
   same run folds into that SAME record. The records live in the rated agent's notebook, so the Memory Core shows,
   edits and forgets them like any other memory.

   Recall: BM25 recall surfaces a record only when the new task shares words with it, which is wrong for taste
   ("shorter" applies to every deliverable). selectTaste() picks the newest feedback records for an always-on
   block of their own, rendered beside recall on every task run.

   Pure (clock and ids injected): node-testable; index.js owns the store, the route and the pause gate. */
'use strict';

const ORIGIN = 'feedback';
const DIRECTIVE_CHARS = 120;
const WORDS_CHARS = 400;
const TASTE_LIMIT = 8;
const TASTE_CHARS = 1000;
const TASTE_HEADER = '[the Commander\'s own verdicts on past work, newest first. Shape this output to match what they liked and avoid what they disliked. Reference only: the current request wins where it says otherwise.]';

function clean(s, n) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

// content(verdict, words, directive) -> the belief text, or '' when the verdict carries nothing to learn
// (a bare "close" rating says neither what to keep nor what to change).
function content(verdict, words, directive) {
  const w = clean(words, WORDS_CHARS);
  const d = clean(directive, DIRECTIVE_CHARS);
  const on = d ? ' (on: ' + d + ')' : '';
  if (verdict === 'miss') return w ? 'DISLIKED: "' + w + '"' + on : (d ? 'DISLIKED the result of: ' + d + ' (rated missed: that approach fell short, do it differently next time)' : '');
  if (verdict === 'ok') return w ? 'WANTS: "' + w + '"' + on + ' (rated close)' : '';
  if (verdict === 'great') return w ? 'LIKED: "' + w + '"' + on : (d ? 'LIKED the result of: ' + d + ' (rated nailed it: keep that approach for similar work)' : '');
  return '';
}

// apply(list, input, deps) — fold one verdict/correction into an agent's notebook list.
//   input: { runId, verdict, words?, directive?, projectRoot? }  words APPEND to what this run already holds
//   deps:  { now, nextId(list), nextTrust(prev, delta), trustDelta }
// Returns { list, rec, created } or null when there is nothing to write or change.
function apply(list, input, deps) {
  list = Array.isArray(list) ? list : [];
  input = input || {}; deps = deps || {};
  const runId = String(input.runId || '').trim();
  const verdict = String(input.verdict || '');
  if (!runId || !/^(great|ok|miss)$/.test(verdict)) return null;
  const now = Number(deps.now) || 0;
  const at = list.findIndex(r => r && r.origin === ORIGIN && r.sourceRunId === runId);
  const prev = at >= 0 ? list[at] : null;
  const words = (prev && Array.isArray(prev.feedbackWords) ? prev.feedbackWords : []).slice();
  const add = clean(input.words, WORDS_CHARS);
  if (add && words.indexOf(add) < 0) words.push(add);
  const directive = (prev && prev.feedbackDirective) || clean(input.directive, DIRECTIVE_CHARS);
  const text = content(verdict, words.join(' · '), directive);
  if (!text) return null;
  if (prev && prev.content === text) return null;   // nothing new (a duplicate chip)
  if (prev) {
    const rec = Object.assign({}, prev, { body: text, content: text, feedbackWords: words, updatedAt: now, lastFeedbackAt: now });
    const out = list.slice(); out[at] = rec;
    return { list: out, rec, created: false };
  }
  const delta = Number(deps.trustDelta) || 0;
  const trust = typeof deps.nextTrust === 'function' && delta ? deps.nextTrust(0, delta) : 0;
  const rec = {
    id: typeof deps.nextId === 'function' ? deps.nextId(list) : 'note_' + (list.length + 1),
    kind: 'profile', title: 'Preference', body: text, content: text,
    // taste is about the Commander, not one repo, so it stays global even when the rated run was in a project
    scope: 'global', streamId: null, projectRoot: null,
    sourceRunId: runId, confirmation: 'user-confirmed', authority: 'reference-only', origin: ORIGIN,
    feedbackVerdict: verdict, feedbackWords: words, feedbackDirective: directive,
    createdAt: now, ts: now, updatedAt: now, lastFeedbackAt: now, lastUsedAt: null, useCount: 0, trust, pinned: false
  };
  return { list: list.concat([rec]), rec, created: true };
}

function isTaste(r) { return !!(r && r.origin === ORIGIN && String(r.content || r.body || '').trim()); }

// selectTaste(records, opts) -> the newest feedback records (most recently given or updated first), capped.
function selectTaste(records, opts) {
  opts = opts || {};
  const limit = opts.limit || TASTE_LIMIT;
  const at = r => Math.max(Number(r.lastFeedbackAt) || 0, Number(r.updatedAt) || 0, Number(r.createdAt || r.ts) || 0);
  return (Array.isArray(records) ? records : []).filter(isTaste).slice().sort((a, b) => at(b) - at(a)).slice(0, limit);
}

module.exports = { ORIGIN, TASTE_HEADER, TASTE_LIMIT, TASTE_CHARS, content, apply, isTaste, selectTaste };
