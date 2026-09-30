---
name: blocked-page-recovery
description: "Use when web_fetch cannot read a page (403/429, bot wall, dead or changed page): recover a dated archive copy or the site's own data feed, reject fake successes, and cite it with honest provenance."
license: MIT
metadata:
  title: "Blocked Page Recovery"
  category: "Research"
  author: "Nous Research"
---

# Blocked Page Recovery

When a page will not load for you (403/429, a "Just a moment..." challenge, a bot-detection interstitial, a page that has since changed or vanished), do not give up and do not loop on the same URL. Third-party archives often hold a **copy** of the page. Work down this ladder, cheapest first.

## What `web_fetch` already tried

One `web_fetch` call already climbs the live rungs: it reads through Jina Reader when a `JINA_API_KEY` is stored in TOOLSETS & CONNECTORS → KEYS, falls back to a direct fetch, and retries bot-blocked or JavaScript-only pages once through the station's own headless browser (the result then says "read via the station browser"). So when `web_fetch` reports that a page cannot be read, the live routes are mostly spent. Move to copies; do not refetch the same URL.

## The ladder

```
1. Wayback Machine  — availability API, then the CDX index  (dated snapshot)
2. archive.today    — domain rotation: archive.ph → .md → .li → .is  (dated snapshot)
3. API-first pivot  — /api/, /graphql, .json, RSS/Atom, sitemap on the same host  (live)
4. Station browser  — browser.navigate + browser.get_text, the most expensive rung  (live)
```

## Provenance discipline (non-negotiable)

Every recovered copy carries a provenance you MUST keep when citing it:

| Route | Provenance | How to cite |
|-------|-----------|-------------|
| Wayback, archive.today | snapshot | Cite WITH the snapshot date: "as archived 2026-08-06". Never present a snapshot as the live page; it can be stale. |
| `web_fetch` (any rung), data endpoint, station browser | live | Cite normally. |

If the Commander needs *current* data (prices, availability, breaking news), a snapshot is context, not an answer. Say so explicitly and state its age.

## 1. Wayback Machine (best provenance, try first)

1. **Discovery:** `web_fetch` `https://archive.org/wayback/available?url=<URL>` (URL-encode the target when it has its own `?` or `&`). The JSON gives `archived_snapshots.closest.url` and `.timestamp` (`YYYYMMDDhhmmss`).
2. **If `archived_snapshots` is empty** (the availability API often answers empty under load even when snapshots exist), ask the CDX index for the newest good captures: `web_fetch` `https://web.archive.org/cdx/search/cdx?url=<URL>&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=-3`. Each row is `[timestamp, original, statuscode]`.
3. **Read the snapshot:** `web_fetch` `https://web.archive.org/web/<timestamp>id_/<original>`. The `id_` suffix returns the archived page itself, without the archive's toolbar.
4. If CDX answers 503, do not retry-hammer it. As a last Wayback attempt, `web_fetch` `https://web.archive.org/web/2/<URL>`, which redirects to the newest snapshot; its date is then unconfirmed, so say that when citing.

Works for: publicly crawled URLs. Fails for: sites that block the archive's crawler, URLs that were never crawled, and JavaScript-only pages (snapshots of those do not render).

## 2. archive.today (user-submitted copies)

User-submitted archives, sometimes holding pages the Wayback Machine lacks. It rate-limits hard (429) and rotates domains, so iterate: `web_fetch` `https://archive.ph/newest/<URL>`, then `archive.md`, `archive.li`, `archive.is` with the same path. Stop at the first genuine copy. The archived page shows its capture date; cite it.

If archive.today answers with a CAPTCHA or verification page, move on. Never try to solve or get around a CAPTCHA.

**Validate the body, not the status.** A 429 still ships several KB of rate-limit HTML that looks like success to a size check.

## 3. API-first pivot

Bot walls protect the HTML far more aggressively than the data endpoints behind it. After 2-3 blocked attempts on a site, stop fighting the HTML and look for:

- `/api/...`, `/graphql`, or `.json` variants of the page URL (`web_fetch` for plain GETs; `web_request` when you need a method or a header);
- an RSS or Atom feed (`/feed`, `/rss`, or a `<link rel="alternate">` in any copy you did recover);
- a sitemap (`/sitemap.xml`) that reveals canonical URLs which may not be gated.

## 4. Station browser (last resort)

`browser.navigate` to the URL, then `browser.get_text` (or `browser.snapshot`) to read it. It is slower and heavier than every other rung. If it lands on a verification wall, stop there: tell the Commander the page is gated and let them open it themselves.

## A page behind a login or paywall

If the page needs an account, say so. The Commander can open it in their own browser, or sign in through the station browser themselves. An archive copy of a paywalled page may exist; tell the Commander it is paywalled and let them decide whether an archived copy is appropriate for their use.

## Fake successes: routes that lie

These return HTTP 200 with a plausible body that is NOT the page. Reject them:

- **Google Cache is dead** (since mid-2024). `webcache.googleusercontent.com` returns 200 and tens of KB, but it is a search interstitial with a script redirect, not a cache. Never use it.
- **AMP caches** (`*.cdn.ampproject.org`) mostly return a ~300-byte `<title>Redirecting</title>` meta-refresh stub pointing back at the original (blocked) URL. Treating that as success creates a fetch loop.
- **Rate-limit bodies:** archive.today 429 pages are multi-KB HTML. Check for the target's actual content (title words, expected strings), not just the size.

Detection heuristics:
- a body under about 3 KB for an archive copy (under about 0.5 KB for a text rendering);
- a meta-refresh or script redirect whose target is the original host;
- an interstitial title: "Just a moment", "Redirecting", "Google Search", "Attention Required", "Access denied", "Are you a robot", "One more step".

## Proxy relays: don't

Generic "web proxy" relays are man-in-the-middle by construction. Never send cookies or Authorization headers through one, and do not use them for anything the Commander will rely on; their provenance cannot be verified. Prefer archives, which at least timestamp their copies.

*Needs the DISH (`web_fetch`, `web_request`, the station browser).*

Adapted for StarNet from blocked-page-recovery (Nous Research), MIT.
