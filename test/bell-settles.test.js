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

  A.report('bell-settles.test');
})().catch(e => { console.error(e); process.exit(1); });
