/* node test/credit-letters.test.js — gold-example structure, fixture drafts, and the no-draft cases. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const { parse3b } = require('../sidecar/credit/parse-3b.js');
const { draftRound1 } = require('../sidecar/credit/letters.js');
const { validateLetter } = require('../sidecar/credit/validate-letter.js');
const { makeStore, makeMemoryFs } = require('../sidecar/credit/store.js');

const DIR = path.join(__dirname, 'fixtures', 'credit');
const report = parse3b(fs.readFileSync(path.join(DIR, 'synthetic-3b-report.txt'), 'utf8'));
const complete = JSON.parse(fs.readFileSync(path.join(DIR, 'intake-complete.json'), 'utf8'));
const incomplete = JSON.parse(fs.readFileSync(path.join(DIR, 'intake-incomplete.json'), 'utf8'));
const unmatched = JSON.parse(fs.readFileSync(path.join(DIR, 'intake-unmatched.json'), 'utf8'));

const jane = {
  letterType: 'round1 bureau dispute',
  bureau: 'experian',
  letterDate: 'October 2, 2026',
  confirmed: true,
  consumer: {
    fullName: 'Jane Q. Sample',
    addressLine1: '123 Example Street',
    cityStateZip: 'Springfield, IL 62701',
    dob: '04/12/1985',
    ssnLast4: '1234'
  },
  accounts: [{
    furnisher: 'First Example Bank',
    accountNumber: '441122XXXX',
    dateOpened: '06/2019',
    reportDate: '09/15/2026',
    reportedValues: {
      accountStatus: 'Current / paying as agreed',
      amountPastDue: '$214',
      creditLimit: '$5,000'
    },
    dofd: 'none reported',
    clientClaim: 'the reported status is current while an amount past due is also reported',
    gridMonthCode: '2'
  }]
};

const gold = draftRound1(jane, null, { createdAt: '2026-10-02T00:00:00.000Z' });
A.eq(gold.letters.length, 1, 'Jane intake drafts one letter without a report');
const md = gold.letters[0].markdown;
const order = [
  'Jane Q. Sample\n123 Example Street\nSpringfield, IL 62701\nDate of Birth: 04/12/1985\nSSN (last 4): XXX-XX-1234',
  'October 2, 2026',
  'Experian\nP.O. Box 4500\nAllen, TX 75013',
  'Re: Formal Dispute of Inaccurate, Incomplete, and Unverifiable Information',
  '## Disputed Item #1',
  '**Creditor / Furnisher:** First Example Bank',
  '**Account Number (as reported):** 441122XXXX',
  '**Date Opened (as reported):** 06/2019',
  '**High Credit / Credit Limit (as reported):** $5,000',
  '**Reported Status (as reported on the 09/15/2026 Experian report):** Current / paying as agreed',
  '**Date of First Delinquency (as reported):** none reported',
  '**Nature of the dispute.**',
  '**Identified inaccuracies.**',
  '1. ',
  '**Legal grounds.**',
  '**Demand.**',
  '## Procedural demands',
  'Sincerely,',
  '**Enclosures:**',
  'does not guarantee any specific change to a credit report.'
];
let at = -1;
order.forEach(needle => {
  const i = md.indexOf(needle);
  A.ok(i > at, 'gold letter contains, in order: ' + needle.split('\n')[0]);
  if (i > at) at = i;
});
A.eq(validateLetter(md).pass, true, 'gold letter passes the validator');
A.ok(md.indexOf('1.5 line spacing') < 0, 'the Word spacing note is not in the letter body');
A.eq(gold.letters[0].meta.wordSpacingNote, 'Set to 1.5 line spacing when transferring to Word.', 'spacing note is metadata');
A.ok(/Field 18/.test(md) && /Field 17A/.test(md) && /Field 22/.test(md), 'Metro 2 cites name the field number');
A.ok(md.indexOf('15 U.S.C. § 1681i(a)(5)(A)') >= 0, 'deletion cite is canonical');

const drafted = draftRound1(complete, report, { createdAt: '2026-10-06T12:00:00.000Z' });
A.eq(drafted.letters.length, 1, 'complete intake drafts one letter');
A.eq(drafted.letters[0].bureau, 'experian', 'letter bureau is Experian');
A.eq(drafted.letters[0].meta.status, 'DRAFT', 'validator pass saves DRAFT');
A.eq(drafted.letters[0].meta.pattern, 'A', 'Demo Credit Union is pattern A');
A.eq(drafted.letters[0].meta.accounts.length, 1, 'one disputed item');
A.eq(drafted.letters[0].meta.accounts[0].furnisher, 'Demo Credit Union', 'furnisher from the report');
A.eq(drafted.letters[0].meta.validator.pass, true, 'fixture letter validates');
A.ok(drafted.letters[0].markdown.indexOf('## Disputed Item #1') >= 0, 'one Disputed Item heading');
A.ok(drafted.letters[0].markdown.indexOf('## Disputed Item #2') < 0, 'accounts are not combined');
A.ok(drafted.letters[0].meta.factsRelied.length > 0, 'facts relied are recorded');
A.ok(drafted.letters[0].meta.unverified.length > 0, 'unverified items are recorded');

const mem = makeMemoryFs();
const store = makeStore({ fs: mem, path: path, root: '/ws', clock: { now: () => Date.parse('2026-10-06T12:00:00.000Z') } });
drafted.letters[0].meta.caseId = drafted.caseId;
const saved = store.saveLetter(drafted.caseId, drafted.letters[0]);
A.ok(/credit\/cases\/.+\/letters\/experian\.md$/.test(saved.md.replace(/\\/g, '/')), 'letter path is under credit/cases');
A.eq(mem.readFileSync(saved.md).indexOf('## Disputed Item #1') >= 0, true, 'markdown is on the injected fs');
const metaOnDisk = JSON.parse(mem.readFileSync(saved.json));
A.eq(metaOnDisk.status, 'DRAFT', 'meta.status on disk is DRAFT');
A.eq(mem.existsSync(path.join('/ws', 'credit', 'cases', drafted.caseId, 'validator-failures.jsonl')), false, 'a passing draft does not append a failure log');

const missing = draftRound1(incomplete, report, { createdAt: '2026-10-06T12:00:00.000Z' });
A.eq(missing.letters.length, 0, 'incomplete intake drafts nothing');
A.eq(missing.status, 'NEEDS_REVIEW', 'incomplete case needs review');
A.ok(missing.missingFields.indexOf('dob') >= 0, 'missing dob');
A.ok(missing.missingFields.indexOf('client claim') >= 0, 'missing client claim');
A.ok(missing.flags.some(f => f.code === 'MISSING_FIELD' && f.severity === 'BLOCK'), 'missing fields are a block');

const lost = draftRound1(unmatched, report, { createdAt: '2026-10-06T12:00:00.000Z' });
A.eq(lost.letters.length, 0, 'unmatched intake drafts nothing');
A.ok(lost.flags.some(f => f.code === 'UNMATCHED_INTAKE_ACCOUNT' && f.severity === 'BLOCK'), 'unmatched account is a block');

const bang = JSON.parse(JSON.stringify(complete));
bang.accounts[0].clientClaim = 'past due reported on a current account!';
const bad = draftRound1(bang, report, { createdAt: '2026-10-06T12:00:00.000Z' });
A.eq(bad.letters[0].meta.status, 'DRAFT_NEEDS_FIX', 'a validator failure is still saved, as DRAFT_NEEDS_FIX');
store.saveLetter(bad.caseId, bad.letters[0]);
store.saveLetter(bad.caseId, bad.letters[0]);
const log = mem.readFileSync(path.join('/ws', 'credit', 'cases', bad.caseId, 'validator-failures.jsonl'));
A.eq(log.trim().split('\n').length, 2, 'validator failures append a JSON line each time');
A.ok(log.indexOf('EXCLAMATION') >= 0, 'the failure log names the exclamation');

const mov = JSON.parse(JSON.stringify(complete));
mov.letterType = 'MOV';
const notYet = draftRound1(mov, report);
A.eq(notYet.letters.length, 0, 'MOV is not drafted in v1');
A.eq(notYet.status, 'NOT_IMPLEMENTED', 'other letter types are not implemented');

const src = [
  fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'credit', 'letters.js'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'tools', 'builtin', 'credit.js'), 'utf8')
].join('\n');
A.ok(!/name:\s*'credit\.(send|mail|fax|approve)/.test(src), 'no send, mail, fax, or approve tool');
A.ok(!/function\s+(send|mail|fax|approve)/.test(src), 'no send, mail, fax, or approve function');

A.report('credit-letters.test');
