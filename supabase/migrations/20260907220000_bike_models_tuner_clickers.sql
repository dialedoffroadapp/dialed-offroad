-- Tuner stock clickers from the second research report (sub-task 1a), per
-- River's 2026-09-08 follow-up section 1. Every row's fork and shock family
-- was checked against the catalog before writing; tag tuner with the
-- report's source string. Ranges ("10-17 out") are not a number and stay
-- null with the range in the note. STAGED for prod; applied to dev-3-0.
--
-- Not written (family or model mismatch, docs/catalog-gaps.md): Beta Race
-- Edition (catalog KYB, report Sachs), Beta RR-S (no row), Sherco SEF-R
-- Sachs (catalog KYB Factory line), RM-Z250 (catalog KYB shock; report
-- inferred BFRC). Kawasaki KX250 2017 to 2020 is written (Showa SFF matches
-- the report's SFF-2) with the 2020 KYB boundary flagged in the note.

-- The stock shock columns were integers; a turns shock stores quarter turns
-- (RM-Z450 LSC 1.25), so they become numeric(4,2). Click rows are unchanged.
-- v_bikes_with_stock depends on the columns: drop, alter, recreate (same
-- definition as 20260907210000, grants restored).
drop view if exists public.v_bikes_with_stock;

alter table public.bike_models
  alter column stock_shock_comp type numeric(4,2) using stock_shock_comp::numeric(4,2),
  alter column stock_shock_reb type numeric(4,2) using stock_shock_reb::numeric(4,2);

create view public.v_bikes_with_stock
with (security_invoker = true) as
select
  b.id, b.user_id, b.make, b.model, b.year, b.tires, b.notes, b.is_primary,
  b.created_at, b.nickname, b.updated_at,
  b.fork_min, b.fork_max, b.shock_min, b.shock_max,
  case when m.stock_clicker_tag = 'inferred' then null else m.stock_fork_comp end   as stock_fork_comp,
  case when m.stock_clicker_tag = 'inferred' then null else m.stock_fork_reb end    as stock_fork_reb,
  case when m.stock_clicker_tag = 'inferred' then null else m.stock_shock_comp end  as stock_shock_comp,
  case when m.stock_clicker_tag = 'inferred' then null else m.stock_shock_reb end   as stock_shock_reb,
  m.stock_sag_mm,
  coalesce(b.fork_min, m.fork_min)   as v_fork_min,
  coalesce(b.fork_max, m.fork_max)   as v_fork_max,
  coalesce(b.shock_min, m.shock_min) as v_shock_min,
  coalesce(b.shock_max, m.shock_max) as v_shock_max,
  m.stock_clicker_tag
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

grant select on public.v_bikes_with_stock to authenticated;
grant all on public.v_bikes_with_stock to service_role;

-- Honda CRF450R 2017 to 2020 (Showa 49 coil / Showa linkage)
update public.bike_models
   set stock_fork_comp = 12, stock_fork_reb = 13, stock_shock_hsc_turns = 3.0,
       stock_clicker_tag = 'tuner',
       stock_clicker_source = 'MXA CRF450 race tests 2017-2020 (tuner; research report 2026-09-07, second, sub-task 1a)',
       stock_clicker_note = 'Fork comp and rebound approximate (~12 / ~13). Shock LSC ran 10 to 17 out and rebound 7 to 10 out across the tests: ranges, stored as null. HSC 3 turns out is the 2020 stock.'
 where make = 'Honda' and model = 'CRF450R' and year_start = 2017 and stock_fork_comp is null;

-- Honda CRF450R 2021+ (report 2021 to 2024; the row is open-ended)
update public.bike_models
   set stock_fork_comp = 12, stock_fork_reb = 15, stock_shock_hsc_turns = 2.25,
       stock_clicker_tag = 'tuner',
       stock_clicker_source = 'MXA 2023 CRF450 test: rebound listed "20 out (15 out)", stock 15 (tuner; research report 2026-09-07, second, sub-task 1a)',
       stock_clicker_note = 'Report years 2021 to 2024 on an open-ended row. Shock LSC and rebound not found; HSC about 2.25 turns out.'
 where make = 'Honda' and model = 'CRF450R' and year_start = 2021 and stock_fork_comp is null;

-- Honda CRF250R 2022+ (report 2022 to 2025)
update public.bike_models
   set stock_fork_comp = 12, stock_fork_reb = 13, stock_shock_hsc_turns = 2.17,
       stock_clicker_tag = 'tuner',
       stock_clicker_source = 'MXA 2022 CRF250 race test (tuner; research report 2026-09-07, second, sub-task 1a)',
       stock_clicker_note = 'HSC stock is 2 and 1/6 turns out (stored 2.17). Shock LSC and rebound not found. Report years 2022 to 2025 on an open-ended row.'
 where make = 'Honda' and model = 'CRF250R' and year_start = 2022 and stock_fork_comp is null;

-- Suzuki RM-Z450 2018+ (Showa 49 coil / Showa BFRC): the shock columns hold TURNS on this row.
update public.bike_models
   set stock_fork_comp = 6, stock_shock_comp = 1.25, stock_shock_reb = 2, stock_shock_hsc_turns = null,
       stock_clicker_tag = 'tuner',
       stock_clicker_source = 'MXA RM-Z450 2018 and 2019 race tests (tuner; research report 2026-09-07, second, sub-task 1a)',
       stock_clicker_note = 'BFRC shock: stock_shock_comp and stock_shock_reb are TURNS on this row (shock_adjust_unit = turns): LSC 1.25 inside MXA''s 1 to 1.5, rebound 2 inside 1 to 3; no HSC adjuster. Fork rebound not found. Report years 2018 to 2024 on an open-ended row. The engine anchors its BFRC baseline on these turns.'
 where make = 'Suzuki' and model = 'RM-Z450' and year_start = 2018 and stock_fork_comp is null;

-- Yamaha YZ250F 2014+ (three generations, KYB SSS)
update public.bike_models
   set stock_fork_comp = 10, stock_fork_reb = 13, stock_shock_comp = 10, stock_shock_hsc_turns = 1.0, stock_shock_reb = 14,
       stock_clicker_tag = 'tuner',
       stock_clicker_source = 'Keefer Inc / PulpMX and MXA YZ setup notes (tuner; research report 2026-09-07, second, sub-task 1a)',
       stock_clicker_note = 'Approximate (~10 / ~13 fork, ~10 LSC, 1 turn HSC, ~14 rebound); the report gives one set of values for 2014 to 2026.'
 where make = 'Yamaha' and model = 'YZ250F' and stock_fork_comp is null;

-- Kawasaki KX450 2016 to 2018 (Showa SFF-Air TAC)
update public.bike_models
   set stock_fork_comp = 9, stock_fork_reb = 13,
       stock_clicker_tag = 'tuner',
       stock_clicker_source = 'Vital MX factory-setting post; Dirt Bike Test 2017 KX450F (tuner; research report 2026-09-07, second, sub-task 1a)',
       stock_clicker_note = 'Shock values not found.'
 where make = 'Kawasaki' and model = 'KX450' and year_start = 2016 and stock_fork_comp is null;

-- Kawasaki KX250 2017 to 2020 (Showa SFF coil = the report''s SFF-2)
update public.bike_models
   set stock_fork_comp = 15, stock_fork_reb = 15,
       stock_clicker_tag = 'tuner',
       stock_clicker_source = 'MXA fork guide: Showa SFF coil standard 15/15 (report tag factory/tuner, stored tuner; research report 2026-09-07, second, sub-task 1a)',
       stock_clicker_note = 'Shock values not found. The report puts the KX250 on KYB SSS from 2020 while this row runs on Showa SFF through 2020: flagged in docs/catalog-gaps.md.'
 where make = 'Kawasaki' and model = 'KX250' and year_start = 2017 and stock_fork_comp is null;

-- Stark Varg MX 2023+ (KYB 48 coil)
update public.bike_models
   set stock_fork_comp = 13, stock_fork_reb = 12,
       stock_clicker_tag = 'tuner',
       stock_clicker_source = 'Stark support factory sheet posted by an owner (electricdirtriders.com) (tuner; research report 2026-09-07, second, sub-task 1a)',
       stock_clicker_note = 'Shock values not found.'
 where make = 'Stark' and model = 'Varg MX' and stock_fork_comp is null;

-- Preset ranges (Comfort / Standard / Sport) into the note, never as columns.
update public.bike_models
   set stock_clicker_note = coalesce(stock_clicker_note || ' ', '') || 'Presets (KTM 250 SX-F 2023 owner''s manual, US fork WP XACT 5448, factory): fork compression Comfort 17 / Standard 12 / Sport 7, rebound Comfort 23 / Standard 18 / Sport 13; shock rebound Comfort 17 / Standard 15 / Sport 13.'
 where make = 'KTM' and model in ('250 SX-F', '350 SX-F', '450 SX-F', '450 SX-F Factory Edition') and year_start >= 2023 and stock_clicker_note not ilike '%Presets (KTM%';
update public.bike_models
   set stock_clicker_note = coalesce(stock_clicker_note || ' ', '') || 'Presets (Sherco KYB manuals, factory): fork compression Comfort 20 / Standard 13 / Sport 8, rebound Comfort 18 / Standard 13 / Sport 10; shock LSC Comfort 20 / Standard 14 / Sport 12, HSC Comfort 2.5 / Standard 1.5 / Sport 1 turn, rebound Comfort 15 / Standard 13 / Sport 11.'
 where make = 'Sherco' and stock_clicker_note not ilike '%Presets (Sherco%';
