'use strict';
// Execute the production button, picker and @ menu with a small DOM and controlled HTTP responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../frontend/app/group-chat.js'), 'utf8');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.events = {}; this.value = ''; this.style = { setProperty() {} }; this.classList = { add() {}, toggle() {}, contains: () => false }; }
  get isConnected() { return this.attached || !!this.parentElement?.isConnected; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') this.id = v; if (k === 'data-agent-name') this.dataset.agentName = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  addEventListener(k, fn) { this.events[k] = fn; }
  append(...nodes) { for (const n of nodes) { const e = typeof n === 'string' ? Object.assign(new Element('#text'), { textContent: n }) : n; e.parentElement = this; this.children.push(e); } }
  replaceChildren(...nodes) { for (const e of this.children) e.parentElement = null; this.children = []; this.textContent = ''; this.append(...nodes); }
  before(node) { this.parentElement.append(node); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(e => e !== this); this.parentElement = null; }
}
const walk = e => [e, ...e.children.flatMap(walk)];
const text = e => (e.textContent || '') + e.children.map(text).join(' ');
const settle = async () => { for (let n = 0; n < 60; n++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const roster = [{ id: 'agent', name: 'Lead' }, { id: 'peer', name: 'Peer' }, { id: 'third', name: 'Third' }];
const ok = result => ({ status: 200, ok: true, json: async () => ({ ok: true, result }) });
const success = () => ok({ roster, groups: [] });
async function boot({ general = false } = {}) {
  const body = new Element('body'); body.attached = true;
  const head = new Element('head'); head.attached = true;
  for (const id of ['comms-idbar', 'chat-input', 'chat-log', 'chat-queued', 'chat-inputrow']) { const e = new Element('div'); e.id = id; body.append(e); }
  const find = id => walk(body).find(e => e.id === id);
  let request = async () => success(), push = async () => {}, onClose, opens = 0;
  const sent = [], opened = [], workstreams = new Map([['direct', { id: 'direct', agentId: 'agent', history: [{ role: 'user', content: 'hi' }], title: 'Direct' }]]);
  const document = { body, head, createElement: tag => new Element(tag), createTextNode: t => Object.assign(new Element('#text'), { textContent: t }), getElementById: find };
  const ctx = vm.createContext({ document, console, crypto: { randomUUID: () => 'test' }, clearTimeout() {}, setTimeout() {}, queueMicrotask, Chat: {},
    fetch: (url, init) => { const b = init && init.body ? JSON.parse(init.body) : null; sent.push({ url, body: b }); return request(url, b); },
    App: { pushRoster: () => push(), agents: () => roster, persist() {}, refreshRail() {}, openWorkstream: id => opened.push(id) },
    StationUI: { toggleTerm(key, title, build, opts) { opens++; const shell = new Element('div'); shell.id = 'test-window'; body.append(shell); build(shell); onClose = opts.onClose; }, closeTerm() { onClose?.(); find('test-window')?.remove(); }, notify() {} },
    Workstreams: { get: id => workstreams.get(id), adopt: o => { const w = { ...o }; workstreams.set(o.id, w); return w; }, generalId: () => general ? 'direct' : 'general-home' } });
  vm.runInContext(source + '\nglobalThis.GroupChat = GroupChat;\nGroupChat.bind({id:"direct",agentId:"agent",history:[{role:"user",content:"hi"}],title:"Direct"});', ctx);
  await settle();
  const button = label => walk(body).find(e => e.tagName === 'button' && (e.attrs['aria-label'] === label || text(e).trim() === label));
  return { find, ctx, sent, opened, workstreams,
    button,
    click: async label => { const b = button(label); assert.ok(b, 'button exists: ' + label); assert.ok(!('disabled' in b.attrs), 'button is enabled: ' + label); b.events.click(); await settle(); },
    type: async value => { const input = find('chat-input'); input.value = value; input.events.input(); await settle(); },
    key: async key => { const e = { key, shiftKey: false, isComposing: false, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} }; const handled = ctx.GroupChat.mentionKey(e); await settle(); return { handled, prevented: e.prevented }; },
    request(fn) { request = fn; }, push(fn) { push = fn; }, get opens() { return opens; } };
}
const group = (members, extra = {}) => ({ id: 'direct', title: 'Direct', members, leadId: 'agent', revision: 3, paused: false, messages: [], turns: [], artifacts: [], questions: [], ...extra });
(async () => {
  // ---- loading, failure and cancellation (unchanged contract) ----
  const app = await boot();
  const pending = deferred(); app.request(() => pending.promise);
  await app.click('+ Add agents');
  assert.ok(app.find('gc-picker')?.isConnected, 'picker is visible before the backend responds');
  assert.match(text(app.find('gc-picker')), /Loading agents/);
  await app.click('+ Add agents'); assert.equal(app.opens, 1, 'rapid clicks open only one picker');
  pending.resolve({ status: 404, ok: false, json: async () => { throw new SyntaxError('not found'); } }); await settle();
  assert.match(text(app.find('gc-picker')), /Group chat is unavailable on this server/);
  assert.ok(walk(app.find('gc-picker')).some(e => e.attrs.role === 'alert'), 'failure is announced inside the visible picker');
  app.request(async () => success()); await app.click('RETRY');
  assert.match(text(app.find('gc-picker')), /Add to this chat/);
  await app.click('DONE'); assert.equal(app.find('gc-picker'), undefined);
  for (const status of [401, 403, 500]) {
    app.request(async () => ({ status, ok: false, json: async () => { throw new SyntaxError('invalid JSON'); } }));
    await app.click('+ Add agents');
    assert.match(text(app.find('gc-picker')), status === 500 ? /server could not load group chat/ : /Reconnect to this station/);
    await app.click('CANCEL');
  }
  app.push(async () => { throw new Error('Roster sync failed'); });
  await app.click('+ Add agents'); assert.match(text(app.find('gc-picker')), /Roster sync failed/); await app.click('CANCEL');
  app.push(async () => {});
  const late = deferred(); app.request(() => late.promise);
  await app.click('+ Add agents'); await app.click('CANCEL'); late.resolve(success()); await settle();
  assert.equal(app.find('gc-picker'), undefined, 'late success cannot reopen a canceled picker');

  // ---- + ADD SAVES AT ONCE: nothing is listed IN THIS CHAT until the backend confirmed it ----
  let members = ['agent'], rev = 3;
  const create = deferred();
  app.request((url, b) => {
    if (!b) return Promise.resolve(url.includes('?id=') ? ok(group(members, { revision: rev })) : success());
    if (b.op === 'create') return create.promise;
    if (b.op === 'invite') { members = [...members, b.agentId]; rev++; return Promise.resolve(ok(group(members, { revision: rev }))); }
    if (b.op === 'configure') { if (b.revision !== rev) return Promise.resolve({ status: 409, ok: false, json: async () => ({ ok: false, error: 'Session changed; refresh and try again' }) }); members = b.members; rev++; return Promise.resolve(ok(group(members, { revision: rev }))); }
    throw new Error('unexpected op ' + b.op);
  });
  await app.click('+ Add agents');
  assert.match(text(app.find('gc-picker')), /\+ ADD starts a group chat/, 'a direct chat says what + ADD will do');
  assert.ok(!app.button('START GROUP CHAT') && !app.button('SAVE'), 'there is no separate save step to miss');
  await app.click('Add Peer to this chat');
  const createReq = app.sent.filter(s => s.body && s.body.op === 'create').at(-1);
  assert.ok(createReq, '+ ADD posts the group to the backend immediately');
  assert.deepEqual([...createReq.body.members], ['agent', 'peer']);
  assert.equal(createReq.body.id, 'direct', 'a non-General chat converts in place');
  assert.equal(createReq.body.conversionKey, 'direct');
  assert.match(text(app.find('gc-picker')), /adding Peer/, 'the in-flight add says so');
  assert.ok(!app.button('Remove Peer from this chat'), 'Peer is NOT listed in this chat before the backend answered');
  members = ['agent', 'peer']; create.resolve(ok(group(members))); await settle();
  assert.ok(app.button('Remove Peer from this chat'), 'once saved, Peer is in this chat');
  assert.match(text(app.find('gc-picker')), /Peer joined · saved/);
  assert.equal(app.workstreams.get('direct').conversationMode, 'group', 'the session became a group');
  assert.deepEqual([...app.ctx.GroupChat.membersOf('direct')], ['agent', 'peer']);
  await app.click('Add Third to this chat');
  assert.equal(app.sent.filter(s => s.body && s.body.op === 'invite').at(-1).body.agentId, 'third', 'the next + ADD invites into the existing group');
  assert.match(text(app.find('gc-picker')), /Third joined · saved/);
  await app.click('Remove Peer from this chat');
  assert.deepEqual([...app.sent.filter(s => s.body && s.body.op === 'configure').at(-1).body.members], ['agent', 'third'], '✕ REMOVE saves at once');
  assert.match(text(app.find('gc-picker')), /Peer left · saved/);
  assert.ok(!app.button('Remove Lead from this chat'), 'the lead cannot be removed');
  await app.click('DONE');

  // ---- the General home stream is never converted: a fresh group opens beside it ----
  const home = await boot({ general: true });
  home.request((url, b) => {
    if (!b) return Promise.resolve(success());
    if (b.op === 'create') return Promise.resolve(ok({ ...group(b.members), id: b.id, title: b.title }));
    throw new Error('unexpected op ' + b.op);
  });
  await home.click('+ Add agents'); await home.click('Add Peer to this chat');
  const homeCreate = home.sent.find(s => s.body && s.body.op === 'create');
  assert.notEqual(homeCreate.body.id, 'direct', 'General keeps its id');
  assert.equal(homeCreate.body.conversionKey, undefined, 'General is not converted');
  assert.equal(homeCreate.body.history, undefined, 'General history is not copied into the group');
  assert.equal(homeCreate.body.title, 'Lead + Peer');
  assert.deepEqual(home.opened, [homeCreate.body.id], 'COMMS opens the new group');

  // ---- @ in a DIRECT chat: lists the crew, keyboard picks, picking starts the group ----
  const at = await boot();
  let atMembers = null;
  at.request((url, b) => {
    if (!b) return Promise.resolve(url.includes('?id=') && atMembers ? ok(group(atMembers)) : success());
    if (b.op === 'create') { atMembers = b.members; return Promise.resolve(ok(group(b.members))); }
    throw new Error('unexpected op ' + b.op);
  });
  await at.type('can you ask @pe');
  const rows = walk(at.find('gc-mentions')).filter(e => e.attrs.role === 'option');
  assert.equal(rows.length, 1, 'the @ menu lists matching crew in a direct chat');
  assert.match(text(rows[0]), /Peer/); assert.match(text(rows[0]), /starts a group with Lead/);
  assert.equal(rows[0].attrs['aria-selected'], 'true', 'the first match is highlighted');
  const enter = await at.key('Enter');
  assert.ok(enter.handled && enter.prevented, 'Enter picks from the open @ menu instead of sending');
  const atCreate = at.sent.find(s => s.body && s.body.op === 'create');
  assert.deepEqual([...atCreate.body.members], ['agent', 'peer'], 'picking someone new starts the group with them');
  assert.equal(at.find('chat-input').value, 'can you ask @Peer ', 'the handle is written into the message');
  assert.equal(at.find('gc-mentions').children.length, 0, 'the menu closes after a pick');
  assert.equal((await at.key('Enter')).handled, false, 'with the menu closed Enter is the composer\'s again');
  await at.type('@zz'); assert.equal(at.find('gc-mentions').children.length, 0, 'no match, no menu');
  await at.type('@');
  const inGroup = walk(at.find('gc-mentions')).filter(e => e.attrs.role === 'option').map(text).join(' | ');
  assert.match(inGroup, /@all.*everyone here/, 'in the group the menu offers @all');
  assert.match(inGroup, /Peer\s+in this chat/, 'members are marked as in this chat');
  assert.match(inGroup, /Third\s+adds to this chat/, 'the rest of the crew can be pulled in');
  assert.equal((await at.key('Escape')).handled, true); assert.equal(at.find('gc-mentions').children.length, 0, 'Esc closes the @ menu');
  await at.type('/help @pe'); assert.equal(at.find('gc-mentions').children.length, 0, 'a slash command never opens the @ menu');

  // ---- @handles typed out in a direct chat resolve exactly or not at all ----
  const T = (t, ws = { id: 'x', agentId: 'agent' }) => [...at.ctx.GroupChat.mentionTargets(t, ws)];
  assert.deepEqual(T('@peer take a look'), ['peer'], 'a stable id resolves');
  assert.deepEqual(T('hey @PEER and @third'), ['peer', 'third'], 'a name resolves case-insensitively');
  assert.deepEqual(T('@lead hi'), [], 'the agent you are already talking to is not pulled in');
  assert.deepEqual(T('mail me@peer.dev'), [], 'an email is not a mention');
  assert.deepEqual(T('`@peer` and\n> @third quoted'), [], 'code and quotes are not mentions');
  assert.deepEqual(T('@nobody hi'), [], 'an unknown handle is left alone');
  assert.deepEqual(T('@peer', { id: 'g', agentId: 'agent', conversationMode: 'group' }), [], 'a group resolves its own mentions on the backend');
  console.log('group-chat-picker: loading, failure, cancellation, + ADD/✕ REMOVE save at once, nothing claimed before the backend, General never converted, @ menu in a direct chat with keyboard pick, exact @handle resolution PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
