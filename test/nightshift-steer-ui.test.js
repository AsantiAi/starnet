/* node test/nightshift-steer-ui.test.js — the machine assertion the SETTINGS › AUTONOMY focus steer +
   LAST REPORT button (ui/system/ns-steer,ns-steer-set,ns-report-btn, finding bec0f139) were missing. The
   route contract (POST/GET/DELETE /api/nightshift/focus) is already proven by nightshift-focus.e2e.test.js;
   what had no committed guard was the DOM half: that #ns-steer's value drives the POST body, that the readout
   repaints from the ROUTE's response (server truth, never an optimistic flip), and that LAST REPORT fetches
   the truthful surfaces and renders NightReport.compose (not a cached copy).

   Two levels, each honest:
     1. GENUINE — NightReport.compose (the pure engine LAST REPORT renders) is require-able: an empty night
        composes hasReport:false; a night with acts composes a real headline. This is the render truth.
     2. SOURCE-LOCK the DOM→fetch wiring inside the StationUI IIFE (browser-flow, fetch-bound — not node-loadable),
        matching the settings-p1-ui / outbox-window house pattern.

   OUT OF SCOPE HERE (covered elsewhere): the route's validation/persistence contract = nightshift-focus.e2e.test.js. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const NightReport = require('../frontend/app/nightreport.js');

/* ---- 1. GENUINE: the LAST REPORT engine composes real truth from route surfaces ---- */
const now = Date.now(), awaySince = now - 24 * 3600 * 1000;
const empty = NightReport.compose({ status: null, ledger: [], drafts: [], awaySince, nowMs: now, tzOffsetMin: 0 });
A.ok(empty && empty.hasReport === false, 'an empty night composes hasReport:false (LAST REPORT shows the honest "nothing ran" copy)');
const acted = NightReport.compose({
  status: { focus: { source: 'steer', kind: 'goal', ref: 'ship the thing' } },
  ledger: [{ ts: now - 3600000, kind: 'act', reason: 'built the report card', source: 'nightshift' }],
  drafts: [], awaySince, nowMs: now, tzOffsetMin: 0
});
A.ok(acted && acted.hasReport === true && typeof acted.headline === 'string' && acted.headline, 'a night with an act composes a real headline (the report the button renders)');

/* ---- 2. SOURCE-LOCK the DOM→fetch steer + report wiring ---- */
const src = fs.readFileSync(path.join(__dirname, '../frontend/app/stationui.js'), 'utf8');

// ONE WORD: AUTONOMY (2026-09-29): the away status lives INSIDE Settings › AUTONOMY, and the focus steer exists ONCE —
// the DIRECTION control (#auto-steer). The old NIGHT SHIFT section carried a second, identical steer box (#ns-steer)
// on the same route; it is gone, and this locks that the surviving control keeps the full contract.
A.ok(!/id="ns-steer"/.test(src) && (src.match(/>SET FOCUS</g) || []).length === 1, 'exactly ONE focus steer renders (the duplicate NIGHT SHIFT box is gone)');
A.ok(/id="auto-steer"/.test(src) && /id="auto-steer-set"/.test(src) && /id="auto-steer-clear"/.test(src), 'the AUTONOMY DIRECTION block renders the steer input + SET FOCUS + CLEAR');
A.ok(/id="ns-report-btn"/.test(src) && /id="ns-report"/.test(src), 'the away block renders the LAST REPORT button + its container');
A.ok(src.includes("build: frag(secAutonomy + secAwayActivity)") && !src.includes("id: 'nightshift', label:"), 'the away block renders inside the AUTONOMY section; no separate NIGHT SHIFT section');
A.ok(src.includes("section === 'nightshift') section = 'autonomy'"), 'an old settings › nightshift link lands on AUTONOMY');

// STEER: #auto-steer.value → POST /api/nightshift/focus body, kinds parsed, readout from the ROUTE
A.ok(src.includes("dSteer = host.querySelector('#auto-steer')"), '#auto-steer is bound as a live handle');
A.ok(src.includes("const raw = dSteer ? String(dSteer.value).trim() : ''"), 'STEER reads the input value (the DOM→body link)');
A.ok(src.includes("if (raw.toLowerCase() === 'goal') return { ref: 'goal', kind: 'goal' };"), 'the literal "goal" selects the goal kind');
A.ok(src.includes("if (/^thread:/i.test(raw)) return { ref: raw.slice(7).trim(), kind: 'thread' };"), '"thread:<id>" selects the thread kind and strips the prefix');
A.ok(src.includes("Harness.api.post('/api/nightshift/focus', parseRef(raw))"), 'the steer POSTs /api/nightshift/focus with the parsed { ref, kind? } — the value drives the request body');
A.ok(src.includes("if (!ok || !j || j.ok === false) { dMsg((j && j.error) || 'could not steer'); sfx('bad'); return; }"), 'a rejected steer surfaces the route error (never an optimistic success)');
A.ok(src.includes("if (dSteer) dSteer.value = '';") && src.includes("sfx('click'); refreshDirection();"), 'a successful steer repaints the FOCUS readout from the route (server truth)');
// CLEAR: DELETE the steer
{ const clr = src.slice(src.indexOf('if (dSteerClear) dSteerClear.addEventListener'), src.indexOf('if (dSteerClear) dSteerClear.addEventListener') + 400);
  A.ok(clr.includes("Harness.api.del('/api/nightshift/focus')"), 'CLEAR DELETEs /api/nightshift/focus'); }

// LAST REPORT: fetch the three truthful surfaces + compose (not a cached copy)
A.ok(/nsReportBtn\.addEventListener\('click', \(\) => \{ renderLastReport\(\)/.test(src), 'the LAST REPORT button triggers renderLastReport');
A.ok(/getJSON\('\/api\/nightshift\/status'\)/.test(src) && /getJSON\('\/api\/autonomy\/ledger\?source=nightshift/.test(src) && /getJSON\('\/api\/nightshift\/drafts/.test(src),
  'LAST REPORT fetches the status + ledger + drafts route surfaces (truthful telemetry, not a frontend cache)');
A.ok(/rep = NightReport\.compose\(\{ status, ledger, drafts/.test(src), 'LAST REPORT renders through NightReport.compose (the pure engine unit-tested above)');
A.ok(/if \(!rep \|\| !rep\.hasReport\)/.test(src), 'an empty night renders the honest "no report" copy, never a fabricated digest');

A.report('nightshift-steer-ui');
