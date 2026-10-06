/* node test/credit-parse.test.js — synthetic three-bureau fixture parses to the documented shape.
   All parsing is on text. pdftotext is only exercised as an injected spawn that is missing. */
'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const A = require('./_assert.js');
const { parse3b } = require('../sidecar/credit/parse-3b.js');
const { makeExtractor } = require('../sidecar/credit/extract.js');

const FIX = path.join(__dirname, 'fixtures', 'credit', 'synthetic-3b-report.txt');
const text = fs.readFileSync(FIX, 'utf8');
const report = parse3b(text);

function view(id, bureau) {
  return report.tradelines.find(t => t.id === id).bureaus[bureau];
}
function reportedCount(bureau) {
  return report.tradelines.filter(t => t.bureaus[bureau] && t.bureaus[bureau].reported).length;
}

A.eq(report.sectionsFound.length, 11, '11 numbered sections');
A.eq(report.source.format, 'three-bureau-equifax-powered', 'format');
A.eq(report.source.reportDate, '2026-09-01', 'report date');
A.eq(report.tradelines.length, 7, 'seven tradelines');
A.eq(report.tradelines.filter(t => t.category === 'revolving').map(t => t.id), ['2.1', '2.2', '2.3', '2.4'], 'four revolving');
A.eq(report.tradelines.filter(t => t.category === 'mortgage').length, 1, 'one mortgage');
A.eq(report.tradelines.filter(t => t.category === 'installment').length, 1, 'one installment');
A.eq(report.tradelines.filter(t => t.category === 'other').length, 1, 'one other');
A.eq([reportedCount('equifax'), reportedCount('experian'), reportedCount('transunion')], [7, 5, 5], 'reported Yes counts');

const sparse = view('2.4', 'equifax');
A.eq(sparse.details, null, '2.4 has no account details');
A.eq(sparse.paymentSummary, null, '2.4 has no payment summary');
A.eq(view('2.4', 'experian').reported, false, '2.4 Experian not reported');

const eq22 = view('2.2', 'equifax').paymentSummary;
A.ok(eq22 && Object.keys(eq22).every(k => eq22[k] === null), '2.2 Equifax payment summary is all N/A');
A.eq(view('2.2', 'experian').paymentSummary.late60, 1, '2.2 Experian late60');
A.eq(view('2.2', 'experian').paymentSummary.late120, 2, '2.2 Experian late120');
A.eq(view('2.2', 'transunion').paymentSummary.late60, 1, '2.2 TransUnion late60');
A.eq(view('2.2', 'transunion').paymentSummary.late120, 1, '2.2 TransUnion late120');
const t22 = report.tradelines.find(t => t.id === '2.2');
A.eq(t22.lastReportedDelinquencies.length, 3, '2.2 has three delinquency marks');
A.eq(t22.lastReportedDelinquencies.map(d => d.month + '=' + d.code), ['08/2026=R6', '07/2026=R5', '05/2026=R3'], 'delinquency marks');

const id = report.personal.byBureau;
A.eq(id.equifax.ssnLast4, '0000', 'ssn last 4');
A.eq(id.experian.dob, '1990-01-01', 'dob');
A.eq(id.experian.formerlyKnownAs, [], 'Experian AKA empty');
A.eq(id.equifax.formerlyKnownAs.length, 2, 'Equifax AKA spans three lines into two entries');
A.eq(id.equifax.formerlyKnownAs[0], 'TESTPERSON ALEX R', 'first AKA entry');
A.eq(id.equifax.formerlyKnownAs[1], 'TESTPERSONSMITH ALEX', 'second AKA entry');

const reportedAddr = { equifax: 0, experian: 0, transunion: 0 };
report.personal.addresses.forEach(a => { if (a.reported) reportedAddr[a.bureau]++; });
A.eq(report.personal.addresses.length, 6, 'two address blocks times three bureaus');
A.eq([reportedAddr.equifax, reportedAddr.experian, reportedAddr.transunion], [2, 1, 1], 'reported address counts');
A.eq(report.personal.employment.filter(e => e.bureau === 'experian').length, 1, 'Experian employment');
A.eq(report.personal.employment.filter(e => e.bureau === 'transunion').length, 2, 'TransUnion employment');
A.eq(report.personal.employment.find(e => e.bureau === 'transunion' && /CONSULTANT/.test(e.company)).company, 'SELF EMPLOYED CONSULTANT', 'occupation continuation stays on the prior row');

const hard = report.inquiries.filter(q => q.type === 'hard');
const soft = report.inquiries.filter(q => q.type === 'soft');
A.eq(hard.length, 6, 'six hard inquiries');
A.eq([hard.filter(q => q.bureau === 'equifax').length, hard.filter(q => q.bureau === 'experian').length, hard.filter(q => q.bureau === 'transunion').length], [1, 3, 2], 'hard inquiry counts match Other Credit Items');
A.eq(soft.length, 0, 'no soft inquiries');

A.eq(report.publicRecords.bankruptcies, [], 'no bankruptcies');
A.eq(report.publicRecords.judgments, [], 'no judgments');
A.eq(report.publicRecords.liens, [], 'no liens');
A.eq(report.publicRecords.raw, [], 'empty public-record raw');

A.eq(report.collections.length, 3, 'three collection blocks');
const fields = ['dateReported', 'agencyClient', 'dateAssigned', 'originalAmountOwed', 'amount', 'statusDate', 'balanceDate', 'purgeDate', 'accountDesignatorCode', 'accountNumberMasked'];
report.collections.forEach(c => {
  fields.forEach(f => A.ok(Object.prototype.hasOwnProperty.call(c, f), c.bureau + ' collection has ' + f));
});
A.eq(report.collections.map(c => c.bureau + ':' + c.last4), ['equifax:8888', 'transunion:8888', 'experian:9999'], 'collection last4s including the page-split Experian block');
A.eq(report.reconciliation.otherItems.collections, [1, 1, 1], 'other-items collection counts');
A.eq(report.reconciliation.tocAccountCount, 7, 'toc account count');

A.eq(parse3b('not a credit report').source.format, null, 'unrecognized text is not forced into the format');
A.ok(parse3b('not a credit report').parseWarnings.some(w => w.code === 'UNRECOGNIZED_FORMAT'), 'unrecognized format warning');

(async () => {
  const extractor = makeExtractor({ fs: fs });
  const txt = await extractor.extract(FIX);
  A.eq(txt.ok, true, 'txt passthrough ok');
  A.eq(txt.source, 'text', 'txt source');
  A.ok(txt.text.indexOf('Three Bureau Credit Report') >= 0, 'txt body returned');

  function missingSpawn() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = function () {};
    process.nextTick(() => {
      const err = new Error('spawn pdftotext ENOENT');
      err.code = 'ENOENT';
      child.emit('error', err);
    });
    return child;
  }
  const pdf = makeExtractor({ fs: fs, spawn: missingSpawn });
  const failed = await pdf.extract('/tmp/missing-report.pdf');
  A.eq(failed.ok, false, 'missing pdftotext fails');
  A.ok(/poppler/.test(failed.error), 'error names poppler');
  A.report('credit-parse.test');
})();
