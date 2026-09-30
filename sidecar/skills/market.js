/* sidecar/skills/market.js — the Skill Market client: browse the StarNet catalog, install a skill into the station
   library, keep it honest.

   The catalog (skills/market-format.js) is a public index on starnetos.com. It is fetched only when the Commander
   opens the market, never in the background. Installing:
     1. downloads exactly the files the catalog entry lists, over the same HTTPS-only, SSRF-checked fetcher the skill
        exchange uses;
     2. checks every file's sha256 AND that the files reproduce the entry's package digest — anything else is refused
        ("doesn't match the catalog"), so a changed file on the server or in transit never installs;
     3. scans the skill with the guard at the CURATED tier (Andrew 2026-09-29, D2: a digest-pinned catalog skill we
        reviewed installs in one click; a dangerous finding is still refused);
     4. writes it to <WORKSPACES>/skill-market/<slug>/ and records the digest of every file.
   Installed market skills join the station SKILL LIBRARY (D3) through recipes(); a market copy of a bundled original
   replaces the bundled copy for this station (D5). recipes() re-hashes the files on disk and leaves out any skill
   whose bytes no longer match what was installed.

   Dependencies are injected (fetchDocument, fs, path, loadJson/saveJson, guard, now) so this is testable without a
   network or a real save. */
'use strict';

const crypto = require('node:crypto');
const packageFormat = require('./package-format.js');
const marketFormat = require('./market-format.js');
const catalog = require('./catalog.js');

const DEFAULT_CATALOG_URL = 'https://starnetos.com/.well-known/starnet-skills.json';
const CACHE_MS = 5 * 60 * 1000;
const REFERENCE_CAP = 60000;   // references ride inline in the recipe body, bounded

function str(v) { return v == null ? '' : String(v); }
function sha256(text) { return crypto.createHash('sha256').update(Buffer.from(str(text), 'utf8')).digest('hex'); }

