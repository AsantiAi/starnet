/* sidecar/credit/case.js — intake checks and the case state for a dispute draft.
   Required facts come from the training intake (letter type, bureau, consumer identity, and one
   reported value plus the client's stated reason per account). A missing fact produces a MISSING
   FIELDS list and no letter. An intake account that is not on that bureau's report is a BLOCK.
   Letter types other than a round-1 bureau dispute are NOT_IMPLEMENTED. Nothing here sends mail. */
'use strict';
(function (root, factory) {
  const norm = (typeof require === 'function') ? require('./normalize.js') : (root.SK && root.SK.credit && root.SK.credit.normalize);
  const review = (typeof require === 'function') ? require('./review.js') : (root.SK && root.SK.credit && root.SK.credit.review);
  const api = factory(norm, review);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; (root.SK.credit = root.SK.credit || {}).case = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (norm, review) {
  'use strict';

  const ROUND1 = new Set(['round1', 'round1-bureau', 'round1 bureau dispute', 'bureau-dispute', 'bureau dispute']);

  function caseIdFor(intake) {
    if (intake && intake.caseId && /^[A-Za-z0-9_-]{1,80}$/.test(intake.caseId)) return intake.caseId;
    const consumer = (intake && intake.consumer) || {};
    const ssn = norm.last4of(consumer.ssnLast4) || 'xxxx';
    const bureau = norm.normBureau(intake && intake.bureau) || 'bureau';
    const acct = (intake && intake.accounts && intake.accounts[0]) || {};
    const last4 = norm.last4of(acct.last4 || acct.accountNumber) || 'na';
    return 'c-' + bureau + '-' + ssn + '-' + last4;
  }

  function missingFields(intake) {
    const missing = [];
    const src = intake || {};
    if (!norm.clean(src.letterType)) missing.push('letter type');
    if (!norm.normBureau(src.bureau)) missing.push('bureau');
    const c = src.consumer || {};
    if (!norm.clean(c.fullName)) missing.push('full legal name');
    if (!norm.clean(c.addressLine1) || !norm.clean(c.cityStateZip)) missing.push('mailing address');
    if (!norm.clean(c.dob)) missing.push('dob');
    if (!norm.last4of(c.ssnLast4)) missing.push('ssn last 4');
    const accounts = Array.isArray(src.accounts) ? src.accounts : [];
    if (!accounts.length) {
      missing.push('furnisher');
      missing.push('account number');
      missing.push('report date');
      missing.push('reported value');
      missing.push('client claim');
      return missing;
    }
    accounts.forEach(a => {
      if (!norm.clean(a.furnisher)) missing.push('furnisher');
      if (!norm.clean(a.accountNumber) && !norm.last4of(a.last4 || a.accountNumber)) missing.push('account number');
      if (!norm.clean(a.reportDate)) missing.push('report date');
      if (!hasReportedValue(a)) missing.push('reported value');
      if (!norm.clean(a.clientClaim)) missing.push('client claim');
    });
    return missing;
  }

  function inferPattern(account) {
    if (account && account.pattern && /^[A-I]$/.test(String(account.pattern))) return account.pattern;
    const values = (account && account.reportedValues) || {};
    const status = (account && account.reportedStatus) || values.accountStatus || '';
    const past = norm.parseMoney((account && account.amountPastDue) || values.amountPastDue);
    if (review.isCurrentStatus(status) && typeof past === 'number' && past > 0) return 'A';
    return null;
  }

  function hasReportedValue(a) {
    if (!a) return false;
    if (norm.clean(a.reportedStatus) || norm.clean(a.amountPastDue) || norm.clean(a.dateOpened)) return true;
    const v = a.reportedValues || {};
    return Object.keys(v).some(k => norm.textOrNull(v[k]));
  }

  function findTradeline(report, account, bureau) {
    if (!report) return null;
    const last4 = norm.last4of(account.last4 || account.accountNumber);
    const hits = (report.tradelines || []).filter(t => {
      if (!norm.companyMatch(account.furnisher, t.furnisher)) return false;
      const view = t.bureaus[bureau];
      if (!view || !view.reported) return false;
      if (!last4) return true;
      return view.last4 === last4;
    });
    return hits[0] || null;
  }

  function consumerMismatch(intake, report, bureau) {
    if (!report || !report.personal || !report.personal.byBureau) return false;
    const id = report.personal.byBureau[bureau];
    if (!id || !id.name) return false;
    const c = intake.consumer || {};
    if (!norm.namesMatch(c.fullName, id.name)) return true;
    const dob = norm.parseDate(c.dob);
    if (dob && id.dob && dob !== id.dob) return true;
    const ssn = norm.last4of(c.ssnLast4);
    if (ssn && id.ssnLast4 && ssn !== id.ssnLast4) return true;
    return false;
  }

  function evaluate(intake, report) {
    const flags = report ? review.reviewReport(report).slice() : [];
    const missing = missingFields(intake);
    const letterType = norm.clean(intake && intake.letterType).toLowerCase();
    const bureau = norm.normBureau(intake && intake.bureau);
    const result = {
      caseId: caseIdFor(intake || {}),
      missingFields: missing,
      flags: flags,
      bureau: bureau,
      letterType: letterType,
      status: 'NEEDS_REVIEW',
      notImplemented: false,
      accounts: []
    };
    if (letterType && !ROUND1.has(letterType)) {
      result.notImplemented = true;
      result.status = 'NOT_IMPLEMENTED';
      flags.push({ code: 'NOT_IMPLEMENTED', severity: 'BLOCK', where: 'case', detail: 'v1 drafts a round-1 bureau dispute only. "' + letterType + '" is not implemented.' });
      return result;
    }
    if (missing.length) {
      flags.push({ code: 'MISSING_FIELD', severity: 'BLOCK', where: 'case', detail: 'MISSING FIELDS: ' + missing.join(', ') });
      result.status = 'NEEDS_REVIEW';
      return result;
    }
    if (intake && intake.confirmed === false) {
      flags.push({ code: 'UNCONFIRMED', severity: 'REVIEW', where: 'case', detail: 'The intake is not marked confirmed, so no letter is drafted.' });
      result.status = 'NEEDS_REVIEW';
      return result;
    }
    if (report && consumerMismatch(intake, report, bureau)) {
      flags.push({ code: 'CONSUMER_MISMATCH', severity: 'BLOCK', where: 'case', detail: 'The intake name, date of birth, or SSN last 4 does not match the bureau identification record.' });
    }
    if (intake && intake.documentedDamages && intake.repeatedNonCompliance) {
      flags.push({ code: 'ATTORNEY_REFERRAL', severity: 'REVIEW', where: 'case', pattern: null, detail: 'Intake marks documented damages and repeated non-compliance after a proper dispute.' });
    }
    const accounts = intake.accounts || [];
    accounts.forEach(account => {
      const last4 = norm.last4of(account.last4 || account.accountNumber);
      if (!report) {
        result.accounts.push({ intake: account, tradeline: null, last4: last4, block: false, pattern: inferPattern(account) });
        return;
      }
      const tradeline = findTradeline(report, account, bureau);
      if (!tradeline) {
        flags.push({
          code: 'UNMATCHED_INTAKE_ACCOUNT', severity: 'BLOCK', where: (account.furnisher || 'account') + '/' + (last4 || 'none'),
          detail: 'No ' + bureau + ' tradeline matches furnisher "' + account.furnisher + '" and last4 ' + (last4 || 'none') + '.'
        });
        result.accounts.push({ intake: account, tradeline: null, last4: last4, block: true, pattern: null });
        return;
      }
      const pattern = account.pattern || review.primaryPattern(flags, tradeline.id, bureau);
      if (!pattern) {
        flags.push({
          code: 'NO_LEGAL_DEFECT', severity: 'REVIEW', where: tradeline.id + '/' + bureau, pattern: 'I',
          detail: 'The client disputes this item, but no field-level inconsistency was found. Say so plainly. A furnisher dispute under 15 U.S.C. § 1681s-2(b) is the next step. Do not write a goodwill letter.'
        });
      }
      result.accounts.push({ intake: account, tradeline: tradeline, last4: last4, block: false, pattern: pattern });
    });
    const blocked = flags.some(f => f.severity === 'BLOCK');
    const draftable = result.accounts.some(a => !a.block && a.pattern && a.pattern !== 'I');
    if (blocked || !draftable) result.status = 'NEEDS_REVIEW';
    else result.status = 'READY';
    return result;
  }

  return { evaluate, missingFields, caseIdFor, findTradeline, ROUND1 };
});
