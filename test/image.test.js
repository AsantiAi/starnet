/* node test/image.test.js — the STUDIO skills: image_generate + image_analyze. Offline + deterministic
   (fetch injected, real temp workspace). Pairs with sidecar/tools/builtin/image.js. Verifies: the OpenRouter
   request shape (modalities for gen; text-then-image_url parts for analyze), base64 data-URL decode + jailed
   save, content-addressed default naming, a 'deliverable' emit, workspace-path read for analysis, jail escape
   refusal, and a clean error when no API key is set. */
'use strict';
const A = require('./_assert.js');
const fsp = require('node:fs/promises');
const fssync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { makeImageTools } = require('../sidecar/tools/builtin/image.js');

// Per-process root. The name used to be fixed, and the first thing this file does is rm -rf it —
// so two gates running at once (two worktrees, or a lane gating beside the integration tree) raced
// on the same directory. Worse, the saved file is CONTENT-ADDRESSED, so both runs wrote the same
// path: one process read the file while the other was truncating it and the PNG-magic assertion
// failed with nothing wrong in the product. A phantom RED on merge night. Keep this unique.
const ROOT = path.join(os.tmpdir(), 'starnet-image-test-' + process.pid);

// a 1x1 transparent PNG (real bytes), as base64 — used as the model's "generated" image
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const DATA_URL = 'data:image/png;base64,' + PNG_B64;

// build a fetch stub: records the last request body, returns a routed response
function stubFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    let body = null; try { body = init && init.body ? JSON.parse(init.body) : null; } catch (_) {}
    calls.push({ url: String(url), body, init });
    return handler(String(url), body, init);
  };
  fn.calls = calls;
  return fn;
}

function jsonResp(obj, status) { return { status: status || 200, json: async () => obj, arrayBuffer: async () => Buffer.alloc(0), headers: { get: () => 'application/json' } }; }

