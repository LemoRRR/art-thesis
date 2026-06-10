-- Allow signed-in users to manage files under their own user-id prefix in
-- the private library-files bucket.
--
-- The app uploads files as:
--   <auth.uid()>/<random-id>.<ext>
--
-- Supabase Storage stores object metadata in storage.objects, so uploads need
-- explicit RLS policies on that table even when the user is already logged in.

insert into storage.buckets (id, name, public)
values ('library-files', 'library-files', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "library files owner can read" on storage.objects;
drop policy if exists "library files owner can upload" on storage.objects;
drop policy if exists "library files owner can update" on storage.objects;
drop policy if exists "library files owner can delete" on storage.objects;

create policy "library files owner can read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'library-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "library files owner can upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'library-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "library files owner can update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'library-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'library-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "library files owner can delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'library-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
