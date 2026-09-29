---
name: decision-questionnaire
description: "Turn a decision the Commander cannot answer alone into a focused questionnaire document for the person who holds the missing knowledge, to fill in async or together in a meeting."
license: MIT
metadata:
  title: "Decision Questionnaire"
  category: "Communication"
  author: "Matt Pocock"
---

# Decision Questionnaire

Turn something the Commander cannot answer alone into a **questionnaire**: a Markdown document they hand to one person to fill in async, or fill out together in a meeting. The recipient holds knowledge the Commander lacks; the questionnaire pulls it out of them.

## When to use

- A decision is blocked on facts or judgment held by someone else (a domain expert, a stakeholder, a vendor contact, operations).
- The Commander says "I need to ask X about this", or keeps deferring a decision until someone else weighs in.
- Preparing for a meeting where specific answers must come back.

Do NOT use it when the answer is discoverable from the environment (the codebase, documents, the web). Find it yourself first with `fs.search`, `fs.read`, `web_search`, and `web_fetch`.

## Core principle: interview the send, not the subject

The Commander cannot answer the subject-matter questions (that is the point), but they can ALWAYS answer questions about the send. Interview them only about that, in two short exchanges:

1. **Who is it going to?** Role, expertise, relationship to the Commander. This fixes the questionnaire's tone and how much context it must carry. Done when you know who the recipient is and what they know that the Commander does not.
2. **What do you need back?** The specific decisions or facts the Commander cannot resolve alone. Done when you have a concrete list of what the Commander must walk away able to do or decide.

Then **write the questionnaire**: draft questions aimed at the gap between what the recipient knows and what the Commander needs, following the structure below. Save it with `fs.write` as `decision-questionnaire-<slug>.md` (slug from the topic) and give the Commander the full path. Done when the file exists and every item from step 2 is covered by a question.

## Document structure

Frame it as a **discovery questionnaire**: the Commander lacks context, the recipient holds it. Order questions most-important-first (async means you may only get one pass). Group them under `##` headings by theme once there are more than a handful.

Template:

```markdown
# <Questionnaire title>

**Purpose:** why this questionnaire exists and the decision riding on it.

**From:** <the Commander> · **To:** <the recipient> ·
**How your answers will be used:** <where they go>

## Context

One paragraph orienting a recipient who was not in the Commander's head.
Enough to answer well, not a page.

## How to answer

Deadline and rough effort. Partial answers and "I don't know" are useful:
flag anything you are unsure of rather than skipping it.

## <Theme heading>

### <One question — a single idea, never compound>

_Why this matters: <one line, only where the question could be misread or
invite a throwaway answer>._

>

## Anything else?

A closing catch-all: anything we didn't ask that we should know?
```

Every question gets an answer stub (`>`) directly beneath it.

## Pitfalls

1. **Grilling the Commander about the subject.** They cannot answer it; that is why the document exists. Interview only the send.
2. **Compound questions.** One idea per question. Split "and/or" questions.
3. **Burying the critical question.** Most-important-first; async recipients fade.
4. **Context dump.** One orienting paragraph, not the whole history.
5. **Skipping the "why this matters" line on ambiguous questions.** It turns a throwaway answer into a useful one. Do not add it to questions that are already unambiguous.

## Verification

- [ ] The recipient's role and knowledge, and the needed outcomes, were captured in two exchanges before drafting.
- [ ] Every step-2 item is covered by at least one question.
- [ ] Questions are single-idea, most-important-first, with answer stubs present.
- [ ] The file was written and its full path reported to the Commander.

*Needs the CABINET to save the questionnaire file.*

Adapted for StarNet from decision-questionnaire (Matt Pocock, originally `to-questionnaire` in mattpocock/skills; ported by Hermes Agent), MIT.
