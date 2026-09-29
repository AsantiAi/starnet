/* sidecar/skills/market-format.js — the StarNet Skill Market catalog format, shared by the build script
   (scripts/build-skill-catalog.mjs, which writes the catalog into website/) and the app (skills/market.js, which
   reads it). One definition so the two can never disagree about slugs, versions, digests or the file manifest.

   The index is the existing `starnet-skill-registry/v1` document (so the SKILL EXCHANGE registry reader can also
   read it) with extra fields per entry: slug, shelf, category, tags, requires, librarySlug and `files`, the exact
   manifest the app downloads. `digest` is the open-agent-skill-package/v1 digest over those files; the app refuses
   an install whose downloaded bytes do not reproduce it. Every version lives in its own folder
   (/skills/<slug>/<version>/…) and is never rewritten once published.

   Market packages are TEXT ONLY (UTF-8, no NUL bytes): SKILL.md, an optional LICENSE/NOTICE at the root and
   optional references/ files. Pure: no network, no clock. */
'use strict';

const packageFormat = require('./package-format.js');
const catalog = require('./catalog.js');

const FORMAT = 'starnet-skill-registry/v1';
const MARKET_NAME = 'StarNet Skill Market';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SHELVES = ['originals', 'community'];
const GEAR = ['cabinet', 'dish', 'workbench', 'notebook', 'studio', 'orchestrator', 'computer'];
const ROOT_FILES = /^(?:LICENSE|NOTICE|COPYING)(?:\.(?:md|txt))?$/;
const MAX_ENTRIES = 500;

function str(v) { return v == null ? '' : String(v); }
function list(v) { return Array.isArray(v) ? v.map(x => str(x).trim()).filter(Boolean) : []; }
function q(v) { return JSON.stringify(str(v)); }

