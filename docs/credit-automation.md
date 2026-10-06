# Credit-dispute automation (v1)

v1 is the manual-upload path. A person uploads a three-bureau consumer report. StarNet parses the text, flags anything incomplete or unmatched for a human, and writes a round-1 bureau dispute letter as a **DRAFT**. A person reviews it outside this module. v1 does not connect to MyFreeScoreNow or any credit portal, and it does not send, mail, fax, or approve a letter.

## Flow

1. `credit.parse_report` reads a `.txt` export, or a PDF via poppler `pdftotext -layout` (no new npm dependency). Parsing itself runs on the text.
2. `credit.review_case` compares an intake record with the parsed report and returns BLOCK, REVIEW, and INFO flags.
3. `credit.draft_letters` writes one round-1 letter when the intake is complete, the consumer matches the bureau identification, and the account is on that bureau with a draftable defect (patterns A, B, D, or E). The file is `DRAFT` when the validator passes and `DRAFT_NEEDS_FIX` when it does not.
4. `credit.list_drafts` lists case ids, status, bureau, furnisher, masked last-4, and file paths.

Bossman (the orchestrator) calls these tools and reads the redacted summaries. The letter body stays on disk. Letter metadata includes `factsRelied[]` and `unverified[]`. Validator failures append one JSON line to `validator-failures.jsonl` so a repeated failure is visible without re-reading the letter.

Tool results returned to the model are counts, flag codes, furnisher names, masked last-4s, and file paths. They do not include the consumer's full name, date of birth, street address, or the letter text.

## Where files live

```
<workspace>/credit/cases/<caseId>/
  case.json
  letters/<bureau>.md
  letters/<bureau>.json
  validator-failures.jsonl    # only when a draft fails validation
```

`credit/cases/` is gitignored. Case ids are `c-<bureau>-<ssnLast4>-<acctLast4>` (or an intake `caseId` of letters, digits, `_`, and `-`). They do not contain the consumer's name.

## Parsed report

`parse3b` returns schema version 1: source (format `three-bureau-equifax-powered`, report date, page count), the 11 sections, tradelines with a per-bureau view, personal information, inquiries, public records, collections, reconciliation counts, and parse warnings. Money is integer dollars or null. Dates are ISO or null. A month without a day stays null.

## Review flags

BLOCK stops a draft: missing intake fields, consumer mismatch, an intake account that is not on that bureau, an unrecognized format, or a missing section.

REVIEW needs a person: status versus past-due conflict (pattern A), missing date of first delinquency on derogatory reporting (pattern B), a collection with no original creditor (pattern D), cross-bureau conflicts (pattern E), an unmatched hard inquiry (pattern H, no letter until the client confirms it), no field-level defect (pattern I — say so, suggest a furnisher dispute under 15 U.S.C. § 1681s-2(b), never a goodwill letter), count mismatches, an unparsed public record, and attorney referral when the intake marks documented damages plus repeated non-compliance.

INFO is context: a value present at one bureau and blank at another, Experian-only account-number masking, and the icon payment grid.

Letter types other than a round-1 bureau dispute return `NOT_IMPLEMENTED`.

## Letter rules

The draft uses only facts from the intake and the parsed report. Each statute cite is the canonical form and is tied to one defect on one account. A Metro 2 reference names the field and its number (for example Account Status Code Field 17A and Amount Past Due Field 22) and quotes the status text. A numeric status code appears only when the intake supplies it. One Disputed Item section per account. The tone is formal: no emoji, exclamation marks, outcome guarantees, "609 letter", or goodwill request. Case citations are limited to the six opinions in `sidecar/credit/constants.js`, and only the Cushman reinvestigation cite is used in the round-1 procedural block.

Bureau mailing addresses are constants. Metadata says to confirm the address is current before mailing. v1 has no mail path. Metadata also carries "Set to 1.5 line spacing when transferring to Word." That sentence is not part of the letter body.

## Known gaps

- The monthly payment grid is icons in `pdftotext -layout` output, so Payment History Profile Field 18 is not extracted. A Field 18 sentence is written only when the intake supplies the mark, and it is listed as unverified.
- A populated public-record layout has not been seen. Anything other than the empty-state sentence is stored as raw text and flagged `PUBLIC_RECORD_PRESENT_UNPARSED`.
- Pattern C (a charge-off balance that grows without documented interest) needs a prior report, so v1 does not detect it.
- The personal-information counts in Other Credit Items (4/3/4 on the synthetic fixture) do not match a mechanical row count of name, AKA, reported address, and employment. v1 raises `COUNT_MISMATCH` rather than guessing the bureau's rule.
- "Agency Client" on a collection is not treated as the Metro 2 K1 original creditor. A collection-status tradeline is flagged pattern D.
