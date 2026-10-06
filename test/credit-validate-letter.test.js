/* node test/credit-validate-letter.test.js — each validator rule fails a mutated gold letter. */
'use strict';
const A = require('./_assert.js');
const { draftRound1 } = require('../sidecar/credit/letters.js');
const { validateLetter } = require('../sidecar/credit/validate-letter.js');

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
    reportedValues: { accountStatus: 'Current / paying as agreed', amountPastDue: '$214', creditLimit: '$5,000' },
    dofd: 'none reported',
    clientClaim: 'the reported status is current while an amount past due is also reported',
    gridMonthCode: '2'
  }]
};
const base = draftRound1(jane, null, { createdAt: '2026-10-02T00:00:00.000Z' }).letters[0].markdown;
A.eq(validateLetter(base).pass, true, 'unmodified gold letter passes');

function fails(mutated, code) {
  const result = validateLetter(mutated);
  A.eq(result.pass, false, code + ' fails the letter');
  A.ok(result.failures.some(f => f.code === code), code + ' is the failure code, got ' + result.failures.map(f => f.code).join(','));
}

fails(base.replace('First Example Bank', '{{furnisher}}'), 'PLACEHOLDER');
fails(base.replace('[signature]', '[sign here]'), 'PLACEHOLDER');
fails(base.replace('15 U.S.C. § 1681i(a)(5)(A)', 'section 1681i'), 'NONCANONICAL_CITATION');
fails(base.replace('\n---\n', '\nPlease treat this as a goodwill adjustment.\n---\n'), 'BANNED_PHRASE');
fails(base.replace('Metro 2 layout the conflict is between the reported status text (Account Status Code Field 17A', 'Metro 2 violation and Field 17A'), 'BANNED_PHRASE');
fails(base.replace('in good faith', 'in good faith!'), 'EXCLAMATION');
fails(base.replace('See *Cushman v. Trans Union Corp.*', 'See *Someone v. Nobody*'), 'UNLISTED_CASE');
fails(base.replace(/Field \d+[A-Z]?/g, 'the layout'), 'METRO2_FIELD');
fails(base.replace('## Procedural demands', '## Other demands'), 'MISSING_SECTION');

A.eq(validateLetter(base.replace('[signature]', '[signature]\n[signature]')).pass, true, 'the literal [signature] is allowed');

A.report('credit-validate-letter.test');
