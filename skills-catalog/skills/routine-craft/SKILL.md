---
name: routine-craft
description: "Write a routine that runs well with nobody watching: no duplicates, a self-contained prompt, a fitting schedule, stop rules, a quiet "nothing new" reply, and a known place for results to land."
license: MIT
metadata:
  title: "Routine Craft"
  category: "Station"
  author: "StarNet"
---

A routine is a saved prompt the scheduler fires on its own. Nobody reads it at run time, nobody answers its questions, and it runs again tomorrow whether or not today's run was any good. Write it for that reader.

## Method
1. **Check what exists (routine.list).** It shows every routine, its schedule, last status and last error, and whether the scheduler is armed or stopped by the E-STOP. If a near-identical routine exists, improve it with routine.manage action=update instead of adding a twin — the station refuses duplicates and never recreates a routine the Commander deleted.
2. **Write the prompt as a complete brief.** It is the only context the run gets. Include the goal, the sources or files to use, the bar for "worth reporting", the output shape, and where to save anything durable. No "as discussed", no "like last time".
3. **Give it a memory if it compares runs.** Inside a scheduled run, routine.notepad (read, then write) keeps a private scratchpad for that routine alone — up to 8,000 characters, surviving restarts. Store the baseline (last value seen, last item id), never a log.
4. **Build in the silent path.** Tell the routine: if nothing crossed the bar, reply exactly `[SILENT]`. A silent run delivers nothing and pings no one; a failed run always reports.
5. **Pick the schedule for the job, not the habit.** The tool takes forms like `every 6h`, `0 9 * * 1-5`, `in 2h`, or an ISO time. Pass `timezone` with a cron expression. Use `repeatTimes` for a routine that should end.
6. **Choose the agent and model on purpose.** Pass `agentId` (or `agentHint`) so the routine runs on the right specialist. Pin `model`/`provider` when a cheaper model does the job.
7. **Decide where results land.** `deliver: local` keeps results on the station; `deliver: origin` returns each result to the chat or session the routine was created from. Set `attachToSession` when replies should continue from the result. To feed one routine from another, use `contextFrom`, with `monitorMode` to run only when the upstream output changed.
8. **Name what it cannot do alone.** A routine that needs the terminal needs the Commander to grant that in the ROUTINES panel, and rewriting its prompt later clears the grant. Unattended runs are time-bounded (eight minutes by default), so size the job to fit.
9. **Create it (routine.create) and read the answer.** Report schedulerArmed, schedulerHalted and the next run time exactly as returned.
10. **Prove one run.** routine.manage action=run_now queues the routine for the scheduler's next tick; it does not run it now. Check routine.list afterwards for lastStatus and lastError, then read the result where `deliver` says it lands.

## Rules
- **Never use shell, crontab or the operating system's task scheduler for a StarNet routine.**
- **Never say "it ran" after run_now.** It is queued; say so, and report the real outcome once routine.list shows it.
- **Never promise "this runs daily" over a disarmed or E-STOPPED scheduler** — repeat what the tool said.
- **A routine that fails five times in a row pauses itself.** Find and fix the cause before resuming it.
- One job per routine. Two unrelated jobs in one prompt fail together and report muddled.

## Done means
The routine exists once, routine.list shows a real lastStatus of ok (or a clean [SILENT]) from at least one run, and that run's result was found where `deliver` says it lands.

## Output
Routine name, agent, schedule with timezone, delivery, the stop rule, the first run's outcome as recorded, and anything that needs the Commander (a grant, arming the scheduler).

*Needs the ORCHESTRATOR (routine.list / routine.create / routine.manage). routine.notepad works inside any scheduled run.*
