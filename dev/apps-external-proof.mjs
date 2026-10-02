// APPS — asking for an OUTSIDE tool never makes a StarNet app (2026-10-02).
//   node dev/apps-external-proof.mjs [port]     against a RUNNING station with a real model
// The other side of apps-comms-proof: a script, a website to host, a browser extension, a React project are things
// that live OUTSIDE StarNet. Each ask goes to a fresh COMMS session; when its run ends, /api/apps must hold no new
// app. The reply's opening is printed so a person can see what the crew did instead.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { findChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';

const PORT = Number(process.argv[2] || 8871);
const ASKS = [
  'write me a python script that renames all the photos in a folder by the date they were taken',
  'build me a landing page website for my bakery that I can host on Netlify',
  'make me a chrome extension that hides youtube shorts',
  'build a todo app in React',
];
let failed = 0;
const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const dir = mkdtempSync(join(tmpdir(), 'starnet-apps-ext-'));
const chrome = spawn(findChrome(), ['--headless=new', '--no-first-run', '--remote-debugging-port=9494', '--user-data-dir=' + join(dir, 'c'), 'about:blank'], { stdio: 'ignore', windowsHide: true });
try {
  const cdp = await connectCDP(9494);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  const run = (s) => evalJS(cdp, s);
  for (let i = 0; i < 60; i++) { try { if (await run(`typeof Chat === 'object' && !!document.querySelector('#screen-game.active')`)) break; } catch {} await sleep(500); }
  const appIds = async () => ((await run(`fetch('/api/apps').then(r => r.json())`)).apps || []).map((a) => a.id);
  for (const ask of ASKS) {
    const before = new Set(await appIds());
    const wsId = await run(`(() => { const ws = Workstreams.create('Outside tool'); Chat.load(ws); Chat.sendOrQueue(${JSON.stringify(ask)}); return ws.id; })()`);
    const t0 = Date.now();
    let started = false;
    while (Date.now() - t0 < 420000) {
      await sleep(3000);
      const busy = await run(`Channels.isBusy(${JSON.stringify(wsId)})`);
      if (busy) started = true; else if (started || Date.now() - t0 > 30000) break;
    }
    await sleep(3000);
    const fresh = (await appIds()).filter((id) => !before.has(id));
    const reply = await run(`(() => { const m = [...document.querySelectorAll('#chat-log > *')].pop(); return m ? m.textContent.replace(/\\s+/g, ' ').trim().slice(0, 220) : ''; })()`);
    check('"' + ask + '" → no StarNet app' + (fresh.length ? ' (MADE: ' + fresh.join(', ') + ')' : '') + ' · ' + Math.round((Date.now() - t0) / 1000) + 's', fresh.length === 0);
    console.log('     reply: ' + (reply || '(not read)'));
  }
  try { cdp.ws.close(); } catch {}
} finally {
  chrome.kill();
  setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} }, 1500);
}
console.log(failed ? failed + ' FAILED' : 'ALL PASS');
process.exitCode = failed ? 1 : 0;
