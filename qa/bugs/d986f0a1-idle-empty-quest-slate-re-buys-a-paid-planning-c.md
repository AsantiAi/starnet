---
fingerprint: d986f0a1
slug: idle-empty-quest-slate-re-buys-a-paid-planning-c
title: Idle empty quest slate re-buys a paid planning call every hour
surface: autonomy
severity: P1
status: fixed
found: 2026-09-29
lane: sweep/autonomy
fix: cba0e52f5
origin: audit
---

# Idle empty quest slate re-buys a paid planning call every hour

## Symptom

A station that knows something about the Commander, left open with an empty quest slate, pays for a quest-planning model call every hour for as long as it stays open, even though nothing changed and the planner keeps giving the same answer. With PROPOSE becoming the new-station default (agent/user-study-loop), this would hit every idle open station, not only Commanders who raised the autonomy dial.

## Repro

1. `const R = require('./sidecar/questrefresh.js')`.
2. `let s = R.stampCycle(R.fresh(), { now: T0, contextKey: 'k1' })` (a cycle just ran; the planner answered NONE or every proposal failed validation, so 0 quests are open).
3. `R.decide(s, { now: T0 + 61 * 60000, openCount: 0, contextKey: 'k1' })` returns `{ fire: true, why: 'caught-up' }`, and again at 2h, 5h, … with the same unchanged context.
4. `runQuestRefreshCycle` (sidecar/index.js) has no pre-spend exit for an unchanged context (only credential / model / slate-full / no-evidence), so each fire is a paid provider call.

## Evidence

Deterministic replay before the fix: `1.01h idle, empty slate, unchanged context -> {"fire":true,"why":"caught-up"}`, same at 2.02h and 5h. The caught-up branch in `sidecar/questrefresh.js` decide() had no context-change condition. Regression lock: `test/questrefresh.test.js` (SWEEP 2026-09-29 block) — seen FAIL x3 with the fix reverted, OK with it.

## Verdict

Fixed on agent/user-study-loop cba0e52f5: caught-up now requires the context key to have moved since the last cycle. Finishing quests moves it (progress-changed fires within 5 min), and the daily cadence still refreshes an idle station once a day.
