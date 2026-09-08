-- Suspension reference research, second report (River's prompt, 2026-09-07).
-- Every figure carries its source and a tag (factory | tuner | inferred).
-- Inferred figures are written but never surfaced as stock; "not found" is
-- null, no placeholder. The prompt asked for 2026090716xxxx; that slot was
-- taken by the refine allowance, so this file is 20260907210000.
-- STAGED for prod; applied to dev-3-0.
--
-- Contents: (1) stock clicker tags + the factory rows the prompt names
-- (KTM 125/150 SX and TC 125 AER/XACT 2017+, Sherco KYB 2022+) + the
-- inferred rows it allows (KTM 250 SX from the SX-F, GasGas MC from KTM);
-- (2) click range provenance columns, the seed maxima (30 on every row,
-- never data) nulled, the tuner maxima the prompt names, inferred WP
-- maxima as notes only; (3) the Sherco split at 2022; (4) BFRC columns
-- (shock_adjust_unit, has_shock_hsc); (5) catalog_constants spring bands
-- and the Keefer air note; (6) app_config engine tuning keys;
-- (7) v_bikes_with_stock hides inferred stock clickers.
-- Flagged (see docs/suspension-reference-resolution-2026-09-07.md): the
-- Sherco catalog rows are the Factory line (KYB from 2019); the report's
-- Sachs 2019 to 2021 figures are for the SEF-R line and are NOT written;
-- Beta Race Edition (catalog KYB, report Sachs) and Beta RR-S (no row) are
-- NOT written; RM-Z250 sharing BFRC is NOT written (catalog says KYB shock,
-- and the RM-Z450 tuner values live in the report file, not this prompt).

-- ── 1) Columns ─────────────────────────────────────────────────────────────
alter table public.bike_models
  add column if not exists stock_clicker_tag text
    check (stock_clicker_tag in ('factory', 'tuner', 'inferred')),
  add column if not exists click_range_source text,
  add column if not exists click_range_tag text
    check (click_range_tag in ('factory', 'tuner', 'inferred')),
  add column if not exists click_range_note text,
  add column if not exists shock_adjust_unit text not null default 'clicks'
    check (shock_adjust_unit in ('clicks', 'turns')),
  add column if not exists has_shock_hsc boolean not null default true;

comment on column public.bike_models.stock_clicker_tag is 'factory (owner''s manual) | tuner (published by a tuner) | inferred (shared platform; never surfaced as stock).';
comment on column public.bike_models.click_range_tag is 'Provenance of the click range maxima; click_range_verified is true only for factory.';
comment on column public.bike_models.shock_adjust_unit is 'clicks, or turns for shocks whose LSC and rebound are continuous turns (Showa BFRC).';
comment on column public.bike_models.has_shock_hsc is 'false when the shock has no high-speed compression adjuster (Showa BFRC).';

-- The prompt names shock_lsc_max and shock_hsc_turns_total; the catalog's
-- existing shock_comp_max and shock_hsc_turns_max carry those meanings, so
-- no duplicate columns are added (flagged in the resolution doc).

-- ── 2) Tags for the rows sourced by 20260907140000 / 150000 (values untouched) ──
update public.bike_models set stock_clicker_tag = 'factory'
 where stock_clicker_tag is null and stock_fork_comp is not null
   and (stock_clicker_source ilike '%manual%' or stock_clicker_source ilike '%WP/KTM%');
update public.bike_models set stock_clicker_tag = 'tuner'
 where stock_clicker_tag is null and stock_fork_comp is not null
   and stock_clicker_source ilike 'MXA%';
update public.bike_models set stock_clicker_tag = 'inferred'
 where stock_clicker_tag is null and stock_fork_comp is not null
   and stock_clicker_source ilike 'Shared platform%';
-- GasGas rows sourced from the KTM manual are shared-platform values: inferred.
update public.bike_models set stock_clicker_tag = 'inferred',
  stock_clicker_note = coalesce(stock_clicker_note || ' ', '') || 'GasGas shares the KTM platform; values are the KTM manual figures (inferred per the 2026-09-07 second report).'
 where make = 'GasGas' and stock_fork_comp is not null;

