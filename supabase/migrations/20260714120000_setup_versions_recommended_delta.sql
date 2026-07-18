-- Tune Two v2: persist the engine's recommended settings, the settings the
-- rider actually applied, and the per-circuit delta from the parent version —
-- so every refine cycle is fully reconstructable for future cohort queries
-- (no ML/priors built here; schema support only).
--
-- Additive: no new tables, no data migration, no RLS/policy or grant changes.
-- setup_versions already grants SELECT, INSERT at the TABLE level (not column
-- level, see 20260706120000), so columns added here are automatically
-- client-insertable/selectable with no re-grant.
--
-- Columns:
--   recommended_settings  engine proposal snapshot (client-supplied passthrough)
--   applied_settings      what the rider ran (== recommended until an override
--                         UI ships; kept distinct now so that day needs no
--                         migration)
--   settings_delta        per-circuit change vs parent_version_id. SERVER-owned:
--                         a trigger always (re)computes it, so it is never
--                         client-authoritative ("no client-writable
--                         server-computed fields"). NULL for parentless rows.
-- All three share one key vocabulary (fork_comp, fork_reb, fork_air, shock_lsc,
-- shock_hsc, shock_reb, shock_sag) so a cohort query reads them uniformly.
-- Rows are immutable (no UPDATE grant/policy), so the jsonb snapshots can never
-- drift from the typed circuit columns they mirror.

alter table public.setup_versions
  add column if not exists recommended_settings jsonb,
  add column if not exists applied_settings     jsonb,
  add column if not exists settings_delta        jsonb;

-- Per-circuit delta vs the parent version, computed server-side on insert.
-- Overwrites any client-supplied value unconditionally. Reads the parent under
-- RLS as the invoker; the insert policy already guarantees the parent is
-- caller-owned. NULL delta for baselines (no parent) or a missing parent.
create or replace function public.assign_setup_version_delta()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  p record;
begin
  if new.parent_version_id is null then
    new.settings_delta := null;
    return new;
  end if;

  select fork_comp_clicks, fork_reb_clicks, fork_air_bar, shock_lsc_clicks,
         shock_hsc_turns, shock_reb_clicks, sag_mm
    into p
    from public.setup_versions
   where id = new.parent_version_id;

  if not found then
    new.settings_delta := null;
    return new;
  end if;

  -- jsonb_strip_nulls drops circuits where either side was NULL (e.g. an air
  -- fork added this round has no comparable baseline) rather than emitting a
  -- misleading null-typed key.
  new.settings_delta := jsonb_strip_nulls(jsonb_build_object(
    'fork_comp', new.fork_comp_clicks  - p.fork_comp_clicks,
    'fork_reb',  new.fork_reb_clicks   - p.fork_reb_clicks,
    'fork_air',  new.fork_air_bar      - p.fork_air_bar,
    'shock_lsc', new.shock_lsc_clicks  - p.shock_lsc_clicks,
    'shock_hsc', new.shock_hsc_turns   - p.shock_hsc_turns,
    'shock_reb', new.shock_reb_clicks  - p.shock_reb_clicks,
    'shock_sag', new.sag_mm            - p.sag_mm
  ));
  return new;
end;
$$;

-- BEFORE INSERT, fires before trg_setup_versions_version_number (alphabetical);
-- ordering is irrelevant — the delta depends only on parent columns.
create trigger trg_setup_versions_delta
  before insert on public.setup_versions
  for each row execute function public.assign_setup_version_delta();
