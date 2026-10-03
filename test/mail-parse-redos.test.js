/* test/mail-parse-redos.test.js — a crafted HTML email never freezes the sidecar (sweep 2026-10-03).

   htmlToText (sidecar/mcp/mail-parse.js) stripped tags with two regexes that were QUADRATIC on hostile input: an HTML-only mail
   of 240 KB of "<" took 18 s, and the 4 MiB read cap projected to over an hour — synchronous, so E-STOP, every run and every route
   froze the moment an agent read one such email (anyone can send one; only the victim's address is needed). It is one linear
   pass now, with the same text out for ordinary HTML. */
'use strict';
const A = require('./_assert.js');
const { htmlToText } = require('../sidecar/mcp/mail-parse.js');

// ordinary HTML reads exactly as it did
for (const [html, want] of [
  ['<p>Hi <b>there</b></p><p>x</p>', 'Hi there \n x'],
  ['a<br/>b<br>c', 'a\nb\nc'],
  ['<style>.x{}</style>Body', 'Body'],
  ['<script>bad()</script>ok', 'ok'],
  ['<head><title>t</title></head><body>Hello &amp; bye</body>', 'Hello & bye'],
  ['<div>one</div><div>two</div>', 'one\n two'],
  ['<script>never closed and text', 'never closed and text'],
  ['x &lt;tag&gt; y', 'x <tag> y'],
  ['<>', '<>'],
]) A.eq(htmlToText(html), want, 'reads ' + JSON.stringify(html));

// hostile HTML at the 4 MiB read cap stays fast (the old regexes: 18 s at 240 KB, hours at 4 MiB)
for (const [label, html] of [
  ['4 MiB of "<"', '<'.repeat(4 * 1024 * 1024)],
  ['"<style" x 600k', '<style'.repeat(600000)],
  ['"<style>" x 500k (no closing tag)', '<style>'.repeat(500000)],
  ['"<a href=x>" x 400k', '<a href=x>'.repeat(400000)],
]) {
  const t0 = Date.now(); htmlToText(html); const ms = Date.now() - t0;
  A.ok(ms < 2000, label + ' parses in ' + ms + ' ms (well under the 2 s bound)');
}

A.report('mail-parse-redos.test');
