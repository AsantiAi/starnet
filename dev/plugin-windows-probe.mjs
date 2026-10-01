// PLUGIN WINDOWS — live proof on a disposable seeded station (plugin extensions phase 1, 2026-09-29).
//   node dev/plugin-windows-probe.mjs        → .worldshots/plugin-windows/*.png + report.json
// Boots an isolated sidecar (scratch WORKSPACES + scratch APPDATA/LOCALAPPDATA/USERPROFILE/HOME, mocked model
// catalog), creates the starter plugin through the real route, opens its window through the real host, then
// proves from INSIDE the sandboxed frame: the kit is loaded and themed, the bridge answers, the store round-trips,
// and the page cannot reach the station (no token, no parent DOM, no credentialed API). Then a theme change, a
// text-size change, and an on-disk edit (the window must say the plugin is off, never keep running old code).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { findChrome, connectCDP, evalJS, capture, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = 9492, CDP_PORT = 9493;
const out = '.worldshots/plugin-windows';
const scratch = mkdtempSync(join(tmpdir(), 'starnet-plugin-windows-'));
const ws = join(scratch, 'ws');
for (const d of ['home', 'appdata', 'local']) mkdirSync(join(scratch, d), { recursive: true });
mkdirSync(out, { recursive: true });
materializeSeedWorkspace(ws, 'test/model');
const report = { checks: [], facts: {}, exceptions: [] };
let side, chrome, cdp;

// The Weather Deck the "crew" writes in conversation B: a window-only plugin built from kit classes.
const WEATHER_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Weather Deck</title></head><body><div class="sn-stack">'
  + '<div class="sn-stats"><div class="sn-stat"><b id="t">18°</b><span>Tomorrow</span></div><div class="sn-stat ok"><b>12%</b><span>Rain</span></div><div class="sn-stat"><b>NW 9</b><span>Wind</span></div></div>'
  + '<div><h4 class="sn-sect">▮ Next hours</h4><ul class="sn-list"><li class="sn-item"><span class="dot ok"></span><span class="t">09:00 · clear</span><span>16°</span></li>'
  + '<li class="sn-item"><span class="dot warn"></span><span class="t">15:00 · clouds</span><span>18°</span></li></ul></div>'
  + '<div class="sn-row-flex"><button class="sn-btn primary" id="r">REFRESH</button></div></div>'
  + '<script>document.getElementById("r").onclick=()=>starnet.ui.toast("Refreshed");</script></body></html>';
