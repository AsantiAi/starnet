/* node test/browser-view.test.js — the BROWSER window's live side (sidecar/browser-view.js), with fake browser
   sessions and an injected clock. Proves:
     - what the Commander types becomes an http(s) address, a loopback address, a search, or a refusal;
     - a run is listed ONLY while its session really has a page open; its picture is frames-only (no input path);
     - while a handoff is live on a run the view steps aside and never stops the handoff's stream;
     - the Commander's own session opens on a typed address, takes sanitized input, goes back/forward/reload,
       and closes itself when idle; a stream nobody watches stops. */
'use strict';
const A = require('./_assert.js');
const { makeBrowserViews, resolveAddress } = require('../sidecar/browser-view.js');

// ---- a manual clock + timers ----
function clock() {
  let t = 1000, seq = 0; const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: id => { timers.delete(id); },
    advance(ms) { t += ms; for (const [id, x] of Array.from(timers)) if (x.at <= t) { timers.delete(id); x.fn(); } },
    pending: () => timers.size
  };
}
function fakeSession() {
  const s = { open: false, url: '', stops: 0, starts: 0, inputs: [], navs: [], closed: 0, handler: null, remembered: false };
  s.api = {
    handoffSurface() {
      if (!s.open) throw new Error('no browser page is open');
      return {
        startStream: fn => { s.starts++; s.handler = fn; fn({ data: 'frame-' + s.starts, mime: 'image/jpeg', width: 1440, height: 900 }); return Promise.resolve(true); },
        stopStream: () => { s.stops++; s.handler = null; return Promise.resolve(true); },
        input: ev => { s.inputs.push(ev); return Promise.resolve(true); },
        pageInfo: () => Promise.resolve({ url: s.url, title: 'T:' + s.url }),
        remembered: s.remembered
      };
    },
    waitForProfile: async () => {},
    navigate: async (url, opts) => { if (/blocked/.test(url)) throw new Error('refusing private address'); s.navs.push([url, !!(opts && opts.local)]); s.open = true; s.url = url; return url; },
    back: async () => { s.navs.push(['back']); },
    forward: async () => { s.navs.push(['forward']); },
    close: async () => { s.closed++; s.open = false; }
  };
  return s;
}

