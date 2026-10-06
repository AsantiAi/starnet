/* sidecar/credit/letters.js — deterministic round-1 bureau dispute drafts.
   One letter per bureau, one Disputed Item per account, filled from the intake and the parsed
   report. Status text is quoted as reported. A numeric Metro 2 code is cited only when the intake
   supplies it. The validator runs on every draft. This module does not send, mail, fax, or approve. */
'use strict';
(function (root, factory) {
  const fs = require('fs');
  const path = require('path');
  const C = require('./constants.js');
  const norm = require('./normalize.js');
  const tmpl = require('./template.js');
  const validate = require('./validate-letter.js');
  const cases = require('./case.js');
  const api = factory(fs, path, C, norm, tmpl, validate, cases);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; (root.SK.credit = root.SK.credit || {}).letters = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fs, path, C, norm, tmpl, validate, cases) {
  'use strict';

  function loadTemplates(dir) {
    const base = dir || path.join(__dirname, 'templates');
    return {
      'round1-bureau': fs.readFileSync(path.join(base, 'round1-bureau.md'), 'utf8'),
      'disputed-item': fs.readFileSync(path.join(base, 'disputed-item.md'), 'utf8')
    };
  }

  function sentence(s) {
    const t = norm.scrubSensitive(norm.clean(s));
    if (!t) return '';
    return /[.]$/.test(t) ? t : t + '.';
  }

  function moneyText(raw, value) {
    if (raw) return raw;
    if (typeof value === 'number') {
      const n = String(Math.round(value));
      return '$' + n.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    return null;
  }

  function itemFromReport(entry, bureauId, report) {
    const account = entry.intake;
    const t = entry.tradeline;
    const view = t.bureaus[bureauId];
    const d = view.details || {};
    const raw = (d && d.raw) || {};
    const top = view.raw || {};
    const status = raw.status || top.accountStatus || 'none reported';
    const past = moneyText(raw.amountPastDue, d.amountPastDue);
    const opened = raw.dateOpened || 'none reported';
    const dofd = raw.dofd || 'none reported';
    const limit = raw.creditLimit || top.creditLimit;
    const high = raw.highCredit;
    let highCreditOrLimit = 'none reported';
    if (high && limit) highCreditOrLimit = high + ' / ' + limit;
    else if (limit) highCreditOrLimit = limit;
    else if (high) highCreditOrLimit = high;
    const reportDate = account.reportDate || (report && report.source && report.source.reportDateText) || (report && report.source && report.source.reportDate) || '';
    const others = [];
    ['equifax', 'experian', 'transunion'].forEach(b => {
      if (b === bureauId) return;
      const other = t.bureaus[b];
      if (!other || !other.reported || !other.details) return;
      const oRaw = other.details.raw || {};
      if (oRaw.amountPastDue && past && oRaw.amountPastDue !== past) {
        others.push(C.BUREAUS[b].name + ' reports the amount past due as ' + oRaw.amountPastDue);
      }
    });
    return {
      n: 0,
      furnisher: t.furnisher,
      accountNumberMasked: view.accountNumberMasked || account.accountNumber,
      dateOpened: opened,
      highCreditOrLimit: highCreditOrLimit,
      reportDate: reportDate,
      reportedStatus: status,
      dofdOrNoneReported: dofd,
      pastDueText: past,
      otherPastDue: others,
      clientClaim: account.clientClaim,
      pattern: entry.pattern,
      tradelineId: t.id,
      last4: view.last4 || entry.last4,
      gridCode: account.paymentHistoryCode || account.gridMonthCode || null
    };
  }

  function itemFromIntake(entry, bureauId) {
    const a = entry.intake;
    const values = a.reportedValues || {};
    return {
      n: 0,
      furnisher: a.furnisher,
      accountNumberMasked: a.accountNumber,
      dateOpened: a.dateOpened || values.dateOpened || 'none reported',
      highCreditOrLimit: a.highCreditOrLimit || values.highCreditOrLimit || values.creditLimit || 'none reported',
      reportDate: a.reportDate,
      reportedStatus: a.reportedStatus || values.accountStatus || 'none reported',
      dofdOrNoneReported: a.dofd || values.dofd || 'none reported',
      pastDueText: a.amountPastDue || values.amountPastDue || null,
      otherPastDue: [],
      clientClaim: a.clientClaim,
      pattern: entry.pattern,
      tradelineId: null,
      last4: entry.last4,
      gridCode: a.paymentHistoryCode || a.gridMonthCode || null
    };
  }

  function inaccuraciesFor(item, bureauName) {
    const status = item.reportedStatus;
    const past = item.pastDueText;
    const out = [];
    if (item.pattern === 'A') {
      out.push('The reported status on this account is "' + status + '" and the reported amount past due is ' + (past || 'a positive amount') + ' on the same ' + item.reportDate + ' ' + bureauName + ' credit report. A current or pays-as-agreed status conflicts with a positive amount past due, so the tradeline is inaccurate as reported.');
      if (item.otherPastDue.length) {
        out.push(item.otherPastDue.join(', ') + ', while this bureau reports ' + past + '. The figures are not the same across the bureaus that reported this account.');
      }
      out.push('In the Metro 2 layout the conflict is between the reported status text (Account Status Code Field 17A, quoted as text because the report does not print a numeric code) and Amount Past Due Field 22.');
    } else if (item.pattern === 'B') {
      out.push('The account is reported as derogatory and the date of first delinquency is ' + item.dofdOrNoneReported + '. Date of First Delinquency Field 25 is incomplete on this tradeline. No date was invented to fill it.');
      out.push('A missing date of first delinquency on derogatory reporting is an incompleteness in Metro 2 Date of First Delinquency Field 25, read against the reported status text rather than a code this letter does not have.');
    } else if (item.pattern === 'D') {
      out.push('This collection item does not report the original creditor. The K1 segment is absent, so the entry is incomplete as reported on the ' + item.reportDate + ' ' + bureauName + ' credit report.');
    } else if (item.pattern === 'E') {
      out.push('The same account is reported with different values across bureaus. ' + (item.otherPastDue.join(', ') || 'The conflicting reported values are on the report.') + ' Those differences make the ' + bureauName + ' entry inaccurate or unverifiable as reported.');
    } else {
      out.push('The reported status is "' + status + '" as shown on the ' + item.reportDate + ' ' + bureauName + ' credit report. The specific defect is the one named in the nature of this dispute.');
    }
    if (item.gridCode) {
      out.push('The intake supplies a latest monthly payment-history mark of ' + item.gridCode + '. Under Metro 2 Payment History Profile Field 18 that mark is a past-due code, which conflicts with the reported status. The monthly grid is not text in the export, so the mark is used only because the intake states it.');
    }
    return out;
  }

  function groundsFor(item) {
    const tied = ' This citation is tied only to the defect on this account, not to any other tradeline.';
    if (item.pattern === 'B') {
      return [
        C.CITE.dofdReporting + ' requires a furnisher that reports a date of first delinquency to report it accurately. The date is missing on this derogatory account.' + tied,
        C.CITE.reaging + ' prohibits re-aging the obsolescence period. With Field 25 blank, the reporting period cannot be verified from this file.' + tied,
        C.CITE.deletion + ' requires deletion or modification of information that is inaccurate, incomplete, or unverifiable. The missing date of first delinquency is the basis for that request on this account.'
      ];
    }
    if (item.pattern === 'D') {
      return [
        C.CITE.accuracy + ' requires reasonable procedures to assure maximum possible accuracy. A collection that omits the original creditor is incomplete.' + tied,
        C.CITE.deletion + ' requires deletion or modification of incomplete information. The missing original creditor on this collection is the basis for that request.'
      ];
    }
    return [
      C.CITE.accuracy + ' requires a consumer reporting agency to follow reasonable procedures to assure maximum possible accuracy. The conflicting reported values on this account cannot all be accurate.' + tied,
      C.CITE.deletion + ' requires prompt deletion or modification of information that is inaccurate, incomplete, or unverifiable. That is the basis for deleting this tradeline.'
    ];
  }

  function demandFor(item) {
    if (item.pattern === 'B') {
      return 'Delete this tradeline under ' + C.CITE.deletion + ' because the derogatory reporting is incomplete: the date of first delinquency is not reported, so the item is not verifiable as it stands.';
    }
    if (item.pattern === 'D') {
      return 'Delete this collection under ' + C.CITE.deletion + ' because it is incomplete without the original creditor and is not verifiable as reported.';
    }
    return 'Delete this tradeline under ' + C.CITE.deletion + ' because the reported status conflicts with the other reported values on this account and the entry is therefore inaccurate.';
  }

  function buildItem(item, bureau) {
    const claim = sentence(item.clientClaim);
    return {
      n: item.n,
      furnisher: item.furnisher,
      accountNumberMasked: item.accountNumberMasked,
      dateOpened: item.dateOpened,
      highCreditOrLimit: item.highCreditOrLimit,
      reportDate: item.reportDate,
      bureau: bureau,
      reportedStatus: item.reportedStatus,
      dofdOrNoneReported: item.dofdOrNoneReported,
      natureOfDispute: claim + ' As reported on the ' + item.reportDate + ' ' + bureau.name + ' credit report, the status is "' + item.reportedStatus + '" and the date of first delinquency is ' + item.dofdOrNoneReported + (item.pastDueText ? ', with the amount past due reported as ' + item.pastDueText : '') + '.',
      inaccuracies: inaccuraciesFor(item, bureau.name),
      legalGrounds: groundsFor(item),
      demand: demandFor(item)
    };
  }

  function factsFor(item) {
    return [
      'furnisher ' + item.furnisher,
      'account number as reported ' + item.accountNumberMasked,
      'report date ' + item.reportDate,
      'reported status ' + item.reportedStatus,
      'date opened ' + item.dateOpened,
      'date of first delinquency ' + item.dofdOrNoneReported,
      item.pastDueText ? 'amount past due ' + item.pastDueText : 'amount past due not in the quoted facts'
    ];
  }

  function renderLetter(intake, bureauId, items, createdAt) {
    const bureau = C.BUREAUS[bureauId];
    const consumer = intake.consumer;
    const viewItems = items.map((item, i) => buildItem(Object.assign({}, item, { n: i + 1 }), bureau));
    const data = {
      consumer: {
        fullName: consumer.fullName,
        addressLine1: consumer.addressLine1,
        cityStateZip: consumer.cityStateZip,
        dob: consumer.dob,
        ssnLast4: norm.last4of(consumer.ssnLast4)
      },
      letterDate: intake.letterDate || createdAt.slice(0, 10),
      bureau: bureau,
      itemOrItems: viewItems.length === 1 ? 'item' : 'items',
      thisItemOrEachItem: viewItems.length === 1 ? 'this item' : 'each item',
      items: viewItems,
      enclosures: Array.isArray(intake.enclosures) ? intake.enclosures : []
    };
    const files = loadTemplates();
    const markdown = tmpl.render(files['round1-bureau'], data, { 'disputed-item': files['disputed-item'] });
    const validation = validate.validateLetter(markdown);
    const pattern = items[0] ? items[0].pattern : null;
    const meta = {
      status: validation.pass ? 'DRAFT' : 'DRAFT_NEEDS_FIX',
      createdAt: createdAt,
      caseId: null,
      bureau: bureauId,
      accounts: items.map(item => ({
        furnisher: item.furnisher,
        last4: item.last4 || null,
        tradelineId: item.tradelineId,
        pattern: item.pattern
      })),
      pattern: pattern,
      validator: validation,
      factsRelied: items.reduce((acc, item) => acc.concat(factsFor(item)), []),
      unverified: [
        'The monthly payment grid is icons, so Payment History Profile Field 18 was not read from the report text.',
        'The client statement was not independently verified.',
        C.ADDRESS_CONFIRM_NOTE
      ],
      wordSpacingNote: C.WORD_SPACING_NOTE
    };
    return { bureau: bureauId, markdown: markdown, meta: meta };
  }

  function draftRound1(intake, report, opts) {
    opts = opts || {};
    const createdAt = opts.createdAt || (opts.clock && typeof opts.clock.now === 'function' ? new Date(opts.clock.now()).toISOString() : '1970-01-01T00:00:00.000Z');
    const evaluation = cases.evaluate(intake, report);
    const base = {
      caseId: evaluation.caseId,
      missingFields: evaluation.missingFields,
      flags: evaluation.flags,
      status: evaluation.status,
      letters: []
    };
    if (evaluation.notImplemented || evaluation.missingFields.length || evaluation.status !== 'READY') return base;
    const bureau = evaluation.bureau;
    const chosen = evaluation.accounts.filter(a => !a.block && a.pattern && a.pattern !== 'I' && a.pattern !== 'H' && a.pattern !== 'F');
    if (!chosen.length) return base;
    const items = chosen.map(entry => entry.tradeline ? itemFromReport(entry, bureau, report) : itemFromIntake(entry, bureau));
    const letter = renderLetter(intake, bureau, items, createdAt);
    letter.meta.caseId = evaluation.caseId;
    base.letters = [letter];
    base.status = letter.meta.status;
    return base;
  }

  return { draftRound1, renderLetter, loadTemplates };
});
