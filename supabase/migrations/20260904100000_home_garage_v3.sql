-- Home + Garage v3 data (feat/home-garage-v3, design/mockups/PROMPT.md DATA
-- section). STAGED, NOT PUSHED. Push only from a branch whose migrations
-- folder is a superset of prod (CLAUDE.md rule); this branch is cut off
-- release/v2.4.0 (through 20260807150000). Additive throughout.
--
-- The client reads every new column in its OWN query wrapped fail-open
-- (lib/bikeExtras.ts, lib/seasonGoals.ts, lib/nextRide.ts), so the v3 screens
-- work on the device cache before this lands and nothing breaks if it never
-- does — only the server mirror is missing.

-- ---------------------------------------------------------------------------
-- bikes: hours, tires, spring rates, photo, maintenance interval
-- (table-level grants cover new columns automatically)
-- ---------------------------------------------------------------------------
alter table public.bikes
  add column if not exists hours numeric(7,1),
  add column if not exists tire_front_psi numeric(4,1),
  add column if not exists tire_rear_psi numeric(4,1),
  add column if not exists fork_spring_rate numeric(6,2),
  add column if not exists shock_spring_rate numeric(6,2),
  add column if not exists photo_path text,
  add column if not exists maintenance_interval_hours numeric(5,1),
  add column if not exists last_service_hours numeric(7,1);

comment on column public.bikes.hours is 'Rider-entered engine hours (v3 Garage tile). Ride-day elapsed time feeds it later.';
comment on column public.bikes.fork_spring_rate is 'Coil fork spring rate N/mm (rider-entered). Air forks use setup_versions.fork_air_bar instead.';
comment on column public.bikes.shock_spring_rate is 'Shock spring rate N/mm (rider-entered).';
comment on column public.bikes.photo_path is 'storage object path in bucket bike-photos: <user_id>/<bike_id>/<ts>.<ext>';
comment on column public.bikes.maintenance_interval_hours is 'Oil interval override; null = app default (15 h).';
comment on column public.bikes.last_service_hours is 'Engine hours at the last oil change; null = never recorded.';

-- ---------------------------------------------------------------------------
-- bike_models: click ranges. The existing fork_comp_max / fork_reb_max /
-- shock_comp_max / shock_reb_max columns hold the seed default 30 on all 116
-- rows (verified 2026-09-04: one distinct tuple), so "non-null" cannot mean
-- "known". click_range_verified is the honest signal: the setup sheet's range
-- bar renders only when it is true. shock_hsc_turns_max is new (nullable).
-- Stock values stay unused in the UI.
-- ---------------------------------------------------------------------------
alter table public.bike_models
  add column if not exists click_range_verified boolean not null default false,
  add column if not exists shock_hsc_turns_max numeric(4,2);

comment on column public.bike_models.click_range_verified is 'True once fork_comp_max/fork_reb_max/shock_comp_max/shock_reb_max (+ shock_hsc_turns_max) were confirmed against the manual. Range bars render only when true.';

-- ---------------------------------------------------------------------------
-- profiles.next_ride_date (column-level grants on profiles: explicit)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists next_ride_date date;

grant select (next_ride_date), insert (next_ride_date), update (next_ride_date)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- season_goals: one rider-set goal per season (calendar year for now)
-- ---------------------------------------------------------------------------
create table if not exists public.season_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  season_year integer not null,
  goal_type text not null check (goal_type in ('ride_days', 'engine_hours', 'race')),
  target numeric(7,1),
  race_name text,
  race_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, season_year)
);

alter table public.season_goals enable row level security;

drop policy if exists "season_goals_own_select" on public.season_goals;
create policy "season_goals_own_select" on public.season_goals
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "season_goals_own_insert" on public.season_goals;
create policy "season_goals_own_insert" on public.season_goals
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "season_goals_own_update" on public.season_goals;
create policy "season_goals_own_update" on public.season_goals
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "season_goals_own_delete" on public.season_goals;
create policy "season_goals_own_delete" on public.season_goals
  for delete to authenticated using (auth.uid() = user_id);

revoke all on public.season_goals from anon, authenticated;
grant select, insert, update, delete on public.season_goals to authenticated;

-- ---------------------------------------------------------------------------
-- bike_setups: named setups per bike (plan 4.10 / RIVER-D 4 foundation).
-- setup_versions.setup_id null = the bike's default setup (every row today).
-- One running setup per bike, switching explicit (partial unique index).
-- Version numbers scope per (bike, setup) from here on — today's rows keep
-- their numbers (setup_id null is one scope).
-- ---------------------------------------------------------------------------
create table if not exists public.bike_setups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bike_id uuid not null references public.bikes(id) on delete cascade,
  name text not null,
  terrain text,
  is_running boolean not null default false,
  created_from_version_id uuid references public.setup_versions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_bike_setups_one_running
  on public.bike_setups (bike_id) where is_running;
create index if not exists ix_bike_setups_bike on public.bike_setups (bike_id);

alter table public.bike_setups enable row level security;
drop policy if exists "bike_setups_own_select" on public.bike_setups;
create policy "bike_setups_own_select" on public.bike_setups
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "bike_setups_own_insert" on public.bike_setups;
create policy "bike_setups_own_insert" on public.bike_setups
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "bike_setups_own_update" on public.bike_setups;
create policy "bike_setups_own_update" on public.bike_setups
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "bike_setups_own_delete" on public.bike_setups;
create policy "bike_setups_own_delete" on public.bike_setups
  for delete to authenticated using (auth.uid() = user_id);
revoke all on public.bike_setups from anon, authenticated;
grant select, insert, update, delete on public.bike_setups to authenticated;

alter table public.setup_versions
  add column if not exists setup_id uuid references public.bike_setups(id) on delete set null;
create index if not exists ix_setup_versions_setup on public.setup_versions (setup_id);

-- Per-setup version numbering. Same function, one more scope term; the
-- delta trigger (assign_setup_version_delta) is untouched.
create or replace function public.assign_setup_version_number()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.version_number is null then
    select coalesce(max(v.version_number), 0) + 1
      into new.version_number
      from public.setup_versions v
     where v.user_id = new.user_id
       and v.bike_id is not distinct from new.bike_id
       and v.setup_id is not distinct from new.setup_id;
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- storage: bike-photos bucket, same access shape as avatars
-- (public read; owners write under their own uid folder)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('bike-photos', 'bike-photos', true)
on conflict (id) do nothing;

drop policy if exists "bike-photos public read" on storage.objects;
create policy "bike-photos public read" on storage.objects
  for select to public using (bucket_id = 'bike-photos');
drop policy if exists "bike-photos own insert" on storage.objects;
create policy "bike-photos own insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'bike-photos' and (auth.uid())::text = split_part(name, '/', 1));
drop policy if exists "bike-photos own update" on storage.objects;
create policy "bike-photos own update" on storage.objects
  for update to authenticated
  using (bucket_id = 'bike-photos' and (auth.uid())::text = split_part(name, '/', 1))
  with check (bucket_id = 'bike-photos' and (auth.uid())::text = split_part(name, '/', 1));
drop policy if exists "bike-photos own delete" on storage.objects;
create policy "bike-photos own delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'bike-photos' and (auth.uid())::text = split_part(name, '/', 1));