-- ── 3) Sherco: split at 2022 (the prompt's Sachs-to-KYB boundary) ───────────
create or replace function public._split_bike_model_generation(p_make text, p_model text, p_old_start int, p_new_start int)
returns uuid
language plpgsql
as $$
declare
  v_old public.bike_models%rowtype;
  v_new_id uuid;
begin
  select * into v_old from public.bike_models where make = p_make and model = p_model and year_start = p_old_start;
  if not found then
    raise notice 'split skipped: % % % not found', p_make, p_model, p_old_start;
    return null;
  end if;
  insert into public.bike_models
    (make, model, year_start, year_end, rear_suspension, fork_type, shock_type, has_air_fork,
     stock_fork_spring_nmm, stock_shock_spring_nmm, rider_weight_min_lbs, rider_weight_max_lbs,
     stock_sag_mm, sag_min, sag_max, spec_verified, fork_comp_max, fork_reb_max, shock_comp_max,
     shock_reb_max, shock_hsc_turns_max, click_range_verified, sag_window_verified, weight_range_verified,
     fork_min, fork_max, shock_min, shock_max,
     fork_type_verified, fork_type_source, sag_window_source, stock_static_sag_mm, static_sag_note,
     stock_air_bar, stock_air_bar_source, weight_range_source, spring_rate_source, spring_rate_note)
  values
    (v_old.make, v_old.model, p_new_start, v_old.year_end, v_old.rear_suspension, v_old.fork_type, v_old.shock_type, v_old.has_air_fork,
     v_old.stock_fork_spring_nmm, v_old.stock_shock_spring_nmm, v_old.rider_weight_min_lbs, v_old.rider_weight_max_lbs,
     v_old.stock_sag_mm, v_old.sag_min, v_old.sag_max, v_old.spec_verified, v_old.fork_comp_max, v_old.fork_reb_max, v_old.shock_comp_max,
     v_old.shock_reb_max, v_old.shock_hsc_turns_max, v_old.click_range_verified, v_old.sag_window_verified, v_old.weight_range_verified,
     v_old.fork_min, v_old.fork_max, v_old.shock_min, v_old.shock_max,
     v_old.fork_type_verified, v_old.fork_type_source, v_old.sag_window_source, v_old.stock_static_sag_mm, v_old.static_sag_note,
     v_old.stock_air_bar, v_old.stock_air_bar_source, v_old.weight_range_source, v_old.spring_rate_source, v_old.spring_rate_note)
  returning id into v_new_id;
  update public.bike_models set year_end = p_new_start - 1 where id = v_old.id;
  update public.bikes set model_id = v_new_id where model_id = v_old.id and year >= p_new_start;
  return v_new_id;
end;
$$;

do $$
declare
  r record;
begin
  for r in select * from (values ('Sherco','SE 250 Factory'), ('Sherco','SE 300 Factory'), ('Sherco','SEF 300 Factory')) as t(make, model) loop
    perform public._split_bike_model_generation(r.make, r.model, 2019, 2022);
  end loop;
end $$;

drop function public._split_bike_model_generation(text, text, int, int);

-- The 2019 to 2021 Sherco rows stay KYB per the catalog (the Factory line)
-- with no clickers: the report's Sachs 12/12, 15, 2 turns, 13 figures belong
-- to the SEF-R line and are NOT written to a KYB row (flagged).
update public.bike_models
   set stock_clicker_note = 'The 2026-09-07 second report gives Sachs figures (fork 12/12, shock LSC 15, HSC 2 turns, rebound 13) for the SEF-R (Racing) 2019 to 2021; this catalog row is the Factory model on a KYB fork, so nothing is written. Flagged.'
 where make = 'Sherco' and year_start = 2019 and year_end = 2021;

-- ── 4) Stock clickers named by the prompt ───────────────────────────────────
-- KTM 125/150 SX and Husqvarna TC 125, AER 2017 to 2022 and XACT 2023+: factory.
update public.bike_models
   set stock_fork_comp = 18, stock_fork_reb = 21,
       stock_shock_comp = 15, stock_shock_hsc_turns = 1.0, stock_shock_reb = 15,
       stock_clicker_tag = 'factory',
       stock_clicker_source = 'KTM 125 SX Owner''s Manual (2017+): fork compression 18, rebound 21 (20 with the alternate fork part number); shock LSC 15, HSC 1 turn, rebound 15 (research report 2026-09-07, second, sub-task 1a)',
       stock_clicker_note = 'Fork rebound is 21 or 20 depending on the fork part number in the manual; 21 stored. TC 125 and 150 SX share the 125 SX fork and shock settings.'
 where make in ('KTM', 'Husqvarna') and model in ('125 SX', '150 SX', 'TC 125') and year_start >= 2017
   and stock_fork_comp is null;

-- Sherco KYB 2022+ (the three split rows): factory values from the SEF-R manual, same KYB 48 fork; model line flagged.
update public.bike_models
   set stock_fork_comp = 13, stock_fork_reb = 13,
       stock_shock_comp = 14, stock_shock_hsc_turns = 1.5, stock_shock_reb = 13,
       stock_clicker_tag = 'factory',
       stock_clicker_source = 'Sherco SEF-R (Racing) 2022+ owner''s manual: KYB fork 13/13, shock LSC 14, HSC 1.5 turns, rebound 13 (research report 2026-09-07, second, sub-task 1a)',
       stock_clicker_note = 'Manual values are for the SEF-R (Racing) line on the same KYB 48 fork; this catalog row is the Factory model. Flagged in the resolution doc.'
 where make = 'Sherco' and year_start = 2022;

