---
name: skill-authoring
description: "Decide when a procedure deserves a saved skill, then write one the next run can follow cold — named for its trigger, step by step, ending in verification — and keep the skill library lean."
license: MIT
metadata:
  title: "Skill Authoring"
  category: "Station"
  author: "StarNet"
---

A skill is HOW: a procedure loaded with skill.view when the job comes round again. A fact goes in the notebook; a schedule is a routine; a skill is the steps. Save one only when it will save the next run real work.

## When a procedure earns a skill
- You did it, it worked, and it will come round again.
- It took discovery: a non-obvious order, a trap you hit, a check that caught a real mistake.
- The Commander corrected how you did it, and the correction generalizes.

Not a skill: a one-off, a fact ("the staging server is X" belongs in the notebook), or anything you have not actually done successfully.

## Method
1. **Check the library first (skill.list).** It shows names, summaries, state and use counts. If a skill already covers most of this, improve it: skill.view it, then skill.manage action=patch (find/replace) or action=edit. A near-duplicate splits future runs between two half-right versions.
2. **Name it for the trigger.** A short title a future run would match to the job: "Deploy the site", "Reconcile the monthly invoices". The summary is one line — what it does and when to use it. That line decides whether the skill ever gets loaded.
3. **Write the body for a reader with no context.** The next run has not seen this conversation. Numbered steps, each an action with the real tool name, the real path or command, and what a good result looks like. Put each trap inside the step where it bites, not in a footnote.
4. **Make verification a step.** The last step proves the result — the check you ran and the output that meant success — so the next run cannot stop at "looks done".
5. **Write the don'ts.** The mistakes you made or nearly made, stated plainly: what not to do and why.
6. **Generalize without going vague.** Replace today's specifics with what varies ("the invoice month") and keep the facts that do not change. Never put a key, token or password in a skill; name the environment variable instead.
7. **Declare what it needs.** Pass `requires` with the gear the procedure uses (cabinet, dish, workbench, notebook, studio, orchestrator) and `setup` for prerequisites. Long reference material goes in a support file (action=write_file under `references/`), not the body.
8. **Save it (skill.manage action=create, or skill.write)** and read the tool's answer.
9. **Load it back (skill.view)** and read it as a stranger would. Fix every step you had to fill in from memory.

## Keep the library lean
- A skill nobody loads for 30 days goes stale; an agent-written one is archived after 90. Pin (action=pin) only what the Commander wants kept regardless.
- When two skills overlap, merge into the better one and archive the other with `absorbedInto` naming the survivor.
- A skill listed as WITHHELD is held by the skill guard: do not recreate it or guess its contents; tell the Commander it needs review in ABILITIES > SKILLS.

## Rules
- **Never save a procedure you have not seen work.**
- **Never rewrite a skill you have not just read with skill.view.**
- One procedure per skill. A skill that does three things gets loaded for all three and followed wrongly for two.

## Done means
The skill loads with skill.view, a run with no context could follow every step, the last step verifies the result, and no near-duplicate stays active.

## Output
The skill name and summary, whether it was created or patched, what triggered saving it, and anything merged or archived.

*Needs the NOTEBOOK (skill.list / skill.view / skill.manage).*
