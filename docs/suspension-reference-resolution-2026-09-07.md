# Suspension reference, resolution, 2026-09-07 (second report)

River's prompt `claude-code-prompt-2026-09-07-suspension-reference.md` applied. The report file it names, `suspension-reference-2026-09-07.md`, was NOT in Downloads when this pass ran; everything the prompt spells out itself was built, and everything that lives only in the report file is listed as owed at the end. Same format as `docs/open-questions-resolution-2026-09-07.md`: answer, source, what changed, what remains for River. No figure tagged inferred is surfaced as stock or as a verified range; "not found" is null.

Where it landed. Integration `feat/v3-integration`: `236503b` (migration `20260907210000`, client). Contract `feat/engine-contract-v3`: the engine commit that follows the merge (BFRC, the weight cap and skill offset, the two retune rules, tests), edge deployed to `dev-3-0`. Migration applied on `dev-3-0` with a history row (52 rows), staged for prod. The prompt asked for a `2026090716xxxx` file; that slot was taken by the refine allowance earlier in the day.

---

## 1. Catalog: stock clickers (sub-task 1a)

- **Answer:** the rows the prompt names are written, tagged. KTM 125 SX, 150 SX and Husqvarna TC 125 (AER 2017 to 2022, XACT 2023+): fork 18 / 21, shock LSC 15, HSC 1 turn, rebound 15, factory. Sherco 2022+ on the three Sherco rows: fork 13 / 13, LSC 14, HSC 1.5 turns, rebound 13, factory. Inferred, written and never surfaced: KTM 250 SX (2017 to 2022 and 2023+) from the SX-F rows, GasGas MC 125 from the 125 SX, MC 250F and MC 450F from the SX-F rows. The rows sourced by the earlier migrations keep their values and gain a tag from their existing source: manuals = factory (SX-F 2019+, XPLOR rows), MXA = tuner (YZ450F), shared platform = inferred (Husqvarna FC 2023+, GasGas EC).
- **Source:** "KTM 125 SX Owner's Manual (2017+): fork compression 18, rebound 21 (20 with the alternate fork part number); shock LSC 15, HSC 1 turn, rebound 15"; "Sherco SEF-R (Racing) 2022+ owner's manual: KYB fork 13/13, shock LSC 14, HSC 1.5 turns, rebound 13"; the inferred rows name the KTM rows they copy.
- **Changed:** `bike_models.stock_clicker_tag` (factory | tuner | inferred), the values above, `stock_clicker_note` with the part-number note. Tags on dev after the migration: factory 35, inferred 10, tuner 2. Preset ranges (Comfort / Standard / Sport) stay in `stock_clicker_note`; no preset columns.
- **Not written, flagged:** Beta 2020 Race Edition (the catalog's RR Race rows carry KYB 48 coil; the prompt's 16 / 14 and 15 / 12 / 15 are Sachs figures: fork family mismatch). Beta 2020 RR-S (no catalog row; the RR-S is the four-stroke dual-sport line, the RR 2T Sachs rows are a different model). Sherco 2019 to 2021 (the catalog's Sherco rows are the Factory line on KYB from 2019; the prompt's Sachs 12 / 12, 15, 2 turns, 13 are for the SEF-R line: family mismatch, and it contradicts the earlier resolution doc's "KYB switch around MY2019", which was about the Factory line). The 2022+ KYB values were written to the Factory rows with the SEF-R line named in the note, because the fork family matches; River may prefer they come off. RM-Z250 sharing BFRC (the catalog's RM-Z250 2019+ says KYB linkage; the RM-Z450 values it would share are in the report file). The tuner rows for Honda CRF, Suzuki RM-Z450, Yamaha YZ250F, Kawasaki KX450 2016 to 2018 and Stark: their numbers are in the report file, not the prompt; `docs/catalog-gaps.md` lists them as owed.
- **Ambiguity:** the Beta Race Edition shock "15/12/15" does not say which figure is the HSC (Sachs HSC is in turns); nothing was written anyway.
- **River:** the Sherco Factory rows (keep the SEF-R values or null them), the report file so the tuner rows and the not-found list can land.

## 2. Catalog: click range maxima (sub-task 1b)

