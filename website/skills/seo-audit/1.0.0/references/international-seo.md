# International SEO checks

Use this only when the site serves more than one language or region. A mistake here can hide a whole language version from search, so treat each failed check as high impact until shown otherwise.

How to read the signals: hreflang can live in three places, and you need to look at all three. Read the raw `<head>` with `web_request` (link tags), the response status line and headers where the tool shows them, and the sitemap with `web_fetch` or `web_request` (the `xhtml:link` entries). Compare at least two language versions of the same page.

## Hreflang

The three placements are equal: link tags in `<head>`, HTTP `Link` headers, and `xhtml:link` entries in the XML sitemap. If a site uses more than one, they must agree. When the same language and region pair points to different URLs, search engines drop the pair. For ten or more locales the sitemap method is the lightest.

Check for:

- A self-referencing entry on every page (the page lists itself in its own set).
- Return links: if page A points to page B, B points back to A. One-way pairs are ignored.
- Valid codes: a two-letter language code, optionally a two-letter region code (`en`, `en-GB`). `en-UK` is wrong. A region code alone is not allowed.
- An `x-default` entry pointing to the fallback page (a language chooser or the default language).
- Every target URL returns 200, can be indexed, and is its own canonical.
- No two entries with the same code pointing to different URLs.

Common errors: no self-reference; no return link; invalid codes; a target that redirects, is missing or is blocked; link tags and sitemap that disagree.

For Bing, hreflang is a weak signal. Also check `<html lang="...">` and the `content-language` meta tag.

Hreflang is not required on every page. It matters most on pages that get visitors in the wrong language.

## Canonical tags on multilingual sites

- Each language page points to itself as canonical (`/fr/page` to `/fr/page`).
- Never a canonical across languages (French pointing to English). That removes the French page from search.
- The canonical URL must be one of the URLs in the hreflang set, or the whole set is ignored.
- When canonical and hreflang disagree, canonical wins.
- Same protocol and same domain form in canonical, hreflang and sitemap.
- Paginated pages: each page is its own canonical; page 2 never points to page 1.

Regional versions in the same language (US and UK English) that are word-for-word identical may be treated as duplicates even with hreflang. They need real differences beyond the currency symbol.

## Sitemaps

- The `urlset` declares the `xhtml` namespace, and each `url` lists an `xhtml:link` for every locale including itself.
- `x-default` is included; all URLs are absolute.
- Limits: 50,000 URLs or 50 MB per file. Alternate links do not count toward the URL limit, but with many locales the file size does become the limit; 2,000 to 5,000 URLs per file is a safe plan.
- Split sitemaps by content type, not by language, so return links stay together.
- The sitemap index is named in robots.txt. Whether it was submitted in Search Console needs the Commander's account.
- Sites built with Next.js: the framework's language alternates do not add the self-referencing entry automatically. Look for it.

## URL structure

- Best: subfolders (`/en/`, `/de/`). Acceptable: subdomains or country domains. Not recommended: a URL parameter such as `?lang=en`.
- Every language has its own URL with a visible locale prefix. Hiding the locale from the URL leaves search engines one address for several languages.
- The root URL either acts as `x-default` or serves the default language.
- No switching of content by visitor IP or browser language on the same URL. Google's crawler mostly visits from the US and sends no language preference, so it would only ever see one version.
- Trailing slash and letter case are the same across paths, canonicals, hreflang and sitemaps; other forms redirect with a 301.
- Search Console's old country-targeting report is gone. Targeting now rests on hreflang, the language of the content and who links to the page.

## Content quality across languages

- Machine translation is not spam by itself, but large numbers of low-value translated pages can fall under scaled-content policies.
- Search engines decide a page's language from its visible content. Translate everything: title, description, headings and body. Translating only menus and footers while the main text stays in the original language creates duplicates.
- Thin language versions can pull down the whole site, because helpfulness is judged site-wide. Do not recommend `noindex` or a cross-language canonical as the cure. The sound advice is not to publish a language version that cannot be made useful.
- Local signals help: currency, phone format, addresses.
- Broken hreflang targets waste crawling and cancel the set they belong to.

## What to report

For each problem give the two URLs involved, the tags you read on each (quote them), and which rule above they break. Mark anything you could only check in the raw HTML and not in the rendered page.

Primary sources to cite when the Commander wants proof: Google Search Central pages "Localized versions of your pages", "Managing multi-regional and multilingual sites", "Locale-adaptive pages" and "Consolidate duplicate URLs". Open the current page with `web_fetch` before quoting it; guidance changes.
