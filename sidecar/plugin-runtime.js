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
  const rawLog = typeof deps.onLog === 'function' ? deps.onLog : () => {};
  const T = Object.assign({}, DEFAULTS, deps.timeouts || {});
  const procs = new Map();   // id -> record
  /* E-STOP PAUSES JOBS, NOT GUARDS (sweep 2026-10-02). Killing plugin processes on E-STOP also switched off every
     plugin's pre_tool_call veto (a hook to a dead process answers null = allow) until RESUME, and a boot or an
     extension reload while halted respawned them with their background jobs running. Halted, a process keeps
     answering hooks/tools/window calls but runs no api.every job; new processes start paused too. */
  let jobsPaused = deps.jobsPaused === true;
  function setJobsPaused(paused) {
    jobsPaused = paused === true;
    for (const rec of procs.values()) {
      if (rec.child && rec.state === 'running') { try { rec.child.send({ t: 'jobs', paused: jobsPaused }); } catch (e) { note('plugins.runtime.jobs-send', e); } }
    }
    return jobsPaused;
  }
  // The process's working directory is NEUTRAL (never the plugin's own folder): on Windows a folder that is some
  // process's cwd cannot be deleted (EBUSY), which broke DELETE and a replacing plugin.submit while it ran.
  const workerCwd = deps.cwd || undefined;
  /* verify(id, digest) -> bool: does the approval still cover exactly the code this process was started from?
     Asked before every tool/window call, before any restart, and on a timer for plugins with background jobs — an
     edit must never keep running (or be restarted from disk) without the Commander approving it again. */
  const verify = typeof deps.verify === 'function' ? deps.verify : null;
  // LOG BUDGET: a plugin printing in a loop must not flood the station log. 120 lines a minute, then one notice.
  const LOG_PER_MIN = 120;
  const logBudget = new Map();   // id -> { windowAt, n, muted }
  function onLog(id, line) {
    const t = now(); let b = logBudget.get(id);
    if (!b || t - b.windowAt >= 60000 || t < b.windowAt) { b = { windowAt: t, n: 0, muted: false }; logBudget.set(id, b); }
    b.n++;
    if (b.n <= LOG_PER_MIN) return rawLog(id, line);
    if (!b.muted) { b.muted = true; rawLog(id, '[runtime] more than ' + LOG_PER_MIN + ' log lines this minute — the rest are dropped'); }
  }

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
      child = fork(workerPath, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true, cwd: workerCwd });
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
      if (rec.exited) { const done = rec.exited; rec.exited = null; done(); }
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
    rec.initPaused = jobsPaused;
    try { child.send({ t: 'init', id: plugin.id, name: plugin.name, main: plugin.main, jobsPaused }); } catch (e) { note('plugins.runtime.init-send', e); }
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
      // E-STOP pressed while this process was starting: setJobsPaused only reaches RUNNING processes, and init carried
      // the old value — say it now, or its api.every jobs fire until RESUME (QA 2026-10-02)
      if (rec.initPaused !== jobsPaused) { try { rec.child && rec.child.send({ t: 'jobs', paused: jobsPaused }); } catch (e) { note('plugins.runtime.jobs-ready-send', e); } }
      rec.surface = {
        subs: Array.isArray(m.subs) ? m.subs.map(String) : [],
        hookTimeouts: (m.hookTimeouts && typeof m.hookTimeouts === 'object') ? m.hookTimeouts : {},
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
    /* SINGLE-FLIGHT RESTART. The crashed check and the respawn are split by `await verify`, so two callers
       arriving together (two runs' pre_tool_call hooks, a hook + a window call) both respawned: the second
       child overwrote rec.child, the first was orphaned — stop/revoke/delete never killed it and its jobs ran
       doubled until the sidecar exited — the first caller's ready promise never settled, and the restart
       budget burned twice as fast. One restart at a time; everyone else waits on it. */
    if (!rec.restarting) {
      rec.restarting = (async () => {
        // never restart code from disk that the Commander has not approved as it is NOW
        if (verify && !(await verify(id, rec.plugin.digest))) {
          stop(id);
          throw new Error('the plugin changed since it was approved — approve it again in ABILITIES → EXTENSIONS');
        }
        if (procs.get(id) === rec && rec.state === 'running' && rec.child) return rec;   // started again while we verified
        if (procs.get(id) !== rec || rec.state !== 'crashed') throw new Error('that plugin is ' + rec.state);
        const t = now();
        rec.restarts = rec.restarts.filter((x) => t - x < RESTART_WINDOW_MS);
        if (rec.restarts.length >= MAX_RESTARTS) throw new Error('the plugin crashed ' + MAX_RESTARTS + ' times in 5 minutes and is stopped: ' + rec.error);
        rec.restarts.push(t);
        onLog(id, '[runtime] restarting after: ' + rec.error);
        const r = await (spawnRecord(rec.plugin).ready);
        if (!r || !r.ok) throw new Error('the plugin could not restart: ' + ((r && r.error) || 'unknown'));
        return procs.get(id);
      })().finally(() => { rec.restarting = null; });
    }
    return rec.restarting;
  }

  /* signal (optional): the RUN's abort signal. A STOP / E-STOP used to wait out a plugin tool to its end (up to the tool
     timeout) because nothing reached the process (QA 2026-10-02): now the call settles at once as stopped and the
     process gets { t:'cancel', ref } — the tool's ctx.signal aborts, so a tool that honours it stops its work too. */
  function send(rec, msg, ms, label, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(new Error('stopped'));
      const id = ++rec.seq;
      let onAbort = null;
      const done = () => { if (onAbort && signal) { try { signal.removeEventListener('abort', onAbort); } catch (_) {} } };
      const timer = setTimeout(() => {
        if (!rec.pending.has(id)) return;
        rec.pending.delete(id); done();
        reject(new Error(label + ' did not answer within ' + Math.round(ms / 1000) + ' s'));
      }, ms);
      if (timer && typeof timer.unref === 'function') timer.unref();
      rec.pending.set(id, { resolve: (v) => { done(); resolve(v); }, reject: (e) => { done(); reject(e); }, timer });
      if (signal) {
        onAbort = () => {
          if (!rec.pending.has(id)) return;
          rec.pending.delete(id); clearTimeout(timer);
          try { rec.child && rec.child.send({ t: 'cancel', ref: id }); } catch (e) { note('plugins.runtime.cancel-send', e); }
          reject(new Error('stopped'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
      try { rec.child.send(Object.assign({ id }, msg)); }
      catch (e) { rec.pending.delete(id); clearTimeout(timer); done(); reject(e); }
    });
  }

  async function hook(id, event, payload, timeoutMs) {
    let rec;
    try { rec = await live(id); } catch (e) { onLog(id, '[hook] ' + e.message); return null; }
    if (!rec.surface || rec.surface.subs.indexOf(event) < 0) return null;
    try { return await send(rec, { t: 'hook', event, payload }, Math.min(Number(timeoutMs) || T.hookMs, 30000), 'the plugin\'s ' + event + ' hook'); }
    catch (e) { onLog(id, '[hook] ' + e.message); return null; }   // a failing hook never blocks the run
  }
  async function checked(id) {
    const rec = await live(id);
    if (verify && !(await verify(id, rec.plugin.digest))) {
      stop(id);
      throw new Error('the plugin changed since it was approved — approve it again in ABILITIES → EXTENSIONS');
    }
    return rec;
  }
  async function callTool(id, name, args, ctx, signal) {
    const rec = await checked(id);
    return send(rec, { t: 'tool', name, args: args || {}, ctx: ctx || {} }, T.toolMs, 'the plugin tool ' + name, signal);
  }
  async function callHandler(id, name, args) {
    const rec = await checked(id);
    return send(rec, { t: 'call', name, args: args == null ? null : args }, T.callMs, 'the plugin handler "' + name + '"');
  }

  /* stop(id) -> Promise<bool>, settled once the process has really exited (or been killed): a caller about to
     delete or replace the plugin's folder awaits it. */
  function stop(id) {
    const rec = procs.get(id);
    if (!rec) return Promise.resolve(false);
    rec.state = 'stopping';
    rejectAll(rec, 'the plugin was stopped');
    const child = rec.child;
    const exited = child ? new Promise((r) => { rec.exited = r; }) : Promise.resolve();
    const deadline = new Promise((r) => { const t = setTimeout(r, 3000); if (t && typeof t.unref === 'function') t.unref(); });
    if (child) {
      try { child.send({ t: 'stop' }); } catch (e) { note('plugins.runtime.stop-send', e); }
      const killer = setTimeout(() => { try { child.kill(); } catch (e) { note('plugins.runtime.stop-kill', e); } }, 1500);
      if (killer && typeof killer.unref === 'function') killer.unref();
    }
    procs.delete(id);
    return Promise.race([exited, deadline]).then(() => true);
  }
  function stopAll() { return Promise.all(Array.from(procs.keys()).map((id) => stop(id))); }

  // Plugins with background jobs are re-verified on a timer: nothing else would ever notice an edit to them.
  let jobCheck = null;
  if (verify) {
    jobCheck = setInterval(() => {
      for (const [id, rec] of procs) {
        if (rec.state !== 'running' || !rec.surface || !rec.surface.jobs) continue;
        Promise.resolve(verify(id, rec.plugin.digest)).then((ok) => {
          if (!ok && procs.get(id) === rec) { onLog(id, '[runtime] its files changed since approval — stopped until approved again'); stop(id); }
        }, (e) => note('plugins.runtime.job-verify', e));
      }
    }, 10000);
    if (jobCheck && typeof jobCheck.unref === 'function') jobCheck.unref();
  }
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

  return { start, hook, callTool, callHandler, stop, stopAll, setJobsPaused, jobsPaused: () => jobsPaused, status, tools, list, digestOf, surface, hookTimeout: (id, event) => { const s = surface(id); return s && s.hookTimeouts ? Number(s.hookTimeouts[event]) || 0 : 0; } };
}

module.exports = { makePluginRuntime, MAX_RESTARTS, RESTART_WINDOW_MS };
