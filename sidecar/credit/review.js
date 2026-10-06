/* sidecar/credit/review.js — review flags and defect-pattern candidates for a parsed report.
   BLOCK means a letter must not be drafted. REVIEW means a person has to confirm the item.
   INFO is context. Every defect pattern is a suggestion until the intake confirms it; this module
   does not write a letter and does not invent a Metro 2 code from status text. */
'use strict';
(function (root, factory) {
  const norm = (typeof require === 'function') ? require('./normalize.js') : (root.SK && root.SK.credit && root.SK.credit.normalize);
  const api = factory(norm);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; (root.SK.credit = root.SK.credit || {}).review = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (norm) {
  'use strict';

  const COMPARE = [
    ['balance', 'balance'],
    ['amountPastDue', 'amount past due'],
    ['status', 'status'],
    ['dateOpened', 'date opened'],
    ['highCredit', 'high credit'],
    ['dofd', 'date of first delinquency'],
    ['dateClosed', 'date closed']
  ];
  const BUREAUS = ['equifax', 'experian', 'transunion'];

  function flag(code, severity, where, detail, pattern) {
    const out = { code: code, severity: severity, where: where || '', detail: detail || '' };
    if (pattern) out.pattern = pattern;
    return out;
  }

  function isCurrentStatus(s) {
    if (!s) return false;
    return /pays as agreed|paying as agreed|\bcurrent\b/i.test(s) && !/past due|collection|charge/i.test(s);
  }

  function isDerogatory(view) {
    if (!view || !view.reported) return false;
    const status = (view.details && view.details.status) || view.accountStatus || '';
    if (/past due|charge|collection|delinquen|repossess|foreclos/i.test(status)) return true;
    const d = view.details;
    if (d && typeof d.amountPastDue === 'number' && d.amountPastDue > 0) return true;
    if (d && typeof d.chargeOffAmount === 'number' && d.chargeOffAmount > 0) return true;
    const p = view.paymentSummary;
    if (!p) return false;
    return [p.late30, p.late60, p.late90, p.late120, p.collection, p.chargeOff].some(n => typeof n === 'number' && n > 0);
  }

  function fieldValue(view, key) {
    if (!view || !view.details) return null;
    const v = view.details[key];
    return v == null || v === '' ? null : v;
  }

  function reviewTradeline(t, flags) {
    const views = BUREAUS.map(b => t.bureaus[b]).filter(v => v && v.reported);
    BUREAUS.forEach(b => {
      const v = t.bureaus[b];
      if (!v || !v.reported) return;
      const status = (v.details && v.details.status) || v.accountStatus;
      const past = v.details ? v.details.amountPastDue : null;
      const summary = v.paymentSummary;
      const lates = summary ? [summary.late30, summary.late60, summary.late90, summary.late120].some(n => typeof n === 'number' && n > 0) : false;
      if (isCurrentStatus(status) && ((typeof past === 'number' && past > 0) || lates)) {
        flags.push(flag('STATUS_PASTDUE_CONFLICT', 'REVIEW', t.id + '/' + b,
          'Reported status is current while amount past due or a late count is positive.', 'A'));
      }
      if (isDerogatory(v)) {
        const dofd = v.details ? v.details.dofd : null;
        if (dofd == null) {
          flags.push(flag('DOFD_MISSING_ON_DEROG', 'REVIEW', t.id + '/' + b,
            'Derogatory reporting has no date of first delinquency (Metro 2 Field 25 is empty on the report).', 'B'));
        }
      }
    });

    COMPARE.forEach(pair => {
      const present = [];
      const missing = [];
      views.forEach(v => {
        const bureau = BUREAUS.filter(b => t.bureaus[b] === v)[0];
        const value = fieldValue(v, pair[0]);
        if (value == null) missing.push(bureau);
        else present.push({ bureau: bureau, value: value });
      });
      if (present.length && missing.length) {
        flags.push(flag('FIELD_NOT_REPORTED', 'INFO', t.id, pair[1] + ' is reported by ' + present.map(p => p.bureau).join(', ') + ' and not reported by ' + missing.join(', ') + '.'));
      }
      const distinct = [];
      present.forEach(p => { if (!distinct.some(d => d.value === p.value)) distinct.push(p); });
      if (distinct.length > 1) {
        flags.push(flag('CROSS_BUREAU_CONFLICT', 'REVIEW', t.id,
          pair[1] + ' differs: ' + present.map(p => p.bureau + ' ' + p.value).join('; ') + '.', 'E'));
      }
    });

    const eq = t.bureaus.equifax && t.bureaus.equifax.last4;
    const ex = t.bureaus.experian && t.bureaus.experian.last4;
    const tu = t.bureaus.transunion && t.bureaus.transunion.last4;
    if (eq && tu && eq !== tu) {
      flags.push(flag('ACCOUNT_NUMBER_VARIANCE', 'REVIEW', t.id, 'Equifax last4 ' + eq + ' and TransUnion last4 ' + tu + ' differ.'));
    } else if (ex && ((eq && ex !== eq) || (tu && ex !== tu))) {
      flags.push(flag('ACCOUNT_NUMBER_VARIANCE', 'INFO', t.id, 'Experian last4 ' + ex + ' differs from Equifax/TransUnion. Experian masking often differs.'));
    }

    if (t.paymentGrid && t.paymentGrid.bureausShown && t.paymentGrid.bureausShown.length) {
      flags.push(flag('PAYMENT_GRID_UNAVAILABLE', 'INFO', t.id,
        'The monthly grid is icons, not text. Any Payment History Profile Field 18 claim has to be read from the PDF by a person.'));
    }

    const collectionStatus = views.some(v => /collection/i.test(((v.details && v.details.status) || v.accountStatus || '')));
    if (collectionStatus) {
      flags.push(flag('UNMATCHED_COLLECTION', 'REVIEW', t.id,
        'This collection tradeline does not report an original creditor (K1 segment).', 'D'));
    }
  }

  function reviewInquiries(report, flags) {
    const furnishers = report.tradelines.map(t => t.furnisher);
    report.inquiries.filter(q => q.type === 'hard').forEach(q => {
      const hit = furnishers.some(name => norm.companyMatch(q.company, name));
      if (!hit) {
        flags.push(flag('INQUIRY_NO_TRADELINE', 'REVIEW', 'inquiry/' + q.company,
          'Hard inquiry "' + q.company + '" has no matching tradeline. A permissible-purpose dispute under 15 U.S.C. § 1681b waits until the client confirms it was unauthorized.', 'H'));
      }
    });
  }

  function reviewCollections(report, flags) {
    report.collections.forEach(c => {
      const matched = report.tradelines.some(t => {
        return BUREAUS.some(b => t.bureaus[b] && t.bureaus[b].last4 && c.last4 && t.bureaus[b].last4 === c.last4);
      });
      if (!matched) {
        flags.push(flag('UNMATCHED_COLLECTION', 'REVIEW', 'collection/' + (c.bureau || ''),
          'Collection last4 ' + (c.last4 || 'unknown') + ' does not match a tradeline, and no original creditor (K1) is reported.', 'D'));
      }
    });
  }

  function countsOf(items, field) {
    const n = { equifax: 0, experian: 0, transunion: 0 };
    items.forEach(it => { if (n[it[field]] != null) n[it[field]]++; });
    return [n.equifax, n.experian, n.transunion];
  }

  function personalCounts(report) {
    return BUREAUS.map(b => {
      const id = report.personal.byBureau[b] || {};
      const name = id.name ? 1 : 0;
      const aka = (id.formerlyKnownAs || []).length;
      const addr = (report.personal.addresses || []).filter(a => a.bureau === b && a.reported).length;
      const emp = (report.personal.employment || []).filter(e => e.bureau === b).length;
      return name + aka + addr + emp;
    });
  }

  function sameTriple(a, b) {
    if (!a || !b || a.length !== 3 || b.length !== 3) return false;
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  function reviewReconciliation(report, flags) {
    const other = (report.reconciliation && report.reconciliation.otherItems) || {};
    const pairs = [
      ['inquiries', countsOf(report.inquiries, 'bureau')],
      ['collections', countsOf(report.collections, 'bureau')],
      ['publicRecords', (report.publicRecords.raw.length || report.publicRecords.bankruptcies.length) ? null : [0, 0, 0]],
      ['consumerStatements', [0, 0, 0]]
    ];
    pairs.forEach(pair => {
      if (!other[pair[0]] || !pair[1]) return;
      if (!sameTriple(other[pair[0]], pair[1])) {
        flags.push(flag('COUNT_MISMATCH', 'REVIEW', pair[0],
          'Other Credit Items says ' + other[pair[0]].join('/') + ' and the parse found ' + pair[1].join('/') + '.'));
      }
    });
    if (other.personalInformation) {
      const parsed = personalCounts(report);
      if (!sameTriple(other.personalInformation, parsed)) {
        flags.push(flag('COUNT_MISMATCH', 'REVIEW', 'personalInformation',
          'Other Credit Items says ' + other.personalInformation.join('/') + ' and the parsed identification, address, and employment rows are ' + parsed.join('/') + '.'));
      }
    }
    const toc = report.reconciliation ? report.reconciliation.tocAccountCount : null;
    if (typeof toc === 'number' && toc !== report.tradelines.length) {
      flags.push(flag('COUNT_MISMATCH', 'REVIEW', 'toc',
        'Table of contents lists ' + toc + ' accounts and the parse found ' + report.tradelines.length + '.'));
    }
  }

  function reviewReport(report) {
    const flags = [];
    if (!report || !report.source || report.source.format !== 'three-bureau-equifax-powered') {
      flags.push(flag('UNRECOGNIZED_FORMAT', 'BLOCK', 'report', 'The file is not a Three Bureau Credit Report powered by Equifax.'));
      return flags;
    }
    (report.parseWarnings || []).forEach(w => {
      if (w.code === 'SECTION_MISSING') flags.push(flag('SECTION_MISSING', 'BLOCK', w.where, w.detail));
    });
    const expected = 11;
    if ((report.sectionsFound || []).length < expected && !flags.some(f => f.code === 'SECTION_MISSING')) {
      flags.push(flag('SECTION_MISSING', 'BLOCK', 'report', 'Expected 11 sections and found ' + report.sectionsFound.length + '.'));
    }
    (report.tradelines || []).forEach(t => reviewTradeline(t, flags));
    reviewInquiries(report, flags);
    reviewCollections(report, flags);
    if (report.publicRecords && report.publicRecords.raw && report.publicRecords.raw.length) {
      flags.push(flag('PUBLIC_RECORD_PRESENT_UNPARSED', 'REVIEW', 'publicRecords',
        'A public-record subsection has text other than the empty-state sentence. The populated layout is not parsed in v1.'));
    }
    reviewReconciliation(report, flags);
    return flags;
  }

  function primaryPattern(flags, tradelineId, bureau) {
    const mine = flags.filter(f => {
      const w = f.where || '';
      if (w.indexOf(tradelineId) !== 0) return false;
      const slash = w.indexOf('/');
      if (slash < 0) return true;
      return w.slice(slash + 1) === bureau;
    });
    if (mine.some(f => f.code === 'STATUS_PASTDUE_CONFLICT')) return 'A';
    if (mine.some(f => f.pattern === 'D')) return 'D';
    if (mine.some(f => f.code === 'DOFD_MISSING_ON_DEROG')) return 'B';
    if (mine.some(f => f.code === 'CROSS_BUREAU_CONFLICT')) return 'E';
    return null;
  }

  return { reviewReport, primaryPattern, isCurrentStatus, isDerogatory };
});
