#!/usr/bin/env node
// perf-comms-drag.mjs — measure how smooth a COMMS seam drag is.
//
// Boots a SEEDED dev sidecar (or reuses one on the port), opens the station in Chrome WITH the GPU
// (the shoot harness runs --disable-gpu; this one must not — compositing cost is what we measure),
// fills COMMS with a realistic conversation, then drags #comms-resizer back and forth with real
// CDP mouse events at ~60 Hz. Reports frame intervals (rAF) plus where the main thread spent the
// drag (DevTools trace, top event names by total time).
//
// Usage: node scripts/perf-comms-drag.mjs [--port 8941] [--cdp 9341] [--variant name] [--css "..."]
//        [--js "..."] [--reps 3] [--msgs 60] [--trace]
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { findChrome, connectCDP, evalJS, sleep, capture } from './lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, isUp, waitUp, waitDevReady } from './lib/seed.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const port = arg('--port', '8941'), cdpPort = Number(arg('--cdp', '9341'));
const reps = Number(arg('--reps', '3')), msgs = Number(arg('--msgs', '60'));
const css = arg('--css', ''), js = arg('--js', ''), variant = arg('--variant', 'baseline');
const wantTrace = process.argv.includes('--trace');
const shots = process.argv.includes('--shots');
const after = arg('--after', ''), before = arg('--before', '');
const W = 1600, H = 900;
const OUT = join(tmpdir(), 'starnet-perf-comms');
mkdirSync(OUT, { recursive: true });
const APP_URL = `http://127.0.0.1:${port}/`;

