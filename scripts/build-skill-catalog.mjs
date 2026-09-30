#!/usr/bin/env node
/* scripts/build-skill-catalog.mjs — build the StarNet Skill Market catalog into website/.

   Sources:
     sidecar/skills/library/<slug>.md    StarNet Originals already bundled with the app, listed in skills-catalog/originals.json
                                         (each carries its own `version:` line; bump it when its text changes)
     skills-catalog/skills/<slug>/       market-only skills: skill.json + SKILL.md (+ LICENSE, references/)
     skills-catalog/revoked.json         skills the market has PULLED: { "revoked": [{ slug, digest?, reason, at }] }
   Output (served by starnetos.com, Cloudflare Pages):
     website/.well-known/starnet-skills.json          the index (starnet-skill-registry/v1 + market fields)
     website/.well-known/starnet-skills-revoked.json  the pulled list on its own, for stations to check often
     website/.well-known/*.sig                        an Ed25519 signature over each of the two, byte for byte
     website/skills/<slug>/<version>/<files>          one immutable folder per published version

   Every package is scanned by the skill guard at the curated tier (a dangerous finding fails the build), must carry
   a license (community skills ship the LICENSE text and name their upstream commit), and a version that was already
   published can never change: edit a skill, bump its version.

   SIGNING (sidecar/skills/market-signing.js): stations refuse a catalog or pulled list whose signature does not
   verify with a key the app trusts, and one whose `serial` is lower than one they have already seen. A build that
   changes either document bumps the serial and re-signs, which needs the private key: STARNET_SKILL_MARKET_KEY
   (a path), else ~/.starnet-keys/skill-market.key. The key never goes in the repo or on the website; --check needs
   only the public keys.

   To PULL a skill: add { slug, digest (to pull one published package; omit to pull every version), reason, at } to
   skills-catalog/revoked.json, take it out of the sources (or bump it to a fixed version), rebuild and deploy.
   Stations with it installed switch it off at their next check.

   node scripts/build-skill-catalog.mjs          write (and sign) the catalog
   node scripts/build-skill-catalog.mjs --check  exit 1 if website/ does not match the sources or a signature does
                                                 not verify (the gate runs this)
   node scripts/build-skill-catalog.mjs --pin-floor   after a catalog DEPLOY: raise the app's minimum accepted serial
                                                      (sidecar/skills/market-floor.json) to the serial now live */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { zipStore } from './lib/zip-store.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = require(join(ROOT, 'sidecar/skills/catalog.js'));
const market = require(join(ROOT, 'sidecar/skills/market-format.js'));
const signing = require(join(ROOT, 'sidecar/skills/market-signing.js'));
const guard = require(join(ROOT, 'sidecar/skills/guard.js'));

const LIB = join(ROOT, 'sidecar/skills/library');
const SRC = join(ROOT, 'skills-catalog');
const OUT = join(ROOT, 'website');
const INDEX = join(OUT, '.well-known', 'starnet-skills.json');
const REVOKED = join(OUT, '.well-known', 'starnet-skills-revoked.json');
const FLOOR = join(ROOT, 'sidecar', 'skills', 'market-floor.json');
const SIGNING_KEY = process.env.STARNET_SKILL_MARKET_KEY || join(homedir(), '.starnet-keys', 'skill-market.key');

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
    // the version lives in the recipe itself, so the app knows which copy is newer (a built-in recipe at a higher
    // version than an installed market copy wins); editing a recipe means bumping its `version:` line
    const version = recipe.version;
    if (!version) throw new Error('sidecar/skills/library/' + slug + '.md is published to the Skill Market, so it needs a `version:` line in its frontmatter');
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
  // 4. pulled skills: a pulled package may never still be published
  const revokedPath = join(SRC, 'revoked.json');
  const rawRevoked = existsSync(revokedPath) ? JSON.parse(readText(revokedPath)).revoked : [];
  if (!Array.isArray(rawRevoked)) throw new Error('skills-catalog/revoked.json must be { "revoked": [...] }');
  const revoked = market.readRevoked(rawRevoked);
  if (revoked.length !== rawRevoked.length || rawRevoked.some(r => !String(r.reason || '').trim())) {
    throw new Error('skills-catalog/revoked.json has a malformed row: each needs a slug, a reason, and optionally the 64-hex digest of one published package');
  }
  for (const { entry } of built) {
    if (market.revokedMatch(revoked, entry.slug, entry.digest)) throw new Error(entry.slug + '@' + entry.version + ' is pulled in skills-catalog/revoked.json but still published; remove it from the sources or bump it to a fixed version');
  }
  // 5. a downloadable .zip of each package (a standard Agent Skills folder: <slug>/SKILL.md, LICENSE, references/),
  //    pinned by sha256 in the signed index. Stations never use it; the website's Download button does.
  for (const b of built) {
    b.zip = zipStore(b.pkg.files.map(f => ({ name: b.entry.slug + '/' + f.path, data: Buffer.from(f.content, 'base64') })));
    b.entry.download = { path: b.entry.slug + '-' + b.entry.version + '.zip', sha256: createHash('sha256').update(b.zip).digest('hex'), bytes: b.zip.length };
  }
  // 6. the serial: unchanged content keeps the published serial, any change bumps it (stations refuse a lower one)
  const entries = built.map(b => b.entry);
  const prior = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : null;
  const priorSerial = market.serialOf(prior);
  const unchanged = priorSerial && bodyOf(prior) === bodyOf(market.catalogDocument(entries, { serial: priorSerial, revoked }));
  const serial = !priorSerial ? 1 : unchanged ? priorSerial : priorSerial + 1;
  return { index: market.catalogDocument(entries, { serial, revoked }), revocations: market.revocationDocument({ serial, revoked }), packages: built };
}