function versionParts(v) { return str(v).split('.').map(n => parseInt(n, 10) || 0); }
// compareVersions(a, b) -> -1 | 0 | 1 on dotted numeric versions ("1.10.0" > "1.9.3")
function compareVersions(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/* libraryToSkillMd — a bundled StarNet recipe (sidecar/skills/library/<slug>.md, parsed by catalog.parse) as a
   standard Agent Skills SKILL.md: spec name = the slug, the display title under metadata.title. The body is the
   recipe body byte for byte, so the market copy and the bundled copy say the same thing at the same version. */
function libraryToSkillMd(recipe, opts) {
  opts = opts || {};
  const lines = ['---', 'name: ' + recipe.slug, 'description: ' + q(str(recipe.description).replace(/\s+/g, ' ').trim()),
    'license: ' + q(recipe.license || 'MIT'), 'metadata:', '  title: ' + q(recipe.name), '  category: ' + q(recipe.category || 'General'),
    '  author: ' + q(opts.author || 'StarNet')];
  if (opts.version) lines.push('  version: ' + q(opts.version));
  lines.push('---', '');
  return lines.join('\n') + '\n' + str(recipe.body).trim() + '\n';
}

/* readSkillMd — parse and check an authored market SKILL.md. Throws a sentence naming the problem. */
function readSkillMd(text, slug) {
  const raw = str(text);
  if (raw.indexOf('\u0000') >= 0) throw new Error(slug + ': SKILL.md must be text');
  const fm = catalog.parseFrontmatter(raw);
  const meta = fm.meta || {};
  const md = meta.metadata && typeof meta.metadata === 'object' && !Array.isArray(meta.metadata) ? meta.metadata : {};
  if (str(meta.name) !== slug) throw new Error(slug + ': SKILL.md name must be "' + slug + '" (got "' + str(meta.name) + '")');
  const description = str(meta.description).replace(/\s+/g, ' ').trim();
  if (!description) throw new Error(slug + ': SKILL.md needs a description');
  if (description.length > 1024) throw new Error(slug + ': description is longer than 1024 characters');
  if (!str(meta.license).trim()) throw new Error(slug + ': SKILL.md needs a license');
  if (!str(fm.body).trim()) throw new Error(slug + ': SKILL.md needs a procedure below the frontmatter');
  return {
    title: str(md.title).replace(/\s+/g, ' ').trim() || slug, description, license: str(meta.license).trim(),
    category: str(md.category).trim(), author: str(md.author || meta.author).trim(), body: str(fm.body).trim()
  };
}

/* buildEntry — one catalog entry + its canonical package from source files [{ path, content }]. Enforces the
   market's own rules on top of package-format's (text only; root files limited to LICENSE/NOTICE/COPYING). */
function buildEntry(src) {
  const slug = str(src.slug);
  if (!SLUG_RE.test(slug) || slug.length > 64) throw new Error('bad slug "' + slug + '": lowercase letters, digits and single hyphens, max 64');
  if (!VERSION_RE.test(str(src.version))) throw new Error(slug + ': version must look like 1.0.0');
  if (SHELVES.indexOf(src.shelf) < 0) throw new Error(slug + ': shelf must be one of ' + SHELVES.join(', '));
  const requires = list(src.requires);
  const unknown = requires.filter(g => GEAR.indexOf(g) < 0);
  if (unknown.length) throw new Error(slug + ': unknown gear ' + unknown.join(', '));
  const files = (src.files || []).map(f => {
    const p = str(f.path);
    if (str(f.content).indexOf('\u0000') >= 0) throw new Error(slug + ': ' + p + ' is not text; market packages are text only');
    if (p !== 'SKILL.md' && !ROOT_FILES.test(p) && !/^references\//.test(p)) throw new Error(slug + ': ' + p + ' is not allowed (SKILL.md, LICENSE/NOTICE, references/ only)');
    return { path: p, content: str(f.content) };
  });
  const main = files.find(f => f.path === 'SKILL.md');
  if (!main) throw new Error(slug + ': missing SKILL.md');
  const doc = readSkillMd(main.content, slug);
  if (src.shelf === 'community') {
    if (!files.some(f => ROOT_FILES.test(f.path) && /^(LICENSE|COPYING)/.test(f.path))) throw new Error(slug + ': a community skill must ship its LICENSE text');
    if (!src.upstream || !/^https:\/\//.test(str(src.upstream.url)) || !str(src.upstream.commit)) throw new Error(slug + ': a community skill must name its upstream url and commit');
  }
  const pkg = packageFormat.canonicalize(files, { maxFileBytes: 256000 });
  const entry = {
    slug, name: doc.title, description: doc.description.slice(0, 280), version: str(src.version),
    author: list(src.authors).join(', ') || doc.author || 'StarNet', license: str(src.license || doc.license),
    shelf: src.shelf, category: str(src.category || doc.category || 'General'), tags: list(src.tags).slice(0, 8), requires,
    librarySlug: src.librarySlug ? str(src.librarySlug) : '',
    sourceUrl: '/skills/' + slug + '/' + src.version + '/SKILL.md',
    digest: pkg.digest, bytes: pkg.bytes,
    files: pkg.files.map(f => ({ path: f.path, sha256: f.sha256, bytes: f.bytes }))
  };
  if (src.upstream) entry.upstream = { url: str(src.upstream.url), commit: str(src.upstream.commit), license: str(src.upstream.license || entry.license) };
  return { entry, pkg };
}

// catalogDocument(entries) -> the index document, in a stable order (shelf, then display name)
function catalogDocument(entries) {
  const sorted = entries.slice().sort((a, b) => (SHELVES.indexOf(a.shelf) - SHELVES.indexOf(b.shelf)) || a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  return { format: FORMAT, name: MARKET_NAME, skills: sorted };
}

/* readCatalog — the app-side reader: validates an index document and returns clean entries. Anything malformed is
   dropped (with the reason), never half-trusted. */
function readCatalog(doc) {
  if (!doc || doc.format !== FORMAT || !Array.isArray(doc.skills)) throw new Error('the skill market returned an unsupported catalog');
  const entries = [], rejected = [];
  for (const row of doc.skills.slice(0, MAX_ENTRIES)) {
    const slug = str(row && row.slug);
    const files = Array.isArray(row && row.files) ? row.files : [];
    const why = !SLUG_RE.test(slug) ? 'bad slug'
      : !VERSION_RE.test(str(row.version)) ? 'bad version'
      : !/^[0-9a-f]{64}$/.test(str(row.digest)) ? 'bad digest'
      : !files.length || !files.some(f => f && f.path === 'SKILL.md') ? 'no SKILL.md in its manifest'
      : files.some(f => !f || !/^[0-9a-f]{64}$/.test(str(f.sha256)) || !(packageFormat.safePath(f.path))) ? 'bad file manifest'
      : '';
    if (why) { rejected.push({ slug, why }); continue; }
    entries.push({
      slug, name: str(row.name).slice(0, 80) || slug, description: str(row.description).slice(0, 280), version: str(row.version),
      author: str(row.author).slice(0, 160), license: str(row.license).slice(0, 80),
      shelf: SHELVES.indexOf(row.shelf) >= 0 ? row.shelf : 'community', category: str(row.category).slice(0, 40) || 'General',
      tags: list(row.tags).slice(0, 8), requires: list(row.requires).filter(g => GEAR.indexOf(g) >= 0),
      librarySlug: SLUG_RE.test(str(row.librarySlug)) ? str(row.librarySlug) : '',
      digest: str(row.digest), bytes: Number(row.bytes) || 0,
      files: files.map(f => ({ path: str(f.path), sha256: str(f.sha256), bytes: Number(f.bytes) || 0 }))
    });
  }
  return { name: str(doc.name) || MARKET_NAME, entries, rejected };
}

// fileUrl(indexUrl, entry, path) -> the absolute URL of one package file
function fileUrl(indexUrl, entry, path) {
  return new URL('/skills/' + entry.slug + '/' + entry.version + '/' + path.split('/').map(encodeURIComponent).join('/'), indexUrl).href;
}

module.exports = {
  FORMAT, MARKET_NAME, SLUG_RE, VERSION_RE, SHELVES, GEAR, compareVersions,
  libraryToSkillMd, readSkillMd, buildEntry, catalogDocument, readCatalog, fileUrl
};
