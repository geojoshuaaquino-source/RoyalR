# Data model

All application tables are in the Supabase `public` schema and use Row Level Security.

- **novels** stores one record per user and Royal Road fiction URL.
- **metric_snapshots** stores append-only observations. Historical values are not overwritten.
- **watchlist** records which novels the user wants to monitor weekly.
- **ingestion_runs** and **ingestion_run_errors** provide import audit history.
- **benchmark_exclusions** identifies novels excluded from comparison populations. The user's *Dungeons in Denver* entry is excluded by fiction ID/title in the current UI and recorded in this table on import.

Every table is scoped by `user_id`. Snapshot inserts additionally verify that the referenced novel belongs to the same user. Authenticated clients have no snapshot update or delete policy.

## Current import behavior

CSV batches are limited to 500 rows. URLs are normalized to Royal Road hosts, duplicate URLs within a batch are skipped, and each imported row with at least one metric creates a new snapshot. A row containing only catalogue metadata does not create an empty snapshot.

## Collection boundary

The application currently imports user-provided CSV data only. It does not crawl Royal Road or bypass its access controls. A future scheduled collector requires an authorized, stable data source before implementation.
