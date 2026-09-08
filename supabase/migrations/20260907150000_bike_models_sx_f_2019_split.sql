-- Follow-up to 20260907140000: the sourced SX-F stock clicker positions apply
-- from model year 2019 (WP/KTM manuals; MXA), but the 2017 to 2022 SX-F rows
-- were not split there, so only the 2023+ rows received them. Split the 250,
-- 350 and 450 SX-F (and the Factory Edition) at 2019, repoint bikes, and
-- populate the 2019 to 2022 rows. STAGED, NOT PUSHED; applied to dev-3-0.

do $$
declare
  r record;
  v_old public.bike_models%rowtype;
  v_new_id uuid;
begin
  for r in select * from (values ('KTM','250 SX-F',2017), ('KTM','350 SX-F',2017), ('KTM','450 SX-F',2017), ('KTM','450 SX-F Factory Edition',2017)) as t(make, model, old_start)
  loop
    select * into v_old from public.bike_models where make = r.make and model = r.model and year_start = r.old_start;
    if not found then
      raise notice 'split skipped: % % %', r.make, r.model, r.old_start;
      continue;
    end if;
    insert into public.bike_models
      (make, model, year_start, year_end, rear_suspension, fork_type, shock_type, has_air_fork,
       stock_fork_spring_nmm, stock_shock_spring_nmm, rider_weight_min_lbs, rider_weight_max_lbs,
       stock_sag_mm, sag_min, sag_max, spec_verified, fork_comp_max, fork_reb_max, shock_comp_max,
       shock_reb_max, shock_hsc_turns_max, click_range_verified, sag_window_verified, weight_range_verified,
       fork_min, fork_max, shock_min, shock_max,
       fork_type_verified, fork_type_source, sag_window_source, stock_static_sag_mm, stock_air_bar, stock_air_bar_source, weight_range_source, spring_rate_note)
    values
      (v_old.make, v_old.model, 2019, v_old.year_end, v_old.rear_suspension, v_old.fork_type, v_old.shock_type, v_old.has_air_fork,
       v_old.stock_fork_spring_nmm, v_old.stock_shock_spring_nmm, v_old.rider_weight_min_lbs, v_old.rider_weight_max_lbs,
       v_old.stock_sag_mm, v_old.sag_min, v_old.sag_max, v_old.spec_verified, v_old.fork_comp_max, v_old.fork_reb_max, v_old.shock_comp_max,
       v_old.shock_reb_max, v_old.shock_hsc_turns_max, v_old.click_range_verified, v_old.sag_window_verified, v_old.weight_range_verified,
       v_old.fork_min, v_old.fork_max, v_old.shock_min, v_old.shock_max,
       v_old.fork_type_verified, v_old.fork_type_source, v_old.sag_window_source, v_old.stock_static_sag_mm, v_old.stock_air_bar, v_old.stock_air_bar_source, v_old.weight_range_source, v_old.spring_rate_note)
    returning id into v_new_id;
    update public.bike_models set year_end = 2018 where id = v_old.id;
    update public.bikes set model_id = v_new_id where model_id = v_old.id and year >= 2019;
  end loop;
end $$;

update public.bike_models
   set stock_fork_comp = 12, stock_fork_reb = 18, stock_shock_comp = 10, stock_shock_hsc_turns = 1.5, stock_shock_reb = 15,
       stock_clicker_source = 'WP/KTM manuals; MXA: SX-F 2019 to 2022 fork comp 12 (EU 14), rebound 18, shock LSC 10, HSC 1.5 turns, rebound 15 (research report 2026-09-07, section 5)',
       stock_clicker_note = 'fork compression 12 US / 14 EU'
 where make = 'KTM' and model in ('250 SX-F', '350 SX-F', '450 SX-F', '450 SX-F Factory Edition') and year_start = 2019;
