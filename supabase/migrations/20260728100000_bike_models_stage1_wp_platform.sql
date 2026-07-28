-- bike_models Stage 1: WP-platform coverage (KTM, Husqvarna, GasGas) + PDS
-- spring convention correction. Adds 63 generation rows to the 24 seeded by
-- 20260715130000. All Stage 1 rows are spec_verified = true.
--
-- PDS SPRING CONVENTION DECISION (Phase 0, 2026-07-28): stock_shock_spring_nmm
-- stores the TRUE engineering rate for every row, PDS included. Rationale: the
-- ai-tune engine never computes with spring rates (it only whitelists a
-- client-computed spring_check through safeShape); the client's
-- computeSpringCheck (lib/modelSpecs.ts) decides status purely from the
-- rider-weight range and carries the rates as DISPLAY values, which
-- tune-results renders verbatim ("shock 42 N/mm"). A displayed rate must be
-- the real rate: PDS shocks have no linkage reduction, so factory PDS springs
-- are far stiffer than their linkage-class siblings. The five pre-existing PDS
-- rows stored linkage-relative values and are corrected below.
--
-- True PDS rates, sources: K-Tech factory fitment charts (progressive family
-- 59-225-60/63/66 for 2017-2023) and WP off-road R&D (Sebastian Wolfgruber
-- via Transmoto) for the 2024+ linear rates (69 N/mm for the 250/350 EXC-F
-- class, 72 N/mm for 450/500). Two-stroke enduros (250/300 EXC, 250/300 XC-W)
-- take the softest progressive code (60) for 2017-2023 and the 250/350-class
-- linear 69 for 2024+, consistent with prod's prior relative ordering (2T one
-- step below the 350 EXC-F).

-- ── 1) Correct the five existing PDS rows to true rates ─────────────────────

update public.bike_models set stock_shock_spring_nmm = 60
  where make = 'KTM' and model = '300 EXC' and year_start = 2017;
update public.bike_models set stock_shock_spring_nmm = 69
  where make = 'KTM' and model = '300 EXC' and year_start = 2024;
update public.bike_models set stock_shock_spring_nmm = 60
  where make = 'KTM' and model = '300 XC-W' and year_start = 2017;
update public.bike_models set stock_shock_spring_nmm = 63
  where make = 'KTM' and model = '350 EXC-F' and year_start = 2017;
update public.bike_models set stock_shock_spring_nmm = 69
  where make = 'KTM' and model = '350 EXC-F' and year_start = 2024;

-- ── 2) Stage 1 generation rows ──────────────────────────────────────────────
-- year_end null = current/ongoing (matches the 20260715130000 convention).
-- Air forks: has_air_fork = true, stock_fork_spring_nmm = null.
-- Contested values resolved inline:
--   * 350 SX-F 2023+ shock 45 (Bud Racing lists 44; 45 matches the platform).
--   * FC 250 2023+ shock 45 (one Ride JBI listing says 42; 45 matches KTM twin).
--   * 500 EXC-F fork 4.6 (K-Tech, Bud Racing, and WP agree; the 4.2 on one
--     Slavens page is wrong; rear travel 310 mm per KTM official spec).
--   * FE 350 2017-2019 fork 4.4 (K-Tech 4.4 vs Bud Racing 4.6; the KTM
--     350 EXC-F twin is 4.4).
--   * Husqvarna FE line is LINKAGE rear (not PDS); rates are linkage-class.
--   * GasGas kept the XPLOR coil fork on EC models through 2024+ (no
--     generation split for a fork change); shocks 42 across the line per MXA.
--   * 150 SX mirrors the 125 SX platform values; TC 125 mirrors 125 SX shock;
--     250 XC mirrors 300 XC; TE 250 mirrors TE 300; 450 SX-F Factory Edition
--     mirrors 450 SX-F (generations split 2017-2022 / 2023+ to match).
--   * GasGas rider-weight ranges copied from the KTM equivalent displacement.

insert into public.bike_models
  (make, model, year_start, year_end, rear_suspension, fork_type, shock_type,
   has_air_fork, stock_fork_spring_nmm, stock_shock_spring_nmm,
   rider_weight_min_lbs, rider_weight_max_lbs, stock_sag_mm, sag_min, sag_max,
   spec_verified)
