-- Research applied to the catalog (River's instructions of 2026-09-07 over the
-- research report compass_artifact_wf-7c11d3ba, "Dirt Bike Suspension
-- Reference: Verified Factory and Supplier Specifications"). Every value set
-- here carries its source string in a *_source column; rows the report did
-- not cover keep their platform-convention values and stay unverified.
-- STAGED, NOT PUSHED to prod; applied to dev-3-0.
--
-- Shape: provenance columns and a constants table; generation splits where
-- the fork type or the sourced stock settings change inside an existing
-- year range (bikes are repointed to the new generation row); fork-type
-- corrections; sag windows; WP air bases; stock clicker positions; spring
-- notes; the reference-rider weight range. The 2016 SX / SX-F / FC / TC rows
-- become fork_type_ambiguous with has_air_fork NULL: EU got the WP AER 48
-- air fork, US and Australia kept the WP 4CS coil (Transmoto, Joachim Sauer
-- quote), so the Add a bike flow asks the rider and stores the answer on
-- bikes.air_fork_override.

-- ── 1) Provenance columns and constants ─────────────────────────────────────

alter table public.bike_models
  add column if not exists fork_type_ambiguous   boolean not null default false,
  add column if not exists fork_type_verified    boolean not null default false,
  add column if not exists fork_type_source      text,
  add column if not exists sag_window_source     text,
  add column if not exists stock_static_sag_mm   integer,
  add column if not exists static_sag_note       text,
  add column if not exists stock_air_bar         numeric,
  add column if not exists stock_air_bar_source  text,
  add column if not exists weight_range_source   text,
  add column if not exists stock_shock_hsc_turns numeric,
  add column if not exists stock_clicker_source  text,
  add column if not exists stock_clicker_note    text,
  add column if not exists spring_rate_source    text,
  add column if not exists spring_rate_note      text;

comment on column public.bike_models.fork_type_ambiguous is
  'True when the model year shipped with different forks by region (2016 KTM SX/SX-F, Husqvarna FC/TC: EU WP AER 48 air, US and Australia WP 4CS coil). has_air_fork is NULL on these rows; the rider answers air or coil and bikes.air_fork_override carries it.';
comment on column public.bike_models.stock_air_bar is
  'WP base positive-chamber pressure for the model (bar), from the WP XACT PRO 7448 manual or the KTM model manual. The engine uses it as the air base for the row; the per-weight slope is our own rule, never WP''s.';
comment on column public.bike_models.stock_static_sag_mm is
  'Factory static sag (bike alone) where the manual states an exact value; static_sag_note holds a range.';

create table if not exists public.catalog_constants (
  key        text primary key,
  value      jsonb not null,
  source     text not null,
  updated_at timestamptz not null default now()
);
alter table public.catalog_constants enable row level security;
drop policy if exists catalog_constants_select_all on public.catalog_constants;
create policy catalog_constants_select_all on public.catalog_constants for select using (true);
revoke all on table public.catalog_constants from anon, authenticated;
grant select on table public.catalog_constants to anon, authenticated;

insert into public.catalog_constants (key, value, source) values
  ('spring_rate_slope',
   '{"fork_nmm_per_10kg": 0.2, "shock_nmm_per_10kg": 2, "fork_nmm_per_10lb": 0.09, "shock_nmm_per_10lb": 0.9, "note": "one fork step and one shock step per 10 kg (22 lb) band; a starting point to verify with sag, never a spec"}'::jsonb,
   'Sherco 250-300 SEF Owner''s Manual 2025 spring chart; KTM XPLOR rider-weight table (research report 2026-09-07, section 6)'),
  ('reference_rider',
   '{"min_kg": 75, "max_kg": 85, "min_lbs": 165, "max_lbs": 187, "gear": "full protective clothing"}'::jsonb,
   'KTM owner''s manuals ("adjusted for an average rider''s weight of 75 to 85 kg with full protective clothing"); Sherco 250-300 SEF Owner''s Manual 2025')
on conflict (key) do update set value = excluded.value, source = excluded.source, updated_at = now();

