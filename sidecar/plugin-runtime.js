/* sidecar/plugin-runtime.js — the station side of plugin processes (plugin extensions phase 2, 2026-09-29).

   Each approved plugin with code runs in its own child process (sidecar/plugin-worker.js). This module starts it,
   speaks its IPC, answers its requests (its private store), and keeps the station alive when it misbehaves:
     · every call has a deadline — a hung plugin costs its caller a timeout, never a stuck run;
     · a crash rejects everything in flight, marks the plugin crashed, and the NEXT use restarts it — at most
       MAX_RESTARTS times per RESTART_WINDOW_MS, after which it stays down until it is reloaded (re-approve, restart);
     · stop() and a revoke end the process; nothing outlives its approval.

   makePluginRuntime({ fork, workerPath, store, now?, onLog?, timeouts? }) -> {
     start(plugin) -> { ok, subs, tools, handlers, jobs } | { ok:false, error }
     hook(id, event, payload, timeoutMs?) -> result | null
     callTool(id, name, args, ctx) -> value           (throws on refusal/timeout/crash)
     callHandler(id, name, args) -> value             (throws likewise)
     stop(id), stopAll(), status(id), tools(id), list() } */
'use strict';
const { note } = require('./failopen.js');   // a failed IPC/kill is noted, never silently dropped

const DEFAULTS = { startMs: 8000, hookMs: 5000, toolMs: 120000, callMs: 30000 };
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 5 * 60 * 1000;

