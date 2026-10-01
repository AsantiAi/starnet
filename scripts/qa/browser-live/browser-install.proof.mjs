// LIVE PROOF (portable: Windows / macOS / Linux): a computer with no Chrome gets one — the real download path.
// Downloads Google's Chrome for Testing with the shipping installer (sidecar/browser-install.js) into a temp folder,
// launches it as a VISIBLE window through the shipping driver with ONLY that browser visible to it, opens GitHub's
// sign-in page, and closes it cleanly. Also reports the Linux sandbox decision for this host.
//   node scripts/qa/browser-live/browser-install.proof.mjs
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { makeChromiumInstaller } = require('../../../sidecar/browser-install.js');
const T = require('../../../sidecar/tools/builtin/browser.js')._internals;

const results = [];
const ok = (name, cond, detail) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + String(detail).slice(0, 300) : '')); };
const root = mkdtempSync(join(tmpdir(), 'starnet-cft-'));
let lastBeat = Date.now(), worst = 0;
const beat = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - lastBeat - 50); lastBeat = now; }, 50);
try {
  const inst = makeChromiumInstaller({ root, now: () => Date.now() });
  ok('this computer has a downloadable build', !!inst.platformKey, process.platform + '/' + process.arch + ' -> ' + inst.platformKey);
  const t0 = Date.now();
  const exe = await inst.ensure();
  ok('Chrome for Testing downloaded and unpacked', existsSync(exe), exe + ' in ' + Math.round((Date.now() - t0) / 1000) + ' s');
  ok('the station stayed responsive during download + unpack (worst event-loop stall < 1 s)', worst < 1000, worst + ' ms');
  T.setExtraChrome(() => inst.find());
  const own = resolve(exe);
  ok('with nothing else visible, the driver resolves the downloaded browser', (T.resolveChrome(true, p => resolve(p) === own) || {}).path === exe);
  console.log('   linux sandbox decision: ' + (T.needsNoSandbox({ chromePath: exe }) ? '--no-sandbox (user namespaces restricted)' : 'sandboxed'));
  const prof = mkdtempSync(join(tmpdir(), 'starnet-cft-prof-'));
  const d = T.makeCdpDriver({ existsSync: p => resolve(p) === own, headed: true, env: {}, profileDir: prof, cdpPort: 0, timeoutMs: 30000 });
  const at = await d.navigate('https://github.com/login');
  const info = await d.pageInfo();
  ok('the downloaded browser opens as a visible window and loads GitHub sign-in', /github\.com\/login/.test(String(at)) && /GitHub/i.test(info.title), JSON.stringify(info));
  await d.close();
  ok('and closes cleanly', true);
  rmSync(prof, { recursive: true, force: true });
} catch (e) {
  ok('proof threw', false, e && e.stack || String(e));
} finally {
  clearInterval(beat);
  try { rmSync(root, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  const bad = results.filter(r => !r).length;
  console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
  process.exit(bad ? 1 : 0);
}