function makeSkillMarket(deps) {
  deps = deps || {};
  const fetchDocument = deps.fetchDocument;
  const fs = deps.fs, path = deps.path;
  const root = deps.root;
  const guard = deps.guard || null;
  const now = typeof deps.now === 'function' ? deps.now : () => 0;
  const catalogUrl = typeof deps.catalogUrl === 'function' ? deps.catalogUrl : () => DEFAULT_CATALOG_URL;
  const loadJson = deps.loadJson, saveJson = deps.saveJson;
  const onChange = typeof deps.onChange === 'function' ? deps.onChange : () => {};
  const STATE = path.join(root, 'installed.json');
  let cached = null;       // { url, doc, fetchedAt }
  let recipeCache = null;  // [{...recipe}] or null
  let tampered = new Set();

  function state() {
    let s = null;
    try { s = loadJson(STATE); } catch (_) { s = null; }
    return (s && s.installed && typeof s.installed === 'object') ? s : { v: 1, installed: {} };
  }
  function saveState(s) {
    saveJson(STATE, s);
    const back = loadJson(STATE);
    if (JSON.stringify(back && back.installed) !== JSON.stringify(s.installed)) throw new Error('the install record did not read back');
  }

  async function fetchCatalog(opts) {
    opts = opts || {};
    const url = str(catalogUrl()).trim();
    if (!url) throw new Error('the skill market is turned off on this station');
    if (!opts.force && cached && cached.url === url && now() - cached.fetchedAt < CACHE_MS) return cached;
    if (typeof fetchDocument !== 'function') throw new Error('skill market fetching is unavailable');
    const got = await fetchDocument(url);
    let doc; try { doc = JSON.parse(got.text); } catch (_) { throw new Error('the skill market returned invalid JSON'); }
    const read = marketFormat.readCatalog(doc);
    cached = { url: got.url || url, name: read.name, entries: read.entries, rejected: read.rejected, fetchedAt: now() };
    return cached;
  }

  // the digest the bundled copy of an original WOULD have at `version` — equal to the entry's digest means the
  // station's bundled text is exactly what the market publishes, so there is nothing to update
  function bundledDigest(recipe, version) {
    try {
      return packageFormat.canonicalize([{ path: 'SKILL.md', content: marketFormat.libraryToSkillMd(recipe, { version }) }]).digest;
    } catch (_) { return ''; }
  }

  function recipeFrom(rec, files) {
    const doc = marketFormat.readSkillMd(files['SKILL.md'], rec.slug);
    let body = doc.body;
    let refBytes = 0;
    for (const p of Object.keys(files).sort()) {
      if (!/^references\//.test(p)) continue;
      const text = str(files[p]);
      if (refBytes + text.length > REFERENCE_CAP) { body += '\n\n(' + p + ' is too long to include.)'; continue; }
      refBytes += text.length;
      body += '\n\n## Reference: ' + p + '\n' + text.trim();
    }
    return {
      slug: rec.slug, name: rec.name || doc.title, description: doc.description, category: rec.category || doc.category || 'General',
      requires: (rec.requires || []).slice(), author: rec.author || doc.author, license: rec.license || doc.license,
      version: rec.version, default: false, body, market: true, shelf: rec.shelf || 'community'
    };
  }

  // installed market skills as library recipes, re-verified against the recorded file digests every time the cache
  // is rebuilt. A skill whose files changed on disk is left out and reported as tampered.
  function recipes() {
    if (recipeCache) return recipeCache;
    const s = state();
    const out = [];
    const bad = new Set();
    for (const slug of Object.keys(s.installed).sort()) {
      const rec = s.installed[slug];
      try {
        const files = {};
        for (const f of rec.files || []) {
          const text = fs.readFileSync(path.join(root, slug, ...f.path.split('/')), 'utf8');
          if (sha256(text) !== f.sha256) throw new Error('changed on disk');
          files[f.path] = text;
        }
        out.push(recipeFrom(rec, files));
      } catch (_) { bad.add(slug); }
    }
    tampered = bad;
    recipeCache = out;
    return out;
  }
  function invalidate() { recipeCache = null; onChange(); }

  async function listing(opts) {
    opts = opts || {};
    const cat = await fetchCatalog({ force: !!opts.refresh });
    const s = state();
    const mine = recipes();
    const bundled = new Map((opts.bundled || []).map(r => [r.slug, r]));
    const placed = new Set((opts.placedTypes || []).map(String));
    const entries = cat.entries.map(e => {
      const rec = s.installed[e.slug];
      let status = 'available';
      if (rec) {
        status = tampered.has(e.slug) ? 'tampered'
          : marketFormat.compareVersions(e.version, rec.version) > 0 ? 'update' : 'installed';
      } else if (e.librarySlug && bundled.has(e.librarySlug)) {
        status = bundledDigest(bundled.get(e.librarySlug), e.version) === e.digest ? 'bundled' : 'update';
      }
      const missingGear = e.requires.filter(g => !placed.has(g));
      return Object.assign({}, e, {
        status, installedVersion: rec ? rec.version : (status === 'bundled' ? e.version : ''),
        missingGear, files: e.files.map(f => ({ path: f.path, bytes: f.bytes }))
      });
    });
    return { catalog: { name: cat.name, url: cat.url, fetchedAt: cat.fetchedAt, rejected: cat.rejected.length }, entries, installedCount: mine.length };
  }

  async function install(input) {
    const slug = str(input && input.slug);
    const cat = await fetchCatalog({});
    let entry = cat.entries.find(e => e.slug === slug);
    if (!entry) { const fresh = await fetchCatalog({ force: true }); entry = fresh.entries.find(e => e.slug === slug); }
    if (!entry) throw new Error('"' + slug + '" is not in the skill market');
    const files = [];
    for (const f of entry.files) {
      const got = await fetchDocument(marketFormat.fileUrl(cached.url, entry, f.path));
      const text = str(got && got.text);
      if (sha256(text) !== f.sha256) throw new Error(f.path + ' doesn\'t match the catalog, so ' + entry.name + ' was not installed');
      files.push({ path: f.path, content: text });
    }
    const pkg = packageFormat.canonicalize(files);
    if (pkg.digest !== entry.digest) throw new Error(entry.name + ' doesn\'t match the catalog\'s pinned digest, so it was not installed');
    const byPath = {}; for (const f of files) byPath[f.path] = f.content;
    const doc = marketFormat.readSkillMd(byPath['SKILL.md'], slug);
    let verdict = 'safe';
    if (guard && typeof guard.scanSkillRecord === 'function') {
      const scan = guard.scanSkillRecord({ name: slug, body: doc.body, files: files.filter(f => f.path !== 'SKILL.md') }, { source: 'trusted' });
      verdict = scan.verdict;
      const action = typeof guard.actionFor === 'function' ? guard.actionFor({ createdBy: 'trusted' }, scan.verdict) : (scan.verdict === 'dangerous' ? 'block' : 'allow');
      if (action === 'block') throw new Error('the skill guard found dangerous instructions in ' + entry.name + ', so it was not installed');
    }
    // write to a staging folder, then swap it in: a half-written skill never becomes the installed one
    const dir = path.join(root, slug);
    const staging = path.join(root, '.staging-' + slug);
    fs.rmSync(staging, { recursive: true, force: true });
    for (const f of files) {
      const target = path.join(staging, ...f.path.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, f.content, 'utf8');
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(staging, dir);
    const s = state();
    const prior = s.installed[slug];
    s.installed[slug] = {
      slug, version: entry.version, digest: entry.digest, name: entry.name, category: entry.category, requires: entry.requires,
      license: entry.license, author: entry.author, shelf: entry.shelf, librarySlug: entry.librarySlug,
      files: files.map(f => ({ path: f.path, sha256: sha256(f.content) })), verdict, installedAt: now(), source: cached.url
    };
    saveState(s);
    invalidate();
    return { ok: true, action: prior ? 'update' : 'install', slug, name: entry.name, version: entry.version, verdict };
  }

  function uninstall(input) {
    const slug = str(input && input.slug);
    const s = state();
    if (!s.installed[slug]) throw new Error('"' + slug + '" is not installed from the market');
    delete s.installed[slug];
    saveState(s);
    fs.rmSync(path.join(root, slug), { recursive: true, force: true });
    invalidate();
    return { ok: true, slug };
  }

  // mergeLibrary(bundled) -> the station library: bundled recipes, with any market copy replacing the bundled
  // recipe of the same slug, then the market-only skills
  function mergeLibrary(bundled) {
    const market = recipes();
    if (!market.length) return bundled;
    const bySlug = new Map(market.map(r => [r.slug, r]));
    const merged = (bundled || []).map(r => bySlug.get(r.slug) || r);
    const have = new Set(merged.map(r => r.slug));
    for (const r of market) if (!have.has(r.slug)) merged.push(r);
    merged.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return merged;
  }

  return { fetchCatalog, listing, install, uninstall, recipes, mergeLibrary, installed: () => state().installed, _invalidate: invalidate };
}

module.exports = { makeSkillMarket, DEFAULT_CATALOG_URL };
