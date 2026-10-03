/* test/gmail-headers-parser.test.js — the Gmail app-password connector reads every mailbox and writes standard headers (sweep 2026-10-03).
     • "[" is legal inside an IMAP atom: a flag or label like foo[ made the tokenizer swallow the rest of the response and
       throw "unclosed list", so one such message failed list_recent / search for the whole mailbox;
     • a non-ASCII subject went out as ONE unfolded encoded-word (330 characters on a 341 character line; past ~740 bytes it
       broke the 998 limit), and a non-ASCII display name went out as raw UTF-8 the SMTP session never negotiated. */
'use strict';
const A = require('./_assert.js');
const { tokenize } = require('../sidecar/mcp/imap-client.js');
const { mimeMessage } = require('../sidecar/mcp/transport.google.js');

// ---- the tokenizer ----
let t = null, err = null;
try { t = tokenize('5 FETCH (UID 9 FLAGS (\\Seen foo[) X-GM-MSGID 1)', []); } catch (e) { err = e; }
A.ok(!err, 'a flag with an unbalanced "[" parses: ' + (err && err.message));
A.eq(JSON.stringify(t), JSON.stringify(['5', 'FETCH', ['UID', '9', 'FLAGS', ['\\Seen', 'foo['], 'X-GM-MSGID', '1']]), 'and every attribute after it is still read');
t = tokenize('7 FETCH (UID 3 BODY[HEADER.FIELDS (SUBJECT FROM)] "x")', []);
A.eq(t[2][2] + '|' + t[2][3], 'BODY[HEADER.FIELDS (SUBJECT FROM)]|x', 'a BODY[section (with spaces)] is still one atom');
t = tokenize('OK [UIDVALIDITY 3857529045] UIDs valid', []);
A.eq(t[1], '[UIDVALIDITY 3857529045]', 'a [response code] is still one atom');
t = tokenize('2 FETCH (BINARY.PEEK[1] "y" X-GM-LABELS (a[b "c"))', []);
A.eq(JSON.stringify(t[2]), JSON.stringify(['BINARY.PEEK[1]', 'y', 'X-GM-LABELS', ['a[b', 'c']]), 'BINARY.PEEK[1] is one atom and a label a[b does not swallow the list');

// ---- the headers ----
const headersOf = raw => Buffer.from(raw, 'base64url').toString('utf8').split('\r\n\r\n')[0];
const decodeWords = v => v.replace(/\r\n /g, ' ').replace(/=\?UTF-8\?B\?([^?]*)\?=\s?/g, (m, b) => Buffer.from(b, 'base64').toString('utf8')).trim();
const long = 'Ünïcödé '.repeat(120).trim();
let head = headersOf(mimeMessage({ to: ['a@b.co'], subject: long, body: 'hi' }));
const lines = head.split('\r\n');
A.ok(lines.every(l => l.length <= 78), 'every header line stays foldable (longest ' + Math.max(...lines.map(l => l.length)) + ')');
const words = head.match(/=\?UTF-8\?B\?[^?]*\?=/g) || [];
A.ok(words.length > 1 && words.every(w => w.length <= 75), words.length + ' encoded-words, each at most 75 characters');
const subj = head.slice(head.indexOf('Subject: ') + 9).split(/\r\n(?! )/)[0];
A.eq(decodeWords(subj).replace(/\s+/g, ''), long.replace(/\s+/g, ''), 'the long subject decodes back exactly');
head = headersOf(mimeMessage({ to: ['José Ñ <j@x.com>', 'plain@x.com'], cc: ['Ann <ann@x.com>'], subject: 'hello', body: 'b' }));
A.ok(/^[\x00-\x7f]*$/.test(head), 'every header is ASCII (a non-ASCII display name is an encoded-word)');
A.ok(/To: =\?UTF-8\?B\?[^?]+\?= <j@x\.com>, plain@x\.com/.test(head) && /Cc: Ann <ann@x\.com>/.test(head), 'addresses keep their mailbox; an ASCII name is unchanged');
A.eq(decodeWords(/To: (=\?[^<]+)</.exec(head)[1]), 'José Ñ', 'the name decodes back');
A.eq(/Subject: hello\r\n/.test(head + '\r\n'), true, 'an ASCII subject is unchanged');
let bad = null;
try { mimeMessage({ to: ['Evil\x0bName <e@x.com>'], subject: 's', body: 'b' }); } catch (e) { bad = e; }
A.ok(bad && /Invalid to address/.test(bad.message), 'a control character in a display name is refused');
bad = null;
try { mimeMessage({ to: ['a@b.co'], subject: 'x\r\nBcc: evil@x.com', body: 'b' }); } catch (e) { bad = e; }
A.ok(!!bad, 'header injection through the subject is still refused');

A.report('gmail-headers-parser.test');
