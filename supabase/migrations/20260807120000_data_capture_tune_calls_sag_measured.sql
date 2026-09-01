-- v2.4.0 data-capture step 1 (additive only; nothing dropped or renamed).
--
-- tune_calls: only (user_id, ip, mode, anon_id, created_at) survive a tune
-- call today — the full request and the generated tune are discarded unless
-- the rider saves a setup_version (~14% of calls do). Capture both sides of
-- every call, promote rider weight to a queryable column, and add the fleet
-- aggregation key. Written exclusively by the ai-tune edge function
-- (service role); older deployed function versions simply leave them null.
--
-- sag_measured: sessions.sag_mm has 4 distinct values ever because it is a
-- defaulted constant, not a measurement. false = "not known to be measured",
-- which is the honest state for every existing row — hence no backfill.

alter table public.tune_calls
  add column input  jsonb,
  add column output jsonb,
  add column rider_weight_lbs integer,
  add column bike_model_id uuid references public.bike_models (id) on delete set null;

-- Fleet aggregation groups on model; partial index because every row before
-- clients send model_id (and every unmatched bike) is null.
create index tune_calls_bike_model_idx
  on public.tune_calls (bike_model_id)
  where bike_model_id is not null;

alter table public.sessions
  add column sag_measured boolean not null default false;

alter table public.setup_versions
  add column sag_measured boolean not null default false;

-- Intentionally NO RLS changes: tune_calls keeps RLS enabled with zero
-- policies (deny-all; service role bypasses). sessions/setup_versions use
-- table-level grants, which cover new columns automatically.
