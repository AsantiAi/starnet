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
const WORDS_KEEP = 6;          // corrections remembered per rated run (oldest fall off)
const EDITED_CHARS = 700;      // cap for a Commander-edited record plus appended words
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

// the words joined NEWEST-FIRST-KEPT under the cap: when a run collects more corrections than fit, the oldest
// fall off, never the newest (a cap that kept the first words would silently ignore every later correction).
function newestWords(words) {
  const keep = [];
  let used = 0;
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    if (keep.length && used + w.length + 3 > WORDS_CHARS) break;
    keep.unshift(w); used += w.length + 3;
  }
  return keep.join(' · ');
}

// looksLikeFeedback(text) — is a TYPED message (sent right after a short-of-the-mark rating) actually about the work?
// The chat treats the next message to that agent within 10 minutes as the correction; that was harmless when it only
// fed a one-shot review, but a permanent taste record built from "now summarize my inbox" would tell every future run
// the Commander DISLIKED that. Evaluative cues only; a chip or a rating-body correction is explicit and skips this.
const FEEDBACK_CUES = /\b(too|shorter|longer|tighter|simpler|clearer|more|less|fewer|instead|rather|prefer|should(n'?t)?|don'?t|do not|never|always|wrong|missed|missing|forgot|not what|not quite|not enough|need(s|ed)? (to|more|less)|wanted|meant|keep it|make it|use (bullets|a table|headers|plain)|format|tone|style|length|verbose|wordy|boring|generic|vague|off)\b/i;
function looksLikeFeedback(text) {
  const t = String(text == null ? '' : text).trim();
  return !!t && t.length <= 400 && FEEDBACK_CUES.test(t);
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
  if (add && prev && words.indexOf(add) >= 0) return null;   // a repeated chip/message teaches nothing new
  if (add) { words.push(add); while (words.length > WORDS_KEEP) words.shift(); }
  const directive = (prev && prev.feedbackDirective) || clean(input.directive, DIRECTIVE_CHARS);
  // THE COMMANDER EDITED IT in the Memory Core (content no longer what this module generated): their wording is the
  // truth now — append the new words to it, never regenerate over it.
  // (sticky: once edited, a record is never regenerated again — feedbackEdited survives our own later appends)
  // Only the COMMANDER's edit counts (confirmation stays user-confirmed through a Memory Core edit). An agent's
  // notebook.write replaceId leaves it 'inferred': that rewrite is not their wording, so it is regenerated over.
  if (prev && prev.confirmation === 'user-confirmed' && (prev.feedbackEdited || (prev.feedbackGenerated && String(prev.content || prev.body || '') !== prev.feedbackGenerated))) {
    if (!add) return null;
    const tail = ' · also: "' + add + '"';
    const edited = clean(prev.content || prev.body, EDITED_CHARS - tail.length) + tail;
    const rec = Object.assign({}, prev, { body: edited, content: edited, feedbackGenerated: edited, feedbackEdited: true, feedbackWords: words, updatedAt: now, lastFeedbackAt: now, feedbackAt: now });
    const out = list.slice(); out[at] = rec;
    return { list: out, rec, created: false };
  }
  const text = content(verdict, newestWords(words), directive);
  if (!text) return null;
  if (prev && prev.content === text) return null;   // nothing new
  if (prev) {
    const rec = Object.assign({}, prev, { body: text, content: text, feedbackGenerated: text, feedbackWords: words, updatedAt: now, lastFeedbackAt: now, feedbackAt: now, confirmation: 'user-confirmed', feedbackEdited: false });
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
    feedbackVerdict: verdict, feedbackWords: words, feedbackDirective: directive, feedbackGenerated: text,
    createdAt: now, ts: now, updatedAt: now, lastFeedbackAt: now, feedbackAt: now, lastUsedAt: null, useCount: 0, trust, pinned: false
  };
  return { list: list.concat([rec]), rec, created: true };
}

// directiveFor(candidates, messages) — what the rated work was ABOUT, for the "(on: …)" citation. A run started by
// "yes" (accepting the agent's offer) is titled "yes", which cites nothing: skip bare short turns and fall back to
// the most recent substantive user turn in the run's transcript.
function substantive(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length >= 3; }
function directiveFor(candidates, messages) {
  for (const c of (Array.isArray(candidates) ? candidates : [])) if (substantive(c)) return String(c).trim();
  const msgs = Array.isArray(messages) ? messages : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.role === 'user' && typeof m.content === 'string' && substantive(m.content) && !/^\s*</.test(m.content)) return m.content.trim();
  }
  return String((Array.isArray(candidates) && candidates.find(c => String(c || '').trim())) || '').trim();
}

/* TASTE IS THE COMMANDER'S OWN WORDS (sweep 2026-10-02). notebook.write { replaceId } keeps a record's origin, so an
   agent (or a page it read) could rewrite a feedback record and have it injected into EVERY agent's runs as "the
   Commander's own verdicts". A revision the Commander did not confirm is 'inferred': it is not taste. */
function isTaste(r) { return !!(r && r.origin === ORIGIN && r.confirmation === 'user-confirmed' && String(r.content || r.body || '').trim()); }

// selectTaste(records, opts) -> the newest feedback records (most recently given or updated first), capped.
function selectTaste(records, opts) {
  opts = opts || {};
  const limit = opts.limit || TASTE_LIMIT;
  // newest VERDICT first: feedbackAt is written only by apply(); lastFeedbackAt/updatedAt also move when an agent rates
  // or touches a memory, which pushed the Commander's newest verdict out of the capped block (older records: createdAt)
  const at = r => Number(r.feedbackAt) || Number(r.createdAt || r.ts) || 0;
  return (Array.isArray(records) ? records : []).filter(isTaste).slice().sort((a, b) => at(b) - at(a)).slice(0, limit);
}

// stationTaste(own, others, opts) — the Commander's taste is about THE COMMANDER, not one agent: a correction given
// to a specialist must shape the overseer's next deliverable too. Merge this agent's own feedback records with every
// other agent's, newest first. Foreign copies lose their id (an id is only meaningful in its own notebook: rendered,
// it would invite notebook.feedback on the wrong record, and recall's useCount bump would hit a same-numbered local
// note). The same belief given twice (same text) appears once, own copy preferred.
function stationTaste(own, others, opts) {
  const mine = (Array.isArray(own) ? own : []).filter(isTaste);
  const seen = new Set(mine.map(r => String(r.content || r.body).trim()));
  const foreign = [];
  for (const list of (Array.isArray(others) ? others : [])) {
    for (const r of (Array.isArray(list) ? list : [])) {
      if (!isTaste(r)) continue;
      const key = String(r.content || r.body).trim();
      if (seen.has(key)) continue;
      seen.add(key);
      foreign.push(Object.assign({}, r, { id: '', foreign: true }));
    }
  }
  return selectTaste(mine.concat(foreign), opts);
}

module.exports = { ORIGIN, TASTE_HEADER, TASTE_LIMIT, TASTE_CHARS, content, apply, directiveFor, looksLikeFeedback, isTaste, selectTaste, stationTaste };
