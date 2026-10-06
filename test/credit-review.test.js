/* node test/credit-review.test.js — review flags on the synthetic fixture. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const { parse3b } = require('../sidecar/credit/parse-3b.js');
const { reviewReport } = require('../sidecar/credit/review.js');

const report = parse3b(fs.readFileSync(path.join(__dirname, 'fixtures', 'credit', 'synthetic-3b-report.txt'), 'utf8'));
const flags = reviewReport(report);

function has(code, where, severity) {
  return flags.some(f => f.code === code && (!where || f.where === where || (where instanceof RegExp && where.test(f.where))) && (!severity || f.severity === severity));
}

A.ok(has('STATUS_PASTDUE_CONFLICT', '2.3/experian', 'REVIEW'), 'pattern A on 2.3 Experian');
A.ok(flags.some(f => f.code === 'DOFD_MISSING_ON_DEROG' && f.where.indexOf('2.2/') === 0), 'DOFD missing on 2.2');
A.ok(flags.some(f => f.code === 'DOFD_MISSING_ON_DEROG' && f.where.indexOf('4.1/') === 0), 'DOFD missing on 4.1');
A.ok(flags.some(f => f.code === 'DOFD_MISSING_ON_DEROG' && f.where.indexOf('5.1/') === 0), 'DOFD missing on 5.1');
A.ok(flags.some(f => f.code === 'CROSS_BUREAU_CONFLICT' && f.where === '2.2' && /balance/.test(f.detail)), '2.2 balance conflict');
A.ok(flags.some(f => f.code === 'CROSS_BUREAU_CONFLICT' && f.where === '2.2' && /amount past due/.test(f.detail)), '2.2 past-due conflict');
A.ok(has('ACCOUNT_NUMBER_VARIANCE', '2.2', 'REVIEW'), 'EQ vs TU last4 on 2.2 is REVIEW');
A.ok(has('ACCOUNT_NUMBER_VARIANCE', '2.1', 'INFO'), 'Experian-only variance on 2.1 is INFO');
A.ok(has('ACCOUNT_NUMBER_VARIANCE', '5.1', 'INFO'), 'Experian-only variance on 5.1 is INFO');
A.ok(flags.some(f => (f.code === 'UNMATCHED_COLLECTION' || f.pattern === 'D') && f.where === '5.1'), 'collection tradeline 5.1 is a pattern D candidate');
A.ok(has('INQUIRY_NO_TRADELINE', 'inquiry/UNKNOWN AUTO FINANCE', 'REVIEW'), 'unknown auto finance has no tradeline');
A.ok(!flags.some(f => f.code === 'INQUIRY_NO_TRADELINE' && /DEMO CREDIT UNION|EXAMPLE BK|DEMO CU|EXAMPLE BANK/.test(f.where)), 'abbreviated furnishers still match a tradeline');
A.ok(flags.some(f => f.code === 'PAYMENT_GRID_UNAVAILABLE'), 'payment grid is icons');
A.ok(flags.some(f => f.code === 'COUNT_MISMATCH' && f.where === 'personalInformation'), 'personal-information summary counts do not match a mechanical row count');
A.ok(!flags.some(f => f.severity === 'BLOCK'), 'a well-formed synthetic report has no block flag');

A.report('credit-review.test');
