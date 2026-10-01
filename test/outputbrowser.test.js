/* node test/outputbrowser.test.js — the BROWSER window's decisions (frontend/app/outputbrowser.js), headless.
   Proves: which writes reload the page on screen (the page, or a web asset in its folder tree — never an unrelated
   note), that FOLLOW is OFF by default and only FOLLOW makes a new page take over the window, that a new page always
   joins RECENT, and that workshop/workspace targets map to the right jailed path. */
'use strict';
const A = require('./_assert.js');

global.window = { localStorage: null };   // no storage: FOLLOW must default OFF, never throw
const OB = require('../frontend/app/outputbrowser.js');
const t = OB._test;

// ---- which writes feed the page on screen ----
A.ok(t.feedsPage('site/index.html', 'site/index.html'), 'the page itself');
A.ok(t.feedsPage('site/css/app.css', 'site/index.html'), 'a stylesheet in its folder tree');
A.ok(t.feedsPage('site/app.js', 'site/index.html'), 'a script beside it');
A.ok(!t.feedsPage('site/notes.md', 'site/index.html'), 'a markdown note is not a web asset');
A.ok(!t.feedsPage('other/app.css', 'site/index.html'), 'an asset in another folder does not');
A.ok(!t.feedsPage('sitemap/app.css', 'site/index.html'), 'a sibling folder sharing a prefix does not');
A.ok(t.feedsPage('any/where/x.css', 'index.html'), 'a root page owns the whole tree');

// ---- targets ----
A.eq(t.normalizeTarget({ agentId: 'nova', path: '.\\site\\index.html' }).path, 'site/index.html', 'paths normalise to forward slashes');
A.eq(t.normalizeTarget({ agentId: 'nova', path: 'a.html', source: 'workshop' }).source, 'workspace', 'workshop needs a runId, else it is a workspace page');
A.eq(t.jailRel(t.normalizeTarget({ agentId: 'b', path: 'index.html', runId: 'r1', source: 'workshop' })), 'workshop/r1/index.html', 'a workshop page lives under workshop/<runId>/');
A.eq(t.jailRel(t.normalizeTarget({ agentId: 'b', path: 'site/index.html' })), 'site/index.html', 'a workspace page is its own path');
A.eq(t.normalizeTarget({ agentId: 'b' }), null, 'no path, no target');

// ---- FOLLOW ----
A.eq(OB.isFollowing(), false, 'FOLLOW is OFF by default');
OB.noteOutput({ kind: 'file', agentId: 'nova', title: 'site/index.html' });
A.eq(OB._state.target, null, 'with FOLLOW off a new page does NOT take over the window');
A.eq(OB._state.recent.length, 1, '…but it joins RECENT');
OB.noteOutput({ kind: 'file', agentId: 'nova', title: 'notes.md' });
A.eq(OB._state.recent.length, 1, 'a non-page file never joins RECENT');
OB.noteOutput({ kind: 'image', agentId: 'nova', title: 'pic.html' });
A.eq(OB._state.recent.length, 1, 'only kind:file carries a real workspace page');
OB.setFollow(true);
A.eq(OB.isFollowing(), true, 'FOLLOW turns on');
OB.noteOutput({ kind: 'file', agentId: 'nova', title: 'site/about.html' });
A.ok(OB._state.target && OB._state.target.path === 'site/about.html', 'with FOLLOW on a new page becomes the page on screen');
A.eq(OB._state.recent[0].path, 'site/about.html', 'newest first in RECENT');
OB.noteOutput({ kind: 'file', agentId: 'nova', title: 'site/about.html' });
A.eq(OB._state.recent.filter(x => x.path === 'site/about.html').length, 1, 'a rewrite does not duplicate a RECENT entry');
for (let i = 0; i < 12; i++) OB.noteOutput({ kind: 'file', agentId: 'nova', title: 'p' + i + '.html' });
A.ok(OB._state.recent.length <= 8, 'RECENT is bounded');
A.ok(OB.isHtml('X.HTM') && !OB.isHtml('x.md'), 'isHtml reads the extension');

A.report('outputbrowser.test');