- **Answer:** no factory maximum was found for any family, so `click_range_verified` is false on every row and the range bars stay hidden. This is expected. Tuner maxima: KYB SSS about 20 to 24, stored 22 (JBI) on every KYB SSS row; Showa 49 mm coil about 20 (MXA); Honda Showa shock HSC 3 turns (MXA); KYB shock HSC counted in quarter turns (note). Showa SFF-2 and SFF-Air TAC: clicks, totals not stated, maxima null with a note. WP 4CS 25 / 25 (JBI) sits on the 2016 region-ambiguous rows as a note only. WP AER 48 about 25, WP XACT 2023+ about 30, WP XPLOR about 30 are INFERRED: `click_range_note` only, maxima null. BFRC: see section 4.
- **Source:** as named per row in `click_range_source`.
- **Changed:** `click_range_source`, `click_range_tag`, `click_range_note`. The seed's 30 on every row (never data) is nulled on every row first; 26 rows then carry a tuner maximum. The prompt's column names `shock_lsc_max` and `shock_hsc_turns_total` map onto the catalog's existing `shock_comp_max` and `shock_hsc_turns_max`; no duplicate columns (flagged as a naming difference, not a data one).
- **River:** a manual page or a physical count per family promotes a row to factory and shows its bars.

## 3. Adjuster locations (sub-task 3)

- **Answer:** `lib/adjusterLocations.ts` rewritten to the report's rows. kyb_sss CORRECTED: compression on the top cap, rebound in the base bolt at the bottom, both legs carry damping, 2024+ Yamaha compression by hand (KYB OEM parts, Dirt Rider; DRAFT removed). showa_coil (Honda 2017+, KX450 2019 to 2020): compression top cap, rebound bottom; shock LSC and HSC on the reservoir, rebound at the clevis; the Honda cluster side is a year-conditional note (right from the 2022 CRF250 generation and the 2021 CRF450, left before) (MXA). showa_sff2: all damping in the LEFT leg, right cap is preload (MXA, new row). showa_sff_air_tac: inner and outer chamber valves on the left cap, balance chamber valve under the left lug, all damping in the RIGHT leg (MXA, new row). showa_bfrc: Com and Ten on the piggyback, continuous turns, nothing under the shock, no HSC (new row). kyb_psf2: stays DRAFT, note updated (high and low compression AND rebound, positions not found). ohlins: cap left bleed (T25), center compression (3 mm Allen), right rebound (T25); shock rebound knob at the bottom, compression on the reservoir, HSC clicker on TTX Flow DV 2023+ (MXA, DRAFT removed). sachs: both clickers on the fork tops; shock LSC and rebound clicks, HSC turns (Beta and Sherco manuals, factory). KYB shock: LSC small center clicker on the reservoir top, HSC the large outer hex knob, rebound at the clevis (Keefer). Count-from-closed on every family, cited to Teknik in the header.
- **Changed:** the file, `forkFamilyFor` (Showa SFF-2, SFF-Air TAC and coil resolve separately), `shockFamilyFor` ("BFRC" in the shock string), `locationCopy` takes the bike context for the Honda note and reads the unit for the BFRC HOW text; the walkthrough passes both and drops the HSC card on a BFRC shock. `__tests__/adjusterLocations.test.ts` asserts the cap and leg per family (12 fork families, 8 shock families).
- **River:** the DRAFT rows left: kyb_psf2 and generic. The catalog's Beta RR Race rows say KYB while the report says Sachs for the 2020 Race Edition; until that is settled the walkthrough follows the catalog string.

## 4. BFRC (engine and client)

- **Answer:** Suzuki RM-Z450 2018+: `shock_adjust_unit = 'turns'`, `has_shock_hsc = false`, `shock_type` "Showa BFRC linkage". Engine: guardrails carry `shock_adjust_unit` and `has_shock_hsc`; on a turns shock the baseline and every refinement answer LSC and rebound in quarter turns (a click delta lands as a quarter turn, values snap to quarters, 0 to `shock_turns_max`, default 4) and `hsc_turns` is null in both modes. Client: Current Setup and the setup sheet step those two circuits by 0.25 with two decimals and hide the HSC row; the walkthrough counts turns and drops the HSC card; a tune's `hsc_turns` may be null end to end.
- **Changed:** migration columns; edge `shapeCircuits`, `baselineShock`, `buildTuneTwo`, the explanation prompt; `lib/currentSetup.ts:circuitStep / circuitUnit`, `lib/format.ts:formatSetting(v, key, unit)`, `app/current-setup.tsx`, `app/setup-sheet.tsx`, `app/set-on-bike.tsx`, `lib/ai.ts` guardrails and the nullable HSC. Deno: `suspension_reference_test.ts` (baseline turns and null HSC, refinement quarter-turn deltas, both handler modes). Jest: `__tests__/stockAndUnits.test.ts`.
- **Flagged:** the BFRC baseline maps the click formula onto turns at a quarter turn per click (12 clicks reads as 3.00 turns). That is the prompt's convention, not an anchor: the RM-Z450's stock turns are in the report file and would let the formula anchor on stock. RM-Z250 2019+ is NOT marked BFRC (catalog says KYB linkage).

