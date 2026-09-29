#!/usr/bin/env node
/* scripts/build-skill-catalog.mjs — build the StarNet Skill Market catalog into website/.

   Sources:
     sidecar/skills/library/<slug>.md    StarNet Originals already bundled with the app, listed in skills-catalog/originals.json
     skills-catalog/skills/<slug>/       market-only skills: skill.json + SKILL.md (+ LICENSE, references/)
   Output (served by starnetos.com, Cloudflare Pages):
     website/.well-known/starnet-skills.json          the index (starnet-skill-registry/v1 + market fields)
     website/skills/<slug>/<version>/<files>          one immutable folder per published version

   Every package is scanned by the skill guard at the curated tier (a dangerous finding fails the build), must carry
   a license (community skills ship the LICENSE text and name their upstream commit), and a version that was already
   published can never change: edit a skill, bump its version.

   node scripts/build-skill-catalog.mjs          write the catalog
   node scripts/build-skill-catalog.mjs --check  exit 1 if website/ does not match the sources (the gate runs this) */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = require(join(ROOT, 'sidecar/skills/catalog.js'));
const market = require(join(ROOT, 'sidecar/skills/market-format.js'));
const guard = require(join(ROOT, 'sidecar/skills/guard.js'));

const LIB = join(ROOT, 'sidecar/skills/library');
const SRC = join(ROOT, 'skills-catalog');
const OUT = join(ROOT, 'website');
const INDEX = join(OUT, '.well-known', 'starnet-skills.json');

function lf(s) { return String(s).replace(/\r\n/g, '\n'); }
function readText(p) { return lf(readFileSync(p, 'utf8')).replace(/^﻿/, ''); }

function scanOrThrow(slug, files) {
  const main = files.find(f => f.path === 'SKILL.md');
  const body = catalog.parseFrontmatter(main.content).body;
  const scan = guard.scanSkillRecord({ name: slug, body, files: files.filter(f => f.path !== 'SKILL.md') }, { source: 'trusted' });
  const action = guard.actionFor({ createdBy: 'trusted' }, scan.verdict);
  if (action === 'block') {
    const cats = [...new Set(scan.findings.filter(f => f.severity === 'high' || f.severity === 'critical').map(f => f.category + ':' + f.patternId))];
    throw new Error(slug + ': the skill guard rates this package dangerous (' + cats.join(', ') + ')');
  }
  return scan;
}

export function buildCatalog() {
  const sources = [];
  // 1. StarNet Originals from the bundled library
  const originals = JSON.parse(readText(join(SRC, 'originals.json')));
  const library = catalog.loadDir(LIB, { readdirSync, readFileSync }, { join });
  const bySlug = new Map(library.map(r => [r.slug, r]));
  for (const slug of Object.keys(originals.skills || {}).sort()) {
    const recipe = bySlug.get(slug);
    if (!recipe) throw new Error('originals.json lists "' + slug + '" but sidecar/skills/library has no such recipe');
    const version = originals.skills[slug].version;
    sources.push({
      slug, version, shelf: 'originals', category: recipe.category, requires: recipe.requires,
      tags: [recipe.category.toLowerCase()].concat(originals.skills[slug].tags || []), license: recipe.license || 'MIT',
      authors: ['StarNet'], librarySlug: slug,
      files: [{ path: 'SKILL.md', content: market.libraryToSkillMd(recipe, { version }) }]
    });
  }
  // 2. market-only skills
  const dir = join(SRC, 'skills');
  const folders = existsSync(dir) ? readdirSync(dir).filter(n => statSync(join(dir, n)).isDirectory()).sort() : [];
  for (const slug of folders) {
    const base = join(dir, slug);
    if (!existsSync(join(base, 'skill.json'))) throw new Error(slug + ': missing skill.json');
    const meta = JSON.parse(readText(join(base, 'skill.json')));
    if (meta.slug !== slug) throw new Error(slug + ': skill.json slug must match its folder');
    if (bySlug.has(slug) && meta.shelf !== 'originals') throw new Error(slug + ': collides with a bundled library recipe');
    const files = [];
    const walk = (rel) => {
      for (const name of readdirSync(join(base, rel)).sort()) {
        const r = rel ? rel + '/' + name : name;
        if (statSync(join(base, r)).isDirectory()) walk(r);
        else if (r !== 'skill.json') files.push({ path: r, content: readText(join(base, r)) });
      }
    };
    walk('');
    sources.push(Object.assign({}, meta, { files }));
  }
  // 3. build, scan, dedupe
  const seen = new Set();
  const built = sources.map(src => {
    if (seen.has(src.slug)) throw new Error(src.slug + ': listed twice');
    seen.add(src.slug);
    const b = market.buildEntry(src);
    scanOrThrow(src.slug, src.files);
    return b;
  });
  return { index: market.catalogDocument(built.map(b => b.entry)), packages: built };
}

function planWrites(result) {
  const writes = [];
  for (const { entry, pkg } of result.packages) {
    for (const f of pkg.files) {
      writes.push({ path: join(OUT, 'skills', entry.slug, entry.version, ...f.path.split('/')), bytes: Buffer.from(f.content, 'base64'), immutable: true, label: entry.slug + '@' + entry.version + '/' + f.path });
    }
  }
  writes.push({ path: INDEX, bytes: Buffer.from(JSON.stringify(result.index, null, 2) + '\n', 'utf8'), immutable: false, label: '.well-known/starnet-skills.json' });
  return writes;
}

function main() {
  const check = process.argv.includes('--check');
  const result = buildCatalog();
  const writes = planWrites(result);
  const problems = [];
  for (const w of writes) {
    const exists = existsSync(w.path);
    const same = exists && Buffer.compare(readFileSync(w.path), w.bytes) === 0;
    if (same) continue;
    if (exists && w.immutable) { problems.push(w.label + ' was already published with different bytes; bump the version instead of editing it'); continue; }
    if (check) { problems.push(w.label + (exists ? ' is out of date' : ' is missing')); continue; }
    mkdirSync(dirname(w.path), { recursive: true });
    writeFileSync(w.path, w.bytes);
  }
  const n = result.index.skills.length;
  const byShelf = result.index.skills.reduce((m, s) => (m[s.shelf] = (m[s.shelf] || 0) + 1, m), {});
  if (problems.length) {
    console.error('build-skill-catalog: ' + problems.length + ' problem(s):\n  ' + problems.join('\n  ') + (check ? '\nRun: node scripts/build-skill-catalog.mjs' : ''));
    process.exit(1);
  }
  console.log('build-skill-catalog: ' + (check ? 'up to date' : 'wrote') + ' — ' + n + ' skills (' + Object.entries(byShelf).map(([k, v]) => v + ' ' + k).join(', ') + ')');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (e) { console.error('build-skill-catalog: ' + (e && e.message || e)); process.exit(1); }
}
