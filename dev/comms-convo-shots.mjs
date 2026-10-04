#!/usr/bin/env node
/* dev/comms-convo-shots.mjs — readability proof for the COMMS transcript.
 *
 * Boots dev/seed-comms-convo.js on its own port (fresh scratch workspace every run), drives a short
 * real conversation through the composer, and captures the #chat-panel at 2x — once scrolled to the
 * top, once at the bottom — plus a narrow-panel pass. Also measures every message's timestamp rect
 * against its text rect (a stamp must never cover text).
 *
 *   node dev/comms-convo-shots.mjs <label>   → dev/.shots-comms-convo/<label>-*.png
 *   ports: SKYNET_SHOT_PORT (default 9941) / SKYNET_CDP_PORT (default 9942)
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchChrome, connectCDP, evalJS, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LABEL = process.argv[2] || 'shot';
const PORT = process.env.SKYNET_SHOT_PORT || '9941';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9942);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(HERE, '.shots-comms-convo');
const MSGS = (process.env.SKYNET_SHOT_MSGS || 'can you take a look at the website and see why it loads so slow|yeah go for it|nice. can you also add a newsletter signup|below|perfect thanks|nope thats it|one more — what files are in the project?').split('|');

async function waitUp(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.ok) return; } catch (_) {} await sleep(400); }
  throw new Error('seed never came up at ' + url);
}

async function shootPanel(cdp, name) {
  const r = await evalJS(cdp, `(() => { const b = document.getElementById('chat-panel').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 2 } });
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, `${LABEL}-${name}.png`);
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  console.log('  shot', path);
}

const SEND = (m) => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const inp = document.getElementById('chat-input');
  inp.focus(); inp.value = ${JSON.stringify(m)}; inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  for (let i = 0; i < 60; i++) { await sleep(250); if (!document.querySelector('#comms-presence:not(.resolved)') && document.querySelector('#comms-presence.resolved, .cmsg.agent')) break; }
  await sleep(500);
  return document.querySelectorAll('#chat-log > *').length;
})()`;

// every prose turn: does its stamp rect intersect any text line of its body?
const OVERLAP = `(() => {
  const out = []; let worst = 0;
  for (const m of document.querySelectorAll('#chat-log .cmsg.agent, #chat-log .cmsg.user')) {
    const ts = m.querySelector('.cmsg-ts'); const body = m.querySelector('.body'); if (!ts || !body) continue;
    const a = ts.getBoundingClientRect(); if (!a.width) continue;
    const range = document.createRange(); range.selectNodeContents(body);
    for (const b of range.getClientRects()) {
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > 0.5 && iy > 0.5) { worst = Math.max(worst, ix * iy); out.push(ts.textContent); break; }
    }
  }
  return { overlaps: out.length, worst: Math.round(worst), stamps: [...document.querySelectorAll('#chat-log .cmsg-ts')].map(e => e.textContent).slice(0, 4) };
})()`;

(async () => {
  const seed = spawn(process.execPath, [join(HERE, 'seed-comms-convo.js')], { env: Object.assign({}, process.env, { SKYNET_PORT: PORT }), stdio: 'ignore' });
  let chrome;
  try {
    await waitUp(URL);
    const profile = mkdtempSync(join(tmpdir(), 'comms-convo-'));
    chrome = launchChrome({ cdpPort: CDP_PORT, profileDir: profile }).proc;
    const cdp = await connectCDP(CDP_PORT);
    const diag = collectDiagnostics(cdp);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: URL });
    for (let i = 0; i < 80; i++) { await sleep(250); try { if (await evalJS(cdp, `!!document.getElementById('chat-input') && !!window.Chat`)) break; } catch (_) {} }
    await sleep(2500);
    // object = capability: a seeded station has no props, so fs tools come back withheld — present a cabinet to /api/run
    await evalJS(cdp, `(() => { const f = window.fetch; window.fetch = (u, o) => { try { if (String(u).indexOf('/api/run') >= 0 && o && typeof o.body === 'string') { const b = JSON.parse(o.body); b.placed = Array.from(new Set([].concat(b.placed || [], ['cabinet']))); o = Object.assign({}, o, { body: JSON.stringify(b) }); } } catch (_) {} return f(u, o); }; return 1; })()`);
    for (const m of MSGS) console.log('  sent →', await evalJS(cdp, SEND(m)), 'rows');
    await sleep(800);
    await evalJS(cdp, `(() => { const l = document.getElementById('chat-log'); l.scrollTop = 0; })()`);
    await sleep(300); await shootPanel(cdp, 'top');
    console.log('  pill', JSON.stringify(await evalJS(cdp, `(() => { const p = document.querySelector('.comms-newpill'); if (!p) return null; const c = getComputedStyle(p); return { cls: p.className, text: p.textContent, color: c.color, op: c.opacity, fill: c.webkitTextFillColor, fs: c.fontSize, ti: c.textIndent, ls: c.letterSpacing, ov: c.overflow, w: Math.round(p.getBoundingClientRect().width) }; })()`)));
    await evalJS(cdp, `(() => { const l = document.getElementById('chat-log'); l.scrollTop = l.scrollHeight; })()`);
    await sleep(300); await shootPanel(cdp, 'bottom');
    console.log('  stamps', JSON.stringify(await evalJS(cdp, OVERLAP)));
    console.log('  order', JSON.stringify(await evalJS(cdp, `[...document.querySelectorAll('#chat-log > *')].slice(-8).map(e => e.className.replace('cmsg ', '') + ':' + (e.textContent || '').trim().slice(0, 28))`)));
    await evalJS(cdp, `(() => { const c = [...document.querySelectorAll('#chat-log .comms-presence.resolved.has-fold')].pop(); if (c) c.click(); const l = document.getElementById('chat-log'); l.scrollTop = l.scrollHeight; return !!c; })()`);
    await sleep(400); await shootPanel(cdp, 'fold-open');
    await evalJS(cdp, `(() => { const c = [...document.querySelectorAll('#chat-log .comms-presence.resolved.open')].pop(); if (c) c.click(); return 1; })()`);
    // narrow: drag-resize floor is 300px; set the var the seam writes
    await evalJS(cdp, `(() => { document.getElementById('screen-game').style.setProperty('--chat-w', '340px'); return 1; })()`);
    await sleep(500);
    await evalJS(cdp, `(() => { const l = document.getElementById('chat-log'); l.scrollTop = l.scrollHeight; })()`);
    await sleep(300); await shootPanel(cdp, 'narrow');
    console.log('  narrow stamps', JSON.stringify(await evalJS(cdp, OVERLAP)));
    // RELOAD: the history-replay path must read the same as the live transcript
    await evalJS(cdp, `(() => { document.getElementById('screen-game').style.removeProperty('--chat-w'); location.reload(); return 1; })()`);
    for (let i = 0; i < 80; i++) { await sleep(250); try { if (await evalJS(cdp, `document.querySelectorAll('#chat-log .cmsg.user').length > 0`)) break; } catch (_) {} }
    await sleep(1500);
    await evalJS(cdp, `(() => { const l = document.getElementById('chat-log'); l.scrollTop = 0; })()`);
    await sleep(300); await shootPanel(cdp, 'reload-top');
    console.log('  reload order', JSON.stringify(await evalJS(cdp, `[...document.querySelectorAll('#chat-log > *')].slice(0, 6).map(e => e.className.replace('cmsg ', '') + ':' + (e.textContent || '').trim().slice(0, 24))`)));
    if (diag.exceptions.length) console.log('  EXCEPTIONS', diag.exceptions);
  } finally {
    try { chrome && chrome.kill(); } catch (_) {}
    try { seed.kill(); } catch (_) {}
    setTimeout(() => process.exit(0), 300);
  }
})().catch(e => { console.error(e); process.exit(1); });
