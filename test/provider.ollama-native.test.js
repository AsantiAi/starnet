/* node test/provider.ollama-native.test.js - Ollama chat on its native /api/chat with a request-sized window.
   Issue #20 reproduced on a real Ollama 0.34.4: /v1/chat/completions ran qwen3:8b at the server default of 4096
   tokens, ignored every request for more, and silently kept 2050 of a 20969-token task prompt (the tail of the
   tool list), so the model said it could not create files. These tests pin the translation and the sizing. */
'use strict';
const A = require('./_assert.js');
const N = require('../sidecar/providers/ollama-native.js');
const { makeOpenAICompatibleProvider } = require('../sidecar/providers/openai-compatible.js');
const factory = require('../sidecar/providers/factory.js');
const errorClass = require('../sidecar/providers/errorClass.js');

async function collect(provider, req) { const out = []; for await (const e of provider.stream(req)) out.push(e); return out; }
const ndjson = rows => new Response(rows.map(r => JSON.stringify(r)).join('\n') + '\n', { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
const SHOW = (ctx, caps) => new Response(JSON.stringify({ model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': ctx }, capabilities: caps }), { status: 200 });
const TOOLS = [{ type: 'function', function: { name: 'fs_write', description: 'write', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }];

module.exports = (async () => {
  // ---- pure translation ----
  A.eq(N.nativeRoot('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434', 'native root strips /v1');
  A.eq(N.nativeRoot('http://host:11434/v1/'), 'http://host:11434', 'native root strips a trailing slash too');
  {
    const body = {
      model: 'qwen3:8b', max_tokens: 4096, tools: TOOLS, reasoning_effort: 'none',
      messages: [
        { role: 'system', content: 'Policy' },
        { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }, { type: 'image_url', image_url: { url: 'https://x.test/a.png' } }] },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fs_write', arguments: '{"path":"a.txt"}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: 'Wrote a.txt' }
      ]
    };
    const n = N.toNativeRequest(body, { numCtx: 32768 });
    A.eq(n.stream, true, 'native requests stream');
    A.eq(n.truncate, false, 'truncate:false turns a silent cut into a refusal');
    A.eq(n.options.num_ctx, 32768, 'the window rides options.num_ctx');
    A.eq(n.options.num_predict, 4096, 'the output ceiling rides options.num_predict');
    A.eq(n.think, false, "effort 'none' on the wire maps to think:false");
    A.eq(n.tools, TOOLS, 'tool schemas pass through unchanged');
    A.eq(n.messages[1].content, 'look\n[image: https://x.test/a.png]', 'text parts join; a remote image is named, not dropped');
    A.eq(n.messages[1].images, ['QUJD'], 'a data-URL image rides as bare base64');
    A.eq(n.messages[2].tool_calls[0].function.arguments, { path: 'a.txt' }, 'assistant tool arguments are objects natively');
    A.eq(n.messages[2].content, '', 'a null assistant content is an empty string');
    A.eq(n.messages[3].tool_name, 'fs_write', 'a tool result names the tool it answers');
    A.eq(N.toNativeRequest({ model: 'm', messages: [] }).think, undefined, 'no effort on the request = the model default (no think field)');
    A.eq(N.toNativeRequest({ model: 'm', messages: [], reasoning_effort: 'high' }).think, true, 'a real effort turns thinking on');
  }
  {
    const t = N.makeChunkTranslator();
    A.eq(t({ message: { role: 'assistant', content: '', thinking: 'hmm' }, done: false }).choices[0].delta, { reasoning: 'hmm' }, 'thinking maps to delta.reasoning');
    const call = t({ message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_x', function: { index: 0, name: 'fs_write', arguments: { path: 'hello.txt' } } }] }, done: false });
    A.eq(call.choices[0].delta.tool_calls[0], { index: 0, id: 'call_x', type: 'function', function: { name: 'fs_write', arguments: '{"path":"hello.txt"}' } }, 'a native call becomes a complete chat-completions call');
    const end = t({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 20969, eval_count: 175 });
    A.eq(end.choices[0].finish_reason, 'tool_calls', "Ollama's 'stop' after a call reports tool_calls");
    A.eq(end.usage, { prompt_tokens: 20969, completion_tokens: 175, total_tokens: 21144 }, 'the final line carries real usage');
    const t2 = N.makeChunkTranslator();
    A.eq(t2({ message: { content: 'x' }, done: true, done_reason: 'length' }).choices[0].finish_reason, 'length', 'an output-cap stop stays length');
    A.eq(t2({ error: 'boom' }), { error: { message: 'boom' } }, 'a mid-stream error line becomes an error chunk');
  }
  // ---- window sizing ----
  A.eq(N.pickNumCtx(25000, {}), 32768, 'a StarNet task (~21k prompt + 4k output) lands on 32k');
  A.eq(N.pickNumCtx(25000, { modelMax: 16384 }), 16384, 'never past the model\'s trained window');
  A.eq(N.pickNumCtx(900000, {}), N.DEFAULT_MAX_CTX, 'never past the ceiling');
  A.eq(N.pickNumCtx(1000, { floor: 32768 }), 32768, 'never steps down from a window the model already runs at (a reload)');
  A.eq(N.pickNumCtx(1000, { pinned: 12000 }), 12000, 'a pinned window wins outright');
  A.eq(N.pickNumCtx(1000, {}), 8192, 'a small request takes the smallest step');
  {
    const inner = '{"error":{"code":400,"message":"request (20969 tokens) exceeds the available context size (4096 tokens), try increasing it","type":"exceed_context_size_error","n_prompt_tokens":20969,"n_ctx":4096}}';
    A.eq(N.exceedFrom(inner), { promptTokens: 20969, numCtx: 4096 }, 'the refusal is read from its fields');
    A.eq(N.exceedFrom(JSON.stringify({ error: inner })), { promptTokens: 20969, numCtx: 4096 }, '...and from the escaped copy inside the error string');
    A.eq(N.exceedFrom('request (9000 tokens) exceeds the available context size (8192 tokens)'), { promptTokens: 9000, numCtx: 8192 }, '...and from the sentence alone');
    A.eq(N.exceedFrom('model "x" not found'), null, 'any other error is not a window refusal');
  }
  A.eq(N.showFacts({ model_info: { 'llama.context_length': 131072 }, capabilities: ['completion', 'tools'] }), { contextLength: 131072, supportsTools: true, supportsReasoning: null }, '/api/show facts');
  A.eq(N.showFacts({ model_info: {}, capabilities: ['completion'] }).supportsTools, false, 'a model Ollama says has no tools support is false');
  A.eq(N.showFacts({ model_info: {} }).supportsTools, null, 'no capabilities list = unknown, never false');

  // ---- adapter: the native wire end to end ----
  {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
      if (url.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'qwen3:8b' }] }), { status: 200 });
      if (url.endsWith('/api/show')) return SHOW(40960, ['completion', 'tools', 'thinking']);
      if (url.endsWith('/api/chat')) return ndjson([
        { message: { role: 'assistant', content: '', thinking: 'plan' }, done: false },
        { message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_a', function: { name: 'fs_write', arguments: { path: 'hello.txt' } } }] }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 20969, eval_count: 30 }
      ]);
      return new Response('unexpected ' + url, { status: 500 });
    };
    const p = makeOpenAICompatibleProvider({ fetch, baseUrl: 'http://127.0.0.1:11434/v1', nativeOllama: true, maxTokens: 4096 });
    const ev = await collect(p, { model: 'qwen3:8b', messages: [{ role: 'user', content: 'x'.repeat(84000) }], tools: TOOLS });
    const chat = calls.find(c => c.url.endsWith('/api/chat'));
    A.ok(chat, 'chat goes to /api/chat');
    A.ok(!calls.some(c => c.url.endsWith('/chat/completions')), 'the /v1 chat wire is not used');
    A.eq(chat.body.options.num_ctx, 32768, 'the window is sized to the request (~21k estimated + 4096 output -> 32k)');
    A.eq(chat.body.truncate, false, 'the request refuses silent truncation');
    A.eq(ev.filter(e => e.type === 'tool_start').map(e => e.name), ['fs_write'], 'the structured call reaches the loop');
    A.eq(ev.filter(e => e.type === 'tool_args').map(e => e.chunk).join(''), '{"path":"hello.txt"}', 'with its arguments as JSON text');
    A.eq(ev.find(e => e.type === 'usage').usage.prompt_tokens, 20969, 'the real prompt size reaches cost + compaction');
    const done = ev.filter(e => e.type === 'done');
    A.eq(done.length, 1, 'exactly one terminal event');
    A.eq(done[0].truncated, false, 'done:true is a complete stream, not a cut one');
    A.eq(p.contextLimit('qwen3:8b'), 40960, 'the run sees the model\'s real window (min of trained max and ceiling)');
    await p.listModels();
    A.eq(p.supportsTools('qwen3:8b'), true, '/api/show capabilities make tool support known');
  }
  // A refusal resizes once; the larger window sticks for the next request (a smaller one would reload the model).
  {
    const sizes = [];
    const fetch = async (url, init) => {
      if (url.endsWith('/api/show')) return SHOW(131072, ['completion', 'tools']);
      if (url.endsWith('/api/chat')) {
        const b = JSON.parse(init.body);
        sizes.push(b.options.num_ctx);
        if (b.options.num_ctx < 65536) return new Response(JSON.stringify({ error: '{"error":{"code":400,"message":"request (40000 tokens) exceeds the available context size (' + b.options.num_ctx + ' tokens), try increasing it","type":"exceed_context_size_error","n_prompt_tokens":40000,"n_ctx":' + b.options.num_ctx + '}}' }), { status: 400 });
        return ndjson([{ message: { content: 'ok' }, done: true, done_reason: 'stop', prompt_eval_count: 40000, eval_count: 1 }]);
      }
      return new Response('{"data":[]}', { status: 200 });
    };
    const p = makeOpenAICompatibleProvider({ fetch, baseUrl: 'http://127.0.0.1:11434/v1', nativeOllama: true, maxTokens: 4096 });
    const ev = await collect(p, { model: 'big', messages: [{ role: 'user', content: 'short estimate' }] });
    A.eq(sizes, [8192, 65536], 'an under-estimate is refused with the exact count and resent once at a window that holds it');
    A.eq(ev.filter(e => e.type === 'text').map(e => e.delta).join(''), 'ok', 'the resent request answers');
    sizes.length = 0;
    await collect(p, { model: 'big', messages: [{ role: 'user', content: 'tiny' }] });
    A.eq(sizes, [65536], 'the next request keeps the larger window');
  }
  // At the model's usable maximum there is nothing bigger: the refusal surfaces and classifies as an overflow,
  // so the loop's reactive compaction (not a blind retry) takes over.
  {
    let posts = 0;
    const fetch = async (url) => {
      if (url.endsWith('/api/show')) return SHOW(8192, ['completion', 'tools']);
      if (url.endsWith('/api/chat')) { posts++; return new Response(JSON.stringify({ error: 'request (9000 tokens) exceeds the available context size (8192 tokens), try increasing it' }), { status: 400 }); }
      return new Response('{"data":[]}', { status: 200 });
    };
    const p = makeOpenAICompatibleProvider({ fetch, baseUrl: 'http://127.0.0.1:11434/v1', nativeOllama: true });
    let err = null;
    try { await collect(p, { model: 'small', messages: [{ role: 'user', content: 'x' }] }); } catch (e) { err = e; }
    A.ok(err, 'a prompt bigger than the model can ever hold fails');
    A.eq(posts, 1, 'without resending at the same window');
    A.eq(errorClass.classifyApiError(err, { model: 'small' }).reason, 'context_overflow', 'the refusal classifies as a context overflow');
  }
  // A URL with no /api/chat (a /v1-only proxy in front of Ollama) keeps working on the /v1 wire.
  {
    const urls = [];
    const fetch = async (url) => {
      urls.push(url);
      if (url.endsWith('/api/show') || url.endsWith('/api/chat')) return new Response('404 page not found', { status: 404 });
      if (url.endsWith('/chat/completions')) return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'via v1' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { status: 200 });
      return new Response('{"data":[]}', { status: 200 });
    };
    const p = makeOpenAICompatibleProvider({ fetch, baseUrl: 'http://proxy.test/v1', nativeOllama: true });
    const ev = await collect(p, { model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    A.eq(ev.filter(e => e.type === 'text').map(e => e.delta).join(''), 'via v1', 'falls back to /v1 chat');
    await collect(p, { model: 'm', messages: [{ role: 'user', content: 'again' }] });
    A.eq(urls.filter(u => u.endsWith('/api/chat')).length, 1, 'and stays there for the instance');
  }
  // Ollama's own 404 for an unpulled model is a real error, not "no native wire".
  {
    const urls = [];
    const fetch = async (url) => {
      urls.push(url);
      if (url.endsWith('/api/show')) return new Response(JSON.stringify({ error: "model 'nope' not found" }), { status: 404 });
      if (url.endsWith('/api/chat')) return new Response(JSON.stringify({ error: "model 'nope' not found" }), { status: 404 });
      return new Response('{"data":[]}', { status: 200 });
    };
    const p = makeOpenAICompatibleProvider({ fetch, baseUrl: 'http://127.0.0.1:11434/v1', nativeOllama: true });
    let err = null;
    try { await collect(p, { model: 'nope', messages: [{ role: 'user', content: 'hi' }] }); } catch (e) { err = e; }
    A.ok(err && /not found/.test(err.message), 'an unpulled model fails with Ollama\'s own words');
    A.ok(!urls.some(u => u.endsWith('/chat/completions')), 'without silently trying the /v1 wire');
  }
  // A model Ollama says cannot call tools is known up front (the host then refuses a task with a clear message).
  {
    const fetch = async (url) => {
      if (url.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'gemma2:2b' }] }), { status: 200 });
      if (url.endsWith('/api/show')) return SHOW(8192, ['completion']);
      return new Response('{}', { status: 200 });
    };
    const p = makeOpenAICompatibleProvider({ fetch, baseUrl: 'http://127.0.0.1:11434/v1', nativeOllama: true });
    const models = await p.listModels();
    A.eq(models[0].context_length, 8192, 'the catalog carries the model\'s window');
    A.eq(p.supportsTools('gemma2:2b'), false, 'and its lack of tool support');
  }
  // The profile wires it: Ollama speaks native, a custom OpenAI-compatible endpoint never does.
  {
    const seen = [];
    const fetch = async (url) => { seen.push(url); return url.endsWith('/api/chat') ? ndjson([{ message: { content: 'hi' }, done: true, done_reason: 'stop' }]) : new Response('{}', { status: 200 }); };
    await collect(factory.selectProvider({ provider: 'ollama', fetch }), { model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    A.ok(seen.some(u => /127\.0\.0\.1:11434\/api\/chat$/.test(u)), 'the ollama profile chats on /api/chat');
    seen.length = 0;
    await collect(factory.selectProvider({ provider: 'custom', baseUrl: 'http://127.0.0.1:1234/v1', fetch: async (url) => { seen.push(url); return new Response('data: [DONE]\n\n', { status: 200 }); } }), { model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    A.ok(seen.every(u => !/\/api\//.test(u)), 'a custom endpoint stays on /v1');
    const prev = process.env.SKYNET_OLLAMA_NUM_CTX;
    process.env.SKYNET_OLLAMA_NUM_CTX = '12000';
    try {
      let ctx = 0;
      await collect(factory.selectProvider({ provider: 'ollama', fetch: async (url, init) => { if (url.endsWith('/api/chat')) { ctx = JSON.parse(init.body).options.num_ctx; return ndjson([{ message: { content: '' }, done: true }]); } return new Response('{}', { status: 200 }); } }), { model: 'm', messages: [{ role: 'user', content: 'hi' }] });
      A.eq(ctx, 12000, 'SKYNET_OLLAMA_NUM_CTX pins the window');
    } finally { if (prev == null) delete process.env.SKYNET_OLLAMA_NUM_CTX; else process.env.SKYNET_OLLAMA_NUM_CTX = prev; }
  }

  // The window outlives the provider INSTANCE (a run builds a fresh one): a greeting after a task must not reload
  // the model at a smaller window, and the next task must not reload it back.
  {
    const sizes = [];
    const fetch = async (url, init) => {
      if (url.endsWith('/api/show')) return SHOW(40960, ['completion', 'tools']);
      if (url.endsWith('/api/chat')) { sizes.push(JSON.parse(init.body).options.num_ctx); return ndjson([{ message: { content: 'ok' }, done: true, done_reason: 'stop' }]); }
      return new Response('{"models":[]}', { status: 200 });
    };
    const mk = () => makeOpenAICompatibleProvider({ fetch, baseUrl: 'http://sticky.test:11434/v1', nativeOllama: true, maxTokens: 4096 });
    await collect(mk(), { model: 'q', messages: [{ role: 'user', content: 'x'.repeat(84000) }] });
    await collect(mk(), { model: 'q', messages: [{ role: 'user', content: 'hello' }] });
    A.eq(sizes, [32768, 32768], 'a small turn on a NEW provider instance keeps the window the task loaded');
  }
  // StarNet restarted while Ollama still holds the model at a larger window: adopt it instead of reloading smaller.
  {
    const sizes = [];
    const fetch = async (url, init) => {
      if (url.endsWith('/api/show')) return SHOW(40960, ['completion', 'tools']);
      if (url.endsWith('/api/ps')) return new Response(JSON.stringify({ models: [{ name: 'q', size: 10e9, size_vram: 10e9, context_length: 32768 }] }), { status: 200 });
      if (url.endsWith('/api/chat')) { sizes.push(JSON.parse(init.body).options.num_ctx); return ndjson([{ message: { content: 'ok' }, done: true, done_reason: 'stop' }]); }
      return new Response('{}', { status: 200 });
    };
    await collect(makeOpenAICompatibleProvider({ fetch, baseUrl: 'http://loaded.test:11434/v1', nativeOllama: true }), { model: 'q', messages: [{ role: 'user', content: 'hello' }] });
    A.eq(sizes, [32768], 'an already-loaded window is kept (no reload to a smaller one)');
    A.eq(N.loadedWindow({ models: [{ name: 'q', context_length: 8192 }] }, 'other'), 0, 'a model that is not loaded has no window to adopt');
  }
  // A screenshot is megabytes of base64 but a fixed handful of tokens: it must not size the window to the ceiling.
  {
    const img = { role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(2000000) } }] };
    const est = N.estimateTokens({ messages: [img] });
    A.ok(est > 1000 && est < 2000, 'an image counts as a flat allowance, not as its base64 length (got ' + est + ')');
  }

  // The host's own background calls (no tools, not a Commander turn) do not think on a thinking model: Ollama serves
  // one request at a time, and two such calls held the Commander's next greeting for 26s (measured, qwen3:8b).
  {
    const seen = [];
    const mkFetch = (caps) => async (url, init) => {
      if (url.endsWith('/api/show')) return SHOW(40960, caps);
      if (url.endsWith('/api/chat')) { seen.push(JSON.parse(init.body)); return ndjson([{ message: { content: 'ok' }, done: true, done_reason: 'stop' }]); }
      return new Response('{"models":[]}', { status: 200 });
    };
    const thinker = () => makeOpenAICompatibleProvider({ fetch: mkFetch(['completion', 'tools', 'thinking']), baseUrl: 'http://think.test:11434/v1', nativeOllama: true });
    const msg = [{ role: 'user', content: 'hi' }];
    await collect(thinker(), { model: 'q', messages: msg });
    A.eq(seen.pop().think, false, 'a background call (no tools, isTask unset) tells a thinking model not to think');
    await collect(thinker(), { model: 'q', messages: msg, isTask: false });
    A.eq(seen.pop().think, undefined, 'a Commander greeting keeps the model default');
    await collect(thinker(), { model: 'q', messages: msg, tools: TOOLS, isTask: true });
    A.eq(seen.pop().think, undefined, 'a task keeps the model default');
    await collect(thinker(), { model: 'q', messages: msg, tools: TOOLS });
    A.eq(seen.pop().think, undefined, 'an internal run WITH tools keeps the model default');
    await collect(makeOpenAICompatibleProvider({ fetch: mkFetch(['completion', 'tools', 'thinking']), baseUrl: 'http://think.test:11434/v1', nativeOllama: true, sendReasoningEffort: true, reasoningEffort: 'high' }), { model: 'q', messages: msg });
    A.eq(seen.pop().think, true, 'an explicit reasoning effort still wins on a background call');
    await collect(makeOpenAICompatibleProvider({ fetch: mkFetch(['completion', 'tools']), baseUrl: 'http://nothink.test:11434/v1', nativeOllama: true }), { model: 'q', messages: msg });
    A.eq('think' in seen.pop(), false, 'a model that cannot think is never sent the field');
  }

  // A silent local model says WHERE it runs (the 605s "stalled" report = two 300s attempts with no bytes).
  {
    const ps = (vram) => ({ models: [{ name: 'qwen3:8b', size: 10e9, size_vram: vram, context_length: 32768 }] });
    A.ok(/entirely on the CPU/.test(N.placementNote(ps(0), 'qwen3:8b', 21000)), 'no VRAM = CPU only');
    A.ok(/~21k-token prompt/.test(N.placementNote(ps(0), 'qwen3:8b', 21000)), 'names the prompt it was reading');
    A.ok(/only 40% on the GPU/.test(N.placementNote(ps(4e9), 'qwen3:8b', 21000)), 'a partial offload is stated as a share');
    A.ok(/fully on the GPU at a 32k window/.test(N.placementNote(ps(10e9), 'qwen3:8b', 21000)), 'a full GPU load is stated too');
    A.ok(!/smaller model/.test(N.placementNote(ps(10e9), 'qwen3:8b', 21000)), 'and no CPU advice when it is on the GPU');
    A.ok(/still loading the model/.test(N.placementNote({ models: [] }, 'qwen3:8b', 21000)), 'not listed = still loading');
    A.ok(/could not be read/.test(N.placementNote(null, 'qwen3:8b', 0)), 'an unreadable status says so, never guesses');

    const fetch = async (url, init) => {
      if (url.endsWith('/api/show')) return SHOW(40960, ['completion', 'tools']);
      if (url.endsWith('/api/ps')) return new Response(JSON.stringify(ps(0)), { status: 200 });
      if (url.endsWith('/api/chat')) return new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }); });
      return new Response('{"data":[]}', { status: 200 });
    };
    const p = makeOpenAICompatibleProvider({ fetch, baseUrl: 'http://127.0.0.1:11434/v1', nativeOllama: true, connectTimeoutMs: 30 });
    let err = null;
    try { await collect(p, { model: 'qwen3:8b', messages: [{ role: 'user', content: 'x' }], preStreamRetries: 0 }); } catch (e) { err = e; }
    A.ok(err && /timed out/.test(err.message), 'a silent local model still times out');
    A.ok(err && /entirely on the CPU/.test(err.message), 'and the error says the model runs on the CPU (from /api/ps)');
    A.eq(errorClass.classifyApiError(err, { model: 'qwen3:8b' }).reason, 'timeout', 'the explanation does not change how it classifies');
  }

  A.report('provider.ollama-native.test');
})();
