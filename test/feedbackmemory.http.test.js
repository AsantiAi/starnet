'use strict';
// THE COMMANDER'S TASTE, live: real sidecar + real /api/run against a capturing local provider.
// rate a run `missed` -> a durable feedback memory exists; a typed correction folds into it; the NEXT run, on an
// UNRELATED task (zero word overlap, so BM25 recall alone would never surface it), carries the Commander's words in
// its prompt; a `nailed it` with words adds a like; both survive a sidecar restart; the personalization pause stops
// new feedback memories and says so truthfully.
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {bootToken} = require('./_httpToken.js');
const root = path.resolve(__dirname, '..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-feedback-memory-'));
let child, base, headers;
const seen = [];   // every chat request body the provider received
const mock = http.createServer((req, res) => {
  if (req.url.includes('/models')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({data: [{id: 'test/model', context_length: 128000, pricing: {prompt: '0', completion: '0'}, supported_parameters: ['tools']}]})); }
  let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
    try { seen.push(JSON.parse(raw)); } catch (_) {}
    res.writeHead(200, {'Content-Type': 'text/event-stream'});
    res.write('data: ' + JSON.stringify({choices: [{delta: {content: 'Here is the finished piece of work you asked for.'}}]}) + '\n\n');
    res.write('data: ' + JSON.stringify({choices: [{delta: {}, finish_reason: 'stop'}], usage: {prompt_tokens: 5, completion_tokens: 5, total_tokens: 10}}) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
});
async function boot() {
  const socket = http.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise(r => socket.close(r));
  base = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['sidecar/index.js'], {cwd: root, env: {...process.env, SKYNET_WORKSPACES: workspace, SKYNET_PORT: String(port), SKYNET_OPENROUTER_BASE: 'http://127.0.0.1:' + mock.address().port + '/api/v1', SKYNET_OPENROUTER_KEY: 'sk-or-v1-feedback-fixture', SKYNET_EDGE_TTS: '0', SKYNET_REFLECT: '0', SKYNET_SKILL_REVIEW: '0'}, stdio: ['ignore', 'pipe', 'pipe']});
  await new Promise((resolve, reject) => { let out = ''; const timer = setTimeout(() => reject(new Error('boot timeout: ' + out.slice(-1200))), 30000); const read = d => { out += d; if (out.includes('Open in your browser:')) { clearTimeout(timer); resolve(); } }; child.stdout.on('data', read); child.stderr.on('data', read); child.once('exit', c => { clearTimeout(timer); reject(new Error('boot exit ' + c + out.slice(-1200))); }); });
  headers = {'Content-Type': 'application/json', 'X-StarNet-Token': await bootToken(base, base), Origin: base};
}
async function stop() { if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; } }
async function api(url, body) { const r = await fetch(base + url, {headers, method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body)}); return {status: r.status, body: await r.json()}; }
async function run(text, agentId) {
  const before = seen.length;
  const r = await fetch(base + '/api/run', {method: 'POST', headers, body: JSON.stringify({agentId: agentId || 'agent', key: 'sk-or-v1-feedback-fixture', model: 'test/model', messages: [{role: 'user', content: text}]})});
  const events = (await r.text()).split('\n').filter(Boolean).map(s => JSON.parse(s));
  const end = events.find(e => e.name === 'agent.run.end');
  A.eq(end && end.payload.reason, 'done', 'run completed: ' + text);
  // the run's own model request (the first one after the call; later ones may be aux/title passes)
  const req = seen.slice(before).find(b => Array.isArray(b.messages) && b.messages.some(m => m.role === 'user' && String(m.content).indexOf(text) >= 0));
  return {runId: end.payload.runId, prompt: req ? JSON.stringify(req.messages) : ''};
}
const feedbackRecs = async () => ((await api('/api/memory/records?agent=agent')).body.records || []).filter(r => r.origin === 'feedback');
(async () => {
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  try {
    await boot();
    A.ok((await api('/api/roster', {agents: [{agentId: 'agent', name: 'Hero', model: 'test/model', provider: 'openrouter'}, {agentId: 'scribe', name: 'Scribe', model: 'test/model', provider: 'openrouter'}]})).body.ok, 'roster saved');

    // 1. a bare `missed` already teaches something durable
    const r1 = await run('Write the weekly status report for the board.');
    const rated = await api('/api/growth/ratings', {runId: r1.runId, verdict: 'miss', epoch: 1});
    A.ok(rated.body.ok, 'miss rating saved: ' + JSON.stringify(rated.body));
    A.ok(rated.body.feedbackMemory && rated.body.feedbackMemory.stored === true, 'response says a feedback memory was stored');
    let recs = await feedbackRecs();
    A.eq(recs.length, 1, 'one feedback memory for the rated run');
    A.ok(/DISLIKED the result of: Write the weekly status report/.test(recs[0].body), 'bare miss names the work it was about');
    A.eq(recs[0].kind, 'profile', 'stored as a Preference');

    // 2. the typed correction folds into that SAME record, even with no held review (skill review is off here)
    const corr = await api('/api/growth/ratings/correction', {runId: r1.runId, text: 'way too long, give me 3 bullet points max', final: true, source: 'message'});
    A.ok(corr.body.ok && corr.body.held === false, 'no review was held (skill review off): ' + JSON.stringify(corr.body));
    A.ok(corr.body.feedbackMemory && corr.body.feedbackMemory.stored === true && corr.body.feedbackMemory.created === false, 'correction updated the feedback memory');
    recs = await feedbackRecs();
    A.eq(recs.length, 1, 'still one record for that run');
    A.ok(/^DISLIKED: "way too long, give me 3 bullet points max"/.test(recs[0].body), 'record now carries the Commander\'s words');

    // 3. the NEXT run on an unrelated task carries the taste in its prompt
    const r2 = await run('Summarize these customer call notes.');
    A.ok(r2.prompt.indexOf('way too long, give me 3 bullet points max') >= 0, 'unrelated next run carries the correction in its prompt');
    A.ok(r2.prompt.indexOf('Commander\'s own verdicts on past work') >= 0, 'under the taste header');
    A.ok(r2.prompt.indexOf('[user-confirmed reference] Preference') >= 0, 'marked as the Commander\'s confirmed preference');

    // 3b. station-wide: a DIFFERENT agent's next run carries the Commander's correction too (no foreign note id)
    const rs = await run('Compose a short poem about autumn leaves.', 'scribe');
    A.ok(rs.prompt.indexOf('way too long, give me 3 bullet points max') >= 0, 'another agent\'s run carries the correction (taste is about the Commander)');
    A.ok(!/\[note_\d+\] \[user-confirmed reference\] Preference — DISLIKED/.test(rs.prompt), 'the foreign record shows no note id in the other agent\'s prompt');

    // 4. a like with words adds a second belief
    const liked = await api('/api/growth/ratings', {runId: r2.runId, verdict: 'great', epoch: 1, correction: 'perfect length, keep the bold headers'});
    A.ok(liked.body.ok && liked.body.feedbackMemory && liked.body.feedbackMemory.stored, 'great + words stored');
    recs = await feedbackRecs();
    A.eq(recs.length, 2, 'a like and a dislike');

    // 5. survives a restart, and both ride the next run newest-first
    await stop(); await boot();
    const r3 = await run('Draft an email to the landlord about the heating.');
    const iLike = r3.prompt.indexOf('perfect length, keep the bold headers'), iDislike = r3.prompt.indexOf('way too long, give me 3 bullet points max');
    A.ok(iLike >= 0 && iDislike >= 0, 'both beliefs survive a sidecar restart and reach the prompt');
    A.ok(iLike < iDislike, 'newest feedback leads');

    // 6. the personalization pause stops new feedback memories and says so
    A.ok((await api('/api/personalization', {enabled: false})).body.ok, 'personalization paused');
    const paused = await api('/api/growth/ratings', {runId: r3.runId, verdict: 'miss', epoch: 1, correction: 'wrong tone'});
    A.ok(paused.body.ok, 'the rating itself still saves');
    A.eq(paused.body.feedbackMemory && paused.body.feedbackMemory.reason, 'personalization-paused', 'no feedback memory while paused, reported truthfully');
    A.eq((await feedbackRecs()).length, 2, 'nothing new written while paused');
  } finally { await stop(); await new Promise(r => mock.close(r)); fs.rmSync(workspace, {recursive: true, force: true}); }
  A.report('feedbackmemory.http');
})().catch(e => { console.error(e); process.exit(1); });
