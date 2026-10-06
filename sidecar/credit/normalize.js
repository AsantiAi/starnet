/* sidecar/credit/normalize.js — pure normalizers for the three-bureau report.
   Money becomes integer dollars or null. Dates become ISO (YYYY-MM-DD) or null.
   A value that is not a recognizable money amount or date stays null: this module does not guess.
   Names on the Identification table are LAST FIRST; intake names are compared as token sets so a
   middle initial does not produce a false consumer mismatch. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; (root.SK.credit = root.SK.credit || {}).normalize = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  };

  function clean(s) {
    if (s == null) return '';
    return String(s).replace(/\s+/g, ' ').trim();
  }

  function isBlank(s) {
    const t = clean(s);
    return !t || t === 'N/A' || t === 'NA' || t === '--' || t === '—';
  }

  function textOrNull(s) {
    return isBlank(s) ? null : clean(s);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function iso(y, m, d) {
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  /* Full dates only. "Mar 2018" has no day, and inventing one would be a guess, so it is null. */
  function parseDate(s) {
    if (isBlank(s)) return null;
    const t = clean(s);
    let m = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(t);
    if (m && MONTHS[m[1].toLowerCase()]) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
    if (m) {
      let y = +m[3];
      if (y < 100) y += (y >= 70 ? 1900 : 2000);
      return iso(y, +m[1], +m[2]);
    }
    return null;
  }

  function parseMoney(s) {
    if (isBlank(s)) return null;
    const t = clean(s).replace(/\$/g, '').replace(/,/g, '');
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(t)) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return Math.round(n);
  }

  function parseCount(s) {
    if (isBlank(s)) return null;
    const t = clean(s);
    if (!/^\d+$/.test(t)) return null;
    return parseInt(t, 10);
  }

  function last4of(s) {
    if (isBlank(s)) return null;
    const m = clean(s).match(/(\d{4})\s*$/);
    return m ? m[1] : null;
  }

  function yesNo(s) {
    const t = clean(s).toLowerCase();
    if (t === 'yes') return true;
    if (t === 'no') return false;
    return null;
  }

  function nameTokens(s) {
    return clean(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(t => t.length > 1);
  }

  /* Order-independent. "Alex R. Testperson" and the report's "Testperson Alex" share the same tokens
     once the single-letter middle initial is dropped. */
  function namesMatch(intakeName, reportedName) {
    const a = nameTokens(intakeName);
    const b = nameTokens(reportedName);
    if (a.length < 2 || b.length < 2 || a.length !== b.length) return false;
    const sb = new Set(b);
    return a.every(t => sb.has(t));
  }

  function sameLast4(a, b) {
    const x = String(a == null ? '' : a).replace(/\D/g, '');
    const y = String(b == null ? '' : b).replace(/\D/g, '');
    if (x.length < 4 || y.length < 4) return false;
    return x.slice(-4) === y.slice(-4);
  }

  function normBureau(s) {
    const t = clean(s).toLowerCase();
    if (t === 'eq' || t === 'equifax') return 'equifax';
    if (t === 'ex' || t === 'experian') return 'experian';
    if (t === 'tu' || t === 'transunion') return 'transunion';
    return t;
  }

  /* Inquiry and furnisher names. BK and CU are the abbreviations this report actually uses. */
  function normCompany(s) {
    let t = clean(s).toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ');
    t = t.replace(/\bBK\b/g, 'BANK').replace(/\bCU\b/g, 'CREDIT UNION');
    t = t.replace(/\bSVCS\b/g, 'SERVICES').replace(/\bSVC\b/g, 'SERVICE');
    return t.replace(/\s+/g, ' ').trim();
  }

  const COMPANY_DROP = new Set(['CARD', 'CARDS', 'SERVICE', 'SERVICES', 'STORE', 'THE', 'ACCOUNT']);

  function companyTokens(s) {
    return normCompany(s).split(' ').filter(t => t && !COMPANY_DROP.has(t));
  }

  function companyMatch(a, b) {
    const ta = companyTokens(a);
    const tb = companyTokens(b);
    if (!ta.length || !tb.length) return false;
    const sa = new Set(ta);
    const sb = new Set(tb);
    const subset = (x, y) => x.every(t => y.has(t));
    return subset(ta, sb) || subset(tb, sa);
  }

  function akaEntries(lines) {
    const entries = [];
    let buf = '';
    const flush = () => {
      const s = clean(buf);
      if (s && s !== 'N/A') entries.push(s);
      buf = '';
    };
    for (const line of (lines || [])) {
      const t = clean(line);
      if (!t || t === 'N/A') continue;
      if (t.endsWith(',')) {
        buf = (buf ? buf + ' ' : '') + t.slice(0, -1).trim();
        flush();
      } else {
        buf = (buf ? buf + ' ' : '') + t;
      }
    }
    flush();
    return entries;
  }

  function scrubSensitive(s) {
    return String(s == null ? '' : s)
      .replace(/\b\d{3}-?\d{2}-?(\d{4})\b/g, 'XXX-XX-$1')
      .replace(/\b\d{12,}\b/g, (m) => 'xxxx' + m.slice(-4));
  }

  return {
    clean, isBlank, textOrNull, parseDate, parseMoney, parseCount, last4of, yesNo,
    nameTokens, namesMatch, sameLast4, normBureau, normCompany, companyMatch, akaEntries, scrubSensitive
  };
});
