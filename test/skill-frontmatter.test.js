/* node test/skill-frontmatter.test.js — standard SKILL.md frontmatter reads correctly (2026-09-29).

   The old reader was flat: `description: >-` came back as the literal '>-' (so an installed standard skill
   showed '>-' as its description), nested maps like `metadata: {author, version}` were dropped, and dash lists
   vanished. These are the shapes the Agent Skills spec, Anthropic's skills and Hermes' skills actually use.
   Pure: parser only. */
'use strict';
const A = require('./_assert.js');
const catalog = require('../sidecar/skills/catalog.js');
const exchange = require('../sidecar/skills/exchange.js');
const pkg = require('../sidecar/skills/package.js');

const fm = (yaml, body) => catalog.parseFrontmatter('---\n' + yaml + '\n---\n' + (body == null ? 'Do the thing.' : body));

// ---- block scalars ----
{
  const m = fm('name: pdf-processing\ndescription: >-\n  Extracts text and tables from PDF files,\n  fills forms, and merges documents.\n\n  Use when working with PDFs.\nlicense: Apache-2.0').meta;
  A.eq(m.description, 'Extracts text and tables from PDF files, fills forms, and merges documents.\nUse when working with PDFs.', 'folded >- joins lines with spaces, keeps the paragraph break, strips the final newline');
  A.eq(m.license, 'Apache-2.0', 'the key after a block scalar is read normally');
  const lit = fm('name: x\ndescription: |\n  line one\n  line two\n').meta;
  A.eq(lit.description, 'line one\nline two\n', 'literal | keeps newlines (clip = one final newline)');
  A.eq(fm('name: x\ndescription: |-\n  a\n  b').meta.description, 'a\nb', '|- strips the final newline');
  A.eq(fm('name: x\ndescription: >\n  a\n  b').meta.description, 'a b\n', '> folds and clips');
}

// ---- nested maps and lists (the spec's own example; Hermes metadata) ----
{
  const m = fm('name: pdf-processing\ndescription: Extract PDFs.\nmetadata:\n  author: example-org\n  version: "1.0"\n  hermes:\n    tags: [PDF, Documents]\n    related_skills:\n      - docx\n      - xlsx\nplatforms: [macos, linux]').meta;
  A.eq(m.metadata.author, 'example-org', 'metadata.author is read');
  A.eq(m.metadata.version, '1.0', 'a quoted version stays the string "1.0"');
  A.eq(m.metadata.hermes.tags, ['PDF', 'Documents'], 'a nested flow list');
  A.eq(m.metadata.hermes.related_skills, ['docx', 'xlsx'], 'a nested dash list');
  A.eq(m.platforms, ['macos', 'linux'], 'a top-level flow list after a nested block');
  const t = fm('name: x\ndescription: y\ntriggers:\n- make it look like stripe\n- vercel style').meta;
  A.eq(t.triggers, ['make it look like stripe', 'vercel style'], 'a dash list at the key\'s own indent');
  const items = fm('name: x\ndescription: y\nsteps:\n  - name: build\n    run: npm ci\n  - name: test').meta;
  A.eq(items.steps, [{ name: 'build', run: 'npm ci' }, { name: 'test' }], 'dash items that open maps');
}

// ---- scalars: quotes, escapes, multi-line plain, comments ----
{
  A.eq(fm('name: x\ndescription: "Say \\"hi\\" then go"').meta.description, 'Say "hi" then go', 'double quotes decode escapes');
  A.eq(fm("name: x\ndescription: 'it''s fine'").meta.description, "it's fine", "single quotes: '' is a quote");
  A.eq(fm('name: x\ndescription: "Manage: create, search"').meta.description, 'Manage: create, search', 'a colon inside quotes is content');
  A.eq(fm('name: x\ndescription: A long plain description\n  that continues here\n  and here.\nlicense: MIT').meta.description,
    'A long plain description that continues here and here.', 'a multi-line plain scalar folds into one line');
  A.eq(fm('name: x\ndescription: "a quoted value\n  that wraps"\nlicense: MIT').meta.description, 'a quoted value that wraps', 'a wrapped quoted value closes on its continuation');
  A.eq(fm('# a comment\nname: x   # trailing\ndescription: C# and F# are fine').meta, { name: 'x', description: 'C# and F# are fine' },
    'comment lines and " #" comments drop; a # inside a word stays');
  A.eq(fm('name: x\ntags: ["a, b", c]').meta.tags, ['a, b', 'c'], 'a comma inside a quoted flow item stays in the item');
  A.eq(fm('name: x\nhomepage: https://example.com/a:b').meta.homepage, 'https://example.com/a:b', 'a URL value is kept whole');
  A.eq(fm('name: x\ndefault: true\nhidden: false').meta, { name: 'x', default: true, hidden: false }, 'booleans');
}

// ---- safety: malformed input never swallows keys or throws ----
{
  const m = fm('name: x\ndescription: "never closed\nlicense: MIT').meta;
  A.eq(m.license, 'MIT', 'an unclosed quote cannot swallow the next top-level key');
  A.ok(typeof catalog.parseFrontmatter('---\n: :\n  - [\n---\nbody').meta === 'object', 'garbage frontmatter returns an object, never throws');
  A.eq(catalog.parseFrontmatter('no frontmatter here').body, 'no frontmatter here', 'a document without frontmatter is all body');
  A.eq(fm('name: x\r\ndescription: >-\r\n  crlf\r\n  lines').meta.description, 'crlf lines', 'CRLF files parse the same');
  A.eq(fm('name: x\ndescription: y', '# Title\n\nBody').body, '# Title\n\nBody', 'the body below the frontmatter is untouched');
}

// ---- the exchange reads a standard document, and package hydrate reads the same way ----
{
  const doc = '---\nname: pdf-processing\ndescription: >-\n  Extracts text and tables from PDF files.\n  Use when working with PDFs.\nlicense: Apache-2.0\nmetadata:\n  author: example-org\n  version: "1.0"\n---\n# PDF\n\n1. Open it.';
  const d = exchange.parseDocument(doc, 'https://example.com/pdf/SKILL.md');
  A.eq(d.summary, 'Extracts text and tables from PDF files. Use when working with PDFs.', 'the exchange summary is the real description, never ">-"');
  A.eq([d.sourceAuthor, d.sourceVersion, d.sourceLicense], ['example-org', '1.0', 'Apache-2.0'], 'author/version under metadata are kept as provenance');
  A.eq(pkg.parseFrontmatter(doc).meta.description, 'Extracts text and tables from PDF files. Use when working with PDFs.', 'package hydrate reads the same description');
  const rendered = pkg.renderSkillMd({ name: 'Say "hi"', description: 'uses "quotes" and a: colon', body: '1. go', platforms: ['macos'] });
  const back = pkg.parseFrontmatter(rendered).meta;
  A.eq([back.name, back.description, back.platforms], ['Say "hi"', 'uses "quotes" and a: colon', ['macos']], 'StarNet\'s own rendered frontmatter round-trips exactly (escapes decoded)');
}

A.report('skill-frontmatter.test');
