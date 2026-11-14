# Royal Road Analytics

A personal Royal Road catalogue and monitoring dashboard built with React, TypeScript, Vite, and Supabase.

## Current scope
- Supabase email/password authentication
- CSV import (up to 500 novels per batch)
- Manual Royal Road public-page scraper (up to 500 URLs per batch, sequential paced requests)
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

## CSV format
Required column: `url` (or `fiction_url`).

Supported optional columns: `title`, `author`, `published_at`, `genre`, `tags`, `status`, `chapters`, `pages`, `views`, `followers`, `favorites`, `rating`, `rating_count`, `review_count`, `average_views`.

The importer accepts at most 500 rows per batch. Rows without metric values still create catalogue entries; snapshots are only created when at least one metric is provided.

## Data collection
The manual scraper fetches public Royal Road fiction pages through a Vercel server-side endpoint. It extracts only fields exposed in the returned HTML and leaves unavailable values blank. Requests are sequential and paced. HTTP 403, HTTP 429, CAPTCHA, and other access denials are respected; there is no proxy rotation, session spoofing, or access-control bypass. Royal Road may change its markup or block server-side requests, so scrape completeness is not guaranteed. CSV import remains available as a fallback. Scheduled weekly scraping is not enabled.
