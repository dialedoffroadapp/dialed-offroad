-- bike_models Stage 2: Japanese makes, Beta, Sherco, Stark (29 rows), plus a
-- backfill re-run so the new models attribute existing bikes.
--
-- spec_verified = false marks PROVISIONAL rows: real research went in, but at
-- least one spring rate is unconfirmed against a factory/fitment source. The
-- client spec path (lib/modelSpecs.ts) trusts ONLY spec_verified = true rows,
-- so provisional rows surface nothing in-app; they still canonicalize strings
-- and attribute bikes.model_id for analytics until their rates are verified.
-- Rows whose stored values are all confirmed (even if some rates are null
-- because the factory does not publish them) stay spec_verified = true.
--
-- Contested/annotated values:
--   * RM-Z250 2019+ verified per MXA; the 2016-2018 PSF-2 air gen has a
--     provisional shock rate.
--   * KX250X mirrors the verified 2021+ KX250 row (same platform, off-road
--     valving only, springs unchanged).
--   * CRF450RWE mirrors CRF450R per year (premium internals, same springs);
--     split 2019-2020 / 2021+ to match the CRF450R generations.
--   * CRF450RX verified per Dirt Rider.
--   * Beta RR Race 300 verified per Ride JBI; RR 2T 250 / RR Race 250 mirror
--     their 300 siblings. Xtrainer 300 stores types + sag only (single
--     unpublished fork spring, rates unknown).
--   * Sherco publishes no shock rates; fork 4.6 is the KYB fitment.
--   * Stark Varg MX: shock spring is rider-weight-dependent by design (54 N/mm
--     at 120-135 lb up to 65 N/mm at 245-275 lb, swapped at purchase; OEM
--     suggestions run soft per Ride JBI) so no single rate is stored, types
--     and sag only. Wide rider range reflects the swappable spring.
--   * Minis (85s, 65s, 50s), Varg EX, FX 350/450, Tenere 700, KTM 690,
--     TM Racing, and pre-2005 models are explicitly out of scope this sprint.

insert into public.bike_models
  (make, model, year_start, year_end, rear_suspension, fork_type, shock_type,
   has_air_fork, stock_fork_spring_nmm, stock_shock_spring_nmm,
   rider_weight_min_lbs, rider_weight_max_lbs, stock_sag_mm, sag_min, sag_max,
   spec_verified)