values
  -- KTM motocross / cross-country (linkage)
  ('KTM','350 SX-F',2016,2022,'linkage','WP AER 48 air','WP linkage',true,null,45,150,185,105,98,110,true),
  ('KTM','350 SX-F',2023,null,'linkage','WP XACT air','WP linkage',true,null,45,150,185,105,98,110,true),
  ('KTM','450 SX-F',2016,2022,'linkage','WP AER 48 air','WP linkage',true,null,45,160,195,105,98,110,true),
  ('KTM','450 SX-F',2023,null,'linkage','WP XACT air','WP linkage',true,null,45,160,195,105,98,110,true),
  ('KTM','450 SX-F Factory Edition',2017,2022,'linkage','WP AER 48 air','WP linkage',true,null,45,160,195,105,98,110,true),
  ('KTM','450 SX-F Factory Edition',2023,null,'linkage','WP XACT air','WP linkage',true,null,45,160,195,105,98,110,true),
  ('KTM','250 SX',2017,2022,'linkage','WP AER 48 air','WP linkage',true,null,42,150,180,105,98,110,true),
  ('KTM','250 SX',2023,null,'linkage','WP XACT air','WP linkage',true,null,42,150,180,105,98,110,true),
  ('KTM','150 SX',2016,2022,'linkage','WP AER 48 air','WP linkage',true,null,42,140,170,105,98,110,true),
  ('KTM','150 SX',2023,null,'linkage','WP XACT air','WP linkage',true,null,42,140,170,105,98,110,true),
  ('KTM','250 XC',2017,2022,'linkage','WP XPLOR 48 coil','WP linkage',false,4.4,45,155,185,105,98,110,true),
  ('KTM','250 XC',2023,null,'linkage','WP XACT coil','WP linkage',false,4.4,45,155,185,105,98,110,true),
  ('KTM','250 XC-F',2017,2022,'linkage','WP AER 48 air','WP linkage',true,null,45,150,180,105,98,110,true),
  ('KTM','250 XC-F',2023,null,'linkage','WP XACT air','WP linkage',true,null,45,150,180,105,98,110,true),
  ('KTM','350 XC-F',2017,2022,'linkage','WP AER 48 air','WP linkage',true,null,45,150,185,105,98,110,true),
  ('KTM','350 XC-F',2023,null,'linkage','WP XACT air','WP linkage',true,null,45,150,185,105,98,110,true),
  ('KTM','450 XC-F',2017,2022,'linkage','WP AER 48 air','WP linkage',true,null,45,160,195,105,98,110,true),
  ('KTM','450 XC-F',2023,null,'linkage','WP XACT air','WP linkage',true,null,45,160,195,105,98,110,true),
  -- KTM enduro (PDS, true shock rates per the convention above)
  ('KTM','250 EXC-F',2017,2023,'pds','WP XPLOR 48 coil','WP PDS',false,4.4,63,155,185,107,100,112,true),
  ('KTM','250 EXC-F',2024,null,'pds','WP XACT closed cartridge coil','WP PDS',false,4.4,69,155,185,107,100,112,true),
  ('KTM','450 EXC-F',2017,2023,'pds','WP XPLOR 48 coil','WP PDS',false,4.6,66,160,200,107,100,112,true),
  ('KTM','450 EXC-F',2024,null,'pds','WP XACT closed cartridge coil','WP PDS',false,4.6,72,160,200,107,100,112,true),
  ('KTM','500 EXC-F',2017,2023,'pds','WP XPLOR 48 coil','WP PDS',false,4.6,66,160,200,107,100,112,true),
  ('KTM','500 EXC-F',2024,null,'pds','WP XACT closed cartridge coil','WP PDS',false,4.6,72,160,200,107,100,112,true),
  ('KTM','250 XC-W',2017,2023,'pds','WP XPLOR 48 coil','WP PDS',false,4.4,60,150,180,107,100,112,true),
  ('KTM','250 XC-W',2024,null,'pds','WP XACT closed cartridge coil','WP PDS',false,4.4,69,150,180,107,100,112,true),
  ('KTM','250 EXC',2017,2023,'pds','WP XPLOR 48 coil','WP PDS',false,4.4,60,150,180,107,100,112,true),
  ('KTM','250 EXC',2024,null,'pds','WP XACT closed cartridge coil','WP PDS',false,4.4,69,150,180,107,100,112,true),
  -- Husqvarna motocross / cross-country (linkage)
  ('Husqvarna','FC 250',2016,2022,'linkage','WP AER 48 air','WP linkage',true,null,45,150,180,105,98,110,true),
  ('Husqvarna','FC 250',2023,null,'linkage','WP XACT air','WP linkage',true,null,45,150,180,105,98,110,true),
  ('Husqvarna','FC 350',2016,2022,'linkage','WP AER 48 air','WP linkage',true,null,45,150,185,105,98,110,true),
  ('Husqvarna','FC 350',2023,null,'linkage','WP XACT air','WP linkage',true,null,45,150,185,105,98,110,true),
  ('Husqvarna','FC 450',2016,2022,'linkage','WP AER 48 air','WP linkage',true,null,45,160,195,105,98,110,true),
  ('Husqvarna','FC 450',2023,null,'linkage','WP XACT air','WP linkage',true,null,45,160,195,105,98,110,true),
  ('Husqvarna','TC 125',2016,2022,'linkage','WP AER 48 air','WP linkage',true,null,42,130,165,105,98,110,true),
  ('Husqvarna','TC 125',2023,null,'linkage','WP XACT air','WP linkage',true,null,42,130,165,105,98,110,true),
  ('Husqvarna','TC 250',2017,2022,'linkage','WP AER 48 air','WP linkage',true,null,42,150,180,105,98,110,true),
  ('Husqvarna','TC 250',2023,null,'linkage','WP XACT air','WP linkage',true,null,42,150,180,105,98,110,true),
  ('Husqvarna','TX 300',2017,2022,'linkage','WP AER 48 air','WP linkage',true,null,42,150,180,105,98,110,true),
  ('Husqvarna','TX 300',2023,null,'linkage','WP XACT air','WP linkage',true,null,42,150,180,105,98,110,true),
  -- Husqvarna two-stroke enduro (linkage, mirrors TE 300)
  ('Husqvarna','TE 250',2017,2023,'linkage','WP XPLOR 48 coil','WP linkage',false,4.4,45,155,185,105,98,110,true),
  ('Husqvarna','TE 250',2024,null,'linkage','WP XACT closed cartridge coil','WP linkage',false,4.4,48,155,185,105,98,110,true),
  -- Husqvarna four-stroke enduro (LINKAGE rear, unlike KTM PDS)
  ('Husqvarna','FE 250',2017,2019,'linkage','WP XPLOR 48 coil','WP linkage',false,4.4,48,150,180,107,100,112,true),
  ('Husqvarna','FE 250',2020,2023,'linkage','WP XPLOR 48 coil','WP linkage',false,4.4,42,150,180,107,100,112,true),
  ('Husqvarna','FE 250',2024,null,'linkage','WP XACT closed cartridge coil','WP linkage',false,4.4,45,150,180,107,100,112,true),
  ('Husqvarna','FE 350',2017,2019,'linkage','WP XPLOR 48 coil','WP linkage',false,4.4,48,150,185,107,100,112,true),
  ('Husqvarna','FE 350',2020,2023,'linkage','WP XPLOR 48 coil','WP linkage',false,4.4,42,150,185,107,100,112,true),
  ('Husqvarna','FE 350',2024,null,'linkage','WP XACT closed cartridge coil','WP linkage',false,4.6,45,150,185,107,100,112,true),
  ('Husqvarna','FE 450',2017,2019,'linkage','WP XPLOR 48 coil','WP linkage',false,4.6,48,160,200,107,100,112,true),
  ('Husqvarna','FE 450',2020,2023,'linkage','WP XPLOR 48 coil','WP linkage',false,4.6,42,160,200,107,100,112,true),
  ('Husqvarna','FE 450',2024,null,'linkage','WP XACT closed cartridge coil','WP linkage',false,4.6,45,160,200,107,100,112,true),
  ('Husqvarna','FE 501',2017,2018,'linkage','WP XPLOR 48 coil','WP linkage',false,4.6,48,160,200,107,100,112,true),
  ('Husqvarna','FE 501',2019,2023,'linkage','WP XPLOR 48 coil','WP linkage',false,4.4,42,160,200,107,100,112,true),
  ('Husqvarna','FE 501',2024,null,'linkage','WP XACT closed cartridge coil','WP linkage',false,4.6,45,160,200,107,100,112,true),
  -- GasGas (all linkage; shock 42 across the board per MXA)
  ('GasGas','EC 300',2021,null,'linkage','WP XPLOR 48 coil','WP linkage',false,4.4,42,155,185,105,98,110,true),
  ('GasGas','EC 250',2021,null,'linkage','WP XPLOR 48 coil','WP linkage',false,4.4,42,150,180,105,98,110,true),
  ('GasGas','MC 125',2021,null,'linkage','WP XACT air','WP linkage',true,null,42,140,170,105,98,110,true),
  ('GasGas','MC 250F',2021,null,'linkage','WP XACT air','WP linkage',true,null,42,150,180,105,98,110,true),
  ('GasGas','MC 450F',2021,null,'linkage','WP XACT air','WP linkage',true,null,42,160,195,105,98,110,true),
  ('GasGas','EX 250F',2021,null,'linkage','WP XACT air','WP linkage',true,null,42,150,180,105,98,110,true),
  ('GasGas','EX 350F',2021,null,'linkage','WP XACT air','WP linkage',true,null,42,150,185,105,98,110,true),
  ('GasGas','EX 450F',2021,null,'linkage','WP XACT air','WP linkage',true,null,42,160,195,105,98,110,true),
  ('GasGas','EX 300',2021,null,'linkage','WP XACT air','WP linkage',true,null,42,155,185,105,98,110,true);
