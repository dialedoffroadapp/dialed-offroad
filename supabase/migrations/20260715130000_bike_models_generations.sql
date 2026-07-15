-- bike_models: reshape the (prod-only, previously hand-typed) reference table
-- into year-RANGE generation rows with verified spec columns, add a normalized
-- alias table, and reseed from the 2026-07-15 verified CSV. Reference data:
-- world-readable, no client writes.
--
-- The table + its 20 disposable, unreferenced rows existed only in prod (no
-- CREATE TABLE in the repo). Live schema captured 2026-07-15 from project
-- urqpiwxapckaiorvdvfi. Existing columns are KEPT (stock clicker columns,
-- fork/shock_min/max, has_air_fork, air_pressure_chart, etc.); only the old
-- exact `year` column is dropped, and only after the reseed.

-- ── 1) RESHAPE bike_models ───────────────────────────────────────────────────

alter table public.bike_models
  add column if not exists year_start              int,
  add column if not exists year_end                int,      -- null = current/ongoing
  add column if not exists rear_suspension         text,
  add column if not exists stock_fork_spring_nmm   numeric,  -- null for air forks
  add column if not exists stock_shock_spring_nmm  numeric,
  add column if not exists rider_weight_min_lbs    int,
  add column if not exists rider_weight_max_lbs    int,
  add column if not exists spec_verified           boolean not null default false;

alter table public.bike_models
  drop constraint if exists bike_models_rear_suspension_check;
alter table public.bike_models
  add constraint bike_models_rear_suspension_check
  check (rear_suspension is null or rear_suspension in ('linkage','pds'));

-- ── 2) Alias table ──────────────────────────────────────────────────────────
-- Maps normalized (lowercased) user-entered variants → a canonical model row.
-- Aliases carry NO year; year resolution happens in resolveModelId via the
-- referenced model's year_start/year_end.

create table if not exists public.bike_model_aliases (
  id          uuid primary key default gen_random_uuid(),
  model_id    uuid not null references public.bike_models (id) on delete cascade,
  alias_make  text not null,
  alias_model text not null,
  unique (alias_make, alias_model)
);
create index if not exists bike_model_aliases_model_idx
  on public.bike_model_aliases (model_id);

-- ── 3) Reseed ───────────────────────────────────────────────────────────────
-- Wipe the 20 hand-typed rows (aliases cascade, but clear both explicitly).
-- Old `year` may be NOT NULL; relax it so the year-range inserts (which omit
-- `year`) succeed. The column is dropped after the reseed.

delete from public.bike_model_aliases;
delete from public.bike_models;

alter table public.bike_models alter column year drop not null;

insert into public.bike_models
  (make, model, year_start, year_end, rear_suspension, fork_type, shock_type,
   has_air_fork, stock_fork_spring_nmm, stock_shock_spring_nmm,
   rider_weight_min_lbs, rider_weight_max_lbs, stock_sag_mm, sag_min, sag_max,
   spec_verified)
