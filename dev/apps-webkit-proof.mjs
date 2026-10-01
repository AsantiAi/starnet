// APPS in WEBKIT — the engine the macOS app runs (WKWebView), proven on Windows (2026-10-01).
//   PW_CORE=<path to a playwright-core whose WebKit build is installed> node dev/apps-webkit-proof.mjs [port]
//   (playwright-core@1.54.2 ↔ the installed webkit-2191; against a RUNNING station, default 8871)
// The mac recipe that has held every release: the native shell is shared code (the CSP pin, the opener and the
// sidecar are not platform-gated, and tauri://localhost is an allowed frame ancestor), so what can differ on a Mac is
// the ENGINE. This drives real WebKit through the whole APPS surface: the glass keys and fields as WebKit computes
// them, the dock menu's layout, a sandboxed app frame with the kit, the bridge store round-trip, auto height, a link
// leaving through the opener (window.open here; Tauri's opener on the desktop), a frame that navigates itself away
// being thrown out with the app put back, and the app window under the station's TEXT SIZE body zoom (the WebKit
// zoom quirk that broke build mode on a customer's M2 in 09-26).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PW_CORE = process.env.PW_CORE;
if (!PW_CORE) throw new Error('set PW_CORE to a playwright-core folder');
const { webkit } = createRequire(import.meta.url)(PW_CORE);
const PORT = Number(process.argv[2] || 8871);
const WS = process.env.STATION_WS || '';   // the station's workspaces folder (to write the test app's page)
const out = '.worldshots/apps-webkit';
mkdirSync(out, { recursive: true });
let failed = 0;
const check = (name, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>WebKit Test</title></head><body>
<div class="sn-stack"><div class="sn-panel sn-stack"><div class="sn-title">WebKit Test</div>
<input id="t" class="sn-input" placeholder="type"><button id="save" class="sn-btn primary">SAVE</button>
<div id="shown" class="sn-hint">nothing saved</div><a id="out" href="https://example.com/apps-webkit-proof">an outside link</a>
</div></div><script>
starnet.store.get('note').then((v) => { if (v) document.getElementById('shown').textContent = 'saved: ' + v; });
document.getElementById('save').addEventListener('click', async () => { await starnet.store.set('note', document.getElementById('t').value); document.getElementById('shown').textContent = 'saved: ' + (await starnet.store.get('note')); });
</script></body></html>`;

const browser = await webkit.launch();
let page = null, testAppId = null;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 200)));
  const T0 = Date.now(); const TRACE = process.env.TRACE === '1';
  if (TRACE) { page.on('framenavigated', (f) => { if (f !== page.mainFrame()) console.log('  [' + (Date.now() - T0) + '] frame nav ' + f.url().slice(-50)); }); page.on('framedetached', () => console.log('  [' + (Date.now() - T0) + '] frame detached')); }
  await page.goto('http://127.0.0.1:' + PORT + '/');
  await page.waitForFunction(() => !!document.querySelector('#screen-game.active') && typeof window.AppsUI === 'object' && typeof window.PluginHost === 'object', null, { timeout: 90000 });
  check('the station runs in WebKit', true, await browser.version());
  await page.evaluate(() => { const c = document.getElementById('nav-coach'); if (c) c.hidden = true; window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  await page.evaluate(() => window.AppsUI.load());
  if (TRACE) await page.evaluate(() => { const n = window.StationUI && StationUI.notify; if (n) StationUI.notify = function (m) { console.log('NOTIFY ' + String(m).slice(0, 120)); return n.apply(this, arguments); }; });
  if (TRACE) page.on('console', (m) => { if (/NOTIFY/.test(m.text())) console.log('  [' + (Date.now() - T0) + '] ' + m.text()); });
  // ---- the glass, as WebKit computes it ----
  await page.evaluate(() => window.AppsUI.openNew());
  await page.waitForSelector('#app-name', { timeout: 10000 });
  await sleep(500);
  const keys = await page.evaluate(() => {
    const k = (sel) => { const b = document.querySelector(sel); if (!b) return null; const c = getComputedStyle(b), r = b.getBoundingClientRect(); return { h: Math.round(r.height), radius: c.borderTopLeftRadius, font: c.fontSize, bg: c.backgroundColor }; };
    return { build: k('#app-create'), chip: k('[data-app-example]'), name: k('#app-name') };
  });
  check('WebKit draws the glass keys and fields (8px, 34px+, 16px; fields never black)', keys.build && keys.build.radius === '8px' && keys.build.h >= 34 && keys.build.font === '16px' && keys.chip.radius === '8px' && keys.name.radius === '8px' && !/rgb\(0, 0, 0\)/.test(keys.name.bg), JSON.stringify(keys));
  await page.screenshot({ path: join(out, '01-apps-window.png') });
  // ---- a test app: created through the station, its page written beside it ----
  const made = await page.evaluate(() => fetch('/api/apps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'WebKit Test', description: 'webkit proof' }) }).then((r) => r.json()));
  check('the app is created from WebKit', !!(made && made.ok), JSON.stringify(made).slice(0, 80));
  const id = made.app.id; testAppId = id;
  const appDir = WS ? join(WS, 'apps', id) : '';
  check('its folder is on the station (STATION_WS)', !!appDir && existsSync(join(appDir, 'app.json')));
  writeFileSync(join(appDir, 'index.html'), PAGE);
  await sleep(2000);   // the station caches an app's version for 1.5 s; the crew's own write clears it at once
  await page.evaluate((i) => window.AppsUI.onReload(i), id);
  // ---- the dock menu's layout in WebKit ----
  await page.evaluate(() => { const t = document.querySelector('#bottombar .bb-group[data-group="apps"] .bb-grp'); if (t) t.click(); });
  await sleep(500);
  const menu = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('#bottombar .bb-group[data-group="apps"] .bb-menu .bb'));
    const rs = items.map((i) => i.getBoundingClientRect());
    let overlap = false; for (let i = 1; i < rs.length; i++) if (rs[i].top < rs[i - 1].bottom - 0.5) overlap = true;
    const spill = items.some((i) => Array.from(i.querySelectorAll('.bb-tx > *')).some((t) => t.getBoundingClientRect().bottom > i.getBoundingClientRect().bottom + 0.5));
    return { n: items.length, overlap, spill, svg: items.every((i) => !!i.querySelector('.bb-i svg')) };
  });
  check('the APPS dock menu lays out cleanly in WebKit (no overlap, no spill, glass icons)', menu.n >= 3 && !menu.overlap && !menu.spill && menu.svg, JSON.stringify(menu));
  await page.screenshot({ path: join(out, '02-dock-menu.png') });
  await page.evaluate(() => { const t = document.querySelector('#bottombar .bb-group[data-group="apps"] .bb-grp'); if (t) t.click(); });
  // ---- the app window ----
  await page.evaluate((i) => window.PluginHost.openApp(window.AppsUI.list().find((a) => a.id === i)), id);
  await page.waitForFunction(() => { const f = document.querySelector('.term.plugin-app-win iframe.plugin-frame'); return !!f && f.getAttribute('sandbox') === 'allow-scripts'; }, null, { timeout: 15000 });
  const appFrame = async () => { for (let i = 0; i < 40; i++) { const f = page.frames().find((x) => /\/app-ui\//.test(x.url())); if (f) { try { if (await f.evaluate(() => /WebKit Test/.test(document.body.innerText))) return f; } catch (_) { /* reloading */ } } await sleep(500); } return null; };
  let fr = await appFrame();
  check('the app page renders in a sandboxed WebKit frame', !!fr);
  check('the station kit is in the frame (bridge + glass classes)', !!fr && await fr.evaluate(() => !!(window.starnet && window.starnet.__kit) && getComputedStyle(document.querySelector('.sn-panel')).borderTopStyle === 'solid'));
  await fr.fill('#t', 'hello from webkit');
  await fr.click('#save');
  await sleep(1500);
  check('the bridge store round-trips in WebKit', (await fr.textContent('#shown')) === 'saved: hello from webkit');
  const h = await page.evaluate(() => parseFloat(document.querySelector('.term.plugin-app-win iframe.plugin-frame').style.height));
  check('the frame sizes to its page (auto height through the bridge)', h > 120 && h !== 240, String(h));
  check('the bar under the window (change box, AUTO-UPDATE, status)', await page.evaluate(() => { const b = document.querySelector('.term.plugin-app-win .app-bar'); return !!b && !!b.querySelector('.app-change') && !!b.querySelector('.app-auto-toggle'); }));
  await page.screenshot({ path: join(out, '03-app-window.png') });
  // ---- a link: the opener, never the frame ----
  await fr.click('#out');
  await sleep(1500);
  const opened = await page.evaluate(() => window.__opened);
  check('an outside link opens through the station (not inside the frame)', opened.length === 1 && opened[0] === 'https://example.com/apps-webkit-proof', JSON.stringify(opened));
  check('…and the frame stayed on its page', /\/app-ui\//.test(fr.url()));
  // ---- the frame that leaves ----
  await fr.evaluate(() => { setTimeout(() => { location.href = 'https://example.com/?leak=1'; }, 50); });
  await sleep(6000);
  const foreign = page.frames().some((x) => /example\.com/.test(x.url()));
  check('a frame that navigates itself away is thrown out in WebKit', !foreign, JSON.stringify(page.frames().map((x) => x.url().slice(0, 50))));
  fr = await appFrame();
  check('…and the app is back in its window', !!fr);
  // ---- TEXT SIZE body zoom (the WebKit zoom quirk) ----
  await page.evaluate(() => { document.body.style.zoom = '1.15'; });
  await sleep(1200);
  const z = await page.evaluate(() => { const w = document.querySelector('.term.plugin-app-win'); const f = w && w.querySelector('iframe.plugin-frame'); const b = w && w.querySelector('.app-change-go'); const wr = w.getBoundingClientRect(), fr2 = f.getBoundingClientRect(); return { winVisible: wr.width > 200 && wr.height > 150, frameInWin: fr2.width > 100 && fr2.height > 60, bar: !!b && b.getBoundingClientRect().width > 30 }; });
  check('under a 115% TEXT SIZE body zoom the app window, frame and bar still lay out', z.winVisible && z.frameInWin && z.bar, JSON.stringify(z));
  // a REAL click on the bar's key at the coordinates the engine reports — the class of bug the WebKit zoom quirk caused
  await page.click('.term.plugin-app-win .app-auto-toggle');
  await sleep(400);
  check('…and a real click lands on the bar\'s AUTO-UPDATE key under that zoom', await page.evaluate(() => { const p = document.querySelector('.term.plugin-app-win .app-auto'); return !!p && !p.hidden; }));
  await page.screenshot({ path: join(out, '04-zoomed.png') });
} catch (e) { console.error(String((e && e.stack) || e)); failed++; }
finally {
  // never leave the test app on the station, pass or fail
  if (page && testAppId) { try { await page.evaluate((i) => fetch('/api/apps/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: i }) }), testAppId); } catch (_) { /* the station is gone */ } }
  await browser.close(); process.exit(failed ? 1 : 0);
}
