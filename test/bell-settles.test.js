/* test/bell-settles.test.js — every NEEDS YOU line the bell keeps also LEAVES it when its wait is over (sweep 2026-10-02).

   The 0.13 bell keeps "needs" entries until settleNotifs(key) marks them handled. Three kinds were added with no settle, so the badge
   stayed lit for good once they fired (MARK ALL READ skips waiting entries; only ✕ removed them):
     · STEP-IN "needs you to sign in" (stepin.js) — and its line had no destination, so the bell could not open it either;
     · "∞ loop results are waiting on your review" (windows/loops.js);
     · "N extensions awaiting your approval" (app.js, settled from windows/connectors.js once nothing is pending). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

(async () => {
  // STEP-IN, for real: a handoff that ended (handed back, cancelled, expired) settles its bell line — on the live event and on a
  // refresh that finds it already over (it ended while the page was away, or before a restart)
  const settled = [], notes = [];
  let reply = { ok: true, live: [], recent: [{ id: 'h-old', state: 'returned', agentId: 'nova' }] };
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, Promise, JSON,
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve(reply) }),
    StationUI: { settleNotifs: k => settled.push(k), notify: (t, c, cat, o) => notes.push(o), h: { present: [] } } });
  vm.runInContext(rd('frontend/app/stepin.js') + '\n;this.__StepIn = StepIn;', ctx, { filename: 'stepin.js' });
  const S = ctx.__StepIn;
  await S.refresh();
  A.ok(settled.indexOf('stepin-h-old') >= 0, 'a handoff found already over on refresh settles its bell line: ' + JSON.stringify(settled));
  const si = rd('frontend/app/stepin.js');
  A.ok(/if \(ended\) \{ recent\.unshift\(p\); recent = recent\.slice\(0, 8\); settle\(p\.id\); \}/.test(si), 'a handoff that ends live (the browser.handoff event) settles its line too');
  A.ok(/key: 'stepin-' \+ p\.id, kind: 'needs', go: \{ term: 'stepin' \}/.test(si), 'the STEP-IN line has a destination, so the bell can open it');
  A.ok(/registerWindow\('stepin'/.test(si), '…and that destination is a real window');

  // loops: every result reviewed settles "waiting on your review"
  const lp = rd('frontend/app/windows/loops.js');
  A.ok(/paintBadge\(waiting\);[\s\S]{0,200}if \(!waiting && typeof StationUI !== 'undefined' && StationUI\.settleNotifs\) StationUI\.settleNotifs\('loops-review'\);/.test(lp), 'the loops watcher settles loops-review once nothing waits');
  A.ok(/key: 'loops-review'/.test(lp), '…the same key it notified under');

  // extensions: the extensions list finding nothing pending settles "awaiting your approval"
  const cn = rd('frontend/app/windows/connectors.js'), app = rd('frontend/app/app.js');
  A.ok(/key: 'extensions-pending'/.test(app), 'fixture: the app notifies under extensions-pending');
  A.ok(/if \(hooks && plugins && !\(\(hooks\.pending \|\| \[\]\)\.length \+ plugins\.plugins\.filter\(x => x && x\.pending\)\.length\)[\s\S]{0,120}StationUI\.settleNotifs\('extensions-pending'\)/.test(cn), 'the extensions list settles it once both reads say nothing is pending (a failed read never settles it)');

  // a background run that made a file AND ends asking something still puts its question in NEEDS YOU ("made X" alone hid it)
  const ch = rd('frontend/app/chat.js');
  A.ok(/!\(thisRunId && notedRuns\.has\(thisRunId\) && !taskQuestion && endReason !== 'clarifying'\)/.test(ch), 'a run that already announced a file is skipped only when it does NOT end on a question');

  // B5: a prompt answered ANYWHERE (desk, phone, Telegram, voice — permission.response on the bus) settles its bell entry;
  // R8: re-rendering a pending prompt (reopening its session) never re-announces it
  A.ok(/U\.bus\.on\('permission\.response', \(resp\) => \{\s*const key = resp && resp\.promptId != null \? promptNeeds\.get\(String\(resp\.promptId\)\) : null;\s*if \(key && typeof StationUI !== 'undefined' && StationUI\.settleNotifs\) StationUI\.settleNotifs\(key\);/.test(ch), 'one listener settles a prompt entry wherever the prompt is answered');
  A.eq((ch.match(/!announcedPrompt\(/g) || []).length, 3, 'the approval card, the question card and a background approval each announce a prompt once');
  A.eq((ch.match(/key: 'needs:' \+ ws\.id, prompt: /g) || []).length, 3, '…and file it with its promptId');
  // B4: a prompt entry from an earlier page life (reload / restart: desk runs die with the page) leaves NEEDS YOU
  const su = rd('frontend/app/stationui.js');
  A.ok(/r\.kind === 'needs' && !r\.done && r\.prompt && r\.life !== NOTIF_LIFE\) \{ r\.done = true; r\.read = true;/.test(su) && /if \(opts && opts\.prompt\) \{ rec\.prompt = String\(opts\.prompt\); rec\.life = NOTIF_LIFE; \}/.test(su), 'a prompt entry raised before this page life is marked handled');
  A.ok(/function buildNotifs\(body\) \{\s*pruneLegacyNotifs\(\);\s*reapDeadPrompts\(\);/.test(su) && /function badges\(\) \{\s*reapDeadPrompts\(\);/.test(su), '…before the bell or its badge is drawn');
  A.ok(/for \(const k of StationUI\.waitingNotifKeys\('stepin-'\)\) if \(!live\.some\(h => 'stepin-' \+ h\.id === k\)\) StationUI\.settleNotifs\(k\);/.test(si), 'a STEP-IN line for a handoff the station no longer has is settled');
  A.ok(/if \(!waiting\) \{ if \(StationUI\.settleNotifs\) StationUI\.settleNotifs\('extensions-pending'\); return; \}/.test(app), 'boot settles extensions-pending when nothing waits any more');
  // R9: a notification for a deleted session keeps the bell and says so
  A.ok(/if \(go\.ws && typeof Workstreams !== 'undefined' && Workstreams\.get && !Workstreams\.get\(go\.ws\)\) \{ toast\('that session was deleted', 'warn'\); return false; \}/.test(su), 'a deleted session: the bell stays and says so');
  // B6: a routine completing opens where its result is (the routine's HISTORY), never TO REVIEW
  const wd = rd('frontend/app/world.js');
  A.ok(/hudNote\('◷ routine completed', 'good', \{ go: \{ term: 'automation', section: 'routines' \} \}, 'cronDigest'\)/.test(wd), '"routine completed" opens AUTOMATE › ROUTINES');

  A.report('bell-settles.test');
})().catch(e => { console.error(e); process.exit(1); });
