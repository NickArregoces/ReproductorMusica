-- OBLIGATORIO: Supabase → SQL Editor → New query → Pegar todo → Run
-- Sin esto no se pueden subir ni listar canciones.

create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  file_path text not null unique,
  artist text not null default 'Artista desconocido',
  song text not null default 'Sin título',
  created_at timestamptz not null default now()
);

alter table public.tracks enable row level security;

drop policy if exists "tracks_select_anon" on public.tracks;
create policy "tracks_select_anon"
  on public.tracks for select
  to anon
  using (true);

drop policy if exists "tracks_insert_anon" on public.tracks;
create policy "tracks_insert_anon"
  on public.tracks for insert
  to anon
  with check (true);

drop policy if exists "song_public_read" on storage.objects;
create policy "song_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'song');

drop policy if exists "song_public_insert" on storage.objects;
create policy "song_public_insert"
  on storage.objects for insert
  to public
  with check (bucket_id = 'song');

grant usage on schema public to anon, authenticated;
grant select, insert on public.tracks to anon, authenticated;
