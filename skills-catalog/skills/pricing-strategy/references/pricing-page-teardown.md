# Pricing page teardown

A structured way to score a live pricing page and return ranked fixes. It grades two axes: the human buyer's experience, and AI-assistant readiness, meaning whether the assistants that increasingly shortlist and compare tools can read, quote and recommend this pricing.

Credit: the two-axis structure and the AI-readiness lens are adapted upstream from Kyle Poyar's pricing-page teardowns (Growth Unhinged).

## Why the second axis matters

Buyers ask an AI assistant "what is the best [category] tool and what does it cost?" before they visit any site. If the price is inside an image, appears only after a script runs, or is absent from the page text, an assistant that reads text often cannot see it. A "Contact us" tier gives it no public number at all. When an assistant cannot read your price, it quotes the competitor whose price it can read. Fixing this guarantees nothing, but a page that cannot be parsed is much less likely to be quoted.

## How to run it

1. **Load context.** Read the product brief so clarity is judged for the right buyer.
2. **Read the page as text.** Use `web_fetch` on the pricing URL. Without looking at anything else, write down every plan, price, billing period and limit you can extract. This is the read test: you are the AI reader.
3. **See the real page.** `browser.navigate` to it, take `browser.get_text` and a `browser.screenshot`, and open the screenshot with `fs.read`. Compare with step 2. Anything a person can see that your text read missed is a finding. Note that `web_fetch` may fall back to a real browser on script-heavy pages, so a pass in step 2 does not prove that every assistant can read the page; a miss is a real finding.
4. **Check the structured data.** `browser.get_text` with the selector `script[type="application/ld+json"]` shows the first structured-data block. Look for product and offer entries with prices.
5. **Check the door.** Read `/robots.txt` with `web_fetch` and see whether AI search crawlers are blocked.
6. **Score all ten dimensions** Pass, Partial or Gap, with a one-line reason each.
7. **Rank the fixes** by impact and effort. AI-readiness gaps are often high impact and low effort (put prices in text); list those first.

## The rubric

### Axis 1: human buyer experience

| # | Dimension | Passing looks like | Common gaps |
|---|---|---|---|
| 1 | Value clarity | At the top: what you get and why it is worth it, in the buyer's words | A feature list with no outcome; "flexible plans for every team" |
| 2 | Plan differences | Obvious which plan is for whom and exactly how they differ | Long feature tables; tiers that blur; no "who it is for" |
| 3 | Mental load | A buyer can decide in under 30 seconds | Five or more tiers; unexplained jargon |
| 4 | Trust signals | Logos, testimonials, security notes, a guarantee near the button | No proof, or proof buried far down |
| 5 | Pricing psychology | A recommended tier, sensible anchoring, consistent price endings | No recommended tier; highest price hidden last; random endings |
| 6 | Transparency | The real price is shown; what is in and out is clear; no surprise fees | "Contact us" on every tier; hidden overage fees; limits left out |

### Axis 2: AI-assistant readiness

| # | Dimension | Passing looks like | Common gaps |
|---|---|---|---|
| 7 | Machine-readable pricing | The real numbers are in the page text | Price in an image or a PDF, or shown only after a script runs; "Contact sales" |
| 8 | FAQ and objection coverage | Readable answers to "does it do X", "what is the limit", "can I cancel", "is there a free trial" | No FAQ, or answers only in a help centre an assistant will not reach |
| 9 | Per-tier depth in text | Each plan's inclusions, limits and quotas stated in words | Differences shown only as tick marks; limits unnamed |
| 10 | Structured data and access | Product and offer structured data, clean headings, AI search crawlers allowed | No structured data; pricing behind a login or a click; AI search crawlers blocked |

## Common failure patterns

- **The image price.** A handsome pricing graphic with the numbers baked in. People like it; text readers and screen readers cannot read it. Put the prices in text and keep the image as decoration.
- **"Contact us" everywhere.** Sometimes right for a true enterprise tier. If every tier hides its price, people and assistants leave for a competitor with numbers. Show at least a starting price or a range.
- **Tick-mark tables.** Differences shown only as ticks and crosses. State the limits and inclusions in words.
- **Script-only or login-only prices.** If the price appears only after interaction or sign-in, most readers never see it.
- **Blocked AI search crawlers.** The crawlers that feed AI answers are search agents, not training crawlers. Upstream names OpenAI's `OAI-SearchBot`, Anthropic's `Claude-SearchBot` and `Claude-User`, and Perplexity's `PerplexityBot`; blocking `GPTBot` opts out of model training, not of ChatGPT search. Crawler names change, so have the Commander confirm against each vendor's current documentation before editing robots.txt.

## Report template

```
# Pricing page teardown: [url], [date read]

## Scores
- Human buyer experience: [X of 6 passing]
- AI-assistant readiness: [X of 4 passing]

## Read test
[What the text read returned for plans and prices, and what it missed or got wrong compared with the real page]

## Dimension by dimension
| # | Dimension | Verdict | Evidence |
| 1 | Value clarity | Pass / Partial / Gap | [what was seen] |
...

## Ranked fixes
1. [impact / effort] [fix]: [why it matters]
2. ...

## The one thing
[The single highest-leverage fix]

## Not checked
[Anything you could not see, and why]
```

Do not roll the two scores into one number. Two sub-scores and a ranked fix list are the deliverable. You recommend fixes; you do not edit the site.
