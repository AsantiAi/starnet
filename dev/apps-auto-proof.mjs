// APPS — AUTO-UPDATE (2026-09-30): an app runs on automation, and an update may change the dashboard itself.
//   node dev/apps-auto-proof.mjs [port] [appId]     against a RUNNING station with a real model → .worldshots/apps-auto/
// Andrew: "shouldnt it be allowed to run on automation? meaning the dashboard can change if the user wants, or maybe
// it can constantly update smth". Proof, in real Chromium: AUTO-UPDATE under the app → pick Hourly, write what each
// update does → SAVE makes the app's own routine; then that routine is fired NOW (the same run the clock would start —
// no chat, no crew hand-off) and it CHANGES THE PAGE ITSELF as the task asked: a new page version, with the words the
// task asked for, lands in the open window. Finally Off removes the routine.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { findChrome, connectCDP, evalJS, capture, sleep } from '../scripts/lib/cdp.mjs';

const PORT = Number(process.argv[2] || 8871), APP = process.argv[3] || 'focus-timer', CDP_PORT = 9493;
const out = '.worldshots/apps-auto';
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'starnet-apps-auto-'));
const MARK = 'AUTO ' + Date.now().toString(36).toUpperCase();
let chrome, cdp, failed = 0;
const facts = {};
const run = (s) => evalJS(cdp, s);
const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const until = async (cond, ms) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await run(cond)) return true; } catch {} await sleep(1000); } return false; };
const appNow = `fetch('/api/apps').then(r => r.json()).then(j => j.apps.find(a => a.id === ${JSON.stringify(APP)}))`;
try {
  chrome = spawn(findChrome(), ['--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--disable-features=IsolateSandboxedIframes,site-per-process', '--remote-debugging-port=' + CDP_PORT, '--window-size=1440,900', '--user-data-dir=' + join(scratch, 'chrome'), 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCDP(CDP_PORT);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  await until(`!!document.querySelector('#screen-game.active') && typeof AppsUI === 'object'`, 30000);
  await run(`(() => { const c = document.getElementById('nav-coach'); if (c) c.hidden = true; return true; })()`);
  await run(`AppsUI.load()`);
  const before = await run(appNow);
  check('the app exists: ' + APP, !!before);
  await run(`PluginHost.openApp(AppsUI.list().find(a => a.id === ${JSON.stringify(APP)})), true`);
  await until(`!!document.querySelector('.term.plugin-app-win .app-auto-toggle')`, 10000);
  await run(`(() => { const w = document.querySelector('.term.plugin-app-win'); const mx = w.querySelector('.gd-window-button[aria-label*="aximize"]'); if (mx) mx.click(); return true; })()`);
  await sleep(600);
  // ---- AUTO-UPDATE: Hourly + the Commander's words ----
  await run(`document.querySelector('.term.plugin-app-win .app-auto-toggle').click(), true`);
  await sleep(300);
  await run(`document.querySelector('.term.plugin-app-win .app-auto [data-every="every 1h"]').click(), true`);
  const task = 'Change the page itself: put the words "' + MARK + '" in small text under the title, and keep everything else exactly as it is.';
  await run(`(() => { const t = document.querySelector('.term.plugin-app-win .app-auto-task'); t.value = ${JSON.stringify(task)}; return true; })()`);
  await capture(cdp, out, '01-auto-update-panel');
  await run(`(window.__frameBefore = document.querySelector('.term.plugin-app-win iframe.plugin-frame'), true)`);
  await run(`document.querySelector('.term.plugin-app-win .app-auto-save').click(), true`);
  check('SAVE made the app its own hourly routine', await until(`${appNow}.then(a => !!(a && a.schedule && a.schedule.jobId && /1h|hour/.test(a.schedule.display || a.schedule.every)))`, 10000));
  await sleep(2500);
  check('SAVE did not reload the open app (same frame, same page — a running timer keeps running)', await run(`document.querySelector('.term.plugin-app-win iframe.plugin-frame') === window.__frameBefore`));
  const sched = await run(appNow);
  facts.schedule = sched.schedule;
  check('the bar now says it auto-updates: ' + await run(`document.querySelector('.term.plugin-app-win .app-auto-toggle').textContent`), await run(`/AUTO-UPDATE · /.test(document.querySelector('.term.plugin-app-win .app-auto-toggle').textContent)`));
  // ---- fire that routine NOW: the run the clock would start ----
  const digest0 = (await run(appNow)).digest;
  const t0 = Date.now();
  await run(`(() => { window.__cronDone = null; fetch('/api/cron/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ${JSON.stringify(sched.schedule.jobId)} }) }).then(r => r.text().then(t => { window.__cronDone = { status: r.status, tail: t.slice(-400) }; })).catch(e => { window.__cronDone = { status: 0, tail: String(e) }; }); return true; })()`);
  await until('!!window.__cronDone', 9 * 60 * 1000);
  const fired = (await run('window.__cronDone')) || { status: -1, tail: 'no answer in 9 min' };
  facts.runSeconds = Math.round((Date.now() - t0) / 1000);
  facts.runTail = fired.tail;
  check('the automated update ran (' + facts.runSeconds + 's, HTTP ' + fired.status + ')', fired.status === 200);
  const after = await run(appNow);
  check('the update CHANGED THE DASHBOARD (a new page version)', after.digest && after.digest !== digest0);
  await sleep(2500);
  const shown = await run(`(async () => { const tree = document.querySelector('.term.plugin-app-win iframe.plugin-frame'); return tree ? tree.dataset.digest : ''; })()`);
  check('the open window moved onto the new version', shown === after.digest);
  const html = await run(`fetch('/api/apps').then(() => true)`);
  facts.html = html;
  await capture(cdp, out, '02-after-automated-update');
  // ---- Off ----
  await run(`document.querySelector('.term.plugin-app-win .app-auto-toggle').click(), true`);
  await sleep(300);
  await run(`document.querySelector('.term.plugin-app-win .app-auto [data-every="off"]').click(), true`);
  await run(`document.querySelector('.term.plugin-app-win .app-auto-save').click(), true`);
  check('Off removes the routine', await until(`${appNow}.then(a => !!a && !a.schedule)`, 10000));
  check('and the routine itself is gone', await run(`fetch('/api/cron').then(r => r.json()).then(j => !(j.jobs || []).some(x => x.id === ${JSON.stringify(sched.schedule.jobId)}))`));
} catch (e) { console.error(String((e && e.stack) || e)); failed++; }
finally {
  writeFileSync(join(out, 'facts.json'), JSON.stringify(facts, null, 2));
  try { cdp?.ws.close(); } catch {}
  chrome?.kill();
  setTimeout(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch {} process.exit(failed ? 1 : 0); }, 800);
}
