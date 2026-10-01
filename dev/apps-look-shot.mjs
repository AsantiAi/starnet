// APPS — the look, beside the real station (2026-09-30).
//   node dev/apps-look-shot.mjs [port]      against a RUNNING station → .worldshots/apps-look/*.png + computed styles
// Andrew: "its not supposed to be pitch black … we have a new AESTHETIC". Shoots the APPS window (the NEW APP form
// and the list) and an app window with its bar, and prints the computed background of every APPS field next to the
// real COMMS composer, so "matches the glass" is measured, not eyeballed.
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { findChrome, connectCDP, evalJS, capture, sleep } from '../scripts/lib/cdp.mjs';

const PORT = Number(process.argv[2] || 8871), CDP_PORT = 9495;
const out = '.worldshots/apps-look';
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'starnet-apps-look-'));
let chrome, cdp, failed = 0;
const run = (s) => evalJS(cdp, s);
const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const until = async (cond, ms) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await run(cond)) return true; } catch {} await sleep(250); } return false; };
// "pitch black" = an opaque near-black paint: any gradient stop or colour whose RGB sum is under 30 at alpha > .5
const BLACK = `(bg) => { const m = [...String(bg).matchAll(/rgba?\\(([^)]+)\\)/g)].map(x => x[1].split(',').map(Number)); return m.some(([r,g,b,a]) => (a === undefined || a > .5) && r + g + b < 30); }`;
try {
  chrome = spawn(findChrome(), ['--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--disable-features=IsolateSandboxedIframes,site-per-process', '--remote-debugging-port=' + CDP_PORT, '--window-size=1440,900', '--user-data-dir=' + join(scratch, 'chrome'), 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCDP(CDP_PORT);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  await until(`!!document.querySelector('#screen-game.active') && typeof AppsUI === 'object'`, 30000);
  await run(`AppsUI.load()`);
  await run(`AppsUI.openNew(), true`);
  await until(`!!document.getElementById('app-name')`, 8000);
  await sleep(600);
  await run(`(() => { document.getElementById('app-name').value = 'Idea Board'; return true; })()`);
  await capture(cdp, out, '01-apps-window');
  await run("document.querySelector('[data-app-example=\"0\"]').click(), true");
  await sleep(200);
  await capture(cdp, out, '01b-apps-window-chip');
  // the station's own glass keys for comparison: the Build Library's
  const keyOf = (sel) => `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return null; const c = getComputedStyle(b), r = b.getBoundingClientRect(); return { h: Math.round(r.height), radius: c.borderTopLeftRadius, font: c.fontSize, bg: c.backgroundImage.slice(0, 60) }; })()`;
  const keys = { build: await run(keyOf('#app-create')), chip: await run(keyOf('[data-app-example]')), row: await run(keyOf('.term.apps-win [data-app-open]')) };
  console.log('KEYS ' + JSON.stringify(keys));
  check('the APPS keys are the station glass key: 8px radius, at least 34px tall, 16px label', ['build', 'chip'].every((k) => keys[k] && keys[k].radius === '8px' && keys[k].h >= 34 && keys[k].font === '16px'));
  const styles = await run(`(() => {
    const isBlack = ${BLACK};
    const pick = (el) => { if (!el) return null; const cs = getComputedStyle(el); return { bg: cs.backgroundColor + ' ' + cs.backgroundImage, border: cs.borderTopColor, shadow: cs.textShadow }; };
    const r = { composer: pick(document.querySelector('#chat-inputrow')), name: pick(document.getElementById('app-name')), what: pick(document.getElementById('app-what')),
      build: pick(document.getElementById('app-create')), chip: pick(document.querySelector('[data-app-example]')), row: pick(document.querySelector('.term.apps-win .app-row')) };
    r.black = Object.fromEntries(Object.entries(r).filter(([, v]) => v).map(([k, v]) => [k, isBlack(v.bg)]));
    return r;
  })()`);
  console.log(JSON.stringify(styles, null, 1));
  check('no APPS field, button or row is painted black', !['name', 'what', 'build', 'chip', 'row'].some((k) => styles.black[k]));
  check('the fields carry no CRT glow', !/px/.test(String(styles.name && styles.name.shadow)) || /none/.test(String(styles.name.shadow)));
  // the APPS dock menu, open
  await run("(window.StationUI || {}).closeTerm && StationUI.closeTerm('apps'), true");
  await run("document.querySelector('#bottombar .bb-group[data-group=\"apps\"] .bb-grp').click(), true");
  await sleep(500);
  const menu = await run(`(() => { const items = Array.from(document.querySelectorAll('#bottombar .bb-group[data-group="apps"] .bb-menu .bb')); const rects = items.map(i => i.getBoundingClientRect()); let overlap = false; for (let i = 1; i < rects.length; i++) if (rects[i].top < rects[i - 1].bottom - 0.5) overlap = true; const clipped = items.some(i => Array.from(i.querySelectorAll('.bb-tx > *')).some(t => t.getBoundingClientRect().bottom > i.getBoundingClientRect().bottom + 0.5)); return { n: items.length, overlap, clipped, svg: items.every(i => !!i.querySelector('.bb-i svg')) }; })()`);
  console.log('MENU ' + JSON.stringify(menu));
  check('the APPS dock menu: no item overlaps another, no text spills, every item has its glass icon', menu.n >= 3 && !menu.overlap && !menu.clipped && menu.svg);
  await capture(cdp, out, '03-apps-dock-menu');
  await run("document.querySelector('#bottombar .bb-group[data-group=\"apps\"] .bb-grp').click(), true");
  await sleep(300);
  // an app window with its bar
  const first = await run(`(AppsUI.list()[0] || {}).id || ''`);
  if (first) {
    await run(`(window.StationUI || {}).closeTerm && StationUI.closeTerm('apps'), true`);
    await run(`PluginHost.openApp(AppsUI.list()[0]), true`);
    await until(`!!document.querySelector('.term.plugin-app-win .app-bar')`, 8000);
    await sleep(3000);
    const bar = await run(`(() => { const isBlack = ${BLACK}; const i = document.querySelector('.term.plugin-app-win .app-change'), b = document.querySelector('.term.plugin-app-win .app-bar'); const ci = getComputedStyle(i), cb = getComputedStyle(b); return { input: ci.backgroundColor + ' ' + ci.backgroundImage, bar: cb.backgroundColor + ' ' + cb.backgroundImage, black: isBlack(ci.backgroundColor + ' ' + ci.backgroundImage) || isBlack(cb.backgroundColor + ' ' + cb.backgroundImage) }; })()`);
    console.log(JSON.stringify(bar));
    check('the change box under an app window is glass, not black', !bar.black);
    await capture(cdp, out, '02-app-window');
  }
} catch (e) { console.error(String((e && e.stack) || e)); failed++; }
finally {
  try { cdp?.ws.close(); } catch {}
  chrome?.kill();
  setTimeout(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch {} process.exit(failed ? 1 : 0); }, 800);
}
