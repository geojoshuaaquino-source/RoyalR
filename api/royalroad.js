import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const allowedHost = (hostname) => hostname === "royalroad.com" || hostname === "www.royalroad.com";

function decode(value = "") {
  return value
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function cleanText(html = "") {
  return decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function meta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp("<meta[^>]+(?:property|name)=[\\\"']" + escaped + "[\\\"'][^>]+content=[\\\"']([^\\\"']*)", "i"),
    new RegExp("<meta[^>]+content=[\\\"']([^\\\"']*)[\\\"'][^>]+(?:property|name)=[\\\"']" + escaped + "[\\\"']", "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decode(match[1]);
  }
  return null;
}

function jsonLd(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script[1]);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      const found = entries.find(x => x && (x["@type"] === "Book" || x["@type"] === "CreativeWork" || x.name));
      if (found) return found;
    } catch {}
  }
  return {};
}

function extractMetric(text, labels) {
  for (const label of labels) {
    const re = new RegExp("\\b" + label + "\\b\\s*[:\\-]?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)", "i");
    const match = text.match(re);
    if (match) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function responseDiagnostics(response, body = "") {
  const headers = {};
  for (const name of ["server", "cf-ray", "cf-mitigated", "content-type", "location", "retry-after"]) {
    const value = response.headers.get(name);
    if (value) headers[name] = value.slice(0, 200);
  }
  const sample = body.slice(0, 12000).toLowerCase();
  let protection = "none_detected";
  if (response.headers.get("cf-mitigated") === "challenge") protection = "cloudflare_challenge";
  else if (sample.includes("anubis") || sample.includes("techaro.lol-anubis-auth")) protection = "anubis_challenge";
  else if (response.status === 403) protection = "unclassified_403";
  else if (response.status === 429) protection = "rate_limited";
  return { protection, headers };
}


async function fetchRoyalRoadPage(targetUrl) {
  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(6000);
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    const response = await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 6000,
    });
    if (!response) throw new Error("Chromium received no main-document response.");
    const headers = response.headers();
    const html = await page.content();
    return {
      status: response.status(),
      headers: { get: name => headers[String(name).toLowerCase()] || null },
      html,
      finalUrl: page.url(),
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function isChallengePage(response, html = "") {
  const sample = html.slice(0, 30000).toLowerCase();
  return response.headers.get("cf-mitigated") === "challenge" ||
    sample.includes("challenge-platform") ||
    sample.includes("cf-chl-") ||
    sample.includes("techaro.lol-anubis-auth") ||
    sample.includes("anubis challenge") ||
    sample.includes("just a moment...");
}

function fictionId(url) {
  return url.match(/\/fiction\/(\d+)/i)?.[1] || null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !supabaseUrl || !publishableKey) {
    return res.status(401).json({ error: "Sign in is required to use the scraper." });
  }
  try {
    const authCheck = await fetch(supabaseUrl.replace(/\/$/, "") + "/auth/v1/user", {
      headers: { "apikey": publishableKey, "Authorization": "Bearer " + token },
      signal: AbortSignal.timeout(5000),
    });
    if (!authCheck.ok) return res.status(401).json({ error: "Your session is invalid or expired. Sign in again." });
  } catch {
    return res.status(503).json({ error: "Could not verify your session with Supabase." });
  }

  if (req.body?.mode === "discover_latest_updates") {
    const requestedPage = Number(req.body?.page || 1);
    const page = Number.isInteger(requestedPage) ? Math.min(20, Math.max(1, requestedPage)) : 1;
    const latestUrl = new URL("https://www.royalroad.com/fictions/latest-updates");
    if (page > 1) latestUrl.searchParams.set("page", String(page));
    try {
      const response = await fetchRoyalRoadPage(latestUrl.toString());
      const html = response.html;
      if (response.status === 403 || response.status === 429) {
        const diagnostics = responseDiagnostics(response, html);
        console.info("RoyalR Latest Updates fetch blocked", { status: response.status, ...diagnostics });
        return res.status(200).json({ ok: false, status: response.status, diagnostics, error: response.status === 403
          ? "Royal Road denied the Latest Updates request (HTTP 403). See diagnostics for the identified protection layer."
          : "Royal Road rate-limited the Latest Updates request (HTTP 429). Wait before trying again." });
      }
      if (!response.ok) return res.status(200).json({ ok: false, status: response.status, error: "Royal Road returned HTTP " + response.status + " for Latest Updates." });
      if (isChallengePage(response, html)) {
        const diagnostics = responseDiagnostics(response, html);
        console.info("RoyalR Latest Updates browser challenge detected", { status: response.status, ...diagnostics });
        return res.status(200).json({ ok: false, status: response.status, diagnostics, error: "Royal Road returned an anti-bot challenge. RoyalR stops here and does not attempt to solve or bypass it." });
      }
      if (!html || /captcha|verify you are human|access denied/i.test(cleanText(html).slice(0, 1200))) {
        return res.status(200).json({ ok: false, error: "Royal Road did not return a readable Latest Updates page." });
      }
      const found = new Map();
      for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']*\/fiction\/\d+(?:\/[^"'?#]*)?(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        let fictionUrl;
        try {
          fictionUrl = new URL(decode(match[1]), "https://www.royalroad.com");
        } catch { continue; }
        if (!allowedHost(fictionUrl.hostname) || !/^\/fiction\/\d+(?:\/|$)/i.test(fictionUrl.pathname)) continue;
        fictionUrl.search = "";
        fictionUrl.hash = "";
        const canonical = "https://www.royalroad.com" + fictionUrl.pathname;
        const title = cleanText(match[2]).trim();
        if (!found.has(canonical)) found.set(canonical, { url: canonical, title: title || null });
      }
      return res.status(200).json({ ok: true, page, source_url: latestUrl.toString(), fictions: [...found.values()] });
    } catch (error) {
      const message = error?.name === "TimeoutError" ? "Chromium navigation timed out after 6 seconds." : "Could not fetch Latest Updates: " + (error?.message || "unknown network error");
      return res.status(200).json({ ok: false, error: message });
    }
  }

  const rawUrl = typeof req.body?.url === "string" ? req.body.url : "";
  let url;
  try { url = new URL(rawUrl); } catch { return res.status(400).json({ error: "Invalid URL." }); }
  if (!allowedHost(url.hostname) || !/^\/fiction\/\d+(?:\/|$)/i.test(url.pathname)) {
    return res.status(400).json({ error: "Only Royal Road fiction URLs are supported." });
  }
  url.search = "";
  url.hash = "";
  try {
    const response = await fetchRoyalRoadPage(url.toString());
    const html = response.html;
    if (response.status === 403 || response.status === 429) {
      const diagnostics = responseDiagnostics(response, html);
      console.info("RoyalR fiction fetch blocked", { status: response.status, url: url.toString(), ...diagnostics });
      return res.status(200).json({
        ok: false, url: url.toString(), status: response.status, diagnostics,
        error: response.status === 403
          ? "Royal Road denied this request (HTTP 403). See diagnostics for the identified protection layer."
          : "Royal Road rate-limited this request (HTTP 429). Wait before trying again.",
      });
    }
    if (!response.ok) return res.status(200).json({ ok: false, url: url.toString(), status: response.status, error: "Royal Road returned HTTP " + response.status + "." });
    if (isChallengePage(response, html)) {
      const diagnostics = responseDiagnostics(response, html);
      console.info("RoyalR fiction browser challenge detected", { status: response.status, url: url.toString(), ...diagnostics });
      return res.status(200).json({ ok: false, url: url.toString(), status: response.status, diagnostics, error: "Royal Road returned an anti-bot challenge. RoyalR stops here and does not attempt to solve or bypass it." });
    }
    if (!html || /captcha|verify you are human|access denied/i.test(cleanText(html).slice(0, 1200))) {
      return res.status(200).json({ ok: false, url: url.toString(), error: "Royal Road did not return a readable fiction page." });
    }
    const ld = jsonLd(html);
    const text = cleanText(html);
    const title = meta(html, "og:title") || ld.name || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)[1]) : null);
    const author = typeof ld.author === "string" ? ld.author : ld.author?.name || null;
    const description = meta(html, "og:description") || ld.description || null;
    const published = ld.datePublished || meta(html, "article:published_time") || null;
    const tags = Array.isArray(ld.genre) ? ld.genre : (ld.genre ? [ld.genre] : []);
    const metrics = {
      views: extractMetric(text, ["Views", "Total Views"]),
      followers: extractMetric(text, ["Followers", "Follows"]),
      favorites: extractMetric(text, ["Favorites", "Favourites"]),
      rating: extractMetric(text, ["Rating", "Overall Rating"]),
      rating_count: extractMetric(text, ["Ratings", "Rating Count"]),
      review_count: extractMetric(text, ["Reviews", "Review Count"]),
      chapters: extractMetric(text, ["Chapters", "Chapter Count"]),
      pages: null,
      average_views: null,
    };
    const chapterMatch = text.match(/(Ongoing|Completed|Hiatus|Dropped|Stub)[\s|,]+(?:[\d,.]+\s*)?Chapters?/i);
    const status = chapterMatch?.[1] || null;
    const hasMetrics = Object.values(metrics).some(value => value !== null);
    return res.status(200).json({
      ok: true,
      novel: {
        fiction_url: url.toString(), source_id: fictionId(url.toString()),
        title: title?.replace(/\s*\|\s*Royal Road\s*$/i, "").trim() || "Untitled Royal Road fiction",
        author_name: author, description, published_at: published ? published.slice(0, 10) : null,
        tags, genre: tags[0] || null, publication_status: status,
        chapter_count: metrics.chapters, page_count: null,
      },
      metrics: hasMetrics ? metrics : null,
      note: hasMetrics ? null : "The page was readable, but no supported metric fields were detected. Novel metadata can still be saved.",
    });
  } catch (error) {
    const message = error?.name === "TimeoutError" ? "Chromium navigation timed out after 6 seconds." : "Could not fetch the Royal Road page: " + (error?.message || "unknown network error");
    return res.status(200).json({ ok: false, url: url.toString(), error: message });
  }
}
