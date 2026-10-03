// perf-idle.mjs — what the station costs when nobody touches it: frame intervals, main-thread
// metrics over 5s, and every running CSS/Web animation with its target and property.
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { findChrome, connectCDP, evalJS, sleep } from './lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, isUp, waitUp, waitDevReady } from './lib/seed.mjs';
const port = '8941', cdpPort = 9342, APP_URL = `http://127.0.0.1:${port}/`, OUT = join(tmpdir(), 'starnet-perf-comms');
if (!(await isUp(APP_URL))) { const s = join(OUT, '_seed'); materializeSeedWorkspace(s); bootSeededSidecar({ port, scratchDir: s }); await waitUp(APP_URL); }
const profile = join(OUT, '_profile-idle'); try { rmSync(profile, { recursive: true, force: true }); } catch {}
const chrome = spawn(findChrome(), ['--headless=new', '--no-first-run', '--hide-scrollbars', '--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', `--remote-debugging-port=${cdpPort}`, '--window-size=1600,900', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
try {
  const cdp = await connectCDP(cdpPort);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Performance.enable');
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitDevReady(cdp, evalJS, { tries: 30, url: APP_URL });
  await sleep(15000);
  const anims = await evalJS(cdp, `document.getAnimations().map(a => { const t = a.effect && a.effect.target; const kf = a.effect && a.effect.getKeyframes ? [...new Set(a.effect.getKeyframes().flatMap(k => Object.keys(k).filter(x => !['offset','easing','composite','computedOffset'].includes(x))))].join(',') : ''; return (a.animationName || a.transitionProperty || a.constructor.name) + ' @ ' + (t ? (t.tagName + (t.id ? '#' + t.id : '') + (t.className && t.className.baseVal === undefined ? '.' + String(t.className).trim().split(/\s+/).slice(0, 2).join('.') : '') + (a.effect.pseudoElement || '')) : '?') + ' [' + kf + '] ' + a.playState; })`);
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  await evalJS(cdp, `(() => { window.__fr = []; let last = performance.now(); const tick = t => { window.__fr.push(t - last); last = t; if (window.__frOn) requestAnimationFrame(tick); }; window.__frOn = true; requestAnimationFrame(tick); return 1; })()`);
  await sleep(5000);
  const fr = await evalJS(cdp, `(() => { window.__frOn = false; return window.__fr.slice(1); })()`);
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const s = fr.slice().sort((a, b) => a - b), q = p => +s[Math.floor(p * (s.length - 1))].toFixed(1), d = k => +((m1[k] - m0[k]) * 1000).toFixed(0);
  console.log(JSON.stringify({ frames: fr.length, p50: q(.5), p95: q(.95), max: q(1), over20: fr.filter(f => f > 20).length, styleMs: d('RecalcStyleDuration'), layoutMs: d('LayoutDuration'), scriptMs: d('ScriptDuration'), taskMs: d('TaskDuration'), nodes: m1.Nodes, anims: anims.length }, null, 0));
  const c = {}; for (const a of anims) c[a] = (c[a] || 0) + 1;
  console.log(Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => v + '  ' + k).join('\n'));
} finally { try { chrome.kill(); } catch {} }
process.exit(0);