## 5. Engine: skill offset and weight slope (sub-task 2)

- **Answer:** RIVER DECISION A was left blank, so the default ran: the weight slope stays, its total contribution per click circuit is capped at 3 clicks, and a skill offset of -2 clicks per class step on fork and shock compression and -1 on rebound rides on top (novice and C = 0, B = 1 step, A = 2 steps). All three numbers are `app_config` keys read by the edge (`weight_slope_cap_clicks`, `skill_offset_comp_per_step`, `skill_offset_reb_per_step`, cached 60 s, defaults in code). `rider.class` (novice | c | b | a) is an additive optional input; the quiz sends learning = novice, comfortable = C, fast = B, pro = A; the engine derives it from skill when absent (beginner = novice, intermediate = C, pro = A).
- **Source:** the report's finding as stated in the prompt (tuners move weight with springs; skill is the clicker axis, roughly a 5-click compression spread across the speed range; no published clicks-per-pound slope).
- **Changed:** edge `cappedWeight`, `classStepsFor`, `EngineTuning`, the `engineTuning` dep; the shadow comparison script passes the deps. Spring bands in `catalog_constants` per model year: `spring_bands:KTM 450 SX-F:2019` (shock 42 / 45 / 48 N/mm across 65 to 75 / 75 to 85 / 85 to 95 kg), `spring_bands:KTM 250 SX-F:2022` (39 / 42 / 45), `spring_bands:Sherco 250/300 SEF:2025` (fork 4.0 / 4.2 / 4.4), each with its manual as source. `air_pressure_spring_equivalence` (Keefer, tuner: about 2 psi per spring step) as a note; the air slope is unchanged. The spring card does not read the bands yet (a reader is trivial; the card is still gated by decision 9).
- **Flagged:** the existing intensity term already moves pro +1.0 and beginner -0.5 (times 0.6 on compression); the new offset stacks on it, so a pro now sits about 4.6 clicks firmer on fork compression than a C rider of the same weight, a B rider about 2. HSC's weight term (turns) is not capped: a click cap has no turn equivalent. The engine's weight input tops out at 260 lb, where the fork compression weight term is exactly 3.0 clicks, so the cap only binds when River lowers it.
- **Shadow comparison (683 captured baselines replayed through the new math, `scripts/engine-tools/results/shadow-2026-09-08.md`):** formula median per circuit, p10 / median / p90.

| Band | n | fork comp | fork reb | shock LSC | shock reb | fork air |
|---|---|---|---|---|---|---|
| under 150 lb | 104 | 14 / 16 / 18 | 12 / 14 / 16 | 12 / 14 / 16 | 14 / 16 / 18 | 9.39 / 9.80 / 10.66 |
| 150 to 169 | 123 | 15 / 15 / 17 | 12 / 13 / 15 | 12 / 13 / 15 | 15 / 15 / 17 | 9.96 / 10.08 / 10.26 |
| 170 to 189 | 216 | 14 / 14 / 16 | 12 / 12 / 14 | 12 / 12 / 14 | 14 / 14 / 16 | 10.38 / 10.60 / 10.66 |
| 190 to 209 | 90 | 13 / 15 / 16 | 11 / 13 / 14 | 11 / 13 / 14 | 13 / 15 / 16 | 10.80 / 10.92 / 11.04 |
| 210 and up | 146 | 12 / 13 / 15 | 10 / 12 / 13 | 10 / 12 / 13 | 12 / 13 / 15 | 11.16 / 11.40 / 11.62 |

