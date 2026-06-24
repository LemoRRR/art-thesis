drop policy if exists "projects owner insert" on public.projects;
drop policy if exists "projects owner update check" on public.projects;
drop policy if exists "chat owner insert" on public.chat_messages;
drop policy if exists "chat owner delete" on public.chat_messages;
drop policy if exists "sections owner insert" on public.sections;
drop policy if exists "sections owner update check" on public.sections;
drop policy if exists "sections owner delete" on public.sections;
drop policy if exists "reference selections owner insert" on public.reference_selections;
drop policy if exists "reference selections owner update check" on public.reference_selections;
drop policy if exists "reference selections owner delete" on public.reference_selections;

create policy "projects owner insert"
on public.projects
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "projects owner update check"
on public.projects
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "chat owner insert"
on public.chat_messages
for insert
to authenticated
with check (
  exists (
    select 1
    from public.projects
    where projects.id = chat_messages.project_id
      and projects.user_id = auth.uid()
  )
);

create policy "chat owner delete"
on public.chat_messages
for delete
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = chat_messages.project_id
      and projects.user_id = auth.uid()
  )
);

create policy "sections owner insert"
on public.sections
for insert
to authenticated
with check (
  exists (
    select 1
    from public.projects
    where projects.id = sections.project_id
      and projects.user_id = auth.uid()
  )
);

create policy "sections owner update check"
on public.sections
for update
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = sections.project_id
      and projects.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.projects
    where projects.id = sections.project_id
      and projects.user_id = auth.uid()
  )
);

create policy "sections owner delete"
on public.sections
for delete
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = sections.project_id
      and projects.user_id = auth.uid()
  )
);

create policy "reference selections owner insert"
on public.reference_selections
for insert
to authenticated
with check (
  exists (
    select 1
    from public.projects
    where projects.id = reference_selections.project_id
      and projects.user_id = auth.uid()
  )
);

create policy "reference selections owner update check"
on public.reference_selections
for update
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = reference_selections.project_id
      and projects.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.projects
    where projects.id = reference_selections.project_id
      and projects.user_id = auth.uid()
  )
);

create policy "reference selections owner delete"
on public.reference_selections
for delete
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = reference_selections.project_id
      and projects.user_id = auth.uid()
  )
);