-- ── 2) Generation split helper (dropped at the end) ─────────────────────────
-- Copies the generation row (make, model, year_start = p_old_start) into a
-- new row starting at p_new_start with the old row's year_end, closes the old
-- row at p_new_start - 1, and repoints bikes whose year is at or past the
-- split. Returns the new row's id.

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
     fork_min, fork_max, shock_min, shock_max)
  values
    (v_old.make, v_old.model, p_new_start, v_old.year_end, v_old.rear_suspension, v_old.fork_type, v_old.shock_type, v_old.has_air_fork,
     v_old.stock_fork_spring_nmm, v_old.stock_shock_spring_nmm, v_old.rider_weight_min_lbs, v_old.rider_weight_max_lbs,
     v_old.stock_sag_mm, v_old.sag_min, v_old.sag_max, v_old.spec_verified, v_old.fork_comp_max, v_old.fork_reb_max, v_old.shock_comp_max,
     v_old.shock_reb_max, v_old.shock_hsc_turns_max, v_old.click_range_verified, v_old.sag_window_verified, v_old.weight_range_verified,
     v_old.fork_min, v_old.fork_max, v_old.shock_min, v_old.shock_max)
  returning id into v_new_id;
  update public.bike_models set year_end = p_new_start - 1 where id = v_old.id;
  update public.bikes set model_id = v_new_id where model_id = v_old.id and year >= p_new_start;
  return v_new_id;
end;
$$;

-- ── 3) Fork type by year ────────────────────────────────────────────────────

do $$
declare
  r record;
  v_src_air text := 'Transmoto (Joachim Sauer quote); eBay OEM listings; Enduro21 2023 range (research report 2026-09-07, section 2)';
  v_src_2016 text := 'Transmoto, KTM Product Manager Joachim Sauer: EU 2016 got the WP AER 48, USA and Australia retained the WP 4CS for 2016 (research report 2026-09-07, section 2)';