let side = null;
if (!(await isUp(APP_URL))) {
  const scratch = join(OUT, '_seed');
  materializeSeedWorkspace(scratch);
  side = bootSeededSidecar({ port, scratchDir: scratch });
  if (!(await waitUp(APP_URL))) throw new Error('sidecar never came up');
}
const profile = join(OUT, '_profile-' + cdpPort);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
const chrome = spawn(findChrome(), [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
  '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist',
  `--remote-debugging-port=${cdpPort}`, `--window-size=${W},${H}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const results = { variant, runs: [] };
try {
  const cdp = await connectCDP(cdpPort);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Performance.enable');
  await cdp.send('Page.navigate', { url: APP_URL });
  if (!(await waitDevReady(cdp, evalJS, { tries: 30, url: APP_URL }))) throw new Error('never reached the floor');
  await sleep(2500);
  results.gpu = await evalJS(cdp, `(() => { const c = document.createElement('canvas').getContext('webgl'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'none'; })()`);

  // A real Commander's COMMS is full: fill it with replies shaped like the app's own (headings, bold,
  // code, lists) by cloning whatever message nodes exist, else plain report-ish blocks.
  results.filled = await evalJS(cdp, `(() => {
    const log = document.getElementById('chat-log');
    if (!log) return 'no log';
    const md = '## Findings\\nChecked the **build pipeline** and the \`sidecar/loop.js\` retry path. Three things stand out:\\n\\n- The **cache** is cold on every run.\\n- Retries double-count tokens.\\n- The deploy step never reports its exit code.\\n\\n\`\`\`\\nnpm run test:fast\\n  1036 passing\\n\`\`\`\\n\\nNext I would fix the retry accounting first, since it skews every cost readout on the station.';
    for (let i = 0; i < ${msgs}; i++) {
      const u = document.createElement('div'); u.className = 'cmsg user';
      u.innerHTML = '<span class="cmsg-head"><span class="who">COMMANDER</span><span class="cmsg-ts">12:0' + (i % 10) + '</span></span><span class="body">check the build pipeline and tell me what is slow</span>';
      log.appendChild(u);
      const d = document.createElement('div'); d.className = 'cmsg agent no-anim';
      d.innerHTML = '<span class="cmsg-head"><span class="who">AGENT</span><span class="cmsg-ts">12:0' + (i % 10) + '</span></span>';
      const b = document.createElement('span'); b.className = 'body'; d.appendChild(b);
      try { Chat.renderProse(b, md); } catch (e) { b.textContent = md; }
      log.appendChild(d);
    }
    log.scrollTop = log.scrollHeight;
    return 'children=' + log.children.length;
  })()`);
  if (css) await evalJS(cdp, `(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); return 1; })()`);
  if (js) results.js = await evalJS(cdp, js);
  await sleep(Number(arg('--settle', '15000')));

  const r = await evalJS(cdp, `(() => { const b = document.getElementById('comms-resizer').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  results.handle = r;

  if (shots) results.shotBefore = (await capture(cdp, OUT, variant + '-before')).path;
  for (let rep = 0; rep < reps; rep++) {
    if (before) (results.before = results.before || []).push(await evalJS(cdp, before));
    await evalJS(cdp, `(() => { window.__fr = []; let last = performance.now(); const tick = t => { window.__fr.push(t - last); last = t; if (window.__frOn) requestAnimationFrame(tick); }; window.__frOn = true; requestAnimationFrame(tick); return 1; })()`);
    const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    if (wantTrace && rep === 0) await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking,blink,cc,gpu,viz', transferMode: 'ReturnAsStream' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    const t0 = Date.now();
    const STEPS = 120;
    for (let i = 1; i <= STEPS; i++) {
      const x = r.x - Math.sin((i / STEPS) * Math.PI * 2) * 380;   // left 380px, back, right, back
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: r.y, button: 'left', buttons: 1 });
      if (shots && rep === 0 && i === 30) results.shotMid = (await capture(cdp, OUT, variant + '-mid')).path;
      const due = t0 + i * 16; const wait = due - Date.now(); if (wait > 0) await sleep(wait);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    const wall = Date.now() - t0;
    const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const fr = await evalJS(cdp, `(() => { window.__frOn = false; return window.__fr.slice(1); })()`);
    const s = fr.slice().sort((a, b) => a - b);
    const q = p => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
    const d = k => +((m1[k] - m0[k]) * 1000).toFixed(0);
    results.runs.push({
      wallMs: wall, frames: fr.length, fps: +(fr.length / (wall / 1000)).toFixed(1),
      p50: q(0.5), p95: q(0.95), max: +s[s.length - 1].toFixed(1), over33: fr.filter(f => f > 33).length,
      layoutMs: d('LayoutDuration'), styleMs: d('RecalcStyleDuration'), scriptMs: d('ScriptDuration'), taskMs: d('TaskDuration'),
      layouts: m1.LayoutCount - m0.LayoutCount,
    });
    if (wantTrace && rep === 0) {
      const done = new Promise(res => cdp.on('Tracing.tracingComplete', res));
      await cdp.send('Tracing.end');
      const { stream } = await done;
      let data = '';
      for (;;) { const c = await cdp.send('IO.read', { handle: stream, size: 1 << 20 }); data += c.base64Encoded ? Buffer.from(c.data, 'base64').toString() : c.data; if (c.eof) break; }
      await cdp.send('IO.close', { handle: stream });
      const ev = JSON.parse(data); const events = ev.traceEvents || ev;
      writeFileSync(join(OUT, `trace-${variant}.json`), JSON.stringify(events));
      // top complete events on the renderer main thread + GPU/viz, self-ish time by name
      const tot = {};
      for (const e of events) if (e.ph === 'X' && e.dur) { const k = e.name; tot[k] = (tot[k] || 0) + e.dur; }
      results.traceTop = Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${k}: ${(v / 1000).toFixed(0)}ms`);
    }
    await sleep(800);
    if (after) (results.afterEach = results.afterEach || []).push(await evalJS(cdp, after));
  }
  if (shots) results.shotAfter = (await capture(cdp, OUT, variant + '-after')).path;
  if (after) results.after = await evalJS(cdp, after);
  console.log(JSON.stringify(results, null, 1));
} finally {
  try { chrome.kill(); } catch {}
  if (side && !process.argv.includes('--keep')) try { side.kill(); } catch {}
}
process.exit(0);
