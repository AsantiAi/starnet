/* sidecar/providers/claude-cli.js — the local Claude Code CLI (`claude`) as a brain.

   Instead of an HTTP call, every stream() turn spawns ONE `claude -p` child process, feeds it the transcript on
   stdin and translates its `--output-format stream-json` lines into the LLMProvider HarnessEvents (provider.js).
   The child's life IS the turn: text streams only while it runs, and exactly one 'done' is emitted when it has
   really exited with a result — the station never animates a brain that is not running.

   CAPABILITY BOUNDARY. The CLI is an agent with its own tools (Bash, Edit, MCP connectors…). Letting it use them
   would bypass StarNet's capability gate and consent broker, so the child is started with NO tools at all:
   `--tools ""`, an empty `--strict-mcp-config`, no skills/slash commands, no setting sources, no session file.
   StarNet's own tools are described in the system prompt, and the model requests them with
   <tool_call>{"name":…,"arguments":{…}}</tool_call> blocks. This adapter turns those blocks into the ordinary
   tool_start/tool_args/tool_done events, so loop.js executes them through the same gate as every other provider.

   COST TRUTH. The CLI's final `result` line carries real usage and `total_cost_usd`. Its `init` line says how it
   is authenticated: apiKeySource 'none' = a Claude subscription login (Pro/Max), which bills nothing per call,
   so the turn is booked at $0 with its real token counts; any API-key source bills real money, so the CLI's
   reported cost is booked as the provider cost (cost.js `usage.cost`).

   STOP. Aborting req.signal kills the child's whole process tree (taskkill /T on Windows) before returning.

   ACCOUNTS. `configDir` points the CLI at one extra sign-in (subscription stacking): the child runs with
   CLAUDE_CONFIG_DIR=<configDir>, a separate CLI identity whose credential the CLI keeps in that folder (proven:
   an empty folder answers `auth status` signed out while ~/.claude stays signed in). No configDir = the CLI's
   own default sign-in. A spent subscription (the CLI's `error:"rate_limit"` line, "You've hit your limit") is
   thrown as a 429 `usage_limit_reached`, which errorClass files as quota_exhausted: the loop rotates to the next
   account instead of retrying this one.

   makeClaudeCliProvider({ spawn?, bin?, env?, configDir?, platform?, fs?, os?, idleMs?, statusTtlMs? })
     -> { stream, listModels, contextLimit, priceOf, supportsTools, reasoningEfforts } */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./provider.js'));
  else { root.SK = root.SK || {}; (root.SK.providers = root.SK.providers || {}).claudeCli = factory(root.SK.providers.provider); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (provider) {
  'use strict';

  const timeouts = provider.timeouts;
  // failopen.note — the tagged SYNC swallow (per-tag count + throttled warn): a fail-open catch must never be invisible.
  const { note: failNote } = (typeof require === 'function') ? require('../failopen.js') : { note: function (tag, e) { console.warn('[failopen] ' + tag + ':', (e && e.message) || e); } };
  const DEFAULT_CONTEXT = 200000;
  /* What `claude --model` runs on a subscription sign-in — every id here was proven live 2026-09-29 (a one-line call
     each; the CLI answered on exactly that model). Named models first; the `[1m]` ids are the CLI's own 1M-context
     variants. The bare aliases come last: they always follow the newest model of each family, and they stay listed
     because a station pinned to one (every claude-cli station before this list) must keep a model the catalog
     proves — ModelDock clears a pin the live catalog no longer carries. Fable is left out on purpose: the CLI
     accepts it but an account without Fable is silently served Opus 4.8, so listing it would name a model the run
     did not use. */
  const MODELS = [
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    { id: 'claude-opus-5-5[1m]', name: 'Claude Opus 5.5 · 1M context', context: 1000000 },
    { id: 'claude-sonnet-5-5[1m]', name: 'Claude Sonnet 5.5 · 1M context', context: 1000000 },
    { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { id: 'opus', name: 'Latest Claude Opus · follows new releases' },
    { id: 'sonnet', name: 'Latest Claude Sonnet · follows new releases' },
    { id: 'haiku', name: 'Latest Claude Haiku · follows new releases' }
  ];
  const contextOf = id => { const m = MODELS.find(x => x.id === String(id || '')); return (m && m.context) || (/\[1m\]$/i.test(String(id || '')) ? 1000000 : DEFAULT_CONTEXT); };
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const CALL_OPEN = '<tool_call>';
  const CALL_CLOSE = '</tool_call>';
  const NO_TOOLS_ARGS = [
    '--tools', '',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--disable-slash-commands',
    '--setting-sources', '',
    '--no-session-persistence'
  ];

  function textOf(content) {
    if (content == null) return '';
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return typeof content.text === 'string' ? content.text : '';
    const parts = [];
    for (const p of content) {
      if (typeof p === 'string') parts.push(p);
      else if (p && typeof p.text === 'string') parts.push(p.text);
      // The CLI's text input has no image channel: say so rather than silently dropping the attachment.
      else if (p && (p.type === 'image_url' || p.type === 'image')) parts.push('[image attachment omitted — the Claude Code brain cannot see images]');
    }
    return parts.join('\n');
  }

  function toolsPrompt(tools) {
    const list = [];
    for (const item of (Array.isArray(tools) ? tools : [])) {
      const fn = (item && item.function) || {};
      const name = String(fn.name || '').trim();
      if (!name) continue;
      list.push('- ' + name + (fn.description ? ': ' + String(fn.description).trim() : '') +
        '\n  parameters: ' + JSON.stringify(fn.parameters || { type: 'object', properties: {} }));
    }
    // A turn with NO tools still says so: a Claude Code model told about station powers in the system prompt otherwise
    // improvises its own native tool-call markup as TEXT (live 09-28: '<invoke name="Bash">…' leaked into a chat reply).
    if (!list.length) return '# Tools\nNo tools are available in this turn. Answer in plain prose only: never write tool-call markup (<tool_call>, <invoke>, <function_calls>) and never claim to have run anything.';
    return [
      '# Tools',
      'You cannot execute anything yourself; StarNet runs tools for you. To call a tool, write a block exactly like:',
      CALL_OPEN + '{"name": "<tool name>", "arguments": {<arguments matching its parameters>}}' + CALL_CLOSE,
      'Rules:',
      '- You may write several ' + CALL_OPEN + ' blocks in one reply. After the last one, STOP: the results arrive in the next message as <tool_result> blocks.',
      '- Use only the tools listed below. Never write <tool_result> blocks yourself and never invent a result.',
      '- When no tool is needed, answer normally without any ' + CALL_OPEN + ' block.',
      '',
      'Available tools:',
      list.join('\n')
    ].join('\n');
  }

  /* Leading system messages become the CLI system prompt; everything after is rendered as a tagged transcript
     on stdin (later system messages stay in place as notes, like the native Anthropic adapter keeps them). */
  function buildPrompt(messages, tools) {
    messages = provider.repairToolPairs(Array.isArray(messages) ? messages : []);
    const system = [];
    let i = 0;
    for (; i < messages.length && messages[i] && messages[i].role === 'system'; i++) {
      const t = textOf(messages[i].content).trim();
      if (t) system.push(t);
    }
    const tp = toolsPrompt(tools);
    if (tp) system.push(tp);
    const rest = messages.slice(i).filter(m => m && typeof m === 'object');
    if (rest.length === 1 && rest[0].role === 'user') return { system: system.join('\n\n'), input: textOf(rest[0].content) };
    const lines = ['<conversation>'];
    for (const m of rest) {
      if (m.role === 'user') lines.push('<user>\n' + textOf(m.content) + '\n</user>');
      else if (m.role === 'system') lines.push('<system_note>\n' + textOf(m.content) + '\n</system_note>');
      else if (m.role === 'tool') lines.push('<tool_result id="' + String(m.tool_call_id || '') + '">\n' + textOf(m.content) + '\n</tool_result>');
      else if (m.role === 'assistant') {
        let body = textOf(m.content);
        for (const tc of (Array.isArray(m.tool_calls) ? m.tool_calls : [])) {
          const fn = (tc && tc.function) || {};
          let args = fn.arguments;
          if (typeof args === 'string') { try { args = JSON.parse(args || '{}'); } catch (_) { args = String(args); } }
          body += (body ? '\n' : '') + CALL_OPEN + JSON.stringify({ id: tc && tc.id, name: fn.name, arguments: args == null ? {} : args }) + CALL_CLOSE;
        }
        lines.push('<assistant>\n' + body + '\n</assistant>');
      }
    }
    lines.push('</conversation>');
    lines.push('Continue as the assistant: write only your next reply.');
    return { system: system.join('\n\n'), input: lines.join('\n') };
  }

  /* Streaming splitter: passes prose through as soon as it cannot be the start of a <tool_call> block, and
     captures each complete block's body. */
  function makeCallSplitter() {
    let buf = '', inCall = false;
    function drain(out) {
      for (;;) {
        if (!inCall) {
          const at = buf.indexOf(CALL_OPEN);
          if (at >= 0) { out.text += buf.slice(0, at); buf = buf.slice(at + CALL_OPEN.length); inCall = true; continue; }
          let keep = 0;
          for (let k = Math.min(CALL_OPEN.length - 1, buf.length); k > 0; k--) {
            if (buf.endsWith(CALL_OPEN.slice(0, k))) { keep = k; break; }
          }
          out.text += buf.slice(0, buf.length - keep);
          buf = buf.slice(buf.length - keep);
          return out;
        }
        const end = buf.indexOf(CALL_CLOSE);
        if (end < 0) return out;
        out.calls.push(buf.slice(0, end));
        buf = buf.slice(end + CALL_CLOSE.length);
        inCall = false;
      }
    }
    return {
      push(delta) { buf += String(delta || ''); return drain({ text: '', calls: [] }); },
      // A block the model never closed still counts as a call when its body parses; otherwise it is prose.
      end() {
        const out = { text: '', calls: [] };
        if (inCall) { if (parseCall(buf)) out.calls.push(buf); else out.text += CALL_OPEN + buf; }
        else out.text += buf;
        buf = ''; inCall = false;
        return out;
      }
    };
  }

  function parseCall(body) {
    let j;
    try { j = JSON.parse(String(body || '').trim()); } catch (_) { return null; }
    if (!j || typeof j !== 'object' || typeof j.name !== 'string' || !j.name.trim()) return null;
    const args = j.arguments != null ? j.arguments : (j.input != null ? j.input : {});
    return { name: j.name.trim(), args: typeof args === 'string' ? args : JSON.stringify(args) };
  }

  /* The local-CLI plumbing the provider AND the sign-in driver share: find the binary, build its station-free env,
     kill its process tree, ask `claude auth status`. */
  function makeCliHost(opts) {
    opts = opts || {};
    const childEnvLib = require('../child-env.js');
    const cp = opts.spawn ? null : childEnvLib.guardChildProcess(require('node:child_process'));
    const spawn = opts.spawn || cp.spawn;
    const fs = opts.fs || require('fs');
    const os = opts.os || require('os');
    const path = require('path');
    const env = opts.env || process.env;
    const platform = opts.platform || process.platform;

    function isFile(p) {
      try { return fs.statSync(p).isFile(); } catch (_) { return false; }
    }
    // A `claude.cmd` npm shim cannot be spawned without a shell, so it runs as `node <cli.js>` instead.
    function which(name) {
      const exts = platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
      for (const dir of String(env.PATH || env.Path || '').split(path.delimiter)) {
        if (!dir) continue;
        for (const ext of exts) {
          const p = path.join(dir, name + ext);
          if (isFile(p)) return p;
        }
      }
      return '';
    }
    function command() {
      const configured = String(opts.bin || env.STARNET_CLAUDE_BIN || '').trim();
      let bin = configured || which('claude');
      if (!bin && platform === 'win32' && env.USERPROFILE) {
        const native = path.join(env.USERPROFILE, '.local', 'bin', 'claude.exe');
        if (isFile(native)) bin = native;
      }
      if (!bin && platform !== 'win32' && env.HOME) {
        const native = path.join(env.HOME, '.local', 'bin', 'claude');   // the native installer's home on macOS/Linux
        if (isFile(native)) bin = native;
      }
      /* An app opened from the macOS Finder gets a bare PATH (/usr/bin:/bin:/usr/sbin:/sbin): Homebrew and `npm -g`
         installs were never found and the card said "not installed" (sweep 2026-10-02). Look where they live too. */
      if (!bin && platform !== 'win32') {
        for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', env.HOME ? path.join(env.HOME, '.npm-global', 'bin') : '']) {
          if (dir && isFile(path.join(dir, 'claude'))) { bin = path.join(dir, 'claude'); break; }
        }
      }
      if (!bin) return null;
      // an npm-installed `claude` is a link to a JS file with a `#!/usr/bin/env node` line — and that bare PATH has no
      // `node` either: run the script with the station's own Node instead of trusting the shebang
      if (platform !== 'win32' && typeof fs.realpathSync === 'function') {
        let real = '';
        try { real = fs.realpathSync(bin); } catch (_) { real = ''; }
        if (/\.(c|m)?js$/i.test(real)) return { file: process.execPath, pre: [real] };
      }
      if (/\.(cmd|bat)$/i.test(bin)) {
        const cli = path.join(path.dirname(bin), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
        if (isFile(cli)) return { file: process.execPath, pre: [cli] };
        return null;
      }
      return { file: bin, pre: [] };
    }
    function notInstalled() {
      const e = new Error('Claude Code is not installed on this computer — install it, then pick CLAUDE CODE and sign in with Claude');
      e.code = 'provider_not_configured';
      return e;
    }
    function notSignedIn() {
      const e = new Error('Claude Code is installed but not signed in — press SIGN IN on the CLAUDE CODE card (Settings → PROVIDERS), then retry');
      e.code = 'provider_not_configured';
      return e;
    }
    /* The CLI gets the station-free env (child-env.js: no STARNET_/SKYNET_ secrets, no station-held key values),
       and its own memory stays out of the turn: auto-memory would inject the CLI user's notes into a StarNet agent. */
    function childEnv() {
      const out = childEnvLib.stationChildEnv(env);
      delete out.CLAUDECODE;               // a sidecar started from inside a Claude Code session is not a nested session
      delete out.CLAUDE_CODE_ENTRYPOINT;
      out.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
      if (opts.configDir) out.CLAUDE_CONFIG_DIR = String(opts.configDir);   // an extra account's own CLI identity
      return out;
    }
    function killDirect(child) {
      try { child.kill(); } catch (e) { failNote('claudecli.kill', e); }
    }
    function killTree(child) {
      if (!child || child.exitCode != null) return;
      try {
        if (platform === 'win32' && child.pid) {
          const k = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
          if (k && typeof k.on === 'function') k.on('error', () => killDirect(child));
        } else child.kill('SIGTERM');
      } catch (e) { failNote('claudecli.killtree', e); killDirect(child); }
    }
    /* `claude auth status` is a free, local check (no model call). Resolves the proven state, never throws:
       { installed, loggedIn, authMethod, email?, subscription?, error? } — booleans/labels only, never a token. */
    function authStatus() {
      return new Promise(resolve => {
        const cmd = command();
        if (!cmd) return resolve({ installed: false, loggedIn: false, error: notInstalled() });
        let out = '', settled = false, child;
        const finish = (st) => { if (settled) return; settled = true; clearTimeout(timer); resolve(st); };
        const timer = setTimeout(() => { killTree(child); finish({ installed: true, loggedIn: false, error: new Error('Claude Code did not answer `claude auth status` within 15s') }); }, 15000);
        try {
          child = spawn(cmd.file, cmd.pre.concat(['auth', 'status']), { env: childEnv(), cwd: os.tmpdir(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (e) { return finish({ installed: false, loggedIn: false, error: notInstalled() }); }
        child.stdout.setEncoding('utf8');
        child.on('error', () => finish({ installed: false, loggedIn: false, error: notInstalled() }));
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', () => {});
        child.on('close', () => {
          let j = null;
          try { j = JSON.parse(out.trim()); } catch (_) { j = null; }
          const keyed = !!String(childEnv().ANTHROPIC_API_KEY || '').trim();   // only a key the CLI will actually see
          const loggedIn = !!((j && j.loggedIn === true) || keyed);
          const st = { installed: true, loggedIn, authMethod: (j && j.authMethod && j.authMethod !== 'none') ? String(j.authMethod) : (keyed ? 'api_key' : '') };
          if (j && typeof j.email === 'string' && j.email) st.email = j.email.slice(0, 200);
          if (j && typeof j.subscriptionType === 'string' && j.subscriptionType) st.subscription = j.subscriptionType.slice(0, 40);
          if (!loggedIn) st.error = notSignedIn();
          finish(st);
        });
      });
    }
    /* `claude auth logout` for this identity: the CLI clears its own credential (on macOS that is a keychain entry
       outside the config folder, so deleting the folder alone would strand it). Resolves { ok }, never throws. */
    function logout() {
      return new Promise(resolve => {
        const cmd = command();
        if (!cmd) return resolve({ ok: false });
        let settled = false, child;
        const finish = (ok) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ ok }); };
        const timer = setTimeout(() => { killTree(child); finish(false); }, 15000);
        try {
          child = spawn(cmd.file, cmd.pre.concat(['auth', 'logout']), { env: childEnv(), cwd: os.tmpdir(), windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
        } catch (_) { return finish(false); }
        child.on('error', () => finish(false));
        child.on('close', code => finish(code === 0));
      });
    }
    return { spawn, fs, os, path, env, platform, isFile, command, notInstalled, notSignedIn, childEnv, killTree, authStatus, logout };
  }

  function makeClaudeCliProvider(opts) {
    opts = opts || {};
    const host = makeCliHost(opts);
    const { spawn, fs, os, path, command, notInstalled, childEnv, killTree } = host;
    const statusTtlMs = opts.statusTtlMs != null ? opts.statusTtlMs : 60000;
    // Injected wall clock (determinism law). Without one, a proven sign-in is kept for this instance's life
    // and a failed probe is never cached — the factory builds a fresh adapter per request anyway.
    const clock = (opts.clock && typeof opts.clock.now === 'function') ? opts.clock : null;
    let status = null, statusAt = 0, statusPromise = null;
    let seq = 0;
    // tool-call ids are unique per ADAPTER, not just per turn: the factory builds a fresh adapter per request (and per
    // account on a usage-limit switch), so "call_cli_1_0" repeated in one transcript — a fallback to a provider that
    // requires unique tool ids would reject the conversation (sweep 2026-10-02)
    const idTag = require('crypto').randomBytes(4).toString('hex');

    function removeFile(p) {
      try { fs.unlinkSync(p); } catch (e) { if (!e || e.code !== 'ENOENT') failNote('claudecli.sysprompt.unlink', e); }
    }
    function statusFresh() {
      if (!status) return false;
      if (!clock) return status.ok;
      return clock.now() - statusAt < (status.ok ? statusTtlMs : 10000);
    }
    function probeStatus() {
      if (statusFresh()) return Promise.resolve(status);
      if (statusPromise) return statusPromise;
      statusPromise = host.authStatus()
        .then(st => st.loggedIn ? { ok: true, authMethod: st.authMethod } : { ok: false, error: st.error || host.notSignedIn() })
        .then(st => { status = st; statusAt = clock ? clock.now() : 0; statusPromise = null; return st; });
      return statusPromise;
    }

    async function listModels() {
      const st = await probeStatus();
      if (!st.ok) throw st.error;
      return MODELS.map(m => ({
        id: m.id, name: m.name, context_length: m.context || DEFAULT_CONTEXT, max_completion_tokens: null, pricing: null,
        supportsTools: true, supportsReasoning: true, supported_parameters: ['tools', 'reasoning'], reasoningEfforts: EFFORTS.slice()
      }));
    }

    async function* stream(req) {
      req = req || {};
      const signal = req.signal;
      if (signal && signal.aborted) return;
      const cmd = command();
      if (!cmd) throw notInstalled();
      const prompt = buildPrompt(req.messages, req.tools);
      const turn = ++seq;
      const sysFile = path.join(os.tmpdir(), 'starnet-claude-cli-' + process.pid + '-' + turn + '-' + require('crypto').randomBytes(6).toString('hex') + '.txt');
      const args = cmd.pre.concat(['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'], NO_TOOLS_ARGS);
      if (req.model) args.push('--model', String(req.model));
      const effort = String(req.reasoningEffort || '').trim().toLowerCase();
      if (EFFORTS.indexOf(effort) >= 0) args.push('--effort', effort);
      if (prompt.system) { fs.writeFileSync(sysFile, prompt.system, { encoding: 'utf8', mode: 0o600 }); args.push('--system-prompt-file', sysFile); }

      // Child output is bridged into this generator through a small queue so events are yielded as they arrive.
      const queue = [];
      let wake = null, closed = false, failure = null, exitCode = null, stderr = '';
      const push = (item) => { queue.push(item); if (wake) { const w = wake; wake = null; w(); } };
      const idle = opts.idleMs || timeouts.idleMs();
      let idleTimer = null, finished = false;
      let child;
      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (finished) return;   // late output after a stop must not re-arm a watchdog nobody is waiting on
        idleTimer = setTimeout(() => { failure = timeouts.timeoutError(idle, 'idle'); killTree(child); push(null); }, idle);
      };
      const onAbort = () => { killTree(child); push(null); };
      try {
        child = spawn(cmd.file, args, { env: childEnv(), cwd: os.tmpdir(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) {
        removeFile(sysFile);
        throw notInstalled();
      }
      if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true });
      armIdle();
      let lineBuf = '';
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.on('error', (e) => { failure = (e && e.code === 'ENOENT') ? notInstalled() : e; closed = true; push(null); });
      child.stdout.on('data', (d) => {
        armIdle();
        lineBuf += d;
        let nl;
        while ((nl = lineBuf.indexOf('\n')) >= 0) {
          const line = lineBuf.slice(0, nl).trim();
          lineBuf = lineBuf.slice(nl + 1);
          if (line) push(line);
        }
      });
      child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
      child.on('close', (code) => { exitCode = code; if (lineBuf.trim()) push(lineBuf.trim()); lineBuf = ''; closed = true; push(null); });
      // A child that dies before reading stdin surfaces through its exit (no result line), not through EPIPE here.
      child.stdin.on('error', e => failNote('claudecli.stdin', e));
      try { child.stdin.end(prompt.input || ''); } catch (e) { failNote('claudecli.stdin', e); }

      const splitter = makeCallSplitter();
      let callIndex = 0, sawText = false, result = null, apiKeySource = null, apiError = '';
      function* emitSplit(part) {
        if (part.text) { sawText = true; yield { type: 'text', delta: part.text }; }
        for (const body of part.calls) {
          const call = parseCall(body);
          if (!call) { yield { type: 'text', delta: CALL_OPEN + body + CALL_CLOSE }; continue; }
          const index = callIndex++;
          yield { type: 'tool_start', index, id: 'call_cli_' + idTag + '_' + turn + '_' + index, name: call.name };
          yield { type: 'tool_args', index, chunk: call.args };
          yield { type: 'tool_done', index };
        }
      }
      try {
        for (;;) {
          if (signal && signal.aborted) return;
          if (!queue.length) {
            if (closed) break;
            await new Promise(r => { wake = r; });
            continue;
          }
          const line = queue.shift();
          if (line == null) {
            if (signal && signal.aborted) return;
            if (failure) throw failure;
            if (closed) break;
            continue;
          }
          let j;
          try { j = JSON.parse(line); } catch (_) { continue; }
          if (j.type === 'system' && j.subtype === 'init') apiKeySource = j.apiKeySource == null ? null : String(j.apiKeySource);
          else if (j.type === 'stream_event' && j.event && j.event.type === 'content_block_delta' && j.event.delta && j.event.delta.type === 'text_delta') {
            yield* emitSplit(splitter.push(j.event.delta.text));
          } else if (j.type === 'assistant' && j.error) apiError = String(j.error);
          else if (j.type === 'result') result = j;
        }
        if (signal && signal.aborted) return;
        if (!result) {
          const tail = stderr.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 400);
          throw new Error('Claude Code exited with code ' + exitCode + ' before answering' + (tail ? ': ' + tail : ''));
        }
        const usageChunk = () => {
          const u = result.usage || {};
          const uncached = Number(u.input_tokens) || 0, cacheWrite = Number(u.cache_creation_input_tokens) || 0;
          const cacheRead = Number(u.cache_read_input_tokens) || 0, out = Number(u.output_tokens) || 0;
          const subscription = apiKeySource === 'none';
          const reported = Number(result.total_cost_usd);
          return {
            type: 'usage',
            usage: {
              prompt_tokens: uncached + cacheWrite + cacheRead,
              completion_tokens: out,
              total_tokens: uncached + cacheWrite + cacheRead + out,
              prompt_tokens_details: { cached_tokens: cacheRead, cache_creation_tokens: cacheWrite },
              reasoning_tokens: 0,
              // subscription login: nothing is billed per call. API key: the CLI's own billed figure.
              cost: subscription ? 0 : (isFinite(reported) ? reported : undefined)
            }
          };
        };
        if (result.is_error || (result.subtype && result.subtype !== 'success')) {
          // a failed turn can still have been BILLED (an API-key sign-in pays for the tokens it used): report what the
          // CLI's result line says it cost before failing, so the ledger and the caps see it (sweep 2026-10-02)
          if (result.usage || isFinite(Number(result.total_cost_usd))) yield usageChunk();
          // The CLI tags a lost sign-in on its assistant line ("error":"authentication_failed"). Carry it as a 401 so
          // errorClass files it as `auth` (fail now, say why) instead of `unknown`, which the loop retries for ~105s.
          if (apiError === 'authentication_failed') {
            const e = new Error('Claude Code is not signed in (' + String(result.result || 'authentication failed').slice(0, 200) + ') — press SIGN IN on the CLAUDE CODE card (Settings → PROVIDERS), then retry');
            e.status = 401; e.code = 'provider_not_configured';
            throw e;
          }
          // A spent subscription window ("You've hit your limit · resets 5pm …"): a 429 usage_limit_reached is
          // quota_exhausted — no retry on this sign-in, rotate to the next connected account (or fall back).
          if (apiError === 'rate_limit') {
            const e = new Error('Claude Code usage limit reached: ' + String(result.result || 'rate limited').slice(0, 300));
            e.status = 429; e.code = 'usage_limit_reached';
            throw e;
          }
          throw new Error('Claude Code error: ' + String(result.result || result.subtype || 'unknown error').slice(0, 400));
        }
        if (!sawText && callIndex === 0 && typeof result.result === 'string') yield* emitSplit(splitter.push(result.result));
        yield* emitSplit(splitter.end());
        yield usageChunk();
        yield { type: 'done', finishReason: callIndex > 0 ? 'tool_calls' : provider.normalizeFinish(result.stop_reason), truncated: false };
      } finally {
        finished = true;
        if (idleTimer) clearTimeout(idleTimer);
        if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
        if (!closed) killTree(child);
        removeFile(sysFile);
      }
    }

    return {
      stream,
      listModels,
      contextLimit(id) { return contextOf(id); },
      // The CLI reports its own billed cost per turn (see COST TRUTH above); there is no list-rate table here.
      priceOf() { return null; },
      supportsTools() { return true; },
      // the CLI's text input has no image channel (textOf replaces an image with a note): a caller that needs the model to
      // SEE an image must ask first — image_analyze used to report a confident description of a picture never sent
      supportsImages() { return false; },
      reasoningEfforts() { return EFFORTS.slice(); }
    };
  }

  return { makeClaudeCliProvider, makeCliHost, _internals: { buildPrompt, makeCallSplitter, parseCall, toolsPrompt, MODELS } };
});
