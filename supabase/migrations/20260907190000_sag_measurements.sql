-- Sag page per bike (River, 2026-09-07): the rider measures A (wheel
-- hanging), B (on its wheels, unloaded) and C (seated in full gear); static
-- = A minus B, riding = A minus C. Every measurement is a row in
-- sag_measurements, linked to the setup version it was taken on. A sag
-- measurement is a fact about the bike, not a setting change, so
-- setup_versions rows STAY IMMUTABLE (River's call, 2026-09-07; the n=1
-- framing and the version trigger depend on it): the app reads the latest
-- measurement from this table for display, the meter and the ride-mode
-- recheck. app_config.sag_recheck_ride_days (5): the recheck card shows when
-- the last measurement is older than that many ride days. STAGED for prod;
-- applied to dev-3-0.
--
-- setup_versions.sag_measured (boolean, v2.4.0) is DEPRECATED as a value:
-- it only ever meant "the rider measured it" and the sag page no longer
-- writes it; the measurement itself lives here.

insert into public.app_config (key, value)
values ('sag_recheck_ride_days', '5'::jsonb)
on conflict (key) do nothing;

create table if not exists public.sag_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bike_id uuid references public.bikes(id) on delete cascade,
  version_id uuid references public.setup_versions(id) on delete set null,
  a_mm integer not null,
  b_mm integer not null,
  c_mm integer not null,
  riding_mm integer not null,
  static_mm integer not null,
  measured_at timestamptz not null default now()
);

comment on table public.sag_measurements is
  'One row per sag measurement (A wheel hanging, B unloaded, C rider seated in gear); riding = A - C, static = A - B. The bike''s sag record; version_id = the setup version it was taken on. Sag page (2026-09-07).';

create index if not exists ix_sag_measurements_bike_time on public.sag_measurements (bike_id, measured_at desc);

alter table public.sag_measurements enable row level security;

drop policy if exists "sag_measurements_select_own" on public.sag_measurements;
create policy "sag_measurements_select_own"
  on public.sag_measurements for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "sag_measurements_insert_own" on public.sag_measurements;
create policy "sag_measurements_insert_own"
  on public.sag_measurements for insert to authenticated
  with check (auth.uid() = user_id);

revoke all on table public.sag_measurements from anon;
revoke all on table public.sag_measurements from authenticated;
grant select, insert on table public.sag_measurements to authenticated;
grant all on table public.sag_measurements to service_role;
