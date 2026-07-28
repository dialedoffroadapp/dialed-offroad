-- bikes canonicalization + model_id backfill re-run (Phase 2 of the spec
-- coverage expansion; runs against the Stage 1 rows from 20260728100000).
--
-- 1) Normalize make casing/spacing residue for the covered brands. Source of
--    the bad strings: pre-v2.2.0 client binaries that inserted bikes without
--    normalizeBikeStrings (the canonicalization shipped in v2.2.0's
--    feat/bike-entry-canonicalization; no server-side path writes bikes, so
--    there is nothing to fix at the source anymore, just residue).
-- 2) Alias rows for observed user-entered variants that the backfill's
--    canon-key strategy (strip spaces+hyphens, lowercase) cannot bridge.
-- 3) Re-run the 3-strategy model_id backfill (same waterfall as
--    20260715140000) with a YEAR SANITY GUARD: bikes.year participates in
--    generation matching only when 1990-2027 (prod holds corrupt years: 24,
--    213, 2825, 20250, 5019, ...). Invalid-year bikes get a model_id only
--    when their name match is unambiguous AND the model has exactly one
--    generation; otherwise they stay null (never guess a generation).

-- ── 1) Make normalization ───────────────────────────────────────────────────
-- Canon-key equality (lowercase, strip spaces+hyphens) so 'Ktm', 'ktm',
-- 'Gas gas', 'Gas Gas', 'Gasgas', 'gas gas' all normalize. Misspellings
-- ('Husqavarna', 'Husquvarna', ...) are NOT touched: they are not case
-- variants and each is a 1-3 row singleton.
--
-- Collision guard: ux_bikes_unique_desc_per_user is (user_id, make, model,
-- year), and prod holds at least one user with BOTH a 'Ktm' and a 'KTM' row
-- for the same model+year. A row is skipped (stays misnamed, logged) when any
-- other row of the same user/model/year already holds, or would normalize to,
-- the canonical make.

do $$
declare
  normalized int;
  skipped    int;
begin
  with targets as (
    select b.id
    from public.bikes b
    join (values
      ('ktm','KTM'), ('husqvarna','Husqvarna'), ('gasgas','GasGas'),
      ('yamaha','Yamaha'), ('honda','Honda'), ('kawasaki','Kawasaki'),
      ('suzuki','Suzuki'), ('beta','Beta'), ('sherco','Sherco'), ('stark','Stark')
    ) as c(k, canon)
      on lower(regexp_replace(b.make, '[[:space:]-]+', '', 'g')) = c.k
     and b.make <> c.canon
    where not exists (
      select 1 from public.bikes d
      where d.id <> b.id
        and d.user_id is not distinct from b.user_id
        and d.model = b.model
        and d.year is not distinct from b.year
        and lower(regexp_replace(d.make, '[[:space:]-]+', '', 'g')) = c.k
    )
  )
  update public.bikes b
  set make = c.canon
  from (values
    ('ktm','KTM'), ('husqvarna','Husqvarna'), ('gasgas','GasGas'),
    ('yamaha','Yamaha'), ('honda','Honda'), ('kawasaki','Kawasaki'),
    ('suzuki','Suzuki'), ('beta','Beta'), ('sherco','Sherco'), ('stark','Stark')
  ) as c(k, canon)
  where b.id in (select id from targets)
    and lower(regexp_replace(b.make, '[[:space:]-]+', '', 'g')) = c.k;

  get diagnostics normalized = row_count;

  select count(*) into skipped
  from public.bikes b
  join (values
    ('ktm','KTM'), ('husqvarna','Husqvarna'), ('gasgas','GasGas'),
    ('yamaha','Yamaha'), ('honda','Honda'), ('kawasaki','Kawasaki'),
    ('suzuki','Suzuki'), ('beta','Beta'), ('sherco','Sherco'), ('stark','Stark')
  ) as c(k, canon)
    on lower(regexp_replace(b.make, '[[:space:]-]+', '', 'g')) = c.k
   and b.make <> c.canon;

  raise notice 'make normalization: % rows updated, % skipped (would collide with a duplicate row of the same user)',
    normalized, skipped;
end $$;

