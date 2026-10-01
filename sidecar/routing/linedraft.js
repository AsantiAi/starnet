/* sidecar/routing/linedraft.js — SET IT UP FOR ME (2026-09-30, Andrew: "the easiest conveyor system we can possibly put together … clear
   as day"). The WORKFLOWS window's NEW WORKFLOW turns "what should it make?" into a line to place: which of the starters it offers
   fits, a short plain name, each step's standing instructions, and a first job to send. Nothing is placed here: the window shows the
   draft — the steps, who does them, what each will do — and lays the line on the floor only when the Commander presses CREATE.

   PURE (no IO, no clock): normalizeInput bounds what the window sent (the description, the starters it offers and each one's step
   roles, in order), buildPrompt writes the ONE model prompt, parseDraft reads the model's JSON back and trusts it only for a starter
   that was offered and the roles that starter really has. The caller (index.js handleRoutingLineDraft) makes the one billed call on
   the station's default model (stationOneShot) and books its spend. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LineDraft = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX = { want: 600, starters: 8, roles: 6, purpose: 200, does: 900, name: 32, job: 400 };
  const ROLE_RE = /^[A-Z][A-Z0-9 _-]{0,23}$/;
  const ID_RE = /^[a-z0-9_]{1,40}$/;
  const flat = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

  function normalizeInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const want = flat(b.want, MAX.want);
    if (!want) return { ok: false, error: 'say what you want the workflow to make' };
    const seen = {};
    const starters = (Array.isArray(b.starters) ? b.starters : []).slice(0, MAX.starters).map(s => ({
      id: String((s && s.id) || ''), name: flat(s && s.name, 40), purpose: flat(s && s.purpose, MAX.purpose),
      roles: (Array.isArray(s && s.roles) ? s.roles : []).map(r => flat(r, 24).toUpperCase()).filter(r => ROLE_RE.test(r)).slice(0, MAX.roles),
    })).filter(s => ID_RE.test(s.id) && s.roles.length && !seen[s.id] && (seen[s.id] = 1));
    if (!starters.length) return { ok: false, error: 'there are no ready-made lines to choose from' };
    return { ok: true, want, starters };
  }

  const SYSTEM = 'You set up a work line for someone. A work line is a row of steps. Each step is an AI agent that does one part of '
    + 'every job and hands what it made to the next step; the LAST step\'s reply is the finished result the person receives.\n'
    + 'Pick the ONE starter below that best fits what they want. Give the line a short plain name (2 to 4 words, no quotes). Write the '
    + 'standing instructions for each of its steps, and one first job they could send it.\n'
    + 'Rules:\n'
    + '- Instructions are STANDING: they must suit every job this line will ever get, not only the first one. Say what the step always '
    + 'does and what it hands on. Never copy the first job\'s topic or numbers into them.\n'
    + '- Write each step\'s instructions to the agent, in plain words, 1 to 4 sentences. Where they said how the result should look '
    + '(format, length, tone, audience), put that in the LAST step\'s instructions.\n'
    + '- Use only the starters and roles given, and write instructions for every role of the starter you pick.\n'
    + '- The first job is one short sentence in their own words, ready to send today.\n'
    + 'Reply with JSON only, nothing else: {"starter":"<id>","name":"...","steps":{"<ROLE>":"<instructions>"},"job":"..."}';

  function buildPrompt(input) {
    const rows = input.starters.map(s => '- ' + s.id + ' ("' + s.name + '"): ' + (s.purpose || 'a work line') + '. Steps, in order: ' + s.roles.join(' → '));
    return { system: SYSTEM, user: 'What they want the line to make:\n"""\n' + input.want + '\n"""\n\nThe starters:\n' + rows.join('\n') };
  }

  // the first {...} in a reply that parses (a model may wrap its JSON in a sentence or a code fence)
  function firstObject(text) {
    const s = String(text == null ? '' : text);
    for (let i = s.indexOf('{'); i >= 0; i = s.indexOf('{', i + 1)) {
      let depth = 0, inStr = false, esc = false;
      for (let j = i; j < s.length; j++) {
        const c = s[j];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) { try { const o = JSON.parse(s.slice(i, j + 1)); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch (_) {} break; }
      }
    }
    return null;
  }

  function parseDraft(text, input) {
    const o = firstObject(text);
    if (!o) return { ok: false, error: 'the station\'s model did not answer with a line — try again, or pick one below' };
    const s = input.starters.find(x => x.id === String(o.starter || '').trim());
    if (!s) return { ok: false, error: 'the station\'s model picked a line that was not offered — try again, or pick one below' };
    const steps = (o.steps && typeof o.steps === 'object') ? o.steps : {};
    const byRole = {};
    for (const k of Object.keys(steps)) byRole[flat(k, 24).toUpperCase()] = steps[k];
    const briefs = {};
    for (const role of s.roles) {
      const t = String(byRole[role] == null ? '' : byRole[role]).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, MAX.does);
      if (t) briefs[role] = t;
    }
    if (!Object.keys(briefs).length) return { ok: false, error: 'the station\'s model wrote no instructions for the steps — try again, or pick one below' };
    const name = flat(o.name, 60).replace(/^["'“”]+|["'“”]+$/g, '').slice(0, MAX.name).trim();
    return { ok: true, starter: s.id, name: name || s.name, briefs, job: flat(o.job, MAX.job) };
  }

  return { MAX, SYSTEM, normalizeInput, buildPrompt, parseDraft, firstObject };
});
