/* node test/browserstream.keys.test.js — keyboard into the live BROWSER picture (frontend/app/browserstream.js).
   Release review 2026-09-30:
     - AltGr characters (@ { } € on German/French keyboards) arrive as Ctrl+Alt on Windows and were never sent as text,
       so an email address could not be typed into a sign-in page;
     - the picture captured Tab/Esc even while an agent drove (every key refused anyway): a keyboard trap;
     - F6 / Ctrl+L leave the page for the address bar, like any browser. */
'use strict';
const A = require('./_assert.js');
const BrowserStream = require('../frontend/app/browserstream.js');

function target() {
  const ls = {};
  return { ls, addEventListener: (ev, fn) => { (ls[ev] = ls[ev] || []).push(fn); }, focus: () => {},
    fire(ev, e) { (ls[ev] || []).forEach(fn => fn(e)); } };
}
function key(k, o) {
  o = o || {};
  const e = { key: k, code: o.code || '', keyCode: 0, ctrlKey: !!o.ctrl, altKey: !!o.alt, metaKey: false, shiftKey: !!o.shift,
    prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
    getModifierState: m => (m === 'AltGraph' ? !!o.altGraph : false) };
  return e;
}

(async () => {
  const vp = target(), img = target();
  const sent = [];
  let can = true, left = 0;
  const s = BrowserStream.create({ vp, img,
    poll: () => new Promise(() => {}),   // the picture never matters here
    send: evs => { sent.push(...evs); return Promise.resolve({ status: 200 }); },
    canType: () => can, onLeave: () => { left++; } });
  s.start();
  const lastDown = () => sent.filter(e => e.type === 'key' && e.action === 'down').slice(-1)[0];
  const tick = () => new Promise(r => setTimeout(r, 5));

  vp.fire('keydown', key('a')); await tick();
  A.eq(lastDown().text, 'a', 'a plain key is text');
  vp.fire('keydown', key('@', { ctrl: true, alt: true, altGraph: true, code: 'KeyQ' })); await tick();
  A.eq(lastDown().text, '@', 'AltGr+Q on a German keyboard sends "@" as TEXT');
  A.eq(lastDown().modifiers & 3, 0, '…without Ctrl/Alt modifiers (or the page would treat it as a shortcut)');
  vp.fire('keydown', key('€', { ctrl: true, alt: true, code: 'KeyE' })); await tick();
  A.eq(lastDown().text, '€', 'Ctrl+Alt reporting a symbol (no AltGraph state) is still text');
  vp.fire('keydown', key('@', { alt: true, code: 'KeyL' })); await tick();
  A.eq(lastDown().text, '@', 'macOS Option+L on a German Mac sends "@" as TEXT');
  A.eq(lastDown().modifiers & 1, 0, '…without the Option modifier');
  vp.fire('keydown', key('å', { alt: true, code: 'KeyA' })); await tick();
  A.eq(lastDown().text, 'å', 'Option+A (US Mac) types å');
  vp.fire('keydown', key('c', { ctrl: true, alt: true })); await tick();
  A.eq(lastDown().text, undefined, 'a real Ctrl+Alt+letter shortcut stays a key, not text');

  const tab = key('Tab'); vp.fire('keydown', tab); await tick();
  A.ok(tab.prevented && tab.stopped, 'while you can type, Tab goes to the page (sign-in forms need it)');
  can = false;
  const n = sent.length;
  const tab2 = key('Tab'); vp.fire('keydown', tab2);
  const esc = key('Escape'); vp.fire('keydown', esc); await tick();
  A.ok(!tab2.prevented && !tab2.stopped && !esc.prevented && !esc.stopped, 'while an agent drives, Tab and Esc are NOT trapped — they move on in the station');
  A.eq(sent.length, n, '…and nothing is sent');
  const f6 = key('F6'); vp.fire('keydown', f6);
  const ctrlL = key('l', { ctrl: true }); vp.fire('keydown', ctrlL);
  A.eq(left, 2, 'F6 and Ctrl+L leave the page for the address bar');
  can = true;
  const f6b = key('F6'); vp.fire('keydown', f6b);
  A.eq(left, 3, '…even while you are typing in the page');
  s.stop();
  A.report('browserstream.keys.test');
})().catch(e => { console.log('FAIL: browserstream.keys.test threw — ' + (e && e.stack || e)); process.exit(1); });
