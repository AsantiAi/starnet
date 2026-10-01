/* node test/apps.http.test.js — APPS through the REAL sidecar's routes (2026-10-01).

   test/apps.test.js proves sidecar/apps.js with injected parts; this boots the real station so the WIRING is proven
   too — the version digest index.js hands apps (a broken one emptied every app list on 10-01 while the module test
   stayed green), the routes, the served page and the app's own routine:
     - POST /api/apps creates an app; GET /api/apps lists it with a version (digest) and its building page is served
       under /app-ui/ with the kit injected and the network-less sandbox CSP;
     - the version is the PAGE: a schedule change (app.json) keeps it, a page change moves it;
     - POST /api/apps/schedule makes the app's own routine; a second SAVE edits that same routine in place;
       "off" removes it; already off changes nothing;
     - rename and delete; a deleted app's routine is gone too. */
'use strict';
const A = require('./_assert.js');
const path = require('path');
const fs = require('fs');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

(async () => {
  const fx = SidecarFixture.create({ prefix: 'sk-apps-http-' });
  await fx.start();
  try {
    const made = await fx.json('POST', '/api/apps', { name: 'Habit Tracker', description: 'track my habits' });
    A.eq(made.status, 200, 'POST /api/apps creates an app');
    const id = made.body && made.body.app && made.body.app.id;
    A.eq(id, 'habit-tracker', 'the id comes from the name');
    let list = await fx.json('GET', '/api/apps');
    const a0 = (list.body.apps || []).find((a) => a.id === id);
    A.ok(list.status === 200 && a0 && /^[0-9a-f]{64}$/.test(a0.digest || ''), 'GET /api/apps lists it with a page version (digest)');
    // the building page is served sandboxed with the kit (header-token read, as tests and QA do)
    const page = await fx.request('/app-ui/' + id + '/' + a0.digest + '/index.html');
    const html = await page.text();
    const csp = page.headers.get('content-security-policy') || '';
    A.ok(page.status === 200 && /_starnet\/kit\.js/.test(html) && /Your crew is building this app/.test(html), 'the app page is served with the station kit injected');
    A.ok(/sandbox allow-scripts/.test(csp) && /connect-src 'none'/.test(csp) && /form-action 'none'/.test(csp), 'served under the network-less sandbox: ' + csp.slice(0, 120));
    const stale = await fx.request('/app-ui/' + id + '/' + 'f'.repeat(64) + '/index.html');
    A.eq(stale.status, 410, 'a stale version is refused (410)');

    // the version is the PAGE, never app.json
    const s1 = await fx.json('POST', '/api/apps/schedule', { id, every: 'every 1h', task: 'refresh the habits summary' });
    A.ok(s1.status === 200 && s1.body.ok && s1.body.jobId, 'POST /api/apps/schedule makes the app its own routine: ' + JSON.stringify(s1.body).slice(0, 160));
    list = await fx.json('GET', '/api/apps');
    const a1 = list.body.apps.find((a) => a.id === id);
    A.eq(a1.digest, a0.digest, 'a schedule change does not change the page version (the open window is not reloaded)');
    A.ok(a1.schedule && a1.schedule.jobId === s1.body.jobId && a1.schedule.task === 'refresh the habits summary', 'the listing carries the schedule and its task');
    const s2 = await fx.json('POST', '/api/apps/schedule', { id, every: 'every 6h', task: 'refresh it twice as rarely' });
    A.eq(s2.body.jobId, s1.body.jobId, 'a second SAVE edits the SAME routine in place');
    const cron = await fx.json('GET', '/api/cron');
    const mine = (cron.body.jobs || []).filter((j) => j.meta && j.meta.appId === id);
    A.ok(mine.length === 1 && /6h|6 h/.test(mine[0].scheduleDisplay || JSON.stringify(mine[0].schedule)) && /twice as rarely/.test(mine[0].prompt), 'exactly one routine, now every 6h with the new task');
    // a real page change moves the version (the window follows)
    const appDir = path.join(fx.workspace, 'apps', id);
    fs.writeFileSync(path.join(appDir, 'index.html'), '<!doctype html><div class="sn-panel">v2</div>');
    await new Promise((r) => setTimeout(r, 1700));   // the station caches a version for 1.5 s (a crew write clears it at once)
    list = await fx.json('GET', '/api/apps');
    A.ok(list.body.apps.find((a) => a.id === id).digest !== a0.digest, 'a page change moves the version');

    const off = await fx.json('POST', '/api/apps/schedule', { id, every: 'off' });
    A.ok(off.body.ok && off.body.off, '"off" stops it');
    const after = await fx.json('GET', '/api/cron');
    A.ok(!(after.body.jobs || []).some((j) => j.meta && j.meta.appId === id), 'and its routine is gone');
    const again = await fx.json('POST', '/api/apps/schedule', { id, every: 'off' });
    A.ok(again.body.ok && again.body.unchanged === true, '"off" when already off changes nothing');

    const ren = await fx.json('POST', '/api/apps/rename', { id, name: 'Daily Habits' });
    A.ok(ren.body.ok && ren.body.name === 'Daily Habits', 'rename');
    await fx.json('POST', '/api/apps/schedule', { id, every: 'every 1d', task: 'x' });
    const del = await fx.json('POST', '/api/apps/delete', { id });
    A.ok(del.status === 200, 'delete');
    const gone = await fx.json('GET', '/api/apps');
    const cronGone = await fx.json('GET', '/api/cron');
    A.ok(!gone.body.apps.some((a) => a.id === id) && !(cronGone.body.jobs || []).some((j) => j.meta && j.meta.appId === id), 'a deleted app and its routine are both gone');
    const bad = await fx.json('POST', '/api/apps/schedule', { id: '../x', every: 'every 1h', task: 't' });
    A.eq(bad.status, 400, 'a bad app id is refused');
  } finally { await fx.dispose(); }
  A.report('apps.http.test');
})().catch((e) => { console.error(e); process.exit(1); });
