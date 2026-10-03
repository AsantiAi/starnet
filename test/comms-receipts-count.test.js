/* node test/comms-receipts-count.test.js — the COMMS "remembered · N" header counts what is STILL remembered (QA 2026-10-02).
   Forgetting a memory with its ✕ undoes the save on the station, but the header kept saying "remembered · 3" — COMMS
   asserted saves the backend had undone. Runs the real renderReceipts from frontend/app/chat.js on a minimal fake DOM. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'chat.js'), 'utf8');
const start = src.indexOf('  function renderReceipts(batch) {');
A.ok(start > 0, 'chat.js defines renderReceipts');
const end = src.indexOf('\n  }\n', start) + 4;
const fnSrc = src.slice(start, end);

function el(tag) {
  const e = { tagName: tag, children: [], hidden: false, disabled: false, textContent: '', className: '', attrs: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); } };
  return e;
}
const vetoed = [];
const ctx = {
  document: { createElement: el },
  KIND_TAG: { fact: 'FACT' },
  row: () => ({ d: el('div'), body: el('div') }),
  autoscroll: () => {},
  Harness: { memoryVeto: async (p) => { vetoed.push(p.id); return { ok: p.id !== 'stuck' }; } },
  StationUI: { notify() {} }
};
vm.createContext(ctx);
vm.runInContext(fnSrc + '\nthis.renderReceipts = renderReceipts;', ctx);

(async () => {
  let head = null;
  ctx.row = () => { head = { d: el('div'), body: el('div') }; return head; };
  ctx.renderReceipts({ agentId: 'nova', proposals: [{ id: 'a', kind: 'fact', content: 'likes tea' }, { id: 'b', kind: 'fact', content: 'lives in Ohio' }, { id: 'stuck', kind: 'fact', content: 'x' }] });
  const cap = head.body.children[0], list = head.body.children[1];
  A.eq(cap.textContent, 'remembered · 3', 'the header counts the three saves');
  const vetoOf = (i) => list.children[i].children.find(c => c.className === 'receipt-veto');
  await vetoOf(0).onclick();
  A.eq(cap.textContent, 'remembered · 2 (1 forgotten)', 'a forget leaves the count and says so');
  await vetoOf(1).onclick();
  A.eq(cap.textContent, 'remembered · 1 (2 forgotten)', 'and again');
  await vetoOf(2).onclick();
  A.eq(cap.textContent, 'remembered · 1 (2 forgotten)', 'a forget the station refused changes nothing');
  A.eq(vetoed, ['a', 'b', 'stuck'], 'each ✕ asked the station');
  A.report('comms-receipts-count');
})().catch(e => { console.log('FAIL: threw ' + (e && e.stack || e)); process.exit(1); });