-- Inferred rows the prompt allows: written, tagged inferred, never surfaced.
-- KTM 250 SX two-stroke shares the SX-F platform values of the same years.
update public.bike_models m
   set stock_fork_comp = 12, stock_fork_reb = 18,
       stock_shock_comp = 10, stock_shock_hsc_turns = 1.5, stock_shock_reb = 15,
       stock_clicker_tag = 'inferred',
       stock_clicker_source = 'Inferred from the KTM SX-F rows of the same years (WP/KTM manuals; MXA); the 250 SX shares the SX platform (research report 2026-09-07, second)',
       stock_clicker_note = 'Inferred: not surfaced as stock in the app.'
 where make = 'KTM' and model = '250 SX' and year_start >= 2017 and stock_fork_comp is null;
-- GasGas MC: the KTM equivalents.
update public.bike_models
   set stock_fork_comp = 18, stock_fork_reb = 21, stock_shock_comp = 15, stock_shock_hsc_turns = 1.0, stock_shock_reb = 15,
       stock_clicker_tag = 'inferred',
       stock_clicker_source = 'Inferred from the KTM 125 SX owner''s manual (shared platform; research report 2026-09-07, second)',
       stock_clicker_note = 'Inferred: not surfaced as stock in the app.'
 where make = 'GasGas' and model = 'MC 125' and stock_fork_comp is null;
update public.bike_models
   set stock_fork_comp = 12, stock_fork_reb = 18, stock_shock_comp = 10, stock_shock_hsc_turns = 1.5, stock_shock_reb = 15,
       stock_clicker_tag = 'inferred',
       stock_clicker_source = 'Inferred from the KTM 250 / 450 SX-F rows (WP/KTM manuals; MXA; shared platform; research report 2026-09-07, second)',
       stock_clicker_note = 'Inferred: not surfaced as stock in the app.'
 where make = 'GasGas' and model in ('MC 250F', 'MC 450F') and stock_fork_comp is null;

-- ── 5) Click range maxima: seed defaults out, sourced maxima in ────────────
-- The seed put 30 on every row (CLAUDE.md: never data). Null everything, then
-- write only what the prompt names, tagged. click_range_verified stays false
-- everywhere (no factory maximum was found); range bars stay hidden.
update public.bike_models
   set fork_comp_max = null, fork_reb_max = null, shock_comp_max = null, shock_reb_max = null, shock_hsc_turns_max = null,
       click_range_verified = false;

-- KYB SSS (Yamaha, Stark, Sherco KYB, Beta Race, KX450 2021+ KYB 48): JBI about 20 to 24, stored 22 (tuner).
update public.bike_models
   set fork_comp_max = 22, fork_reb_max = 22,
       click_range_tag = 'tuner',
       click_range_source = 'JBI Suspension: KYB SSS fork clickers about 20 to 24 (research report 2026-09-07, second, sub-task 1b)',
       click_range_note = 'About 20 to 24 clicks per JBI; 22 stored as the midpoint. Not a factory maximum; range bars stay hidden.'
 where fork_type ilike '%KYB SSS%';

-- Showa 49 mm coil (Honda 2017+, KX450 2019 to 2020, RM-Z450 2018+): MXA about 20 (tuner).
update public.bike_models
   set fork_comp_max = 20, fork_reb_max = 20,
       click_range_tag = 'tuner',
       click_range_source = 'MXA: Showa 49 mm coil fork about 20 clicks (research report 2026-09-07, second, sub-task 1b)',
       click_range_note = 'About 20 clicks per MXA. Not a factory maximum; range bars stay hidden.'
 where fork_type ilike 'Showa 49%';

-- Showa SFF-2 (KX250 through 2020) and SFF-Air TAC (KX450 2016 to 2018): clicks, totals not stated. Note only.
update public.bike_models
   set click_range_tag = 'tuner',
       click_range_source = 'MXA (research report 2026-09-07, second, sub-task 1b)',
       click_range_note = 'Clickers, but the totals are not stated in the sources; maxima left null.'
 where fork_type ilike 'Showa SFF%';

-- Honda Showa shock: HSC 3 turns (tuner).
update public.bike_models
   set shock_hsc_turns_max = 3,
       click_range_tag = coalesce(click_range_tag, 'tuner'),
       click_range_source = coalesce(click_range_source || '; ', '') || 'MXA: Honda Showa shock high-speed compression 3 turns (research report 2026-09-07, second, sub-task 1b)'
 where make = 'Honda' and shock_type ilike 'Showa%';