begin
  -- 3a) The 2016 rows: split at 2017; the 2016 row becomes region-ambiguous.
  for r in select * from (values
      ('KTM','125 SX'), ('KTM','150 SX'), ('KTM','250 SX-F'), ('KTM','350 SX-F'), ('KTM','450 SX-F'),
      ('Husqvarna','FC 250'), ('Husqvarna','FC 350'), ('Husqvarna','FC 450'), ('Husqvarna','TC 125')
    ) as t(make, model)
  loop
    perform public._split_bike_model_generation(r.make, r.model, 2016, 2017);
    update public.bike_models
       set fork_type = 'WP AER 48 air (EU) or WP 4CS coil (US, Australia)',
           has_air_fork = null,
           fork_type_ambiguous = true,
           fork_type_verified = true,
           fork_type_source = v_src_2016
     where make = r.make and model = r.model and year_start = 2016;
    update public.bike_models
       set fork_type_verified = true, fork_type_source = v_src_air
     where make = r.make and model = r.model and year_start = 2017;
  end loop;

  -- 3b) Every other 2017+ SX / SX-F / FC / TC / TX / XC-F air row, and GasGas MC.
  update public.bike_models
     set fork_type_verified = true, fork_type_source = v_src_air
   where has_air_fork = true and fork_type_verified = false
     and ((make = 'KTM' and model ~ '(SX|SX-F)( Factory Edition)?$' and year_start >= 2017)
       or (make = 'Husqvarna' and model ~ '^(FC|TC) ' and year_start >= 2017));
  update public.bike_models
     set fork_type_verified = true,
         fork_type_source = 'Transmoto 2024 (GasGas joins the platform update); shared WP platform, GasGas manual not separately retrieved (research report 2026-09-07, sections 2 and caveats)'
   where make = 'GasGas' and model ~ '^MC ' and has_air_fork = true;
  update public.bike_models
     set fork_type_verified = true,
         fork_type_source = 'MXA (TX 300 runs the same fork as the 300 XC) (research report 2026-09-07, section 2)'
   where make = 'Husqvarna' and model = 'TX 300' and year_start = 2017;

  -- 3c) KTM 250 / 300 XC two-strokes 2017 to 2023: the SX air fork, not the XC-W XPLOR.
  update public.bike_models
     set fork_type = 'WP AER 48 air', has_air_fork = true, stock_fork_spring_nmm = null,
         fork_type_verified = true,
         fork_type_source = 'MXA; Cycle News 2021 300 XC; Cycle World 2025 300 XC: XC two-strokes 2017 to 2023 ran the SX air fork (research report 2026-09-07, section 2)'
   where make = 'KTM' and model in ('250 XC', '300 XC') and year_start = 2017;
  -- The 2023 rows were seeded as "WP XACT coil": 2023 is air, 2024+ is the closed-cartridge coil.
  for r in select * from (values ('KTM','250 XC'), ('KTM','300 XC')) as t(make, model) loop
    perform public._split_bike_model_generation(r.make, r.model, 2023, 2024);
    update public.bike_models
       set fork_type = 'WP XACT air', has_air_fork = true, stock_fork_spring_nmm = null,
           fork_type_verified = true,
           fork_type_source = 'MXA; Cycle World 2025 300 XC (research report 2026-09-07, section 2)'
     where make = r.make and model = r.model and year_start = 2023;
    update public.bike_models
       set fork_type = 'WP XACT closed-cartridge coil', has_air_fork = false, stock_fork_spring_nmm = 4.4,
           fork_type_verified = true,
           fork_type_source = 'Transmoto; Dirt Bike Test 2024: 2024+ XC and XC-F moved to the WP XACT closed-cartridge coil fork (research report 2026-09-07, section 2)'
     where make = r.make and model = r.model and year_start = 2024;
  end loop;

  -- 3d) XC-F 2023+ (air) splits at 2024 (coil); GasGas EX 2021+ (air) splits at 2024 (coil).
  for r in select * from (values ('KTM','250 XC-F',2023), ('KTM','350 XC-F',2023), ('KTM','450 XC-F',2023),
                                  ('GasGas','EX 250F',2021), ('GasGas','EX 350F',2021), ('GasGas','EX 450F',2021), ('GasGas','EX 300',2021)) as t(make, model, old_start)
  loop
    perform public._split_bike_model_generation(r.make, r.model, r.old_start, 2024);
    update public.bike_models
       set fork_type_verified = true,
           fork_type_source = case when r.make = 'GasGas'
             then 'Transmoto 2024 (GasGas EX follows KTM XC: XACT air 2021 to 2023) (research report 2026-09-07, section 2)'
             else 'KTM XC-F EU manuals; MXA (XC-F matches the SX-F air fork) (research report 2026-09-07, section 2)' end
     where make = r.make and model = r.model and year_start = r.old_start;
    update public.bike_models
       set fork_type = 'WP XACT closed-cartridge coil', has_air_fork = false, stock_fork_spring_nmm = coalesce(stock_fork_spring_nmm, 4.4),
           fork_type_verified = true,
           fork_type_source = 'Transmoto; Dirt Bike Test 2024: 2024+ XC, XC-F and GasGas EX moved to the WP XACT closed-cartridge coil fork (research report 2026-09-07, section 2)'
     where make = r.make and model = r.model and year_start = 2024;
  end loop;
  -- XC-F 2017 to 2022 air rows.
  update public.bike_models
     set fork_type_verified = true,
         fork_type_source = 'KTM XC-F EU manuals; MXA (XC-F matches the SX-F air fork) (research report 2026-09-07, section 2)'
   where make = 'KTM' and model ~ ' XC-F$' and year_start = 2017;

  -- 3e) Coil enduro platforms: XC-W, EXC, EXC-F, TE, FE, EC.
  update public.bike_models
     set fork_type_verified = true,
         fork_type_source = 'KTM EXC-F owner''s manuals: WP XPLOR 48 coil on EXC-F, XC-W, TE, FE, EC (research report 2026-09-07, section 2). The 2024+ fork model name (XPLOR per the report, XACT closed cartridge per the seed) stays provisional; both are coil.'
   where has_air_fork = false
     and ((make = 'KTM' and model ~ '(XC-W|EXC|EXC-F)$')
       or (make = 'Husqvarna' and model ~ '^(TE|FE) ')
       or (make = 'GasGas' and model ~ '^EC '));

  -- 3f) Yamaha: KYB coil throughout.
  update public.bike_models
     set fork_type_verified = true,
         fork_type_source = 'Cycle News 2013; Vital MX; Yamaha manuals: KYB SSS coil on every YZ, YZ-F, FX and WR (research report 2026-09-07, section 2)'
   where make = 'Yamaha';

  -- 3g) Honda: CRF450R 2013 to 2016 air (new row), 2017+ coil; CRF250R 2018+ coil; RX and X coil.
  insert into public.bike_models
    (make, model, year_start, year_end, rear_suspension, fork_type, shock_type, has_air_fork,
     stock_fork_spring_nmm, stock_shock_spring_nmm, rider_weight_min_lbs, rider_weight_max_lbs,
     stock_sag_mm, sag_min, sag_max, spec_verified, fork_type_verified, fork_type_source)
  values
    ('Honda','CRF450R',2013,2016,'linkage','KYB PSF-2 air','Showa linkage',true,null,null,160,190,105,98,110,false,true,
     'Wikipedia CRF450R; MXA: KYB PSF then PSF-2 air fork 2013 to 2016 (research report 2026-09-07, section 2). Springs and sag not retrieved; provisional row.')
  on conflict (make, model, year_start) do nothing;
  update public.bike_models
     set fork_type_verified = true,
         fork_type_source = 'Wikipedia; MotoOnline; webBikeWorld: Showa 49 mm coil 2017+ (research report 2026-09-07, section 2)'
   where make = 'Honda' and model = 'CRF450R' and year_start >= 2017;
  update public.bike_models
     set fork_type_verified = true, fork_type_source = 'MX Locker OEM listing: Showa 49 mm coil 2018+ (research report 2026-09-07, section 2)'
   where make = 'Honda' and model = 'CRF250R';
  update public.bike_models
     set fork_type_verified = true, fork_type_source = 'Wikipedia CRF450X: Showa 49 mm coil 2019+ (research report 2026-09-07, section 2)'
   where make = 'Honda' and model in ('CRF450RX', 'CRF450X', 'CRF250RX');

  -- 3h) Kawasaki: KX450 2016 to 2018 SFF-Air (new row), 2019 to 2020 Showa coil, 2021+ KYB coil; KX250 coil.
  insert into public.bike_models
    (make, model, year_start, year_end, rear_suspension, fork_type, shock_type, has_air_fork,
     stock_fork_spring_nmm, stock_shock_spring_nmm, rider_weight_min_lbs, rider_weight_max_lbs,
     stock_sag_mm, sag_min, sag_max, spec_verified, fork_type_verified, fork_type_source)
  values
    ('Kawasaki','KX450',2016,2018,'linkage','Showa SFF-Air TAC','Showa linkage',true,null,null,160,195,105,98,110,false,true,
     'MXA; Dirt Bike: Showa SFF-Air TAC 2016 to 2018 (research report 2026-09-07, section 2). Springs and sag not retrieved; provisional row.')
  on conflict (make, model, year_start) do nothing;
  perform public._split_bike_model_generation('Kawasaki', 'KX450', 2019, 2021);
  update public.bike_models
     set fork_type_verified = true, fork_type_source = 'Cycle News; MXA: Showa 49 mm coil (A-Kit) 2019 to 2020 (research report 2026-09-07, section 2)'
   where make = 'Kawasaki' and model = 'KX450' and year_start = 2019;
  update public.bike_models
     set fork_type = 'KYB 48 coil', fork_type_verified = true,
         fork_type_source = 'Dirt Bike Test 2020 KX line: KYB coil 2021+ (research report 2026-09-07, section 2)'
   where make = 'Kawasaki' and model = 'KX450' and year_start = 2021;
  update public.bike_models
     set fork_type_verified = true,
         fork_type_source = 'Dirt Bike Test: KX250 coil throughout (Showa SFF-2 through 2019, KYB 48 mm from 2020 per the report; the seed names Showa 48 for 2021+, fork brand stays provisional) (research report 2026-09-07, section 2)'
   where make = 'Kawasaki' and model in ('KX250', 'KX250X');

  -- 3i) Suzuki: coil where the seed already says coil. The 2016 to 2018 RM-Z250 row
  -- (seeded KYB PSF-2 air) is NOT flipped: the report's "coil throughout" line does
  -- not address the PSF-2 years; it stays provisional and is listed for River.
  update public.bike_models
     set fork_type_verified = true, fork_type_source = 'Research report 2026-09-07, section 2: Suzuki RM-Z Showa coil (current generations)'
   where make = 'Suzuki' and has_air_fork = false;
