-- Suspension reference follow-up (River's prompt, 2026-09-08). Catalog
-- corrections only; the tuner clicker rows owed from the report file take
-- migration 20260907220000 when the file lands. STAGED for prod; applied to
-- dev-3-0.
--
-- 1) Sherco: the split at 2022 made by 20260907210000 is collapsed. The KYB
--    values (fork 13/13, shock LSC 14, HSC 1.5 turns, rebound 13) are
--    Factory-line owner's manual figures and belong on the Factory KYB rows
--    from their KYB start year (2019), not on a 2022+ half. The SEF-R Sachs
--    2019 to 2021 figures conflict with the catalog's KYB-from-2019 Factory
--    line and are written nowhere (docs/catalog-gaps.md).
-- 2) Beta RR Race Edition 2020 (catalog KYB, report Sachs) and Suzuki
--    RM-Z250 (catalog KYB shock, report BFRC): source conflicts, logged,
--    nothing written.
-- 3) app_config.weight_slope_cap_hsc_quarter_turns (2): the engine caps the
--    weight slope's HSC contribution the way it caps the click circuits.

do $$
declare
  r record;
  v_old uuid;
begin
  for r in select id, make, model, year_start from public.bike_models where make = 'Sherco' and year_start = 2022 loop
    select id into v_old from public.bike_models where make = r.make and model = r.model and year_start = 2019;
    if v_old is null then
      raise notice 'collapse skipped: % % has no 2019 row', r.make, r.model;
      continue;
    end if;
    -- bikes the split repointed come back to the one row
    update public.bikes set model_id = v_old where model_id = r.id;
    update public.setup_versions set bike_id = bike_id where false; -- no-op guard, versions reference bikes, not models
    delete from public.bike_models where id = r.id;
    update public.bike_models
       set year_end = null,
           stock_fork_comp = 13, stock_fork_reb = 13,
           stock_shock_comp = 14, stock_shock_hsc_turns = 1.5, stock_shock_reb = 13,
           stock_clicker_tag = 'factory',
           stock_clicker_source = 'Sherco Factory line owner''s manual (KYB fork, from the 2019 KYB start year): fork 13/13, shock LSC 14, HSC 1.5 turns, rebound 13 (research report 2026-09-07, second, sub-task 1a; attribution corrected by the 2026-09-08 follow-up)',
           stock_clicker_note = 'Factory-line KYB figures from the KYB start year. The SEF-R (Racing) Sachs 2019 to 2021 figures in the same report conflict with this KYB row and are not written (docs/catalog-gaps.md).'
     where id = v_old;
  end loop;
end $$;

-- No SEF-R wording may remain on any row.
update public.bike_models
   set stock_clicker_note = null
 where make = 'Sherco' and stock_clicker_note ilike '%SEF-R%' and stock_fork_comp is null;

insert into public.app_config (key, value)
values ('weight_slope_cap_hsc_quarter_turns', '2'::jsonb)
on conflict (key) do nothing;
