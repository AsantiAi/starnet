'use strict';

// Dragging the COMMS seam ran at 20-30fps on trunk (10-02) while 0.12.5 held 60. Three CSS shapes made
// every drag frame and every 1s station tick re-style the WHOLE page (~1000 COMMS spans, ~16-20ms each
// time). Each looks harmless in review, so this file pins the cheap shape for all three.
//
// 1. The seam widths (--chat-w / --crew-w) are written on #screen-game every frame. An inheriting
//    custom property invalidates every descendant; registered non-inheriting it touches one element.
// 2. A :has() whose ARGUMENT reads [style] re-checks on every inline-style write anywhere — and the
//    seam drag (plus every animation helper) writes inline styles constantly.
// 3. Chrome folds the right-hand side of every NON-SUBJECT :has() rule (`X:has(Y) Z`) into one
//    invalidation set it applies from <body> whenever a DOM tick might change a body:has() answer.
//    A bare type there (`> span`) means "every span in the page" — every COMMS reply is spans.

const fs = require('node:fs');
const path = require('node:path');
const A = require('./_assert.js');

const cssDir = path.resolve(__dirname, '..', 'frontend', 'css');
const files = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));

// Close a balanced (...) starting at s[i] === '('; returns the index of the matching ')'.
function closeParen(s, i) {
  for (let d = 0; i < s.length; i++) {
    if (s[i] === '(') d++;
    else if (s[i] === ')' && --d === 0) return i;
  }
  return s.length;
}
// Split on top-level commas only (commas inside :is()/:has() stay put).
function splitTop(sel) {
  const out = []; let d = 0, start = 0;
  for (let i = 0; i < sel.length; i++) {
    if (sel[i] === '(') d++; else if (sel[i] === ')') d--;
    else if (sel[i] === ',' && d === 0) { out.push(sel.slice(start, i)); start = i + 1; }
  }
  out.push(sel.slice(start));
  return out.map(s => s.trim()).filter(Boolean);
}
// Drop functional pseudo arguments, attribute selectors and quoted strings so a type-selector scan
// only sees the selector's own compounds.
function stripArgs(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') { i = closeParen(s, i); continue; }
    if (s[i] === '[') { const j = s.indexOf(']', i); i = j < 0 ? s.length : j; continue; }
    out += s[i];
  }
  return out;
}

const offenders = { styleArg: [], bareType: [] };
let hasRules = 0;
for (const f of files) {
  const css = fs.readFileSync(path.join(cssDir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // selector preludes: text before each '{' back to the previous '}' / ';' / '{'
  const re = /([^{};]+)\{/g; let m;
  while ((m = re.exec(css))) {
    const prelude = m[1].trim();
    if (!prelude.includes(':has(') || prelude.startsWith('@')) continue;
    for (const part of splitTop(prelude)) {
      let i = part.indexOf(':has(');
      if (i < 0) continue;
      hasRules++;
      // every :has() argument in this part
      for (let k = i; k >= 0; k = part.indexOf(':has(', k + 1)) {
        const arg = part.slice(k + 5, closeParen(part, k + 4));
        if (/\[\s*style\b/.test(arg)) offenders.styleArg.push(f + ': ' + part);
      }
      // the right-hand side after the LAST :has() compound (the "non-subject" part)
      const last = part.lastIndexOf(':has(');
      let j = closeParen(part, last + 4) + 1;
      while (j < part.length && !/[\s>+~]/.test(part[j])) { if (part[j] === '(') j = closeParen(part, j); j++; }
      const rest = stripArgs(part.slice(j));
      // a compound that starts with a type name (`span`, `div.x`, `> p`) — not `.cls`, `#id`, `:pseudo`, `*`
      if (/(?:^|[\s>+~])\s*[a-zA-Z][\w-]*(?![\w-]*\()/.test(rest.replace(/::?[\w-]+/g, ''))) offenders.bareType.push(f + ': ' + part);
    }
  }
}

A.ok(hasRules > 20, 'the scan found the :has() rules (' + hasRules + ')');
A.eq(offenders.styleArg, [], 'no :has() argument reads [style] — key it on a class instead');
A.eq(offenders.bareType, [], 'no non-subject :has() rule ends in a bare type selector — give the target a class');

const app = fs.readFileSync(path.join(cssDir, 'app.css'), 'utf8');
for (const v of ['--chat-w', '--crew-w']) {
  A.ok(new RegExp('@property\\s+' + v + '\\s*\\{[^}]*inherits:\\s*false', 's').test(app),
    v + ' is registered non-inheriting, so a seam drag re-styles one element, not the station');
}
A.report("css-style-invalidation (" + hasRules + " :has() selectors)");
