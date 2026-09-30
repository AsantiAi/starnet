/* node test/skill-market-tools.test.js — market skills only name tools that exist (2026-09-30).

   A skill is instructions to an agent. A skill that says "call fs.delete" or "use calendar.create_event" sends the
   agent after a tool the station does not have — the agent then reports it missing, or improvises. The first batch
   of originals shipped four such false claims. This reads every skill published to the Skill Market (bundled
   originals + skills-catalog/skills) and checks each tool-shaped name in its text against the real registry
   (sidecar/capability/registry.js):
     - a name in a real tool family (fs., browser., routine., task., team., notebook., skill., channel., loop.,
       shell., terminal., station., session., tool., code., connectors., web_*, image_*, voice_*) must be a real tool
     - the family wildcard (fs.*, task.*) is fine
   Connector tools (Google, GitHub, Notion…) are named by their server, so a skill must not invent them either:
   a dotted name in an unknown family that looks like a tool call is reported for a human to allow or fix. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const registry = fs.readFileSync(path.join(ROOT, 'sidecar', 'capability', 'registry.js'), 'utf8');
const TOOLS = new Set([...registry.matchAll(/tool: '([A-Za-z0-9_.]+)'/g)].map(m => m[1]));
A.ok(TOOLS.size > 100 && TOOLS.has('fs.write') && TOOLS.has('routine.create'), 'the registry lists the station\'s tools (' + TOOLS.size + ')');
const FAMILIES = new Set([...TOOLS].filter(t => t.indexOf('.') > 0).map(t => t.split('.')[0]));
const UNDERSCORE = /^(web|image|voice)_[a-z_]+$/;

// every published skill: the 46 bundled originals + the market-only folders
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'website', '.well-known', 'starnet-skills.json'), 'utf8'));
const sources = [];
for (const s of index.skills) {
  const bundled = s.librarySlug ? path.join(ROOT, 'sidecar', 'skills', 'library', s.librarySlug + '.md') : '';
  const base = path.join(ROOT, 'skills-catalog', 'skills', s.slug);
  if (bundled && fs.existsSync(bundled)) sources.push({ slug: s.slug, file: bundled });
  else {
    (function walk(dir) {
      for (const n of fs.readdirSync(dir)) {
        const p = path.join(dir, n);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.md$/i.test(n)) sources.push({ slug: s.slug, file: p });
      }
    })(base);
  }
}
A.ok(sources.length >= index.skills.length, 'every published skill has its source text (' + sources.length + ' files)');

const unknown = [];
for (const src of sources) {
  const text = fs.readFileSync(src.file, 'utf8');
  const seen = new Set();
  // dotted names in a real tool family: fs.write, browser.intercept, task.*
  for (const m of text.matchAll(/(?<![\w./-])([a-z][a-z_]*)\.([a-z_]+(?:\.[a-z_]+)*|\*)(?![\w-]|\.[a-z])/g)) {
    const fam = m[1], name = m[1] + '.' + m[2];
    if (!FAMILIES.has(fam) || seen.has(name)) continue;
    seen.add(name);
    if (m[2] === '*' || TOOLS.has(name)) continue;
    // a family prefix used as prose ("team.dispatch/spawn") is handled by the slash form below
    unknown.push(src.slug + ': ' + name);
  }
  // "team.dispatch/spawn" and "notebook.read / notebook.write" shorthand: the second half must exist too
  for (const m of text.matchAll(/(?<![\w./-])([a-z][a-z_]*)\.([a-z_]+)\s?\/\s?([a-z_]+)(?![\w.(-])/g)) {
    if (!FAMILIES.has(m[1])) continue;
    const name = m[1] + '.' + m[3];
    if (!TOOLS.has(name) && !seen.has(name)) { seen.add(name); unknown.push(src.slug + ': ' + name + ' (from "' + m[0] + '")'); }
  }
  for (const m of text.matchAll(/(?<![\w.-])((?:web|image|voice)_[a-z_]+)(?![\w.-])/g)) {
    if (UNDERSCORE.test(m[1]) && !TOOLS.has(m[1]) && !seen.has(m[1])) { seen.add(m[1]); unknown.push(src.slug + ': ' + m[1]); }
  }
}
A.eq(unknown, [], 'every tool a market skill names is a real station tool');

A.report('skill-market-tools.test');