end $$;

-- ── 4) Sag windows with manual or supplier citations ────────────────────────

update public.bike_models
   set stock_sag_mm = 105, sag_min = 102, sag_max = 112, stock_static_sag_mm = 33,
       sag_window_verified = true,
       sag_window_source = 'KTM 250 SX-F Owner''s Manual (KTM OM 2017 250 SX-F Art. 3213472en): riding sag 102 to 112 mm, static 33 mm, full protective clothing (research report 2026-09-07, section 1). Target 105 = MXA race setup inside the manual range.'
 where make = 'KTM' and model = '250 SX-F';
update public.bike_models
   set stock_sag_mm = 105, sag_min = 102, sag_max = 112, stock_static_sag_mm = 33,
       sag_window_verified = true,
       sag_window_source = 'KTM XC-F EU manuals (XC-F matches the SX-F platform); KTM 250 SX-F manual 102 to 112 mm, static 33 mm (research report 2026-09-07, section 1)'
 where make = 'KTM' and model = '250 XC-F';
update public.bike_models
   set stock_sag_mm = 105, sag_min = 102, sag_max = 112, stock_static_sag_mm = 33,
       sag_window_verified = true,
       sag_window_source = 'Husqvarna TC 250 Owner''s Manual (matches KTM); KTM 250 SX-F manual 102 to 112 mm, static 33 mm (research report 2026-09-07, section 1)'
 where make = 'Husqvarna' and model = 'FC 250';
