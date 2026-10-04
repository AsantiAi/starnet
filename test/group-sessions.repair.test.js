'use strict';
// Group chat repairs (10-04 sweep): multi-word @names, crew members who left, resuming a paused group, E-STOP on a bad
// store, turns with no worker, orphaned uploads, and the station-wide list the rail reads. Real module, fake deps.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeGroupSessions } = require('../sidecar/group-sessions.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'group-repair-'));
let sequence = 0, execute = null, crew;
const seen = [];
const deps = { fs, path, root, now: () => ++sequence, id: () => 'r' + (++sequence), log: () => {},
  roster: () => crew,
  execute: async o => { seen.push(o); o.emit('agent.run.start', { runId: o.runId }); return execute(o); },
  readFile: async () => ({ name: 'f.md', content: 'aGk=', bytes: 2, hash: 'h' }),
  decodeFile: f => ({ text: Buffer.from(f.content, 'base64').toString() }), uploadFile: (name, content) => ({ name, content, hash: 'h' + content.length }) };
const finish = content => ({ reason: 'done', messages: [{ role: 'assistant', content }] });
async function waitFor(fn) { for (let n = 0; n < 200; n++) { if (await fn()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('timed out'); }
(async () => {
  let api;
  try {
    crew = [{ id: 'agent', name: 'Lead' }, { id: 'researcher', name: 'RESEARCHER' }, { id: 'researcher-2', name: 'RESEARCHER 2' }, { id: 'engineer', name: 'SAM ALTMAN' }, { id: 'outside', name: 'Outsider' }];
    api = makeGroupSessions(deps); await api.ready;
    execute = async () => finish('ok');

    // ---- an @name is the LONGEST member name the text starts with; names may hold spaces ----
    const g = await api.create({ members: ['agent', 'researcher', 'researcher-2', 'engineer'] });
    await api.send(g.id, { key: 'r2', text: '@RESEARCHER 2 please review' }); await api.idle(g.id);
    assert.equal(seen.at(-1).t.agentId, 'researcher-2', '"@RESEARCHER 2" reaches RESEARCHER 2, never RESEARCHER');
    await api.send(g.id, { key: 'r1', text: '@researcher take this' }); await api.idle(g.id);
    assert.equal(seen.at(-1).t.agentId, 'researcher', 'a stable id still resolves');
    await api.send(g.id, { key: 'r1b', text: 'and @RESEARCHER, you too' }); await api.idle(g.id);
    assert.equal(seen.at(-1).t.agentId, 'researcher', 'a one-word name followed by punctuation resolves');
    await api.send(g.id, { key: 'sam', text: 'hey @sam altman, numbers?' }); await api.idle(g.id);
    assert.equal(seen.at(-1).t.agentId, 'engineer', 'a two-word name can be typed');
    await assert.rejects(api.send(g.id, { key: 'out', text: '@Outsider weigh in' }), /Outsider is not in this chat yet/, 'a crew agent outside the chat is named, not guessed');
    await assert.rejects(api.send(g.id, { key: 'typo', text: '@RESEARCHERX hi' }), /Unknown @RESEARCHERX[\s\S]*backticks/, 'an unknown handle says how to send it as text');
    await api.send(g.id, { key: 'code', text: 'install `@types/node` please' }); await api.idle(g.id);
    assert.equal(seen.at(-1).t.agentId, 'agent', 'a backticked @word is text and the lead answers');

    // ---- a member who LEFT the crew no longer breaks the group ----
    crew = crew.filter(a => a.id !== 'agent');   // the lead is gone from the roster (no dropAgent yet: the worst case)
    const before = seen.length;
    await api.send(g.id, { key: 'nolead', text: 'anyone there?' }); await api.idle(g.id);
    assert.equal(seen.length, before + 1, 'an unaddressed message still runs');
    assert.notEqual(seen.at(-1).t.agentId, 'agent', 'it goes to a member who is still on the crew');
    await api.send(g.id, { key: 'all', text: '@all status' }); await api.idle(g.id);
    assert.ok(!seen.slice(-3).some(o => o.t.agentId === 'agent'), '@all skips the member who left');
    const invited = await api.invite(g.id, { agentId: 'outside' });
    assert.ok(invited.members.includes('outside') && !invited.members.includes('agent'), 'invite works and the departed member quietly leaves');
    assert.notEqual(invited.leadId, 'agent', 'a departed lead hands over to someone who remains');
    const renamed = await api.configure(g.id, { revision: (await api.get(g.id)).revision, title: 'Renamed' });
    assert.equal(renamed.title, 'Renamed', 'a rename works with a departed member on record');
    await assert.rejects(api.invite(g.id, { agentId: 'ghost' }), /no longer in the roster/, 'only the agent being ADDED must be on the crew');
    crew.push({ id: 'agent', name: 'Lead' });

    // ---- dropAgent: deleting an agent from the crew removes it from every group, the lead hands over ----
    const d1 = await api.create({ members: ['researcher', 'engineer'], leadId: 'researcher' });
    const solo = await api.create({ members: ['researcher'] });
    await api.dropAgent('researcher');
    const d1after = await api.get(d1.id);
    assert.deepEqual(d1after.members, ['engineer']); assert.equal(d1after.leadId, 'engineer');
    assert.deepEqual((await api.get(solo.id)).members, ['researcher'], 'a group is never left with no one in it');

    // ---- a send to a PAUSED group: refused sends never lift the pause; a valid one stops the stale queue first ----
    crew = crew.filter(a => a.id !== 'researcher');
    const p = await api.create({ members: ['agent', 'engineer', 'outside'] });
    let release; execute = () => new Promise(r => { release = () => r(finish('done')); });
    await api.send(p.id, { key: 'go', text: '@all deploy' });
    await waitFor(async () => (await api.get(p.id)).turns.some(t => t.state === 'running'));
    await api.control(p.id, { action: 'pause' });
    release(); await api.idle(p.id);
    let ps = await api.get(p.id);
    assert.equal(ps.paused, true);
    assert.ok(ps.turns.some(t => t.state === 'queued'), 'pause keeps the queued work (E-STOP/PAUSE semantics)');
    await assert.rejects(api.send(p.id, { key: 'bad', text: '@nobody hi', resume: true }), /Unknown/);
    assert.equal((await api.get(p.id)).paused, true, 'a refused send leaves the group paused');
    execute = async () => finish('ok');
    const stale = (await api.get(p.id)).turns.filter(t => t.state === 'queued').map(t => t.id);
    const ran = seen.length;
    await api.send(p.id, { key: 'fresh', text: 'never mind, just say hi', resume: true }); await api.idle(p.id);
    ps = await api.get(p.id);
    assert.equal(ps.paused, false, 'a valid send carries the conversation on');
    for (const id of stale) { const t = ps.turns.find(x => x.id === id); assert.equal(t.state, 'stopped'); assert.equal(t.reason, 'Paused before it ran'); }
    assert.equal(seen.length, ran + 1, 'only the new message ran — the paused work was not replayed ahead of it');
    assert.match(seen.at(-1).ctx.messages[0].content, /just say hi/);

    // ---- a turn with no worker (a question that outlived a restart) stops outright when its agent is removed ----
    const q = await api.create({ members: ['agent', 'engineer'] });
    execute = async o => { await o.askCommander({ question: 'Which tone?', options: ['casual'] }); return finish('x'); };
    await api.send(q.id, { key: 'ask', text: '@engineer write it' });
    await waitFor(async () => ((await api.get(q.id)).questions || []).some(x => x.state === 'pending'));
    // restart: the question survives, the worker does not (the old instance's aborted worker settles first, as a real
    // process exit would never let it write after the new sidecar booted)
    const old = api; old.close(); await old.idle(q.id);
    api = makeGroupSessions(deps); await api.ready;
    const qs = await api.get(q.id);
    const asking = qs.turns.find(t => t.agentId === 'engineer');
    assert.equal(asking.state, 'waiting for answer');
    await api.configure(q.id, { revision: qs.revision, members: ['agent'] });
    assert.equal((await api.get(q.id)).turns.find(t => t.id === asking.id).state, 'stopped', 'never stuck in "stopping" with no worker to finish it');

    // ---- an upload whose send was refused is not shared with the agents ----
    execute = async () => finish('ok');
    const f = await api.create({ members: ['agent', 'engineer'] });
    const up = await api.attach(f.id, { key: 'k1', name: 'secret.pdf', content: 'c2VjcmV0' });
    const orphan = up.artifacts.find(a => a.attachmentKey === 'k1').id;
    await assert.rejects(api.send(f.id, { key: 'm', text: '@nobody see file', artifactIds: [orphan] }), /Unknown/);
    await api.send(f.id, { key: 'm2', text: 'plain message' }); await api.idle(f.id);
    assert.ok(!/secret\.pdf/.test(seen.at(-1).ctx.messages[0].content), 'an orphaned upload never reaches an agent\'s context');
    const read = seen.at(-1).tools.find(t => t.name === 'group.read');
    assert.ok(read, 'group.read is offered');
    await api.send(f.id, { key: 'm3', text: '@engineer here it is', artifactIds: [orphan] }); await api.idle(f.id);
    assert.match(seen.at(-1).ctx.messages[0].content, /secret\.pdf/, 'once a message carries it, it is shared');

    // ---- the station-wide list says what is waiting on the Commander ----
    const listed = (await api.list()).groups.find(x => x.id === q.id);
    for (const k of ['updatedAt', 'approvals', 'questions', 'busy', 'paused']) assert.ok(k in listed, 'list carries ' + k);

    // ---- E-STOP never throws synchronously, even on a corrupt store ----
    fs.writeFileSync(path.join(root, 'group-sessions.json'), '{not json');
    try { fs.rmSync(path.join(root, 'group-sessions.json.bak'), { force: true }); } catch (_) {}
    const broken = makeGroupSessions(deps);
    await broken.ready.catch(() => {});
    let threw = false, result;
    try { result = broken.halt(); } catch (_) { threw = true; }
    assert.equal(threw, false, 'halt() never throws synchronously (it used to crash handleHalt before killAll)');
    assert.ok(result && typeof result.then === 'function', 'halt() returns a promise the caller can catch');
    await result.catch(() => {});
    broken.close();
    console.log('group-sessions.repair: multi-word @names, departed members + dropAgent, resume-on-send, no-worker stop, orphaned uploads, list attention, E-STOP on a corrupt store PASS');
  } finally { api?.close(); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