values
  ('KTM','300 EXC',2017,2023,'pds','WP XPLOR 48 coil','WP PDS',false,4.4,42,155,185,107,100,112,true),
  ('KTM','300 EXC',2024,2026,'pds','WP XACT closed cartridge coil','WP PDS',false,4.4,45,155,185,107,100,112,true),
  ('KTM','300 XC',2017,2022,'linkage','WP XPLOR 48 coil','WP linkage',false,4.4,45,155,185,105,98,110,true),
  ('KTM','300 XC',2023,2026,'linkage','WP XACT coil','WP linkage',false,4.4,45,155,185,105,98,110,true),
  ('KTM','300 XC-W',2017,2023,'pds','WP XPLOR 48 coil','WP PDS',false,4.4,42,155,185,107,100,112,true),
  ('KTM','250 SX-F',2016,2022,'linkage','WP AER 48 air','WP linkage',true,null,45,150,180,105,98,110,true),
  ('KTM','250 SX-F',2023,2026,'linkage','WP XACT air','WP linkage',true,null,45,150,180,105,98,110,true),
  ('KTM','125 SX',2016,2022,'linkage','WP AER 48 air','WP linkage',true,null,42,140,170,105,98,110,true),
  ('KTM','125 SX',2023,2026,'linkage','WP XACT air','WP linkage',true,null,42,140,170,105,98,110,true),
  ('KTM','350 EXC-F',2017,2023,'pds','WP XPLOR 48 coil','WP PDS',false,4.4,45,155,185,107,100,112,true),
  ('KTM','350 EXC-F',2024,2026,'pds','WP XACT closed cartridge coil','WP PDS',false,4.4,48,155,185,107,100,112,true),
  ('Husqvarna','TE 300',2017,2023,'linkage','WP XPLOR 48 coil','WP linkage',false,4.4,45,155,185,105,98,110,true),
  ('Husqvarna','TE 300',2024,2026,'linkage','WP XACT closed cartridge coil','WP linkage',false,4.4,48,155,185,105,98,110,true),
  ('Yamaha','YZ250F',2014,2018,'linkage','KYB SSS 48 coil','KYB linkage',false,4.6,54,150,180,102,95,108,true),
  ('Yamaha','YZ250F',2019,2023,'linkage','KYB SSS 48 coil','KYB linkage',false,4.7,56,150,180,102,95,108,true),
  ('Yamaha','YZ250F',2024,2026,'linkage','KYB SSS 48 coil','KYB linkage',false,4.7,56,150,180,102,95,108,true),
  ('Yamaha','YZ450F',2018,2022,'linkage','KYB SSS 48 coil','KYB linkage',false,4.9,58,160,190,102,95,108,true),
  ('Yamaha','YZ450F',2023,2026,'linkage','KYB SSS 48 coil','KYB linkage',false,5.0,58,160,190,102,95,108,true),
  ('Honda','CRF250R',2018,2021,'linkage','Showa 49 coil','Showa linkage',false,4.7,52,150,180,105,98,110,true),
  ('Honda','CRF250R',2022,2026,'linkage','Showa 49 coil','Showa linkage',false,4.7,52,150,180,105,98,110,true),
  ('Honda','CRF450R',2017,2020,'linkage','Showa 49 coil','Showa linkage',false,4.8,54,160,190,105,98,110,true),
  ('Honda','CRF450R',2021,2026,'linkage','Showa 49 coil','Showa linkage',false,5.0,56,160,190,105,98,110,true),
  ('Kawasaki','KX250',2017,2020,'linkage','Showa SFF coil','Showa linkage',false,4.6,52,150,180,103,96,108,true),
  ('Kawasaki','KX250',2021,2026,'linkage','Showa 48 coil','Showa linkage',false,4.7,54,150,180,103,96,108,true);

-- year_start is populated for every row now → enforce + unique per generation.
alter table public.bike_models alter column year_start set not null;
alter table public.bike_models
  drop constraint if exists bike_models_make_model_year_start_key;
alter table public.bike_models
  add constraint bike_models_make_model_year_start_key
  unique (make, model, year_start);

-- Current/ongoing generations use year_end = null (the CSV used 2026 as a
-- sentinel); coalesce(year_end, 9999) then resolves them for any future year.
update public.bike_models set year_end = null where year_end = 2026;

-- ── 4) Alias seed ────────────────────────────────────────────────────────────
-- Each alias points at the EARLIEST generation of its canonical model (only used
-- to recover the canonical make/model; resolveModelId re-resolves by year).

