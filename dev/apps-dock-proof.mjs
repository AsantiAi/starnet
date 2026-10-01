// APPS — the dock follows the list (2026-09-30): no APPS button until the Commander has an app.
//   node dev/apps-dock-proof.mjs [port]      against a RUNNING station (default 8871); creates and deletes one app
// Andrew: "the apps button shouldnt show up on the bottom until the user creates one". Proof, in real Chromium:
//   with no apps the APPS dock is not displayed and BUILD → NEW APP opens the form; an app that appears on the
//   station (made by the crew in COMMS, no page action) shows the dock, lists itself there and opens its window;
//   one click on its dock entry opens it; deleting the last app hides the dock again.
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { findChrome, connectCDP, evalJS, capture, sleep } from '../scripts/lib/cdp.mjs';

const PORT = Number(process.argv[2] || 8871), CDP_PORT = 9499;
const out = '.worldshots/apps-dock';
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'starnet-apps-dock-'));
let chrome, cdp, failed = 0;
const run = (s) => evalJS(cdp, s);
const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const until = async (cond, ms) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await run(cond)) return true; } catch {} await sleep(250); } return false; };
const shown = `(() => { const g = document.querySelector('#bottombar .bb-group[data-group="apps"]'); return !!g && g.getClientRects().length > 0; })()`;
const NAME = 'Dock Proof ' + Date.now().toString(36);
try {
  chrome = spawn(findChrome(), ['--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--disable-features=IsolateSandboxedIframes,site-per-process', '--remote-debugging-port=' + CDP_PORT, '--window-size=1440,900', '--user-data-dir=' + join(scratch, 'chrome'), 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCDP(CDP_PORT);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  await until(`!!document.querySelector('#screen-game.active') && typeof AppsUI === 'object'`, 30000);
  await run(`AppsUI.load()`);
  const had = await run(`AppsUI.list().length`);
  if (had === 0) {
    check('with no apps, the APPS dock is not displayed', !(await run(shown)));
    await capture(cdp, out, '01-no-apps-dock');
  } else console.log('NOTE this station already has ' + had + ' app(s): the empty-dock check runs after the delete below only if it was the last');
  check('BUILD has NEW APP (the way to the first app)', await run(`!!document.querySelector('#bottombar .bb-group[data-group="build"] #bb-newapp-build')`));
  await run(`document.querySelector('#bottombar .bb-group[data-group="build"] .bb-grp').click(), true`);
  await sleep(250);
  await run(`document.getElementById('bb-newapp-build').click(), true`);
  check('BUILD → NEW APP opens the form', await until(`!!document.getElementById('app-name') && document.getElementById('app-name').getClientRects().length > 0`, 8000));
  // an app appears on the station WITHOUT this page creating it (what app.create in a crew run does)
  const made = await run(`fetch('/api/apps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ${JSON.stringify(NAME)}, description: 'dock proof' }) }).then(r => r.json())`);
  const id = made && made.app && made.app.id;
  check('the station created the app: ' + id, !!id);
  check('the APPS dock appears by itself', await until(shown, 8000));
  check('the new app opened its own window', await until(`!!document.querySelector('.term.plugin-app-win iframe.plugin-frame[data-plugin="${id}"]')`, 8000));
  check('the dock lists the app by name', await run(`Array.from(document.querySelectorAll('#bb-apps-items .bb b')).some(b => b.textContent === ${JSON.stringify(NAME)})`));
  // close the window, then open it from the dock in one click
  await run(`(window.StationUI || {}).closeTerm && StationUI.closeTerm('app.${id}'), true`);
  await sleep(300);
  await run(`document.querySelector('#bottombar .bb-group[data-group="apps"] .bb-grp').click(), true`);
  await sleep(300);
  await capture(cdp, out, '02-apps-dock-menu');
  await run(`Array.from(document.querySelectorAll('#bb-apps-items .bb')).find(b => b.querySelector('b').textContent === ${JSON.stringify(NAME)}).click(), true`);
  check('its dock entry opens the app', await until(`(() => { const f = document.querySelector('.term.plugin-app-win iframe.plugin-frame[data-plugin="${id}"]'); return !!f && f.getClientRects().length > 0; })()`, 8000));
  check('and the dock menu collapsed', await until(`!document.querySelector('#bottombar .bb-group[data-group="apps"]').classList.contains('open')`, 3000));
  // delete it
  await run(`fetch('/api/apps/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ${JSON.stringify(id)} }) }).then(() => AppsUI.load())`);
  check('the deleted app left the dock list', await until(`!Array.from(document.querySelectorAll('#bb-apps-items .bb b')).some(b => b.textContent === ${JSON.stringify(NAME)})`, 5000));
  if (had === 0) check('with the last app gone, the APPS dock hides again', await until('!' + shown, 5000));
} catch (e) { console.error(String((e && e.stack) || e)); failed++; }
finally {
  try { cdp?.ws.close(); } catch {}
  chrome?.kill();
  setTimeout(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch {} process.exit(failed ? 1 : 0); }, 800);
}
