# Royal Road Analytics

A personal Royal Road catalogue and monitoring dashboard built with React, TypeScript, Vite, and Supabase.

## Current scope
- Supabase email/password authentication
- CSV and JSON import (up to 500 novels per batch), including Royal Road scraper exports with `sourceUrl`
- Royal Road Latest Updates URL discovery (page-by-page) plus public fiction-page scraper (up to 500 URLs per batch, sequential paced requests)
- Scrape run/error logging and timestamped metric snapshots
- Novel catalogue and watchlist
- Append-only metric snapshots
- Import run/error logging
- Separate benchmark exclusion for *Dungeons in Denver*
- Dashboard summaries and per-novel metric history

## Setup
1. Create a Supabase project and apply the SQL migrations in `supabase/migrations`.
2. Copy `.env.example` to `.env.local` and fill in the Supabase project URL and publishable key.
3. Run `npm install`, then `npm run dev`.

## CSV / JSON format
Required URL field: `url`, `fiction_url`, or `source_url`. JSON files may be an array of records or an object containing a `novels`, `data`, or `records` array.

Supported optional columns: `title`, `author`, `published_at`, `genre`, `tags`, `status`, `chapters`, `pages`, `views`, `followers`, `favorites`, `rating`, `rating_count`, `review_count`, `average_views`, `word_count`, `overall_score`, `style_score`, `story_score`, `grammar_score`, `character_score`.

The importer accepts at most 500 rows per batch. Headers are normalized from camelCase and common Royal Road export names, including `sourceUrl`, `totalViews`, `averageViews`, `ratingsCount`, and `wordCount`. Rows without metric values still create catalogue entries; snapshots are only created when at least one supported metric is provided. Extended metrics not represented by dedicated columns are preserved in `metric_snapshots.raw_data`.

## Data collection
The scraper can extract fiction links from Royal Road's Latest Updates pages, then fetch selected public fiction pages through a Vercel server-side endpoint. You can also paste URLs manually. It extracts only fields exposed in the returned HTML and leaves unavailable values blank. Latest Updates pages are fetched one at a time; fiction-page requests are sequential and paced. HTTP 403, HTTP 429, CAPTCHA, and other access denials are respected; there is no proxy rotation, session spoofing, or access-control bypass. Royal Road may change its markup or block server-side requests, so scrape completeness is not guaranteed. CSV / JSON import remains available as a fallback. Scheduled weekly scraping is not enabled.
