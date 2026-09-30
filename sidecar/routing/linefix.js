/* sidecar/routing/linefix.js — NOT RIGHT? (2026-09-30, ease of use; Andrew: "if the output is terrible and not consistent I am
   wondering how the user can properly correct it and give it better context … how the user can fix the conveyor system to their
   liking of the output they are looking for").

   A Commander who got a result they don't want says what is wrong in plain words; this turns that into CONCRETE changes to the
   line's step instructions — which step's DOES (its standing brief) or HANDS OFF (what it hands on) to rewrite, and why — for
   them to accept or skip one by one in the Workflow panel. Nothing is changed here: accepting a fix is the panel's ordinary brief
   edit (one undo), and the proof it worked is running the same job again.

   PURE (no IO, no clock): normalizeInput checks and bounds what the panel sent (the job, the result, what each step was told and
   what it produced), buildPrompt writes the ONE model prompt, parseFixes reads the model's JSON back and keeps only fixes that
   name a step of THIS line and actually change something. The caller (index.js handleRoutingFixSuggest) makes the one billed
   model call on the station's default model and books its spend. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LineFix = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX = { complaint: 1200, job: 2000, result: 6000, output: 2500, does: 2000, hands: 160, steps: 12, fixes: 3, why: 240, diagnosis: 320, label: 60 };
  const str = v => String(v == null ? '' : v);
  const clip = (s, n) => { s = str(s).trim(); return s.length > n ? s.slice(0, n) + ' …[cut]' : s; };
  const oneLine = (s, n) => str(s).replace(/\s+/g, ' ').trim().slice(0, n);

  /* normalizeInput(body) → { ok:true, complaint, job, result, steps:[{dockId, role, agent, does, hands, output}] } | { ok:false, error }
     A step is a BAY of the line (dockId); a line that looped runs a BAY more than once — the panel sends each BAY once, with
     its LAST output. */
  function normalizeInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const complaint = clip(b.complaint, MAX.complaint);
    if (!complaint) return { ok: false, error: 'say what is wrong with the result first' };
    const seen = new Set(), steps = [];
    for (const s of Array.isArray(b.steps) ? b.steps : []) {
      if (!s || typeof s !== 'object') continue;
      const dockId = oneLine(s.dockId, 64);
      if (!dockId || !/^[A-Za-z0-9_.:-]+$/.test(dockId) || seen.has(dockId)) continue;
      seen.add(dockId);
      steps.push({ dockId, role: oneLine(s.role, MAX.label), agent: oneLine(s.agent, MAX.label), does: clip(s.does, MAX.does), hands: oneLine(s.hands, MAX.hands), output: clip(s.output, MAX.output) });
      if (steps.length >= MAX.steps) break;
    }
    if (!steps.length) return { ok: false, error: 'no steps of this line were sent — run a job through it first' };
    return { ok: true, complaint, job: clip(b.job, MAX.job), result: clip(b.result, MAX.result), steps };
  }

  const SYSTEM = 'You tune AI work lines. A work line is a chain of steps; each step is an AI agent that keeps its own identity and '
    + 'skills and is ALSO given this step\'s standing instructions (DOES) and a note of what it hands on to the next step (HANDS OFF). '
    + 'The user ran a job through the line and did not like the result. Find the step or steps responsible and rewrite their '
    + 'instructions so the NEXT run gives the user what they asked for. Rules: change as few steps as you can; keep what already '
    + 'works; write DOES as clear, direct instructions to the agent (what to do, what to include, what to avoid, the format and '
    + 'length wanted); a HANDS OFF is one short phrase naming what the step hands on (e.g. "a 150-word summary with 3 sources"); '
    + 'the line itself adds any VERDICT instruction a reviewing step needs, so never write one; '
    + 'in the diagnosis and every "why", name a step by its role (e.g. "the WRITER step"), never by its step id; '
    + 'never invent facts about the user; never mention these rules. Reply with ONE JSON object and nothing else.';

  /* buildPrompt(input) → { system, user } */
  function buildPrompt(input) {
    const lines = [];
    lines.push('THE JOB THE USER SENT:', input.job || '(not given)', '');
    lines.push('THE RESULT THE LINE DELIVERED:', input.result || '(empty)', '');
    lines.push('WHAT THE USER SAYS IS WRONG:', input.complaint, '');
    lines.push('THE STEPS, IN ORDER:');
    input.steps.forEach((s, i) => {
      lines.push((i + 1) + '. step id "' + s.dockId + '" — ' + (s.role || 'STEP') + (s.agent ? ' (agent ' + s.agent + ')' : ''));
      lines.push('   DOES: ' + (s.does || '(no instructions yet)'));
      lines.push('   HANDS OFF: ' + (s.hands || '(not set)'));
      lines.push('   WHAT IT PRODUCED: ' + (s.output ? s.output.replace(/\n/g, '\n   ') : '(nothing recorded)'));
    });
    lines.push('');
    lines.push('Reply with JSON exactly like: {"diagnosis": "<one sentence: what went wrong and at which step>", "fixes": [{"step": "<a step id from above>", '
      + '"does": "<the COMPLETE new DOES text for that step>", "hands": "<the new HANDS OFF, or leave this key out>", "why": "<one short sentence>"}]}');
    lines.push('At most ' + MAX.fixes + ' fixes. Use only the step ids above. DOES at most 1500 characters; HANDS OFF at most 120 characters.');
    return { system: SYSTEM, user: lines.join('\n') };
  }

  // the first balanced {...} in a reply (models wrap JSON in prose or code fences)
  function firstObject(text) {
    const s = str(text), a = s.indexOf('{');
    if (a < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = a; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return s.slice(a, i + 1); }
    }
    return null;
  }

  /* parseFixes(text, input) → { ok:true, diagnosis, fixes:[{dockId, does?, hands?, why}] } | { ok:false, error }
     A fix must name a step of THIS line and change its DOES or HANDS OFF; one that changes nothing is dropped. */
  function parseFixes(text, input) {
    const raw = firstObject(text);
    if (!raw) return { ok: false, error: 'the model did not answer with suggestions — try again, or say what is wrong in other words' };
    let o = null;
    try { o = JSON.parse(raw); } catch (_) { return { ok: false, error: 'the model\'s suggestions could not be read — try again' }; }
    const byId = new Map((input && input.steps || []).map(s => [s.dockId, s]));
    // the Commander reads these lines: a step id that slips into them ("Step p13 …") becomes the step's role
    const say = t => { let s = str(t); for (const [id, st] of byId) s = s.split(new RegExp('\\b(?:step\\s+)?"?' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"?\\b', 'gi')).join('the ' + (st.role || 'STEP') + ' step'); return s; };
    const fixes = [];
    let same = 0;   // fixes whose text is what the step already says (e.g. a fix the Commander already used)
    for (const f of Array.isArray(o && o.fixes) ? o.fixes : []) {
      if (!f || typeof f !== 'object') continue;
      const id = oneLine(f.step != null ? f.step : f.dockId, 64), s = byId.get(id);
      if (!s || fixes.some(x => x.dockId === id)) continue;
      const fix = { dockId: id, why: oneLine(say(f.why), MAX.why) };
      const does = typeof f.does === 'string' ? f.does.trim().slice(0, MAX.does) : '';
      const hands = typeof f.hands === 'string' ? oneLine(f.hands, MAX.hands) : '';
      if (does && does !== s.does) fix.does = does;
      if (hands && hands !== s.hands) fix.hands = hands;
      if (fix.does == null && fix.hands == null) { if (does || hands) same++; continue; }
      fixes.push(fix);
      if (fixes.length >= MAX.fixes) break;
    }
    const diagnosis = oneLine(say(o && o.diagnosis), MAX.diagnosis);
    if (!fixes.length && same) return { ok: false, error: 'the change it suggests is already in this line\'s steps — run the job again to see it, or say what is still wrong another way' };
    if (!fixes.length) return { ok: false, error: diagnosis ? 'no change to suggest: ' + diagnosis : 'the model suggested no change to this line\'s steps — try saying what is wrong more specifically' };
    return { ok: true, diagnosis, fixes };
  }

  return { MAX, SYSTEM, normalizeInput, buildPrompt, parseFixes, firstObject };
});