update public.bike_models
   set stock_static_sag_mm = 35,
       sag_window_source = 'KTM 450 SX-F 2017 Owner''s Manual: static sag 35 mm; the riding sag range was not separately captured, window stays the platform convention (research report 2026-09-07, section 1)'
 where make = 'KTM' and model in ('450 SX-F', '450 SX-F Factory Edition');
update public.bike_models
   set stock_sag_mm = 105, sag_min = 100, sag_max = 110, static_sag_note = '30 to 35 mm',
       sag_window_verified = true,
       sag_window_source = 'KTM 250/350 EXC-F Owner''s Manuals; Rust Sports set-up guide: PDS riding sag about 100 to 110 mm, static 30 to 35 mm (research report 2026-09-07, section 1)'
 where rear_suspension = 'pds';
update public.bike_models
   set stock_sag_mm = 98, sag_min = 95, sag_max = 100, static_sag_note = '35 to 40 mm',
       sag_window_verified = true,
       sag_window_source = 'Sherco 250-300 SEF Owner''s Manual 2025: laden sag 95 to 100 mm, static 35 to 40 mm (research report 2026-09-07, section 1). Applies to the KYB era (2019+); do not apply to older Shercos.'
 where make = 'Sherco';
update public.bike_models
   set stock_sag_mm = 97, sag_min = 95, sag_max = 105, static_sag_note = '30 to 40 mm',
       sag_window_verified = true,
       sag_window_source = 'PulpMX 2023 YZ450F (Yamaha standard 97 to 98 mm); MotoSport sag guide 2023 YZ450F: 95 to 105 mm target, static 30 to 40 mm (research report 2026-09-07, section 1). Tuner and retailer sources, not the Yamaha manual page.'
 where make = 'Yamaha' and model = 'YZ450F' and year_start = 2023;
update public.bike_models
   set stock_sag_mm = 100, sag_min = 100, sag_max = 115, static_sag_note = '30 to 40 mm',
       sag_window_verified = true,
       sag_window_source = 'Beta Spring Rates Chart (Endurospec): rider sag about 100 mm; MotoSport Beta guides: race trim 100 to 115 mm, static 30 to 40 mm (research report 2026-09-07, section 1). Supplier chart, not a factory manual.'
 where make = 'Beta' and model ~ '^RR ';

-- ── 5) WP air bases (positive chamber) ─────────────────────────────────────

