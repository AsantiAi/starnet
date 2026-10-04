/* dev/seed-comms-convo.js — DEV-ONLY launcher for COMMS readability work.

   Same shape as seed-mock-comms.js (real sidecar + real frontend + in-process mock OpenRouter), but the
   mock answers each user turn with the NEXT reply from a rotating set of realistic agent answers — short
   acks, multi-paragraph prose, lists, a code block — so a few sends build a transcript that looks like a
   real working conversation. Not part of any test/build; SKYNET_DEV never ships. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'seed-workspace');
const SCRATCH = path.join(__dirname, '.scratch-comms-convo');
const SIDECAR = path.join(REPO, 'sidecar', 'index.js');
const PORT = String(process.env.SKYNET_PORT || '8931');

const REPLIES = [
  'On it. I checked the repo layout first so I don\'t step on anything already in flight.',
  'Here\'s what I found:\n\n- The **landing page** loads three fonts but only uses one.\n- Images ship at full resolution — the hero alone is 2.4 MB.\n- There\'s no caching header on the static folder.\n\nThe image fix is the biggest win. Want me to start there?',
  'Done. I resized the hero to 1600px wide and converted it to WebP, which took it from 2.4 MB to 180 KB.\n\nI left the originals in `assets/originals/` in case you want them back.',
  'Quick one: should the newsletter signup go above or below the pricing table? Above gets more eyes, below catches people who already read the pitch.',
  'Makes sense. Here\'s the snippet I added to the footer:\n\n```html\n<form class="signup" action="/subscribe">\n  <input type="email" name="email" required>\n  <button>Join</button>\n</form>\n```\n\nIt posts to the same endpoint the old modal used, so nothing on the server side changes.',
  'Yep — that\'s all wired up. Anything else for tonight?'
];

function startMock() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 8000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
        return;
      }
      if (req.url.indexOf('/chat/completions') >= 0) {
        let b = ''; req.on('data', d => b += d); req.on('end', () => {
          let users = 1, lastUser = '', toolsSince = 0;
          try {
            const msgs = JSON.parse(b).messages || [];
            users = msgs.filter(m => m && m.role === 'user').length || 1;
            const li = msgs.map(m => m && m.role).lastIndexOf('user');
            lastUser = String((msgs[li] && msgs[li].content) || '');
            toolsSince = msgs.slice(li + 1).filter(m => m && m.role === 'tool').length;
            if (process.env.SKYNET_MOCK_LOG) fs.appendFileSync(process.env.SKYNET_MOCK_LOG, JSON.stringify(msgs.slice(li).map(m => [m.role, String(m.content || '').slice(0, 90), m.tool_calls ? 'TC' : ''])) + '\n');
          } catch (_) {}
          let reply = REPLIES[(users - 1) % REPLIES.length];
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          // a TOOL TURN: "…files…" walks fs_list → fs_read → prose, so the transcript shows a real tool rail + fold
          if (/files/i.test(lastUser) && toolsSince < 2) {
            const call = toolsSince === 0 ? { name: 'fs_list', arguments: JSON.stringify({ path: '.' }) } : { name: 'fs_list', arguments: JSON.stringify({ path: 'src' }) };
            const pre = toolsSince === 0 ? 'Let me look around first.' : '';
            setTimeout(() => {
              if (pre) res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: pre } }] }) + '\n\n');
              res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + toolsSince + '_' + Date.now(), type: 'function', function: call }] } }] }) + '\n\n');
              res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } }) + '\n\n');
              res.write('data: [DONE]\n\n'); res.end();
            }, 500);
            return;
          }
          if (/files/i.test(lastUser)) reply = 'The project has a `README.md`, a `src/` folder and a `package.json`. The README says it\'s a static site built with Vite — nothing unusual.';
          setTimeout(() => {
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: reply } }] }) + '\n\n');
            res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } }) + '\n\n');
            res.write('data: [DONE]\n\n'); res.end();
          }, 600);
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port + '/api/v1'));
  });
}

(async () => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.cpSync(FIXTURE, SCRATCH, { recursive: true });
  const now = Date.now();
  try {
    const sp = path.join(SCRATCH, 'agent.save.json');
    const w = JSON.parse(fs.readFileSync(sp, 'utf8'));
    w.updatedAt = now; w.savedAt = now;
    if (w.doc) { w.doc.updatedAt = now; if (w.doc.agent) w.doc.agent.model = 'test/model'; }
    fs.writeFileSync(sp, JSON.stringify(w, null, 2));
  } catch (_) {}
  const base = await startMock();
  const env = Object.assign({}, process.env, {
    SKYNET_DEV: '1', SKYNET_FULL_ACCESS: '1',
    SKYNET_WORKSPACES: SCRATCH, SKYNET_PORT: PORT,
    SKYNET_OPENROUTER_BASE: base, SKYNET_OPENROUTER_KEY: 'sk-or-v1-mock', SKYNET_DEFAULT_MODEL: 'test/model'
  });
  console.log('[seed-comms-convo] mock provider at ' + base + ' -> http://127.0.0.1:' + PORT);
  const child = spawn(process.execPath, [SIDECAR], { cwd: REPO, env, stdio: 'inherit' });
  process.on('SIGINT', () => { try { child.kill(); } catch (_) {} });
  child.on('exit', c => process.exit(c == null ? 0 : c));
})();
