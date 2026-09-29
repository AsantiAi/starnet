---
fingerprint: 024e4e15
slug: commander-reported-plan-step-shown-as-starnet-re
title: Commander-reported plan step shown as StarNet recorded
surface: autonomy
severity: P2
status: fixed
found: 2026-09-29
lane: sweep/autonomy
fix: e0b979995
origin: audit
---

# Commander-reported plan step shown as StarNet recorded

## Symptom

A plan step the station settled because every quest planned for it was finished shows in the QUESTS proof list as "StarNet recorded", even when every one of those quests was the Commander's own report (attest). The app claims a harness verification that never happened. Found in branch code (agent/user-study-loop) before merge.

## Repro

1. Push a goal plan to the sidecar (POST /api/goals with milestones).
2. Mint two attest quests bound to the current milestone; report one done (POST /api/quests/report) and dismiss the other.
3. GET /api/journey: the settled milestone outcome carried `verifiedBy: 'harness-contract'`, which `frontend/app/stationui.js` proofLabel renders as "StarNet recorded".

## Evidence

`sidecar/goal-advance.js` slateFinished now returns `authority`; `test/goal-advance.test.js` asserts an all-attest slate is `commander-confirmed` and a slate with mechanical work is `harness-contract`; `test/user-study-loop.http.test.js` asserts the live sidecar records the reported slate as `commander-confirmed` (PASS).

## Verdict

Fixed on agent/user-study-loop e0b979995 before it ever reached trunk.
