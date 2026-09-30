/* node test/browser-handoff-routes.test.js — STEP-IN HTTP surface + remembered sign-ins
   (sidecar/browser-handoff-routes.js), with fake req/res and a real handoff host.

   Pins: the route table, take/back/cancel answers, frames + input only while taken, a batch of input stops at the
   first refusal, the remembered-sign-ins list records ONLY a completed handoff on the durable profile, it lives
   inside the profile (so FORGET cannot leave a stale list), and FORGET refuses while the profile is in use or a
   handoff is live. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeHandoffHost } = require('../sidecar/browser-handoff.js');
const R = require('../sidecar/browser-handoff-routes.js');

function fakeReq(url, body) { return { url, _body: body == null ? '' : JSON.stringify(body) }; }
const readBody = async req => req._body;
function fakeRes() { const r = { code: 0, body: null }; return r; }
const respondJson = (res, code, obj) => { res.code = code; res.body = obj; };
function surface() {
  const s = { inputs: [] };
  s.startStream = async fn => { s.fn = fn; fn({ data: '/9j/X', width: 1440, height: 900 }); };
  s.stopStream = async () => {};
  s.input = async ev => { s.inputs.push(ev); };
  return s;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stepin-routes-'));
  const dir = path.join(tmp, '.browser-profile');
  fs.mkdirSync(dir);
  let busy = false;
  const saved = {};
  const host = makeHandoffHost({ onSettled: v => signins.note(v) });
  const signins = R.makeSigninStore({
    dir, fs, path, now: () => 42,
    load: f => JSON.parse(fs.readFileSync(f, 'utf8')), save: (f, v) => { saved[f] = true; fs.writeFileSync(f, JSON.stringify(v)); },
    isBusy: () => busy, anyLive: () => host.list().live.length > 0
  });
  const api = R.makeHandoffRoutes({ host, readBody, respondJson, signins });
  const paths = api.routes.map(r => r.m + ' ' + (r.exact || r.qsplit));
  A.eq(paths, [
    'GET /api/browser/handoffs', 'POST /api/browser/handoff/take', 'POST /api/browser/handoff/back', 'POST /api/browser/handoff/cancel',
    'GET /api/browser/handoff/frame', 'POST /api/browser/handoff/input', 'GET /api/browser/signins', 'POST /api/browser/signins/forget'
  ], 'the STEP-IN route table');

  // a remembered handoff, driven over the routes
  const s1 = surface();
  const h = host.request({ agentId: 'nova', runId: 'r1', reason: 'login', url: 'https://github.com/login', remembered: true, surface: s1 });
  let res = fakeRes(); await api.list(fakeReq('/api/browser/handoffs'), res);
  A.eq(res.body.live.length, 1, 'the list shows the live handoff');
  res = fakeRes(); await api.frame(fakeReq('/api/browser/handoff/frame?id=' + h.id + '&after=0'), res);
  A.eq(res.code, 409, 'no frame before the wheel is taken');
  res = fakeRes(); await api.input(fakeReq('/api/browser/handoff/input', { id: h.id, events: [{ type: 'text', text: 'x' }] }), res);
  A.eq(res.code, 409, 'no input before the wheel is taken');
  res = fakeRes(); await api.take(fakeReq('/api/browser/handoff/take', { id: h.id }), res);
  A.ok(res.code === 200 && res.body.ok && res.body.view.state === 'taken', 'take answers the taken view');
  res = fakeRes(); await api.frame(fakeReq('/api/browser/handoff/frame?id=' + h.id + '&after=0'), res);
  A.ok(res.code === 200 && res.body.frame && res.body.frame.data === '/9j/X' && res.body.frame.width === 1440, 'the frame route serves the live frame');
  res = fakeRes(); await api.input(fakeReq('/api/browser/handoff/input', { id: h.id, events: [{ type: 'text', text: 'a' }, { type: 'bogus' }, { type: 'text', text: 'never' }] }), res);
  A.eq([res.code, res.body.applied], [409, 1], 'a batch stops at the first refused event and says how many landed');
  A.eq(s1.inputs.length, 1, 'only the valid event before the refusal reached the browser');
  res = fakeRes(); await api.forget(fakeReq('/api/browser/signins/forget', {}), res);
  A.eq(res.code, 409, 'FORGET refuses while a handoff is live');
  A.ok(fs.existsSync(dir), 'the profile is untouched');
  res = fakeRes(); await api.back(fakeReq('/api/browser/handoff/back', { id: h.id }), res);
  A.ok(res.code === 200 && res.body.view.state === 'returned', 'hand back answers the returned view');
  res = fakeRes(); await api.back(fakeReq('/api/browser/handoff/back', { id: h.id }), res);
  A.eq(res.code, 404, 'handing back twice is a 404, with the settled view for the page');
  A.eq(res.body.view && res.body.view.state, 'returned', 'the 404 carries the truthful settled state');

  res = fakeRes(); await api.signinList(fakeReq('/api/browser/signins'), res);
  A.eq(res.body.sites, [{ host: 'github.com', agentId: 'nova', at: 42 }], 'a completed handoff on the durable profile is remembered (host + agent + when, nothing else)');
  A.ok(fs.existsSync(path.join(dir, R.LIST_FILE)), 'the list lives INSIDE the profile dir');

  // not remembered: temporary profile, or cancelled
  const h2 = host.request({ agentId: 'vega', runId: 'r2', reason: 'login', url: 'https://example.org/login', remembered: false, surface: surface() });
  host.handBack(h2.id);
  const h3 = host.request({ agentId: 'vega', runId: 'r3', reason: 'login', url: 'https://example.net/login', remembered: true, surface: surface() });
  host.cancel(h3.id);
  A.eq(signins.view().sites.map(s => s.host), ['github.com'], 'a temporary-profile or cancelled handoff is never listed as remembered');

  // cancel route
  const h4 = host.request({ agentId: 'a', runId: 'r4', surface: surface() });
  res = fakeRes(); await api.cancel(fakeReq('/api/browser/handoff/cancel', { id: h4.id }), res);
  A.eq(res.body.view.state, 'cancelled', 'the cancel route settles CAN\'T DO IT');
  res = fakeRes(); await api.take(fakeReq('/api/browser/handoff/take', {}), res);
  A.eq(res.code, 404, 'taking an unknown handoff is a 404');

  // forget
  busy = true;
  res = fakeRes(); await api.forget(fakeReq('/api/browser/signins/forget', {}), res);
  A.eq(res.code, 409, 'FORGET refuses while a run holds the station browser profile');
  busy = false;
  res = fakeRes(); await api.forget(fakeReq('/api/browser/signins/forget', {}), res);
  A.ok(res.code === 200 && res.body.ok, 'FORGET wipes the profile when nothing is using it');
  A.ok(!fs.existsSync(dir), 'the whole profile (cookies + the list) is gone');
  A.eq([res.body.profile, res.body.sites], [false, []], 'and the view says so');

  const line = R.nudgeLine({ agentId: 'nova', reason: '2fa', where: 'github.com/sessions/two-factor', note: 'Enter the code' }, 'Nova');
  A.ok(/^NOVA is waiting for you to enter a sign-in code at github\.com\/sessions\/two-factor\. Open StarNet > STEP-IN/.test(line), 'the channel nudge is one plain line: ' + line);

  fs.rmSync(tmp, { recursive: true, force: true });
  A.report('browser-handoff-routes.test');
})().catch(e => { console.log('FAIL: browser-handoff-routes.test threw -- ' + (e && e.stack || e)); process.exit(1); });
