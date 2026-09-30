---
name: spend-aware-work
description: "Plan work inside the station's budget: know the spending limits that stop a run, estimate before fanning out, pick the model and tools by the job, and stop to ask before a plan outgrows its money."
license: MIT
metadata:
  title: "Spend-Aware Work"
  category: "Station"
  author: "StarNet"
---

Metered runs spend real money on the Commander's account. The station has rails that stop a run when a cap is hit — but a run stopped by a cap has usually already wasted what it spent. Plan so you never meet the rail.

## The rails you work inside
- **The day rail.** A soft cap on metered spend per day ($25 by default, editable in SETTINGS > SPENDING LIMITS as PER DAY, 0 = off). Hitting it ends the run with reason `budget`, and the Commander can RESUME with one click. Per-run, per-agent and whole-station caps can be set there too. Subscription sign-ins have no dollar meter and never touch it.
- **Line budgets.** Every line has a LINE BUDGET: stages after the first (6 by default), dollars per message ($2 by default) and an optional dollars per day. Real test runs count against it; WATCH IT is free.
- **Crew.** Every dispatched worker runs its own loop and spends on its own model.

## Method
1. **Read the evidence you have.** station.layout shows each line's budget and its spend today; routine.list shows which routines run, how often and on which model. Each team.dispatch worker result reports what it cost. Past runs are the best estimate of the next one.
2. **Estimate before you start.** Count the expensive units: model turns, workers, pages read, images and voice takes made. Multiply by what similar runs cost. When the job is bigger than an ordinary chat, state the estimate in dollars and say which part dominates it.
3. **Right-size the model.** An agent runs on the model pinned in its Dossier CONFIG, or the station default. For standing work, pin a cheaper model per routine or loop (`model`/`provider` on routine.create, routine.manage and loop.create) when the job is extraction, formatting or triage; keep the strong model for judgment. For images, stay on the default model and use the premium one only where readable text must appear.
4. **Right-size the tools.** Read a page with web_fetch before driving a browser. For text-only scraping, browser.intercept (find it with tool.search) blocks images, media and fonts. Use code.run to loop over read tools and return one compact answer instead of spending many turns.
5. **Fan out only on real seams.** Five parallel workers cost about five times one. Dispatch when the pieces are truly independent; otherwise do the job in one run.
6. **Write stop rules into the plan.** "Stop after three sources agree." "At most two retries per failing step, then report." Put the same limits into routine prompts and worker briefs, because unattended runs cannot ask.
7. **Stop and ask before crossing.** When the work will clearly overrun the estimate, stop at a clean point, report what is done and what the rest will cost, and let the Commander choose.

## Rules
- **Never loop on a check you already passed.** Re-confirming finished work is the classic runaway: a loop that keeps re-reading files it already wrote spends all night and produces nothing new.
- **Never quote a cost you did not read or compute.** Call it an estimate and show the basis; when you have no reading, say so.
- **Never raise a cap or resume a budget stop yourself.** That is the Commander's call, in SETTINGS > SPENDING LIMITS.
- Cheaper is not better when it fails: a cheap model that needs three retries costs more than one right answer.

## Done means
The plan stated its estimate and stop rules before work began, the work finished inside them (or stopped at a clean point and the Commander chose), and the report gives actual spend wherever the station reported it.

## Output
The estimate and its basis, the model and tool choices, the stop rules, the actual spend as reported, and any line or routine worth moving to a cheaper model.

*Needs the ORCHESTRATOR (station.layout, routine and loop tools) for line budgets and model pins.*
