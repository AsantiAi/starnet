# Source guides

How to find and read customer talk on each kind of public source. Search with `web_search`, read with `web_fetch`, and switch to `browser.navigate` plus `browser.get_text` when a page only shows its content in a real browser. Log every quote with its URL and date.

## Reddit

Look for where the customer spends time, not where the product is discussed.

Search patterns (put the real words in place of the brackets):

- `site:reddit.com "[job title] tools"` or `site:reddit.com "[problem] software"`
- `site:reddit.com/r/[community] "[keyword]"`
- `site:reddit.com "[problem]" recommend OR suggestion OR alternative`
- `site:reddit.com "[competitor]" vs OR alternative OR switched`

Communities by field: sales and marketing (r/sales, r/marketing, r/PPC, r/SEO), founders (r/entrepreneur, r/startups, r/smallbusiness), developers (r/programming, r/devops, r/webdev), data (r/analytics, r/dataengineering), people teams (r/recruiting, r/humanresources), finance and operations (r/accounting, r/projectmanagement). Consumer products live in hobby communities, for example r/running for a fitness app or r/personalfinance for a budgeting app.

High-signal posts:

- "What tools do you use for X?" shows alternatives and vocabulary.
- "Frustrated with [competitor], looking for alternatives" shows pains and switching triggers.
- "How do you handle X?" shows workflows and workarounds.
- "Is [category] worth it?" shows objections and buying criteria.

Take: the problem as stated, the top-voted answers, complaints in the comments, the exact wording, and whether the thread agrees or argues.

## Review sites (G2, Capterra, Trustpilot, AppSumo)

Your own product, in this order: three-star (liked it, something missing), one-star (failure modes; separate product faults from support and setup faults), five-star (the words for what they love), four-star ("the only thing I wish").

Competitors: read the four-star reviews first. The common review sections map directly: "what do you like best" is their strength, "what do you dislike" is your opening, "what problems are you solving" is the job to be done.

For each competitor note: job to be done, top praise, top complaint, what they switched from, and the unmet need ("I wish it could").

Trustpilot leans consumer. AppSumo leans small business. Many review sites block automated reading; if the page will not load, say so and ask the Commander for an export or pasted reviews.

## Indie Hackers and Product Hunt

Indie Hackers suits founder and small-business buyers: "ask" posts about the problem, milestone posts where founders list their tools, comment threads on launches in the category. Search `site:indiehackers.com "[problem]"`.

Product Hunt: the discussion under a competing product. Questions are pre-sale worries (objections). Early comments show first reactions. "Alternatives to" lists show the market as buyers see it.

## Hacker News

Suits technical buyers; leans sceptical. Search `site:news.ycombinator.com "[competitor or category]"`. Read "Ask HN" tool threads and the critical comments under competitor launches. Expect strong views on pricing models and first-principles objections you will not hear elsewhere.

## LinkedIn and job postings

Posts are mostly behind a login. Use what a search engine shows and do not try to get past the wall.

Job postings are easier to reach and useful: a posting is a company admitting a pain. Read which tools are required or nice to have, which outcomes the role is measured on, and what the person will spend most time doing. Find them through company careers pages or `web_search` for the role title plus the tool category. Treat postings as low to medium confidence: they describe hopes, not always present pain.

## Video comments (YouTube, short-video apps)

Find tutorials for the problem, "best tools for X" round-ups, honest reviews and competitor demos. In the comments look for "does this work for [case]?" (unmet need), "I tried this but" (failure point), "what about [competitor]?" (active comparison).

Comments often load only in a real browser and sometimes not at all for an automated one. Use `browser.get_text`; if the comments are not in the text, report that and move on. You cannot transcribe the video itself; use the caption or transcript text only if the page shows it.

## X and other login-only feeds

Advanced search there needs an account. Skip unless the Commander exports posts or pastes them.

## Comparison posts and niche forums

Search `"[competitor 1] vs [competitor 2]"` and `"best [category] software"`. Read the comments under comparison articles: those readers are choosing right now, and their questions are the ones sales and the website must answer. Question sites such as Quora show decision worries in long form.

## App stores and marketplaces

For consumer and mobile products, store reviews are one of the richest unfiltered sources. Order: one and two stars (failure, broken expectations), three stars (trade-offs), five stars (what they love). Take the job ("I use this to"), the moment it stopped working, what they switched from, and the emotional phrases. Marketplace reviews for physical or neighbouring products follow the same order, three-star first.

## Audience tools

Skip unless the Commander has an audience-research tool such as SparkToro and shares an export. If they do: it shows what an audience reads, watches, follows and searches for. Treat that as good evidence of where people spend time, and as no evidence of why they do anything. Use it to choose which communities to mine by hand.

## Source weighting

| Source | Strength | Bias to state |
|---|---|---|
| Customer interviews, unprompted | Very high | Small sample; engaged customers |
| Win and loss interviews | High | Recent memory; people rationalise |
| App store and review-site reviews | High | Strong opinions, love or hate |
| Reddit and community posts | Medium to high | Technical, sceptical, vocal few |
| Support tickets | Medium | Problems only |
| Survey, open answers | Medium | Shaped by the question |
| Survey, multiple choice | Low to medium | Limited to the options offered |
| Score-survey comments | Medium | Tied to the score and the moment |
| Video and social comments | Medium | Engaged viewers; performing for others |
| Job postings | Low to medium | Aspirational |

## Presenting with confidence labels

Lead each insight with its label and the count behind it, for example:

- HIGH: "Customers feel buried by manual reporting". Seen in 12 of 20 interviews, four Reddit threads, and the most common three-star complaint. Same across small and mid-size customers.
- MEDIUM: "Customers compare us with spreadsheets more than with rivals". Six interviews and three threads; not yet in review data.
- LOW: "Large buyers may worry about procurement". Two interviewees at companies over 500 people. Needs more before acting.

After 20 to 30 logged quotes, patterns show. A phrase that turns up in unrelated sources is your strongest signal.
