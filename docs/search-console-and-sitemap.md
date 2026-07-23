# Google Search Console And Sitemap Operations

This guide is the source of truth for sitemap generation, crawler directives, production verification, and Google Search Console operations for `questesports.lk`.

## Production URLs

- Canonical site origin: `https://questesports.lk`
- Sitemap: `https://questesports.lk/sitemap.xml`
- Crawler rules: `https://questesports.lk/robots.txt`
- Google Search Console property: `questesports.lk`

`NEXT_PUBLIC_SITE_URL` must be exactly `https://questesports.lk` in production. Do not include a trailing slash, path, query, fragment, username, or password.

## How The Sitemap Is Built

Next.js generates the XML response from `frontend/app/sitemap.ts`. Shared sitemap helpers and the maintained static-route inventory live in `frontend/lib/sitemap.ts`. `frontend/app/robots.ts` publishes the sitemap URL.

The sitemap contains canonical, indexable URLs only:

- public landing pages, tournaments, media, shop, members, recruitment, contact, and policy pages
- published tournament detail pages
- published event-series pages
- published rulebooks
- active shop products

Account, admin, checkout, payment, invitation, and form-action pages are intentionally excluded. Those pages use `noindex` metadata where applicable. They remain crawlable because a crawler must be able to load a page to read its `noindex` directive; `robots.txt` is not used as an indexing control.

Dynamic content sources fail independently. If one public API endpoint is temporarily unavailable, the sitemap still returns the static URLs and any other dynamic groups that loaded successfully.

The sitemap only emits `lastmod` when the application has a valid content update timestamp. Static pages and records without a trustworthy modification timestamp omit it. Google ignores `priority` and `changefreq`, so the sitemap does not emit either field.

## Local And Production Verification

Run the frontend checks before deployment:

```powershell
cd frontend
npm run lint
npm test
npm run build
```

After deployment, verify the public responses from PowerShell:

```powershell
$sitemap = Invoke-WebRequest https://questesports.lk/sitemap.xml -UseBasicParsing
$sitemap.StatusCode
$sitemap.Headers["Content-Type"]
[xml]$sitemap.Content | Out-Null

$robots = Invoke-WebRequest https://questesports.lk/robots.txt -UseBasicParsing
$robots.StatusCode
$robots.Content
```

Expected results:

- both endpoints return `200`
- the sitemap content type is `application/xml`
- XML parsing succeeds
- every `<loc>` is an absolute `https://questesports.lk/...` canonical URL
- `robots.txt` contains `Sitemap: https://questesports.lk/sitemap.xml`
- private, draft, archived, redirecting, and missing URLs are absent from the sitemap

Also test crawler access explicitly:

```powershell
curl.exe -I -L -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" https://questesports.lk/sitemap.xml
```

The final response must be `200` with no login, challenge, or redirect loop.

## Google Search Console Checklist

Use the verified `questesports.lk` property.

1. Open **Indexing → Sitemaps**.
2. Submit the full URL `https://questesports.lk/sitemap.xml` once.
3. Open the submitted row and confirm the status eventually becomes **Success**.
4. Confirm **Last read** is populated and **Discovered pages** is greater than zero.
5. Use **URL inspection** on the homepage, tournament listing, and representative tournament, event-series, rulebook, and product URLs.
6. For a newly launched or materially changed priority page, use **Test live URL**, confirm the page is available to Google, and then request indexing when appropriate.
7. Review **Page indexing**, **HTTPS**, **Core Web Vitals**, **Manual actions**, and **Security issues** after deployment and periodically afterward.

Submitting a sitemap is a discovery hint, not an indexing guarantee. Do not repeatedly submit the unchanged sitemap or create cache-busting sitemap URLs.

## Handling `Couldn't fetch`

An initial `Couldn't fetch` with type **Unknown** and an empty **Last read** can be a processing delay, especially immediately after the first submission.

Use this order:

1. Open the submitted sitemap row and record the detailed error.
2. Verify the production URL returns `200`, valid XML, and `application/xml` without authentication.
3. In **URL inspection**, inspect `https://questesports.lk/sitemap.xml`, run **Test live URL**, and confirm **Page fetch: Successful**.
4. Check Vercel, DNS, firewall, WAF, and bot-protection logs for failed or challenged Google requests.
5. Wait for Google's automatic retries when the live test and external checks pass.
6. Resubmit only after fixing a persistent fetch or parsing error, or after a major sitemap change that should be processed promptly.

On July 23, 2026, the first submission displayed `Couldn't fetch`. Independent production checks returned `200`, `application/xml`, valid XML, and a successful response to a Googlebot user agent; `robots.txt` also referenced the correct sitemap. That evidence points to an initial processing delay unless Search Console later reports a more specific persistent error.

## Maintenance Rules

Update `frontend/lib/sitemap.ts`, sitemap tests, and this guide whenever a canonical public route is added, removed, renamed, redirected, or made private.

When adding a dynamic content type:

- include only published/indexable records
- emit an absolute canonical URL
- add a truthful `lastmod` only when the underlying data provides one
- isolate API failure so other sitemap groups remain available
- add canonical metadata to the destination page
- add or update a sitemap unit test

If the sitemap approaches 50,000 URLs or 50 MB uncompressed, split it into multiple sitemap files and publish a sitemap index.

## Official References

- [Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Search Console Sitemaps report](https://support.google.com/webmasters/answer/7451001?hl=en)
- [Robots.txt introduction](https://developers.google.com/search/docs/crawling-indexing/robots/intro)
- [Large sitemaps and sitemap indexes](https://developers.google.com/search/docs/crawling-indexing/sitemaps/large-sitemaps)
