/* sidecar/credit/constants.js — credit-dispute v1 constants.
   Bureau mailing addresses, the statute map, the case-law allowlist, the Metro 2 field table,
   banned letter phrases, and the client-copy disclaimer. Letters may cite a statute only in the
   canonical form stored here, and only for a defect that the parsed report or the intake actually shows.
   Nothing in this module sends, approves, or mails a letter. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; (root.SK.credit = root.SK.credit || {}).constants = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Confirm the address is still current before anyone mails a letter. v1 never mails.
  const BUREAUS = {
    equifax: { id: 'equifax', name: 'Equifax', addressLine1: 'P.O. Box 740256', cityStateZip: 'Atlanta, GA 30374' },
    experian: { id: 'experian', name: 'Experian', addressLine1: 'P.O. Box 4500', cityStateZip: 'Allen, TX 75013' },
    transunion: { id: 'transunion', name: 'TransUnion', addressLine1: 'P.O. Box 2000', cityStateZip: 'Chester, PA 19016' }
  };
  const BUREAU_ORDER = ['equifax', 'experian', 'transunion'];

  const CITE = {
    accuracy: '15 U.S.C. § 1681e(b)',
    reinvestigation: '15 U.S.C. § 1681i(a)(1)(A)',
    reinvestigationShort: '15 U.S.C. § 1681i(a)(1)',
    forward: '15 U.S.C. § 1681i(a)(2)',
    consider: '15 U.S.C. § 1681i(a)(4)',
    deletion: '15 U.S.C. § 1681i(a)(5)(A)',
    notice: '15 U.S.C. § 1681i(a)(6)',
    mov: '15 U.S.C. § 1681i(a)(7)',
    dispute: '15 U.S.C. § 1681i',
    obsolescence: '15 U.S.C. § 1681c(a)',
    reaging: '15 U.S.C. § 1681c(c)(1)',
    furnisherAccuracy: '15 U.S.C. § 1681s-2(a)(1)(A)',
    dofdReporting: '15 U.S.C. § 1681s-2(a)(5)',
    furnisherInvestigation: '15 U.S.C. § 1681s-2(b)',
    identityBlock: '15 U.S.C. § 1681c-2',
    permissiblePurpose: '15 U.S.C. § 1681b',
    debtValidation: '15 U.S.C. § 1692g(a)',
    debtValidationCease: '15 U.S.C. § 1692g(b)',
    falseReporting: '15 U.S.C. § 1692e(8)',
    directDispute: '12 C.F.R. § 1022.43',
    furnisherPolicies: '12 C.F.R. § 1022.42'
  };

  // Full citation strings. A letter may name one of these only when the facts engage the holding.
  const ALLOWED_CASES = [
    'Cushman v. Trans Union Corp.',
    'Johnson v. MBNA Am. Bank, NA',
    'Saunders v. Branch Banking & Trust Co.',
    'Boggio v. USAA Federal Sav. Bank',
    'Hinkle v. Midland Credit Mgmt., Inc.',
    'Henson v. CSC Credit Servs.'
  ];

  // Field number AND name. The report prints status text, not these codes; never invent a code.
  const METRO2 = {
    '17A': 'Account Status Code',
    '17B': 'Payment Rating',
    '18': 'Payment History Profile',
    '21': 'Current Balance',
    '22': 'Amount Past Due',
    '24': 'Date of Account Information',
    '25': 'Date of First Delinquency',
    '26': 'Date Closed',
    '27': 'Date of Last Payment',
    'K1': 'Original creditor segment'
  };

  const ACCOUNT_STATUS_CODES = {
    '11': 'current', '71': '30 days past due', '78': '60 days past due', '80': '90 days past due',
    '82': '120 days past due', '83': '150 days past due', '84': '180 days past due',
    '93': 'collections', '97': 'charge-off', 'DA': 'delete'
  };

  const DISCLAIMER = 'This document is prepared by a credit-repair service provider and is not legal advice. It does not establish an attorney-client relationship. Compliance with the Fair Credit Reporting Act does not guarantee any specific change to a credit report.';

  const WORD_SPACING_NOTE = 'Set to 1.5 line spacing when transferring to Word.';
  const ADDRESS_CONFIRM_NOTE = 'Confirm the bureau mailing address is current before mailing.';

  // Closed list plus postal abbreviations. Bureau and consumer addresses require the two-letter state.
  const ALLOWED_ACRONYMS = new Set([
    'FCRA', 'FDCPA', 'CDIA', 'CRRG', 'SSN', 'DOB', 'ID', 'MOV', 'FTC', 'LLC', 'XXX', 'XX',
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'IA', 'ID', 'IL', 'IN',
    'KS', 'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NJ',
    'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA',
    'WI', 'WV', 'WY'
  ]);

  const BANNED_PHRASES = [
    { code: 'BANNED_PHRASE', re: /609 letter/i, message: 'do not call this a 609 letter' },
    { code: 'BANNED_PHRASE', re: /goodwill/i, message: 'no goodwill, hardship, or courtesy framing' },
    { code: 'BANNED_PHRASE', re: /metro\s*2 violation/i, message: 'name the Metro 2 field and number; do not say "Metro 2 violation" alone' },
    { code: 'BANNED_PHRASE', re: /section\s+1681/i, message: 'use the canonical cite (15 U.S.C. § …), not "section 1681"' }
  ];

  const SECTION_TITLES = [
    ['1', 'Report Summary'],
    ['2', 'Revolving Accounts'],
    ['3', 'Mortgage Accounts'],
    ['4', 'Installment Accounts'],
    ['5', 'Other Accounts'],
    ['6', 'Consumer Statements'],
    ['7', 'Personal Information'],
    ['8', 'Inquiries'],
    ['9', 'Public Records'],
    ['10', 'Collections'],
    ['11', 'Dispute File Information']
  ];

  const CATEGORY_BY_SECTION = { '2': 'revolving', '3': 'mortgage', '4': 'installment', '5': 'other' };

  return {
    BUREAUS, BUREAU_ORDER, CITE, ALLOWED_CASES, METRO2, ACCOUNT_STATUS_CODES, DISCLAIMER,
    WORD_SPACING_NOTE, ADDRESS_CONFIRM_NOTE, ALLOWED_ACRONYMS, BANNED_PHRASES, SECTION_TITLES,
    CATEGORY_BY_SECTION
  };
});
