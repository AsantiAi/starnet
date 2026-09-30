/* node test/browser.stepin.e2e.test.js — STEP-IN against REAL Chromium over loopback.

   The unit test (browser.need-human.test.js) pins the tool/frozen/host contract with an injected driver. This one
   proves the driver half is real: the agent's own headless Chrome reaches a real login wall, the auth probe sees
   the password field, browser.need_human parks the run, the stream (a capture loop on the same page session) yields real JPEG frames, the Commander's
   pointer + keys (CDP Input.*, never the OS) sign in, HAND BACK resumes the agent, and the agent reads the
   signed-in page — while every agent read during the handoff was refused.

   Skips (loudly) when no Chromium is installed. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _internals: T, makeBrowserTools } = require('../sidecar/tools/builtin/browser.js');
const { makeHandoffHost } = require('../sidecar/browser-handoff.js');
const { makeServer } = require('./fixtures/stepin-login-site.js');

const tick = ms => new Promise(r => setTimeout(r, ms || 10));
async function until(fn, ms) { const end = Date.now() + (ms || 8000); while (Date.now() < end) { if (await fn()) return true; await tick(25); } return false; }

(async () => {
  const found = T.findChrome();
  if (!found) {
    console.log('browser.stepin.e2e: SKIPPED — no Chromium installed (this box cannot run the live STEP-IN proof)');
    A.report('browser.stepin.e2e');
    return;
  }
  const chrome = typeof found === 'string' ? found : found.path;
  const server = makeServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-stepin-e2e-'));
  const driver = T.makeCdpDriver({ chrome, forceHeadless: true, syntheticInputOnly: true, cdpPort: 0, profileDir, timeoutMs: 20000, cleanupProfile: true });
  const host = makeHandoffHost({});
  const B = makeBrowserTools({ driver, handoff: { request: f => host.request(Object.assign({ agentId: 'nova', runId: 'e2e-run' }, f)) } });
  const tool = n => B.tools.find(t => t.name === n);
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const nav = await tool('browser.test_navigate').run({ url: base + '/account' }, {});
    A.ok(/Local browser navigated/.test(nav.content), 'the agent opens the account page (and is bounced to the login wall)');
    const wall = await driver.challengeStatus();
    A.eq(wall.authWall, 'login', 'the real auth probe sees the visible password field');
    A.eq(wall.challenged, false, 'a login form is not misread as a CAPTCHA wall');

    const pending = tool('browser.need_human').run({ reason: 'login', note: 'Sign in to Fixture Bank so I can read the balance' }, {});
    A.ok(await until(() => host.list().live.length === 1), 'the run parks on a live handoff');
    const h = host.list().live[0];
    A.eq(h.where, '127.0.0.1:' + server.address().port + '/login', 'the handoff names the login page');

    // FROZEN: the agent cannot read the page while the human holds it.
    let frozenErr = null;
    try { await tool('browser.test_state').run({ selector: '#pass' }, {}); } catch (e) { frozenErr = e.message; }
    A.ok(/^FROZEN/.test(frozenErr || ''), 'browser.test_state is refused during the handoff');

    const tk = await host.take(h.id);
    A.ok(tk.ok, 'take the wheel: ' + (tk.error || 'ok'));
    const f1 = await host.frame(h.id, 0, 8000);
    A.ok(f1.ok && f1.frame && /^\/9j\//.test(f1.frame.data), 'a real JPEG frame of the agent\'s page arrives');
    A.ok(f1.frame && f1.frame.width >= 800 && f1.frame.height >= 500, 'the frame carries the page size for pointer mapping (' + (f1.frame && f1.frame.width) + 'x' + (f1.frame && f1.frame.height) + ')');

    // The Commander's eyes: where are the fields on the frame? (the test reads geometry off the driver directly —
    // the agent's tool path is frozen, which is the point).
    const rect = async sel => driver.testEval('(() => { const r = document.querySelector(' + JSON.stringify(sel) + ').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()');
    const click = async p => {
      await host.input(h.id, { type: 'mouse', action: 'move', x: p.x, y: p.y });
      await host.input(h.id, { type: 'mouse', action: 'down', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await host.input(h.id, { type: 'mouse', action: 'up', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    };
    const typeKeys = async s => {
      for (const ch of s) {
        await host.input(h.id, { type: 'key', action: 'down', key: ch, code: '', keyCode: ch.toUpperCase().charCodeAt(0), text: ch });
        await host.input(h.id, { type: 'key', action: 'up', key: ch, code: '', keyCode: ch.toUpperCase().charCodeAt(0) });
      }
    };
    await click(await rect('#user'));
    await host.input(h.id, { type: 'text', text: 'andrew' });   // a paste
    await click(await rect('#pass'));
    await typeKeys('hunter2');
    const typed = await driver.testEval('({ user: document.querySelector("#user").value, passLen: document.querySelector("#pass").value.length })');
    A.eq(typed, { user: 'andrew', passLen: 7 }, 'the Commander\'s paste and keystrokes landed in the real fields');
    const seqBefore = f1.frame.seq;
    await host.input(h.id, { type: 'key', action: 'down', key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' });
    await host.input(h.id, { type: 'key', action: 'up', key: 'Enter', code: 'Enter', keyCode: 13 });
    A.ok(await until(async () => /\/account$/.test((await driver.pageInfo()).url), 8000), 'Enter submitted the form and the site signed in');
    const f2 = await host.frame(h.id, seqBefore, 8000);
    A.ok(f2.ok && f2.frame && f2.frame.seq > seqBefore, 'the stream kept up: a newer frame shows the signed-in page');

    host.handBack(h.id);
    const out = await pending;
    A.eq(out.summary, 'handed back', 'HAND BACK resumes the agent');
    A.ok(out.content.indexOf(base + '/account') >= 0, 'the agent is told it is now on /account');
    A.ok(!/hunter2|andrew/.test(out.content.replace(/Signed in as/g, '')), 'nothing the Commander typed is in the agent\'s result');
    const who = await tool('browser.test_state').run({ selector: '#who' }, {});
    A.ok(/Signed in as andrew/.test(who.content), 'the agent reads the signed-in page after the handoff: ' + who.content.slice(0, 160));
  } finally {
    clearInterval(keepAlive);
    try { await driver.close(); } catch (_) {}
    server.close();
  }
  A.report('browser.stepin.e2e');
})().catch(e => { console.log('FAIL: browser.stepin.e2e threw -- ' + (e && e.stack || e)); process.exit(1); });
