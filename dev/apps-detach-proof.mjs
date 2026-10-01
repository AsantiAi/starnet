// APPS — an app's REFRESH survives the window closing (2026-09-30).
//   node dev/apps-detach-proof.mjs [port] [appId]     against a RUNNING station with a real model
// Run Now cancels its run when the watching page goes away (the AUTOMATION panel's law). An app's REFRESH asks with
// detach:true, because the update is the app's job, not the window's. Proof: give the app an update task, press
// its refresh (the same request the bar sends), KILL the whole browser 3 s later, then — from a fresh browser —
// watch the routine finish green and the app change. Cleans up by turning the schedule off.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { findChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';

const PORT = Number(process.argv[2] || 8871), APP = process.argv[3] || 'focus-timer';
let failed = 0;
const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
async function browser(port) {
  const dir = mkdtempSync(join(tmpdir(), 'starnet-apps-detach-'));
  const chrome = spawn(findChrome(), ['--headless=new', '--no-first-run', '--remote-debugging-port=' + port, '--user-data-dir=' + join(dir, 'c'), 'about:blank'], { stdio: 'ignore', windowsHide: true });
  const cdp = await connectCDP(port);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  const run = (s) => evalJS(cdp, s);
  for (let i = 0; i < 60; i++) { try { if (await run(`typeof AppsUI === 'object' && !!document.querySelector('#screen-game.active')`)) break; } catch {} await sleep(500); }
  return { run, close: () => { try { cdp.ws.close(); } catch {} chrome.kill(); setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} }, 1500); } };
}
const MARK = 'DETACHED ' + Date.now().toString(36).toUpperCase();
try {
  let b = await browser(9492);
  const set = await b.run(`fetch('/api/apps/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ${JSON.stringify(APP)}, every: 'every 1d', task: ${JSON.stringify('Change the page itself: replace any small text under the title with the words "' + MARK + '". Keep everything else.')} }) }).then(r => r.json())`);
  check('the app has an update routine', !!(set && set.ok && set.jobId));
  const before = await b.run(`fetch('/api/apps').then(r => r.json()).then(j => j.apps.find(a => a.id === ${JSON.stringify(APP)}).digest)`);
  // exactly the request the bar's REFRESH sends
  await b.run(`(fetch('/api/cron/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ${JSON.stringify(set.jobId)}, detach: true }) }), true)`);
  await sleep(3000);
  b.close();                                   // the window (the whole browser) is gone mid-run
  console.log('browser killed 3 s into the run');
  await sleep(4000);
  b = await browser(9491);
  const t0 = Date.now();
  let job = null;
  while (Date.now() - t0 < 9 * 60 * 1000) {
    job = await b.run(`fetch('/api/cron').then(r => r.json()).then(j => (j.jobs || []).find(x => x.id === ${JSON.stringify(set.jobId)}) || null)`);
    if (job && job.lastRunAt && !job.inFlight) break;
    await sleep(5000);
  }
  console.log('routine after the run: ' + JSON.stringify({ lastStatus: job && job.lastStatus, lastError: job && job.lastError }));
  check('the run was NOT cancelled by the window closing — it finished', !!(job && job.lastRunAt && job.lastStatus !== 'error'));
  const after = await b.run(`fetch('/api/apps').then(r => r.json()).then(j => j.apps.find(a => a.id === ${JSON.stringify(APP)}))`);
  check('and the app changed (new page version)', after.digest !== before);
  await b.run(`fetch('/api/apps/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ${JSON.stringify(APP)}, every: 'off' }) }).then(r => r.json())`);
  b.close();
} catch (e) { console.error(String((e && e.stack) || e)); failed++; }
setTimeout(() => process.exit(failed ? 1 : 0), 2000);
