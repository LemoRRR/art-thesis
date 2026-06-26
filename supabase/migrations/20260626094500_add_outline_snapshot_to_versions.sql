alter table if exists public.versions
add column if not exists outline_snapshot jsonb;
