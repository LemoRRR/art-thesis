create table if not exists public.versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  description text not null default '',
  sections_snapshot jsonb not null default '[]'::jsonb,
  outline_snapshot jsonb,
  created_at timestamptz not null default now()
);

alter table public.versions enable row level security;

drop policy if exists "versions owner select" on public.versions;
drop policy if exists "versions owner insert" on public.versions;
drop policy if exists "versions owner delete" on public.versions;

create policy "versions owner select"
on public.versions
for select
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = versions.project_id
      and projects.user_id = auth.uid()
  )
);

create policy "versions owner insert"
on public.versions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.projects
    where projects.id = versions.project_id
      and projects.user_id = auth.uid()
  )
);

create policy "versions owner delete"
on public.versions
for delete
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = versions.project_id
      and projects.user_id = auth.uid()
  )
);

create index if not exists versions_project_created_idx
on public.versions(project_id, created_at desc);

create table if not exists public.research_packages (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_id text,
  title text not null default '',
  package_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.research_packages enable row level security;

drop policy if exists "research packages owner select" on public.research_packages;
drop policy if exists "research packages owner insert" on public.research_packages;
drop policy if exists "research packages owner update" on public.research_packages;
drop policy if exists "research packages owner delete" on public.research_packages;

create policy "research packages owner select"
on public.research_packages
for select
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = research_packages.project_id
      and projects.user_id = auth.uid()
  )
);

create policy "research packages owner insert"
on public.research_packages
for insert
to authenticated
with check (
  exists (
    select 1
    from public.projects
    where projects.id = research_packages.project_id
      and projects.user_id = auth.uid()
  )
);

create policy "research packages owner update"
on public.research_packages
for update
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = research_packages.project_id
      and projects.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.projects
    where projects.id = research_packages.project_id
      and projects.user_id = auth.uid()
  )
);

create policy "research packages owner delete"
on public.research_packages
for delete
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = research_packages.project_id
      and projects.user_id = auth.uid()
  )
);

create index if not exists research_packages_project_updated_idx
on public.research_packages(project_id, updated_at desc);