-- KYB shock (Yamaha): HSC counted in quarter turns (tuner note).
update public.bike_models
   set click_range_note = coalesce(click_range_note || ' ', '') || 'KYB shock high-speed compression is counted in quarter turns (research report 2026-09-07, second).'
 where make = 'Yamaha' and shock_type ilike 'KYB%';

-- WP families: inferred maxima as notes only (AER 48 about 25, XACT 2023+ about 30, XPLOR about 30).
update public.bike_models
   set click_range_note = 'WP AER 48: about 25 clicks (INFERRED, unverified; research report 2026-09-07, second). Maxima left null until a manual or a physical count confirms them.'
 where fork_type ilike '%AER 48 air' and year_start >= 2017;
update public.bike_models
   set click_range_note = 'WP XACT 2023+: about 30 clicks (INFERRED, unverified; research report 2026-09-07, second). Maxima left null until a manual or a physical count confirms them.'
 where fork_type ilike 'WP XACT air' and year_start >= 2023;
update public.bike_models
   set click_range_note = 'WP XPLOR: about 30 clicks (INFERRED, unverified; research report 2026-09-07, second). Maxima left null until a manual or a physical count confirms them.'
 where fork_type ilike '%XPLOR%';
-- WP 4CS 25/25 (JBI, tuner) applies to the US and Australia coil variant of the 2016 rows; those rows are region-ambiguous, so it is a note.
update public.bike_models
   set click_range_note = 'US and Australia 2016 (WP 4CS coil): 25/25 clicks per JBI (tuner). EU 2016 (WP AER 48): about 25, inferred. Maxima left null: the row is region-ambiguous.'
 where fork_type_ambiguous = true;

-- ── 6) BFRC: Suzuki RM-Z450 2018+ ──────────────────────────────────────────
update public.bike_models
   set shock_type = 'Showa BFRC linkage',
       shock_adjust_unit = 'turns',
       has_shock_hsc = false,
       click_range_note = coalesce(click_range_note || ' ', '') || 'Showa BFRC shock: low-speed compression (Com) and rebound (Ten) are continuous turns on the piggyback, no adjuster under the shock, no high-speed adjuster (research report 2026-09-07, second, section 4).'
 where make = 'Suzuki' and model = 'RM-Z450' and year_start >= 2018;

-- ── 7) catalog_constants: spring bands per model year, the Keefer air note ──
insert into public.catalog_constants (key, value, source) values
  ('spring_bands:KTM 450 SX-F:2019',
   '{"tag": "factory", "unit": "N/mm", "shock": [{"kg": "65-75", "rate": 42}, {"kg": "75-85", "rate": 45}, {"kg": "85-95", "rate": 48}]}'::jsonb,
   'KTM 450 SX-F 2019 owner''s manual spring table (factory; research report 2026-09-07, second, sub-task 2)'),
  ('spring_bands:KTM 250 SX-F:2022',
   '{"tag": "factory", "unit": "N/mm", "shock": [{"kg": "65-75", "rate": 39}, {"kg": "75-85", "rate": 42}, {"kg": "85-95", "rate": 45}]}'::jsonb,
   'KTM 250 SX-F 2022 owner''s manual spring table (factory; research report 2026-09-07, second, sub-task 2)'),
  ('spring_bands:Sherco 250/300 SEF:2025',
   '{"tag": "factory", "unit": "N/mm", "fork": [{"kg": "65-75", "rate": 4.0}, {"kg": "75-85", "rate": 4.2}, {"kg": "85-95", "rate": 4.4}]}'::jsonb,
   'Sherco 250-300 SEF Owner''s Manual 2025 spring chart (factory; research report 2026-09-07, second, sub-task 2)'),
  ('air_pressure_spring_equivalence',
   '{"tag": "tuner", "psi_per_spring_step": 2, "note": "About 2 psi of AER/XACT pressure equals one spring rate step. A note only: the air slope is unchanged."}'::jsonb,
   'Keefer Inc. Testing (tuner; research report 2026-09-07, second, sub-task 2)')
on conflict (key) do update set value = excluded.value, source = excluded.source, updated_at = now();

-- ── 8) app_config: engine tuning keys (sub-task 2 defaults) ─────────────────
insert into public.app_config (key, value) values
  ('weight_slope_cap_clicks', '3'::jsonb),
  ('skill_offset_comp_per_step', '-2'::jsonb),
  ('skill_offset_reb_per_step', '-1'::jsonb)
on conflict (key) do nothing;

-- ── 9) v_bikes_with_stock: inferred stock clickers read as null ─────────────
drop view if exists public.v_bikes_with_stock;
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