values
  -- Suzuki
  ('Suzuki','RM-Z250',2016,2018,'linkage','KYB PSF-2 air','KYB linkage',true,null,52,150,185,108,100,112,false),
  ('Suzuki','RM-Z250',2019,null,'linkage','KYB 49 coil','KYB linkage',false,5.0,52,150,185,106,100,110,true),
  ('Suzuki','RM-Z450',2018,null,'linkage','Showa 49 coil','Showa linkage',false,5.0,56,160,195,108,100,112,false),
  -- Kawasaki
  ('Kawasaki','KX450',2019,null,'linkage','Showa 49 coil','Showa linkage',false,5.0,56,160,195,105,98,110,false),
  ('Kawasaki','KX250X',2021,null,'linkage','Showa 48 coil','Showa linkage',false,4.7,54,150,180,103,96,108,true),
  -- Yamaha
  ('Yamaha','YZ250',2006,2021,'linkage','KYB SSS 48 coil','KYB linkage',false,4.3,47,150,175,100,95,105,false),
  ('Yamaha','YZ250',2022,null,'linkage','KYB SSS 48 coil','KYB linkage',false,4.4,50,150,175,100,95,105,true),
  ('Yamaha','YZ125',2006,2021,'linkage','KYB SSS 48 coil','KYB linkage',false,4.1,46,120,160,100,95,105,true),
  ('Yamaha','YZ125',2022,null,'linkage','KYB SSS 48 coil','KYB linkage',false,4.1,46,120,160,100,95,105,true),
  ('Yamaha','YZ250X',2016,null,'linkage','KYB SSS 48 coil','KYB linkage',false,4.3,47,150,175,102,95,107,false),
  ('Yamaha','YZ125X',2020,null,'linkage','KYB SSS 48 coil','KYB linkage',false,4.1,46,120,160,102,95,107,false),
  ('Yamaha','WR450F',2016,null,'linkage','KYB SSS coil','KYB linkage',false,4.5,54,160,195,102,95,107,true),
  ('Yamaha','WR250F',2015,null,'linkage','KYB SSS coil','KYB linkage',false,4.5,50,150,180,102,95,107,false),
  ('Yamaha','YZ250FX',2016,null,'linkage','KYB SSS coil','KYB linkage',false,4.6,52,150,180,102,95,107,false),
  ('Yamaha','YZ450FX',2016,null,'linkage','KYB SSS coil','KYB linkage',false,4.6,56,160,195,102,95,107,false),
  -- Honda
  ('Honda','CRF250RX',2019,null,'linkage','Showa 49 coil','Showa linkage',false,4.7,52,150,180,105,98,110,false),
  ('Honda','CRF450RX',2019,null,'linkage','Showa 49 coil','Showa linkage',false,4.8,50,160,195,105,98,110,true),
  ('Honda','CRF450X',2019,null,'linkage','Showa 49 coil','Showa linkage',false,4.6,54,160,200,105,98,110,false),
  ('Honda','CRF450RWE',2019,2020,'linkage','Showa 49 coil','Showa linkage',false,4.8,54,160,190,105,98,110,true),
  ('Honda','CRF450RWE',2021,null,'linkage','Showa 49 coil','Showa linkage',false,5.0,56,160,190,105,98,110,true),
  -- Beta
  ('Beta','RR 2T 300',2020,null,'linkage','Sachs ZF 48 coil','Sachs linkage',false,4.6,50,150,185,105,98,110,false),
  ('Beta','RR Race 300',2020,null,'linkage','KYB 48 coil','KYB linkage',false,4.4,52,150,185,105,98,110,true),
  ('Beta','RR 2T 250',2020,null,'linkage','Sachs ZF 48 coil','Sachs linkage',false,4.6,50,150,185,105,98,110,false),
  ('Beta','RR Race 250',2020,null,'linkage','KYB 48 coil','KYB linkage',false,4.4,52,150,185,105,98,110,true),
  ('Beta','Xtrainer 300',2015,null,'linkage','Sachs 48 coil','Sachs linkage',false,null,null,140,200,105,98,110,true),
  -- Sherco
  ('Sherco','SE 300 Factory',2019,null,'linkage','KYB 48 coil','KYB linkage',false,4.6,null,150,185,105,98,110,true),
  ('Sherco','SEF 300 Factory',2019,null,'linkage','KYB 48 coil','KYB linkage',false,4.6,null,150,185,105,98,110,true),
  ('Sherco','SE 250 Factory',2019,null,'linkage','KYB 48 coil','KYB linkage',false,4.6,null,150,180,105,98,110,true),
  -- Stark
  ('Stark','Varg MX',2023,null,'linkage','KYB 48 coil','KYB linkage',false,null,null,130,250,98,95,101,true);

-- Aliases for Stage 2 models (lowercase + whitespace-collapsed; canon-key
-- matching already bridges 'rmz250', 'rm-z 250', 'kx 450', 'yz 250', etc.).
-- 'kx450f' / 'kx 450f' are Kawasaki's own pre-2019 names; bikes carrying them
-- with a pre-2019 year will still (correctly) fail the year range and stay
-- unmatched, since the KX450 row starts at 2019.

insert into public.bike_model_aliases (model_id, alias_make, alias_model)
select m.id, a.alias_make, a.alias_model
from (values
  ('kawasaki','kx450f','Kawasaki','KX450'),
  ('kawasaki','kx 450f','Kawasaki','KX450'),
  ('yamaha','yz250 2 stroke','Yamaha','YZ250'),
  ('yamaha','yz250 2t','Yamaha','YZ250'),
  ('beta','300 rr','Beta','RR 2T 300'),
  ('beta','xtrainer','Beta','Xtrainer 300'),
  ('stark','varg','Stark','Varg MX')
) as a(alias_make, alias_model, canon_make, canon_model)
join lateral (
  select b.id
  from public.bike_models b
  where b.make = a.canon_make and b.model = a.canon_model
  order by b.year_start
  limit 1
) m on true
on conflict (alias_make, alias_model) do nothing;

-- ── Backfill re-run ─────────────────────────────────────────────────────────
-- Same guarded waterfall as 20260728110000: canonical > alias > canon-key for
-- valid years (1990-2027); unique single-generation name match for invalid
-- years; never guess a generation.

do $$
declare
  valid_year_updated   int;
  invalid_assigned     int;