// The mock model: serves the catalog, and on a chat turn calls the plugin's add_note tool IF the run offers it
// (that offer is the proof the placed terminal projected the plugin's tools), then answers after the tool result.
const modelLog = { turns: 0, offered: [], toolResult: '' };
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (!/chat\/completions/.test(req.url || '')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 32000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
    }
    let body = {}; try { body = JSON.parse(raw); } catch {}
    modelLog.turns++;
    const names = (body.tools || []).map((t) => (t.function && t.function.name) || t.name || '');
    modelLog.lastNames = names.filter((n) => !/^tool[._]search$/.test(n)).slice(0, 80);
    const pluginTool = names.find((n) => /plugin__pr-radar__add_note/.test(n));
    if (pluginTool) modelLog.offered.push(pluginTool);
    const msgs = body.messages || [];
    const last = msgs[msgs.length - 1] || {};
    let delta, finish;
    const call = (id, name, args) => ({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    const lastText = String(last.content || '');
    const lastUser = String(([...msgs].reverse().find((m) => m.role === 'user') || {}).content || '');
    // CONVERSATION B — "build me a plugin": the crew authors one with the real plugin.* tools (found via tool.search)
    if (/build me a weather plugin/i.test(lastUser)) {
      const wire = (re) => names.find((n) => re.test(n));
      const say = (d, f) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: ' + JSON.stringify({ choices: [{ delta: d }] }) + '\n\n'); res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: f }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }) + '\n\n'); res.end('data: [DONE]\n\n'); };
      modelLog.authorSteps = (modelLog.authorSteps || []).concat([last.role === 'tool' ? lastText.slice(0, 60) : 'user']);
      const tn = (re, fallback) => wire(re) || fallback;   // deferred tools may not be in this turn's list: call by wire name
      const after = last.role === 'tool' ? String(last.tool_call_id || '') : '';   // route on WHICH call answered, never on its text
      const stuck = () => { modelLog.authorStuck = after + ': ' + lastText.slice(0, 400); return say({ content: 'STUCK after ' + after + ': ' + lastText.slice(0, 200) }, 'stop'); };
      const search = tn(/^tool[._]search$/, 'tool_search');
      if (!after) return say(call('s1', search, { query: 'plugin draft preview submit' }), 'tool_calls');
      if (after === 's1') return say(call('b1', 'brief_proceed', { objective: 'Build a weather plugin for the Commander' }), 'tool_calls');
      if (after === 'b1') return /Task Brief settled/.test(lastText) ? say(call('d1', tn(/plugin[._]draft_start/, 'plugin_draft_start'), { id: 'weather-deck', name: 'Weather Deck', description: 'Tomorrow at a glance' }), 'tool_calls') : stuck();
      if (after === 'd1') return /ready with/.test(lastText) ? say(call('d2', tn(/plugin[._]draft_write/, 'plugin_draft_write'), { id: 'weather-deck', path: 'plugin.json', content: JSON.stringify({ name: 'Weather Deck', version: '1.0.0', description: 'Tomorrow at a glance', screens: [{ id: 'main', title: 'WEATHER DECK', entry: 'ui/index.html', size: 'panel' }] }) }), 'tool_calls') : stuck();
      if (after === 'd2') return /plugin\.json/.test(lastText) && !/ERROR/.test(lastText) ? say(call('d3', tn(/plugin[._]draft_write/, 'plugin_draft_write'), { id: 'weather-deck', path: 'ui/index.html', content: WEATHER_HTML }), 'tool_calls') : stuck();
      if (after === 'd3') return /ui\/index\.html/.test(lastText) && !/ERROR/.test(lastText) ? say(call('d4', tn(/plugin[._]check/, 'plugin_check'), { id: 'weather-deck' }), 'tool_calls') : stuck();
      if (after === 'd4') { modelLog.authorCheck = lastText.slice(0, 600); return /OK — no problems/.test(lastText) ? say(call('d5', tn(/plugin[._]preview/, 'plugin_preview'), { id: 'weather-deck' }), 'tool_calls') : stuck(); }
      if (after === 'd5') return /DRAFT window/.test(lastText) ? say(call('d6', tn(/plugin[._]submit/, 'plugin_submit'), { id: 'weather-deck' }), 'tool_calls') : stuck();
      if (after === 'd6') { modelLog.authorFinal = lastText.slice(0, 400); return say({ content: 'Weather Deck is installed and waiting for your approval in EXTENSIONS.' }, 'stop'); }
      return stuck();
    }
    // like a real model: settle the Task Brief (the harness requires it before consequential work), then use the
    // plugin's tool, then answer from its result
    if (!pluginTool && last.role !== 'tool') { delta = { content: 'NO PLUGIN TOOL OFFERED' }; finish = 'stop'; }
    else if (last.role !== 'tool') { delta = call('brief_1', 'brief_proceed', { objective: 'Add a note to PR Radar' }); finish = 'tool_calls'; }
    else if (/Task Brief settled/.test(lastText)) { delta = call('call_plugin_1', pluginTool || 'plugin__pr-radar__add_note', { text: 'Crew note from the probe' }); finish = 'tool_calls'; }
    else { modelLog.toolResult = lastText; delta = { content: 'Added the note to PR Radar.' }; finish = 'stop'; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + mock.address().port + '/api/v1';
const iso = {
  SKYNET_OPENROUTER_BASE: base, STARNET_OPENROUTER_BASE: base,
  APPDATA: join(scratch, 'appdata'), LOCALAPPDATA: join(scratch, 'local'), USERPROFILE: join(scratch, 'home'), HOME: join(scratch, 'home'),
  XDG_DATA_HOME: join(scratch, 'local'), HERMES_HOME: join(scratch, 'hermes'), STARNET_PROJECT_DISCOVERY_ROOTS: join(scratch, 'home')
};

const run = (s) => evalJS(cdp, s);
async function until(s, tries = 150) { for (let i = 0; i < tries; i++) { try { if (await run(s)) return; } catch {} await sleep(200); } throw Error('Timed out: ' + s); }
async function check(name, cond) { assert.ok(cond, name); report.checks.push(name); }

// ---- the plugin frame's own execution context (kept in-process for the probe; see the chrome flags) ----
const contexts = new Map();   // frameId -> contextId
let mainFrameId = null;
async function frameEval(expression, urlRe) {
  const tree = await cdp.send('Page.getFrameTree');
  mainFrameId = tree.frameTree.frame.id;
  const kids = (tree.frameTree.childFrames || []).map((c) => c.frame).filter((f) => (urlRe || /\/plugin-ui\/.*\/pr-radar\//).test(f.url));
  if (!kids.length) throw Error('no plugin frame');
  const ctx = contexts.get(kids[kids.length - 1].id);
  if (!ctx) throw Error('no context for the plugin frame yet');
  const r = await cdp.send('Runtime.evaluate', { expression, contextId: ctx, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error('frame eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}
async function frameUntil(s, tries = 100, urlRe) { for (let i = 0; i < tries; i++) { try { if (await frameEval(s, urlRe)) return; } catch {} await sleep(200); } throw Error('Timed out in frame: ' + s); }

try {
  side = bootSeededSidecar({ port: PORT, model: 'test/model', scratchDir: ws, key: 'sk-or-ui-fixture', fullAccess: false, env: iso });
  assert.ok(await waitUp('http://127.0.0.1:' + PORT + '/'));
  chrome = spawn(findChrome(), ['--headless=new', '--enable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    // keep the sandboxed (opaque-origin) frame in the page's process so the probe can evaluate inside it
    ...(process.env.ISOLATED ? [] : ['--disable-features=IsolateSandboxedIframes,site-per-process']),
    '--remote-debugging-port=' + CDP_PORT, '--window-size=1440,900', '--user-data-dir=' + join(scratch, 'chrome'), 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCDP(CDP_PORT);
  cdp.on('Runtime.executionContextCreated', (e) => { const a = e.context.auxData || {}; if (a.isDefault && a.frameId) contexts.set(a.frameId, e.context.id); });
  cdp.on('Runtime.exceptionThrown', (e) => report.exceptions.push(e.exceptionDetails.exception?.description || e.exceptionDetails.text));
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  assert.ok(await waitDevReady(cdp, evalJS, { url: 'http://127.0.0.1:' + PORT + '/' }));
  await until(`typeof PluginHost === 'object' && typeof StationUI === 'object'`);

  // ---- 1. the starter plugin, created through the real route, opens as a real window ----
  // through the real EXTENSIONS form: ABILITIES → CREATE / ADVANCED → EXTENSIONS → Create a plugin
  await run(`StationUI.openTerm('connectors','extensions')`);
  await until(`!!document.querySelector('#pl-form') && !!document.querySelector('[data-ext-editor="plugin"]')`);
  await run(`document.querySelector('[data-ext-editor="plugin"]').click()`);
  await run(`(()=>{const n=document.querySelector('#pl-name');n.focus();n.value='PR Radar';n.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await run(`document.querySelector('#pl-add').click()`);
  await until(`document.querySelector('.term.plugin-win iframe.plugin-frame')`);
  await until(`/Plugin created and its window opened/.test(document.querySelector('#ext-msg').textContent)`, 50);
  await check('"Create a plugin" makes the starter AND opens its window straight away', true);
  report.facts.createMsg = await run(`document.querySelector('#ext-msg').textContent`);
  await check('its tools came up in its own process and its TERMINAL was placed in the lead\'s room', /terminal now stands in the lead/.test(report.facts.createMsg));
  report.facts.terminal = await run(`JSON.stringify(PluginHost.terminalOf('pr-radar'))`);
  await check('the terminal is a real placed prop bound to the plugin', /"id":"p\d+"/.test(report.facts.terminal));
  report.facts.leadCaps = await run(`(()=>{ const st=App.station(); const d=st.serialize(); const t=d.props.find(p=>p.t==='plugin_terminal'); return JSON.stringify({ caps: st.bayObjects('agent'), capRoom: st.agentRoomId('agent'), termRoom: t && st.roomAt ? st.roomAt(t.x,t.y) : null, agentProps: d.props.filter(p=>p.agentId==='agent').map(p=>p.t+'@'+p.x+','+p.y), term: t }); })()`);
  await check('the terminal projects the plugin capability into the lead\'s run reach', await run(`World.heroCaps('agent').some(o => o && o.objectType === 'plugin' && o.pluginId === 'pr-radar')`));
  await check('the EXTENSIONS row offers OPEN PR RADAR', await run(`[...document.querySelectorAll('[data-ext="plugin-open"]')].some(b=>b.textContent==='OPEN PR RADAR')`));
  await check('it opens again through the ordinary registry', await run(`PluginHost.open('pr-radar','main')`) === true);
  await until(`document.querySelector('.term.plugin-win').classList.contains('gd-sheet')`);
  await check('the window is a glass sheet (glass-demo.js attached it like every other window)', true);
  await check('the station title bar carries the PLUGIN plate', await run(`!!document.querySelector('.term.plugin-win .plugin-plate')`));
  await check('the frame is sandboxed WITHOUT allow-same-origin', await run(`(()=>{const s=document.querySelector('iframe.plugin-frame').getAttribute('sandbox');return /allow-scripts/.test(s)&&!/allow-same-origin/.test(s)})()`));

  // ISOLATED=1: Chrome's DEFAULT process model (sandboxed frames in their own process, as WebView2 runs them). The
  // frame cannot be evaluated from here, so prove the bridge from the OUTSIDE: the kit's auto-height call lands,
  // and a note typed by the starter's own code would need the frame — so the store is proven by the host call.
  if (process.env.ISOLATED) {
    await until(`document.querySelector('iframe.plugin-frame').style.height !== '240px'`, 60);
    await check('ISOLATED: the kit loaded in its own process and its bridge call reached the host (auto height)', true);
    const tree = await cdp.send('Page.getFrameTree');
    report.facts.isolatedFrameUrl = ((tree.frameTree.childFrames || [])[0] || {}).frame?.url?.replace(/~t\/[^/]+/, '~t/<ticket>');
    await run(`StationUI.setTheme('green')`); await sleep(500);
    report.facts.shotIsolated = await capture(cdp, out, 'isolated-green');
    writeFileSync(join(out, 'report-isolated.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
  // ---- 2. inside the frame: the kit loaded, themed, and the bridge answers ----
  await frameUntil(`typeof starnet === 'object' && document.readyState === 'complete'`);
  await frameUntil(`starnet.ready.then(i => !!(i && i.plugin && i.plugin.id === 'pr-radar'))`);
  await check('the bridge says hello with the RIGHT plugin (named by the host, not the page)', true);
  const phParent = await run(`getComputedStyle(document.body).getPropertyValue('--ph').trim()`);
  await frameUntil(`getComputedStyle(document.documentElement).getPropertyValue('--ph').trim() === ${JSON.stringify(phParent)}`);
  await check('the frame carries the station\'s live --ph', true);
  report.facts.frameFont = await frameEval(`getComputedStyle(document.body).fontFamily`);
  await check('the kit font is VT323', /VT323/.test(report.facts.frameFont));
  await frameUntil(`document.fonts.check('18px VT323')`);
  report.facts.frameBg = await frameEval(`getComputedStyle(document.body).backgroundColor + ' / html ' + getComputedStyle(document.documentElement).backgroundColor`);
  await check('the page is transparent (the window glass is its background)', /rgba\(0, 0, 0, 0\).*rgba\(0, 0, 0, 0\)/.test(report.facts.frameBg));
  const whites = await frameEval(`[...document.querySelectorAll('button,input,select,textarea')].filter(e=>['rgb(255, 255, 255)','rgb(239, 239, 239)'].includes(getComputedStyle(e).backgroundColor)||getComputedStyle(e).borderColor==='rgb(118, 118, 118)').length`);
  await check('no control in the starter is left in the browser\'s white paint', whites === 0);
  await sleep(600);
  report.facts.shot1 = await capture(cdp, out, '01-starter-window-amber');

  // ---- 3. the store round-trips through the host, and survives on disk ----
  await run(`(()=>{ window.__pluginToasts=[]; const o=StationUI.notify; StationUI.notify=function(text, cls, cat, opts){ window.__pluginToasts.push({ text, transient: !!(opts && opts.transient) }); return o.apply(this, arguments); }; return true; })()`);
  const stored = await frameEval(`(async()=>{ await starnet.store.set('probe',{n:42}); return (await starnet.store.get('probe')).n; })()`);
  await check('store.set → store.get round-trips through the host', stored === 42);
  await frameEval(`(async()=>{ const i=document.getElementById('note'); i.value='Ship plugin windows'; document.getElementById('add').requestSubmit(); await new Promise(r=>setTimeout(r,600)); return true; })()`);
  await frameUntil(`document.querySelectorAll('#list .sn-item').length === 1`);
  const onDisk = join(ws, 'plugin-data', 'pr-radar.json');
  await check('the note is saved by the station on disk', existsSync(onDisk) && /Ship plugin windows/.test(readFileSync(onDisk, 'utf8')));
  await until(`(window.__pluginToasts || []).some(t => /^PR Radar: Note saved/.test(t.text) && t.transient)`, 40);
  await check('a plugin toast reaches the station, prefixed with the plugin name, and stays out of the notification history', await run(`!StationUI.h.store.notifs.some(n => /^PR Radar:/.test(n.txt))`));
  await frameUntil(`/^\\d+$/.test(document.getElementById('stat-calls').textContent)`, 60);
  await check('the window reaches its own backend (starnet.backend.call → api.handle, in the plugin process)', true);
  await sleep(300);
  report.facts.shot2 = await capture(cdp, out, '02-note-saved');

  // ---- 3b. the CREW uses the plugin: a real chat run, the plugin tool offered, a real approval card, the effect ----
  await run(`App.persist(), true`);
  await sleep(2500);   // the station save reaches the sidecar (the run resolves tools from the saved floor)
  await run(`(()=>{ const i=document.getElementById('chat-input'); i.value='Add a note to PR Radar saying the probe was here'; i.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('chat-send').click(); return true; })()`);
  await until(`[...document.querySelectorAll('#chat-panel button')].some(b => b.textContent.trim() === 'Approve once' && !b.disabled)`, 150);
  report.facts.approvalCard = await run(`(()=>{ const b=[...document.querySelectorAll('#chat-panel button')].find(b => b.textContent.trim()==='Approve once'); const card=b.closest('.perm,.permission,.beat,.msg,div'); return (card && card.textContent || '').replace(/\\s+/g,' ').slice(0,300); })()`);
  await check('the plugin tool reached the lead\'s run (the placed terminal projected it)', modelLog.offered.length > 0);
  await sleep(300);
  report.facts.shot2b = await capture(cdp, out, '02b-approval-card');
  await run(`[...document.querySelectorAll('#chat-panel button')].find(b => b.textContent.trim()==='Approve once').click(), true`);
  await frameUntil(`[...document.querySelectorAll('#list .sn-item .t')].some(e => e.textContent === 'Crew note from the probe')`, 80);
  await check('after "Approve once" the plugin\'s tool ran and its window shows the crew\'s note (gold lamp)', await frameEval(`[...document.querySelectorAll('#list .sn-item')].some(li => li.querySelector('.t').textContent === 'Crew note from the probe' && li.querySelector('.dot.warn'))`));
  await check('the crew\'s note is on disk in the plugin\'s store', /Crew note from the probe/.test(readFileSync(onDisk, 'utf8')) && /"by": ?"crew"/.test(readFileSync(onDisk, 'utf8')));
  for (let i = 0; i < 50 && !modelLog.toolResult; i++) await sleep(100);
  report.facts.toolResultToModel = modelLog.toolResult.slice(0, 240);
  await check('the tool result reached the model FENCED as external content', /EXTERNAL/.test(modelLog.toolResult) && /Added\. The window now shows/.test(modelLog.toolResult));
  await sleep(500);
  report.facts.shot2c = await capture(cdp, out, '02c-crew-note');

  // ---- 3c. the CREW BUILDS a plugin: draft → check → DRAFT preview → submit (approval) → Commander approves → live ----
  await run(`(()=>{ const i=document.getElementById('chat-input'); i.value='Build me a weather plugin with tomorrow at a glance'; i.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('chat-send').click(); return true; })()`);
  await until(`!!document.querySelector('.term.plugin-draft-win iframe.plugin-frame')`, 150);
  await check('the crew\'s draft opened as a DRAFT window (plugin.draft_start → draft_write → check → preview)', true);
  await check('the draft window wears the gold DRAFT plate, not PLUGIN', await run(`document.querySelector('.term.plugin-draft-win .plugin-plate').textContent === 'DRAFT'`));
  await check('the draft is served from /plugin-draft/ (a draft ticket, never the installed route)', await run(`/\\/plugin-draft\\/~t\\//.test(document.querySelector('.term.plugin-draft-win iframe.plugin-frame').src)`));
  await frameUntil(`document.querySelectorAll('.sn-stat').length === 3 && typeof starnet === 'object'`, 80, /\/plugin-draft\/.*weather-deck/);
  await check('the draft page runs with the kit, drawn in station glass', await frameEval(`getComputedStyle(document.body).fontFamily.indexOf('VT323') >= 0`, /\/plugin-draft\/.*weather-deck/));
  const draftBackend = await frameEval(`starnet.backend.call('x').then(()=>'ran', e=>e.message)`, /\/plugin-draft\/.*weather-deck/);
  await check('a draft has no backend (its code never runs before approval)', /no backend/.test(draftBackend));
  await sleep(400);
  report.facts.shot7 = await capture(cdp, out, '07-draft-preview');
  await until(`[...document.querySelectorAll('#chat-panel button')].some(b => b.textContent.trim() === 'Approve once' && !b.disabled)`, 150);
  report.facts.submitCard = await run(`((document.querySelector('#chat-panel').innerText || '').match(/wants to install the plugin it built[^\\n]*/g) || []).pop() || ''`);
  await check('installing the draft asks first, and the card says it stays OFF until approved', /install the plugin it built “weather-deck” — it stays OFF until you approve/.test(report.facts.submitCard));
  await run(`(()=>{ const bs=[...document.querySelectorAll('#chat-panel button')].filter(b => b.textContent.trim()==='Approve once' && !b.disabled); bs[bs.length-1].click(); return true; })()`);
  for (let i = 0; i < 80 && !modelLog.authorFinal; i++) await sleep(200);
  await check('submit installed it OFF and said so', /it is OFF until the Commander approves it/.test(modelLog.authorFinal || ''));
  const wlist = await run(`fetch('/api/plugins').then(r=>r.json()).then(j=>j.plugins.filter(p=>p.id==='weather-deck').map(p=>({active:p.active,pending:p.pending,hasCode:p.hasCode})))`);
  await check('the installed plugin is listed OFF and pending the Commander\'s approval (the agent cannot switch it on)', wlist.length === 1 && !wlist[0].active && wlist[0].pending && wlist[0].hasCode === false);
  await run(`StationUI.openTerm('connectors','extensions')`);
  await until(`!!document.querySelector('[data-ext="plugin-allow"][data-id="weather-deck"]')`, 60);
  await run(`document.querySelector('[data-ext="plugin-allow"][data-id="weather-deck"]').click(), true`);
  await until(`!!document.querySelector('[data-ext="plugin-open"][data-id="weather-deck"]')`, 60);
  await check('the Commander\'s APPROVE & ENABLE turns it on', true);
  await run(`(()=>{ const r=document.querySelector('[data-ext="plugin-open"][data-id="pr-radar"]'); (r||document.querySelector('#pl-list')).scrollIntoView({block:'center'}); return true; })()`);
  await run(`(()=>{ document.querySelectorAll('.term.plugin-win').forEach(w => { if (w._minimize) w._minimize(); }); StationUI.openTerm('connectors','extensions'); const r=document.querySelector('#pl-list'); if (r) r.scrollIntoView({block:'start'}); return true; })()`);
  await sleep(700);
  report.facts.shotExt = await capture(cdp, out, '09-extensions-rows');
  await run(`document.querySelector('[data-ext="plugin-open"][data-id="weather-deck"]').click(), true`);
  await until(`[...document.querySelectorAll('.term.plugin-win:not(.plugin-draft-win) .term-title')].some(t => t.textContent === 'WEATHER DECK')`, 60);
  await frameUntil(`document.querySelectorAll('.sn-stat').length === 3`, 80, /\/plugin-ui\/.*weather-deck/);
  await until(`!document.querySelector('.term.plugin-draft-win')`, 30);   // the close plays its exit motion first
  await check('opening the installed plugin closed its DRAFT preview (no stale copy left docked)', true);
  await check('the crew-built plugin now opens as a real PLUGIN window', await run(`[...document.querySelectorAll('.term.plugin-win:not(.plugin-draft-win)')].some(w => w.querySelector('.term-title').textContent === 'WEATHER DECK' && w.querySelector('.plugin-plate').textContent === 'PLUGIN')`));
  await sleep(500);
  report.facts.shot8 = await capture(cdp, out, '08-crew-built-plugin-live');

  // ---- 4. the page CANNOT reach the station ----
  await check('no API token in the frame', await frameEval(`typeof window.__STARNET_API_TOKEN__ === 'undefined'`));
  await check('the frame cannot read the station page', await frameEval(`(()=>{ try { return !window.parent.document; } catch (e) { return true; } })()`));
  await check('the frame is an opaque origin', await frameEval(`origin === 'null'`));
  const apiTry = await frameEval(`fetch('http://127.0.0.1:${PORT}/api/plugins').then(r=>'status '+r.status, e=>'blocked: '+e.name)`);
  report.facts.apiFromFrame = apiTry;
  await check('a direct /api call from the frame is refused', /blocked|status 403/.test(apiTry));
  const other = await frameEval(`starnet.call('store.get',{key:'probe',id:'someone-else'}).then(v=>JSON.stringify(v))`);
  await check('the page cannot name a different plugin (the host always uses its own)', other === JSON.stringify({ n: 42 }));
  const noNonce = await frameEval(`new Promise((res) => { let got = false; const h = (ev) => { if (ev.data && ev.data.re === 9999) got = true; }; addEventListener('message', h); parent.postMessage({ __sn: 1, id: 9999, m: 'store.keys', a: {} }, '*'); setTimeout(() => { removeEventListener('message', h); res(got); }, 800); })`);
  await check('a message WITHOUT the frame nonce is never answered (a page this frame navigated to cannot use the bridge)', noNonce === false);
  await check('the frame is labelled for assistive tech with aria-label, never title= (the station tooltip would park over the plugin)', await run(`(()=>{ const f=document.querySelector('iframe.plugin-frame[data-plugin="pr-radar"]'); return !f.hasAttribute('title') && !f.hasAttribute('data-tip') && /PR Radar/.test(f.getAttribute('aria-label')||''); })()`));
  const unknown = await frameEval(`starnet.call('fs.read',{path:'C:/'}).then(()=>'answered',e=>e.message)`);
  await check('an unknown bridge call is refused', /unknown call/.test(unknown));
  const badLink = await frameEval(`starnet.ui.openLink('file:///C:/Windows').then(()=>'opened',e=>e.message)`);
  await check('a non-https link is refused', /https/.test(badLink));

  // ---- 5. the KIT tab, then a theme change repaints the plugin with the station ----
  await frameEval(`document.querySelector('[data-tab="kit"]').click(), true`);
  await sleep(400);
  await check('the KIT tab swaps the pane (hidden always hides, even on a flex stack)',
    await frameEval(`getComputedStyle(document.querySelector('[data-pane="notes"]')).display === 'none' && getComputedStyle(document.querySelector('[data-pane="kit"]')).display !== 'none'`));
  report.facts.shot3 = await capture(cdp, out, '03-kit-tab-amber');
  await run(`StationUI.setTheme('green')`);
  const phGreen = await run(`getComputedStyle(document.body).getPropertyValue('--ph').trim()`);
  await frameUntil(`getComputedStyle(document.documentElement).getPropertyValue('--ph').trim() === ${JSON.stringify(phGreen)}`);
  await check('a theme change repaints the plugin (' + phParent + ' → ' + phGreen + ')', phGreen !== phParent);
  await sleep(400);
  report.facts.shot4 = await capture(cdp, out, '04-kit-tab-green');
  await run(`StationUI.setTheme('amber')`);

  // ---- 6. text size: how the frame scales with the station's body zoom ----
  const before = await frameEval(`innerWidth`);
  const rectBefore = await run(`document.querySelector('iframe.plugin-frame[data-plugin="pr-radar"]').getBoundingClientRect().width`);
  await run(`document.body.style.zoom='1.3'`);
  await sleep(500);
  const after = await frameEval(`innerWidth`);
  const rectAfter = await run(`document.querySelector('iframe.plugin-frame[data-plugin="pr-radar"]').getBoundingClientRect().width`);
  report.facts.zoom = { frameInnerWidthBefore: before, frameInnerWidthAfter: after, frameRectBefore: rectBefore, frameRectAfter: rectAfter };
  report.facts.shot5 = await capture(cdp, out, '05-text-size-130');
  await run(`document.body.style.removeProperty('zoom')`);

  // ---- 7. an edit on disk turns the plugin off: the open window says so ----
  appendFileSync(join(ws, 'plugins', 'pr-radar', 'ui', 'index.html'), '\n<!-- edited -->\n');
  await run(`PluginHost.refresh()`);
  await until(`!!([...document.querySelectorAll('.term.plugin-win')].find(w => w.querySelector('.term-title').textContent === 'PR RADAR')).querySelector('.plugin-gone')`);
  await check('after an edit the open window stops showing the old code and says it changed since approval', await run(`(()=>{ const w=[...document.querySelectorAll('.term.plugin-win')].find(w => w.querySelector('.term-title').textContent === 'PR RADAR'); return !w.querySelector('iframe.plugin-frame') && /changed since you approved it/.test(w.querySelector('.plugin-gone').textContent); })()`));
  const list = await run(`fetch('/api/plugins').then(r=>r.json()).then(j=>j.plugins.map(p=>({id:p.id,active:p.active,pending:p.pending})))`);
  await check('and the plugin is listed as needing approval again', list.some((p) => p.id === 'pr-radar' && !p.active && p.pending));
  report.facts.shot6 = await capture(cdp, out, '06-edited-turned-off');

  assert.equal(report.exceptions.length, 0, JSON.stringify(report.exceptions));
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  if (cdp) await capture(cdp, out, 'failure').catch(() => {});
  writeFileSync(join(out, 'report.json'), JSON.stringify(Object.assign(report, { error: String(e && e.stack || e), modelLog }), null, 2));
  console.error(e); process.exitCode = 1;
} finally {
  try { cdp?.ws.close(); } catch {}
  chrome?.kill(); side?.kill(); mock.close();
}
