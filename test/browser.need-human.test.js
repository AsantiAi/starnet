/* node test/browser.need-human.test.js — STEP-IN at the tool layer (sidecar/tools/builtin/browser.js).

   browser.need_human hands the agent's OWN live browser to the Commander through the handoff host and waits.
   Pinned here with an injected driver + the real host:
     · the FROZEN rule — while a handoff is live, every other browser tool (snapshot, get_text, screenshot, vision,
       console, click, test_*) is refused before it runs, so nothing is read off a page a human is typing into;
     · the stream + input reach the same driver the agent was using (no relaunch, same page);
     · hand back / can't do it / expiry each come back to the agent as a truthful, distinct result;
     · refs minted before the handoff die (the human changed the page);
     · the navigate hint names browser.need_human only when a handoff host is actually wired. */
'use strict';
const A = require('./_assert.js');
const { makeBrowserTools } = require('../sidecar/tools/builtin/browser.js');
const { makeHandoffHost } = require('../sidecar/browser-handoff.js');

function fakeDriver(opts) {
  opts = opts || {};
  const d = {
    url: 'about:blank', title: '', reads: 0, streaming: 0, stopped: 0, inputs: [], onFrame: null,
    navigate: async u => { d.url = u; d.title = 'Sign in'; return u; },
    snapshot: async () => { d.reads++; return [{ role: 'button', text: 'Sign in', x: 1, y: 1, w: 10, h: 10 }]; },
    click: async () => 'clicked', type: async () => 'typed', press: async () => 'pressed', scroll: async () => 's', back: async () => 'b',
    getText: async () => { d.reads++; return 'Welcome back, Andrew'; },
    consoleLog: async () => { d.reads++; return []; },
    handleDialog: async () => ({}),
    screenshot: async () => { d.reads++; return 'iVBORw0KGgo='; },
    challengeStatus: async () => ({ challenged: false, signal: null, title: d.title, authWall: opts.authWall || null, authSignal: opts.authWall ? 'a password field' : null }),
    usingPersistentProfile: () => opts.persistent === true,
    streamStart: async fn => { d.streaming++; d.onFrame = fn; fn({ data: '/9j/FRAME', width: 1440, height: 900 }); return true; },
    streamStop: async () => { d.stopped++; d.onFrame = null; return true; },
    humanInput: async ev => { d.inputs.push(ev); if (ev.type === 'key' && ev.key === 'Enter') { d.url = 'https://example.com/dashboard'; d.title = 'Dashboard'; } return true; },
    pageInfo: async () => ({ url: d.url, title: d.title })
  };
  return d;
}
const tick = () => new Promise(r => setImmediate(r));
async function until(fn, n) { for (let i = 0; i < (n || 200); i++) { if (fn()) return true; await tick(); } return false; }
function toolOf(B, name) { const t = B.tools.find(x => x.name === name); if (!t) throw new Error('missing tool ' + name); return t; }
async function runErr(tool, args) { try { await tool.run(args || {}, {}); return null; } catch (e) { return String(e && e.message || e); } }

