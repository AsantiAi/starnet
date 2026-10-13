/* node test/dashboard-desk.test.js — the dispute desk restyle keeps the original hooks. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'dashboard', 'index.html'), 'utf8');

['case-queue', 'case-list', 'case-review', 'review-body'].forEach(function (id) {
  A.ok(html.indexOf('id="' + id + '"') >= 0, 'original id remains: ' + id);
});
A.ok(html.indexOf("getElementById('case-list')") >= 0, 'case-list hook');
A.ok(html.indexOf("getElementById('review-body')") >= 0, 'review-body hook');
A.ok(html.indexOf('data-id') >= 0, 'case buttons keep data-id');
A.ok(html.indexOf('aria-current') >= 0, 'selected case keeps aria-current');
A.ok(html.indexOf("fetch('/api/cases'") >= 0, 'case list still reads GET /api/cases');
A.ok(html.indexOf("fetch('/api/cases/' + encodeURIComponent(id)") >= 0, 'case detail still reads GET /api/cases/:id');
A.ok(html.indexOf('class="case"') >= 0, 'case button class remains');
A.ok(html.indexOf('type="button"') >= 0, 'case rows stay buttons');

var fetches = html.match(/fetch\([^)]*\)/g) || [];
A.eq(fetches.length, 2, 'the page still has the two case reads');
fetches.forEach(function (call) {
  A.ok(call.indexOf('/api/cases') >= 0, 'fetch stays on the cases API: ' + call);
});
A.ok(!/<form[\s>]/i.test(html), 'no form was added');
A.ok(!/['"]POST['"]/.test(html), 'no POST');
A.ok(html.indexOf('Asanti Management and Services LLC') >= 0, 'brand name');
A.ok(html.indexOf('DISPUTES') >= 0, 'brand mark');
A.ok(html.indexOf('#2f5d46') >= 0, 'approved green');
A.ok(html.indexOf('No dispute results yet') >= 0, 'disputes empty state');
A.ok(html.indexOf('>Approve<') >= 0 && html.indexOf('>Reject<') >= 0 && html.indexOf('>Preview PDF<') >= 0, 'letter actions from the case-view mock');

A.report('dashboard-desk.test');
