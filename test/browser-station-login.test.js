/* node test/browser-station-login.test.js — browser.login on the STATION browser (sidecar/tools/builtin/browser.js
   login(), deps.stationLogin): it opens the page IN the shared browser (no relaunch), shows it to the Commander, waits
   for their Done — and while they sign in, the agent's other browser tools are FROZEN (release review 2026-09-30: a
   snapshot / get_text / screenshot called in parallel in the same turn could read a page they are typing a password
   or a 2FA code into). After Done every tool works again and refs minted before are retired. */
'use strict';
const A = require('./_assert.js');
const { makeBrowserTools } = require('../sidecar/tools/builtin/browser.js');

(async () => {
  const opened = [], closed = [];
  let finishSignIn; const doneAnswer = new Promise(r => { finishSignIn = r; });
  const asks = [];
  const drv = { url: '', navigate: async u => { drv.url = u; return u; }, getText: async () => 'secret page text', snapshot: async () => [],
    close: async () => {}, usingPersistentProfile: () => false, tabs: async () => [], alive: () => true, challengeStatus: async () => null };
  const B = makeBrowserTools({
    makeDriver: () => drv, lookup: async () => [{ address: '140.82.112.3', family: 4 }],
    stationLogin: true, preferVisible: true, forceHeadless: false,
    attendedLogin: { prompt: async ask => { asks.push(ask.tool); return ask.tool === 'browser.login.done' ? doneAnswer : 'allow'; } },
    onLoginOpen: v => { opened.push(v.host); }, onLoginClose: v => { closed.push(v.host); }
  });
  const tool = name => B.tools.find(t => t.name === name);
  const login = tool('browser.login').run({ url: 'https://github.com/login' }, {});
  for (let i = 0; i < 50 && asks.indexOf('browser.login.done') < 0; i++) await new Promise(r => setTimeout(r, 10));
  A.eq(asks, ['browser.login', 'browser.login.done'], 'it asks to open the sign-in, then waits for Done');
  A.eq(drv.url, 'https://github.com/login', 'the page opened IN the shared browser (no relaunch)');
  A.eq(opened, ['github.com'], 'and was shown to the Commander');
  let err = ''; try { await tool('browser.get_text').run({}, {}); } catch (e) { err = e.message; }
  A.ok(/FROZEN/.test(err) && /sign-in at github\.com/.test(err), 'a parallel get_text during the sign-in is refused (FROZEN), nothing read');
  let err2 = ''; try { await tool('browser.snapshot').run({}, {}); } catch (e) { err2 = e.message; }
  A.ok(/FROZEN/.test(err2), '…and so is a snapshot');
  finishSignIn('allow');
  const out = await login;
  A.ok(out && /done|signed|github/i.test(JSON.stringify(out)), 'Done finishes the sign-in');
  A.eq(closed, ['github.com'], 'the window is told the sign-in ended');
  const text = await tool('browser.get_text').run({}, {});
  A.ok(/secret page text/.test(JSON.stringify(text)), 'after Done the agent can read the page again');
  A.report('browser-station-login.test');
})().catch(e => { console.log('FAIL: browser-station-login.test threw — ' + (e && e.stack || e)); process.exit(1); });
