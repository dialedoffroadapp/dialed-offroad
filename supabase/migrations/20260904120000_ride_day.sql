-- Ride day (design/mockups/ride/PROMPT.md DATA; plan 4.4, 5.1, 5.2, 5.4).
-- STAGED, NOT PUSHED. Additive. Push only from feat/v3-integration.
--
-- The client is offline-first (lib/rideDay.ts outbox): every write here is
-- an idempotent upsert on a client-minted local_id, so a job can retry
-- forever without duplicating rows, and nothing in the app blocks on it.

-- ---------------------------------------------------------------------------
-- tracks: crowdsourced, no seeded global list (plan 4.4). Readable by every
-- signed-in rider (that is the point), creatable by any signed-in rider,
-- never updated/deleted from the client (merges are manual, River).
-- ---------------------------------------------------------------------------
create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat numeric not null,
  lng numeric not null,
  elevation_ft integer,
  soil_type text not null default 'unknown'
    check (soil_type in ('clay', 'loam', 'sand', 'decomposed_granite', 'mixed', 'unknown')),
  region text,
  created_by uuid references auth.users(id) on delete set null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ix_tracks_lat_lng on public.tracks (lat, lng);

alter table public.tracks enable row level security;
drop policy if exists "tracks_read_authenticated" on public.tracks;
create policy "tracks_read_authenticated" on public.tracks
  for select to authenticated using (true);
drop policy if exists "tracks_insert_own" on public.tracks;
create policy "tracks_insert_own" on public.tracks
  for insert to authenticated with check (created_by = auth.uid());
revoke all on public.tracks from anon, authenticated;
grant select, insert on public.tracks to authenticated;

-- Haversine match, plain SQL (no PostGIS). rider_count = distinct riders
-- with a ride day at the track ("ridden by N others").
create or replace function public.match_tracks(p_lat numeric, p_lng numeric, p_radius_m integer default 2000)
returns table (id uuid, name text, distance_m integer, verified boolean, rider_count integer)
language sql
security invoker
stable
set search_path = public
as $$
  with d as (
    select t.id, t.name, t.verified,
      (2 * 6371000 * asin(sqrt(
        power(sin(radians(t.lat - p_lat) / 2), 2) +
        cos(radians(p_lat)) * cos(radians(t.lat)) *
        power(sin(radians(t.lng - p_lng) / 2), 2)
      )))::integer as distance_m
    from public.tracks t
  )
  select d.id, d.name, d.distance_m, d.verified,
    (select count(distinct r.user_id) from public.ride_days r where r.track_id = d.id)::integer as rider_count
  from d
  where d.distance_m <= p_radius_m
  order by d.distance_m
  limit 5;
$$;
revoke execute on function public.match_tracks(numeric, numeric, integer) from public, anon;
grant execute on function public.match_tracks(numeric, numeric, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- ride_days (plan 5.2 + PROMPT: conditions on the ride day; setup_id;
-- local_id for idempotent offline upserts)
-- ---------------------------------------------------------------------------
create table if not exists public.ride_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bike_id uuid references public.bikes(id) on delete set null,
  setup_id uuid references public.bike_setups(id) on delete set null,
  track_id uuid references public.tracks(id) on delete set null,
  track_name_raw text,
  rode_on date not null default current_date,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  conditions jsonb,
  hours_added numeric(6,2),
  starting_version_id uuid references public.setup_versions(id) on delete set null,
  ending_version_id uuid references public.setup_versions(id) on delete set null,
  local_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, local_id)
);
create index if not exists ix_ride_days_user_started on public.ride_days (user_id, started_at desc);
create index if not exists ix_ride_days_track on public.ride_days (track_id);

alter table public.ride_days enable row level security;
drop policy if exists "ride_days_own_select" on public.ride_days;
create policy "ride_days_own_select" on public.ride_days for select to authenticated using (auth.uid() = user_id);
drop policy if exists "ride_days_own_insert" on public.ride_days;
create policy "ride_days_own_insert" on public.ride_days for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "ride_days_own_update" on public.ride_days;
create policy "ride_days_own_update" on public.ride_days for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.ride_days from anon, authenticated;
grant select, insert, update on public.ride_days to authenticated;

-- ---------------------------------------------------------------------------
-- track_sessions: one row per logged moto (PROMPT §7): sentiment, symptoms
-- [{id, qualifier}], moto_number, effective values snapshot.
-- ---------------------------------------------------------------------------
create table if not exists public.track_sessions (
  id uuid primary key default gen_random_uuid(),
  ride_day_id uuid not null references public.ride_days(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bike_id uuid references public.bikes(id) on delete set null,
  setup_version_id uuid references public.setup_versions(id) on delete set null,
  moto_number integer not null,
  sentiment text check (sentiment in ('better', 'same', 'worse')),
  symptoms jsonb not null default '[]'::jsonb,
  effective_values jsonb,
  note text,
  logged_at timestamptz not null default now(),
  local_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, local_id)
);
create index if not exists ix_track_sessions_ride_day on public.track_sessions (ride_day_id, moto_number);

alter table public.track_sessions enable row level security;
drop policy if exists "track_sessions_own_select" on public.track_sessions;
create policy "track_sessions_own_select" on public.track_sessions for select to authenticated using (auth.uid() = user_id);
drop policy if exists "track_sessions_own_insert" on public.track_sessions;
create policy "track_sessions_own_insert" on public.track_sessions for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "track_sessions_own_update" on public.track_sessions;
create policy "track_sessions_own_update" on public.track_sessions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.track_sessions from anon, authenticated;
grant select, insert, update on public.track_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- setup_versions.ride_day_id (plan 5.4): the settled manual version points
-- at the day that produced it. bikes.hours_updated_at (plan 5.2).
-- ---------------------------------------------------------------------------
alter table public.setup_versions
  add column if not exists ride_day_id uuid references public.ride_days(id) on delete set null;
create index if not exists ix_setup_versions_ride_day on public.setup_versions (ride_day_id);

alter table public.bikes
  add column if not exists hours_updated_at timestamptz;
