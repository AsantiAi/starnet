// APPS — asking for an app in plain COMMS builds a real StarNet app (2026-10-02).
//   node dev/apps-comms-proof.mjs [port] ["what to ask"]     against a RUNNING station with a real model
// No NEW APP button, no tool names: a fresh COMMS session is sent the Commander's plain words, and the proof waits
// for a NEW app in /api/apps whose page the crew actually wrote (builtAt). Leaves the app in place for a look.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { findChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';

const PORT = Number(process.argv[2] || 8871);
const ASK = process.argv[3] || 'build me a tip calculator app';
let failed = 0;
const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const dir = mkdtempSync(join(tmpdir(), 'starnet-apps-comms-'));
const chrome = spawn(findChrome(), ['--headless=new', '--no-first-run', '--remote-debugging-port=9493', '--user-data-dir=' + join(dir, 'c'), 'about:blank'], { stdio: 'ignore', windowsHide: true });
try {
  const cdp = await connectCDP(9493);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  const run = (s) => evalJS(cdp, s);
  for (let i = 0; i < 60; i++) { try { if (await run(`typeof Chat === 'object' && !!document.querySelector('#screen-game.active')`)) break; } catch {} await sleep(500); }
  const apps = async () => (await run(`fetch('/api/apps').then(r => r.json())`)).apps || [];
  const before = new Set((await apps()).map((a) => a.id));
  const sent = await run(`(() => { const ws = Workstreams.create('Plain chat'); Chat.load(ws); return Chat.sendOrQueue(${JSON.stringify(ASK)}); })()`);
  check('sent in a fresh COMMS session, no NEW APP, no tool names: "' + ASK + '"', sent !== false);
  const t0 = Date.now();
  let made = null;
  while (Date.now() - t0 < 420000) {
    await sleep(5000);
    made = (await apps()).find((a) => !before.has(a.id) && a.builtAt);
    if (made) break;
  }
  check('the crew made a new StarNet app and wrote its page' + (made ? ': ' + made.id + ' "' + made.name + '" (' + Math.round((Date.now() - t0) / 1000) + 's)' : ''), !!made);
  if (made) {
    await sleep(20000);   // let the run finish its check
    const page = await run(`fetch('/api/apps').then(r => r.json()).then(j => j.apps.find(a => a.id === ${JSON.stringify(made.id)}))`);
    check('its page has a version the APPS window can open', /^[0-9a-f]{64}$/.test((page && page.digest) || ''));
    const dock = await run(`(() => { const g = document.querySelector('#bb-apps-items'); return g ? g.textContent : ''; })()`);
    check('it is listed under APPS in the dock', dock.includes(made.name));
  }
  try { cdp.ws.close(); } catch {}
} finally {
  chrome.kill();
  setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} }, 1500);
}
console.log(failed ? failed + ' FAILED' : 'ALL PASS');
process.exitCode = failed ? 1 : 0;
