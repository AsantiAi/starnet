/* node test/prose-links-desktop.test.js — a link in a GROUP CHAT, a group's .md preview or a WORKFLOWS result opens the
   OS browser on desktop (QA 2026-10-02). Those surfaces render through Chat.renderProse (target=_blank links), but the
   desktop hand-off (open_external_url) lived on #chat-log only, so on the desktop app those links did nothing.
   Runs the real document-level handler from frontend/app/chat.js against a minimal fake DOM. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'chat.js'), 'utf8');
const start = src.indexOf("    if (typeof document !== 'undefined' && !document.__proseLinksWired) {");
A.ok(start > 0, 'chat.js wires one document-level handler for prose links outside COMMS');
// the block ends at the matching close of the if: the line "    }" right after the listener's "      });"
const end = src.indexOf('\n    }\n', src.indexOf('      });', start)) + 6;
const block = src.slice(start, end);

function harness({ tauri, selection }) {
  const handlers = [];
  const opened = [];
  const document = { addEventListener: (t, fn) => { if (t === 'click') handlers.push(fn); } };
  const window = { getSelection: () => (selection || ''), __TAURI__: tauri ? { core: { invoke: (cmd, a) => { opened.push([cmd, a.url]); return Promise.resolve(); } } } : undefined };
  const ctx = { document, window, StationUI: { notify() {} } };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  vm.runInContext(block, ctx);   // a re-init never stacks a second handler
  const click = (scope, href) => {
    const link = { getAttribute: (k) => (k === 'href' ? href : null), href };
    const target = { closest: (sel) => (scope && sel.split(',').map(s => s.trim().split(' ')[0]).indexOf(scope) >= 0 ? link : null) };
    const e = { target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    handlers.forEach(h => h(e));
    return e;
  };
  return { handlers, opened, click };
}

{
  const h = harness({ tauri: true });
  A.eq(h.handlers.length, 1, 'wired exactly once');
  for (const scope of ['#gc-log', '#gc-preview', '.wf-md']) {
    const e = click(h, scope, 'https://example.com/a');
    A.ok(e.defaultPrevented, scope + ': the dead in-window navigation is prevented');
  }
  A.eq(h.opened.length, 3, 'each link went to the OS browser');
  A.eq(h.opened[0], ['open_external_url', 'https://example.com/a'], 'through open_external_url with the real href');
  const other = click(h, null, 'https://example.com/b');
  A.ok(!other.defaultPrevented && h.opened.length === 3, 'a link anywhere else is left to its own handler');
  const js = click(h, '#gc-log', 'javascript:alert(1)');
  A.ok(!js.defaultPrevented && h.opened.length === 3, 'only http(s) links are handed to the OS');
}
{
  const h = harness({ tauri: false });
  const e = click(h, '#gc-log', 'https://example.com/a');
  A.ok(!e.defaultPrevented && h.opened.length === 0, 'in a plain browser target=_blank works as is');
}
{
  const h = harness({ tauri: true, selection: 'selected words' });
  const e = click(h, '#gc-log', 'https://example.com/a');
  A.ok(e.defaultPrevented && h.opened.length === 0, 'ending a text selection on a link never opens it');
}
function click(h, scope, href) { return h.click(scope, href); }

// QA 2026-10-02: a link in a STILL-STREAMING reply is clickable — a pointer down on the live paragraph holds its per-frame
// re-render until the click has been dispatched (the <a> used to be replaced between mousedown and mouseup)
{
  const sa = src.slice(src.indexOf('  function streamingAgent(whoName) {'), src.indexOf('    function closeSeg() {'));
  A.ok(sa.includes('requestAnimationFrame(() => { if (!renderQueued || held) return; flushProse(); autoscroll(); });'), 'the frame render skips while the reply is pressed');
  A.ok(sa.includes("seg.body.addEventListener('pointerdown', holdWhilePressed);"), 'a pointer down on the live paragraph holds it');
  A.ok(sa.includes("setTimeout(() => { held = false; if (renderQueued) { flushProse(); autoscroll(); } }, 0);") && sa.includes('safety = setTimeout(up, 4000);'),
    'released only after the click is dispatched, and never held for good');
}

A.report('prose-links-desktop');
