# Pricing research methods

You cannot survey customers yourself. Your part: draft the survey for the Commander to send through their own survey tool, then analyse the exported responses. Read the export with `fs.read` and do the counting in `code.run`. Report the sample size with every result, and do not present a result from a handful of responses as a finding.

## Van Westendorp price sensitivity

Finds the acceptable price range.

Ask each respondent four questions:

1. At what price would [product] be so expensive that you would not consider buying it? (too expensive)
2. At what price would it be so cheap that you would question its quality? (too cheap)
3. At what price would it start to feel expensive, but you might still consider it? (expensive)
4. At what price would it be a bargain, a great buy for the money? (cheap)

Analysis:

1. For each question build the cumulative share of respondents across the price range. "Too cheap" and "cheap" fall as price rises; "expensive" and "too expensive" rise.
2. Find where the curves cross:
   - Point of marginal cheapness: "too cheap" crosses "expensive".
   - Point of marginal expensiveness: "too expensive" crosses "cheap".
   - Optimal price point: "too cheap" crosses "too expensive".
   - Indifference price point: "expensive" crosses "cheap".
3. The acceptable range runs from marginal cheapness to marginal expensiveness. The best zone lies between the optimal and indifference points.

Notes: 100 to 300 respondents make the result dependable. Segment by persona, because willingness to pay differs. Describe the product realistically. Adding a "would you buy at this price" question helps.

Report shape: the four points, the recommended range, the current price, and where the current price sits relative to the range.

## MaxDiff (best-worst scaling)

Finds which features customers value most, for packaging decisions.

1. List 8 to 15 candidate features.
2. Show respondents sets of four or five at a time.
3. Ask which is most important and which is least important.
4. Repeat across sets until every feature has been compared.
5. Score each feature. A simple score is (times chosen most minus times chosen least) divided by times shown. Dedicated survey tools compute a finer utility score; say which one you used.

Using the ranking:

| Rank | Packaging decision |
|---|---|
| Top fifth | Include in every tier; customers expect it |
| Next 30% | Use to separate tiers |
| Next 30% | Higher tiers only |
| Bottom fifth | Cut, or offer as a paid add-on |

## Willingness-to-pay questions

- **Direct:** "How much would you pay for [product]?" Simple and biased; people understate.
- **Gabor-Granger:** "Would you buy [product] at [price]?" with the price varied across respondents, which builds a demand curve.
- **Conjoint:** respondents choose between bundles at different prices; the analysis shows price sensitivity per feature. Needs a survey tool built for it: skip unless the Commander has one.

## Usage and value correlation

Uses the Commander's own product data. Skip unless they can export it.

1. Collect usage per customer: how often features are used, volumes (users, records, calls), outcomes where measurable.
2. Compare against success: which usage patterns go with staying, with expanding, with paying the most.
3. Find the thresholds: the usage level at which customers "get it", at which they expand, at which the price should step up.

Report shape: the averages for the best customers set beside the averages for customers who left, the pattern that separates them, and what it implies for the value metric (for example: value tracks the number of active users and the number of integrations, so charge per user and keep integrations for higher tiers).

## Cheap signals that need no survey

- What customers and prospects already say about price in support tickets, sales notes and reviews (the `customer-research` skill mines these).
- Whether prospects flinch at the price or accept it at once.
- Conversion at the current price, and how it moved after past changes.
- Which plan customers pick and how often they upgrade or downgrade.
