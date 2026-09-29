/* node test/skill-market-catalog.test.js — the published Skill Market catalog is honest (2026-09-29).

   The catalog in website/ is what starnetos.com serves and what every station downloads. This pins:
     - it is exactly what the sources build (scripts/build-skill-catalog.mjs --check)
     - every bundled original's published digest equals its bundled text, so a fresh station reads BUILT IN, not
       UPDATE, for all of them
     - every file on disk matches the sha256 its entry pins, and the index fits the app's 256 KB fetch cap
     - every community skill ships its LICENSE and names its upstream commit; NOTICE.md credits every skill */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const market = require('../sidecar/skills/market-format.js');
const packageFormat = require('../sidecar/skills/package-format.js');
const catalog = require('../sidecar/skills/catalog.js');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'website', '.well-known', 'starnet-skills.json');

const check = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-skill-catalog.mjs'), '--check'], { encoding: 'utf8' });
A.eq(check.status, 0, 'the committed catalog is exactly what the sources build: ' + (check.stderr || check.stdout).trim().slice(0, 400));

const raw = fs.readFileSync(INDEX, 'utf8');
A.ok(Buffer.byteLength(raw) < 256000, 'the index fits the app\'s 256 KB fetch cap (' + Buffer.byteLength(raw) + ' bytes)');
const read = market.readCatalog(JSON.parse(raw));
A.eq(read.rejected, [], 'the app accepts every entry');
const entries = read.entries;
A.ok(entries.length >= 70, 'the launch catalog has at least 70 skills (' + entries.length + ')');
A.eq(entries[0].shelf, 'originals', 'StarNet Originals come first');

const library = new Map(catalog.loadDir(path.join(ROOT, 'sidecar', 'skills', 'library'), fs, path).map(r => [r.slug, r]));
let bundled = 0, filesOk = true, badFile = '';
for (const e of entries) {
  if (e.librarySlug) {
    bundled++;
    const recipe = library.get(e.librarySlug);
    const d = recipe ? packageFormat.canonicalize([{ path: 'SKILL.md', content: market.libraryToSkillMd(recipe, { version: e.version }) }]).digest : '';
    if (d !== e.digest) A.ok(false, e.slug + ': the bundled copy no longer matches its published version; bump its version in skills-catalog/originals.json and rebuild');
  }
  for (const f of e.files) {
    const p = path.join(ROOT, 'website', 'skills', e.slug, e.version, ...f.path.split('/'));
    const ok = fs.existsSync(p) && crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') === f.sha256;
    if (!ok && filesOk) { filesOk = false; badFile = e.slug + '/' + f.path; }
  }
}
A.ok(bundled >= 46, 'all our bundled originals are published (' + bundled + ')');
A.ok(filesOk, 'every published file matches the sha256 its entry pins' + (badFile ? ' (first mismatch: ' + badFile + ')' : ''));

const community = entries.filter(e => e.shelf === 'community');
A.ok(community.length >= 12, 'the community shelf is stocked (' + community.length + ')');
A.ok(community.every(e => e.files.some(f => /^(LICENSE|COPYING)/.test(f.path))), 'every community skill ships its license text');
A.ok(community.every(e => e.upstream && /^https:\/\//.test(e.upstream.url)), 'every community skill names its upstream');
const notice = fs.readFileSync(path.join(ROOT, 'NOTICE.md'), 'utf8');
const uncredited = entries.filter(e => notice.indexOf('`' + e.slug + '`') < 0).map(e => e.slug);
A.eq(uncredited, [], 'NOTICE.md credits every skill in the catalog');

A.report('skill-market-catalog.test');
