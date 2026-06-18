create table if not exists public.style_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  student_name text not null default '',
  profile_name text not null default '',
  source_file_name text,
  source_documents jsonb not null default '[]'::jsonb,
  source_text_length integer not null default 0,
  writing_level text not null default '',
  sentence_style text not null default '',
  paragraph_logic text not null default '',
  argument_style text not null default '',
  transition_style text not null default '',
  vocabulary_style text not null default '',
  avoid_content_reuse_notice text not null default '',
  editable_summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists style_profiles_user_updated_idx
  on public.style_profiles (user_id, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_style_profiles_updated_at on public.style_profiles;
create trigger set_style_profiles_updated_at
before update on public.style_profiles
for each row
execute function public.set_updated_at();

alter table public.style_profiles enable row level security;

drop policy if exists "style profiles owner can read" on public.style_profiles;
drop policy if exists "style profiles owner can insert" on public.style_profiles;
drop policy if exists "style profiles owner can update" on public.style_profiles;
drop policy if exists "style profiles owner can delete" on public.style_profiles;

create policy "style profiles owner can read"
on public.style_profiles
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "style profiles owner can insert"
on public.style_profiles
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "style profiles owner can update"
on public.style_profiles
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "style profiles owner can delete"
on public.style_profiles
for delete
to authenticated
using (user_id = (select auth.uid()));
