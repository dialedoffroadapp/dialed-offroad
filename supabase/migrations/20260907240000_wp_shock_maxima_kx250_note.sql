-- River's calls on the second report's leftovers (2026-09-08).
-- 1) WP shock maxima from the report (sub-task 1b), tag tuner, the midpoint
--    stored with the range in the note. click_range_verified stays false so
--    nothing shows; a factory confirmation is a flag flip, not a data hunt.
-- 2) Kawasaki KX250 2017 to 2020: the 15/15 stays with a note that it is
--    confirmed for 2017 to 2019 only; the 2020 boundary is a gaps item to
--    verify from a 2020 and a 2021 owner's manual, not a correction from one
--    magazine line.
-- RM-Z250 and the Beta conflicts stay logged, nothing written.
-- STAGED for prod; applied to dev-3-0.

update public.bike_models
   set shock_comp_max = 18, shock_hsc_turns_max = 2, shock_reb_max = 20,
       click_range_tag = coalesce(click_range_tag, 'tuner'),
       click_range_source = concat_ws('; ', click_range_source,
         'Slavens Racing "Inside the KTM WP TRAX Shock"; Vital MX KTM setup logs: WP linkage shock LSC about 17 to 20, HSC about 2 turns, rebound about 20 (tuner; research report 2026-09-07, second, sub-task 1b)'),
       click_range_note = concat_ws(' ', click_range_note,
         'WP linkage shock: LSC 18 stored as the midpoint of about 17 to 20, HSC 2 turns total, rebound 20 (tuner, Slavens and Vital MX). click_range_verified stays false; a factory confirmation is a flag flip.')
 where shock_type ilike 'WP linkage%';

update public.bike_models
   set shock_hsc_turns_max = 1.75,
       click_range_tag = coalesce(click_range_tag, 'tuner'),
       click_range_source = concat_ws('; ', click_range_source,
         'Slavens Racing: WP PDS shock HSC about 1.75 turns; LSC and rebound clicks, totals not stated (tuner; research report 2026-09-07, second, sub-task 1b)'),
       click_range_note = concat_ws(' ', click_range_note,
         'WP PDS shock: HSC 1.75 turns total (tuner, Slavens); LSC and rebound clicks, totals not stated. click_range_verified stays false.')
 where shock_type ilike 'WP PDS%';

update public.bike_models
   set stock_clicker_note = 'Shock values not found. The 15/15 Showa SFF standard is confirmed for 2017 to 2019 only: the report puts the KX250 on KYB SSS from 2020 while this row runs on Showa SFF through 2020. Verify from a 2020 and a 2021 KX250 owner''s manual before moving the boundary (docs/catalog-gaps.md).'
 where make = 'Kawasaki' and model = 'KX250' and year_start = 2017;
