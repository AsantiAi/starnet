'use strict';
// Real sidecar, saved managed link. The journey a player takes: ask for a prop, the station polls the cloud in
// the background, the prop lands in the station's own folder, it is listed and its PNG served, and it SURVIVES A
// RESTART. Unlinked stations are told to link (200-always). Optional STARNET_TEST_CLOUD_ROOT runs the same journey
// through the REAL cloud app (src/propgen.js pipeline + ledger) with a synthetic OpenRouter behind it.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
// RGBA PNG: flat magenta with a dark rectangle in the middle (what the real model is prompted to paint)
function spritePng(W, H, rw, rh) {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; for (let x = 0; x < W; x++) {
    const i = y * (W * 4 + 1) + 1 + x * 4, inside = Math.abs(x - W / 2) < rw / 2 && Math.abs(y - H / 2) < rh / 2;
    raw[i] = inside ? 40 : 255; raw[i + 1] = inside ? 44 : 0; raw[i + 2] = inside ? 48 : 255; raw[i + 3] = 255; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('player props: generate on credits, land locally, list + serve, survive restart; unlinked is told to link', { timeout: 180000 }, async () => {
  let cloudApp = null, store = null, deviceToken = 'fixture-device-token', account = 'fixture-account';
  const jobs = new Map();
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const sprite = spritePng(256, 256, 120, 90);
  // synthetic OpenRouter for the REAL cloud mode
  async function upstream(url, opts = {}) {
    const body = JSON.parse(opts.body || '{}');
    const usage = (cost) => ({ cost, prompt_tokens: 10, completion_tokens: 10 });
    if (body.modalities) return json({ id: 'g-draw', choices: [{ message: { content: '', images: [{ image_url: { url: 'data:image/png;base64,' + sprite.toString('base64') } }] } }], usage: usage(0.25) });
    if (Array.isArray(body.messages[0].content)) return json({ id: 'g-check', choices: [{ message: { content: '{"orientation":5,"style":4,"clean":5,"verdict":"pass","reason":"fits"}' } }], usage: usage(0.01) });
    return json({ id: 'g-size', choices: [{ message: { content: '{"ok":true,"why":"","fp":"1x1","height":20,"like":"gachapon"}' } }], usage: usage(0.002) });
  }
  // simple fake cloud (default mode): accepts, runs for one poll, then finishes
  function fakeCloud(req, raw) {
    if (req.method === 'POST' && req.url === '/v1/props/generate') {
      if (req.headers.authorization !== 'Bearer ' + deviceToken) return json({ error: { message: 'unauthorized' } }, 401);
      const id = 'pj_' + Math.random().toString(16).slice(2, 14).padEnd(12, '0');
      jobs.set(id, { id, noun: JSON.parse(raw).noun, status: 'running', step: 'drawing', tries: 1, polls: 0, costUsd: 0 });
      return json({ job: jobs.get(id) }, 202);
    }
    const m = /^\/v1\/props\/jobs\/(.+)$/.exec(req.url);
    if (m) {
      const j = jobs.get(decodeURIComponent(m[1]));
      if (!j) return json({ error: { code: 'not_found' } }, 404);
      if (++j.polls >= 2) Object.assign(j, { status: 'done', step: 'done', costUsd: 0.3275, result: { noun: j.noun, label: 'GUMBALL MACHINE', like: 'gachapon', footprint: { w: 1, h: 1 }, bounds: { x: -2, y: -8, width: 16, height: 20 }, drawn: { h: 20, w: 15 }, sourceWidth: 256, sourceHeight: 256, png: sprite.toString('base64') } });
      return json({ job: j });
    }
    if (req.url.includes('/balance')) return json({ balanceUsd: 50 });
    return json({ error: { message: 'unexpected ' + req.url } }, 404);
  }
  const server = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const c of req) raw += c;
      const response = cloudApp ? await cloudApp.request(req.url, { method: req.method, headers: req.headers, ...(raw ? { body: raw } : {}) }) : fakeCloud(req, raw);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: { message: e.message } })); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const cloudUrl = 'http://127.0.0.1:' + server.address().port;
  const env = { STARNET_OPENROUTER_KEY: '', SKYNET_OPENROUTER_KEY: '', OPENROUTER_KEY: '', OPENROUTER_API_KEY: '', STARNET_CREDITS_URL: '', SKYNET_CREDITS_URL: '', STARNET_CREDITS_TOKEN: '', SKYNET_CREDITS_TOKEN: '', STARNET_CLOUD_URL: cloudUrl, SKYNET_AUX_BUDGET: '0' };
  const fixture = new SidecarFixture({ prefix: 'userprops-e2e-', timeoutMs: 20000, env });
  try {
    if (process.env.STARNET_TEST_CLOUD_ROOT) {
      const root = path.resolve(process.env.STARNET_TEST_CLOUD_ROOT);
      const { createApp } = await import(pathToFileURL(path.join(root, 'src/app.js')));
      const { makeStore } = await import(pathToFileURL(path.join(root, 'src/store.js')));
      store = makeStore(path.join(fixture.workspace, 'proof-cloud.db'));
      let now = Date.now();
      cloudApp = createApp({ store, clock: { now: () => now }, upstream, config: { baseUrl: cloudUrl, devMode: true, openrouterKey: 'fixture-server-only-key', creditMargin: 1.25 } });
      const post = async (route, body) => (await cloudApp.request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
      account = (await post('/dev/grant', { email: 'props-fixture@example.test', usd: 20 })).accountId;
      const link = await post('/v1/link/start', { deviceName: 'props proof' });
      store.confirmLinkCode({ code: link.code, account, now }); now += 2000;
      deviceToken = (await post('/v1/link/poll', { code: link.code, pollSecret: link.pollSecret })).deviceToken;
      assert.ok(deviceToken);
    }

    // --- unlinked station: told to link, 200-always
    await fixture.start();
    const unlinked = await fixture.json('POST', '/api/userprops/generate', { noun: 'a gumball machine' });
    assert.equal(unlinked.status, 200);
    assert.equal(unlinked.body.ok, false);
    assert.equal(unlinked.body.code, 'not_linked');
    await fixture.stop();

    // --- linked
    fs.mkdirSync(path.join(fixture.workspace, '.secrets'), { recursive: true });
    fs.writeFileSync(path.join(fixture.workspace, '.secrets/credits.json'), JSON.stringify({ url: cloudUrl, deviceToken, accountId: account, linkedAt: Date.now() }));
    await fixture.start();
    const started = await fixture.json('POST', '/api/userprops/generate', { noun: 'a gumball machine' });
    assert.equal(started.status, 200);
    assert.equal(started.body.ok, true, JSON.stringify(started.body));
    const jobId = started.body.job.id;
    assert.match(jobId, /^pj_/);

    let job = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      job = (await fixture.json('GET', '/api/userprops/job?id=' + encodeURIComponent(jobId))).body.job;
      if (job && (job.status === 'done' || job.status === 'failed')) break;
    }
    assert.equal(job && job.status, 'done', JSON.stringify(job));
    assert.match(job.propId, /^user_gumball_machine_[a-z0-9]{6}$/);
    assert.ok(job.costUsd > 0, 'the job reports what the cloud billed');

    const listed = (await fixture.json('GET', '/api/userprops')).body;
    assert.equal(listed.props.length, 1);
    const p = listed.props[0];
    assert.equal(p.id, job.propId);
    assert.equal(p.label, 'GUMBALL MACHINE');
    assert.ok(p.bounds.height >= 14, 'minimum drawn size holds');
    assert.deepEqual(listed.jobs, [], 'nothing left pending');

    const img = await fixture.request('/api/userprops/image?id=' + encodeURIComponent(p.id));
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await img.arrayBuffer()).readUInt32BE(0), 0x89504e47, 'serves the PNG');
    assert.equal((await fixture.request('/api/userprops/image?id=' + encodeURIComponent('../.secrets/credits'))).status, 400, 'the image route is jailed');
    // the folder is not reachable through the generic file route
    const leak = await fixture.request('/api/file?agent=.userprops&path=index.json');
    assert.notEqual(leak.status, 200, 'the .userprops folder is not served by /api/file');

    // --- persistence round trip (backend law): restart, still there, still served
    await fixture.restart();
    const after = (await fixture.json('GET', '/api/userprops')).body;
    assert.deepEqual(after.props.map((x) => x.id), [p.id], 'the prop survives a sidecar restart');
    assert.equal((await fixture.request('/api/userprops/image?id=' + encodeURIComponent(p.id))).status, 200);

    if (store) {
      const d = store.db.prepare("SELECT usd, meta FROM ledger WHERE kind='debit' AND account=?").all(account);
      assert.equal(d.length, 3, 'real cloud: size + draw + check each billed once');
      assert.equal(Math.round(d.reduce((s, r) => s + r.usd, 0) * 1e6) / 1e6, job.costUsd, 'real cloud: the station shows exactly what the ledger debited');
    }
  } finally {
    await fixture.dispose().catch(() => {});
    if (store) try { store.close(); } catch (_) {}
    server.close();
  }
});
