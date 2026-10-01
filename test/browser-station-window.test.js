/* node test/browser-station-window.test.js — the STATION browser is a real window the Commander uses
   (sidecar/tools/builtin/browser.js session options preferVisible + noAttach; sidecar/browser-view.js). Proves, with a
   makeDriver SEAM (so the session's own mode + revive logic really runs):
     - preferVisible launches it as a window whatever a call asks (a visible:false navigate, a local test page), and
       STARNET_BROWSER_HEADLESS still pins it hidden;
     - when the window is closed (the Chromium we started exits), the next call starts a fresh one on the same
       profile instead of failing against a dead socket — and the dead one is closed without deleting that profile;
     - a dead browser reads as "no page open" to the station (never a stale picture);
     - browser.attach is refused on the station browser;
   and in browser-view.js: a VISIBLE station browser never idles out; front() raises it; a hidden one cannot. */
'use strict';
const A = require('./_assert.js');
const { makeBrowserTools } = require('../sidecar/tools/builtin/browser.js');
const { makeBrowserViews } = require('../sidecar/browser-view.js');

function driverRig() {
  const built = [];
  const make = d => {
    const drv = { d, isAlive: true, closedWith: null, url: '',
      navigate: async u => { drv.url = u; return u; }, snapshot: async () => [], back: async () => '', forward: async () => '',
      getText: async () => 'text', tabs: async () => [], consoleLog: () => [], networkLog: () => [],
      usingPersistentProfile: () => false, streamStart: async () => true, streamStop: async () => true,
      humanInput: async () => true, pageInfo: async () => ({ url: drv.url, title: '' }), bringToFront: async () => { drv.fronted = (drv.fronted || 0) + 1; return true; },
      alive: () => drv.isAlive, close: async opts => { drv.closedWith = opts || {}; } };
    built.push(drv); return drv;
  };
  return { built, make };
}
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  const saved = process.env.STARNET_BROWSER_HEADLESS;
  delete process.env.STARNET_BROWSER_HEADLESS;
  try {
    // ---- a window, whatever a call asks ----
    {
      const r = driverRig();
      const B = makeBrowserTools({ makeDriver: r.make, lookup: null, preferVisible: true, forceHeadless: false, noAttach: true });
      await B.session.navigate('https://example.com/', { visible: false });
      A.eq(r.built[0].d.headed, true, 'the station browser launches as a real window even when a call asked visible:false');
      await B.session.navigate('http://127.0.0.1:5173/', { local: true });
      A.eq(r.built.length, 1, 'a local test page does not relaunch it headless');
      A.eq(B.session.handoffSurface().visible, true, 'the station reads it as visible');
      await B.session.handoffSurface().front();
      A.eq(r.built[0].fronted, 1, 'front() raises the real window');

      // ---- the Commander closes the window ----
      r.built[0].isAlive = false;
      let threw = false; try { B.session.handoffSurface(); } catch (_) { threw = true; }
      A.ok(threw, 'a closed window reads as "no page open" (never a stale picture)');
      await B.session.navigate('https://example.org/');
      await tick();
      A.eq(r.built.length, 2, 'the next call starts a FRESH browser instead of failing against the dead one');
      A.eq(r.built[1].d.headed, true, '…as a window again');
      A.eq(r.built[1].url, 'https://example.org/', '…and it does what was asked');
      A.eq(r.built[0].closedWith && r.built[0].closedWith.keepProfile, true, 'the dead one is closed WITHOUT deleting the profile its successor uses');
      A.eq(!!r.built[0].d.reclaimProfile, false, 'a first launch does not reclaim anything');
      A.eq(r.built[1].d.reclaimProfile, true, 'the revived one reclaims its profile first (the old Chromium may linger on it)');

      // ---- attach refused ----
      let attachErr = ''; try { await B.session.attach(9612); } catch (e) { attachErr = e.message; }
      A.ok(/not available here/.test(attachErr), 'browser.attach is refused on the station browser (it never becomes some other Chrome)');
      A.eq(r.built.length, 2, '…and nothing was relaunched');
    }
    // ---- the headless pin still wins ----
    {
      process.env.STARNET_BROWSER_HEADLESS = '1';
      const r = driverRig();
      const B = makeBrowserTools({ makeDriver: r.make, lookup: null, preferVisible: true, forceHeadless: false });
      await B.session.navigate('https://example.com/');
      A.eq(r.built[0].d.headed, false, 'STARNET_BROWSER_HEADLESS=1 keeps even the station browser hidden (CI, gates)');
      A.eq(B.session.handoffSurface().visible, false, 'and it reads as hidden');
      delete process.env.STARNET_BROWSER_HEADLESS;
    }
    // ---- a private run browser is untouched: headless, attach still available ----
    {
      const r = driverRig();
      const B = makeBrowserTools({ makeDriver: r.make, lookup: null, forceHeadless: true });
      await B.session.navigate('https://example.com/', { visible: true });
      A.eq(r.built[0].d.headed, false, 'a private run browser stays headless (host authority)');
    }

    // ---- browser-view: a visible station browser never idles out ----
    {
      let t = 1000, seqT = 0; const timers = new Map();
      const clk = { now: () => t, setTimeout: (fn, ms) => { const id = ++seqT; timers.set(id, { at: t + ms, fn }); return id; }, clearTimeout: id => timers.delete(id),
        advance(ms) { t += ms; for (const [id, x] of Array.from(timers)) if (x.at <= t) { timers.delete(id); x.fn(); } } };
      const mk = visible => {
        const st = { closed: 0, fronted: 0, open: false };
        st.api = { handoffSurface() { if (!st.open) throw new Error('none'); return { visible, front: async () => { st.fronted++; }, pageInfo: async () => ({ url: 'u', title: '' }), startStream: async () => true, stopStream: async () => true, input: async () => true, remembered: true }; },
          navigate: async u => { st.open = true; return u; }, waitForProfile: async () => {}, close: async () => { st.closed++; st.open = false; } };
        return st;
      };
      const w = mk(true);
      const V = makeBrowserViews({ now: clk.now, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout, makeStationSession: () => w.api });
      const o = await V.open('example.com');
      A.ok(o.ok && o.visible === true, 'a typed address opens in the real window');
      A.eq(w.fronted, 1, '…and raises it (they typed it: show it)');
      A.eq(V.list().station.visible, true, 'the list says the browser is a visible window');
      clk.advance(3 * 60 * 60 * 1000); await tick();
      A.eq(w.closed, 0, 'a visible station browser is still open after three hours untouched by the station');
      A.ok((await V.front()).ok && w.fronted === 2, 'front() raises it on request');

      const h = mk(false);
      const V2 = makeBrowserViews({ now: clk.now, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout, makeStationSession: () => h.api });
      await V2.open('example.com');
      A.eq((await V2.front()).ok, false, 'a hidden (pinned headless) browser cannot be raised, and says why');
      clk.advance(30 * 60 * 1000 + 1); await tick();
      A.eq(h.closed, 1, 'a hidden one still closes after half an hour unused');
    }
  } finally {
    if (saved === undefined) delete process.env.STARNET_BROWSER_HEADLESS; else process.env.STARNET_BROWSER_HEADLESS = saved;
  }
  A.report('browser-station-window.test');
})().catch(e => { console.log('FAIL: browser-station-window.test threw - ' + (e && e.stack || e)); process.exit(1); });
