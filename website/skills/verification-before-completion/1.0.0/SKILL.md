---
name: verification-before-completion
description: "Never say work is done, fixed or passing without fresh proof: run the check that proves it, read the result, then report what it showed. Use before any claim of success, and before saving, committing or handing work over."
license: MIT
metadata:
  title: "Verification Before Completion"
  category: "Engineering"
  author: "Jesse Vincent"
---

# Verification Before Completion

## Overview

**Core principle:** evidence before claims, always.

**Violating the letter of this rule is violating the spirit of this rule.**

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you have not run the check in this turn and read what it returned, you cannot claim it passes.

## The gate

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY  What check proves this claim?
2. RUN       Execute the FULL check (fresh, complete)
3. READ      Full output, the exit code, the count of failures
4. VERIFY    Does the output confirm the claim?
             - If NO:  state the actual status, with the evidence
             - If YES: state the claim WITH the evidence
5. ONLY THEN make the claim

Skipping any step is misreporting, not verifying.
```

## How to run the check here

- **Code (tests, build, lint, type-check):** `verify.run` with `cmd` set to the project's own check (for example `npm test`); it returns a clear PASS or FAIL. Use `shell.exec` for any other command, and read the combined output AND the exit code it returns. A long suite may need a larger `timeoutMs`; a run that timed out proved nothing.
- **A file you wrote or changed:** read it back with `fs.read` (or find the changed lines with `fs.search`) and compare it with what was asked. "I called `fs.write`" is not evidence that the content is right.
- **A web or API change:** send the real request with `web_request` and read the status and body, or open the page with `browser.navigate` and read it with `browser.get_text` or `browser.screenshot`.
- **A message, post or booking:** read the tool's response. Success is what the response says, not the fact that you made the call.
- **A deliverable for the Commander:** open the finished file and check it against each requirement before naming it with `deliverable_note`.
- **No way to check** (no WORKBENCH placed, or a scheduled run, which has no shell and cannot ask questions): do not guess. Report the work as unverified and name the exact check that still has to be run.

## Common failures

| Claim | Requires | Not sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | A previous run, "should pass" |
| Linter clean | Linter output: 0 errors | A partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, logs look good |
| Bug fixed | The original symptom, re-tested: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | The test passes once |
| A worker finished the job | You read its files or the diff yourself | The worker reports "success" |
| Requirements met | A line-by-line checklist | Tests passing |
| File written | The file read back, content matches | The write call returned |

## Red flags: STOP

- Using "should", "probably", "seems to".
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!").
- About to commit, push, open a pull request, or hand over a deliverable without verification.
- Trusting another agent's success report.
- Relying on partial verification.
- Thinking "just this once".
- Wanting the work to be over.
- **ANY wording that implies success without having run the check.**

## Rationalization prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence is not evidence |
| "Just this once" | No exceptions |
| "Linter passed" | A linter is not a compiler |
| "The worker said success" | Verify independently |
| "It has been a long run" | Length of the job is not an excuse |
| "A partial check is enough" | Partial proves nothing |
| "Different words, so the rule does not apply" | Spirit over letter |

## Key patterns

**Tests:**
```
GOOD: run `verify.run` -> see "34/34 pass" -> "All 34 tests pass"
BAD:  "Should pass now" / "Looks correct"
```

**Regression tests (red-green):**
```
GOOD: write the test -> run (pass) -> revert the fix -> run (MUST FAIL) -> restore -> run (pass)
BAD:  "I've written a regression test" (no red-green check)
```

**Build:**
```
GOOD: run the build -> see exit 0 -> "Build passes"
BAD:  "Linter passed" (a linter does not check compilation)
```

**Requirements:**
```
GOOD: re-read the plan -> make a checklist -> verify each line -> report gaps or completion
BAD:  "Tests pass, phase complete"
```

**Delegated work (`team.dispatch`, `team.spawn`, a crew member's handoff):**
```
GOOD: worker reports success -> read its files with `fs.read`, or `git diff` through `shell.exec` -> verify -> report the actual state
BAD:  pass the worker's report on as fact
```

**Non-code work:**
```
GOOD: re-read the saved file / the response you got -> check each requirement -> report what is there
BAD:  "Saved the report" (never opened) / "Sent" (response never read)
```

## When to apply

**ALWAYS before:**
- Any variation of a success or completion claim.
- Any expression of satisfaction.
- Any positive statement about the state of the work.
- Committing, opening a pull request, completing a task, naming a deliverable.
- Moving on to the next task.
- Handing work to another agent, or accepting work back from one.

**The rule applies to:**
- Exact phrases.
- Paraphrases and synonyms.
- Implications of success.
- ANY communication that suggests completion or correctness.

## Output

Report to the Commander in this shape: the claim, the check you ran, and what it returned (the pass count, the exit code, the line you re-read). List separately anything you could not verify and why.

## Related

- `test-driven-development`: the red-green cycle in full.
- `systematic-debugging`: when the check fails and the cause is unknown.

*No gear needed for the rule itself. Code checks use the WORKBENCH (verify.run, shell.exec); file checks use the INTEL CAB (fs.read, fs.search); live checks use the DISH (web_request, browser.navigate).*

Adapted for StarNet from verification-before-completion (Jesse Vincent, obra/superpowers), MIT.
