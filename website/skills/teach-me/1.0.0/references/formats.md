# Teaching workspace file formats

Four files carry the state of a teaching workspace. Keep each one short and current.

## MISSION.md

Lives at the top of the topic folder. It captures why the Commander is learning this. Every teaching decision (what comes next, which resources to surface, which exercises to design) traces back to it.

```md
# Mission: {Topic}

## Why
{1-3 sentences. The concrete real-world goal. What changes in their life or work once they have this skill? Avoid "to understand X"; push for the outcome underneath.}

## Success looks like
- {A specific, observable thing the Commander will be able to do}
- {Another specific thing}

## Constraints
- {Time, budget, prior commitments, learning preferences: anything that bounds the approach}

## Out of scope
- {Nearby topics the Commander does not want to chase right now}
```

Rules:

- **One mission per folder.** Two unrelated topics are two folders.
- **Concrete over abstract.** "Run a half marathon by October" beats "get fitter".
- **Push back on vagueness.** If the Commander cannot say why, interview them before writing anything. A bad mission is worse than none.
- **Revise when reality shifts**, after confirming with the Commander. A stale mission steers every later session wrong.
- **Keep it short.** Past one screen it has stopped being a compass and become a plan.

## RESOURCES.md

The curated set of trusted sources for the topic. Knowledge for lessons is drawn from here, not from guesses. Wisdom comes from the communities listed here.

```md
# {Topic} Resources

## Knowledge

- [Book: _{Title}_ by {Author}]({link})
  {What it covers.} Use for: {when to reach for it}.
- [Article: "{Title}" by {Author} ({Publisher})]({link})
  {What it covers.} Use for: {when to reach for it}.

## Wisdom (Communities)

- [{Community name}]({link})
  {Why it is worth trusting.} Use for: {what to ask there}.
- Local: {class or group}
  Use for: {real-time feedback on practice}.

## Gaps

- {An area the mission needs that has no good resource yet}
```

Rules:

- **High-trust only.** Prefer primary sources, recognised experts, peer-reviewed work and well-moderated communities. Marketing dressed as education stays out.
- **Opened before listed.** Add an entry only after reading the page with `web_fetch`, or when the Commander supplied it.
- **Annotate every entry.** A bare link is useless in three months. One line: what it covers and when to use it.
- **Surface gaps.** The `Gaps` section drives the next search.
- **Prune.** A resource that proved wrong, shallow or off-mission is removed, not buried. Five sharp sources beat thirty average ones.
- **Record community preferences.** If the Commander has opted out of communities, note it here.

## GLOSSARY.md

The agreed language for the workspace. Lessons, exercises and learning records all keep to it. Building it is part of learning: squeezing a concept into a tight definition is evidence of understanding.

```md
# {Topic} Glossary

{One or two sentences on what this glossary covers.}

## Terms

**Progressive overload**:
Systematically increasing the demand on a muscle over time, through load, volume or intensity.
_Avoid_: Pushing harder, levelling up

**RPE (Rate of Perceived Exertion)**:
A 1-10 self-rating of how hard a set felt, where 10 is failure and 8 means two reps were left.
_Avoid_: Effort score, intensity rating
```

Rules:

- **Add a term only when the Commander understands it.** The glossary records compressed knowledge; it is not a dictionary to learn from.
- **Be opinionated.** Where several words name one concept, pick the best and list the others under _Avoid_.
- **Keep definitions tight.** One or two sentences that say what the term IS, not how to do it.
- **Use glossary terms inside definitions.** That is what makes later terms easier to grasp.
- **Group under subheadings** when natural clusters appear. A flat list is fine otherwise.
- **Flag ambiguity.** If the wider field uses a word loosely, write the resolution: "Here, 'set' always means a working set."
- **Revise in place** as understanding deepens. No stale entries.

## Learning records

Files in `learning-records/`, numbered in order: `0001-short-name.md`, `0002-short-name.md`. To number a new one, list the folder with `fs.list`, take the highest number and add one.

```md
# {Short title of what was learned or established}

{1-3 sentences: what was learned, or what prior knowledge was established, and why it matters for future sessions.}
```

That is the whole format. A record can be one paragraph. Its value is stating that this is now known and why that changes what to teach next.

Optional, only when they add something:

- **Status** (`active`, or `superseded by LR-NNNN`) when an earlier understanding is replaced.
- **Evidence**: how the Commander showed the understanding (a question answered, an exercise completed, experience cited).
- **Implications**: what this opens up or rules out for future sessions.

Write a record when:

1. The Commander demonstrated real understanding of something non-trivial. This sets a new floor.
2. The Commander disclosed prior knowledge. Record the depth claimed.
3. A misconception was corrected. These predict future stumbling blocks.
4. The mission shifted because of what was learned. Update `MISSION.md` too.

Do not write one for:

- Material that was only covered. Coverage is not learning; wait for evidence.
- Anything already captured as a glossary term.
- A log of what happened in the session.

When a later record contradicts an earlier one, mark the old one `Status: superseded by LR-NNNN` instead of deleting it. How the understanding changed is itself useful.