// a document's content without its serial, to tell a real change from a rebuild
function bodyOf(doc) { const copy = Object.assign({}, doc); delete copy.serial; return JSON.stringify(copy); }
function jsonBytes(doc) { return Buffer.from(JSON.stringify(doc, null, 2) + '\n', 'utf8'); }

function planWrites(result) {
  const writes = [];
  for (const { entry, pkg, zip } of result.packages) {
    for (const f of pkg.files) {
      writes.push({ path: join(OUT, 'skills', entry.slug, entry.version, ...f.path.split('/')), bytes: Buffer.from(f.content, 'base64'), immutable: true, label: entry.slug + '@' + entry.version + '/' + f.path });
    }
    writes.push({ path: join(OUT, 'skills', entry.slug, entry.version, entry.download.path), bytes: zip, immutable: true, label: entry.slug + '@' + entry.version + '/' + entry.download.path });
  }
  for (const [file, doc, label] of [[INDEX, result.index, '.well-known/starnet-skills.json'], [REVOKED, result.revocations, '.well-known/starnet-skills-revoked.json']]) {
    const bytes = jsonBytes(doc);
    writes.push({ path: file, bytes, immutable: false, label });
    writes.push({ path: file + '.sig', signs: bytes, immutable: false, label: label + '.sig' });
  }
  return writes;
}

// signatureHolds(file, bytes) -> the .sig on disk verifies over exactly these bytes with a key the app trusts
function signatureHolds(file, bytes) {
  if (!existsSync(file)) return false;
  try { signing.verify(bytes, readFileSync(file, 'utf8')); return true; } catch (_) { return false; }
}

let signingKey = null;
function signWith(bytes) {
  if (!signingKey) {
    if (!existsSync(SIGNING_KEY)) throw new Error('the catalog changed, so it must be re-signed, and there is no signing key at ' + SIGNING_KEY + ' (set STARNET_SKILL_MARKET_KEY to its path)');
    signingKey = readFileSync(SIGNING_KEY, 'utf8');
  }
  return Buffer.from(signing.sign(bytes, signingKey), 'utf8');
}

function main() {
  const check = process.argv.includes('--check');
  const result = buildCatalog();
  const writes = planWrites(result);
  const problems = [];
  for (const w of writes) {
    const exists = existsSync(w.path);
    if (w.signs) {
      if (signatureHolds(w.path, w.signs)) continue;
      if (check) { problems.push(w.label + (exists ? ' does not verify over the published bytes' : ' is missing')); continue; }
      mkdirSync(dirname(w.path), { recursive: true });
      writeFileSync(w.path, signWith(w.signs));
      continue;
    }
    const same = exists && Buffer.compare(readFileSync(w.path), w.bytes) === 0;
    if (same) continue;
    if (exists && w.immutable) { problems.push(w.label + ' was already published with different bytes; bump the version instead of editing it'); continue; }
    if (check) { problems.push(w.label + (exists ? ' is out of date' : ' is missing')); continue; }
    mkdirSync(dirname(w.path), { recursive: true });
    writeFileSync(w.path, w.bytes);
  }
  // THE FLOOR: sidecar/skills/market-floor.json ships in the app; stations refuse an official catalog older than it.
  // It may never be above the serial being published (every station would refuse the live catalog), and it is only
  // raised on purpose, after a deploy: --pin-floor sets it to the serial that is now live.
  const floor = JSON.parse(readFileSync(FLOOR, 'utf8'));
  if (!Number.isSafeInteger(floor.serial) || floor.serial < 0) problems.push('sidecar/skills/market-floor.json needs a whole-number serial');
  else if (floor.serial > result.index.serial) problems.push('sidecar/skills/market-floor.json pins serial ' + floor.serial + ', above the catalog\'s ' + result.index.serial + ': every station would refuse it');
  if (process.argv.includes('--pin-floor') && !problems.length && !check) {
    floor.serial = result.index.serial;
    writeFileSync(FLOOR, JSON.stringify(floor, null, 2) + '\n');
    console.log('build-skill-catalog: pinned the app\'s minimum catalog serial to ' + floor.serial + ' (sidecar/skills/market-floor.json) — it ships with the next app build');
  }
  const n = result.index.skills.length;
  const byShelf = result.index.skills.reduce((m, s) => (m[s.shelf] = (m[s.shelf] || 0) + 1, m), {});
  if (problems.length) {
    console.error('build-skill-catalog: ' + problems.length + ' problem(s):\n  ' + problems.join('\n  ') + (check ? '\nRun: node scripts/build-skill-catalog.mjs' : ''));
    process.exit(1);
  }
  console.log('build-skill-catalog: ' + (check ? 'up to date' : 'wrote') + ' — ' + n + ' skills (' + Object.entries(byShelf).map(([k, v]) => v + ' ' + k).join(', ') + '), ' +
    result.index.revoked.length + ' pulled, serial ' + result.index.serial + ', signed');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (e) { console.error('build-skill-catalog: ' + (e && e.message || e)); process.exit(1); }
}