// real PNG fixtures (every scanline filter, 8/16-bit, RGB/RGBA/grey+alpha/palette) for the transparency verdicts
const { encodePng, logoPng } = require('./helpers/png-fixture.js');
const imageReply = png => jsonResp({ choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,' + png.toString('base64') } }] } }] });

(async () => {
  try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) {}

  // ---- A. parseImageFromResponse / dataUrlToBuffer pure helpers ----
  const T0 = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: async () => jsonResp({}) });
  A.eq(T0._internals.parseImageFromResponse({ choices: [{ message: { images: [{ image_url: { url: DATA_URL } } ] } }] }), DATA_URL, 'parses images[].image_url.url');
  A.eq(T0._internals.parseImageFromResponse({ choices: [{ message: { content: [{ type: 'image_url', image_url: { url: DATA_URL } }] } }] }), DATA_URL, 'parses content[] image_url part fallback');
  A.eq(T0._internals.parseImageFromResponse({ choices: [{ message: { content: 'no image here' } }] }), '', 'no image -> empty string');
  const dec = T0._internals.dataUrlToBuffer(DATA_URL);
  A.eq(dec.mime, 'image/png', 'dataUrlToBuffer reads the mime');
  A.ok(dec.buffer.length > 0 && dec.buffer[0] === 0x89 && dec.buffer[1] === 0x50, 'dataUrlToBuffer decodes real PNG bytes (\\x89P…)');

  // ---- B. image_generate: posts modalities, decodes the data URL, saves a content-addressed file, emits deliverable ----
  const genFetch = stubFetch((url) => {
    if (url.indexOf('/chat/completions') >= 0) return jsonResp({ choices: [{ message: { content: 'here you go', images: [{ type: 'image_url', image_url: { url: DATA_URL } }] } }] });
    return jsonResp({}, 404);
  });
  const T1 = makeImageTools({ openrouter: { apiKey: 'sk-test' }, fsp, pathMod: path, root: ROOT, fetchImpl: genFetch });
  const emits = [];
  const ctx = { agentId: 'hero', room: 'office', emit: (n, p) => emits.push({ n, p }) };
  const g = await T1.generateTool.run({ prompt: 'a red cube' }, ctx);
  // request shape
  A.eq(genFetch.calls[0].body.modalities, ['image', 'text'], 'image_generate sends modalities:[image,text]');
  // 2026-07-07 image-quality escape: the default was the OLDEST slug in the live catalog (garbled text on
  // mockups). Default is now current-gen Nano Banana 2; premium (gemini-3-pro-image) is taught in the description.
  A.eq(genFetch.calls[0].body.model, 'google/gemini-3.1-flash-image', 'image_generate defaults to the CURRENT-GEN image model');
  A.ok(/gemini-3-pro-image/.test(T1.generateTool.description) && /READABLE TEXT/.test(T1.generateTool.description), 'the tool teaches the premium model for text-heavy/hero assets');
  A.ok(genFetch.calls[0].init.headers.Authorization === 'Bearer sk-test', 'image_generate sends the BYOK key');
  // saved file
  const rel = (g.summary.match(/image → (\S+)/) || [])[1];
  A.ok(rel && rel.indexOf('images/gen-') === 0 && rel.endsWith('.png'), 'image_generate uses a content-addressed images/gen-*.png name');
  const onDisk = fssync.readFileSync(path.join(ROOT, 'hero', rel));
  A.ok(onDisk[0] === 0x89 && onDisk[1] === 0x50, 'the saved PNG matches the decoded bytes');
  A.ok(g.content.indexOf('/api/file?agent=hero&path=') >= 0, 'image_generate returns the /api/file viewer URL');
  A.ok(emits.some(e => e.n === 'deliverable' && e.p.kind === 'image' && e.p.agentId === 'hero'), 'image_generate emits a deliverable event');

  // A configured OpenRouter-compatible base is part of the authorized route (local proxy/tests included).
  const baseFetch = stubFetch(() => jsonResp({ choices: [{ message: { images: [{ image_url: { url: DATA_URL } }] } }] }));
  const TB = makeImageTools({ openrouter: { apiKey: 'base-key', baseUrl: 'http://127.0.0.1:43210/api/v1/' }, fsp, pathMod: path, root: ROOT, fetchImpl: baseFetch });
  await TB.generateTool.run({ prompt: 'local route' }, ctx);
  A.eq(baseFetch.calls[0].url, 'http://127.0.0.1:43210/api/v1/chat/completions', 'image_generate honors the configured OpenRouter base URL');

  // OpenAI keys use the dedicated Images API. gpt-image-2 is the media model inside STUDIO,
  // never a streaming chat agent.
  const openAIFetch = stubFetch(() => jsonResp({ data: [{ b64_json: PNG_B64 }], usage: { input_tokens: 8, output_tokens: 16 } }));
  const TO = makeImageTools({ openrouter: { apiKey: 'openai-key', provider: 'openai', protocol: 'openai-images', baseUrl: 'https://api.openai.com/v1/' }, fsp, pathMod: path, root: ROOT, fetchImpl: openAIFetch });
  const go = await TO.generateTool.run({ prompt: 'a moonlit landscape', aspect_ratio: '16:9' }, ctx);
  A.eq(openAIFetch.calls[0].url, 'https://api.openai.com/v1/images/generations', 'OpenAI generation uses /images/generations');
  A.eq(openAIFetch.calls[0].body, { model: 'gpt-image-2', prompt: 'a moonlit landscape', size: '1536x1024' }, 'OpenAI request uses its native prompt/model/size shape without chat streaming fields');
  A.eq(openAIFetch.calls[0].init.headers.Authorization, 'Bearer openai-key', 'OpenAI Images API receives the configured OpenAI key');
  A.ok(/gpt-image-2/.test(TO.generateTool.description) && !/gemini-3-pro-image/.test(TO.generateTool.description), 'OpenAI STUDIO teaches the model valid for its route');
  A.ok(go.summary.indexOf('image → ') === 0, 'OpenAI base64 output is saved as an image artifact');
  A.eq(TO.hasVision, false, 'an OpenAI generation-only route does not falsely advertise chat vision');
  const invalidOverrideFetch = stubFetch(() => jsonResp({ data: [{ b64_json: PNG_B64 }] }));
  const TOInvalidOverride = makeImageTools({ openrouter: { apiKey: 'openai-key', provider: 'openai', protocol: 'openai-images' }, imageModel: 'google/gemini-3-pro-image', fsp, pathMod: path, root: ROOT, fetchImpl: invalidOverrideFetch });
  await TOInvalidOverride.generateTool.run({ prompt: 'route-safe model', model: 'recraft/recraft-v4' }, ctx);
  A.eq(invalidOverrideFetch.calls[0].body.model, 'gpt-image-2', 'an OpenRouter IMAGE_MODEL override cannot cross onto the OpenAI Images API');

  // ---- B1b. aspect_ratio rides image_config; default stays bare (no image_config); bad value refused pre-flight ----
  const gAr = await T1.generateTool.run({ prompt: 'a wide vista', aspect_ratio: '16:9' }, ctx);
  A.ok(gAr.summary.indexOf('image → ') === 0, 'aspect_ratio call still saves an image');
  const arCall = genFetch.calls[genFetch.calls.length - 1];
  A.eq(arCall.body.image_config, { aspect_ratio: '16:9' }, 'aspect_ratio:"16:9" is sent as image_config.aspect_ratio');
  A.eq(genFetch.calls[0].body.image_config, undefined, 'no aspect_ratio -> no image_config field (provider default 1:1)');
  A.ok(/16:9/.test(T1.generateTool.description) && /widescreen/i.test(T1.generateTool.description), 'the tool teaches the aspect_ratio dial for widescreen asks');
  A.eq(T1.generateTool.schema.properties.aspect_ratio.enum, undefined, 'aspect_ratio is NOT an enum — any shape is accepted');
  A.ok(T1.generateTool.schema.properties.width && T1.generateTool.schema.properties.height, 'schema exposes exact width/height');
  // ---- B1c. any ratio/size snaps to the nearest provider ratio; exact pixels get fitted ----
  {
    const rs = T1._internals.resolveShape;
    A.eq(rs('99:1').ratio, '21:9', 'an off-menu ratio snaps to the nearest provider ratio (99:1 -> 21:9)');
    A.eq(rs('16/9').ratio, '16:9', 'slash separator accepted');
    A.eq(rs('1.5').ratio, '3:2', 'a bare decimal ratio works');
    A.eq(rs('landscape').ratio, '3:2', 'shape words work');
    A.eq(rs('Portrait').ratio, '2:3', 'shape words are case-insensitive');
    A.eq(rs('1920x1080'), { ratio: '16:9', width: 1920, height: 1080, exact: true }, 'WxH in aspect_ratio = exact size request');
    A.eq(rs('', 1080, 1350), { ratio: '4:5', width: 1080, height: 1350, exact: true }, 'width+height alone pick the nearest ratio');
    A.eq(rs('1:1', 800, 600).ratio, '1:1', 'an explicit ratio wins over the pixel ratio for generation');
    A.eq(rs(''), { ratio: '', width: 0, height: 0, exact: false }, 'nothing asked -> provider default, no image_config');
    A.eq(rs('banana'), null, 'garbage is refused');
    A.eq(rs('', 100, 0), null, 'width without height is refused');
    A.eq(rs('', 99999, 10), null, 'absurd pixel sizes are refused');
    const before = genFetch.calls.length;
    let badAr = null; try { await T1.generateTool.run({ prompt: 'x', aspect_ratio: 'banana' }, ctx); } catch (e) { badAr = e.message; }
    A.ok(/could not understand the requested image shape/.test(badAr) && /no image was produced/.test(badAr), 'an unparseable shape is refused with an honest, actionable error');
    A.eq(genFetch.calls.length, before, 'the bad-shape refusal fires BEFORE any network call');
    const gSnap = await T1.generateTool.run({ prompt: 'ultra wide', aspect_ratio: '32:9' }, ctx);
    A.eq(genFetch.calls[genFetch.calls.length - 1].body.image_config, { aspect_ratio: '21:9' }, '32:9 is sent to the provider as the nearest 21:9');
    A.ok(/21:9/.test(gSnap.content), 'the result names the ratio actually rendered');
    // the stub PNG is a hand-rolled fixture the resizer can't decode -> the tool must say so, not lie
    const gNoFit = await T1.generateTool.run({ prompt: 'wallpaper', width: 64, height: 36, path: 'art/nofit' }, ctx);
    A.eq(genFetch.calls[genFetch.calls.length - 1].body.image_config, { aspect_ratio: '16:9' }, 'exact 64x36 generates at 16:9');
    A.ok(/NOT resized to 64x36/.test(gNoFit.content), 'an un-resizable render is shipped with an honest NOT-resized note');
    let sharp = null; try { sharp = require('sharp'); } catch (_) {}
    if (sharp) {
      const realPng = await sharp({ create: { width: 160, height: 90, channels: 3, background: '#336699' } }).png().toBuffer();
      const realFetch = stubFetch(() => jsonResp({ choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,' + realPng.toString('base64') } }] } }] }));
      const TR = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: realFetch });
      const gExact = await TR.generateTool.run({ prompt: 'wallpaper', width: 64, height: 36, path: 'art/exact' }, ctx);
      A.ok(/fitted to 64x36/.test(gExact.content), 'exact-size result reports the fit');
      const meta = await sharp(path.join(ROOT, 'hero', 'art', 'exact.png')).metadata();
      A.eq([meta.width, meta.height], [64, 36], 'the saved file is EXACTLY 64x36');
      const gTall = await TR.generateTool.run({ prompt: 'poster', aspect_ratio: '1000x1500', path: 'art/tall' }, ctx);
      A.eq(realFetch.calls[realFetch.calls.length - 1].body.image_config, { aspect_ratio: '2:3' }, '"1000x1500" generates at 2:3');
      const m2 = await sharp(path.join(ROOT, 'hero', 'art', 'tall.png')).metadata();
      A.eq([m2.width, m2.height], [1000, 1500], 'a WxH string in aspect_ratio yields that exact pixel size');
    }
  }

  // ---- B2. custom output path + content-addressed idempotency (same bytes -> same default name) ----
  const g2 = await T1.generateTool.run({ prompt: 'x', path: 'art/cube' }, ctx);
  A.ok(g2.summary.indexOf('art/cube.png') >= 0, 'image_generate appends .png to an extensionless custom path');
  const g3 = await T1.generateTool.run({ prompt: 'y' }, ctx);
  A.eq((g3.summary.match(/image → (\S+)/) || [])[1], rel, 'identical image bytes -> identical content-addressed name (idempotent)');

  // ---- C. image_generate errors when the model returns no image ----
  const noImgFetch = stubFetch(() => jsonResp({ choices: [{ message: { content: 'I cannot do that' } }] }));
  const T2 = makeImageTools({ openrouter: { apiKey: 'sk' }, fsp, pathMod: path, root: ROOT, fetchImpl: noImgFetch });
  let threw = false; try { await T2.generateTool.run({ prompt: 'z' }, ctx); } catch (e) { threw = /no image/.test(e.message); }
  A.ok(threw, 'image_generate throws a clear error when no image comes back');

  // ---- D. image_analyze: reads a workspace file, sends text-then-image_url parts, returns model text ----
  const anFetch = stubFetch(() => jsonResp({ choices: [{ message: { content: 'A small red cube on white.' } }] }));
  const T3 = makeImageTools({ openrouter: { apiKey: 'sk' }, fsp, pathMod: path, root: ROOT, fetchImpl: anFetch });
  const a = await T3.analyzeTool.run({ image: rel, prompt: 'what is this?' }, ctx);   // rel was saved under hero/ above
  A.ok(/red cube/i.test(a.content), 'image_analyze returns the vision model text');
  const parts = anFetch.calls[0].body.messages[0].content;
  A.eq(parts[0].type, 'text', 'analyze sends the text part first');
  A.eq(parts[1].type, 'image_url', 'analyze sends an image_url part second');
  A.ok(parts[1].image_url.url.indexOf('data:image/png;base64,') === 0, 'analyze base64-encodes the workspace image into a data URL');

  // ---- E. image_analyze passes an http(s) URL straight through (no file read) ----
  const a2 = await T3.analyzeTool.run({ image: 'https://example.com/cat.jpg' }, ctx);
  A.ok(/red cube/i.test(a2.content), 'image_analyze works with a public URL');
  A.eq(anFetch.calls[1].body.messages[0].content[1].image_url.url, 'https://example.com/cat.jpg', 'a public URL is passed through unchanged');

  // ---- F. jail escape on analyze path is refused ----
  let escaped = false; try { await T3.analyzeTool.run({ image: '../secrets.txt' }, ctx); } catch (e) { escaped = /illegal path|escapes|no such file/i.test(e.message); }
  A.ok(escaped, 'image_analyze refuses a path that escapes the workspace');

  // ---- G. no API key -> clean, actionable error ----
  const T4 = makeImageTools({ openrouter: { apiKey: '' }, fsp, pathMod: path, root: ROOT, fetchImpl: async () => jsonResp({}) });
  let noKey = false; try { await T4.generateTool.run({ prompt: 'q' }, ctx); } catch (e) { noKey = /media connection/i.test(e.message); }
  A.ok(noKey, 'image_generate errors helpfully when no OpenRouter key is configured');

  // ---- H. browserVision: reusable vision callback for browser.vision ----
  A.eq(T3.hasVision, true, 'hasVision is true when a key is present');
  A.eq(T4.hasVision, false, 'hasVision is false with no key (browser.vision stays unwired -> honest unavailable)');
  const bv = await T3.browserVision({ imageBase64: Buffer.from('png').toString('base64'), question: 'what is on screen?' });
  A.ok(/red cube/i.test(bv), 'browserVision returns the vision model text');
  const bvParts = anFetch.calls[anFetch.calls.length - 1].body.messages[0].content;
  A.eq(bvParts[0].text, 'what is on screen?', 'browserVision forwards the question');
  A.ok(bvParts[1].image_url.url.indexOf('data:image/png;base64,') === 0, 'browserVision wraps the screenshot as a PNG data URL');
  let bvNoKey = false; try { await T4.browserVision({ imageBase64: 'x', question: 'q' }); } catch (e) { bvNoKey = /API key/i.test(e.message); }
  A.ok(bvNoKey, 'browserVision throws a clear no-key error (browser.vision converts this to unavailable)');

  // ---- G. slug-drift fallback: an unknown-model rejection retries ONCE on the legacy slug; other errors don't ----
  {
    const fbFetch = stubFetch((url, body) => {
      if (body && body.model === 'google/gemini-3.1-flash-image') return jsonResp({ error: { message: 'gemini-3.1-flash-image is not a valid model ID' } }, 400);
      return jsonResp({ choices: [{ message: { images: [{ image_url: { url: DATA_URL } }] } }] });
    });
    const TF = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: fbFetch });
    const r = await TF.generateTool.run({ prompt: 'cube' }, { agentId: 'hero', emit: () => {} });
    A.eq(fbFetch.calls.length, 2, 'invalid-model 400 retries exactly once');
    A.eq(fbFetch.calls[1].body.model, 'google/gemini-2.5-flash-image', 'the retry rides the known-good LEGACY slug');
    A.ok(r.content.indexOf('gemini-2.5-flash-image') >= 0, 'the result names the model that ACTUALLY generated (honest fallback)');

    const rlFetch = stubFetch(() => jsonResp({ error: { message: 'rate limited' } }, 429));
    const TR = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: rlFetch });
    let threw = false; try { await TR.generateTool.run({ prompt: 'x' }, { agentId: 'hero', emit: () => {} }); } catch (e) { threw = /429/.test(e.message); }
    A.ok(threw && rlFetch.calls.length === 1, 'a non-model error (429) propagates untouched — no blind fallback');
  }

  // ---- H. deps.imageModel (the STARNET_IMAGE_MODEL knob) overrides the default; args.model still wins ----
  {
    const kFetch = stubFetch(() => jsonResp({ choices: [{ message: { images: [{ image_url: { url: DATA_URL } }] } }] }));
    const TK = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: kFetch, imageModel: 'openai/gpt-5-image' });
    await TK.generateTool.run({ prompt: 'a' }, { agentId: 'hero', emit: () => {} });
    A.eq(kFetch.calls[0].body.model, 'openai/gpt-5-image', 'deps.imageModel (env knob) overrides the built-in default');
    await TK.generateTool.run({ prompt: 'a', model: 'google/gemini-3-pro-image' }, { agentId: 'hero', emit: () => {} });
    A.eq(kFetch.calls[1].body.model, 'google/gemini-3-pro-image', 'an explicit per-call model still wins over the knob');
  }

  // ---- I. AUX VISION: session-provider fallback (the ref-style route; kills the "give me a key" bug) ----
  {
    // I1. NO key + auxVision -> analyze works through the session provider; no OpenRouter fetch fired
    const auxCalls = [];
    const noOrFetch = stubFetch(() => { throw new Error('must not hit OpenRouter'); });
    const TA = makeImageTools({ openrouter: { apiKey: '' }, fsp, pathMod: path, root: ROOT, fetchImpl: noOrFetch,
      auxVision: async (req) => { auxCalls.push(req); return 'a green triangle (session model)'; } });
    const r1 = await TA.analyzeTool.run({ image: 'https://example.com/x.jpg', prompt: 'what shape?' }, ctx);
    A.ok(/green triangle/.test(r1.content), 'keyless analyze answers via the session provider');
    A.eq(noOrFetch.calls.length, 0, 'no OpenRouter call was attempted without a key');
    A.eq(auxCalls[0].messages[0].content[0].text, 'what shape?', 'aux route forwards the question');
    A.eq(auxCalls[0].messages[0].content[1].type, 'image_url', 'aux route carries the image block');
    A.eq(TA.hasVision, true, 'hasVision is TRUE with auxVision even without a key (browser.vision stays wired)');
    const bva = await TA.browserVision({ imageBase64: 'AAAA', question: 'q' });
    A.ok(/green triangle/.test(bva), 'browserVision rides the aux route keyless');

    // I2. key present but OpenRouter FAILS (dead key / out of credits) -> aux route rescues
    const brokeFetch = stubFetch(() => jsonResp({ error: { message: 'This request requires more credits' } }, 402));
    const TB = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: brokeFetch,
      auxVision: async () => 'rescued by session model' });
    const r2 = await TB.analyzeTool.run({ image: 'https://example.com/x.jpg' }, ctx);
    A.ok(/rescued by session model/.test(r2.content), 'OpenRouter failure degrades to the session provider, not an error');
    A.eq(brokeFetch.calls.length, 1, 'OpenRouter was tried first when a key exists');

    // I3. both routes fail -> ONE error naming both causes
    const TC = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: brokeFetch,
      auxVision: async () => { throw new Error('model has no eyes'); } });
    let both = null; try { await TC.analyzeTool.run({ image: 'https://example.com/x.jpg' }, ctx); } catch (e) { both = e.message; }
    A.ok(/more credits/.test(both) && /no eyes/.test(both), 'double failure reports BOTH routes honestly');

    // I4. aux returning empty text -> honest may-not-support-vision error (never fake success)
    const TD = makeImageTools({ openrouter: { apiKey: '' }, fsp, pathMod: path, root: ROOT, fetchImpl: noOrFetch,
      auxVision: async () => '   ' });
    let empty = null; try { await TD.analyzeTool.run({ image: 'https://example.com/x.jpg' }, ctx); } catch (e) { empty = e.message; }
    A.ok(/may not support vision/.test(empty), 'empty session answer surfaces as a not-vision-capable error');

    // I5. image_generate is UNCHANGED: still requires the OpenRouter key even when auxVision exists
    let genKey = false; try { await TA.generateTool.run({ prompt: 'x' }, ctx); } catch (e) { genKey = /media connection/i.test(e.message); }
    A.ok(genKey, 'image_generate requires a media route; a vision callback alone cannot generate images');
  }

  // Cancellation fences: providers may ignore abort and a staged write may complete late.
  for (const phase of ['before', 'response', 'download', 'write']) {
    const ac = new AbortController(), bills = [], delivered = [];
    const aid = 'cancel-' + phase, rel = 'existing.png';
    const abs = path.join(ROOT, aid, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, 'original-image');
    let fetched = 0;
    const injectedFs = Object.assign({}, fsp, { writeFile: async (...args) => {
      await fsp.writeFile(...args);
      if (phase === 'write' && String(args[0]).includes('.pending-')) ac.abort();
    } });
    const tools = makeImageTools({ openrouter: { apiKey: 'fixture' }, fsp: injectedFs, pathMod: path, root: ROOT,
      onUsage: usage => bills.push(usage), fetchImpl: async url => {
        fetched++;
        if (phase === 'response') ac.abort();
        if (String(url).endsWith('/output.png')) {
          ac.abort();
          return { status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from(PNG_B64, 'base64') };
        }
        return jsonResp({ usage: { cost: .025 }, choices: [{ message: { images: [{ image_url: { url: phase === 'download' ? 'https://fixture.invalid/output.png' : DATA_URL } }] } }] });
      } });
    if (phase === 'before') ac.abort();
    let cancelled = false;
    try { await tools.generateTool.run({ prompt: 'cube', path: rel }, { agentId: aid, signal: ac.signal, emit: (...args) => delivered.push(args) }); }
    catch (e) { cancelled = e.name === 'AbortError'; }
    A.ok(cancelled, phase + ': cancellation propagates');
    A.eq(await fsp.readFile(abs, 'utf8'), 'original-image', phase + ': existing output remains intact');
    A.eq(delivered.length, 0, phase + ': no deliverable emitted');
    A.eq((await fsp.readdir(path.dirname(abs))).length, 1, phase + ': staged bytes cleaned up');
    A.eq(bills.length, phase === 'before' ? 0 : 1, phase + ': received charge retained once despite cancellation');
    if (phase === 'before') A.eq(fetched, 0, 'already cancelled dispatch makes no paid request');
  }
  // Unexpected cleanup failures stay observable without turning a published image into a failed run.
  {
    const failopen = require('../sidecar/failopen.js');
    const before = failopen.counts()['image.staging-cleanup'] || 0;
    const injectedFs = Object.assign({}, fsp, { unlink: async () => { throw Object.assign(new Error('fixture cleanup denied'), { code: 'EACCES' }); } });
    const tools = makeImageTools({ openrouter: { apiKey: 'fixture' }, fsp: injectedFs, pathMod: path, root: ROOT,
      fetchImpl: async () => jsonResp({ choices: [{ message: { images: [{ image_url: { url: DATA_URL } }] } }] }) });
    const delivered = [];
    const result = await tools.generateTool.run({ prompt: 'cube', path: 'cleanup-proof.png' }, { agentId: 'cleanup', emit: (...args) => delivered.push(args) });
    A.ok(/cleanup-proof.png/.test(result.content), 'cleanup diagnostic preserves a successfully published result');
    A.eq(delivered.length, 1, 'cleanup diagnostic does not duplicate the deliverable');
    A.eq(failopen.counts()['image.staging-cleanup'], before + 1, 'unexpected staging cleanup error is counted');
  }

  // ---- J. TRANSPARENCY (2026-09-28 user report: "a design with a transparent background"). Every Gemini image model
  //      paints a checkerboard into an opaque PNG; the agent then went hunting for raw API access nobody can grant. ----
  {
    const I = T0._internals;
    // J1. the verdict is read from the BYTES
    const logo = logoPng();
    A.eq(I.alphaCoverage(logo), { state: 'transparent', why: 'the alpha channel was checked', clearPct: 83.3 }, 'a clear background is transparent, and a subject at alpha 253 (the gpt-image-2 quirk) is not counted as clear');
    A.eq(I.alphaCoverage(encodePng({ w: 8, h: 8, ctype: 6, pixel: () => [9, 9, 9, 255] })), { state: 'opaque', why: 'the PNG has an alpha channel but every pixel is opaque' }, 'an alpha channel with no see-through pixel is opaque');
    A.eq(I.alphaCoverage(encodePng({ w: 40, h: 30, ctype: 6, pixel: (x, y) => (x || y) ? [9, 9, 9, 255] : [0, 0, 0, 0] })), { state: 'opaque', why: 'only 1 of 1200 pixels are see-through' }, 'a lone clear pixel is not a transparent background');
    const checker = encodePng({ w: 16, h: 16, ctype: 2, pixel: (x, y) => ((x >> 2) + (y >> 2)) % 2 ? [204, 204, 204] : [255, 255, 255] });
    A.eq(I.alphaCoverage(checker), { state: 'opaque', why: 'the PNG is RGB with no alpha channel' }, 'a PAINTED checkerboard (RGB) is opaque: the Gemini failure mode');
    A.eq(I.alphaCoverage(encodePng({ w: 10, h: 4, ctype: 4, pixel: x => x < 5 ? [0, 0] : [128, 255] })).clearPct, 50, 'greyscale+alpha is decoded');
    A.eq(I.alphaCoverage(encodePng({ w: 10, h: 4, ctype: 6, depth: 16, pixel: x => x < 5 ? [0, 0, 0, 0] : [65535, 0, 0, 65535] })).clearPct, 50, '16-bit RGBA is decoded (big-endian alpha)');
    A.eq(I.alphaCoverage(encodePng({ w: 10, h: 4, ctype: 3, plte: [0, 0, 0, 255, 0, 0], trns: [0], pixel: x => [x < 5 ? 0 : 1] })).clearPct, 50, 'a palette PNG is decoded through its tRNS entries');
    A.eq(I.alphaCoverage(encodePng({ w: 10, h: 4, ctype: 3, plte: [0, 0, 0, 255, 0, 0], pixel: x => [x < 5 ? 0 : 1] })).state, 'opaque', 'a palette PNG without tRNS is opaque');
    A.eq(I.alphaCoverage(encodePng({ w: 8, h: 8, ctype: 6, interlace: 1, pixel: () => [0, 0, 0, 0] })).state, 'unverified', 'an interlaced PNG is unverified, never guessed');
    A.eq(I.alphaCoverage(encodePng({ w: 8, h: 8, ctype: 6, rawIdat: Buffer.from('definitely not deflate'), pixel: () => [0, 0, 0, 0] })), { state: 'unverified', why: 'the PNG data could not be decoded' }, 'undecodable PNG data is unverified, never a claim');
    A.eq(I.alphaCoverage(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 74, 70, 73, 70, 0])).state, 'opaque', 'a JPEG is opaque');
    const webp = (tag, flags) => { const b = Buffer.alloc(30); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write(tag, 12, 'latin1'); b[20] = flags || 0; return b; };
    A.eq(I.alphaCoverage(webp('VP8 ')).state, 'opaque', 'a lossy WEBP is opaque');
    A.eq(I.alphaCoverage(webp('VP8X', 0x10)).state, 'unverified', 'a WEBP with an alpha flag is unverified, not claimed');
    A.eq(I.alphaCoverage(webp('VP8X', 0)).state, 'opaque', 'a WEBP without an alpha flag is opaque');
    A.eq(I.alphaCoverage(Buffer.from('not an image at all')).state, 'unverified', 'unknown bytes are unverified');
    for (const p of ['a fox logo on a transparent background', 'transparent-background sticker', 'transparent PNG icon', 'PNG with an alpha channel', 'a mascot with no background', 'a badge without a background', 'background-free emblem', 'backgroundless crest'])
      A.ok(I.TRANSPARENT_ASK.test(p), 'a transparency ask is recognized: ' + p);
    for (const p of ['a transparent glass vase on a wooden table', 'a jellyfish with transparent tentacles', 'a red cube on a white background'])
      A.ok(!I.TRANSPARENT_ASK.test(p), 'not a transparency ask: ' + p);

    // J2. transparent:true on the OpenRouter wire: off the Gemini default, an explicit alpha instruction, a verified file
    const logoFetch = stubFetch(() => imageReply(logo));
    const TT = makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: logoFetch });
    const tEmits = [];
    const tr = await TT.generateTool.run({ prompt: 'a fox logo', transparent: true, path: 'art/fox' }, { agentId: 'hero', emit: (n, p) => tEmits.push({ n, p }) });
    const sent = logoFetch.calls[0].body;
    A.eq(sent.model, I.TRANSPARENT_IMAGE_MODEL, 'transparent:true leaves the Gemini default for an alpha-capable model');
    A.eq(I.TRANSPARENT_IMAGE_MODEL, 'openai/gpt-5-image-mini', 'the alpha model is the one proven live on the OpenRouter wire');
    A.ok(sent.messages[0].content.indexOf('a fox logo ') === 0 && /fully transparent background \(PNG with an alpha channel\)/.test(sent.messages[0].content), 'the prompt gains an explicit transparency instruction');
    A.ok(/\nModel: google\/gemini-3\.1-flash-image cannot output transparency, so openai\/gpt-5-image-mini rendered this\./.test(tr.content), 'the result names the switch: ' + JSON.stringify(tr.content));
    A.ok(/\nTransparent background verified in the saved file: 83\.3% of pixels are see-through\./.test(tr.content), 'the result carries the verified coverage');
    A.eq(tr.summary, 'image → art/fox.png', 'a verified transparent render keeps the plain summary');
    A.ok(fssync.readFileSync(path.join(ROOT, 'hero', 'art', 'fox.png')).equals(logo), 'the saved bytes are the RGBA render');
    A.ok(tEmits.some(e => e.n === 'deliverable' && e.p.kind === 'image'), 'the transparent render is delivered');
    A.ok(/TRANSPARENT background/.test(TT.generateTool.description) && TT.generateTool.description.indexOf('openai/gpt-5-image-mini') >= 0, 'the tool teaches transparent:true and the model it uses');
    A.eq(TT.generateTool.schema.properties.transparent.type, 'boolean', 'the schema exposes transparent');

    // J3. a prompt that plainly asks counts as asking; an explicit false wins; a transparent SUBJECT is not a background
    await TT.generateTool.run({ prompt: 'a sticker of a cat on a transparent background' }, ctx);
    const askBody = logoFetch.calls[logoFetch.calls.length - 1].body;
    A.eq(askBody.model, 'openai/gpt-5-image-mini', 'a transparency prompt routes to the alpha model without the flag');
    A.eq(askBody.messages[0].content, 'a sticker of a cat on a transparent background', 'a prompt that already asks is sent unchanged');
    await TT.generateTool.run({ prompt: 'a logo on a transparent background', transparent: false }, ctx);
    A.eq(logoFetch.calls[logoFetch.calls.length - 1].body.model, 'google/gemini-3.1-flash-image', 'transparent:false keeps the default model');
    const glass = await TT.generateTool.run({ prompt: 'a transparent glass vase on a table' }, ctx);
    A.eq(logoFetch.calls[logoFetch.calls.length - 1].body.model, 'google/gemini-3.1-flash-image', 'a transparent subject does not switch models');
    A.ok(!/transparen/i.test(glass.content) && !/\nModel: /.test(glass.content), 'an ordinary render carries no transparency verdict');

    // J4. explicit models: Gemini is switched (and named), an alpha model is kept, an unknown one is kept and judged by its bytes
    await TT.generateTool.run({ prompt: 'hero logo', model: 'google/gemini-3-pro-image', transparent: true }, ctx);
    A.eq(logoFetch.calls[logoFetch.calls.length - 1].body.model, 'openai/gpt-5-image-mini', 'an explicit Gemini model cannot make alpha, so it is switched');
    const kept = await TT.generateTool.run({ prompt: 'hero logo', model: 'openai/gpt-5-image', transparent: true }, ctx);
    A.eq(logoFetch.calls[logoFetch.calls.length - 1].body.model, 'openai/gpt-5-image', 'an explicit alpha-capable model is kept');
    A.ok(!/\nModel: /.test(kept.content) && /Transparent background verified/.test(kept.content), 'no switch note when nothing was switched');
    const checkerFetch = stubFetch(() => imageReply(checker));
    const cEmits = [];
    const opaque = await makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: checkerFetch })
      .generateTool.run({ prompt: 'badge', model: 'black-forest-labs/flux.2-pro', transparent: true, path: 'art/badge' }, { agentId: 'hero', emit: (n, p) => cEmits.push({ n, p }) });
    A.eq(checkerFetch.calls[0].body.model, 'black-forest-labs/flux.2-pro', 'an explicit model of unknown ability is kept');
    A.ok(/\nNOT TRANSPARENT: the PNG is RGB with no alpha channel\./.test(opaque.content) && /painted, not transparency/.test(opaque.content), 'an opaque result is reported as NOT transparent: ' + JSON.stringify(opaque.content));
    A.ok(/Retry with transparent:true and no model override/.test(opaque.content), 'the retry that would work is named');
    A.eq(opaque.summary, 'image → art/badge.png (NOT transparent)', 'the summary the UI shows is truthful');
    A.ok(cEmits.some(e => e.n === 'deliverable'), 'the paid-for opaque image is still delivered');
    const flatFetch = stubFetch(() => imageReply(encodePng({ w: 8, h: 8, ctype: 6, pixel: () => [1, 2, 3, 255] })));
    const flat = await makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: flatFetch }).generateTool.run({ prompt: 'logo', transparent: true }, ctx);
    A.ok(/every pixel is opaque/.test(flat.content) && /The model ignored the request/.test(flat.content), 'an alpha model that ignored the request is reported as such, with no model hint');

    // J5. slug drift on a transparent render falls back to another ALPHA model, never onto the opaque legacy slug
    const driftFetch = stubFetch((url, body) => body && body.model === 'openai/gpt-5-image-mini'
      ? jsonResp({ error: { message: 'openai/gpt-5-image-mini is not a valid model ID' } }, 400)
      : imageReply(logo));
    const drift = await makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: driftFetch }).generateTool.run({ prompt: 'logo', transparent: true }, ctx);
    A.eq(driftFetch.calls.map(c => c.body.model), ['openai/gpt-5-image-mini', 'openai/gpt-5-image'], 'a transparent render retries on the alpha fallback');
    A.ok(/model openai\/gpt-5-image\)/.test(drift.content), 'the result names the model that actually rendered');

    // J6. the OpenAI Images API takes transparency as a parameter; DALL-E has none, so it is switched
    const oaFetch = stubFetch(() => jsonResp({ data: [{ b64_json: logo.toString('base64') }] }));
    const TOA = makeImageTools({ openrouter: { apiKey: 'openai-key', provider: 'openai', protocol: 'openai-images' }, fsp, pathMod: path, root: ROOT, fetchImpl: oaFetch });
    const oa = await TOA.generateTool.run({ prompt: 'a fox logo', transparent: true }, ctx);
    const ob = oaFetch.calls[0].body;
    A.eq([ob.model, ob.size, ob.background, ob.output_format], ['gpt-image-2', '1024x1024', 'transparent', 'png'], 'the Images API gets background:transparent with a PNG output');
    A.ok(/Transparent background verified/.test(oa.content), 'an Images API render is verified the same way');
    A.ok(/real alpha channel/.test(TOA.generateTool.description) && !/gpt-5-image-mini/.test(TOA.generateTool.description), 'the OpenAI route teaches its own transparency path');
    const dalle = stubFetch(() => jsonResp({ data: [{ b64_json: logo.toString('base64') }] }));
    await makeImageTools({ openrouter: { apiKey: 'openai-key', provider: 'openai', protocol: 'openai-images' }, imageModel: 'dall-e-3', fsp, pathMod: path, root: ROOT, fetchImpl: dalle })
      .generateTool.run({ prompt: 'logo', transparent: true }, ctx);
    A.eq(dalle.calls[0].body.model, 'gpt-image-2', 'a transparent render leaves DALL-E, which has no background parameter');

    // J7. bytes the decoder cannot count are reported unverified, never claimed
    const interFetch = stubFetch(() => imageReply(encodePng({ w: 8, h: 8, ctype: 6, interlace: 1, pixel: () => [0, 0, 0, 0] })));
    const inter = await makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: interFetch }).generateTool.run({ prompt: 'logo', transparent: true, path: 'art/inter' }, ctx);
    A.ok(/\nTransparency NOT verified: this PNG layout/.test(inter.content) && /Do not claim the background is transparent/.test(inter.content), 'unverifiable alpha is said plainly');
    A.eq(inter.summary, 'image → art/inter.png (transparency unverified)', 'and the summary says so');

    // J8. an exact-size fit keeps the alpha channel, and the verdict reads the FITTED bytes (sharp-encoded, adaptive filters)
    let sharp = null; try { sharp = require('sharp'); } catch (_) {}
    if (sharp) {
      const wide = await sharp({ create: { width: 160, height: 90, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: { create: { width: 40, height: 40, channels: 4, background: { r: 200, g: 40, b: 20, alpha: 1 } } }, left: 60, top: 25 }]).png().toBuffer();
      const fitFetch = stubFetch(() => imageReply(wide));
      const fit = await makeImageTools({ openrouter: { apiKey: 'k' }, fsp, pathMod: path, root: ROOT, fetchImpl: fitFetch }).generateTool.run({ prompt: 'logo', transparent: true, width: 64, height: 36, path: 'art/fit' }, ctx);
      A.ok(/fitted to 64x36/.test(fit.content) && /Transparent background verified/.test(fit.content), 'an exact-size transparent render keeps its alpha: ' + JSON.stringify(fit.content));
    }
  }
  try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) {}
  A.report('image.test');
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