update public.bike_models set stock_air_bar = 8.6,  stock_air_bar_source = 'WP XACT PRO 7448 Owner''s Manual 07/2019: 125/150 SX 8.6 bar (125 psi) positive chamber; negative chamber set separately (research report 2026-09-07, section 3)' where make = 'KTM' and model in ('125 SX', '150 SX');
update public.bike_models set stock_air_bar = 8.6,  stock_air_bar_source = 'WP XACT PRO 7448 Owner''s Manual 07/2019 (125 SX value; TC 125 shares the platform, Husqvarna manual not separately retrieved) (research report 2026-09-07, section 3)' where make = 'Husqvarna' and model = 'TC 125';
update public.bike_models set stock_air_bar = 10.0, stock_air_bar_source = 'WP XACT PRO 7448 Owner''s Manual 07/2019: 250 SX 10.0 bar (145 psi) (research report 2026-09-07, section 3)' where make = 'KTM' and model = '250 SX';
update public.bike_models set stock_air_bar = 10.0, stock_air_bar_source = 'WP XACT PRO 7448 (250 SX value; TC 250 shares the platform, Husqvarna manual not separately retrieved) (research report 2026-09-07, section 3)' where make = 'Husqvarna' and model = 'TC 250';
update public.bike_models set stock_air_bar = 10.6, stock_air_bar_source = 'KTM 250 XC-F EU manual; WP XACT PRO 7448: 250 SX-F / FC 250 10.6 bar (154 psi), allowable 7 to 15 bar (research report 2026-09-07, section 3)' where (make = 'KTM' and model = '250 SX-F') or (make = 'Husqvarna' and model = 'FC 250');
update public.bike_models set stock_air_bar = 10.8, stock_air_bar_source = 'WP XACT PRO 7448 Owner''s Manual 07/2019: 350 SX-F / FC 350 10.8 bar (157 psi) (research report 2026-09-07, section 3)' where (make = 'KTM' and model = '350 SX-F') or (make = 'Husqvarna' and model = 'FC 350');
update public.bike_models set stock_air_bar = 10.5, stock_air_bar_source = 'Dirt Rider 2025 450 SX-F: about 10.5 bar stock (research report 2026-09-07, section 3). Magazine figure, not the WP manual line.' where make = 'KTM' and model in ('450 SX-F', '450 SX-F Factory Edition');

-- ── 6) Stock clicker positions where sourced ────────────────────────────────

update public.bike_models
   set stock_fork_comp = 15, stock_fork_reb = 15,
       stock_clicker_source = 'KTM 350 EXC-F Owner''s Manual 2021/2022: XPLOR comfort 18 / standard 15 / sport 12, compression and rebound (research report 2026-09-07, section 4)',
       stock_clicker_note = 'comfort 18, standard 15, sport 12 clicks out (both circuits)'
 where fork_type ilike '%xplor%' and has_air_fork = false;
update public.bike_models
   set stock_fork_comp = 12, stock_fork_reb = 18, stock_shock_comp = 10, stock_shock_hsc_turns = 1.5, stock_shock_reb = 15,
       stock_clicker_source = 'WP/KTM manuals; MXA 2023 450SXF: SX-F 2019+ fork comp 12 (EU 14), rebound 18, shock LSC 10, HSC 1.5 turns, rebound 15 (research report 2026-09-07, section 5)',
       stock_clicker_note = 'fork compression 12 US / 14 EU'
 where make = 'KTM' and model in ('250 SX-F', '350 SX-F', '450 SX-F', '450 SX-F Factory Edition') and year_start >= 2019;
update public.bike_models
   set stock_fork_comp = 12, stock_fork_reb = 18, stock_shock_comp = 10, stock_shock_hsc_turns = 1.5, stock_shock_reb = 15,
       stock_clicker_source = 'Shared platform with KTM SX-F 2023+ (research report 2026-09-07, section 5: Husqvarna FC/TC 2023+ matches KTM)',
       stock_clicker_note = 'fork compression 12 US / 14 EU'
 where make = 'Husqvarna' and model in ('FC 250', 'FC 350', 'FC 450') and year_start >= 2023;
update public.bike_models
   set stock_fork_comp = 10, stock_fork_reb = 13, stock_shock_hsc_turns = 1.0,
       stock_clicker_source = 'MXA 2023 YZ450F; MXA: YZ450F 2018+ fork comp 10, rebound 13, shock HSC 1 turn, shock spring 58 N/mm (research report 2026-09-07, section 5)'
 where make = 'Yamaha' and model = 'YZ450F' and year_start >= 2018;
