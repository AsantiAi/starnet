/* node test/remote.e2e.test.js — StarNet Remote phase 1 against a REAL booted sidecar.

   A mock provider plays the model (zero spend). The phone is sidecar/remote/phone-client.js, the WebCrypto-only
   client a phone browser runs. What this proves, in order:
     1. Remote is OFF by default: no LAN door, pairing refused, and /api/remote is behind the desk token.
     2. The desk switches it on; a phone pairs with a one-time code over the LAN door and opens a sealed session.
     3. The phone starts a real task. The run asks to run a shell command; the approval reaches the phone as an
        event; the phone approves ONCE; the run finishes and its reply is in the conversation.
     4. A phone cannot grant ALWAYS / FULL ACCESS.
     5. A run is DETACHED: the phone disconnects mid-run, the run still finishes, and the reply is there on reconnect.
     6. A DESKTOP run's approval is answerable from the phone, and the desk stream learns it was answered.
     7. The LAN door serves no /api route; revoke cuts a phone off at once.
     8. Across a restart: Remote stays on, the station key and the paired phone persist, and the phone reconnects. */
'use strict';
const A = require('./_assert.js');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');
const Phone = require('../sidecar/remote/phone-client.js');

const HOST = '127.0.0.1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitUntil(fn, ms, label) { const t = Date.now() + ms; while (Date.now() < t) { if (await fn()) return; await sleep(30); } throw new Error('timed out waiting for ' + label); }
function freePort() { return new Promise((resolve, reject) => { const s = net.createServer(); s.on('error', reject); s.listen(0, HOST, () => { const p = s.address().port; s.close(() => resolve(p)); }); }); }

/* The model: each task is a tiny script keyed on the LAST user message.
     "remote shell proof"   -> brief_proceed, then shell_exec (needs approval), then "REMOTE_SHELL_DONE"
     "desk shell proof"     -> same shape for a desktop /api/run, answering "DESK_SHELL_DONE"
     "slow reply"           -> holds the stream open until release(), then "SLOW_DONE"
     anything else          -> "OK" */
function startMockModel() {
  const gate = { held: null, release() { const r = gate.held; gate.held = null; if (r) r(); } };
  const requests = [];
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 8000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
      }
      if (req.url.indexOf('/chat/completions') < 0) { res.writeHead(404); return res.end(); }
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', async () => {
        let parsed = {}; try { parsed = JSON.parse(body); } catch (_) {}
        requests.push(parsed);
        const msgs = parsed.messages || [];
        const lastUser = [...msgs].reverse().find(m => m && m.role === 'user');
        const text = String((lastUser && (typeof lastUser.content === 'string' ? lastUser.content : JSON.stringify(lastUser.content))) || '');
        const after = msgs.slice(msgs.lastIndexOf(lastUser) + 1);
        const tools = after.filter(m => m && m.role === 'tool');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const call = (id, name, args) => {
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }) + '\n\n');
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }) + '\n\n');
          res.end('data: [DONE]\n\n');
        };
        const say = async (answer, hold) => {
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: answer.slice(0, 3) } }] }) + '\n\n');
          if (hold) await new Promise(r => { gate.held = r; });
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: answer.slice(3) } }] }) + '\n\n');
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }) + '\n\n');
          res.end('data: [DONE]\n\n');
        };
        const shellScript = (tag, done) => {
          if (tools.length === 0) return call('b_' + tag, 'brief_proceed', { objective: 'Run the ' + tag + ' proof' });
          if (!tools.some(m => /SHELL_OK_/.test(JSON.stringify(m))) && tools.length < 3) return call('s_' + tag, 'shell_exec', { cmd: 'echo SHELL_OK_' + tag + '> ' + tag + '-proof.txt && type ' + tag + '-proof.txt' });
          return say(done);
        };
        if (/remote shell proof/i.test(text)) return shellScript('remote', 'REMOTE_SHELL_DONE');
        if (/desk shell proof/i.test(text)) return shellScript('desk', 'DESK_SHELL_DONE');
        if (/slow reply/i.test(text)) return say('SLOW_DONE', true);
        return say('OK');
      });
    });
    server.listen(0, HOST, () => resolve({ server, gate, requests, base: 'http://' + HOST + ':' + server.address().port + '/api/v1' }));
  });
}

