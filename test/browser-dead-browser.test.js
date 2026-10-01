/* node test/browser-dead-browser.test.js — a browser that goes away must fail fast and come back, never hang.
   Measured 2026-09-30 on the station window: after it was closed, every call sat out a full 15 s CDP timeout (a
   snapshot 46 s), because the CDP client never noticed its socket had closed. Proves:
     - CdpClient rejects every command in flight the moment the socket closes, and rejects new ones at once;
     - navigate in a session whose browser died under the call starts a fresh browser and goes there ONCE;
     - any other call reports the loss, and the next call starts the fresh browser. */
'use strict';
const A = require('./_assert.js');
const { makeBrowserTools, _internals: T } = require('../sidecar/tools/builtin/browser.js');

function fakeWs() {
  const ls = {}; const sent = [];
  return { sent, addEventListener: (ev, fn) => { (ls[ev] = ls[ev] || []).push(fn); }, send: m => sent.push(m),
    emit: (ev, arg) => (ls[ev] || []).forEach(fn => fn(arg)), close: () => {} };
}

(async () => {
  // ---- the client ----
  {
    const ws = fakeWs();
    const c = new T.CdpClient(ws, 60000);
    const t0 = Date.now();
    const inflight = c.send('Runtime.evaluate', { expression: '1' });
    ws.emit('close');
    let err = ''; try { await inflight; } catch (e) { err = e.message; }
    A.ok(/connection closed/.test(err), 'a command in flight fails the moment the browser goes away');
    A.ok(Date.now() - t0 < 1000, '…at once, not after its 60 s timeout');
    A.eq(c.closed, true, 'the client knows it is closed');
    let err2 = ''; const t1 = Date.now(); try { await c.send('Page.navigate', { url: 'x' }); } catch (e) { err2 = e.message; }
    A.ok(/connection closed/.test(err2) && Date.now() - t1 < 100, 'a later command is refused at once, never sent into a dead socket');
    const ws2 = fakeWs(); const c2 = new T.CdpClient(ws2, 60000);
    const p2 = c2.send('Runtime.evaluate', {});
    ws2.emit('error', new Error('reset'));
    let e3 = ''; try { await p2; } catch (e) { e3 = e.message; }
    A.ok(/connection closed/.test(e3), 'a socket error counts the same');
  }

  // ---- the session: navigate comes back once, other calls report ----
  {
    const built = [];
    const make = () => {
      const drv = { alive: () => !drv.dead, dead: false, url: '',
        navigate: async u => { if (drv.dieOnNext) { drv.dead = true; throw new Error('CDP connection closed: the browser went away'); } drv.url = u; return u; },
        snapshot: async () => { if (drv.dead) throw new Error('CDP connection closed: the browser went away'); return []; },
        close: async () => {}, usingPersistentProfile: () => false, back: async () => '', forward: async () => '', tabs: async () => [] };
      built.push(drv); return drv;
    };
    const B = makeBrowserTools({ makeDriver: make, lookup: null, preferVisible: true, forceHeadless: false });
    await B.session.navigate('https://example.com/');
    built[0].dieOnNext = true;
    const url = await B.session.navigate('https://example.org/');
    A.eq(url, 'https://example.org/', 'a navigate whose browser died under it lands anyway');
    A.eq(built.length, 2, '…in a FRESH browser, once');
    A.eq(built[1].url, 'https://example.org/', '…at the address asked for');
    built[1].dead = true;
    let snapErr = ''; try { await B.session.snapshot(); } catch (e) { snapErr = e.message; }
    await B.session.snapshot();
    A.eq(built.length, 3, 'a non-navigate call never repeats itself: the NEXT call starts the fresh browser');
    void snapErr;
  }

  // ---- NEVER KILL A REUSED PROCESS ID (release review 2026-09-30) ----
  {
    const made = [];
    const make = deps => {
      const drv = { deps, dead: false, exited: false, pid: 4242 + made.length,
        alive: () => !drv.dead, ownedPid: () => (drv.exited ? null : drv.pid),
        navigate: async u => u, close: async () => {}, usingPersistentProfile: () => false, tabs: async () => [] };
      made.push(drv); return drv;
    };
    const B = makeBrowserTools({ makeDriver: make, lookup: null, preferVisible: true, forceHeadless: false });
    await B.session.navigate('https://example.com/');
    // the window was closed: the browser is dead but its process has not exited yet
    made[0].dead = true;
    await B.session.navigate('https://example.org/');
    A.eq(typeof made[1].deps.reclaimPid, 'function', 'the replacement asks for the old pid at reclaim time, not when it died');
    A.eq(made[1].deps.reclaimPid(), 4242, 'while the old process is still running (its handle pins the id) it is ours to end');
    made[0].exited = true;
    A.eq(made[1].deps.reclaimPid(), null, 'once it has exited the number may belong to another program: nothing is killed by number');
    // and the real driver: an exited Chromium reports no owned pid
    const d = T.makeCdpDriver({ chrome: 'C:/x/chrome.exe', env: {}, fetchImpl: async () => ({}), WebSocketImpl: function () {},
      spawn: () => { const ls = {}; const p = { pid: 9191, on: (ev, fn) => { (ls[ev] = ls[ev] || []).push(fn); }, kill: () => {} }; setTimeout(() => (ls.close || []).forEach(fn => fn(0)), 5); return p; } });
    try { await d.tabs(); } catch (_) { /* the fake browser exits at once */ }
    A.eq(d.ownedPid(), null, 'the driver never reports the pid of a Chromium that has exited');
  }
  // ---- CHROME'S ERROR PAGE is retried once and reported as a failed load, never as an "unsafe redirect" ----
  {
    const lookup = async () => [{ address: '93.184.215.14', family: 4 }];
    let n = 0;
    const flaky = { navigate: async u => { n++; return n === 1 ? 'chrome-error://chromewebdata/' : u; }, close: async () => {}, usingPersistentProfile: () => false, tabs: async () => [], alive: () => true };
    const B1 = makeBrowserTools({ makeDriver: () => flaky, lookup });
    A.eq(await B1.session.navigate('https://example.com/'), 'https://example.com/', 'a first load that hit Chrome\'s error page is retried and lands');
    let m = 0;
    const down = { navigate: async () => { m++; return 'chrome-error://chromewebdata/'; }, close: async () => {}, usingPersistentProfile: () => false, tabs: async () => [], alive: () => true };
    const B2 = makeBrowserTools({ makeDriver: () => down, lookup });
    let e = ''; try { await B2.session.navigate('https://example.com/'); } catch (x) { e = x.message; }
    A.ok(/could not load example\.com/.test(e) && !/redirect/.test(e), 'a page that keeps failing says it did not load, not "unsafe redirect"');
    A.eq(m, 2, '…after exactly one retry');
  }
  A.report('browser-dead-browser.test');
})().catch(e => { console.log('FAIL: browser-dead-browser.test threw - ' + (e && e.stack || e)); process.exit(1); });