begin
  with
  nb as (
    select
      id, year,
      lower(btrim(regexp_replace(make,  '[[:space:]]+', ' ', 'g')))  as nmake,
      lower(btrim(regexp_replace(model, '[[:space:]]+', ' ', 'g')))  as nmodel,
      lower(regexp_replace(make,  '[[:space:]-]+', '', 'g'))          as kmake,
      lower(regexp_replace(model, '[[:space:]-]+', '', 'g'))          as kmodel
    from public.bikes
    where model_id is null
      and year between 1990 and 2027
  ),
  nm as (
    select
      id, make, model, year_start, year_end,
      lower(btrim(regexp_replace(make,  '[[:space:]]+', ' ', 'g')))  as nmake,
      lower(btrim(regexp_replace(model, '[[:space:]]+', ' ', 'g')))  as nmodel,
      lower(regexp_replace(make,  '[[:space:]-]+', '', 'g'))          as kmake,
      lower(regexp_replace(model, '[[:space:]-]+', '', 'g'))          as kmodel
    from public.bike_models
  ),
  cand as (
    select nb.id as bike_id, nm.id as model_id, 1 as priority, nm.year_start
    from nb
    join nm
      on nb.nmake = nm.nmake and nb.nmodel = nm.nmodel
     and nb.year between nm.year_start and coalesce(nm.year_end, 9999)
    union all
    select nb.id, gen.id, 2 as priority, gen.year_start
    from nb
    join public.bike_model_aliases a
      on a.alias_make = nb.nmake and a.alias_model = nb.nmodel
    join public.bike_models seed on seed.id = a.model_id
    join public.bike_models gen
      on gen.make = seed.make and gen.model = seed.model
     and nb.year between gen.year_start and coalesce(gen.year_end, 9999)
    union all
    select nb.id, nm.id, 3 as priority, nm.year_start
    from nb
    join nm
      on nb.kmake = nm.kmake and nb.kmodel = nm.kmodel
     and nb.year between nm.year_start and coalesce(nm.year_end, 9999)
  ),
  ranked as (
    select
      bike_id, model_id,
      row_number() over (
        partition by bike_id
        order by priority asc, year_start desc
      ) as rn
    from cand
  )
  update public.bikes b
  set model_id = ranked.model_id
  from ranked
  where ranked.rn = 1
    and b.id = ranked.bike_id
    and b.model_id is null;

  get diagnostics valid_year_updated = row_count;

  with
  nb as (
    select
      id,
      lower(btrim(regexp_replace(make,  '[[:space:]]+', ' ', 'g')))  as nmake,
      lower(btrim(regexp_replace(model, '[[:space:]]+', ' ', 'g')))  as nmodel,
      lower(regexp_replace(make,  '[[:space:]-]+', '', 'g'))          as kmake,
      lower(regexp_replace(model, '[[:space:]-]+', '', 'g'))          as kmodel
    from public.bikes
    where model_id is null
      and (year is null or year < 1990 or year > 2027)
  ),
  nm as (
    select
      id, make, model,
      lower(btrim(regexp_replace(make,  '[[:space:]]+', ' ', 'g')))  as nmake,
      lower(btrim(regexp_replace(model, '[[:space:]]+', ' ', 'g')))  as nmodel,
      lower(regexp_replace(make,  '[[:space:]-]+', '', 'g'))          as kmake,
      lower(regexp_replace(model, '[[:space:]-]+', '', 'g'))          as kmodel,
      count(*) over (partition by make, model) as gen_count
    from public.bike_models
  ),
  matches as (
    select nb.id as bike_id, nm.id as model_id, nm.gen_count
    from nb
    join nm on (nb.nmake = nm.nmake and nb.nmodel = nm.nmodel)
            or (nb.kmake = nm.kmake and nb.kmodel = nm.kmodel)
    union
    select nb.id, gen.id, cnt.gen_count
    from nb
    join public.bike_model_aliases a
      on a.alias_make = nb.nmake and a.alias_model = nb.nmodel
    join public.bike_models seed on seed.id = a.model_id
    join public.bike_models gen
      on gen.make = seed.make and gen.model = seed.model
    join lateral (
      select count(*) as gen_count
      from public.bike_models g2
      where g2.make = gen.make and g2.model = gen.model
    ) cnt on true
  ),
  uniq as (
    select bike_id, min(model_id::text)::uuid as model_id
    from matches
    group by bike_id
    having count(distinct model_id) = 1 and max(gen_count) = 1
  )
  update public.bikes b
  set model_id = u.model_id
  from uniq u
  where b.id = u.bike_id
    and b.model_id is null;

  get diagnostics invalid_assigned = row_count;

  raise notice 'stage 2 backfill: % valid-year rows matched, % invalid-year rows assigned via unique single-generation match',
    valid_year_updated, invalid_assigned;
end $$;