(async () => {
  const llm = await startMockModel();
  const lanPort = await freePort();
  const fx = new SidecarFixture({ prefix: 'sn-remote-e2e-', timeoutMs: 15000, env: {
    SKYNET_OPENROUTER_BASE: llm.base, STARNET_OPENROUTER_BASE: llm.base,
    SKYNET_OPENROUTER_KEY: 'sk-or-v1-remote-fake', STARNET_OPENROUTER_KEY: 'sk-or-v1-remote-fake',
    SKYNET_DEFAULT_MODEL: 'test/model', STARNET_DEFAULT_MODEL: 'test/model',
    STARNET_REMOTE_PORT: String(lanPort)
  } });
  const lan = 'http://' + HOST + ':' + lanPort;
  let client = null;
  const deskEvents = [];
  try {
    await fx.start();

    // 1. off by default, and the desk switch is behind the desk token
    const noTok = await fetch(fx.baseUrl + '/api/remote', { headers: { Origin: fx.baseUrl } });
    A.ok(noTok.status === 401 || noTok.status === 403, '/api/remote needs the desk token (got ' + noTok.status + ')');
    const off = await fx.json('GET', '/api/remote');
    A.eq(off.body.enabled, false, 'Remote is off by default');
    A.eq(off.body.listening, false, 'nothing listens on the LAN by default');
    A.eq((await fx.json('POST', '/api/remote/pair', {})).status, 409, 'pairing is refused while Remote is off');
    let lanClosed = false; try { await fetch(lan + '/remote/v1/info', { signal: AbortSignal.timeout(1500) }); } catch (_) { lanClosed = true; }
    A.ok(lanClosed, 'the LAN door is closed while Remote is off');

    const roster = await fx.json('POST', '/api/roster', { agents: [{ agentId: 'forge', name: 'FORGE', system: 'You are FORGE, a builder.', model: 'test/model' }] });
    A.eq(roster.status, 200, 'roster saved');

    // 2. switch on, pair, open a sealed session
    const on = await fx.json('POST', '/api/remote/enable', { on: true });
    A.eq(on.body.enabled, true, 'Remote switched on');
    A.eq(on.body.port, lanPort, 'the LAN door opened on the configured port');
    const pr = await fx.json('POST', '/api/remote/pair', { name: 'Test phone' });
    A.eq(pr.status, 200, 'pairing code issued');
    A.ok(/^[A-Z2-9]{8}$/.test(pr.body.code), 'code shape');
    const blob = JSON.parse(Buffer.from(pr.body.pairBlob.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    A.eq(blob.c, pr.body.code, 'the pairing blob carries the code for the QR');
    A.ok(pr.body.pairUrl === null || /\/remote\/app\/#pair=/.test(pr.body.pairUrl), 'the pair URL keeps the secret in the fragment');

    const key = await Phone.makeDeviceKey();
    const paired = await Phone.pair({ base: lan, pairingId: pr.body.pairingId, code: pr.body.code, name: 'Test phone', key });
    A.ok(/^dev_/.test(paired.deviceId), 'phone paired over the LAN door');
    const st = await fx.json('GET', '/api/remote');
    A.eq(st.body.devices.length, 1, 'the desk lists the paired phone');
    A.eq(st.body.devices[0].name, 'Test phone', 'with its name');

    client = Phone.connect({ base: lan, deviceId: paired.deviceId, stationPub: pr.body.stationPub, key });
    const status = await client.call('status');
    A.eq(status.ok, true, 'status over the sealed channel');
    A.ok(status.data.agents.some(a => a.agentId === 'forge' && a.state === 'idle'), 'the phone sees FORGE idle');

    const events = [];
    client.onEvent(e => events.push(e));
    const listening = client.listen();
    await waitUntil(async () => (await fx.json('GET', '/api/remote')).body.connected.some(c => c.live), 5000, 'phone event stream attached');

    // 3. a real task from the phone, with an approval answered on the phone
    const sent = await client.call('send', { agentId: 'forge', text: 'remote shell proof' });
    A.eq(sent.ok, true, 'send accepted: ' + JSON.stringify(sent));
    const runId = sent.data.runId, streamId = sent.data.streamId;
    await waitUntil(() => events.some(e => e.type === 'approval.opened' && e.approval.runId === runId), 20000, 'approval event on the phone');
    const ap = events.find(e => e.type === 'approval.opened' && e.approval.runId === runId).approval;
    A.eq(ap.surface, 'remote', 'the approval is marked as a phone run');
    A.eq(ap.tool, 'shell.exec', 'the approval names the tool');
    A.ok(/SHELL_OK_remote/.test(ap.argsSummary), 'the approval shows what will run');

    // 4. no standing grants from a phone
    const always = await client.call('decide', { runId, promptId: ap.promptId, decision: 'always' });
    A.eq(always.ok, false, 'a phone cannot grant ALWAYS');
    const full = await client.call('decide', { runId, promptId: ap.promptId, decision: 'full' });
    A.eq(full.ok, false, 'a phone cannot grant FULL ACCESS');
    const seen = await client.call('seen', { runId, promptId: ap.promptId });
    A.eq(seen.data.extended, true, 'showing it to a human earns the one extension');
    const once = await client.call('decide', { runId, promptId: ap.promptId, decision: 'once' });
    A.eq(once.ok, true, 'approve once from the phone');
    await waitUntil(() => events.some(e => e.type === 'run.ended' && e.runId === runId), 30000, 'run end on the phone');
    const ended = events.find(e => e.type === 'run.ended' && e.runId === runId);
    A.eq(ended.error, null, 'the run ended without error: ' + JSON.stringify(ended));
    A.ok(events.some(e => e.type === 'run.tool' && e.runId === runId && e.name === 'shell_exec'), 'the phone saw the step');
    A.ok(events.some(e => e.type === 'run.step' && e.runId === runId && e.ok), 'and that the step succeeded');
    const th = await client.call('thread', { streamId });
    A.ok(th.data.some(t => t.role === 'user' && /remote shell proof/.test(t.content)), 'the conversation holds the phone message');
    A.ok(th.data.some(t => t.role === 'assistant' && /REMOTE_SHELL_DONE/.test(t.content)), 'and the agent reply');
    const files = await client.call('fetch', { agentId: 'forge', path: 'remote-proof.txt' });
    A.eq(files.ok, true, 'the phone can read the file the run wrote: ' + JSON.stringify(files).slice(0, 200));
    A.ok(files.ok && /SHELL_OK_remote/.test(Buffer.from(files.data.data, 'base64').toString('utf8')), 'with its real contents');
    A.eq((await client.call('fetch', { agentId: 'forge', path: '../../.secrets/remote.json' })).ok, false, 'the file jail holds from a phone');

    // 5. detached: the phone drops mid-run; the run still finishes
    const slow = await client.call('send', { agentId: 'forge', text: 'slow reply', streamId });
    A.eq(slow.ok, true, 'slow task accepted');
    await waitUntil(() => !!llm.gate.held, 20000, 'model holding the slow reply');
    client.close();
    await Promise.race([listening, sleep(1000)]);
    await waitUntil(async () => !(await fx.json('GET', '/api/remote')).body.connected.some(c => c.live), 5000, 'phone stream detached');
    llm.gate.release();
    const client2 = Phone.connect({ base: lan, deviceId: paired.deviceId, stationPub: pr.body.stationPub, key });
    await waitUntil(async () => { const t = await client2.call('thread', { streamId }); return t.data.some(x => x.role === 'assistant' && /SLOW_DONE/.test(x.content)); }, 20000, 'slow reply after reconnect');
    A.ok(true, 'a run started from the phone finished while the phone was gone, and the reply was there on reconnect');
    client = client2;

    // 6. a DESKTOP run's approval, answered from the phone
    const deskReq = fx.request('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ key: 'sk-or-v1-remote-fake', model: 'test/model', agentId: 'forge', isTask: true, placed: [{ objectType: 'computer' }, { objectType: 'workbench' }], messages: [{ role: 'user', content: 'desk shell proof' }] }) });
    const deskDone = deskReq.then(async (r) => {
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; try { deskEvents.push(JSON.parse(line)); } catch (_) {} } }
    });
    let deskAp = null;
    await waitUntil(async () => { const l = await client.call('approvals'); deskAp = l.data.find(x => x.surface === 'desk'); return !!deskAp; }, 20000, 'desk approval visible on the phone');
    A.eq(deskAp.agentId, 'forge', 'the desk approval names its agent');
    const deskOnce = await client.call('decide', { runId: deskAp.runId, promptId: deskAp.promptId, decision: 'once' });
    A.eq(deskOnce.ok, true, 'the phone approves a desktop run');
    await deskDone;
    A.ok(deskEvents.some(e => e.name === 'permission.response' && e.payload.promptId === deskAp.promptId && e.payload.decision === 'once'), 'the desk stream is told the prompt was answered');
    A.ok(deskEvents.some(e => e.name === 'agent.token' && /DESK_SHELL_DONE|SHELL_DONE/.test(JSON.stringify(e.payload))) || deskEvents.some(e => /DESK_SHELL_DONE/.test(JSON.stringify(e))), 'the desktop run finished after the phone approved it');
    A.eq((await client.call('approvals')).data.length, 0, 'nothing left waiting');

    // 7. the LAN door is not the API; revoke cuts a phone off
    A.eq((await fetch(lan + '/api/remote')).status, 404, 'the LAN door serves no /api route');
    A.eq((await fetch(lan + '/')).status, 404, 'nor the station page');

    // a second phone, to carry through the restart
    const pr2 = await fx.json('POST', '/api/remote/pair', { name: 'Tablet' });
    const key2 = await Phone.makeDeviceKey();
    const paired2 = await Phone.pair({ base: lan, pairingId: pr2.body.pairingId, code: pr2.body.code, name: 'Tablet', key: key2 });

    const rv = await fx.json('POST', '/api/remote/revoke', { deviceId: paired.deviceId });
    A.eq(rv.status, 200, 'revoke');
    let cut = false; try { await client.call('status'); } catch (_) { cut = true; }
    A.ok(cut, 'the revoked phone is cut off at once');
    let hello = false; try { await Phone.connect({ base: lan, deviceId: paired.deviceId, stationPub: pr.body.stationPub, key }).call('status'); } catch (e) { hello = /unknown device/.test(e.message); }
    A.ok(hello, 'and cannot say hello again');

    // 8. restart: switch, station key and paired phone persist; the door reopens
    const raw = fs.readFileSync(path.join(fx.workspace, '.secrets', 'remote.json'), 'utf8');
    A.ok(raw.indexOf(key2.publicRaw) >= 0 && raw.indexOf(key.publicRaw) < 0, 'on disk: the kept phone, not the revoked one');
    await fx.restart();
    const after = await fx.json('GET', '/api/remote');
    A.eq(after.body.enabled, true, 'Remote is still on after a restart');
    A.eq(after.body.listening, true, 'the LAN door reopened on boot');
    A.eq(after.body.devices.map(d => d.name), ['Tablet'], 'the paired phone survived the restart');
    const c3 = Phone.connect({ base: lan, deviceId: paired2.deviceId, stationPub: pr2.body.stationPub, key: key2 });
    A.eq((await c3.call('status')).ok, true, 'the phone reconnects after a restart with the same station key');

    const offAgain = await fx.json('POST', '/api/remote/enable', { on: false });
    A.eq(offAgain.body.listening, false, 'switching off closes the door');
    let shut = false; try { await c3.call('status'); } catch (_) { shut = true; }
    A.ok(shut, 'and ends live phone sessions');
  } catch (e) {
    A.ok(false, 'threw: ' + (e && e.stack || e) + '\n--- desk events ---\n' + deskEvents.map(x => x.name + ' ' + JSON.stringify(x.payload).slice(0, 200)).join('\n') + '\n--- sidecar output tail ---\n' + String(fx.output ? fx.output() : '').slice(-3000));
  } finally {
    try { client && client.close(); } catch (_) {}
    await fx.dispose();
    llm.server.close();
  }
  A.report('remote e2e');
})();
