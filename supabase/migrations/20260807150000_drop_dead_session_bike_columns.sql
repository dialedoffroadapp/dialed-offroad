-- v2.4.0 data-capture step 3: drop columns no client has ever written.
--
-- Evidence (prod, 2026-08-07): sessions has 6,223 rows; terrain, rating_1_5,
-- tire_pressure_f, tire_pressure_r and elevation_ft are ALL 0 non-null
-- (elev_ft is the live elevation column, 3,483 non-null — the client writes
-- elev_ft, never elevation_ft). bikes has 20,104 rows; all five current_*
-- columns are 0 non-null. Client grep: zero references to any dropped column
-- (the only sessions "terrain" writes in code target setup_versions.terrain,
-- a different table). Only DB dependency: v_bikes_with_stock selects the
-- bikes.current_* columns — rebuilt below without them; its sole consumer
-- (components/TrialMomentCard.tsx) reads make/model/nickname/stock_fork_comp
-- and is unaffected.

alter table public.sessions
  drop column terrain,
  drop column rating_1_5,
  drop column tire_pressure_f,
  drop column tire_pressure_r,
  drop column elevation_ft;

-- create-or-replace cannot remove view columns; drop + recreate, preserving
-- the live view's exact properties: security_invoker=true (verified via
-- reloptions) and ACL {authenticated=SELECT, service_role=ALL, no anon}
-- (verified via relacl) — a recreated view starts with owner-only grants.
drop view public.v_bikes_with_stock;

alter table public.bikes
  drop column current_fork_comp,
  drop column current_fork_reb,
  drop column current_shock_comp,
  drop column current_shock_reb,
  drop column current_sag_mm;

-- Same definition as 20260715130000 minus the b.current_* columns.
create view public.v_bikes_with_stock
with (security_invoker = true) as
select
  b.id, b.user_id, b.make, b.model, b.year, b.tires, b.notes, b.is_primary,
  b.created_at, b.nickname, b.updated_at,
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

grant select on public.v_bikes_with_stock to authenticated;
grant all on public.v_bikes_with_stock to service_role;