(async () => {
  // ---- the address bar ----
  const R = resolveAddress;
  A.eq(R('github.com').url, 'https://github.com/', 'a bare host gets https');
  A.eq(R('https://example.com/a?b=1').url, 'https://example.com/a?b=1', 'a full address is kept');
  A.eq(R('http://example.com').url, 'http://example.com/', 'http is allowed');
  A.eq(R('localhost:3000').url, 'http://localhost:3000/', 'a dev server gets http');
  A.eq(R('localhost:3000').local, true, 'loopback is marked local');
  A.eq(R('127.0.0.1:8787/x').url, 'http://127.0.0.1:8787/x', 'a loopback ip with a port');
  A.eq(R('example.com:8080/x').url, 'https://example.com:8080/x', 'host:port is not mistaken for a scheme');
  A.eq(R('example.com').local, false, 'a public host is not local');
  A.ok(R('how to center a div').search && /duckduckgo\.com\/\?q=how%20to%20center%20a%20div$/.test(R('how to center a div').url), 'words become a search');
  A.ok(R('github').search, 'a single word is a search, not a broken address');
  A.eq(R('javascript:alert(1)').ok, false, 'javascript: is refused');
  A.eq(R('file:///c:/secret.txt').ok, false, 'file: is refused');
  A.eq(R('chrome://settings').ok, false, 'chrome: is refused');
  A.eq(R('   ').ok, false, 'an empty address is refused');
  A.eq(R('x'.repeat(2100)).ok, false, 'an absurd address is refused');

  // ---- watching a run ----
  {
    const clk = clock(); let handoff = false; const made = [];
    const views = makeBrowserViews({ now: clk.now, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout, handoffLive: () => handoff,
      makeCommanderSession: () => { const s = fakeSession(); made.push(s); return s.api; } });
    const run = fakeSession();
    views.registerRun({ agentId: 'nova', runId: 'r1', session: run.api });
    A.eq(views.list().agents.length, 0, 'a run with no page open is NOT listed');
    A.eq((await views.frame('run:r1', 0, 0)).code, 'closed', '…and has no picture');
    run.open = true; run.url = 'https://example.com/';
    A.eq(views.list().agents[0].target, 'run:r1', 'once it has a page it is listed');
    const f1 = await views.frame('run:r1', 0, 0);
    A.ok(f1.ok && f1.frame && f1.frame.seq === 1 && f1.frame.data === 'frame-1', 'the first ask starts the capture and returns a frame');
    A.eq(f1.page.url, 'https://example.com/', 'the picture carries where the page is');
    A.eq(run.starts, 1, 'one stream');
    const f2 = await views.frame('run:r1', 1, 0);
    A.ok(f2.ok && f2.frame === null, 'nothing new → no frame (never a resend)');
    run.handler({ data: 'frame-x', width: 1440, height: 900 });
    A.eq((await views.frame('run:r1', 1, 0)).frame.seq, 2, 'a new picture arrives');
    A.eq(run.starts, 1, 'still one stream');
    A.eq((await views.input({ type: 'text', text: 'hi' })).ok, false, 'there is NO input path to a run (no commander page open)');
    A.eq(run.inputs.length, 0, 'the run\'s browser received nothing');

    // a handoff takes the browser's one stream: the view steps aside and never stops it
    handoff = true;
    const stopsBefore = run.stops;
    A.eq((await views.frame('run:r1', 2, 0)).code, 'handoff', 'a live handoff → the view refuses, naming STEP-IN');
    A.eq(run.stops, stopsBefore, '…without stopping the handoff\'s stream');
    A.eq(views.list().agents[0].handoff, true, 'the list says this agent is waiting in STEP-IN');
    handoff = false;
    A.ok((await views.frame('run:r1', 0, 0)).ok, 'after the handoff the picture comes back');
    A.eq(run.starts, 2, 'on a fresh stream');

    // a long-poll on a still page IS somebody watching: the idle clock must not run underneath it
    {
      const stopsNow = run.stops;
      const pending = views.frame('run:r1', 99, 12000);   // nothing newer than seq 99 will arrive
      await new Promise(r => setImmediate(r));
      clk.advance(7000);                                   // past the idle window, mid-poll
      A.eq(run.stops, stopsNow, 'a still page being long-polled keeps its stream');
      clk.advance(6000);                                   // the poll's own 12s budget runs out
      const late = await pending;
      A.ok(late.ok && late.frame === null, '…and the poll ends empty-handed, not with "closed"');
    }
    // nobody watching → the capture stops
    clk.advance(7000);
    A.eq(run.stops, stopsBefore + 1, 'an unwatched stream stops itself');
    // the run ends
    A.ok((await views.frame('run:r1', 0, 0)).ok, 'watch again');
    const stops2 = run.stops;
    views.unregisterRun('r1');
    A.eq(run.stops, stops2, 'a run that is ending is forgotten WITHOUT reaching into its closing browser');
    A.eq((await views.frame('run:r1', 0, 0)).code, 'ended', 'an ended run has no picture');
    A.eq(views.list().agents.length, 0, 'and is no longer listed');
  }

  // ---- the Commander's own browser ----
  {
    const clk = clock(); const made = [];
    const views = makeBrowserViews({ now: clk.now, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout,
      makeCommanderSession: () => { const s = fakeSession(); made.push(s); return s.api; } });
    A.eq(views.list().commander.open, false, 'no browser until an address is typed');
    A.eq((await views.nav('back')).ok, false, 'nothing to go back in');
    const o = await views.open('example.com');
    A.ok(o.ok && o.url === 'https://example.com/', 'a typed address opens');
    A.eq(made.length, 1, 'one session');
    A.eq(views.list().commander.open, true, 'listed as open');
    A.eq(views.list().commander.remembered, false, 'a temporary profile is reported as not remembered');
    const f = await views.frame('commander', 0, 0);
    A.ok(f.ok && f.frame.seq === 1, 'its picture streams');
    A.ok((await views.input({ type: 'text', text: 'hello' })).ok, 'typed text is forwarded');
    A.eq(made[0].inputs[0].text, 'hello', '…to the Commander\'s own browser');
    A.eq((await views.input({ type: 'nonsense' })).ok, false, 'an unknown input event is refused');
    await views.open('localhost:5173');
    A.eq(made.length, 1, 'a second address reuses the session');
    A.eq(made[0].navs[made[0].navs.length - 1][1], true, 'a loopback address opens in local mode');
    A.ok((await views.nav('back')).ok && (await views.nav('forward')).ok, 'back and forward');
    A.ok((await views.nav('reload')).ok, 'reload re-opens the current address');
    A.eq((await views.nav('explode')).ok, false, 'an unknown action is refused');
    const bad = await views.open('javascript:alert(1)');
    A.eq(bad.ok, false, 'a refused address never reaches the browser');
    // a navigation the browser refuses on a fresh session leaves nothing open
    const clk2 = clock(); const made2 = [];
    const v2 = makeBrowserViews({ now: clk2.now, setTimeout: clk2.setTimeout, clearTimeout: clk2.clearTimeout, makeCommanderSession: () => { const s = fakeSession(); made2.push(s); return s.api; } });
    const refused = await v2.open('https://blocked.example/');
    A.ok(!refused.ok && /private address/.test(refused.error), 'the browser\'s own refusal is reported in its words');
    A.eq(made2[0].closed, 1, '…and the blank session is closed, not left running');
    A.eq(v2.list().commander.open, false, 'nothing is listed as open');
    // idle close
    clk.advance(10 * 60 * 1000 + 1);
    await new Promise(r => setImmediate(r));
    A.eq(made[0].closed, 1, 'the Commander\'s browser closes itself after ten idle minutes');
    A.eq(views.list().commander.open, false, 'and is no longer open');
    A.eq((await views.frame('commander', 0, 0)).code, 'closed', 'no picture after it closed');
    // explicit close
    await views.open('example.com');
    await views.close();
    A.eq(made[1].closed, 1, 'closing the window closes the browser');
  }

  // ---- a station with no browser of its own ----
  {
    const clk = clock();
    const views = makeBrowserViews({ now: clk.now, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout });
    A.eq((await views.open('example.com')).ok, false, 'no session factory → an honest refusal');
    A.eq(views.list().commander.available, false, 'and the list says it is unavailable');
    let threw = false; try { makeBrowserViews({}); } catch (_) { threw = true; }
    A.ok(threw, 'the clock must be injected');
  }

  A.report('browser-view.test');
})().catch(e => { console.log('FAIL: browser-view.test threw - ' + (e && e.stack || e)); process.exit(1); });
