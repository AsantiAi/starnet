/* node test/failreview-budget.e2e.test.js — a run STOPPED BY ITS SPENDING CAP spends nothing more on its run-end (sweep 2026-10-02).

   'budget' is a reason the failure review learns from, and the review is a paid call on the same provider: a run the cap had just
   stopped sent one more request straight past it. Against the REAL sidecar + a mock OpenRouter with a PRICED run model and a tiny
   per-run cap, a run that keeps working ends 'budget' — and no failure review (or any other run-end pass) is called. A run that
   fails for another reason still gets its review (the gate is the cap, not the failure). In test/http.list (child-process boot). */
'use strict';

const A = require('./_assert.js');
const http = require('http');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

const HOST = '127.0.0.1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RUN_MODEL = 'run/priced', AUX_MODEL = 'aux/cheap';

function sse(res, deltas, usage, finishReason) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  for (const delta of deltas) res.write('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n');
  res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason || 'stop' }], usage }) + '\n\n');
  res.write('data: [DONE]\n\n');
  res.end();
}

function startMock() {
  const state = { calls: [] };
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [
          { id: RUN_MODEL, context_length: 8000, pricing: { prompt: '0.001', completion: '0.001' }, supported_parameters: ['tools'] },
          { id: AUX_MODEL, context_length: 8000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['reasoning'] }
        ] }));
        return;
      }
      if (req.url.indexOf('/chat/completions') < 0) { res.writeHead(404); res.end(); return; }
      let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
        const body = JSON.parse(raw), messages = body.messages || [];
        const sysMsg = messages.find(m => m && m.role === 'system');
        const sys = sysMsg ? (typeof sysMsg.content === 'string' ? sysMsg.content : JSON.stringify(sysMsg.content)) : '';
        const rec = { model: body.model, main: raw.indexOf('[RUNTIME]') >= 0, failReview: sys.indexOf('reviewing a task run of yours that FAILED') >= 0 };
        state.calls.push(rec);
        if (rec.failReview) { sse(res, [{ content: 'LESSON: check the cap before a long inspection loop' }], { prompt_tokens: 6, completion_tokens: 4, total_tokens: 10 }, 'stop'); return; }
        if (rec.main && raw.indexOf('CAPRUN') >= 0) {
          // keep working: a tool turn every time, each one priced, until the per-run cap stops the run
          const n = messages.filter(m => m && m.role === 'tool').length;
          sse(res, [{ tool_calls: [{ index: 0, id: 'inspect_' + n, type: 'function', function: { name: 'station_inspect', arguments: '{}' } }] }],
            { prompt_tokens: 400, completion_tokens: 50, total_tokens: 450 }, 'tool_calls');
          return;
        }
        if (rec.main && raw.indexOf('FAILRUN') >= 0) {
          if (!messages.some(m => m && m.role === 'tool')) {
            sse(res, [{ tool_calls: [{ index: 0, id: 'inspect_once', type: 'function', function: { name: 'station_inspect', arguments: '{}' } }] }], { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 }, 'tool_calls');
            return;
          }
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'main stream rejected (test fault injection)', code: 400 } }));
          return;
        }
        sse(res, [{ content: 'ok.' }], { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }, 'stop');
      });
    });
    server.listen(0, HOST, () => resolve({ server, state, base: 'http://' + HOST + ':' + server.address().port + '/api/v1' }));
  });
}

async function driveRun(fixture, agentId, text) {
  const r = await fixture.request('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'sk-or-v1-capreview-fake', model: RUN_MODEL, agentId, isTask: true, messages: [{ role: 'user', content: text }] }) });
  A.eq(r.status, 200, 'the /api/run stream opened for ' + agentId);
  return (await r.text()).split('\n').map(l => l.trim()).filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}
const endReason = ev => { const e = ev.filter(x => x.name === 'agent.run.end').pop(); return e && e.payload && e.payload.reason; };
async function settle(state) { let last = -1, since = Date.now(); const until = Date.now() + 10000; while (Date.now() < until) { if (state.calls.length !== last) { last = state.calls.length; since = Date.now(); } else if (Date.now() - since >= 1500) break; await sleep(200); } }

(async () => {
  const mock = await startMock();
  const fixture = SidecarFixture.create({ prefix: 'sk-capreview-',
    env: { SKYNET_OPENROUTER_BASE: mock.base, STARNET_AUX_MODEL: AUX_MODEL, SKYNET_AUX_BUDGET: '0', SKYNET_QUEST_REFRESH: '0', SKYNET_FULL_ACCESS: '1', SKYNET_BUDGET_PER_RUN: '1' } });
  await fixture.start();
  try {
    const reviews = () => mock.state.calls.filter(c => c.failReview).length;
    // a run the per-run cap stops: no review after it
    const ev = await driveRun(fixture, 'cap-agent', 'CAPRUN inspect the station over and over');
    A.eq(endReason(ev), 'budget', 'the run was stopped by its spending cap');
    await settle(mock.state);
    A.eq(reviews(), 0, 'no failure review was called after a run its cap stopped (it would spend past the cap)');
    // a run that fails another way still gets its review: the gate is the cap, not the failure
    const ev2 = await driveRun(fixture, 'err-agent', 'FAILRUN inspect the station then push the update');
    A.eq(endReason(ev2), 'error', 'fixture: a run ending error');
    await settle(mock.state);
    A.eq(reviews(), 1, 'a run that failed for another reason still gets its one review');
  } finally {
    await fixture.dispose();
    await new Promise(r => mock.server.close(r));
  }
  A.report('failreview-budget.e2e.test');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
