/* node test/claude-cli-login.test.js - SIGN IN WITH CLAUDE drives the user's own `claude auth login` (no real CLI). */
'use strict';
const A = require('./_assert.js');
const { EventEmitter } = require('events');
const { makeClaudeCliLogin } = require('../sidecar/providers/claude-cli-login.js');

const URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=xyz';
function fakeHost(o) {
  o = o || {};
  const h = { spawned: [], killed: [], loggedIn: false };
  function child() {
    const c = new EventEmitter();
    const s = () => { const e = new EventEmitter(); e.setEncoding = () => {}; return e; };
    c.stdout = s(); c.stderr = s(); c.exitCode = null; c.written = '';
    c.stdin = { on() {}, write(t) { c.written += t; } };
    c.exit = code => { if (c.exitCode != null) return; c.exitCode = code; c.emit('close', code); };
    return c;
  }
  Object.assign(h, {
    os: { tmpdir: () => '/tmp' },
    command: () => (o.missing ? null : { file: 'claude', pre: [] }),
    notInstalled: () => Object.assign(new Error('Claude Code is not installed on this computer'), { code: 'provider_not_configured' }),
    notSignedIn: () => Object.assign(new Error('not signed in'), { code: 'provider_not_configured' }),
    childEnv: () => ({}),
    killTree: c => { h.killed.push(c); if (c) c.exit(null); },
    authStatus: async () => (h.loggedIn ? { installed: true, loggedIn: true, authMethod: 'claude.ai', email: 'a@b.c', subscription: 'max' } : { installed: !o.missing, loggedIn: false, error: h.notSignedIn() }),
    spawn: (file, args) => {
      const c = child(); c.args = args; h.spawned.push(c);
      if (o.printUrl !== false) setImmediate(() => c.stdout.emit('data', 'Opening browser to sign in…\nIf the browser didn\'t open, visit: ' + URL + '\nPaste code here if prompted > '));
      return c;
    }
  });
  return h;
}

(async () => {
  // A. start spawns `auth login --claudeai`, returns the fallback URL; the browser callback then signs in.
  {
    const host = fakeHost();
    const login = makeClaudeCliLogin({ host, urlWaitMs: 200 });
    const s = await login.start();
    A.eq(host.spawned[0].args, ['auth', 'login', '--claudeai'], 'runs the CLI\'s own subscription login');
    A.eq([s.status, s.url], ['pending', URL], 'pending with the fallback sign-in URL');
    A.eq((await login.poll(s.login_id)).status, 'pending', 'still pending while the child waits');
    A.eq((await login.status()).signingIn, true, 'status reports the sign-in in flight');
    host.loggedIn = true; host.spawned[0].exit(0);
    const done = await login.poll(s.login_id);
    A.eq([done.status, done.email, done.subscription], ['connected', 'a@b.c', 'max'], 'connected only after auth status proves it');
    A.eq(JSON.stringify(done).indexOf('token'), -1, 'no credential in the payload');
  }

  // B. manual path: a pasted code goes to the child's stdin, newline-terminated and trimmed.
  {
    const host = fakeHost();
    const login = makeClaudeCliLogin({ host, urlWaitMs: 200 });
    const s = await login.start();
    A.eq(login.submitCode(s.login_id, '  abc#123\r\n'), { ok: true }, 'code accepted');
    A.eq(host.spawned[0].written, 'abc#123\n', 'code written to the CLI stdin');
    A.eq(login.submitCode('wrong-id', 'x').ok, false, 'a code for another sign-in is refused');
    A.eq(login.submitCode(s.login_id, '').ok, false, 'an empty code is refused');
  }

  // C. a child that exits without a sign-in is an error, never "connected"; the URL is not echoed back.
  {
    const host = fakeHost();
    const login = makeClaudeCliLogin({ host, urlWaitMs: 200 });
    const s = await login.start();
    host.spawned[0].stderr.emit('data', 'OAuth error: invalid code ' + URL + '\n');
    host.spawned[0].exit(1);
    const r = await login.poll(s.login_id);
    A.eq(r.status, 'error', 'failed login is an error');
    A.ok(/invalid code/.test(r.error) && r.error.indexOf('client_id') < 0, 'error explains why without echoing the sign-in link');
  }

  // D. cancel kills the child; a second start replaces the first.
  {
    const host = fakeHost();
    const login = makeClaudeCliLogin({ host, urlWaitMs: 200 });
    const a = await login.start();
    const b = await login.start();
    A.ok(host.killed.indexOf(host.spawned[0]) >= 0, 'second start kills the first child');
    A.eq((await login.poll(a.login_id)).code, 'login_not_found', 'the replaced sign-in is gone');
    login.cancel(b.login_id);
    A.ok(host.killed.indexOf(host.spawned[1]) >= 0, 'cancel kills the child');
    A.eq((await login.status()).signingIn, false, 'nothing in flight after cancel');
  }

  // E. not installed: no spawn, an install hint.
  {
    const host = fakeHost({ missing: true });
    const login = makeClaudeCliLogin({ host });
    const r = await login.start();
    A.eq([r.status, r.code, host.spawned.length], ['error', 'not_installed', 0], 'missing CLI is reported, nothing spawned');
    const st = await login.status();
    A.eq([st.installed, st.loggedIn], [false, false], 'status says not installed');
  }

  // F. the TTL kills an abandoned sign-in.
  {
    const host = fakeHost();
    const login = makeClaudeCliLogin({ host, urlWaitMs: 50, ttlMs: 30 });
    await login.start();
    await new Promise(r => setTimeout(r, 80));
    A.ok(host.killed.indexOf(host.spawned[0]) >= 0, 'abandoned sign-in is killed after the TTL');
  }

  // G. the credential lands while the CLI lingers on its paste prompt: a proven sign-in is connected, and the child is reaped.
  {
    const host = fakeHost();
    const login = makeClaudeCliLogin({ host, urlWaitMs: 200, statusEveryMs: 0 });
    const s = await login.start();
    A.eq((await login.poll(s.login_id)).status, 'pending', 'pending before the sign-in lands');
    host.loggedIn = true;   // browser callback wrote the credential; the child has NOT exited
    const r = await login.poll(s.login_id);
    A.eq([r.status, r.subscription], ['connected', 'max'], 'lingering child + proven sign-in = connected');
    A.ok(host.killed.indexOf(host.spawned[0]) >= 0, 'the lingering login child is killed');
  }

  A.report('claude-cli-login.test');
})().catch(e => { console.log('FAIL: claude-cli-login.test threw -- ' + (e && e.stack || e)); process.exit(1); });
