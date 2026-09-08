# Open questions, resolution, 2026-09-07

The research report (`~/Downloads/compass_artifact_wf-7c11d3ba-7da8-5780-b038-0d67090f74f9_text_markdown.md`, "Dirt Bike Suspension Reference: Verified Factory and Supplier Specifications") applied to every question in `docs/open-questions-2026-09-07.md`. Each entry: the answer, the source as the report gives it, what changed in the repo (commit on `feat/v3-integration` unless it says contract branch), and what remains for River. A row the report does not answer stays provisional and says so.

Where it landed. Catalog: migrations `20260907140000` (research) and `20260907150000` (SX-F 2019 split), committed `f2cb022` and `fd8ce1c`, APPLIED on the dev branch `dev-3-0` by psql with history rows (the branch history carries the contract branch's `20260907130000`, which the integration folder lacks, so `scripts/dev-branch.sh` refuses to push from integration; pushing from the contract branch works). STAGED for prod, not pushed. Client: `0a3a26b` (fork type, sag, air base, quiz question), `d426aef` (tires), `c8934ad` (adjuster locations, HSC comments), `6eefbde` (lifecycle recommendation). Contract branch `feat/engine-contract-v3`: `b8457e1` (spend cap, symptom annotations), merged with integration at `c75cba1`, `ai-tune` deployed to `dev-3-0` from it. Both branches pushed.

Dev branch after the migrations: 141 catalog rows (137 plus the four SX-F 2019 splits), `fork_type_verified` on 124, `fork_type_ambiguous` on 9, `sag_window_verified` on 32, `weight_range_verified` on 84, `stock_air_bar` on 30, stock clickers on about 33, the coil audit (air values on verified-coil versions) at 0. 126 existing bikes sit on the nine ambiguous 2016 rows.

Every migration row carries its source string in the column named for it (`fork_type_source`, `sag_window_source`, `stock_air_bar_source`, `stock_clicker_source`, `spring_rate_source`, `weight_range_source`); the strings below are the same ones.

---

## 1. Engine tuning

### 1.1 Formula coefficients
- **Answer:** not answerable by research. No published source gives a clicker-per-weight slope. The report does give per-model anchors the formula did not have: stock clicker positions for SX-F 2019+, XPLOR and YZ450F (2.7) and WP's base air pressure per model (1.2), plus tuner direction for skill (1.3).
- **Source:** report Sections 5 and 9 (stock positions, "heavier or faster riders: stiffer springs and more compression").
- **Changed:** nothing in the formula. The anchors now exist in the catalog for a later stock-anchored version.
- **River:** the coefficients, then outcome data through the regression script. Unchanged.

### 1.2 Air windows and slopes
- **Answer:** WP publishes ONE base pressure per model and an allowable range, no per-kilogram increment. Bases: 125/150 SX 8.6 bar, 250 SX 10.0, 250 SX-F and FC 250 10.6, 350 SX-F and FC 350 10.8, 450 SX-F about 10.5. Allowable range 7 to 15 bar (2017 KTM 250 XC-F EU manual). Off-road XC/TX/EX used the same hardware with softer valving and similar bases.
- **Source:** "WP XACT PRO 7448 Owner's Manual 07/2019 (ManualsLib); KTM 250 XC-F EU manual; Dirt Rider 2025 450 SX-F".
- **Changed:** `bike_models.stock_air_bar` on 30 rows with `stock_air_bar_source`. `generateTune` sends the row's base: on integration `defaultGuardrails` uses it instead of the flat 10.6; on the contract branch it goes as `aer_pressure_bar_default` only when the catalog has one, and the engine's discipline base is replaced by it while the slope stays the engine's. The engine window stays 7 to 14 (River's item 3: the manual's 15 is the ceiling of the hardware, not a riding value). The fork-air why-copy says "WP's base for this model is N bar" and calls the per-weight step our rule.
- **River:** where the clamp windows end, and the slope itself (0.2 per 10 lb is ours, the report has none). The 27 riders on a clamp are unchanged.

### 1.3 Skill and style weighting
- **Answer:** partial. Tuner guidance says heavier or faster riders take more compression and stiffer springs, Supercross or aggressive riders stiffen compression 2 to 6 clicks, enduro riders run softer. No source gives a number per skill level.
- **Source:** "Teknik offroad setup guide; Race Tech via ThumperTalk; MXA".
- **Changed:** nothing.
- **River:** how far skill moves a baseline. The report supports moving it more than zero.

### 1.4 The authored symptom rows
- **Answer:** annotated, not changed. `docs/symptom-table-draft.md` now carries a "Research 2026-09-07" column per row: wallows_dives agree (increase fork compression, check sag; silent on the LSC click); rear_squats agree (increase low-speed compression); too_soft agree by inference; arm_pump agree on compression and air, silent on rebound; chatters partial (reduce compression agrees, the report wants slightly FASTER rebound and our row slows it); rear_swaps ambiguous (the report reads swapping with kicking: too stiff on chop, soften HSC; too soft in whoops); harsh + big hits routed to bottoming agree; rear kicks + jump face agree in spirit (too soft, hold it up); rear kicks + braking bumps partial (slow rebound or soften compression, the report reads it as the rear's rebound while our route slows the fork's); rear kicks + logs and ledges silent; packs + rocks silent on the extra compression click, agree on faster rebound. The rear-kicks rows are the clearest case for the qualifiers.
- **Source:** report Section 9 ("Vital MX; Click Suspension; Race Tech; Teknik; MXA").
- **Changed:** `scripts/engine-tools/symptom_table.ts` and the regenerated draft (contract branch `b8457e1`).
- **River:** every row, as before. Chatters' rebound direction is the one place the report contradicts an authored move.

### 1.5 Which end bottoms
- **Answer:** the report separates the ends: bottoming front, raise oil height or add compression or air; bottoming rear, add HSC or preload or spring. That supports asking.
- **Source:** report Section 9.
- **Changed:** nothing (annotation on the bottoming row).
- **River:** whether the chip gets a front-or-rear qualifier.

### 1.6 Legacy ids without a v3 twin
- **Answer:** the report is silent.
- **River:** unchanged.

### 1.7 Severity mappings
- **Answer:** silent.
- **River:** unchanged.

### 1.8 Adaptive step
- **Answer:** silent.
- **River:** unchanged, then outcome data.

### 1.9 LLM in the synchronous path
- **Answer:** silent on the design question. The report does settle what happens when the model is refused for spend (5.1), which is now handled.
- **River:** unchanged.

### 1.10 Sag for an unmatched bike
- **Answer:** the platform manual's value when the make and platform are known: WP MX (SX, SX-F, FC, TC, MC, XC, XC-F, TX, EX) 105 inside 102 to 112; WP PDS enduro (EXC, XC-W, TE, FE, EC) 105 inside 100 to 110; Yamaha 97 inside 95 to 105; Sherco 98 inside 95 to 100; Beta 100 inside 100 to 115. Minis, Stark and unknown makes get nothing from the platform and keep the fallback.
- **Source:** "KTM 250 SX-F Owner's Manual (102 to 112 mm, static 33); KTM 250/350 EXC-F Owner's Manuals and Rust Sports (100 to 110); PulpMX and MotoSport for Yamaha (tuner sources); Sherco 250-300 SEF Owner's Manual 2025; Endurospec Beta chart and MotoSport (supplier and tuner sources)".
- **Changed:** `lib/sagBounds.ts:platformSagBounds(make, model)` with the source per platform; `resolveSagBounds(model, platform)` takes it before `DEFAULT_SAG`; both baseline builders pass it; the reveal meta records `sag_source` (model, platform, default). Test in `__tests__/catalogResearch.test.ts`.
- **River:** whether the weight term stays on the fallback path for the bikes no platform covers.

---

## 2. Catalog provenance

### 2.1 Sag windows
- **Answer:** the WP MX windows were platform conventions close to the manual; the manual values now replace them. 250 SX-F 102 to 112, static 33 (2017 manual); 450 SX-F static 35 (2017 manual), riding range not separately captured; XC and XC-F match the SX-F; PDS enduro about 100 to 110, static 30 to 35; Husqvarna matches KTM; Sherco SEF 95 to 100 laden, static 35 to 40; YZ450F 2023+ 95 to 105 with Yamaha's 97 to 98, static 30 to 40 (tuner sources); Beta RR 100 (race trim 100 to 115), static 30 to 40 (supplier and tuner sources). Not found: GasGas-specific pages, YZ250F, YZ125, YZ250, Honda, Kawasaki beyond a tuner baseline, Suzuki, Stark.
- **Source:** "KTM 250 SX-F Owner's Manual (ManualsLib), KTM OM 2017 250 SX-F Art. 3213472en; KTM 450 SX-F 2017 Owner's Manual; KTM 250/350 EXC-F Owner's Manuals; Rust Sports set-up guide; Husqvarna TC 250 Owner's Manual; PulpMX 2023 YZ450F; MotoSport sag guide; Beta Spring Rates Chart (Endurospec); Sherco 250-300 SEF Owner's Manual 2025".
- **Changed:** migration `20260907140000` writes `stock_sag_mm`, `sag_min`, `sag_max`, `stock_static_sag_mm`, `static_sag_note`, `sag_window_source` and sets `sag_window_verified` on the rows the report covers (32). Rows the report does not cover keep their window, stay unverified and read "typical range" in the app.
- **River:** nothing on the verified rows. Yamaha and Beta values come from tuners and suppliers, not a factory page; they are marked so in `sag_window_source` and count as verified because River's instruction listed them.

### 2.2 The 2016 SX, SX-F, FC and TC rows
- **Answer:** both. Europe got the WP AER 48 in 2016; the US and Australia kept the WP 4CS coil through 2016; AER went worldwide for 2017. KTM's product manager is quoted: WP did not have the capacity to build AER for the whole 2016 production, so the bikes sent to the USA and Australia kept the 4CS for another year.
- **Source:** "Transmoto (Joachim Sauer quote); eBay OEM listings".
- **Changed:** the nine 2016 rows (KTM 125 SX, 150 SX, 250 SX-F, 350 SX-F, 450 SX-F; Husqvarna FC 250, FC 350, FC 450, TC 125) are split at 2017. The 2016 row reads `fork_type` "WP AER 48 air (EU) or WP 4CS coil (US, Australia)", `has_air_fork` NULL, `fork_type_ambiguous` true. The 2017+ row is verified air. Add a bike asks "Air or coil fork?" after the year on an ambiguous row (`app/quiz/bike.tsx`, third phase) and stores the answer on the bike (`bikes.air_fork_override`, guest bike `airFork` until sign-up, `answers.airForkOverride` for the run). Every fork-type decision goes through `lib/modelSpecs.ts:effectiveAirFork(specs, override)`: catalog flag, else the stored answer, else the caller's fallback. The coil audit re-ran at 0.
- **River:** the 126 existing bikes on ambiguous rows have no stored answer; they fall to the caller's fallback (a saved air value, or the toggle) until asked. Decide where returning riders get the question (the bike page is the natural place; not built).

### 2.3 KTM 250 and 300 XC two-strokes
- **Answer:** air. The XC two-strokes 2017 to 2023 ran the same WP AER 48 / XACT air fork as the SX, not the XPLOR coil of the XC-W. For 2024+ the whole XC and XC-F line moved to the WP XACT closed-cartridge coil fork while SX and SX-F stayed air. GasGas EX follows KTM XC (air 2021 to 2023, coil 2024+).
- **Source:** "MXA; Cycle News 2021 300 XC; Transmoto 2024; Dirt Bike Test 2024; Cycle World 2025 300 XC".
- **Changed:** 250 and 300 XC 2017 rows flipped to "WP AER 48 air", verified; XC 2023 rows split at 2024 (2023 air, 2024+ "WP XACT closed-cartridge coil"); XC-F 2023 and GasGas EX 2021 rows split at 2024 the same way.
- **River:** the 2024+ coil fork's exact WP name is provisional in the row string (the report says "WP XACT closed-cartridge"); confirm from a 2024 XC manual when one is in hand.

### 2.4 Rider weight ranges
- **Answer:** KTM, Husqvarna and Sherco manuals state the reference rider: 75 to 85 kg (165 to 187 lb) with full protective clothing. Japanese makes and GasGas: not found (GasGas shares the platform but no GasGas page was retrieved).
- **Source:** "KTM owner's manuals: adjusted for an average rider's weight of 75 to 85 kg with full protective clothing; Sherco 250-300 SEF Owner's Manual 2025".
- **Changed:** `rider_weight_min_lbs` 165 and `rider_weight_max_lbs` 187 with `weight_range_source` and `weight_range_verified` on KTM, Husqvarna and Sherco rows (84). Japanese and GasGas rows keep their copied ranges, unverified, so the spring card stays gated for them.
- **River:** nothing on the verified rows. `catalog_constants.reference_rider` holds the same fact with its source.

### 2.5 Provisional and contested spring rates
- **Answer:** PDS 2024+ confirmed linear: the tested 500 EXC-F came with a straight 72 N/mm; WP's 2024 PDS catalog runs 69, 72, 75, 78, 81, 84. Sherco publishes: 250/300 SEF fork 4.0 (65 to 75 kg), 4.2 standard (75 to 85 kg), 4.4 (85 to 95 kg); shock 46, 48 standard, 50. Contested rows: 350 SX-F shock 45 versus 44 (catalogs list both, 45 is the heavier-rider standard, not resolved for the 350); FC 250 2023+ 42 versus 45 (42 under 175 lb, 45 above; no single manual line); 500 EXC-F fork 4.6 versus 4.2 (450/500 run 4.4 to 4.6, 250/350 run 4.2 to 4.4; weight-dependent, do not present one value as definitive); FE 350 2017 to 2019 fork 4.4 (shared XPLOR table). The FE shock sequence: not found as a single published sequence. The 13 provisional Japanese, Beta and Honda rows: not individually retrieved; Race Tech and fitment charts only. Beta Xtrainer: Beta USA publishes charts (not retrieved). Sherco 450/500 SEF table: not retrieved. Older Shercos (about 2014 to 2018) had Sachs or WP forks, so the 2025 KYB rates must not be applied to them.
- **Source:** "Dirt Bike Magazine 2024 500 EXC-F test; WP Suspension AU; Slavens Racing; Sherco 250-300 SEF Owner's Manual 2025; MXA 2023 450SXF; Bud Racing enduro chart; K-Tech".
- **Changed:** Sherco SEF 300 fork 4.2 and shock 48 with `spring_rate_source`; the contested rows carry `spring_rate_note` naming both values and the weight split; PDS 2024+ rows carry the confirmation source. `catalog_constants.spring_rate_slope` stores the published slope (about 0.2 N/mm fork and 2 N/mm shock per 10 kg, roughly 0.09 and 0.9 per 10 lb) with its source ("Sherco 2025 SEF chart; KTM XPLOR table"). No spring suggestion ships; the report itself says to present any such number as a starting point and to change springs only when riding sag cannot be reached at correct static sag.
- **River:** the 13 provisional rows stay provisional; the contested rows stay contested with both values recorded.

### 2.6 Click and HSC turn ranges per family
- **Answer:** partial. XPLOR: comfort 18, standard 15, sport 12 out (both circuits). KYB SSS: about 20 clicks, standard about 10 comp and 13 rebound out. WP AER/XACT: "per WP table", standard 14 out EU or 15 US on the SX-F, 450 standard 18. HSC on WP, KYB and Showa shocks is in turns, continuous. No per-family maximum table was found.
- **Source:** "KTM 350 EXC-F Owner's Manual 2021/2022; MXA 2023 YZ450F; Yamaha manual; WP XACT PRO 7448 manual".
- **Changed:** nothing; `click_range_verified` stays false everywhere and the range bars stay hidden.
- **River:** research per family is still needed for the maxima; the standard positions above are in the stock clicker columns instead (2.7).

### 2.7 Stock clicker positions
- **Answer:** XPLOR (EXC-F, 300 EXC, XC-W, TE, FE, EC 2017+) 15 comp, 15 rebound; SX-F 2019 to 2022 and 2023+ 12 comp (EU 14), 18 rebound, shock LSC 10, HSC 1.5 turns, rebound 15; YZ450F 2018+ 10 comp, 13 rebound, HSC 1 turn, 5.0 N/mm fork, 58 N/mm shock; Kawasaki KX450 2021+ about 11 to 12 comp (tuner); the rest not found (Honda, Suzuki, YZ250F, YZ125, YZ250, KTM SX two-strokes "per table").
- **Source:** "KTM EXC-F manual; WP/KTM manuals; MXA 2023 450SXF; MXA 2023 YZ450F".
- **Changed:** `stock_fork_comp`, `stock_fork_reb`, `stock_shock_comp`, `stock_shock_reb`, `stock_shock_hsc_turns` with `stock_clicker_source` and `stock_clicker_note` on the rows above (about 33); the SX-F and Factory Edition rows were split at 2019 (`20260907150000`) so the 2019 to 2022 numbers land on the right years. Everything else null. `v_bikes_with_stock` now has real values to read for these rows.
- **River:** nothing. The EU-versus-US 12/14 difference is in the note, 12 stored.

### 2.8 Which models next, minis
- **Answer:** the report added two rows the catalog lacked (Honda CRF450R 2013 to 2016 KYB PSF-2 air, Kawasaki KX450 2016 to 2018 Showa SFF-Air TAC, both provisional on springs) and the KX450 2019 to 2020 Showa versus 2021+ KYB split. Scope is River's.
- **Source:** "Wikipedia CRF450R; MXA; Dirt Bike; Cycle News; Dirt Bike Test 2020 KX line".
- **Changed:** those rows and the split (`20260907140000`).
- **River:** minis and the rest of the unmatched list, unchanged.

### 2.9 PDS 2024+ rates and K-Tech codes
- **Answer:** the 2024+ linear rates are confirmed (69 and 72 N/mm in WP's catalog, the tested 500 came with 72). The K-Tech progressive codes for 2017 to 2023 were not re-checked by the report.
- **Source:** "Dirt Bike Magazine 2024 500EXC-F test; WP Suspension AU; Slavens Racing".
- **Changed:** `spring_rate_source` on the 2024+ PDS rows.
- **River:** nothing.

---

## 3. Physics and practice

### 3.1 Conditions rules
- **Answer:** agreement per rule, no rule changed (River's item 10). Sign convention: our deltas are clicks out, so a negative delta is firmer.

| Rule (ours) | Report | Verdict |
|---|---|---|
| Choppy hardpack: +1 fork comp (softer) | rough or choppy track: soften compression front and rear for wheel contact | agree on the fork; the report also softens the shock, we do not |
| Rutted hardpack: +1 fork rebound (faster) | ruts and sand: MORE low-speed compression and rebound damping | disagree on rebound direction (the report wants slower); silent on our not touching compression |
| Sand or non-fresh loam: -1 fork comp, -1 fork rebound (firmer, slower) | sand often wants stiffer overall; more compression and rebound | agree on both circuits |
| Mud: -2 fork comp (firmer) | add compression, and spring rate if possible, to carry the extra weight | agree |
| Hot: -0.2 bar on an air fork, else -1 shock LSC (firmer) | heat raises air pressure, set cold and recheck; hot oil damps less and feels softer | agree on both legs |
| Cold: +0.1 bar | cold air reads low; oil thickens and feels harsher | agree on the air move; the report's harsher-oil note argues for nothing firmer on coil, which matches our no-op |
| Watered: -0.5 psi tires | freshly watered: treat like soft or slick, may drop tire pressure and soften compression | agree on tires |
| Watered (retune): take back the morning's chop softening (firmer) | soften compression for traction | disagree |
| Roughed (retune): -1 fork comp (firmer) | rough track: soften compression | disagree |
| Heating (retune): -0.1 bar, else -1 fork comp | hot oil damps less | agree |

- **Source:** report Section 9 ("Rough/choppy", "Ruts/sand", "Mud", "Hot vs cold days on air forks", "Freshly watered tracks").
- **Changed:** nothing. The parity test still locks both sides to the current rules.
- **River:** three rules go the other way from the report: rutted rebound direction, the watered take-back, and the roughed firming. Our sand and mud rules agree with the report (both firmer); the earlier note that they went the other way read the sign backwards.

### 3.2 Tire pressure defaults
- **Answer:** Dunlop: MX hardpack and intermediate 12 front, 12.5 rear (four-stroke fronts often 13 to 14); soft 12 / 12; sand 11 to 12; mud 12 front, 10 rear or lower; off-road 13 / 14; desert and rocks 14 to 16. Michelin, Bridgestone and Pirelli charts: not found.
- **Source:** "Dunlop Motorcycle Tires, Geomax off-road tire pressure guidance; Dunlop (Brian Fleck, TWMX); Moto-House MX; MXA '10 things about tire air pressure'".
- **Changed:** `TIRE_DEFAULT_PSI` is now per discipline and surface with those numbers (MX sand 12 / 11.5 inside Dunlop's range, off-road sand 12 / 12), `TIRE_PRESSURE_SOURCE` records the source, reason copy says "Dunlop starting point", `tirePressureForToday` takes the discipline and Today's setup passes it from the bike. The watered half psi stays ours. Start still never persists a default.
- **River:** nothing.

### 3.3 Adjuster locations
- **Answer:** WP AER 48 and XACT air: air valve under the LEFT cap, compression AND rebound clickers under the RIGHT cap, adjusted by hand, nothing at the axle. XPLOR: compression cap left, rebound cap right, no bottom adjusters. WP shocks: LSC and HSC on the reservoir, rebound at the bottom. KYB SSS: clickers on the fork top caps (by hand on 2023+). Showa coil (Honda): top caps; the shock adjusters moved from left to right in 2021. KYB PSF-2: left leg compression, right leg rebound, air both legs. Öhlins: not found.
- **Source:** "WP XACT PRO 7448 manual; KTM manuals; KTM 350 EXC-F Owner's Manual 2021/2022; MXA 2023 YZ450F; MotoOnline 2021 CRF450R; MXA 2015 forks guide".
- **Changed:** `lib/adjusterLocations.ts` WP AER and XACT air rows send the rider to the right cap for both clickers (they sent rebound to the axle lug); XPLOR and the WP shock rows say no bottom adjusters exist; the file header cites the sources and names the rows still DRAFT (kyb_sss, kyb_psf2, showa, ohlins, sachs, generic). Audit decision 6 (AER rebound at the bottom of the right leg) is superseded by the manual.
- **River:** the weekend's photos, and the KYB, Showa and Öhlins rows. The report's KYB SSS note (clickers on the top caps) does not match our kyb_sss row (compression at the bottom), so that row is flagged, not changed.

### 3.4 Count-from-closed
- **Answer:** confirmed for KTM/WP and Yamaha: turn the adjuster fully clockwise to the stop, count clicks out counterclockwise, one at a time. Split-function forks carry both clickers on the damping leg; XPLOR splits compression left and rebound right; KYB SSS and Showa twin-chamber forks carry damping in both legs.
- **Source:** "KTM manuals; WP XACT PRO 7448; Yamaha manual".
- **Changed:** the convention line stands; the file header states it.
- **River:** nothing for WP and KYB; Showa and Öhlins per manual later.

### 3.5 HSC step
- **Answer:** WP publishes high-speed compression in turns and the knob turns continuously; no detent is documented for any family. KYB and Showa: HSC in turns, continuous.
- **Source:** "KTM manuals; MXA".
- **Changed:** the quarter-turn stepper stays (River's item 8); the two comments that called it hardware granularity now say it is our display and storage step; copy never claimed a detent.
- **River:** flagged open, as asked: whether a quarter turn is the right step for the UI.

### 3.6 Measuring sag
- **Answer:** KTM and Husqvarna: raise the bike so the wheel hangs, measure axle to a fixed point as A; on its wheels unloaded as B; with the rider seated in full gear as C. Static sag = A minus B, riding sag = A minus C. Set the shock first, then the fork. Yamaha marks a dimple on the rear fender as the reference. Static targets: KTM MX 33 to 35, KTM enduro 30 to 35, Yamaha 30 to 40, Sherco 35 to 40. If riding sag cannot be reached with static sag correct, the spring rate is wrong: change the spring, not the preload.
- **Source:** "KTM EXC-F manuals; Rust Sports guide; MotoSport; Sherco 2025 SEF manual".
- **Changed:** nothing in code (the walkthrough is a design-queue item). Design note for it, per River's item 12: three measurements, store riding sag as `sag_measured` and static sag when all three are taken; the preload-versus-spring rule becomes a roadmap note family ("static right, riding out of range: spring, not preload"). The catalog now holds `stock_static_sag_mm` per row for the comparison.
- **River:** the walkthrough itself. The catalog's `stock_sag_mm` is riding sag with the rider in full gear on every sourced row.

---

## 4. Product and business

### 4.1 Flip trigger and rollback
- **Answer:** silent.
- **River:** unchanged.

### 4.2 Minis and out-of-scope bikes
- **Answer:** silent on the product question; no mini specs in the report.
- **River:** unchanged.

### 4.3 Discipline-localized chips
- **Answer:** silent.
- **River:** unchanged.

### 4.4 Where discipline persists
- **Answer:** silent.
- **River:** unchanged.

### 4.5 Pre-auth queue cap
- **Answer:** silent.
- **River:** unchanged.

### 4.6 Retention on attributed `tune_calls`
- **Answer:** silent.
- **River:** unchanged.

### 4.7 Track creation to the server
- **Answer:** silent.
- **River:** unchanged.

### 4.8 `tune_calls` version link and `bike_id` column
- **Answer:** silent.
- **River:** unchanged.

### 4.9 Boise tracks and season dates
- **Answer:** silent.
- **River:** unchanged.

### 4.10 Claude Code homework
- **Answer:** not a research question.
- **River:** priorities, unchanged.

---

## 5. External

### 5.1 OpenAI spend cap
- **Answer:** hard monthly spend limits exist again. Earlier in 2026 OpenAI removed hard caps and left alerts only; the week of July 22, 2026 it reintroduced hard limits at organization and project level that stop traffic. Once tracked spend reaches the cap, calls return HTTP 429 with `organization_spend_limit_exceeded` or `project_spend_limit_exceeded` until the next billing cycle; enforcement is not instantaneous. The hard-limit toggle rolls out per account; prepaid credits with auto-recharge off are the fallback hard stop.
- **Source:** "OpenAI docs (via AlphaSignal, AI/TLDR, Omid Saffari, Grafient, Bursora, Alephant, July to August 2026)".
- **Changed (contract branch):** the edge tells the two codes apart (`openAIError`, `SpendLimitError`) at both model-call sites. In llm mode the formula's numbers ship tagged `engine_source: "spend_limited"` with the note "Tuning is paused: our model budget for the month is used up, so this baseline comes from our formula. Ride it and refine as usual." In deterministic mode the numbers are the formula's as designed and `notes_source: "spend_limited"` says only the explanation is paused. `lib/ai.ts:tuningPausedLine` renders the one line on the quiz reveal and the legacy results. Deno tests 25 and `spend_limit_test.ts`.
- **River:** set the project budget for `proj_DqaH2kXwGTVSYiaksvHU0BrZ` to hard-limit mode (or confirm the toggle exists on the account), keep prepaid credits with auto-recharge off as the backstop. On the checklist.

### 5.2 RevenueCat intro trial and prices
- **Answer:** dashboard work, not research.
- **River:** unchanged.

### 5.3 Apple private email relay
- **Answer:** required. Register outbound domains, subdomains or individual addresses in Apple Developer under Certificates, Identifiers and Profiles, then Sign in with Apple for Email Communication (32 sources for an individual, 100 for an organization). Every registered domain must publish an SPF TXT record or registration fails. Mail must pass SPF (envelope sender domain registered and matching) or DKIM (d= matching the From domain when the provider owns the envelope sender). Resend documents the setup explicitly and notes the two bounce causes (address deleted, 100 per day relay limit). Loops: no relay document found. Postmark documents an equivalent setup.
- **Source:** "Apple Developer 'Configure private email relay service'; Sarunw; Palisade; Suped; Resend docs 'Sending Apple Private Relay'; Postmark support".
- **Changed:** `docs/lifecycle-emails.md` carries the Resend recommendation and the relay checklist under the original "Why Loops" paragraph; `lib/lifecycle.ts` comment names it as pending River's yes. Nothing is wired to either provider.
- **River:** (1) yes or no on Resend; (2) register the sending domain and the From address with Apple's relay service; (3) publish SPF and DKIM for the domain; (4) one test send to a relay address (11 of the 95 v2.4.1 notice recipients are relay addresses).

### 5.4 Google consent screen
- **Answer:** dashboard work.
- **River:** unchanged.

### 5.5 `create extension pg_cron` on production
- **Answer:** a live test at push time.
- **River:** unchanged (the go-ahead to push).

### 5.6 Email provider account and key
- **Answer:** see 5.3. If Resend, a Resend account and key replace the Loops ones.
- **River:** the provider decision, then the account.

### 5.7 The 22 uncaptured `tune_calls` rows
- **Answer:** not in the report (a log check, not a literature question).
- **River:** unchanged; or a read-only log check when asked.

---

## Flags raised while applying

1. **Suzuki RM-Z250 2016 to 2018:** the instruction said Suzuki coil verified, but the seed row is provisional on springs and the report's Suzuki line is "coil throughout, not found" for everything else. The fork type is marked coil and verified; the spring rates stay provisional; the row was not otherwise flipped.
2. **2024+ enduro-platform fork names** (XC, XC-F, EX coil) are the report's wording ("WP XACT closed-cartridge"), not a manual's; the rows say so in `fork_type_source`.
3. **Kawasaki KX250:** through 2019 Showa SFF-2 coil, 2020+ KYB coil; the catalog rows are coil either way and the brand split is recorded in the note.
4. **GasGas:** every GasGas figure is inferred from the shared WP platform; the report retrieved no GasGas page. Sources say "shared platform" on those rows.
5. **126 existing 2016 bikes** sit on the nine ambiguous rows with no stored answer; the quiz asks new riders, returning riders are not asked anywhere yet.
6. **Yamaha and Beta sag** come from tuner and supplier sources (PulpMX, MotoSport, Endurospec), not a factory page; recorded as such and counted verified per River's instruction.
7. **KYB SSS adjuster row** (compression at the bottom) does not match the report's "clickers on the fork top caps"; left DRAFT and flagged rather than rewritten from one line.

---

## Still River's, in order

1. Formula coefficients and skill weighting (1.1, 1.3), then the flip trigger (4.1).
2. The symptom rows (1.4), the bottoming qualifier (1.5), legacy ids, severities and the adaptive rule (1.6 to 1.8), and the LLM-in-path question (1.9).
3. Three conditions rules that disagree with the report: rutted rebound direction, the watered take-back, the roughed firming (3.1).
4. Where returning riders with a 2016 SX/SX-F/FC/TC answer air or coil (2.2), and the minis scope (2.8, 4.2).
5. The HSC step as a UI choice (3.5) and the measure-sag walkthrough (3.6).
6. External: OpenAI hard-limit toggle (5.1), Resend yes or no plus the Apple relay registration and a test send (5.3, 5.6), RevenueCat intro trial and prices (5.2), Google consent screen (5.4), the production push go-ahead (5.5).
7. Product questions the report cannot touch: discipline persistence and chip labels (4.3, 4.4), queue cap (4.5), retention (4.6), track creation and seeding (4.7, 4.9), `tune_calls` links (4.8), the homework list (4.10).

Answered by the research and closed: sag windows on the covered rows (2.1), fork type by year (2.2, 2.3), reference rider on KTM/Husqvarna/Sherco (2.4), PDS 2024+ rates and the Sherco table (2.5, 2.9), stock clickers on the covered rows (2.7), the count-from-closed convention and WP adjuster locations (3.3, 3.4), tire defaults (3.2), the sag method (3.6, method only), unmatched-bike sag from the platform manual (1.10), WP air bases (1.2, base only), the spend-cap codes (5.1, handling only), and the Apple relay requirement (5.3, requirement only).