(async () => {
  // The host unrefs its timers (a waiting handoff must never keep a shutting-down sidecar alive), so hold the
  // loop open for the real-time expiry case below.
  const keepAlive = setInterval(() => {}, 1000);
  // ---- no host: an honest refusal, and no hint advertising a door that is not there ----
  {
    const driver = fakeDriver({ authWall: 'login' });
    const B = makeBrowserTools({ driver, lookup: null });
    const nav = await toolOf(B, 'browser.navigate').run({ url: 'https://example.com/login' }, {});
    A.ok(!/need_human/.test(nav.content), 'without a handoff host the navigate result never names browser.need_human');
    const r = await toolOf(B, 'browser.need_human').run({ reason: 'login', note: 'sign in' }, {});
    A.ok(/not available in this run/.test(r.content), 'without a handoff host need_human says so plainly');
  }

  // ---- the full handoff: frozen → stream → input → hand back ----
  {
    const driver = fakeDriver({ authWall: 'login', persistent: true });
    const emitted = [];
    const host = makeHandoffHost({ emit: (n, p) => emitted.push(p) });
    let runSignal = new AbortController();
    const handoff = { request: f => host.request(Object.assign({ agentId: 'nova', runId: 'run-1' }, f)) };
    const B = makeBrowserTools({ driver, lookup: null, handoff });
    A.eq(toolOf(B, 'browser.need_human').scope, 'read', 'need_human is a read: the agent pauses, it changes nothing itself');
    A.ok(toolOf(B, 'browser.need_human').timeoutMs > 60 * 60 * 1000, 'its tool budget outlives a full 30-min wait + 30-min hold');

    // navigating to a page with no open browser: need_human refuses before any page exists
    const early = await runErr(toolOf(B, 'browser.need_human'), { reason: 'login', note: 'x' });
    A.ok(/navigate to the page/.test(early || ''), 'need_human with no page open asks the agent to open the page first: ' + early);

    const nav = await toolOf(B, 'browser.navigate').run({ url: 'https://example.com/login' }, {});
    A.ok(/browser\.need_human \{reason:"login"\}/.test(nav.content), 'a sign-in page names browser.need_human with the login reason');
    A.ok(/never type the Commander's credentials/.test(nav.content), 'and tells the agent it never types credentials');

    const snap = await toolOf(B, 'browser.snapshot').run({}, {});
    const oldRef = (snap.content.match(/^(b\d+) \[/m) || [])[1];
    A.ok(!!oldRef, 'a pre-handoff ref exists (' + oldRef + ')');
    const readsBefore = driver.reads;

    const pending = toolOf(B, 'browser.need_human').run({ reason: 'login', note: 'Sign in so I can read your dashboard' }, { signal: runSignal.signal });
    await until(() => host.list().live.length === 1);
    const live = host.list().live[0];
    A.eq(live.state, 'waiting', 'the handoff is waiting for the Commander');
    A.eq(live.where, 'example.com/login', 'it names where the agent is stuck');
    A.eq(live.note, 'Sign in so I can read your dashboard', 'it carries the agent\'s one-line ask');
    A.eq(live.remembered, true, 'on the durable profile the sign-in is marked remembered (truthful)');
    A.ok(B.session.frozen() === live.id, 'the session is frozen on this handoff id');

    // THE FROZEN RULE — every other browser tool is refused before it runs.
    for (const name of ['browser.snapshot', 'browser.get_text', 'browser.screenshot', 'browser.vision', 'browser.console', 'browser.find', 'browser.network', 'browser.test_snapshot', 'browser.test_state']) {
      const e = await runErr(toolOf(B, name), name === 'browser.find' ? { text: 'x' } : {});
      A.ok(/^FROZEN: the Commander holds this browser/.test(e || ''), name + ' is refused while the Commander holds the wheel: ' + e);
    }
    for (const [name, args] of [['browser.click', { ref: oldRef }], ['browser.type', { ref: oldRef, text: 'hunter2' }], ['browser.navigate', { url: 'https://example.com/' }], ['browser.press', { key: 'Enter' }]]) {
      const e = await runErr(toolOf(B, name), args);
      A.ok(/^FROZEN/.test(e || ''), name + ' cannot drive the page during a handoff');
    }
    A.eq(driver.reads, readsBefore, 'NOTHING was read off the page while frozen');
    const second = await runErr(toolOf(B, 'browser.need_human'), { reason: 'login', note: 'again' });
    A.ok(/already waiting/.test(second || ''), 'a second need_human in the same run is refused (one handoff per run)');

    // the Commander takes the wheel: the SAME driver streams and receives their input
    const tk = await host.take(live.id);
    A.ok(tk.ok, 'take the wheel');
    A.eq(driver.streaming, 1, 'the agent\'s own browser starts streaming (no relaunch)');
    const f = await host.frame(live.id, 0, 0);
    A.ok(f.ok && f.frame && f.frame.data === '/9j/FRAME', 'the station can read the live frame');
    await host.input(live.id, { type: 'text', text: 'andrew@example.com' });
    await host.input(live.id, { type: 'key', action: 'down', key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' });
    A.eq(driver.inputs.length, 2, 'the Commander\'s input reached the agent\'s browser');
    A.eq(driver.reads, readsBefore, 'and still nothing was read for the agent');

    host.handBack(live.id);
    const out = await pending;
    A.eq(out.summary, 'handed back', 'the agent learns the Commander handed back');
    A.ok(/https:\/\/example\.com\/dashboard/.test(out.content), 'it is told the page the Commander left it on');
    A.ok(/take a fresh browser\.snapshot/.test(out.content), 'and to take a fresh snapshot before acting');
    A.ok(/kept in the station browser profile/.test(out.content), 'the durable profile is named truthfully');
    A.ok(!/andrew@example\.com/.test(out.content), 'what the Commander typed never appears in the agent\'s result');
    A.eq(B.session.frozen(), null, 'the session thaws');
    A.eq(driver.stopped, 1, 'streaming stopped');
    const stale = await runErr(toolOf(B, 'browser.click'), { ref: oldRef });
    A.ok(/navigated since that snapshot|stale browser ref|unknown browser ref/.test(stale || ''), 'a ref from before the handoff is dead: ' + stale);
    const text = await toolOf(B, 'browser.get_text').run({}, {});
    A.ok(/Welcome back/.test(text.content), 'after hand back the agent reads the signed-in page');
    A.eq(emitted.map(e => e.state), ['waiting', 'taken', 'returned'], 'the station saw every state');
  }

  // ---- can't do it, expiry, and the temporary-profile truth ----
  {
    const driver = fakeDriver();
    const host = makeHandoffHost({ waitMs: 30 });
    const B = makeBrowserTools({ driver, lookup: null, handoff: { request: f => host.request(Object.assign({ agentId: 'a', runId: 'r2' }, f)) } });
    await toolOf(B, 'browser.navigate').run({ url: 'https://example.com/captcha' }, {});
    const p1 = toolOf(B, 'browser.need_human').run({ reason: 'captcha', note: 'please solve the captcha' }, {});
    await until(() => host.list().live.length === 1);
    A.eq(host.list().live[0].remembered, false, 'an ephemeral profile is NOT marked remembered');
    host.cancel(host.list().live[0].id);
    const r1 = await p1;
    A.eq(r1.summary, 'human could not', 'CAN\'T DO IT reaches the agent');
    A.ok(/Do not retry the same wall/.test(r1.content), 'and tells it to take another route');

    const p2 = toolOf(B, 'browser.need_human').run({ reason: 'captcha', note: 'please' }, {});
    const r2 = await p2;   // waitMs 30 → expires on its own
    A.eq(r2.summary, 'handoff expired', 'an unanswered handoff expires and the agent is told nobody came');
    A.ok(/Do not try to get around the wall/.test(r2.content), 'the expiry result forbids working around the wall');
    A.eq(B.session.frozen(), null, 'thawed after expiry');
  }

  // ---- a stopped run ends the handoff (never tied to a socket, but never outlives its run) ----
  {
    const driver = fakeDriver();
    const host = makeHandoffHost({});
    const B = makeBrowserTools({ driver, lookup: null, handoff: { request: f => host.request(Object.assign({ agentId: 'a', runId: 'r3' }, f)) } });
    await toolOf(B, 'browser.navigate').run({ url: 'https://example.com/login' }, {});
    const ac = new AbortController();
    const p = toolOf(B, 'browser.need_human').run({ reason: 'login', note: 'x' }, { signal: ac.signal });
    await until(() => host.list().live.length === 1);
    ac.abort();
    const r = await p;
    A.eq(r.summary, 'handoff aborted', 'a stopped run aborts its handoff');
    A.eq(host.list().live.length, 0, 'no live handoff is left behind');
  }

  clearInterval(keepAlive);
  A.report('browser.need-human.test');
})().catch(e => { console.log('FAIL: browser.need-human.test threw -- ' + (e && e.stack || e)); process.exit(1); });