-- ── 2) Aliases ──────────────────────────────────────────────────────────────
-- Stored lowercase + whitespace-collapsed (what resolveModelId and the
-- backfill's strategy 2 look up). Only variants the canon-key strategy cannot
-- already bridge are added; each maps to the earliest generation of its
-- canonical model (year re-resolution happens at lookup time). Model ids are
-- looked up by name, never hardcoded.
--   * '450 sx-f factory' is the dominant observed string (89 rows) for the
--     Factory Edition.
--   * 'kx250f' is Kawasaki's own pre-2021 name for the KX250.
--   * 'crf450'/'crf250' truncations map to the R (motocross) models, by far
--     the most common intent; RX/X owners overwhelmingly type the suffix.

insert into public.bike_model_aliases (model_id, alias_make, alias_model)
select m.id, a.alias_make, a.alias_model
from (values
  ('ktm','450 sx-f factory','KTM','450 SX-F Factory Edition'),
  ('ktm','450 sxf factory','KTM','450 SX-F Factory Edition'),
  ('ktm','450 factory edition','KTM','450 SX-F Factory Edition'),
  ('kawasaki','kx250f','Kawasaki','KX250'),
  ('kawasaki','kx 250f','Kawasaki','KX250'),
  ('honda','crf450','Honda','CRF450R'),
  ('honda','crf250','Honda','CRF250R'),
  ('husqvarna','fc250','Husqvarna','FC 250'),
  ('husqvarna','fc350','Husqvarna','FC 350'),
  ('husqvarna','fc450','Husqvarna','FC 450'),
  ('ktm','sxf 250','KTM','250 SX-F'),
  ('ktm','sxf 350','KTM','350 SX-F'),
  ('ktm','sxf 450','KTM','450 SX-F'),
  ('ktm','excf 250','KTM','250 EXC-F'),
  ('ktm','excf 350','KTM','350 EXC-F'),
  ('ktm','excf 450','KTM','450 EXC-F'),
  ('ktm','excf 500','KTM','500 EXC-F'),
  ('ktm','exc 250','KTM','250 EXC'),
  ('ktm','xcw 250','KTM','250 XC-W'),
  ('ktm','xc 250','KTM','250 XC'),
  ('ktm','xcf 250','KTM','250 XC-F'),
  ('ktm','xcf 350','KTM','350 XC-F'),
  ('ktm','xcf 450','KTM','450 XC-F')
) as a(alias_make, alias_model, canon_make, canon_model)
join lateral (
  select b.id
  from public.bike_models b
  where b.make = a.canon_make and b.model = a.canon_model
  order by b.year_start
  limit 1
) m on true
on conflict (alias_make, alias_model) do nothing;

-- ── 3) Backfill re-run ──────────────────────────────────────────────────────

do $$
declare
  valid_year_updated   int;
  invalid_assigned     int;
  invalid_ambiguous    int;
begin
  -- Pass 1: valid-year bikes (1990-2027), the 20260715140000 waterfall:
  -- canonical > alias > canon-key; newest generation wins within a strategy.
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

  -- Pass 2: invalid-year bikes. Assign only when the name resolves to exactly
  -- one candidate row AND that model has a single generation. Multi-generation
  -- models stay null: the year cannot disambiguate, so we do not guess.
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

  select count(distinct m.bike_id) into invalid_ambiguous
  from (
    select nb.id as bike_id, nm.id as model_id
    from (
      select
        id,
        lower(btrim(regexp_replace(make,  '[[:space:]]+', ' ', 'g')))  as nmake,
        lower(btrim(regexp_replace(model, '[[:space:]]+', ' ', 'g')))  as nmodel,
        lower(regexp_replace(make,  '[[:space:]-]+', '', 'g'))          as kmake,
        lower(regexp_replace(model, '[[:space:]-]+', '', 'g'))          as kmodel
      from public.bikes
      where model_id is null
        and (year is null or year < 1990 or year > 2027)
    ) nb
    join (
      select
        id,
        lower(btrim(regexp_replace(make,  '[[:space:]]+', ' ', 'g')))  as nmake,
        lower(btrim(regexp_replace(model, '[[:space:]]+', ' ', 'g')))  as nmodel,
        lower(regexp_replace(make,  '[[:space:]-]+', '', 'g'))          as kmake,
        lower(regexp_replace(model, '[[:space:]-]+', '', 'g'))          as kmodel
      from public.bike_models
    ) nm on (nb.nmake = nm.nmake and nb.nmodel = nm.nmodel)
         or (nb.kmake = nm.kmake and nb.kmodel = nm.kmodel)
  ) m;

  raise notice 'backfill: % valid-year rows matched, % invalid-year rows assigned via unique single-generation match, % invalid-year rows matched a model but stayed null (multi-generation, year unusable)',
    valid_year_updated, invalid_assigned, invalid_ambiguous;
end $$;