insert into public.bike_model_aliases (model_id, alias_make, alias_model)
select m.id, a.alias_make, a.alias_model
from (values
  ('ktm','300 xcw','KTM','300 XC-W'),
  ('ktm','300 xc-w','KTM','300 XC-W'),
  ('ktm','300xcw','KTM','300 XC-W'),
  ('ktm','xcw 300','KTM','300 XC-W'),
  ('ktm','300xc','KTM','300 XC'),
  ('ktm','300 xc','KTM','300 XC'),
  ('ktm','300 exc','KTM','300 EXC'),
  ('ktm','exc 300','KTM','300 EXC'),
  ('ktm','300exc','KTM','300 EXC'),
  ('ktm','250sxf','KTM','250 SX-F'),
  ('ktm','250 sxf','KTM','250 SX-F'),
  ('ktm','350excf','KTM','350 EXC-F'),
  ('ktm','350 exc-f','KTM','350 EXC-F'),
  ('husqvarna','te300','Husqvarna','TE 300'),
  ('husqvarna','te 300','Husqvarna','TE 300'),
  ('yamaha','yz250f','Yamaha','YZ250F'),
  ('yamaha','yz 250f','Yamaha','YZ250F'),
  ('yamaha','yz450f','Yamaha','YZ450F'),
  ('yamaha','yz 450f','Yamaha','YZ450F'),
  ('honda','crf250r','Honda','CRF250R'),
  ('honda','crf 250r','Honda','CRF250R'),
  ('honda','crf450r','Honda','CRF450R'),
  ('honda','crf 450r','Honda','CRF450R'),
  ('kawasaki','kx250','Kawasaki','KX250'),
  ('kawasaki','kx 250','Kawasaki','KX250')
) as a(alias_make, alias_model, canon_make, canon_model)
join lateral (
  select b.id
  from public.bike_models b
  where b.make = a.canon_make and b.model = a.canon_model
  order by b.year_start
  limit 1
) m on true;

-- ── 5) Rebuild the dependent view, then drop the old exact `year` column ─────
-- public.v_bikes_with_stock is a prod-only view (consumed by
-- components/TrialMomentCard.tsx, which reads make/model/nickname + stock_fork_comp
-- by bike id). It joined bikes -> bike_models on m.year = b.year, which blocks
-- dropping bike_models.year. Rebuild it to join on the canonical bikes.model_id
-- link, falling back to make/model + year-range for bikes whose model_id hasn't
-- resolved yet. Output columns/order/types are unchanged (create-or-replace keeps
-- the same shape + existing grants); only the join changes.
--
-- Behavior note: the reseed intentionally carries no stock CLICKER values (the CSV
-- has spring rates, not clicks), so m.stock_fork_comp/reb/shock_comp/reb are null
-- on the new rows — the view's stock clicker columns read null (TrialMomentCard's
-- stockDeltaClicks stat degrades to "no stat available", which it already handles)
-- until those columns are seeded in a later pass. stock_sag_mm IS populated.
create or replace view public.v_bikes_with_stock as
select
  b.id, b.user_id, b.make, b.model, b.year, b.tires, b.notes, b.is_primary,
  b.created_at, b.nickname, b.updated_at,
  b.current_fork_comp, b.current_fork_reb, b.current_shock_comp,
  b.current_shock_reb, b.current_sag_mm,
  b.fork_min, b.fork_max, b.shock_min, b.shock_max,
  m.stock_fork_comp, m.stock_fork_reb, m.stock_shock_comp, m.stock_shock_reb,
  m.stock_sag_mm,
  coalesce(b.fork_min, m.fork_min)   as v_fork_min,
  coalesce(b.fork_max, m.fork_max)   as v_fork_max,
  coalesce(b.shock_min, m.shock_min) as v_shock_min,
  coalesce(b.shock_max, m.shock_max) as v_shock_max
from public.bikes b
left join public.bike_models m on (
  m.id = b.model_id
  or (
    b.model_id is null
    and lower(m.make) = lower(b.make)
    and lower(m.model) = lower(b.model)
    and b.year >= m.year_start
    and b.year <= coalesce(m.year_end, 9999)
  )
);

alter table public.bike_models drop column if exists year;

-- ── 6) RLS + grants (both tables): world-readable reference data, no writes ──

alter table public.bike_models enable row level security;
drop policy if exists bike_models_select_all on public.bike_models;
create policy bike_models_select_all on public.bike_models for select using (true);
revoke all on table public.bike_models from anon, authenticated;
grant select on table public.bike_models to anon, authenticated;

alter table public.bike_model_aliases enable row level security;
drop policy if exists bike_model_aliases_select_all on public.bike_model_aliases;
create policy bike_model_aliases_select_all on public.bike_model_aliases for select using (true);
revoke all on table public.bike_model_aliases from anon, authenticated;
grant select on table public.bike_model_aliases to anon, authenticated;
