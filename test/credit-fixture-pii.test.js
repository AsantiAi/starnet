/* node test/credit-fixture-pii.test.js — committed credit fixtures stay synthetic.
   An unmasked 9-digit SSN or a 12-or-more digit account number fails the build. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

const ROOT = path.join(__dirname, 'fixtures', 'credit');
const SSN = /\b\d{3}-?\d{2}-?\d{4}\b/;
const ACCOUNT = /\b\d{12,}\b/;

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT, []);
A.ok(files.length >= 4, 'the synthetic fixture set is present');
files.forEach(file => {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const ssn = text.match(SSN);
  const acct = text.match(ACCOUNT);
  A.eq(ssn, null, rel + ' has no unmasked SSN' + (ssn ? ' (' + ssn[0] + ')' : ''));
  A.eq(acct, null, rel + ' has no 12+ digit account number' + (acct ? ' (' + acct[0] + ')' : ''));
});

A.report('credit-fixture-pii.test');
