/* node test/cron.reliability-ramp.test.js — routine reliability (2026-10-01):
   · RAMPED BACKOFF: transient retries wait 1×, 3×, 9× the base instead of a fixed 90s each.
   · WALL-CLOCK CEILING: a run that never settles but never goes heartbeat-stale (a chatty runaway) is stopped
     at maxWallMs, recorded as a TERMINAL failure for that occurrence, and frees the job's one-run lock. */
'use strict';
const A = require('./_assert.js');
const cron = require('../sidecar/cron.js');
const cronStore = require('../sidecar/cron-store.js');
const { makeCronDriver } = require('../sidecar/cron-driver.js');

const T0 = 1700000000000, MIN = 60000;
const ms = iso => Date.parse(iso);

(async function () {
  // ---- ramped backoff ----
  {
    let jobs = [cronStore.makeJob({ id: 'rb', prompt: 'p', schedule: cron.parseSchedule('every 6h', T0) }, { id: 'rb', now: T0 })];
    const waits = [];
    let now = T0;
    for (let i = 0; i < 3; i++) {
      jobs = cronStore.markRun(jobs, 'rb', { runId: 'r' + i, status: 'error', error: 'net', transient: true }, { now, backoffMs: 90000 });
      waits.push(ms(jobs[0].nextRunAt) - now);
      now = ms(jobs[0].nextRunAt);
    }
    A.eq(waits.join(','), [90000, 270000, 810000].join(','), 'transient retries ramp 90s -> 4.5m -> 13.5m');
    A.eq(jobs[0].retryCount, 3, 'three retries counted');
    jobs = cronStore.markRun(jobs, 'rb', { runId: 'r3', status: 'error', error: 'net', transient: true }, { now, backoffMs: 90000 });
    A.eq(jobs[0].retryCount, 0, 'retries exhausted -> the occurrence finalizes and the counter resets');
    A.eq(jobs[0].consecutiveFailures, 1, 'and it counts toward the failure ceiling');
  }

  // ---- wall-clock ceiling ----
  {
    const job = cronStore.makeJob({ id: 'wc', prompt: 'go', agentId: 'agent', schedule: cron.parseSchedule('every 6h', T0) }, { id: 'wc', now: T0 });
    let store = [Object.assign({}, job, { enabled: true, nextRunAt: new Date(T0).toISOString() })];
    let clock = T0;
    const results = [];
    let aborted = false;
    const d = makeCronDriver({
      getJobs: () => store, setJobs: j => { store = j; },
      runOnce: o => new Promise(() => { if (o && o.signal) o.signal.addEventListener('abort', () => { aborted = true; }); }),
      emit: (name, p) => { if (name === 'cron.result') results.push(p); },
      newId: () => 'wcrun', newAbort: () => new AbortController(), now: () => clock,
      getKey: () => 'sk', defaultModel: 'm', maxRunMs: 8 * MIN, heartbeatStaleMs: 10 * 60 * MIN, maxWallMs: 30 * MIN
    });
    A.eq(d.applyTick(clock).fired, 1, 'the routine fires');
    clock = T0 + 20 * MIN; d.applyTick(clock);
    A.eq(results.length, 0, 'inside the wall-clock limit the run is left alone');
    clock = T0 + 31 * MIN; d.applyTick(clock);
    A.eq(results.length, 1, 'past the limit the run is settled exactly once');
    A.eq(store[0].lastStatus, 'error', 'recorded as a failure');
    A.eq(store[0].lastReason, 'wall-clock-exceeded', 'with the wall-clock reason');
    A.ok(/30 min/.test(store[0].lastError || ''), 'and a readable error');
    A.eq(store[0].retryCount || 0, 0, 'terminal, not retried (a retry re-runs the runaway)');
    A.eq(store[0].consecutiveFailures, 1, 'counts toward auto-pause');
    A.ok(d.leases.get('wc') == null || d.leases.get('wc').runId !== 'wcrun', 'the one-run lock is released');
    // ceiling off -> never stopped by wall clock
    let store2 = [Object.assign({}, job, { id: 'wc2', enabled: true, nextRunAt: new Date(T0).toISOString() })];
    const res2 = [];
    const d2 = makeCronDriver({
      getJobs: () => store2, setJobs: j => { store2 = j; }, runOnce: () => new Promise(() => {}),
      emit: (n, p) => { if (n === 'cron.result') res2.push(p); }, newId: () => 'r2', newAbort: () => new AbortController(), now: () => T0,
      getKey: () => 'sk', defaultModel: 'm', maxRunMs: 8 * MIN, heartbeatStaleMs: 10 * 60 * MIN, maxWallMs: 0
    });
    d2.applyTick(T0); d2.applyTick(T0 + 120 * MIN);
    A.eq(res2.length, 0, 'maxWallMs:0 leaves a live run alone');
  }
  A.report('cron.reliability-ramp');
})().catch(e => { console.error(e); process.exit(1); });
