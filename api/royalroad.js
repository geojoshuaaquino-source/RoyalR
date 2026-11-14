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
    new RegExp('<meta[^>]+(?:property|name)=["\\']' + escaped + '["\\'][^>]+content=["\\']([^"\\']*)', "i"),
    new RegExp('<meta[^>]+content=["\\']([^"\\']*)["\\'][^>]+(?:property|name)=["\\']' + escaped + '["\\']', "i"),
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
    const re = new RegExp(label + "[^0-9]{0,45}([0-9][0-9,]*(?:\\.[0-9]+)?)", "i");
    const match = text.match(re);
    if (match) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function fictionId(url) {
  return url.match(/\/fiction\/(\d+)/i)?.[1] || null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const rawUrl = typeof req.body?.url === "string" ? req.body.url : "";
  let url;
  try { url = new URL(rawUrl); } catch { return res.status(400).json({ error: "Invalid URL." }); }
  if (!allowedHost(url.hostname) || !/^\/fiction\/\d+(?:\/|$)/i.test(url.pathname)) {
    return res.status(400).json({ error: "Only Royal Road fiction URLs are supported." });
  }
  url.search = "";
  url.hash = "";
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "Accept": "text/html,application/xhtml+xml", "User-Agent": "RoyalRAnalytics/1.0 (user-initiated public page fetch)" },
      redirect: "follow",
      signal: AbortSignal.timeout(9000),
    });
    if (response.status === 403 || response.status === 429) {
      return res.status(200).json({
        ok: false, url: url.toString(), status: response.status,
        error: response.status === 403
          ? "Royal Road denied this request (HTTP 403). No access-control bypass is attempted."
          : "Royal Road rate-limited this request (HTTP 429). Wait before trying again.",
      });
    }
    if (!response.ok) return res.status(200).json({ ok: false, url: url.toString(), status: response.status, error: "Royal Road returned HTTP " + response.status + "." });
    const html = await response.text();
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
    const message = error?.name === "TimeoutError" ? "Royal Road did not respond before the 9-second timeout." : "Could not fetch the Royal Road page: " + (error?.message || "unknown network error");
    return res.status(200).json({ ok: false, url: url.toString(), error: message });
  }
}