| Skill | n | fork comp | fork reb | shock LSC | shock reb |
|---|---|---|---|---|---|
| beginner (novice) | 95 | 13 / 15 / 17 | 11 / 13 / 15 | 11 / 13 / 15 | 13 / 15 / 17 |
| intermediate (C) | 548 | 13 / 15 / 17 | 11 / 13 / 14 | 11 / 13 / 14 | 13 / 15 / 17 |
| pro (A) | 40 | 9 / 11 / 12 | 9 / 11 / 12 | 7 / 9 / 10 | 11 / 13 / 14 |

The captured inputs carry no `rider.class`, so no B (fast) riders appear; the pro column is the A offset. The weight bands now span 3 clicks of fork compression from the lightest to the heaviest band (16 to 13 medians), the cap holding the top band; skill spans 4 clicks (15 to 11). Air is untouched. 27 inputs land on a clamp, all on fork air, unchanged from the earlier report.
- **River:** DECISION A stands as the default until you fill it in; the three config keys tune it live. Whether the intensity term's skill part should fold into the offset.

## 6. Engine: the three contested conditions rules (sub-task 4)

- **4a Rutted hardpack:** research supports the current rule (fork rebound +1 out). No change; the comment names the support. The source tally with counts is in the report file and is owed.
- **4b Watered take-back:** RIVER DECISION B left blank, default adopted. "Take back the morning's chop softening" is gone: compression holds soft; if the track is choppy, fork rebound +1 out and shock LSC +1 out; compression firms a click only when the rider reported bottoming. `prior_tweaks` stays on the wire and no longer drives a move.
- **4c Roughed:** RIVER DECISION C left blank, default flipped. Fork compression +1 out (softer) for MX; the old -1 (firmer) only off-road, after logged bottoming, or for an A/pro rider.
- **Changed:** `lib/conditionsRulesCore.ts` (contract) and `lib/conditionsRules.ts` (integration) with a `RetuneContext` (state, bottoming, skill, discipline); the retune screen passes the track state, whether any moto logged bottoming, the rider's skill from the quiz answers and the bike's discipline; the edge's `Tune2Conditions.retune` carries the same four fields, sanitized; the parity test now runs the retune grid across state, bottoming, skill and discipline (both sides locked). Tests on both sides.
- **River:** nothing unless you want B or C the other way; the comments hold the reasoning, the counts wait for the report file.

## 7. Reveal copy

- **Changed:** `lib/stockCopy.ts`: "N clicks softer / firmer than factory stock" or "than tuner-published stock"; an inferred row reads as missing. The reveal shows the line above the values card and `quiz_reveal_viewed` carries `stock_missing` and `stock_tag`. There was no vs-stock column or `stock_missing` log before this pass; both now exist (flagged as an addition, not a branch on existing copy). `v_bikes_with_stock` returns null stock clickers for inferred rows, so the trial card's stock stat ignores them too.

---

## Flags (instead of acting)

1. The report file `suspension-reference-2026-09-07.md` is not in Downloads: the tuner 1a rows (Honda CRF, Suzuki RM-Z450, Yamaha YZ250F, Kawasaki KX450 2016 to 2018, Stark), the not-found list and the 4a tally are owed from it.
2. Fork family mismatches, nothing written: Beta RR Race 2020 (catalog KYB, report Sachs), Sherco 2019 to 2021 (catalog KYB Factory, report Sachs SEF-R), RM-Z250 2019+ (catalog KYB shock, report BFRC).
3. Sherco 2022+: the SEF-R manual values sit on the Factory rows (same KYB 48 fork), named in the note. Say the word and they come off.
4. The prompt's Sherco Sachs-to-KYB boundary at 2022 contradicts the earlier resolution doc's "KYB around MY2019"; both can be true (Factory vs Racing lines). The split at 2022 was made as instructed.
5. Column naming: `shock_lsc_max` and `shock_hsc_turns_total` are the catalog's `shock_comp_max` and `shock_hsc_turns_max`.
6. The BFRC baseline anchor (a quarter turn per click) waits for the RM-Z450 stock turns.
7. The intensity term still carries a skill component under the new offset; HSC's weight term is uncapped.
8. The spring card does not read `spring_bands` yet.
9. `setup_versions.shock_hsc_turns` can now be null for BFRC bikes; readers already accept null on that column.
