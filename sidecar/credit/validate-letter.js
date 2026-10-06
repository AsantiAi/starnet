/* sidecar/credit/validate-letter.js — checks a dispute-letter draft before it is saved.
   Port of the training-package letter checks: leftover placeholders, non-canonical citations,
   banned phrases, unlisted case law, missing sections, Metro 2 mentions without a field number,
   exclamation marks, emoji, and all-caps shouting. A failure does not delete the draft; the caller
   saves it as DRAFT_NEEDS_FIX. This module has no send, mail, or approve path. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; (root.SK.credit = root.SK.credit || {}).validateLetter = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const C = (typeof require === 'function') ? require('./constants.js') : null;

  const CANON = /(?:15 U\.S\.C\. § (?:1681[a-z0-9-]*(?:\([0-9A-Za-z]+\))*|1692[a-z0-9-]*(?:\([0-9A-Za-z]+\))*)|12 C\.F\.R\. § 1022\.\d+(?:\([0-9A-Za-z]+\))*)/g;

  function fail(list, code, message) { list.push({ code: code, message: message }); }

  function bodyAndDisclaimer(text) {
    const marker = '\n---\n';
    const at = text.lastIndexOf(marker);
    if (at < 0) return { body: text, disclaimer: '' };
    return { body: text.slice(0, at), disclaimer: text.slice(at + marker.length).trim() };
  }

  function checkPlaceholders(text, failures) {
    if (/\{\{/.test(text)) fail(failures, 'PLACEHOLDER', 'letter still contains a {{placeholder}}');
    const brackets = text.match(/\[[^\]\n]*\]/g) || [];
    for (const b of brackets) {
      if (b !== '[signature]') fail(failures, 'PLACEHOLDER', 'unexpected bracket text ' + b);
    }
  }

  function checkCitations(text, failures) {
    const stripped = text.replace(CANON, '');
    if (/section\s+1681/i.test(text) || /§/.test(stripped) || /\b1681|\b1692g|\b1022\./.test(stripped)) {
      fail(failures, 'NONCANONICAL_CITATION', 'every statute cite must be canonical, for example 15 U.S.C. § 1681i(a)(5)(A)');
    }
  }

  /* The identification header quotes the consumer's name and mailing address as supplied.
     Those lines are facts, not emphasis, so an all-caps street from the report is not shouting.
     The Consumer: line repeats the same name. The rest of the letter is still checked. */
  function proseForTone(body) {
    const lines = String(body).split('\n');
    const kept = [];
    let header = true;
    for (const line of lines) {
      if (header) {
        if (/^SSN \(last 4\):/.test(line)) header = false;
        continue;
      }
      if (/^Consumer: /.test(line)) continue;
      kept.push(line);
    }
    return kept.join('\n');
  }

  function checkBanned(body, failures) {
    const phrases = (C && C.BANNED_PHRASES) || [];
    for (const p of phrases) {
      if (p.re.test(body)) fail(failures, p.code, p.message);
    }
    // "does not guarantee" is the required disclaimer. Any other "guarantee" is a promised outcome.
    const withoutNegation = body.replace(/\b(?:does not|do not|cannot|can't|never|not)\s+guarantee\b/ig, '');
    if (/\bguarantee/i.test(withoutNegation)) fail(failures, 'BANNED_PHRASE', 'do not guarantee an outcome, a deletion, or a score change');
    if (/!/.test(body)) fail(failures, 'EXCLAMATION', 'no exclamation marks');
    if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/u.test(body)) {
      fail(failures, 'EMOJI', 'no emoji');
    }
    const allow = (C && C.ALLOWED_ACRONYMS) || new Set();
    const words = proseForTone(body).match(/\b[A-Z]{2,}\b/g) || [];
    const seen = new Set();
    for (const w of words) {
      if (allow.has(w) || seen.has(w)) continue;
      seen.add(w);
      fail(failures, 'ALL_CAPS', 'all-caps word "' + w + '" is not an allowed acronym');
    }
  }

  function checkCases(text, failures) {
    const allowed = (C && C.ALLOWED_CASES) || [];
    let rest = text;
    for (const c of allowed) rest = rest.split(c).join('');
    if (/\bv\./.test(rest)) fail(failures, 'UNLISTED_CASE', 'a "v." citation is not on the allowlist');
  }

  function checkMetro(text, failures) {
    if (/metro\s*2/i.test(text) && !/Field\s+\d+/.test(text)) {
      fail(failures, 'METRO2_FIELD', 'a Metro 2 reference must name the field number (Field NN) and the conflicting field');
    }
  }

  function checkSections(text, failures) {
    const need = [
      [/Date of Birth:/, 'header date of birth'],
      [/SSN \(last 4\):/, 'header SSN last 4'],
      [/\nRe: Formal Dispute of Inaccurate, Incomplete, and Unverifiable Information\n/, 'Re: line'],
      [/To Whom It May Concern:/, 'salutation'],
      [/This is a formal dispute submitted under the Fair Credit Reporting Act, 15 U\.S\.C\. § 1681i\./, 'opening'],
      [/## Disputed Item #/, 'at least one Disputed Item'],
      [/\*\*Nature of the dispute\.\*\*/, 'Nature of the dispute'],
      [/\*\*Identified inaccuracies\.\*\*/, 'Identified inaccuracies'],
      [/\*\*Legal grounds\.\*\*/, 'Legal grounds'],
      [/\*\*Demand\.\*\*/, 'Demand'],
      [/## Procedural demands/, 'Procedural demands'],
      [/\nSincerely,\n/, 'closing'],
      [/\[signature\]/, 'signature line'],
      [/\*\*Enclosures:\*\*/, 'Enclosures'],
      [/Creditor \/ Furnisher:/, 'furnisher identification'],
      [/Account Number \(as reported\):/, 'account number identification'],
      [/Date Opened \(as reported\):/, 'date opened identification'],
      [/High Credit \/ Credit Limit \(as reported\):/, 'high credit identification'],
      [/Reported Status \(as reported on the /, 'reported status identification'],
      [/Date of First Delinquency \(as reported\):/, 'date of first delinquency identification']
    ];
    for (const pair of need) {
      if (!pair[0].test(text)) fail(failures, 'MISSING_SECTION', 'missing ' + pair[1]);
    }
    const bureaus = (C && C.BUREAUS) || {};
    const addressOk = Object.keys(bureaus).some(id => {
      const b = bureaus[id];
      return text.indexOf(b.name + '\n' + b.addressLine1 + '\n' + b.cityStateZip) >= 0;
    });
    if (!addressOk) fail(failures, 'MISSING_SECTION', 'missing a bureau name and address from the constant list');
    const disclaimer = (C && C.DISCLAIMER) || '';
    if (disclaimer && text.indexOf(disclaimer) < 0) fail(failures, 'MISSING_SECTION', 'missing the client-copy disclaimer');
    if (!/^## Disputed Item #/m.test(text)) return;
    const items = text.split(/^## Disputed Item #/m).slice(1);
    items.forEach((chunk, i) => {
      if (!/\*\*Nature of the dispute\.\*\*/.test(chunk)) fail(failures, 'MISSING_SECTION', 'Disputed Item ' + (i + 1) + ' is missing Nature of the dispute');
    });
  }

  function validateLetter(text) {
    const failures = [];
    const src = String(text == null ? '' : text).replace(/\r\n/g, '\n');
    if (!src.trim()) {
      fail(failures, 'MISSING_SECTION', 'letter is empty');
      return { pass: false, failures: failures };
    }
    const parts = bodyAndDisclaimer(src);
    checkPlaceholders(src, failures);
    checkCitations(src, failures);
    checkBanned(parts.body, failures);
    checkCases(src, failures);
    checkMetro(src, failures);
    checkSections(src, failures);
    return { pass: failures.length === 0, failures: failures };
  }

  return { validateLetter };
});
