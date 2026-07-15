-- One-time backfill of bikes.model_id (100% null across ~19,655 rows) against
-- the bike_models generation table + aliases (migration 20260715130000).
--
-- Single guarded UPDATE with a 3-strategy match waterfall (verified read-only;
-- ~30.1% hit rate expected, ~5,922 rows):
--   1. canonical  — lower/whitespace-normalized make+model equals a bike_models
--                   row, year within [year_start, coalesce(year_end, 9999)]
--   2. alias      — normalized lowercased make/model hits bike_model_aliases →
--                   its canonical model → re-resolved by the same year range
--   3. canon-key  — strip spaces+hyphens from both sides, lowercase, equal + year
-- Canonical beats alias beats canon-key; within a strategy the newest generation
-- (year_start desc) wins (ranges shouldn't overlap — this is just a guard).
-- Never overwrites a non-null model_id; non-matches are left null.
--
-- Wrapped in a DO block only to GET DIAGNOSTICS the row count for the notice.

do $$
declare
  updated_count int;
begin
  with
  nb as (
    -- null-model_id bikes with normalized + canon-key make/model
    select
      id, year,
      lower(btrim(regexp_replace(make,  '[[:space:]]+', ' ', 'g')))  as nmake,
      lower(btrim(regexp_replace(model, '[[:space:]]+', ' ', 'g')))  as nmodel,
      lower(regexp_replace(make,  '[[:space:]-]+', '', 'g'))          as kmake,
      lower(regexp_replace(model, '[[:space:]-]+', '', 'g'))          as kmodel
    from public.bikes
    where model_id is null
  ),
  nm as (
    -- bike_models generations with the same normalized forms
    select
      id, make, model, year_start, year_end,
      lower(btrim(regexp_replace(make,  '[[:space:]]+', ' ', 'g')))  as nmake,
      lower(btrim(regexp_replace(model, '[[:space:]]+', ' ', 'g')))  as nmodel,
      lower(regexp_replace(make,  '[[:space:]-]+', '', 'g'))          as kmake,
      lower(regexp_replace(model, '[[:space:]-]+', '', 'g'))          as kmodel
    from public.bike_models
  ),
  cand as (
    -- strategy 1: canonical (normalized equality) + year range
    select nb.id as bike_id, nm.id as model_id, 1 as priority, nm.year_start
    from nb
    join nm
      on nb.nmake = nm.nmake and nb.nmodel = nm.nmodel
     and nb.year between nm.year_start and coalesce(nm.year_end, 9999)
    union all
    -- strategy 2: alias → canonical model → year-range generation
    select nb.id, gen.id, 2 as priority, gen.year_start
    from nb
    join public.bike_model_aliases a
      on a.alias_make = nb.nmake and a.alias_model = nb.nmodel
    join public.bike_models seed on seed.id = a.model_id
    join public.bike_models gen
      on gen.make = seed.make and gen.model = seed.model
     and nb.year between gen.year_start and coalesce(gen.year_end, 9999)
    union all
    -- strategy 3: canon-key (strip spaces+hyphens) equality + year range
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
    and b.model_id is null;   -- never overwrite a resolved model_id

  get diagnostics updated_count = row_count;
  raise notice 'bikes.model_id backfill complete: % rows updated', updated_count;
end $$;
