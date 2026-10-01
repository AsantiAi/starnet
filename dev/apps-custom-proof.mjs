// APPS — "it can be anything" (2026-09-30): a real model builds an INTERACTIVE app with a CUSTOM look.
//   node dev/apps-custom-proof.mjs [port]      against a RUNNING station with a real model → .worldshots/apps-custom/
// Andrew: "it should be very customizable, meaning it can be anything … the users should do what they want".
// Builds the Focus Timer example (a pomodoro timer that must look like a retro arcade cabinet, no schedule, no
// published data) and proves: the crew wrote a working page with its OWN look, it runs (the clock counts down after
// START), and the list calls it ready — never "not built yet" just because nothing was published.
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { findChrome, connectCDP, evalJS, capture, sleep } from '../scripts/lib/cdp.mjs';

const PORT = Number(process.argv[2] || 8871), CDP_PORT = 9496;
const out = '.worldshots/apps-custom';
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

  await run(`document.querySelector('[data-group="' + (document.querySelector('#bottombar .bb-group[data-group="apps"]').hidden ? 'build' : 'apps') + '"] .bb-grp').click(), true`);
  await sleep(300);
  await run(`(document.querySelector('#bottombar .bb-group.open #bb-newapp') || document.getElementById('bb-newapp-build')).click(), true`);
  await waitApproving(`!!document.getElementById('app-name')`, 10000, 'the APPS window');
  await run(`document.querySelector('[data-app-example="3"]').click(), true`);
  const filled = await run(`({ name: document.getElementById('app-name').value, what: document.getElementById('app-what').value })`);
  check('the example asks for a custom look: ' + filled.name, /Focus Timer/.test(filled.name) && /arcade/.test(filled.what));
  await run(`document.getElementById('app-create').click(), true`);
  await waitApproving(`!!document.querySelector('.term.plugin-app-win iframe.plugin-frame[data-plugin^="focus-timer"]')`, 20000, 'the app window');
  const t0 = Date.now();
  await waitApproving(`fetch('/api/apps').then(r=>r.json()).then(j=>{ const a=j.apps.find(a=>/^focus-timer/.test(a.id)); return !!(a && a.builtAt); })`, 12 * 60 * 1000, 'the crew to write the page');
  await waitApproving(`!(typeof Chat !== 'undefined' && Chat.isBusy && Chat.isBusy())`, 8 * 60 * 1000, 'the run to finish');
  report.facts.buildSeconds = Math.round((Date.now() - t0) / 1000);
  await sleep(3000);
  const fre = /\/app-ui\/~t\/[^/]+\/focus-timer/;
  const CLOCK = String.raw`(document.body.innerText.match(/\d{1,2}:\d{2}/) || [''])[0]`;
  const text = await frameEval(`document.body.innerText.slice(0, 400)`, fre).catch((e) => 'ERR ' + e.message);
  report.facts.pageText = text;
  check('the app is a real page (not the building page)', text.length > 10 && !/crew is building this app/.test(text) && !/^ERR/.test(text));
  const look = await frameEval(`(() => { const own = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('').length; return { ownCss: own, buttons: document.querySelectorAll('button').length, clock: ${CLOCK} }; })()`, fre);
  report.facts.look = look;
  check('it has its OWN look (its own CSS, not only the kit): ' + look.ownCss + ' chars', look.ownCss > 300);
  check('it shows a clock and controls: ' + look.clock + ', ' + look.buttons + ' buttons', !!look.clock && look.buttons >= 1);
  report.facts.shotBuilt = await capture(cdp, out, '01-focus-timer');
  // it WORKS: press the first button that says start, the clock moves
  await frameEval(`(() => { const b = Array.from(document.querySelectorAll('button')).find(b => /start|play|go|▶/i.test(b.textContent)) || document.querySelector('button'); b.click(); return true; })()`, fre);
  await sleep(3500);
  const after = await frameEval(CLOCK, fre);
  report.facts.clockAfter = after;
  check('START runs it: the clock moved ' + look.clock + ' → ' + after, !!after && after !== look.clock);
  const row = await run(`fetch('/api/apps').then(r=>r.json()).then(j=>{ const a=j.apps.find(a=>/^focus-timer/.test(a.id)); return { status: AppsUI._test.statusOf(a), schedule: a.schedule, updatedAt: a.updatedAt }; })`);
  report.facts.row = row;
  check('its status is honest for a tool with no feed: ' + row.status, /^Built /.test(row.status) && !/Not built/.test(row.status));
  report.facts.shotRunning = await capture(cdp, out, '02-running');
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
