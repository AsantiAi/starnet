/* node test/claude-cli-signin-engine.test.js - the ClaudeCliSignIn engine Settings → PROVIDERS drives (fake fetch). */
'use strict';
const A = require('./_assert.js');

function withFetch(routes) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const verb = String(url).split('/').pop();
    const body = opts && opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ verb, body });
    const r = routes[verb];
    const j = typeof r === 'function' ? r(body, calls) : r;
    return { json: async () => j };
  };
  return calls;
}
const { makeClaudeCliSignIn } = require('../frontend/app/codexsignin.js');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // A. pending → the flow ends on an error, but the CLI says signed in: connected, never an error.
  {
    let polls = 0;
    const calls = withFetch({
      start: { status: 'pending', login_id: 'L1', url: 'https://claude.com/x' },
      poll: () => (++polls < 2 ? { status: 'pending' } : { status: 'error', code: 'login_not_found', error: 'no longer running' }),
      status: { installed: true, loggedIn: true, subscription: 'max' }
    });
    const eng = makeClaudeCliSignIn();
    const seen = [];
    await eng.start({ onPending: p => seen.push('pending:' + p.url), onConnected: s => seen.push('connected:' + s.subscription), onError: m => seen.push('error:' + m) });
    A.eq(eng.active(), true, 'a pending sign-in is active');
    await wait(3300);
    A.eq(seen, ['pending:https://claude.com/x', 'connected:max'], 'a flow that ends on a landed sign-in reports connected');
    A.eq(calls.filter(c => c.verb === 'poll').every(c => c.body.login_id === 'L1'), true, 'polls carry the login id');
    A.eq(eng.active(), false, 'nothing active after it settles');
  }

  // B. a real failure (CLI not signed in) is an error; a code relays with the login id; cancel stops and kills.
  {
    const calls = withFetch({
      start: { status: 'pending', login_id: 'L2', url: '' },
      poll: { status: 'pending' },
      code: b => ({ ok: b.code === 'abc#1' }),
      cancel: { ok: true },
      status: { installed: true, loggedIn: false }
    });
    const eng = makeClaudeCliSignIn();
    await eng.start({});
    A.eq(await eng.submitCode('abc#1'), { ok: true }, 'code accepted');
    A.eq(calls.find(c => c.verb === 'code').body, { login_id: 'L2', code: 'abc#1' }, 'code sent with the login id');
    await eng.cancel();
    A.eq([eng.active(), calls.some(c => c.verb === 'cancel' && c.body.login_id === 'L2')], [false, true], 'cancel stops polling and kills the child');
    A.eq((await eng.submitCode('x')).ok, false, 'no code is sent once cancelled');
  }

  // C. start errors surface with their code; an unreachable station is an error, not silence.
  {
    withFetch({ start: { status: 'error', code: 'not_installed', error: 'Claude Code is not installed' } });
    const eng = makeClaudeCliSignIn();
    let got = null; await eng.start({ onError: (m, c) => { got = [m, c]; } });
    A.eq(got, ['Claude Code is not installed', 'not_installed'], 'start error carries message + code');
    global.fetch = async () => { throw new Error('offline'); };
    got = null; await eng.start({ onError: m => { got = m; } });
    A.ok(/couldn’t start/.test(got), 'an unreachable station says so');
    A.eq(await eng.status(), null, 'status is null when the station cannot answer');
  }

  A.report('claude-cli-signin-engine.test');
})().catch(e => { console.log('FAIL: claude-cli-signin-engine.test threw -- ' + (e && e.stack || e)); process.exit(1); });
