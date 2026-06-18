alter table if exists public.reference_selections
  add column if not exists auto_citation_enabled boolean not null default true,
  add column if not exists auto_sources jsonb not null default '[]'::jsonb,
  add column if not exists evidence_pack jsonb,
  add column if not exists last_auto_run_at timestamptz;
