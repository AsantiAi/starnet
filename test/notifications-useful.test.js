/* node test/notifications-useful.test.js — NOTIFICATIONS THAT MEAN SOMETHING (Andrew 10-02: "keep the
   notifications, but actually make it more useful instead of meaningless").

   The bell keeps only what you'd want after the moment: an agent WAITING on you (needs), work that FINISHED
   while you were elsewhere (result), and something that STOPPED or BROKE (alert). Every kept entry is a door
   (a session or a window), a repeat of one condition is one entry, an answered wait leaves NEEDS YOU, and
   opening a session reads what pointed at it. Everything else is a toast and nothing more.

   The notify core is executed in a vm (not grepped); the call sites are pinned by source. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ui = read('frontend/app/stationui.js');
const chat = read('frontend/app/chat.js');
const world = read('frontend/app/world.js');
const app = read('frontend/app/app.js');

/* ---- the core, executed ---- */
const from = ui.indexOf('  function notifyPrefOf(category) {');
const to = ui.indexOf('  // A caller that leads with an ALL-CAPS token');
A.ok(from > 0 && to > from, 'notify core located');
const toasts = [], opened = [];
const ctx = {
  store: { notifs: [], settings: {} }, open: {}, saved: 0,
  notifyDefaults: () => ({}), uid: (() => { let i = 0; return () => 'n' + (++i); })(),
  save() { ctx.saved++; }, badges() {}, rerender() {},
  toast: (txt, cls, sound, opts) => toasts.push({ txt, opts }),
  openTerm: (k, s) => opened.push(['term', k, s]),
  App: { openWorkstream: id => opened.push(['ws', id]) }
};
vm.runInNewContext(ui.slice(from, to) + '\nthis.api = { notify, settleNotifs, seenSession, openNotif };', ctx);
const N = ctx.api;

N.notify('✓ routine saved', 'good');
N.notify('pick a schedule first', 'warn');
A.eq(ctx.store.notifs.length, 0, 'a confirmation or a local error is a toast only — never unread history');
A.eq(toasts.length, 2, '…but it still shows as a toast');

N.notify('NOVA needs approval to write report.md', 'warn', 'needsApproval', { kind: 'needs', go: { ws: 's1' }, key: 'needs:s1' });
N.notify('NOVA finished — Weekly brief', 'good', 'runComplete', { kind: 'result', go: { ws: 's2' } });
N.notify('drafted while you were away: x', 'gold', 'cronDigest');
A.eq(ctx.store.notifs.map(n => n.kind), ['needs', 'result', 'result'], 'kept: needs + results (a category implies its kind)');
A.eq(ctx.store.notifs[0].go, { ws: 's1' }, 'a kept entry carries its door');

N.notify('budget warning 80%', 'warn', undefined, { kind: 'alert', key: 'budget:day', go: { term: 'settings', section: 'budget' } });
N.notify('budget cap hit', 'warn', undefined, { kind: 'alert', key: 'budget:day', go: { term: 'settings', section: 'budget' } });
A.eq(ctx.store.notifs.filter(n => n.key === 'budget:day').length, 1, 'a repeat of the same live condition is ONE entry');
A.eq(ctx.store.notifs.find(n => n.key === 'budget:day').txt, 'budget cap hit', '…carrying the newest text');

toasts[toasts.length - 1].opts.onClick();
A.eq(opened[opened.length - 1], ['term', 'settings', 'budget'], 'the toast of a door entry opens the same place');
A.eq(ctx.store.notifs.find(n => n.key === 'budget:day').read, true, 'following it reads it');

N.seenSession('s2');
A.eq(ctx.store.notifs.find(n => n.go && n.go.ws === 's2').read, true, 'opening a session reads every entry that pointed at it');
A.eq(!!ctx.store.notifs[0].done, false, 'opening a session does NOT answer its approval');

N.settleNotifs('needs:s1');
A.ok(ctx.store.notifs[0].done && ctx.store.notifs[0].read, 'an answered wait is handled (leaves NEEDS YOU, stays in history)');

N.notify('NOVA has a question', 'warn', 'needsApproval', { kind: 'needs', go: { ws: 's1' }, key: 'needs:s1' });
A.eq(ctx.store.notifs.filter(n => n.key === 'needs:s1').length, 2, 'a NEW wait after a handled one is its own entry (history keeps the handled one)');

ctx.store.settings.notifyPrefs = { runComplete: false };
const before = ctx.store.notifs.length, tBefore = toasts.length;
N.notify('muted finish', 'good', 'runComplete', { kind: 'result' });
A.ok(ctx.store.notifs.length === before && toasts.length === tBefore, 'a muted category is still dropped at the emit point');

/* ---- the window: NEEDS YOU first, every entry a door, legacy noise gone, badge = what's worth a look ---- */
const win = ui.slice(ui.indexOf('  function buildNotifs(body) {'), ui.indexOf('  /* ============== periodic + save dot'));
A.ok(/NEEDS YOU/.test(win) && /isWaiting/.test(win), 'the window leads with NEEDS YOU');
A.ok(/nf-door/.test(win) && /openNotif\(n\)/.test(win), 'an entry with a destination is clickable and goes there');
A.ok(/pruneLegacyNotifs\(\)/.test(win), 'pre-10-02 toast-shaped history is cleared out');
A.ok(/function badges\(\)[\s\S]{0,200}isWaiting\(x\) \|\| !x\.read/.test(win), 'the badge counts everyone waiting on you + anything new');

/* ---- the call sites that matter carry a kind and a door ---- */
A.ok(/needs approval to ' \+ actionPhrase\(p\)[^\n]*kind: 'needs', go: \{ ws: ws\.id \}, key: 'needs:' \+ ws\.id/.test(chat), 'an approval (open session) is a NEEDS YOU door to its session');
A.ok(/function backgroundPermissionNotify[\s\S]{0,900}kind: 'needs', go: \{ ws: ws\.id \}, key: 'needs:' \+ ws\.id/.test(chat), 'an approval (background session) is a NEEDS YOU door');
A.ok(/function answer\(text, doneLabel\) \{\s*\n\s*if \(ws[^\n]*settleNotifs\('needs:' \+ ws\.id\)/.test(chat), 'answering a quick question settles it');
A.ok(/async function decide\(decision, doneLabel, isDeny\) \{\s*\n\s*if \(ws[^\n]*settleNotifs\('needs:' \+ ws\.id\)/.test(chat), 'deciding an approval settles it');
A.ok(/' finished'\) \+ sessionNote\(ws\)/.test(chat) && /kind: 'result', go: \{ ws: ws\.id \}/.test(chat), 'a background session that finished says so and opens it');
A.ok(/settleNotifs\('needs:' \+ ws\.id\);   \/\/ the run is over/.test(chat), 'a run that ends clears what it was waiting on');
A.ok(/StationUI\.seenSession\(id\)/.test(app.slice(app.indexOf('function switchWorkstream'), app.indexOf('function switchWorkstream') + 300)), 'switching to a session reads its entries');
A.ok(/budget cap hit[^\n]*kind: 'alert'[^\n]*go: \{ term: 'settings', section: 'budget' \}/.test(world), 'budget alerts open SPENDING LIMITS');
A.ok(/settleNotifs\(toastKey\)/.test(world), 'a channel that reconnects settles its outage entry');
A.ok(!/hudNote\('◈ recalled[^\n]*kind:/.test(world) && !/hudNote\('✎ memory saved'[^\n]*kind:/.test(world), 'memory telemetry stays a toast (never history)');

A.report('notifications-useful.test');