function makePluginRuntime(deps) {
  const fork = deps.fork;
  const workerPath = deps.workerPath;
  if (typeof fork !== 'function' || !workerPath) throw new Error('plugin-runtime requires { fork, workerPath }');
  const store = deps.store || null;
  if (typeof deps.now !== 'function') throw new Error('plugin-runtime requires an injected clock { now }');
  const now = deps.now;
  const onLog = typeof deps.onLog === 'function' ? deps.onLog : () => {};
  const T = Object.assign({}, DEFAULTS, deps.timeouts || {});
  const procs = new Map();   // id -> record

  function rejectAll(rec, why) {
    for (const [, p] of rec.pending) { clearTimeout(p.timer); p.reject(new Error(why)); }
    rec.pending.clear();
  }

  function spawnRecord(plugin) {
    const rec = procs.get(plugin.id) || { id: plugin.id, plugin, restarts: [], seq: 0 };
    rec.plugin = plugin;
    rec.pending = new Map();
    rec.state = 'starting';
    rec.error = '';
    rec.ready = null;
    let child;
    try {
      child = fork(workerPath, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true, cwd: plugin.dir });
    } catch (e) {
      rec.state = 'crashed'; rec.error = 'could not start its process: ' + ((e && e.message) || e);
      procs.set(plugin.id, rec);
      return rec;
    }
    rec.child = child;
    const pipeLog = (stream) => { if (stream && stream.on) stream.on('data', (d) => onLog(plugin.id, String(d).trimEnd())); };
    pipeLog(child.stdout); pipeLog(child.stderr);
    child.on('message', (m) => onMessage(rec, m));
    child.on('exit', (code, signal) => {
      if (rec.child !== child) return;
      const planned = rec.state === 'stopping' || rec.state === 'stopped';
      rec.state = planned ? 'stopped' : 'crashed';
      if (!planned) rec.error = 'its process exited (' + (signal || ('code ' + code)) + ')';
      rejectAll(rec, planned ? 'the plugin was stopped' : 'the plugin crashed: ' + rec.error);
      if (rec.readyResolve) { rec.readyResolve({ ok: false, error: rec.error || 'the plugin stopped' }); rec.readyResolve = null; }
      rec.child = null;
    });
    child.on('error', (e) => { onLog(plugin.id, '[process] ' + ((e && e.message) || e)); });
    procs.set(plugin.id, rec);
    rec.ready = new Promise((resolve) => {
      rec.readyResolve = resolve;
      const timer = setTimeout(() => {
        if (!rec.readyResolve) return;
        rec.readyResolve = null;
        rec.state = 'crashed'; rec.error = 'register() did not finish within ' + Math.round(T.startMs / 1000) + ' s';
        try { child.kill(); } catch (e) { note('plugins.runtime.kill-hung-start', e); }
        resolve({ ok: false, error: rec.error });
      }, T.startMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    });
    try { child.send({ t: 'init', id: plugin.id, name: plugin.name, main: plugin.main }); } catch (e) { note('plugins.runtime.init-send', e); }
    return rec;
  }

  async function answerRequest(rec, m) {
    const reply = (ok, v, err) => { try { rec.child && rec.child.send({ t: 'ans', id: m.id, ok, v, err }); } catch (e) { note('plugins.runtime.answer-send', e); } };
    if (m.op === 'store') {
      if (!store) return reply(false, null, 'this station has no plugin store');
      const a = m.args || {};
      try {
        const r = await store.op(rec.id, String(a.op || ''), a.key, a.value);
        return r.ok ? reply(true, r.value === undefined ? null : r.value) : reply(false, null, r.error);
      } catch (e) { return reply(false, null, (e && e.message) || String(e)); }
    }
    return reply(false, null, 'unknown request: ' + m.op);
  }

  function onMessage(rec, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'log') { onLog(rec.id, String(m.line || '')); return; }
    if (m.t === 'ready') {
      if (!rec.readyResolve) return;
      const resolve = rec.readyResolve; rec.readyResolve = null;
      if (!m.ok) {
        rec.state = 'crashed'; rec.error = String(m.error || 'failed to start');
        try { rec.child && rec.child.kill(); } catch (e) { note('plugins.runtime.kill-failed-start', e); }
        return resolve({ ok: false, error: rec.error });
      }
      rec.state = 'running';
      rec.surface = {
        subs: Array.isArray(m.subs) ? m.subs.map(String) : [],
        tools: Array.isArray(m.tools) ? m.tools : [],
        handlers: Array.isArray(m.handlers) ? m.handlers.map(String) : [],
        jobs: Number(m.jobs) || 0
      };
      return resolve(Object.assign({ ok: true }, rec.surface));
    }
    if (m.t === 'req') return void answerRequest(rec, m);
    if (m.t === 'res') {
      const p = rec.pending.get(m.id); if (!p) return;
      rec.pending.delete(m.id); clearTimeout(p.timer);
      return m.ok ? p.resolve(m.v) : p.reject(new Error(String(m.err || 'the plugin refused')));
    }
  }

  async function start(plugin) {
    const old = procs.get(plugin.id);
    if (old && old.child) stop(plugin.id);
    const rec = spawnRecord(plugin);
    if (!rec.ready) return { ok: false, error: rec.error };
    return rec.ready;
  }

  // Lazy restart after a crash, bounded: a plugin that keeps dying stays down instead of flapping forever.
  async function live(id) {
    const rec = procs.get(id);
    if (!rec) throw new Error('that plugin is not running');
    if (rec.state === 'running' && rec.child) return rec;
    if (rec.state === 'starting' && rec.ready) { await rec.ready; if (rec.state === 'running') return rec; }
    if (rec.state !== 'crashed') throw new Error('that plugin is ' + rec.state);
    const t = now();
    rec.restarts = rec.restarts.filter((x) => t - x < RESTART_WINDOW_MS);
    if (rec.restarts.length >= MAX_RESTARTS) throw new Error('the plugin crashed ' + MAX_RESTARTS + ' times in 5 minutes and is stopped: ' + rec.error);
    rec.restarts.push(t);
    onLog(id, '[runtime] restarting after: ' + rec.error);
    const r = await (spawnRecord(rec.plugin).ready);
    if (!r || !r.ok) throw new Error('the plugin could not restart: ' + ((r && r.error) || 'unknown'));
    return procs.get(id);
  }

  function send(rec, msg, ms, label) {
    return new Promise((resolve, reject) => {
      const id = ++rec.seq;
      const timer = setTimeout(() => {
        if (!rec.pending.has(id)) return;
        rec.pending.delete(id);
        reject(new Error(label + ' did not answer within ' + Math.round(ms / 1000) + ' s'));
      }, ms);
      if (timer && typeof timer.unref === 'function') timer.unref();
      rec.pending.set(id, { resolve, reject, timer });
      try { rec.child.send(Object.assign({ id }, msg)); }
      catch (e) { rec.pending.delete(id); clearTimeout(timer); reject(e); }
    });
  }

  async function hook(id, event, payload, timeoutMs) {
    let rec;
    try { rec = await live(id); } catch (e) { onLog(id, '[hook] ' + e.message); return null; }
    if (!rec.surface || rec.surface.subs.indexOf(event) < 0) return null;
    try { return await send(rec, { t: 'hook', event, payload }, Math.min(Number(timeoutMs) || T.hookMs, 30000), 'the plugin\'s ' + event + ' hook'); }
    catch (e) { onLog(id, '[hook] ' + e.message); return null; }   // a failing hook never blocks the run
  }
  async function callTool(id, name, args, ctx) {
    const rec = await live(id);
    return send(rec, { t: 'tool', name, args: args || {}, ctx: ctx || {} }, T.toolMs, 'the plugin tool ' + name);
  }
  async function callHandler(id, name, args) {
    const rec = await live(id);
    return send(rec, { t: 'call', name, args: args == null ? null : args }, T.callMs, 'the plugin handler "' + name + '"');
  }

  function stop(id) {
    const rec = procs.get(id);
    if (!rec) return false;
    rec.state = 'stopping';
    rejectAll(rec, 'the plugin was stopped');
    const child = rec.child;
    if (child) {
      try { child.send({ t: 'stop' }); } catch (e) { note('plugins.runtime.stop-send', e); }
      const killer = setTimeout(() => { try { child.kill(); } catch (e) { note('plugins.runtime.stop-kill', e); } }, 1500);
      if (killer && typeof killer.unref === 'function') killer.unref();
    }
    procs.delete(id);
    return true;
  }
  function stopAll() { for (const id of Array.from(procs.keys())) stop(id); }
  function status(id) {
    const rec = procs.get(id);
    return rec ? { state: rec.state, error: rec.error || '', restarts: rec.restarts.length } : { state: 'stopped', error: '', restarts: 0 };
  }
  // A crashed plugin keeps advertising its tools: the next call restarts it (bounded) or fails with the honest
  // reason. Only a stopped plugin (revoked, deleted, reloaded) has no tools.
  function tools(id) { const rec = procs.get(id); return (rec && (rec.state === 'running' || rec.state === 'crashed') && rec.surface) ? rec.surface.tools.slice() : []; }
  function list() { return Array.from(procs.keys()); }
  // the code digest a process was started from, and its registered surface — a reload reuses a live process only
  // when the approved code is byte-identical
  function digestOf(id) { const rec = procs.get(id); return rec && rec.plugin ? rec.plugin.digest || null : null; }
  function surface(id) {
    const rec = procs.get(id);
    return (rec && (rec.state === 'running' || rec.state === 'crashed') && rec.surface) ? Object.assign({ ok: true }, rec.surface) : null;
  }

  return { start, hook, callTool, callHandler, stop, stopAll, status, tools, list, digestOf, surface };
}

module.exports = { makePluginRuntime, MAX_RESTARTS, RESTART_WINDOW_MS };
