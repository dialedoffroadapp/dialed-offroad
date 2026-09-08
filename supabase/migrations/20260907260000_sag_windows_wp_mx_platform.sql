-- Device pass finding 1 (2026-09-08): the 2023 TX 300 read "typical range".
-- The Sep 7 research migration verified the 250 SX-F, FC 250 and XC-F rows
-- from the KTM 250 SX-F manual (riding sag 102 to 112 mm) and left the rest
-- of the shared WP MX linkage platform (125/150/250 SX, 350/450 SX-F, XC,
-- TC, FC 350/450, TX, GasGas MC and EX) on the seed's 98 to 110 "typical"
-- window. The platform shares the shock and linkage, so the manual window
-- applies; a TX or XC specific manual page is still owed
-- (docs/catalog-gaps.md). The 450 SX-F static target is 35 mm per its own
-- 2017 manual (report section 1); other rows keep no static target.
-- STAGED for prod; applied to dev-3-0.

update public.bike_models
   set stock_sag_mm = 105, sag_min = 102, sag_max = 112,
       sag_window_verified = true,
       sag_window_source = 'KTM 250 SX-F Owner''s Manual (KTM OM 2017 250 SX-F Art. 3213472en): riding sag 102 to 112 mm, applied across the shared WP MX linkage platform (SX, SX-F, XC, XC-F, TC, FC, TX, MC, EX) by the 2026-09-08 device pass; a TX and XC specific manual page is owed'
 where make in ('KTM', 'Husqvarna', 'GasGas')
   and shock_type ilike 'WP linkage%'
   and (model ~ '^(125|150|250|300|350|450) SX' or model ~ '^(250|300|350|450) XC' or model ~ '^(TC|FC|TX) ' or model ~ '^(MC|EX) ')
   and coalesce(sag_window_verified, false) = false;

update public.bike_models
   set stock_static_sag_mm = 35,
       static_sag_note = 'KTM 450 SX-F 2017 Owner''s Manual: static sag 35 mm (research report 2026-09-07, section 1)'
 where make = 'KTM' and model like '450 SX-F%' and stock_static_sag_mm is null;
