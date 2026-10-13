/* node test/dashboard-hooks.test.js — check_hooks.js fails when a restyle drops a hook. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const A = require('./_assert.js');
const hooks = require('../scripts/dashboard/check_hooks.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'dashboard', 'check_hooks.js');
const PAGE = path.join(__dirname, '..', 'scripts', 'dashboard', 'index.html');

function run(oldPath, newPath) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, oldPath, newPath], { encoding: 'utf8' });
    return { code: 0, out: out };
  } catch (err) {
    return { code: err.status, out: String(err.stdout || ''), err: String(err.stderr || '') };
  }
}

const OLD = [
  '<form id="upload-form" action="/upload" method="post">',
  '<input name="report" data-queue="clear">',
  '<button id="remove-btn" type="submit" data-act="remove" formaction="/queue/remove">Remove</button>',
  '<button id="export-pdf" type="button" data-act="export">Export PDF</button>',
  '<button id="approve-btn" type="button" data-act="approve">Approve</button>',
  '<button id="reject-btn" type="button" data-act="reject">Reject</button>',
  '</form>',
  '<a id="mailman-link" href="/mailman">mailman</a>',
  '<script>',
  "document.getElementById('remove-btn');",
  "document.querySelector('#upload-form');",
  "document.querySelectorAll('.queue-row');",
  "document.getElementById('mailman-link');",
  '</script>'
].join('\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-hooks-'));
const oldFile = path.join(tmp, 'old.html');
const sameFile = path.join(tmp, 'same.html');
const droppedFile = path.join(tmp, 'dropped.html');
fs.writeFileSync(oldFile, OLD);
fs.writeFileSync(sameFile, OLD + '\n<button id="extra">Extra</button>\n');
fs.writeFileSync(droppedFile, [
  '<form id="upload-form" method="post">',
  '<input data-queue="clear">',
  '<button id="export-pdf" type="button" data-act="export">Export PDF</button>',
  '<button id="approve-btn" type="button" data-act="approve">Approve</button>',
  '<button id="reject-btn" type="button" data-act="reject">Reject</button>',
  '</form>',
  '<a href="/mailman">mailman</a>',
  '<script>',
  "document.querySelectorAll('.queue-row');",
  "document.getElementById('export-pdf');",
  '</script>'
].join('\n'));

const kept = run(oldFile, sameFile);
A.eq(kept.code, 0, 'a superset of the old hooks exits 0');
A.ok(/^ok \d+ hooks/.test(kept.out), 'success names the hook count');

const lost = run(oldFile, droppedFile);
A.eq(lost.code, 1, 'dropped hooks exit 1');
[
  'id:remove-btn',
  'id:mailman-link',
  'name:report',
  'form-action:/upload',
  'form-action:/queue/remove',
  'data:data-act=remove',
  'js:getElementById:remove-btn',
  'js:getElementById:mailman-link',
  'js:querySelector:#upload-form'
].forEach(function (hook) {
  A.ok(lost.out.indexOf(hook) >= 0, 'lists ' + hook);
});
A.ok(lost.out.indexOf('id:export-pdf') < 0, 'an id that remains is not listed');
A.ok(lost.out.indexOf('data:data-act=approve') < 0, 'an action that remains is not listed');
A.ok(lost.out.indexOf('js:querySelectorAll:.queue-row') < 0, 'a selector that remains is not listed');

const oldDir = path.join(tmp, 'before');
const newDir = path.join(tmp, 'after');
fs.mkdirSync(path.join(oldDir, 'pages'), { recursive: true });
fs.mkdirSync(newDir, { recursive: true });
fs.writeFileSync(path.join(oldDir, 'index.html'), OLD);
fs.writeFileSync(path.join(oldDir, 'pages', 'mailman.html'), '<section id="mailman-root"></section>\n<script>document.querySelector("#mailman-root");</script>\n');
fs.writeFileSync(path.join(newDir, 'index.html'), OLD);
fs.writeFileSync(path.join(newDir, 'mailman.html'), '<section></section>\n');
const dir = run(oldDir, newDir);
A.eq(dir.code, 1, 'a directory compare sees a nested page');
A.ok(dir.out.indexOf('id:mailman-root') >= 0, 'lists the mailman id');
A.ok(dir.out.indexOf('js:querySelector:#mailman-root') >= 0, 'lists the mailman selector');
A.ok(dir.out.indexOf('id:remove-btn') < 0, 'hooks still in index.html are kept');

const self = run(PAGE, PAGE);
A.eq(self.code, 0, 'the restyled desk matches itself');
const pageHooks = hooks.collectHooks(fs.readFileSync(PAGE, 'utf8'));
['id:case-queue', 'id:case-list', 'id:case-review', 'id:review-body', 'data:data-id', 'data:data-act=approve', 'js:getElementById:case-list', 'js:closest:[data-act]'].forEach(function (hook) {
  A.ok(pageHooks.indexOf(hook) >= 0, 'desk still exposes ' + hook);
});

const broken = path.join(tmp, 'broken.html');
fs.writeFileSync(broken, fs.readFileSync(PAGE, 'utf8').replace('id="case-list"', 'class="case-list"').replace("getElementById('case-list')", "getElementById('case-list-gone')"));
const regressed = run(PAGE, broken);
A.eq(regressed.code, 1, 'dropping the case list id fails the guard');
A.ok(regressed.out.indexOf('id:case-list') >= 0, 'names the lost case-list id');
A.ok(regressed.out.indexOf('js:getElementById:case-list') >= 0, 'names the lost case-list lookup');

const bad = run(path.join(tmp, 'nope'), PAGE);
A.eq(bad.code, 2, 'a missing path exits 2');

A.report('dashboard-hooks.test');
