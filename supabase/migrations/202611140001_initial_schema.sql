-- Royal Road Analytics schema (already applied to project kwtxsntvvluyridfqdkn)
create extension if not exists pgcrypto;

create table public.novels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id text,
  fiction_url text not null,
  title text not null,
  author_name text,
  published_at date,
  tags text[] not null default '{}',
  genre text,
  publication_status text,
  chapter_count integer check (chapter_count is null or chapter_count >= 0),
  page_count integer check (page_count is null or page_count >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint novels_user_url_unique unique (user_id, fiction_url),
  constraint novels_user_source_id_unique unique (user_id, source_id)
);
create index novels_user_title_idx on public.novels (user_id, lower(title));
create index novels_user_published_idx on public.novels (user_id, published_at);

create table public.metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  novel_id uuid not null references public.novels(id) on delete cascade,
  captured_at timestamptz not null default now(),
  source_type text not null default 'manual',
  source_reference text,
  views bigint check (views is null or views >= 0),
  followers bigint check (followers is null or followers >= 0),
  favorites bigint check (favorites is null or favorites >= 0),
  rating numeric(5,3) check (rating is null or (rating >= 0 and rating <= 5)),
  rating_count integer check (rating_count is null or rating_count >= 0),
  review_count integer check (review_count is null or review_count >= 0),
  pages integer check (pages is null or pages >= 0),
  chapters integer check (chapters is null or chapters >= 0),
  average_views numeric(14,2) check (average_views is null or average_views >= 0),
  collection_status text not null default 'success' check (collection_status in ('success', 'partial', 'failed')),
  missing_fields text[] not null default '{}',
  raw_data jsonb,
  created_at timestamptz not null default now()
);
create index metric_snapshots_user_novel_captured_idx on public.metric_snapshots (user_id, novel_id, captured_at desc);
create index metric_snapshots_novel_id_idx on public.metric_snapshots (novel_id);

create table public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  novel_id uuid not null references public.novels(id) on delete cascade,
  enabled boolean not null default true,
  cadence text not null default 'weekly' check (cadence in ('manual', 'weekly')),
  notes text,
  added_at timestamptz not null default now(),
  constraint watchlist_one_entry_per_novel unique (user_id, novel_id)
);
create index watchlist_active_idx on public.watchlist (user_id, enabled) where enabled = true;
create index watchlist_novel_id_idx on public.watchlist (novel_id);

create table public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null default 'csv_import',
  source_label text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_seen integer not null default 0 check (records_seen >= 0),
  records_created integer not null default 0 check (records_created >= 0),
  records_updated integer not null default 0 check (records_updated >= 0),
  records_skipped integer not null default 0 check (records_skipped >= 0),
  failures integer not null default 0 check (failures >= 0),
  run_status text not null default 'running' check (run_status in ('running', 'completed', 'completed_with_errors', 'failed'))
);
create index ingestion_runs_user_started_idx on public.ingestion_runs (user_id, started_at desc);

create table public.ingestion_run_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null references public.ingestion_runs(id) on delete cascade,
  row_number integer,
  fiction_url text,
  error_code text,
  error_message text not null,
  raw_row jsonb,
  created_at timestamptz not null default now()
);
create index ingestion_run_errors_run_idx on public.ingestion_run_errors (user_id, run_id);
create index ingestion_run_errors_run_id_idx on public.ingestion_run_errors (run_id);

create table public.benchmark_exclusions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  novel_id uuid not null references public.novels(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  constraint benchmark_exclusions_one_entry unique (user_id, novel_id)
);
create index benchmark_exclusions_novel_id_idx on public.benchmark_exclusions (novel_id);

alter table public.novels enable row level security;
alter table public.metric_snapshots enable row level security;
alter table public.watchlist enable row level security;
alter table public.ingestion_runs enable row level security;
alter table public.ingestion_run_errors enable row level security;
alter table public.benchmark_exclusions enable row level security;

create policy "Users manage their own novels" on public.novels for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Users read their own snapshots" on public.metric_snapshots for select to authenticated
using ((select auth.uid()) = user_id);
create policy "Users insert their own snapshots" on public.metric_snapshots for insert to authenticated
with check ((select auth.uid()) = user_id and exists (
  select 1 from public.novels n where n.id = novel_id and n.user_id = (select auth.uid())
));

create policy "Users manage their own watchlist" on public.watchlist for all to authenticated
using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.novels n where n.id = novel_id and n.user_id = (select auth.uid())
  )
);
create policy "Users manage their own ingestion runs" on public.ingestion_runs for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users manage their own ingestion errors" on public.ingestion_run_errors for all to authenticated
using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.ingestion_runs r where r.id = run_id and r.user_id = (select auth.uid())
  )
);
create policy "Users manage their own benchmark exclusions" on public.benchmark_exclusions for all to authenticated
using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.novels n where n.id = novel_id and n.user_id = (select auth.uid())
  )
);

grant select, insert, update, delete on public.novels to authenticated;
grant select, insert on public.metric_snapshots to authenticated;
grant select, insert, update, delete on public.watchlist to authenticated;
grant select, insert, update, delete on public.ingestion_runs to authenticated;
grant select, insert, update, delete on public.ingestion_run_errors to authenticated;
grant select, insert, update, delete on public.benchmark_exclusions to authenticated;
