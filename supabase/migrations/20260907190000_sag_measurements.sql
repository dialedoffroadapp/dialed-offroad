-- Sag page per bike (River, 2026-09-07): the rider measures A (wheel
-- hanging), B (on its wheels, unloaded) and C (seated in full gear); static
-- = A minus B, riding = A minus C. Every measurement is a row in
-- sag_measurements (the page's history, last ten per bike) and the latest
-- one is stamped on the active setup version. setup_versions rows stay
-- immutable EXCEPT these four measurement columns: a column-scoped update
-- grant plus an own-rows update policy (the ride_feedback idiom). Both
-- insert-time triggers (version_number, settings_delta) are BEFORE INSERT
-- and never fire on this update. app_config.sag_recheck_ride_days (5): the
-- ride-mode recheck card shows when the last measurement is older than that
-- many ride days. STAGED for prod; applied to dev-3-0.
--
-- Flagged in the report: the prompt names "sag_measured (riding)" but
-- setup_versions.sag_measured is a BOOLEAN (v2.4.0: "the rider measured
-- it"); the riding value goes to sag_riding_measured_mm and the boolean is
-- set true alongside it.

insert into public.app_config (key, value)
values ('sag_recheck_ride_days', '5'::jsonb)
on conflict (key) do nothing;

alter table public.setup_versions
  add column if not exists sag_riding_measured_mm integer,
  add column if not exists sag_static_measured_mm integer,
  add column if not exists sag_measured_at timestamptz;

comment on column public.setup_versions.sag_riding_measured_mm is 'Rider-measured riding (race) sag, mm: A minus C (sag page, 2026-09-07).';
comment on column public.setup_versions.sag_static_measured_mm is 'Rider-measured static sag, mm: A minus B (sag page, 2026-09-07).';
comment on column public.setup_versions.sag_measured_at is 'When the rider last measured sag on this version (sag page, 2026-09-07).';

drop policy if exists "setup_versions_update_sag_own" on public.setup_versions;
create policy "setup_versions_update_sag_own"
  on public.setup_versions for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant update (sag_measured, sag_riding_measured_mm, sag_static_measured_mm, sag_measured_at)
  on table public.setup_versions to authenticated;

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
  'One row per sag measurement (A wheel hanging, B unloaded, C rider seated in gear); riding = A - C, static = A - B. Sag page history (2026-09-07).';

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
