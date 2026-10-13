#!/usr/bin/env node
/* scripts/dashboard/check_hooks.js — fail if a restyle drops a dashboard hook.

   node scripts/dashboard/check_hooks.js OLD NEW

   OLD and NEW are each a file or a directory. A directory is every .html,
   .htm, .js, and .mjs file under it (not node_modules). The script collects
   element ids, name attributes, form actions (action and formaction),
   data-* attributes, and id/selector literals passed to getElementById,
   querySelector, querySelectorAll, closest, matches, getElementsBy*,
   getAttribute, and setAttribute.

   Exit 0 when every OLD hook is still in NEW. Exit 1 and list the missing
   hooks otherwise. Exit 2 on a bad path. No dependencies.

   On the iMac, save the live pages first, merge, save them again, then:

     node scripts/dashboard/check_hooks.js /tmp/desk-before /tmp/desk-after

   Rollback the live files in one command (DASH is the directory the server reads):

     cp -R /tmp/desk-before/. "$DASH/"
*/
'use strict';

const fs = require('fs');
const path = require('path');

const EXT = { '.html': true, '.htm': true, '.js': true, '.mjs': true };

function isStatic(value) {
  return !!value && value.length < 240 && !/[\s+`$<>]/.test(value);
}

function add(set, hook) {
  if (hook) set.add(hook);
}

function eachAttr(raw, fn) {
  const re = /([^\s=\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(raw))) {
    const value = m[2] != null ? m[2] : (m[3] != null ? m[3] : (m[4] != null ? m[4] : ''));
    fn(m[1], value);
  }
}

function scanTags(text, set) {
  const re = /<([a-zA-Z][\w:-]*)(\s[^<>]*)?>/g;
  let m;
  while ((m = re.exec(text))) {
    const tag = m[1].toLowerCase();
    eachAttr(m[2] || '', function (key, value) {
      const k = key.toLowerCase();
      if (k === 'id' && isStatic(value)) add(set, 'id:' + value);
      else if (k === 'name' && isStatic(value)) add(set, 'name:' + value);
      else if ((k === 'action' && tag === 'form') || k === 'formaction') add(set, 'form-action:' + value);
      else if (k.indexOf('data-') === 0) {
        add(set, 'data:' + k);
        if (isStatic(value)) add(set, 'data:' + k + '=' + value);
      }
    });
  }
}

function scanJs(text, set) {
  let m;
  const byId = /getElementById\(\s*(['"`])([^'"`]*)\1\s*\)/g;
  while ((m = byId.exec(text))) {
    if (m[2] && m[2].indexOf('${') < 0) add(set, 'js:getElementById:' + m[2]);
  }
  const by = /getElementsBy(Name|ClassName|TagName)\(\s*(['"`])([^'"`]*)\2\s*\)/g;
  while ((m = by.exec(text))) {
    if (m[3] && m[3].indexOf('${') < 0) add(set, 'js:getElementsBy' + m[1] + ':' + m[3]);
  }
  const sel = /(querySelectorAll|querySelector|closest|webkitMatchesSelector|matches)\(\s*(['"`])([^'"`]*)\2\s*\)/g;
  while ((m = sel.exec(text))) {
    if (!m[3] || m[3].indexOf('${') >= 0) continue;
    add(set, 'js:' + m[1] + ':' + m[3].replace(/\s+/g, ' ').trim());
  }
  const getAttr = /getAttribute\(\s*(['"`])([^'"`]+)\1\s*\)/g;
  while ((m = getAttr.exec(text))) {
    const name = m[2].toLowerCase();
    if (name.indexOf('data-') === 0) add(set, 'data:' + name);
    else if (name === 'id' || name === 'name' || name === 'action') add(set, 'js:getAttribute:' + name);
  }
  const setAttr = /setAttribute\(\s*(['"`])([^'"`]+)\1\s*,\s*(['"`])([^'"`]*)\3\s*\)/g;
  while ((m = setAttr.exec(text))) {
    const name = m[2].toLowerCase();
    const value = m[4];
    if (name === 'id' && isStatic(value)) add(set, 'id:' + value);
    else if (name === 'name' && isStatic(value)) add(set, 'name:' + value);
    else if (name.indexOf('data-') === 0) {
      add(set, 'data:' + name);
      if (isStatic(value)) add(set, 'data:' + name + '=' + value);
    }
  }
  const dataset = /\bdataset\.([A-Za-z_][\w]*)/g;
  while ((m = dataset.exec(text))) {
    const kebab = m[1].replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
    add(set, 'data:data-' + kebab);
  }
  const datasetKey = /\bdataset\[\s*(['"`])([^'"`]+)\1\s*\]/g;
  while ((m = datasetKey.exec(text))) add(set, 'data:data-' + m[2]);
}

function collectHooks(text) {
  const set = new Set();
  scanTags(String(text || ''), set);
  scanJs(String(text || ''), set);
  return Array.from(set).sort();
}

function listFiles(target) {
  const st = fs.statSync(target);
  if (st.isFile()) return [target];
  const out = [];
  function walk(dir) {
    fs.readdirSync(dir).forEach(function (name) {
      if (name === 'node_modules' || name === '.git') return;
      const full = path.join(dir, name);
      const child = fs.statSync(full);
      if (child.isDirectory()) walk(full);
      else if (EXT[path.extname(name).toLowerCase()]) out.push(full);
    });
  }
  walk(target);
  return out.sort();
}

function hooksFromPath(target) {
  const set = new Set();
  listFiles(target).forEach(function (file) {
    collectHooks(fs.readFileSync(file, 'utf8')).forEach(function (hook) { set.add(hook); });
  });
  return Array.from(set).sort();
}

function missingHooks(oldHooks, newHooks) {
  const have = new Set(newHooks);
  return oldHooks.filter(function (hook) { return !have.has(hook); });
}

function main(argv) {
  const oldPath = argv[2];
  const newPath = argv[3];
  if (!oldPath || !newPath || argv.length > 4) {
    console.error('usage: node scripts/dashboard/check_hooks.js OLD NEW');
    console.error('OLD and NEW are dashboard files or directories (.html, .htm, .js, .mjs).');
    console.error('Exits 1 when a hook in OLD is missing from NEW.');
    process.exit(2);
  }
  let oldHooks, newHooks;
  try {
    oldHooks = hooksFromPath(oldPath);
    newHooks = hooksFromPath(newPath);
  } catch (err) {
    console.error('check_hooks: ' + (err && err.message ? err.message : err));
    process.exit(2);
  }
  const missing = missingHooks(oldHooks, newHooks);
  if (!missing.length) {
    console.log('ok ' + oldHooks.length + ' hooks');
    process.exit(0);
  }
  console.log('missing ' + missing.length + ' hook(s) present in OLD and absent from NEW:');
  missing.forEach(function (hook) { console.log(hook); });
  process.exit(1);
}

if (require.main === module) main(process.argv);

module.exports = { collectHooks, hooksFromPath, missingHooks, listFiles };
