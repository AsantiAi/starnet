/* sidecar/providers/ollama-native.js — Ollama's own /api/chat wire, spoken by the openai-compatible adapter.

   WHY THIS EXISTS (2026-09-29, issue #20 reproduced on a real Ollama 0.34.4 + qwen3:8b):
   Ollama's OpenAI-compatible /v1/chat/completions runs every model at the SERVER's default context window —
   4096 tokens on any GPU under 24 GB of VRAM — and IGNORES every request-side way of asking for more
   (`options.num_ctx`, a top-level `num_ctx`; a model preloaded natively at 32k is reloaded back to 4k). It then
   TRUNCATES SILENTLY. A StarNet task request is ~21k tokens (86 tool schemas + the operator manual), so the model
   saw ~2k of it: the tail of the tool list. qwen3:8b answered "I cannot create files … the available tools only
   support scheduling routines" and the run ended 'done' with no tool call — the exact customer report.
   The native wire takes `options.num_ctx`, and `truncate: false` turns the silent cut into an exact refusal
   ("request (20969 tokens) exceeds the available context size (4096 tokens)", n_prompt_tokens/n_ctx attached).
   The same captured request on the native wire at num_ctx 32768: prompt 20969 tokens, one fs_write call.

   This module is PURE translation — no fetch, no state:
     nativeRoot(baseUrl)                  'http://127.0.0.1:11434/v1' -> 'http://127.0.0.1:11434'
     toNativeRequest(body, opts)          an OpenAI chat body (as the adapter built it) -> a native /api/chat body
     makeChunkTranslator()                native NDJSON objects -> the OpenAI stream-chunk shape the adapter parses
     estimateTokens(body) / pickNumCtx()  size the window from the request, on a sticky ladder
     exceedFrom(detail)                   read Ollama's exceed_context_size refusal
     showFacts(json)                      /api/show -> { contextLength, supportsTools, supportsReasoning } */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.SK = root.SK || {}; root.SK.providers = root.SK.providers || {}; root.SK.providers.ollamaNative = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Window sizes Ollama is asked for. A LADDER, not the exact need: every distinct num_ctx forces Ollama to reload
  // the model (seconds, and the KV cache is lost), so requests settle on a few sizes and the adapter never steps
  // DOWN within a process (see pickNumCtx's `floor`).
  const CTX_LADDER = [8192, 16384, 32768, 65536, 131072];
  // Default ceiling. The KV cache grows with the window (qwen3:8b: ~0.15 MB/token -> 64k ≈ 9.4 GB on top of the
  // weights); past what the GPU holds, Ollama spills layers to the CPU and every token slows. 64k fits an 8B model
  // on a 16 GB card and still leaves a StarNet task (~21k prompt) three times its base size. SKYNET_OLLAMA_NUM_CTX
  // pins an exact window; SKYNET_OLLAMA_MAX_CTX raises or lowers this ceiling.
  const DEFAULT_MAX_CTX = 65536;
  // Characters per token for the pre-send estimate. The captured StarNet task body measured 4.7 chars/token on
  // qwen3's tokenizer (JSON schemas tokenize densely); 4 errs large. An under-estimate is still safe: truncate:false
  // makes Ollama refuse with the exact count and the adapter resizes once (see exceedFrom).
  const CHARS_PER_TOKEN = 4;

  function nativeRoot(baseUrl) {
    return String(baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/i, '');
  }

  function textOfParts(content) {
    if (typeof content === 'string') return { text: content, images: [] };
    if (!Array.isArray(content)) return { text: content == null ? '' : String(content), images: [] };
    const texts = [];
    const images = [];
    for (const part of content) {
      if (!part) continue;
      if (typeof part === 'string') { texts.push(part); continue; }
      if (part.type === 'text' || typeof part.text === 'string') { texts.push(String(part.text || '')); continue; }
      if (part.type === 'image_url') {
        const url = String((part.image_url && (part.image_url.url || part.image_url)) || '');
        const m = /^data:[^;,]+;base64,(.*)$/i.exec(url);
        // Ollama takes raw base64 images only; a remote URL cannot be fetched by it, so the model is told one was
        // attached rather than the reference vanishing without a trace.
        if (m) images.push(m[1]); else if (url) texts.push('[image: ' + url + ']');
      }
    }
    return { text: texts.join('\n'), images };
  }

  function parseArgs(raw) {
    if (raw && typeof raw === 'object') return raw;
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return {};
    try { const v = JSON.parse(s); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : { value: v }; }
    catch (_) { return { _raw: s }; }
  }

  // OpenAI chat messages -> native messages. Differences that matter: content is a plain string (images ride in
  // `images` as bare base64), assistant tool-call arguments are OBJECTS, and a tool result names its tool
  // (`tool_name`) — the native templates key results by name, not by call id.
  function toNativeMessages(messages) {
    const nameById = {};
    const out = [];
    for (const m of Array.isArray(messages) ? messages : []) {
      if (!m || !m.role) continue;
      const { text, images } = textOfParts(m.content);
      const msg = { role: m.role, content: text };
      if (images.length) msg.images = images;
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        msg.tool_calls = m.tool_calls.map(tc => {
          const fn = (tc && tc.function) || {};
          if (tc && tc.id) nameById[tc.id] = fn.name || '';
          const call = { function: { name: String(fn.name || ''), arguments: parseArgs(fn.arguments) } };
          if (tc && tc.id) call.id = tc.id;
          return call;
        });
      }
      if (m.role === 'tool') {
        const name = m.name || nameById[m.tool_call_id] || '';
        if (name) msg.tool_name = name;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      }
      out.push(msg);
    }
    return out;
  }

  // The native body for an OpenAI body the adapter already built (model, messages, tools, max_tokens,
  // reasoning_effort). `numCtx` is the window to ask for.
  function toNativeRequest(body, opts) {
    const o = opts || {};
    const b = body || {};
    const req = { model: b.model, messages: toNativeMessages(b.messages), stream: true, truncate: false };
    if (Array.isArray(b.tools) && b.tools.length) req.tools = b.tools;
    const options = {};
    if (o.numCtx > 0) options.num_ctx = Math.floor(o.numCtx);
    if (b.max_tokens > 0) options.num_predict = Math.floor(b.max_tokens);
    if (Object.keys(options).length) req.options = options;
    // The chat wire's reasoning_effort maps onto native `think` only when the request carried one; otherwise the
    // model's own default applies, exactly as the /v1 wire behaved (effort 'none' is never put on the wire there).
    if (typeof b.reasoning_effort === 'string' && b.reasoning_effort) req.think = b.reasoning_effort !== 'none';
    return req;
  }

  // A body that cannot be serialized (a cycle) cannot be sent either; counting it as 0 only means the first window
  // is the smallest step, and the send itself surfaces the real failure.
  function jsonChars(value) {
    try { return JSON.stringify(value || []).length; } catch (_) { return 0; }
  }
  function estimateTokens(body) {
    const b = body || {};
    return Math.ceil((jsonChars(b.messages) + jsonChars(b.tools)) / CHARS_PER_TOKEN);
  }

  // Smallest ladder step holding `need`, never below `floor` (the largest window this model already ran at in this
  // process — stepping down would reload it), never above min(model max, ceiling). A pinned window wins outright.
  function pickNumCtx(need, limits) {
    const l = limits || {};
    const pinned = Math.floor(Number(l.pinned) || 0);
    if (pinned > 0) return pinned;
    const ceiling = Math.floor(Number(l.ceiling) || 0) || DEFAULT_MAX_CTX;
    const modelMax = Math.floor(Number(l.modelMax) || 0);
    const cap = modelMax > 0 ? Math.min(modelMax, ceiling) : ceiling;
    const want = Math.max(Math.floor(Number(need) || 0), Math.floor(Number(l.floor) || 0));
    const step = CTX_LADDER.find(s => s >= want) || CTX_LADDER[CTX_LADDER.length - 1];
    return Math.max(1, Math.min(step, cap));
  }

  // Ollama's refusal under truncate:false, in either shape it has been seen in (a JSON error object, or that
  // object serialized inside the top-level error string). null when the text is anything else.
  function exceedFrom(detail) {
    const s = String(detail || '');
    if (!/exceed_context_size|exceeds the available context size/i.test(s)) return null;
    const num = (re) => { const m = re.exec(s); return m ? Number(m[1]) : 0; };
    const prompt = num(/n_prompt_tokens\\?"?\s*:\s*(\d+)/) || num(/request \((\d+) tokens\)/i);
    const ctx = num(/n_ctx\\?"?\s*:\s*(\d+)/) || num(/context size \((\d+) tokens\)/i);
    return prompt > 0 ? { promptTokens: prompt, numCtx: ctx } : null;
  }

  // Native NDJSON objects -> OpenAI stream chunks. Stateful per stream: tool calls are indexed in arrival order,
  // and the final chunk reports 'tool_calls' when any call arrived (Ollama says done_reason 'stop' either way).
  function makeChunkTranslator() {
    let calls = 0;
    return function translate(j) {
      if (!j || typeof j !== 'object') return null;
      if (j.error) return { error: { message: typeof j.error === 'string' ? j.error : JSON.stringify(j.error) } };
      const m = j.message || {};
      const delta = {};
      if (typeof m.content === 'string' && m.content) delta.content = m.content;
      if (typeof m.thinking === 'string' && m.thinking) delta.reasoning = m.thinking;
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
        delta.tool_calls = m.tool_calls.map(tc => {
          const fn = (tc && tc.function) || {};
          const idx = calls++;
          const args = fn.arguments;
          return {
            index: idx,
            id: (tc && tc.id) || ('call_' + idx),
            type: 'function',
            function: { name: String(fn.name || ''), arguments: typeof args === 'string' ? args : JSON.stringify(args || {}) }
          };
        });
      }
      const chunk = { choices: [{ index: 0, delta, finish_reason: null }] };
      if (j.done) {
        const reason = String(j.done_reason || 'stop');
        chunk.choices[0].finish_reason = reason === 'length' ? 'length' : (calls > 0 ? 'tool_calls' : 'stop');
        const p = Number(j.prompt_eval_count || 0), c = Number(j.eval_count || 0);
        chunk.usage = { prompt_tokens: p, completion_tokens: c, total_tokens: p + c };
      }
      return chunk;
    };
  }

  // /api/show -> the facts the catalog needs. Ollama states them outright, so nothing here is inferred: the
  // context window from model_info['<arch>.context_length'], tools/thinking from `capabilities`. A response
  // without a capabilities list (older servers) leaves tool support unknown (null), never false.
  function showFacts(j) {
    const facts = { contextLength: 0, supportsTools: null, supportsReasoning: null };
    if (!j || typeof j !== 'object') return facts;
    const info = j.model_info || {};
    for (const k of Object.keys(info)) {
      if (/\.context_length$/.test(k) && Number(info[k]) > 0) { facts.contextLength = Number(info[k]); break; }
    }
    if (Array.isArray(j.capabilities)) {
      facts.supportsTools = j.capabilities.indexOf('tools') >= 0;
      if (j.capabilities.indexOf('thinking') >= 0) facts.supportsReasoning = true;
    }
    return facts;
  }

  /* WHY A LOCAL MODEL WENT SILENT (issue: a run "timed out" after 605s = the loop's two 300s silent attempts).
     Ollama sends no bytes, not even headers, until its first token, so everything before it is invisible: loading
     the weights, then reading the prompt. A StarNet task prompt is ~21k tokens; a GPU reads that in seconds, a CPU
     can take many minutes. /api/ps says where the model actually sits, so the error states that fact instead of
     "the provider may be down". Pure: psJson is the /api/ps body (or null when it could not be read). */
  function placementNote(psJson, model, promptTokens) {
    const id = String(model || '');
    const row = psJson && Array.isArray(psJson.models) ? psJson.models.find(m => m && (m.name === id || m.model === id)) : null;
    const prompt = promptTokens > 0 ? ' a ~' + Math.round(promptTokens / 1000) + 'k-token prompt' : ' the prompt';
    if (!psJson) return 'Ollama on this computer sent nothing back, and its status (/api/ps) could not be read.';
    if (!row) return 'Ollama on this computer sent nothing back and does not list ' + id + ' as loaded, so it was still loading the model from disk.';
    const size = Number(row.size) || 0, vram = Number(row.size_vram) || 0;
    const ctx = Number(row.context_length) || 0;
    const where = !vram ? 'entirely on the CPU (no part of it is on a GPU)'
      : (size && vram < size) ? 'only ' + Math.round(vram / size * 100) + '% on the GPU, the rest on the CPU'
      : 'fully on the GPU';
    return 'Ollama on this computer had ' + id + ' loaded ' + where + (ctx ? ' at a ' + Math.round(ctx / 1024) + 'k window' : '')
      + ' and had not finished reading' + prompt + '. '
      + (!vram || (size && vram < size) ? 'A model running on the CPU reads StarNet task prompts slowly; a smaller model, or one that fits the GPU, answers sooner.' : '');
  }

  return { CTX_LADDER, DEFAULT_MAX_CTX, placementNote, nativeRoot, toNativeMessages, toNativeRequest, estimateTokens, pickNumCtx,
    exceedFrom, makeChunkTranslator, showFacts };
});
