---
fingerprint: 2ea198d9
slug: first-path-offer-silently-vanishes-for-a-long-or
title: First-path offer silently vanishes for a long or repeated mission
surface: onboarding
severity: P2
status: fixed
found: 2026-09-29
lane: sweep/onboarding
fix: 6d86bbfe2
origin: audit
---

# First-path offer silently vanishes for a long or repeated mission

## Symptom

At the end of the interview the Commander corrects the station's read and states the mission in their own words at length (over 280 characters), or states a mission identical to an older goal. The meeting ends without ever offering the step-by-step path for that mission; nothing says why.

## Repro

1. Run the full interview (loose or deep) with a live mind.
2. At "did i read that right?" pick "close — let me put it my way" and type a mission longer than 280 characters.
3. Pick any cadence. The first-path beat never appears: `frontend/app/onboarding.js` looked the belief up with an exact-text find, but `frontend/app/dossier.js` upsert trims and caps text at `TEXT_CHARS = 280`, so no belief matched. With an older identical goals belief present, the find returned the OLD one, which already has a plan, so `GoalStore.proposeDecomposition` refused it.

## Evidence

`test/onboarding-refresh.test.js` (real-shaped dossier stub: appends, trims, caps at 280, older identical belief present): with the old lookup restored, `AssertionError: the belief this meeting just wrote (not an older identical one) is drafted into steps`; with the fix, OK including the >280-char mission case.

## Verdict

Fixed on agent/user-study-loop 6d86bbfe2: take the newest goals belief (upsert without an id always appends) with a 40-char head check instead of an exact-text find.