update public.bike_models set stock_shock_comp = 10 where make = 'Yamaha' and model = 'YZ450F' and year_start >= 2023;

-- ── 7) Spring rates: confirmations, Sherco SEF, contested notes ─────────────

update public.bike_models
   set spring_rate_source = 'Dirt Bike Magazine 2024 500 EXC-F test; WP Suspension AU; Slavens Racing: MY2024 PDS moved to a straight spring, catalog 69 / 72 / 75 / 78 / 81 / 84 N/mm (research report 2026-09-07, section 6)'
 where rear_suspension = 'pds' and year_start >= 2024;
update public.bike_models
   set stock_fork_spring_nmm = 4.2, stock_shock_spring_nmm = 48,
       spring_rate_source = 'Sherco 250-300 SEF Owner''s Manual 2025: fork 4.0 (65 to 75 kg) / 4.2 standard (75 to 85 kg) / 4.4 (85 to 95 kg) N/mm; shock 46 / 48 standard / 50 N/mm (research report 2026-09-07, section 6)',
       spring_rate_note = 'fork 4.0 / 4.2 / 4.4 and shock 46 / 48 / 50 N/mm by 10 kg band'
 where make = 'Sherco' and model = 'SEF 300 Factory';
update public.bike_models
   set spring_rate_note = 'contested: 45 N/mm (platform standard, heavier riders) or 44 N/mm (one catalog); neither definitive (research report 2026-09-07, section 6)'
 where make = 'KTM' and model = '350 SX-F' and year_start >= 2023;
update public.bike_models
   set spring_rate_note = 'contested: 45 N/mm (heavier-rider standard) or 42 N/mm (under 175 lb); no single FC 250 manual statement (research report 2026-09-07, section 6)'
 where make = 'Husqvarna' and model = 'FC 250' and year_start >= 2023;
update public.bike_models
   set spring_rate_note = 'contested: 4.6 N/mm (Bud Racing enduro chart, 450/500 EXC-F run stiffer) or 4.2 N/mm; weight-dependent, neither definitive (research report 2026-09-07, section 6 and caveats)'
 where make = 'KTM' and model = '500 EXC-F';
update public.bike_models
   set spring_rate_note = 'contested: 4.4 N/mm (Bud Racing, K-Tech, shared XPLOR table) or 4.6 N/mm; no single Husqvarna manual line (research report 2026-09-07, section 6)'
 where make = 'Husqvarna' and model = 'FE 350' and year_start = 2017;
update public.bike_models
   set spring_rate_note = 'the FE shock rate sequence across generations was not found as a published sequence (research report 2026-09-07, section 6)'
 where make = 'Husqvarna' and model ~ '^FE ' and spring_rate_note is null;

-- ── 8) Reference rider weight range ─────────────────────────────────────────

update public.bike_models
   set rider_weight_min_lbs = 165, rider_weight_max_lbs = 187, weight_range_verified = true,
       weight_range_source = 'KTM owner''s manuals: "adjusted for an average rider''s weight of 75 to 85 kg (165 to 187 lb) with full protective clothing"; Sherco 250-300 SEF Owner''s Manual 2025 (research report 2026-09-07, sections 1 and 6)'
 where make in ('KTM', 'Husqvarna', 'Sherco');

-- ── 9) Cleanup and the coil audit ───────────────────────────────────────────

drop function public._split_bike_model_generation(text, text, int, int);

do $$
declare
  v_air_on_coil int;
  v_ambiguous int;
begin
  select count(*) into v_air_on_coil
    from public.setup_versions sv
    join public.bikes b on b.id = sv.bike_id
    join public.bike_models m on m.id = b.model_id
   where sv.fork_air_bar is not null and m.spec_verified and m.has_air_fork = false;
  select count(*) into v_ambiguous from public.bike_models where fork_type_ambiguous;
  raise notice 'coil audit after the research: % versions carry air on a verified coil row; % ambiguous 2016 rows', v_air_on_coil, v_ambiguous;
end $$;
