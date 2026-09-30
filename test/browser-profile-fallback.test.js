/* node test/browser-profile-fallback.test.js — a run that loses the durable station profile to the STATION BROWSER
   (the shared browser the Commander has open, sidecar/browser-view.js) browses on a temporary profile. It must not
   error, must not wait out the 8 s profile wait, and must never close the Commander's browser. Against another RUN
   the old rule stands: wait, then refuse — two runs never silently swap account identity. makeDriver SEAM (not an
   injected driver) so profileDeps() — and therefore the lease — really runs. */
'use strict';
const A = require('./_assert.js');
const { makeBrowserTools } = require('../sidecar/tools/builtin/browser.js');

function fakeDriver() {
  return {
    navigate: async u => u, snapshot: async () => [], back: async () => '', forward: async () => '',
    getText: async () => 'text', tabs: async () => [], consoleLog: () => [], networkLog: () => [],
    usingPersistentProfile: () => false, close: async () => {}
  };
}

(async () => {
  // 1. lost to the station browser → temporary profile, at once
  {
    const built = [];
    const B = makeBrowserTools({
      makeDriver: d => { built.push(d); return fakeDriver(); }, lookup: null,
      persistentProfile: { dir: 'C:/tmp/profile', acquire: () => false, release: () => {}, fallback: () => true }
    });
    const t0 = Date.now();
    await B.session.waitForProfile();
    A.ok(Date.now() - t0 < 1000, 'no 8 s wait when the station browser holds the profile');
    const url = await B.session.navigate('https://example.com/');
    A.eq(url, 'https://example.com/', 'the run browses');
    A.eq(!!built[0].profileIsPersistent, false, 'on a TEMPORARY profile (it never touches the one the Commander has open)');
    A.ok(built[0].profileDir !== 'C:/tmp/profile', 'and never the durable profile directory');
  }
  // 2. lost to another RUN → the old refusal stands
  {
    const B = makeBrowserTools({
      makeDriver: () => fakeDriver(), lookup: null, profileWaitMs: 0,
      persistentProfile: { dir: 'C:/tmp/profile', acquire: () => false, release: () => {}, fallback: () => false }
    });
    let err = ''; try { await B.session.navigate('https://example.com/'); } catch (e) { err = e.message; }
    A.ok(/in use by another agent run/.test(err), 'another run holding it → refused, saved logins not replaced');
  }
  // 3. free → the durable profile
  {
    const built = [];
    const B = makeBrowserTools({
      makeDriver: d => { built.push(d); return fakeDriver(); }, lookup: null,
      persistentProfile: { dir: 'C:/tmp/profile', acquire: () => true, release: () => {}, fallback: () => true }
    });
    await B.session.navigate('https://example.com/');
    A.eq(built[0].profileIsPersistent, true, 'a free profile is taken as before');
    A.eq(built[0].profileDir, 'C:/tmp/profile', 'the durable directory');
  }
  A.report('browser-profile-fallback.test');
})().catch(e => { console.log('FAIL: browser-profile-fallback.test threw - ' + (e && e.stack || e)); process.exit(1); });
