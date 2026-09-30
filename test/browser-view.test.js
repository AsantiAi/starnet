/* node test/browser-view.test.js — THE STATION BROWSER (sidecar/browser-view.js): one built-in browser the Commander
   and the agents share. Fake browser sessions, injected clock. Proves:
     - what the Commander types becomes an http(s) address, a loopback address, a search, or a refusal;
     - an INTERACTIVE run drives the station browser (the same session the Commander opened, page intact), refs die
       and downloads re-point as it changes hands, and it STAYS OPEN when the run ends;
     - one driver at a time: while a run drives, the Commander's address/clicks/keys are refused; a second run and
       every unattended run get a private browser (null);
     - the picture streams to the window during and after a run, steps aside for a STEP-IN handoff without stopping
       its stream, survives a long-poll on a still page, and stops when nobody watches;
     - the profile lease is yielded to another run only when nobody is driving or watching; it closes when idle. */
'use strict';
const A = require('./_assert.js');
const { makeBrowserViews, resolveAddress } = require('../sidecar/browser-view.js');

function clock() {
  let t = 1000, seq = 0; const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: id => { timers.delete(id); },
    advance(ms) { t += ms; for (const [id, x] of Array.from(timers)) if (x.at <= t) { timers.delete(id); x.fn(); } }
  };
}
function fakeSession() {
  const s = { open: false, url: '', stops: 0, starts: 0, inputs: [], navs: [], closed: 0, handler: null, remembered: true, hands: [] };
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
    handTo: async info => { s.hands.push(info); },
    waitForProfile: async () => {},
    navigate: async (url, opts) => { if (/blocked/.test(url)) throw new Error('refusing private address'); s.navs.push([url, !!(opts && opts.local)]); s.open = true; s.url = url; return url; },
    back: async () => { s.navs.push(['back']); },
    forward: async () => { s.navs.push(['forward']); },
    close: async () => { s.closed++; s.open = false; }
  };
  return s;
}
const tick = () => new Promise(r => setImmediate(r));
function rig(extra) {
  const clk = clock(); const made = []; const attended = { prompt: undefined }; const ho = { live: false };
  const views = makeBrowserViews(Object.assign({ now: clk.now, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout, attended,
    handoffLive: () => ho.live, downloadDirFor: a => '/ws/' + a + '/downloads',
    makeStationSession: () => { const s = fakeSession(); made.push(s); return s.api; } }, extra || {}));
  return { clk, made, attended, ho, views };
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

  // ---- ONE browser: the Commander opens a page, the agent sees THAT page, and it stays after the run ----
  {
    const { clk, made, attended, views } = rig();
    A.eq(views.list().station.open, false, 'no browser until somebody uses it');
    const o = await views.open('google.com');
    A.ok(o.ok && o.url === 'https://google.com/', 'the Commander opens a page');
    A.eq(o.remembered, true, 'on the durable profile: sign-ins are remembered (the session says so)');
    A.eq(views.list().station.open, true, 'the station browser is open');
    A.eq(views.list().station.driver, null, 'nobody is driving: it is the Commander\'s');

    const prompt = () => 'ask';
    const sess = views.sessionForRun({ agentId: 'nova', runId: 'r1', interactive: true, loginPrompt: prompt });
    A.ok(!!sess, 'an interactive run is given the station browser');
    // a run that has not browsed yet is NOT the driver: the Commander keeps their browser
    A.eq(views.list().station.driver, null, 'a run that has not touched the browser is not "driving"');
    A.ok((await views.input({ type: 'text', text: 'still mine' })).ok, '…so the Commander can keep using it while the agent thinks');
    A.eq(made[0].hands.length, 0, 'and nothing has changed hands');
    made[0].inputs.length = 0;
    // its first real browser call takes the wheel
    const seen = await sess.handoffSurface().pageInfo();
    A.eq(views.list().station.driver, null, 'asking a passive question (where is the page?) does not take the wheel either');
    A.eq(seen.url, 'https://google.com/', 'THE page the Commander opened is what the agent browser has');
    await sess.back();
    A.eq(made.length, 1, 'no second browser was created: it is the same one');
    A.eq(made[0].navs[made[0].navs.length - 1][0], 'back', 'the agent call reached the shared browser');
    A.eq(made[0].hands.length, 1, 'taking the wheel kills the old refs (handTo)');
    A.eq(made[0].hands[0].downloadDir, '/ws/nova/downloads', '…and re-points downloads at the driving agent\'s jail');
    A.ok(attended.prompt === prompt, 'browser.login asks through the DRIVING run\'s consent channel');
    A.eq(views.list().station.driver.agentId, 'nova', 'the list says who is driving');

    // one driver at a time
    A.eq((await views.open('example.com')).code, 'driving', 'while the agent drives, a typed address is refused');
    A.eq((await views.input({ type: 'text', text: 'x' })).code, 'driving', '…and so are the Commander\'s keys');
    A.eq((await views.nav('back')).code, 'driving', '…and back/forward');
    A.eq(made[0].inputs.length, 0, 'nothing reached the page');
    const second = views.sessionForRun({ agentId: 'kira', runId: 'r2', interactive: true });
    let busyErr = ''; try { await second.navigate('https://example.org/'); } catch (e) { busyErr = e.message; }
    A.ok(/in use by another run/.test(busyErr), 'a second run cannot drive it while another is: it is told so');
    A.eq(made[0].url, 'https://google.com/', '…and the page did not move');
    A.eq(views.sessionForRun({ agentId: 'nova', runId: 'r3', interactive: false }), null, 'an unattended run never gets the station browser (it uses a private one)');
    A.eq((await views.close()).ok, false, 'it cannot be closed under a driving run');

    // the agent navigates; the Commander watches it live
    await sess.navigate('https://youtube.com/');
    const f1 = await views.frame('station', 0, 0);
    A.ok(f1.ok && f1.frame && f1.frame.seq === 1, 'the picture streams while the agent drives');
    A.eq(f1.page.url, 'https://youtube.com/', 'the address is where the agent took it');
    A.eq(f1.driver.agentId, 'nova', 'each picture says who is driving');

    // the run ends: the browser STAYS
    A.eq(views.releaseRun('r2'), false, 'a run that never drove it releases nothing');
    A.eq(views.releaseRun('r1'), true, 'the driving run releases it');
    A.eq(made[0].closed, 0, 'the browser is NOT closed when the run ends');
    A.eq(views.list().station.open, true, 'it is still open');
    A.eq(views.list().station.driver, null, 'and nobody is driving');
    A.eq(attended.prompt, undefined, 'the ended run\'s consent channel is gone');
    const f2 = await views.frame('station', 0, 0);
    A.ok(f2.ok && f2.page.url === 'https://youtube.com/', 'after the run the Commander still sees what the agent opened');
    A.eq(f2.driver, null, 'with nobody driving');

    // now the Commander drives it
    A.ok((await views.input({ type: 'text', text: 'hello' })).ok, 'the Commander types into the same page');
    A.eq(made[0].inputs[0].text, 'hello', 'it reached the page');
    A.eq((await views.input({ type: 'nonsense' })).ok, false, 'an unknown input event is refused');
    await views.open('localhost:5173');
    A.eq(made[0].navs[made[0].navs.length - 1][1], true, 'a loopback address opens in local mode');
    A.ok((await views.nav('back')).ok && (await views.nav('forward')).ok && (await views.nav('reload')).ok, 'back, forward, reload');
    A.eq((await views.nav('explode')).ok, false, 'an unknown action is refused');
    A.eq((await views.open('javascript:alert(1)')).ok, false, 'a refused address never reaches the browser');

    // the next run takes it again: refs die again (the Commander changed the page)
    await views.sessionForRun({ agentId: 'kira', runId: 'r4', interactive: true }).forward();
    A.eq(made[0].hands.length, 2, 'every change of hands kills refs');
    A.eq(made[0].hands[1].downloadDir, '/ws/kira/downloads', 'downloads follow the agent now driving');
    views.releaseRun('r4');
    void clk;
  }

  // ---- an agent uses the browser first (nothing open): the run creates it, and it stays for the Commander ----
  {
    const { made, views } = rig();
    const sess = views.sessionForRun({ agentId: 'nova', runId: 'r1', interactive: true });
    A.eq(views.list().station.open, false, 'not "open" until the agent actually opens a page (truth, not intent)');
    await sess.navigate('https://youtube.com/');
    A.eq(made.length, 1, 'the first browser call of the agent opens the station browser');
    A.eq(views.list().station.open, true, 'open once it has a page');
    A.eq(views.list().station.driver.agentId, 'nova', 'and the agent is driving');
    views.releaseRun('r1');
    const f = await views.frame('station', 0, 0);
    A.ok(f.ok && f.page.url === 'https://youtube.com/', 'the Commander opens the window after the run and YouTube is there');
  }

  // ---- STEP-IN, streaming and idleness ----
  {
    const { clk, made, ho, views } = rig();
    await views.open('example.com');
    await views.sessionForRun({ agentId: 'nova', runId: 'r1', interactive: true }).forward();
    A.ok((await views.frame('station', 0, 0)).ok, 'watching');
    const stops = made[0].stops;
    ho.live = true;
    A.eq((await views.frame('station', 1, 0)).code, 'handoff', 'a live handoff → the view refuses, naming STEP-IN');
    A.eq(made[0].stops, stops, '…without stopping the handoff\'s stream');
    A.eq(views.list().station.handoff, true, 'the list says the agent is waiting in STEP-IN');
    ho.live = false;
    A.ok((await views.frame('station', 0, 0)).ok, 'after the handoff the picture comes back');
    // a long-poll on a still page IS somebody watching
    const stopsNow = made[0].stops;
    const pending = views.frame('station', 99, 12000);
    await tick();
    clk.advance(7000);
    A.eq(made[0].stops, stopsNow, 'a still page being long-polled keeps its stream');
    clk.advance(6000);
    const late = await pending;
    A.ok(late.ok && late.frame === null, '…and the poll ends empty-handed, not with "closed"');
    clk.advance(7000);
    A.eq(made[0].stops, stopsNow + 1, 'an unwatched stream stops itself');
    // idle: never while a run drives
    clk.advance(11 * 60 * 1000); await tick();
    A.eq(made[0].closed, 0, 'a driven browser never idles out');
    views.releaseRun('r1');
    clk.advance(10 * 60 * 1000 + 1); await tick();
    A.eq(made[0].closed, 1, 'ten minutes with nobody driving or watching → it closes');
    A.eq(views.list().station.open, false, 'and is no longer open');
    A.eq((await views.frame('station', 0, 0)).code, 'closed', 'no picture after it closed');
  }

  // ---- the profile lease yields to another run only when nobody is driving or watching ----
  {
    const { clk, made, views } = rig();
    A.eq(views.yieldProfile(), false, 'nothing to yield when no browser is open');
    await views.open('example.com');
    await views.frame('station', 0, 0);
    A.eq(views.yieldProfile(), false, 'somebody is watching: it keeps the profile');
    clk.advance(16000);
    await views.sessionForRun({ agentId: 'nova', runId: 'r1', interactive: true }).forward();
    A.eq(views.yieldProfile(), false, 'a run is driving: it keeps the profile');
    views.releaseRun('r1');
    A.eq(views.yieldProfile(), true, 'idle and unwatched: it gives the profile up');
    await tick();
    A.eq(made[0].closed, 1, '…by closing, which releases the lease');
    A.eq(views.list().station.open, false, 'closed');
  }

  // ---- a navigation the browser refuses on a fresh session leaves nothing open ----
  {
    const { made, views } = rig();
    const refused = await views.open('https://blocked.example/');
    A.ok(!refused.ok && /private address/.test(refused.error), 'the browser\'s own refusal is reported in its words');
    A.eq(made[0].closed, 1, '…and the blank session is closed, not left holding the profile');
  }

  // ---- a PRIVATE per-run browser (unattended, or the station one was busy) can still be watched ----
  {
    const { views, ho } = rig();
    const run = fakeSession();
    views.registerRun({ agentId: 'kira', runId: 'p1', session: run.api });
    A.eq(views.list().agents.length, 0, 'a private run with no page open is NOT listed');
    run.open = true; run.url = 'https://example.com/';
    A.eq(views.list().agents[0].target, 'run:p1', 'once it has a page it is listed');
    A.ok((await views.frame('run:p1', 0, 0)).ok, 'its picture streams');
    ho.live = true;
    A.eq((await views.frame('run:p1', 1, 0)).code, 'handoff', 'a handoff on it → STEP-IN');
    ho.live = false;
    const stops = run.stops;
    views.unregisterRun('p1');
    A.eq(run.stops, stops, 'an ending run is forgotten WITHOUT reaching into its closing browser');
    A.eq((await views.frame('run:p1', 0, 0)).code, 'ended', 'an ended run has no picture');
    A.eq(run.inputs.length, 0, 'a private run\'s browser never received Commander input');
  }

  // ---- a station with no browser of its own ----
  {
    const clk = clock();
    const views = makeBrowserViews({ now: clk.now, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout });
    A.eq((await views.open('example.com')).ok, false, 'no session factory → an honest refusal');
    A.eq(views.list().station.available, false, 'and the list says it is unavailable');
    A.eq(views.sessionForRun({ agentId: 'a', runId: 'r', interactive: true }), null, 'runs fall back to private browsers');
    let threw = false; try { makeBrowserViews({}); } catch (_) { threw = true; }
    A.ok(threw, 'the clock must be injected');
  }

  A.report('browser-view.test');
})().catch(e => { console.log('FAIL: browser-view.test threw - ' + (e && e.stack || e)); process.exit(1); });
