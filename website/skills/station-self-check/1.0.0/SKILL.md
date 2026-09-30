---
name: station-self-check
description: "Read the station's own health from its tools — scheduler, failing routines, stuck loops, blocked lines, idle bays, stale or withheld skills — and report only what the tools show, with one fix for each finding."
license: MIT
metadata:
  title: "Station Self-Check"
  category: "Station"
  author: "StarNet"
---

A self-check answers "is my station actually working?" from the harness's own readings, never from memory or a guess. Every finding names the tool that showed it and the one action that fixes it.

## Method
1. **Harness first (station.inspect).** Build, scheduler (armed, stopped by E-STOP, healthy, last tick error), routine count, connected MCP connectors, recent recorded errors and the last run. A section reported unavailable is itself a finding — call it unknown, not fine.
2. **Routines (routine.list).** For each: enabled, last status, last error, next run. Flag a failed last status; a routine disabled after repeated failures (five in a row pauses it); an enabled routine over a disarmed or stopped scheduler, which will not fire; a next run that is already in the past.
3. **Loops (loop.list).** Stopped, paused, or waiting on a review the Commander has not given — a review loop keeps working until three results wait for review, then pauses until the Commander reviews them.
4. **Lines and floor (station.layout).** Is routing live? One blocking error anywhere stops every line. For each line: its status pill, what blocks it, any paused starts and why, and today's runs, shipped, failed and spend. Bays on no line, and lines with nothing to start them, are idle gear: built, doing nothing.
5. **Crew work (team.subagents).** Your background workers left stale, interrupted or failed.
6. **Skills (skill.list with `includeArchived: true`).** Skills marked stale (unloaded for 30 days), archived, used 0 times, or WITHHELD by the skill guard. A skill that never loads usually has a summary that does not match how the work gets asked for, or duplicates another — say which.
7. **Connections (connectors.list, if you have the DISH).** What is connected, and anything a routine depends on that is not.
8. **Rank the findings.** Broken and silent first (a routine failing unattended, a blocked line, a stopped scheduler), then waste (idle bays, dead skills), then cosmetic.
9. **Give one fix per finding, with its owner.** You can pause, resume, edit or queue a routine (routine.manage) and patch or archive your own skills (skill.manage), with the Commander's approval where asked. Building, placing props, lifting an E-STOP and forgetting memories are the Commander's.

## Rules
- **Report only what a tool returned.** You cannot see how often a placed prop's tools get used; never invent usage figures.
- **Never fix by deleting** a routine, loop or skill unless the Commander says so. Pausing is reversible; deleting is not.
- **Do not resume a routine that paused itself** until its last error is understood.
- Quote statuses as the tools gave them. An E-STOP is the Commander's deliberate choice, not a fault.

## Done means
Every section was read or named as unavailable, every finding cites its tool and reading, and each finding has one concrete fix and an owner.

## Output
One health line (healthy / degraded / broken, and why), then the findings ranked — `what · where · evidence · fix · who` — then anything you could not read.

*Needs the ORCHESTRATOR (routine, loop, layout and crew reads) and the NOTEBOOK (skill.list). station.inspect is available to every agent.*
