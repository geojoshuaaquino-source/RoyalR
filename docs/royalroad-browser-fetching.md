# RoyalR: Royal Road browser-fetching process

## Scope

RoyalR uses a normal Chromium browser runtime to retrieve public Royal Road pages. This is a compatibility test, not an anti-bot bypass. The implementation does not alter browser fingerprints, spoof TLS ClientHello values, inject stealth patches, rotate proxies, solve CAPTCHAs, or forge challenge cookies.

## Request flow

1. The API endpoint validates the user's Supabase bearer token.
2. For Latest Updates, it builds the requested Royal Road URL. For a fiction scrape, it validates that the URL belongs to `royalroad.com` or `www.royalroad.com` and matches a `/fiction/{id}` path.
3. `fetchRoyalRoadPage()` launches Chromium using `@sparticuz/chromium` and `puppeteer-core`.
4. Chromium navigates to the requested page with normal browser networking, TLS, redirects, and JavaScript execution. The navigation waits for `domcontentloaded` and has a six-second navigation timeout.
5. The API reads the final rendered DOM using `page.content()`, then closes Chromium in a `finally` block.
6. Existing extraction logic parses the returned HTML for fiction links, metadata, and supported metrics.
7. If the response or rendered page indicates a Cloudflare or Anubis challenge, RoyalR reports the detected status and stops. It does not attempt to solve the challenge.

## What this changes

- The outbound request is made by Chromium's own network/TLS stack instead of Node's built-in `fetch`.
- Browser JavaScript runs before the DOM is extracted.
- Normal redirects and page navigation are handled by Chromium.
- The scraper still runs server-side on Vercel; this is not a browser session opened on the user's phone.
- Each scrape launches and closes a fresh browser instance. No persistent browser profile or user login session is reused.

## Test procedure

1. Deploy the current `main` branch to Vercel.
2. Sign in to RoyalR.
3. Run Latest Updates discovery once.
4. Record the result: success, ordinary HTTP error, timeout, or challenge detection.
5. If blocked, inspect Vercel runtime logs for the corresponding `RoyalR ... browser challenge detected` or `... fetch blocked` entry.
6. Compare the returned status and safe diagnostic headers. Do not infer that every HTTP 403 is Cloudflare; an unclassified 403 may come from the origin or another intermediary.
7. If Chromium succeeds, verify that extracted fiction URLs and titles are correct before relying on the scraper.
8. If Chromium receives a challenge, stop automated fetching and pursue an authorized API/feed, written permission, or site-owner allowlisting.

## Known limitations

- A READY Vercel deployment confirms that the build completed; it does not prove Royal Road will serve the requested content.
- Headless Chromium can still be identified as automation. Using Chromium does not guarantee access.
- The six-second navigation timeout may be too short for slow responses and may need adjustment based on measured results and the Vercel function's execution limits.
- The parser is still HTML-structure-dependent. A readable page can still produce missing or inaccurate fields if Royal Road changes its markup.
- No live authenticated Royal Road scrape has yet been confirmed by this document.

## Why fingerprint evasion is excluded

Cloudflare documents multiple bot-detection layers, including heuristics, JavaScript detections, and TLS fingerprints. Anubis documents a proof-of-work challenge and a signed authorization cookie after a successful challenge. Reproducing ordinary browser networking is different from spoofing signals or forging challenge state to defeat those controls.

References:
- Cloudflare bot detection engines: https://developers.cloudflare.com/bots/concepts/bot-detection-engines/
- Cloudflare JA3/JA4 fingerprints: https://developers.cloudflare.com/bots/additional-configurations/ja3-ja4-fingerprint/
- Cloudflare challenge behavior: https://developers.cloudflare.com/cloudflare-challenges/concepts/how-challenges-work/
- Anubis design: https://github.com/TecharoHQ/anubis/blob/main/docs/docs/design/how-anubis-works.mdx
