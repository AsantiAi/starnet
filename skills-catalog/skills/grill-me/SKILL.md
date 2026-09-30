---
name: grill-me
description: "Stress-test a plan before any code is written: list the decisions it rests on, then question the Commander on them, foundations first, with a recommendation for each, and confirm alignment."
license: MIT
metadata:
  title: "Grill Me"
  category: "Engineering"
  author: "Rafael Zendron, Matt Pocock"
---

# Grill Me

Stress-test a plan through structured adversarial questioning before any code is written. Model the plan as a **design tree**: every decision branches into the decisions that hang off it. Interview the Commander in rounds until every branch is resolved and nothing is silently assumed.

## When to use

- The Commander says "grill me", "interview my plan", or "stress test this idea".
- Before complex work: auth flows, schema changes, migrations, payments.
- A plan has unresolved decisions or seems vague.
- Before splitting work across the crew.

Do NOT use it for reviewing existing code (use a code-review recipe) or for simple one-off tasks.

## Prerequisites

None. The skill works on any plan or raw idea.

## Core mechanic: frontier rounds

Map the plan as a design tree. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask NOW without guessing at answers you have not heard yet.

Work in **rounds**: ask the whole current frontier in one message, numbered, each question carrying your recommended answer. Then wait. A question whose answer depends on another question still open in this round belongs to a LATER round, not this one.

Format each round like this:

```
Q1 — <question title>: <question body, options if relevant>
Recommendation: <your recommended answer + one-line why>

Q2 — <question title>: <question body>
Recommendation: <...>
```

Each answer reshapes the tree: settled decisions push the frontier outward and unblock dependent questions. Recompute the frontier and ask the next round.

**Facts are your job; decisions are the Commander's.** When a frontier question needs a fact from the environment (codebase, files, config, docs), find it yourself with `fs.search`, `fs.read`, and `shell.exec` (for example `git log` in the project), or hand a heavy exploration to a sub-agent with `team.spawn`. Never ask the Commander for anything you could look up. Do not block on an exploration: only the questions downstream of it wait; ask the rest of the frontier now.

## Question coverage (work these branches into the tree)

**Understanding**: the real goal and boundaries.
- What is the ACTUAL objective? What is explicitly IN and OUT of scope?
- What are the constraints (time, tech, team, budget)? Who are the users?

**Technical decisions**: for each architectural choice.
- "Why this approach and not X?" / "What happens if Y fails?"
- "What is the worst case?" / "How would you roll back?"
- Cross-reference the existing codebase; if the project already has a pattern for this, call it out.

**Edge cases:**
- "What happens if the user does Z?" / "What if dependency X goes down?"
- "What if volume is 100x the expectation?" / "What are the security implications?"

## Synthesis (when the frontier is empty)

1. Summarize ALL decisions as bullet points.
2. List anything left open, and what is explicitly OUT of scope.
3. Ask: "Aligned? Should I start implementing, or adjust anything?"

Do not act on the plan until the Commander confirms the shared understanding.

## Pitfalls

1. **Asking questions out of dependency order.** A question that depends on an unanswered question is a guess wearing a question mark. Keep it for a later round.
2. **Skipping the codebase.** Find facts in the code with the station's tools instead of asking the Commander.
3. **Accepting "I don't know" as final.** Suggest options, explain the trade-offs, make a recommendation.
4. **Writing code during the interrogation.** Alignment only; code comes after the explicit green light.
5. **Being too agreeable.** Your job is to find problems. If everything looks fine, look harder.
6. **Not adapting to the Commander's language.** Interview in whatever language they speak.

## Verification

- [ ] Every question in a round had all its prerequisites already settled.
- [ ] Each question carried a recommendation.
- [ ] Facts were looked up in the codebase instead of asked.
- [ ] The frontier was empty (no branch silently assumed) before synthesizing.
- [ ] A clear summary of all decisions and open items was produced.
- [ ] The Commander confirmed alignment before stopping.

*Uses the CABINET to read the codebase for facts; the WORKBENCH helps for git history.*

Adapted for StarNet from grill-me (Rafael Zendron, with the frontier-rounds mechanic from Matt Pocock's `grilling` in mattpocock/skills), MIT.

*Sub-agent steps (team.spawn) need the ORCHESTRATOR, which every run the Commander starts carries. In a scheduled run, list those updates in the report instead of making them.*
