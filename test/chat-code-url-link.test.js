/* node test/chat-code-url-link.test.js — behavioral lock for chat.js reportInline() URL links.

   Bug (2026-10-02): an agent finished a game and wrote "open `http://localhost:8765`". The COMMS
   renderer's tokenizer matched the backtick code span FIRST, so the URL became inert code text —
   no link, the user had to copy-paste the address. `**http://x**` hit the same dead end through
   the bold branch. linkify() itself already trimmed the markers (chat-linkify.test.js); the newer
   reportInline() tokenizer never reached it.

   reportInline + its helpers are pure — extract them from source and exercise them for real. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/chat.js'), 'utf8');

function extract(name) {
  const m = new RegExp('(  function ' + name + '\\([\\s\\S]*?\\n  \\})').exec(src);
  A.ok(m, 'chat.js still defines ' + name + '()');
  return m[1];
}
const escSrc = /const HTML_ESC = \{[^}]*\};/.exec(src);
A.ok(escSrc, 'chat.js still defines HTML_ESC');
// eslint-disable-next-line no-new-func
const reportInline = new Function(escSrc[0] + '\n' + extract('escapeHtml') + '\n' + extract('linkify') + '\n' +
  extract('reportInline') + '\nreturn reportInline;')();

function hrefOf(html) { const m = /href="([^"]*)"/.exec(html); return m && m[1]; }

// the observed live failure: a backticked server address must be a clickable link, still code-styled
let out = reportInline('To play: open `http://localhost:8765` (the server is up).');
A.eq(hrefOf(out), 'http://localhost:8765', 'backticked URL becomes a link');
A.ok(/<a [^>]*><code class="md-code">http:\/\/localhost:8765<\/code><\/a>/.test(out), 'link keeps the code styling inside it');

// bold-wrapped URL links too
out = reportInline('Server: **http://localhost:5295/play**');
A.eq(hrefOf(out), 'http://localhost:5295/play', 'bolded URL becomes a link');
A.ok(out.indexOf('<span class="md-b">') !== -1, 'bold styling kept');

// ordinary code spans stay plain code — no link
out = reportInline('run `npm start` or open `C:\\Users\\x\\index.html`');
A.eq(hrefOf(out), null, 'non-URL code spans are not links');

// a code span that merely CONTAINS a URL is a command, not a link
out = reportInline('try `curl http://localhost:8765/api`');
A.eq(hrefOf(out), null, 'code with a URL inside a command stays code');

// XSS invariant: quotes / markup inside a URL-looking code span never escape the attribute
out = reportInline('`http://x.test/"onmouseover="alert(1)`');
A.ok(out.indexOf('"onmouseover') === -1, 'a quote in a code span cannot break out of href');
out = reportInline('**<b>x</b> http://example.com**');
A.ok(out.indexOf('<b>') === -1 && out.indexOf('&lt;b&gt;') !== -1, 'bold text stays HTML-escaped');

A.report('chat-code-url-link.test');
