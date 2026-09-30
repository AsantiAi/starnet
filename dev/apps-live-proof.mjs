// APPS — live proof against a RUNNING station with a REAL model (default http://127.0.0.1:8871).
//   node dev/apps-live-proof.mjs [port]      → .worldshots/apps-live/*.png + report.json
// Drives the real UI in headless Chromium: APPS → NEW APP → the AI News Brief example → BUILD IT, then waits for the
// crew to build it for real (the page written, real content published, a schedule set), approving any card that asks
// (as the Commander would). Proves the whole "describe it, get it" loop end to end — then asks for a change.
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { findChrome, connectCDP, evalJS, capture, sleep } from '../scripts/lib/cdp.mjs';

const PORT = Number(process.argv[2] || 8871), CDP_PORT = 9497;
const out = '.worldshots/apps-live';
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'starnet-apps-live-'));
const report = { checks: [], facts: {}, exceptions: [], approvals: 0 };
let chrome, cdp;
const run = (s) => evalJS(cdp, s);
const check = (name, ok) => { report.checks.push((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) throw new Error('FAIL: ' + name); };
const contexts = new Map();
async function frameEval(expression, re) {
  const tree = await cdp.send('Page.getFrameTree');
  const kids = (tree.frameTree.childFrames || []).map((c) => c.frame).filter((f) => re.test(f.url));
  if (!kids.length) throw Error('no frame');
  const ctx = contexts.get(kids[kids.length - 1].id);
  const r = await cdp.send('Runtime.evaluate', { expression, contextId: ctx, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
  return r.result && r.result.value;
}
// wait for `cond` (page expression) while approving any "Approve once" card that appears
async function waitApproving(cond, maxMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try { if (await run(cond)) return true; } catch {}
    const clicked = await run(`(()=>{ const b=[...document.querySelectorAll('#chat-panel button')].filter(b=>b.textContent.trim()==='Approve once' && !b.disabled).pop(); if(!b) return false; b.click(); return true; })()`).catch(() => false);
    if (clicked) { report.approvals++; report.facts['approval' + report.approvals] = await run(`((document.querySelector('#chat-panel').innerText||'').match(/wants to [^\\n]*/g)||[]).pop()||''`).catch(() => ''); }
    await sleep(2000);
  }
  throw new Error('timed out waiting for ' + label);
}

try {
  chrome = spawn(findChrome(), ['--headless=new', '--enable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--disable-features=IsolateSandboxedIframes,site-per-process', '--remote-debugging-port=' + CDP_PORT, '--window-size=1440,900', '--user-data-dir=' + join(scratch, 'chrome'), 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCDP(CDP_PORT);
  cdp.on('Runtime.executionContextCreated', (e) => { const a = e.context.auxData || {}; if (a.isDefault && a.frameId) contexts.set(a.frameId, e.context.id); });
  cdp.on('Runtime.exceptionThrown', (e) => report.exceptions.push(e.exceptionDetails.exception?.description || e.exceptionDetails.text));
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  for (let i = 0; i < 60; i++) { try { if (await run(`!!document.querySelector('#screen-game.active') && typeof AppsUI === 'object'`)) break; } catch {} await sleep(500); }
  check('the station is up with APPS loaded', await run(`typeof AppsUI === 'object' && !!document.querySelector('[data-group="apps"]')`));

  // ---- 1. the dock: APPS → NEW APP → pick the example → BUILD IT (real clicks through the DOM) ----
  await run(`document.querySelector('[data-group="apps"] .bb-grp').click(), true`);
  await sleep(300);
  await run(`document.getElementById('bb-newapp').click(), true`);
  await waitApproving(`!!document.getElementById('app-name')`, 10000, 'the APPS window');
  await sleep(500);
  report.facts.shotApps = await capture(cdp, out, '01-apps-window');
  await run(`document.querySelector('[data-app-example="0"]').click(), true`);
  const filled = await run(`({ name: document.getElementById('app-name').value, what: document.getElementById('app-what').value })`);
  check('the example fills the name and what-it-does', /AI News Brief/.test(filled.name) && /24h/.test(filled.what));
  await run(`document.getElementById('app-create').click(), true`);
  await waitApproving(`!!document.querySelector('.term.plugin-app-win iframe.plugin-frame')`, 20000, 'the app window');
  check('BUILD IT opens the app window at once (building page) and sends the build to COMMS', await run(`/Build my new StarNet app "AI News Brief"/.test(document.querySelector('#chat-panel').innerText)`));
  await sleep(800);
  report.facts.shotBuilding = await capture(cdp, out, '02-building');

  // ---- 2. the crew builds it for real: page written, content published, schedule set ----
  const t0 = Date.now();
  await waitApproving(`fetch('/api/apps').then(r=>r.json()).then(j=>{ const a=j.apps.find(a=>/^ai-news-brief/.test(a.id)); return !!(a && a.updatedAt && a.schedule); })`, 12 * 60 * 1000, 'the crew to publish content and schedule it');
  report.facts.buildSeconds = Math.round((Date.now() - t0) / 1000);
  const app = await run(`fetch('/api/apps').then(r=>r.json()).then(j=>({ app: j.apps.find(a=>/^ai-news-brief/.test(a.id)), routinesOn: j.routinesOn }))`);
  report.facts.app = app;
  check('the crew published real content into the app', !!app.app.updatedAt);
  check('the crew scheduled it (a real routine behind it)', !!(app.app.schedule && app.app.schedule.jobId && !app.app.schedule.missing));
  // wait for any trailing turn to settle, then look at the window
  await waitApproving(`!(typeof Chat !== 'undefined' && Chat.isBusy && Chat.isBusy())`, 5 * 60 * 1000, 'the run to finish');
  await sleep(2500);
  const kitClasses = await frameEval(`document.querySelectorAll('[class*="sn-"]').length`, /\/app-ui\//).catch(() => -1);
  report.facts.kitElements = kitClasses;
  check('the app page is built from the station kit (sn-* elements)', kitClasses > 3);
  const text = await frameEval(`document.body.innerText.slice(0, 800)`, /\/app-ui\//).catch(() => '');
  report.facts.pageText = text;
  check('the app shows real content (not the building page)', text.length > 120 && !/crew is building this app/.test(text));
  report.facts.barStatus = await run(`(document.querySelector('.term.plugin-app-win .app-status')||{}).textContent||''`);
  check('the bar under the window states the real status', /Updated/.test(report.facts.barStatus));
  report.facts.shotBuilt = await capture(cdp, out, '03-ai-news-brief');

  // ---- 3. vibe-code it from the bar ----
  const before = app.app.digest;
  await run(`(()=>{ const i=document.querySelector('.term.plugin-app-win .app-change'); i.value='make each headline a clickable row that opens its source, and add the date at the top'; document.querySelector('.term.plugin-app-win .app-bar').requestSubmit(); return true; })()`);
  check('CHANGE sends the request to the app\'s own COMMS session', await run(`/Change my StarNet app "AI News Brief"/.test(document.querySelector('#chat-panel').innerText)`));
  await waitApproving(`fetch('/api/apps').then(r=>r.json()).then(j=>{ const a=j.apps.find(a=>/^ai-news-brief/.test(a.id)); return !!(a && a.digest !== ${JSON.stringify(before)}); })`, 10 * 60 * 1000, 'the crew to rewrite the page');
  await waitApproving(`!(typeof Chat !== 'undefined' && Chat.isBusy && Chat.isBusy())`, 5 * 60 * 1000, 'the change run to finish');
  await sleep(2500);
  check('the change landed: the open window reloaded onto the new page', await run(`fetch('/api/apps').then(r=>r.json()).then(j=>{ const a=j.apps.find(a=>/^ai-news-brief/.test(a.id)); const f=document.querySelector('.term.plugin-app-win iframe.plugin-frame'); return !!(a && f && f.dataset.digest === a.digest); })`));
  report.facts.shotChanged = await capture(cdp, out, '04-after-change');
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  if (cdp) await capture(cdp, out, 'failure').catch(() => {});
  report.error = String((e && e.stack) || e);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.error(report.error); process.exitCode = 1;
} finally {
  try { cdp?.ws.close(); } catch {}
  chrome?.kill();
}
