/* node test/hudmode.test.js
   Locks HUD MODE (frontend/app/hudmode.js + src-tauri/src/hud_mode.rs):
     · the deck's feed model states only what the harness proved — the /api/state/snapshot is the
       authority on what is running, events only enrich it, and nothing is claimed before the first
       snapshot lands;
     · the page wiring (button, stylesheet, script) and the station windows staying reachable;
     · the desktop wiring: module, managed state, commands, the tray's HUD Mode / Open StarNet paths,
       and the HUD's restore floor mirroring the main window's builder. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const H = require('../frontend/app/hudmode.js');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const names = { agent: { name: 'NOVA', color: '#4af' }, researcher: { name: 'ORION', color: '#4c8' } };
const who = id => names[id] || null;
const T0 = 1_800_000_000_000;

// ---- nothing asserted before the first snapshot ----
{
  const f = H.createFeed();
  const v = H.view(f, who, T0);
  A.eq(v.summary.text, '…', 'no snapshot yet and nothing seen: the deck claims neither IDLE nor WORKING');
  A.eq(v.live.length, 0, 'no rows invented');
}

// ---- a run the page watched: start → tool → tool result → tokens → end ----
{
  const f = H.createFeed();
  H.onRunStart(f, { agentId: 'agent', runId: 'r1', trigger: 'directive', model: 'm' }, T0);
  let v = H.view(f, who, T0 + 1000);
  A.eq(v.summary, { text: '1 WORKING', tone: 'live' }, 'a watched run.start counts as working');
  A.eq([v.live[0].name, v.live[0].step, v.live[0].elapsed], ['NOVA', 'RUNNING', '1s'], 'row names the agent, the honest step, the clock');
  H.onToolCall(f, { agentId: 'agent', runId: 'r1', callId: 'c1', name: 'mcp__github__create_issue' }, T0 + 2000);
  A.eq(H.view(f, who, T0 + 2000).live[0].step, 'GITHUB::CREATE.ISSUE', 'tool in flight is named (CAM-HUD spelling)');
  A.eq(H.onToolResult(f, { agentId: 'agent', runId: 'r1', callId: 'other' }, T0 + 2100), false, 'another call\'s result does not clear this tool');
  A.eq(H.onToolResult(f, { agentId: 'agent', runId: 'r1', callId: 'c1' }, T0 + 2200), true, 'its own result clears it');
  A.eq(H.view(f, who, T0 + 2200).live[0].step, 'RUNNING', 'back with the model: the row stops naming a finished tool');
  A.eq(H.onToken(f, { agentId: 'agent', runId: 'r1', delta: 'Hel' }, T0 + 2300), true, 'first token flips the row');
  A.eq(H.onToken(f, { agentId: 'agent', runId: 'r1', delta: 'lo' }, T0 + 2400), false, 'later tokens change nothing (no re-render per delta)');
  A.eq(H.view(f, who, T0 + 2400).live[0].step, 'WRITING REPLY', 'streaming text is a provable step');
  H.onRunEnd(f, { agentId: 'agent', runId: 'r1', reason: 'done', turns: 2, usd: 0 }, T0 + 3000);
  v = H.view(f, who, T0 + 4000);
  A.eq(v.live.length, 0, 'run.end removes the live row');
  A.eq([v.recent[0].name, v.recent[0].text, v.recent[0].ago], ['NOVA', 'DONE', 'just now'], 'the finish is shown as recent');
  A.eq(H.view(f, who, T0 + 16 * 60 * 1000).recent.length, 0, 'a finish older than the recent window leaves');
}

// ---- the snapshot is the authority ----
{
  const f = H.createFeed();
  // a run the page never saw start (a routine, a channel message, a run from before the HUD opened)
  A.ok(H.applySnapshot(f, { ts: T0, runs: [{ runId: 'cron1', agentId: 'researcher', startedAt: T0 - 65_000, source: 'cron' }], prompts: [], queues: [{ agentId: 'researcher', depth: 2 }] }, T0), 'snapshot applies');
  let v = H.view(f, who, T0);
  A.eq([v.live[0].name, v.live[0].elapsed, v.live[0].queued], ['ORION', '1m 05s', 2], 'unseen server run appears with the server\'s start clock and queue depth');
  // a permission prompt pending on it
  H.applySnapshot(f, { runs: [{ runId: 'cron1', agentId: 'researcher', startedAt: T0 - 65_000 }], prompts: [{ runId: 'cron1', agentId: 'researcher', promptId: 'p' }], queues: [] }, T0 + 4000);
  v = H.view(f, who, T0 + 4000);
  A.eq([v.summary.text, v.live[0].step, v.live[0].waiting], ['1 NEEDS YOU', 'NEEDS YOUR OK', true], 'a pending prompt is the headline');
  // a lost run.end: the snapshot stops listing the run → it is gone
  H.applySnapshot(f, { runs: [], prompts: [], queues: [] }, T0 + 8000);
  v = H.view(f, who, T0 + 8000);
  A.eq([v.live.length, v.summary.text], [0, 'STATION IDLE'], 'a confirmed run the snapshot drops is not kept alive by a stale event');
  // an event-only run survives a short grace (snapshot older than its run.start), then must be confirmed
  H.onRunStart(f, { agentId: 'agent', runId: 'fresh', trigger: 'directive', model: 'm' }, T0 + 9000);
  H.applySnapshot(f, { runs: [], prompts: [], queues: [] }, T0 + 10_000);
  A.eq(H.view(f, who, T0 + 10_000).live.length, 1, 'a just-started run is not dropped by a snapshot that predates it');
  H.applySnapshot(f, { runs: [], prompts: [], queues: [] }, T0 + 20_000);
  A.eq(H.view(f, who, T0 + 20_000).live.length, 0, 'an event-only run the snapshot never confirms expires');
  // failures are shown as what they are
  A.eq(H.applySnapshot(f, null, T0), false, 'a non-snapshot is refused');
  H.snapshotFailed(f);
  A.eq(H.view(f, who, T0 + 21_000).summary, { text: 'NO LINK', tone: 'bad' }, 'a failing snapshot poll reads NO LINK, never IDLE');
}

// ---- recent rows: one per run, the asks stand out, unknown agents degrade honestly ----
{
  const f = H.createFeed();
  H.onRunStart(f, { agentId: 'agent', runId: 'e1', trigger: 'schedule', model: 'm' }, T0);
  A.eq(H.view(f, who, T0).live[0].trigger, 'ROUTINE', 'a scheduled run is labelled a routine');
  H.onRunError(f, { agentId: 'agent', runId: 'e1', message: 'boom', transient: false }, T0 + 10);
  H.onRunEnd(f, { agentId: 'agent', runId: 'e1', reason: 'error', turns: 1, usd: 0 }, T0 + 20);
  let v = H.view(f, who, T0 + 30);
  A.eq(v.recent.length, 1, 'run.error then run.end{error} for one run is ONE recent row');
  A.eq([v.recent[0].text, v.recent[0].tone], ['FAULT', 'bad'], 'a fault reads as one');
  H.onRunEnd(f, { agentId: 'researcher', runId: 'q1', reason: 'clarifying', turns: 1, usd: 0 }, T0 + 40);
  v = H.view(f, who, T0 + 50);
  A.eq([v.recent[0].name, v.recent[0].text, v.recent[0].tone], ['ORION', 'ASKED YOU', 'ask'], 'an agent that ended by asking a question is flagged for the Commander');
  H.onRunStart(f, { agentId: 'ghost-agent-9', runId: 'g1', trigger: 'directive', model: 'm' }, T0);
  A.eq(H.view(f, who, T0).live[0].name, 'GHOST-AGEN', 'an agent missing from the roster shows its id, not a made-up name');
  for (let i = 0; i < 9; i++) H.onRunStart(f, { agentId: 'agent', runId: 'm' + i, trigger: 'directive', model: 'm' }, T0 + i);
  v = H.view(f, who, T0 + 100);
  A.eq([v.live.length, v.more], [5, 5], 'live rows cap at five and fold the rest into +N MORE');
  A.ok(f.recent.length <= 3, 'recent list is bounded');
}

// ---- small formatters + prefs ----
A.eq(H.toolLabel('web_search'), 'WEB.SEARCH', 'tool label');
A.eq(H.toolLabel(''), '', 'no tool, no label');
A.eq([H.fmtElapsed(59_000), H.fmtElapsed(61_000), H.fmtElapsed(3_723_000)], ['59s', '1m 01s', '1h 02m'], 'elapsed clock');
A.eq([H.fmtAgo(10_000), H.fmtAgo(5 * 60_000), H.fmtAgo(2 * 3_600_000)], ['just now', '5m ago', '2h ago'], 'ago words');
{
  const mem = new Map();
  const store = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  A.eq(H.readPrefs(store), { pinned: true, rect: null }, 'defaults: pinned, no remembered rect');
  H.writePrefs(store, { pinned: false, rect: { x: 10, y: 20, w: 400, h: 640 } });
  A.eq(H.readPrefs(store), { pinned: false, rect: { x: 10, y: 20, w: 400, h: 640 } }, 'prefs round-trip');
  mem.set('starnet.hud', '{not json');
  A.eq(H.readPrefs(store), { pinned: true, rect: null }, 'corrupt prefs read as defaults');
  A.eq(H.readPrefs({ getItem() { throw new Error('blocked'); } }), { pinned: true, rect: null }, 'blocked storage reads as defaults');
}

// ---- page wiring ----
{
  const html = read('frontend/index.html');
  A.ok(/<button id="comms-hud" type="button" hidden[^>]*>HUD<\/button><button id="comms-expand"/.test(html), 'COMMS header carries the HUD button (hidden until hudmode.js wires it)');
  A.ok(html.indexOf('<link rel="stylesheet" href="css/hudmode.css">') > html.indexOf('css/comms-layout.css'), 'hudmode.css loads after comms-layout.css');
  A.ok(html.indexOf('<script src="app/hudmode.js"></script>') > html.indexOf('<script src="app/chatresize.js"></script>'), 'hudmode.js loads after chatresize.js');
  const css = read('frontend/css/hudmode.css');
  const hide = /html body\.hud-mode #screen-game\.active > :is\(([^)]*)\) \{ display: none !important; \}/.exec(css);
  A.ok(!!hide, 'HUD hides an explicit list of station regions');
  const hidden = hide ? hide[1].split(',').map(s => s.trim()) : [];
  for (const id of ['#topbar', '#left', '#stage-wrap', '#bottombar']) A.ok(hidden.includes(id), 'HUD hides ' + id);
  A.ok(!hidden.includes('#terms') && !hidden.includes('#chat-panel'), 'station windows (#terms) and COMMS stay reachable in the HUD');
  A.ok(/html body\.hud-mode\.sn-chrome #sn-titlebar \{ display: none !important; \}/.test(css), 'the MAXIMIZE titlebar is not offered on a corner panel');
  const glass = read('frontend/app/glass-demo.js');
  A.ok(/const shown = r => \(r && r\.width > 0 && r\.height > 0 \? r : null\);/.test(glass) && /shown\(rect\(document\.querySelector\('#bottombar'\)\)\)/.test(glass),
    'docked sheets ignore a hidden bar instead of seating at a negative top');
  const js = read('frontend/app/hudmode.js');
  A.ok(/World\.stop\(\)/.test(js) && /World\.start\(\)/.test(js), 'the world renderer stops in the HUD and resumes on exit');
  A.ok(/fetch\('\/api\/state\/snapshot'/.test(js), 'the deck polls the authoritative run snapshot');
}

// ---- desktop wiring ----
{
  const main = read('src-tauri/src/main.rs');
  const hud = read('src-tauri/src/hud_mode.rs');
  A.ok(/\nmod hud_mode;\n/.test(main), 'hud_mode module is declared');
  A.ok(/app\.manage\(hud_mode::HudState::default\(\)\);/.test(main), 'HUD state is managed');
  A.ok(/starnet_set_close_to_tray,\s*hud_mode::starnet_hud_status,\s*hud_mode::starnet_hud_set,\s*hud_mode::starnet_hud_pin,\s*hud_mode::starnet_hud_fold\s*\]\)/.test(main),
    'HUD commands are registered after the lifecycle commands');
  A.ok(/MenuItem::with_id\(app, "lifecycle_hud", "HUD Mode", true, None::<&str>\)\?;/.test(main), 'tray offers HUD Mode');
  A.ok(/Menu::with_items\(app, &\[&open_item, &hud_item, &status_item, &sep, &pause_item, &quit_item\]\)/.test(main), 'HUD Mode sits under Open StarNet');
  A.ok(/"lifecycle_open" => \{\s*hud_mode::request\(app, false\);\s*show_main_window\(app\);\s*\}/.test(main), 'Open StarNet hands a HUD back to the full station');
  A.ok(/"lifecycle_hud" => \{\s*show_main_window\(app\);\s*hud_mode::request\(app, true\);\s*\}/.test(main), 'HUD Mode reveals the window and asks the page to fold');
  A.eq((main.match(/WebviewWindowBuilder::new\(/g) || []).length, 1, 'still exactly one window builder: the HUD is the main window, not a second one');
  A.ok(/\.min_inner_size\(960\.0, 600\.0\)/.test(main) && /const MAIN_MIN_W: f64 = 960\.0;/.test(hud) && /const MAIN_MIN_H: f64 = 600\.0;/.test(hud),
    'leaving the HUD restores the main window\'s real minimum size');
  A.ok(/pub\(crate\) const HUD_EVENT: &str = "starnet-hud";/.test(hud) && /const TAURI_EVENT = 'starnet-hud';/.test(read('frontend/app/hudmode.js')),
    'tray event name matches on both sides');
  A.ok(/win\.set_always_on_top\(false\);\s*let _ = win\.set_min_size\(Some\(LogicalSize::new\(MAIN_MIN_W, MAIN_MIN_H\)\)\);/.test(hud), 'exit unpins before restoring the station floor');
  const fsCmd = main.slice(main.indexOf('fn starnet_toggle_fullscreen('), main.indexOf('fn starnet_toggle_fullscreen(') + 500);
  A.ok(/^fn starnet_toggle_fullscreen\(app: AppHandle\) -> Result<bool, String> \{[\s\S]*?if hud_mode::is_active\(&app\) \{\s*return Ok\(false\);\s*\}\s*let win = app/.test(fsCmd),
    'F11 cannot blow the pinned HUD up to fullscreen (checked before the window is touched)');
  const caps = JSON.parse(read('src-tauri/capabilities/default.json'));
  A.ok(!caps.permissions.some(p => /always-on-top|set-size|set-position/.test(String(p))), 'the renderer gets no new raw window powers; the shell owns HUD geometry');
}

A.report();
