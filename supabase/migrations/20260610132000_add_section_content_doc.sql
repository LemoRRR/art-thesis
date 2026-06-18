alter table public.sections
  add column if not exists content_doc jsonb;
