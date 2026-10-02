'use strict';
// A verdict given AFTER a sidecar restart still reaches its skill review: the run-end packet is persisted
// (provider-free) and restored on boot; the review rebuilds a provider from the agent's current config and its
// prompt carries the Commander's verdict and correction. Before, the packet lived in RAM and the verdict taught nothing.
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {bootToken} = require('./_httpToken.js');
const root = path.resolve(__dirname, '..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-verdict-packets-'));
let child, base, headers, out = '';
const seen = [];
const mock = http.createServer((req, res) => {
  if (req.url.includes('/models')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({data: [{id: 'test/model', context_length: 128000, pricing: {prompt: '0', completion: '0'}, supported_parameters: ['tools']}]})); }
  let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
    try { seen.push(JSON.parse(raw)); } catch (_) {}
    res.writeHead(200, {'Content-Type': 'text/event-stream'});
    res.write('data: ' + JSON.stringify({choices: [{delta: {content: 'Done: the weekly report is written.'}}]}) + '\n\n');
    res.write('data: ' + JSON.stringify({choices: [{delta: {}, finish_reason: 'stop'}], usage: {prompt_tokens: 5, completion_tokens: 5, total_tokens: 10}}) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
});
async function boot() {
  const socket = http.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise(r => socket.close(r));
  base = 'http://127.0.0.1:' + port; out = '';
  child = spawn(process.execPath, ['sidecar/index.js'], {cwd: root, env: {...process.env, SKYNET_WORKSPACES: workspace, SKYNET_PORT: String(port), SKYNET_OPENROUTER_BASE: 'http://127.0.0.1:' + mock.address().port + '/api/v1', SKYNET_OPENROUTER_KEY: 'sk-or-v1-packets-fixture', SKYNET_EDGE_TTS: '0', SKYNET_VERDICT_REVIEW_GRACE_MS: '0'}, stdio: ['ignore', 'pipe', 'pipe']});
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('boot timeout: ' + out.slice(-1200))), 90000); const read = d => { out += d; if (out.includes('Open in your browser:')) { clearTimeout(timer); resolve(); } }; child.stdout.on('data', read); child.stderr.on('data', read); child.once('exit', c => { clearTimeout(timer); if (c) reject(new Error('boot exit ' + c + out.slice(-1200))); }); });
  headers = {'Content-Type': 'application/json', 'X-StarNet-Token': await bootToken(base, base), Origin: base};
}
async function stop() { if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; } }
async function api(url, body) { const r = await fetch(base + url, {headers, method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body)}); return {status: r.status, body: await r.json()}; }
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise(r => setTimeout(r, 100)); } return !!fn(); };
(async () => {
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  try {
    await boot();
    A.ok((await api('/api/roster', {agents: [{agentId: 'agent', name: 'Hero', model: 'test/model', provider: 'openrouter'}]})).body.ok, 'roster saved');
    const r = await fetch(base + '/api/run', {method: 'POST', headers, body: JSON.stringify({agentId: 'agent', key: 'sk-or-v1-packets-fixture', model: 'test/model', isTask: true, messages: [{role: 'user', content: 'Write the weekly status report for the board.'}]})});
    const end = (await r.text()).split('\n').filter(Boolean).map(s => JSON.parse(s)).find(e => e.name === 'agent.run.end');
    A.eq(end && end.payload.reason, 'done', 'task run completed');
    const file = path.join(workspace, 'verdict.packets.json');
    A.ok(await until(() => fs.existsSync(file), 5000), 'the run-end packet is written to disk');
    const onDisk = fs.readFileSync(file, 'utf8');
    A.ok(onDisk.indexOf(end.payload.runId) >= 0, 'for this run');
    A.ok(onDisk.indexOf('sk-or-v1-packets-fixture') < 0, 'no credential on disk');

    await stop(); await boot();
    A.ok(/\[skills\] restored 1 verdict review packet/.test(out), 'the packet is restored on boot');
    const before = seen.length;
    const rated = await api('/api/growth/ratings', {runId: end.payload.runId, verdict: 'miss', epoch: 1, correction: 'three bullets, not an essay'});
    A.ok(rated.body.ok && rated.body.skillReviewArmed === true, 'the post-restart verdict armed a review: ' + JSON.stringify(rated.body));
    const reviewed = await until(() => seen.slice(before).some(b => JSON.stringify(b.messages || []).indexOf('COMMANDER VERDICT ON THIS RUN: MISSED') >= 0), 15000);
    A.ok(reviewed, 'the review ran on a rebuilt provider, with the verdict in its prompt');
    const req = seen.slice(before).find(b => JSON.stringify(b.messages || []).indexOf('COMMANDER VERDICT ON THIS RUN') >= 0);
    A.ok(req && JSON.stringify(req.messages).indexOf('three bullets, not an essay') >= 0, 'and the Commander\'s correction');
    A.ok(req && JSON.stringify(req.messages).indexOf('Write the weekly status report') >= 0, 'over the restored transcript');
  } finally { await stop(); await new Promise(r => mock.close(r)); fs.rmSync(workspace, {recursive: true, force: true}); }
  A.report('verdictpackets.http');
})().catch(e => { console.error(e); process.exit(1); });
