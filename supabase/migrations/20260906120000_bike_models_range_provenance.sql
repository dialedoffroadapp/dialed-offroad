-- Decision 9 (engine discovery, 2026-09-05): the spring PASS/FAIL card is
-- gated to catalog rows whose sag window AND rider weight range are SOURCED,
-- the same rule click_range_verified applies to the range bars. The spring
-- rates in bike_models are annotated line by line with their sources
-- (20260728100000, 20260728120000); the sag windows (9 distinct combinations
-- across 116 rows) and the weight ranges (8 combinations, GasGas copied from
-- KTM) are platform conventions with no per-row source, so until each row's
-- values are confirmed the app must not present them as a verdict.
-- Both flags default false and no backfill runs: a row earns true only by a
-- migration that names its source. Additive; table-level SELECT grants
-- cover the new columns. STAGED, NOT PUSHED.

alter table public.bike_models
  add column if not exists sag_window_verified   boolean not null default false,
  add column if not exists weight_range_verified boolean not null default false;

comment on column public.bike_models.sag_window_verified is
  'stock_sag_mm / sag_min / sag_max confirmed against a factory or fitment source for THIS row. False = platform convention (still used as the engine target; never shown as a verdict).';
comment on column public.bike_models.weight_range_verified is
  'rider_weight_min_lbs / max confirmed against a factory or fitment source for THIS row. The spring check (computeSpringCheck) renders only when this AND sag_window_verified are true.';
