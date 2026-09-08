# Suspension reference, resolution, 2026-09-07 (second report)

River's prompt `claude-code-prompt-2026-09-07-suspension-reference.md` applied, then the follow-up `claude-code-prompt-2026-09-07-suspension-followup.md` (2026-09-08). The report file both name was not in Downloads, the repo or the remote on either pass; River pasted it on 2026-09-08 and it now lives at `docs/suspension-reference-2026-09-07.md`. The follow-up's section 1 (the tuner rows, the not-found list, the 4a tally) ran against it that day. Same format as `docs/open-questions-resolution-2026-09-07.md`: answer, source, what changed, what remains for River. No figure tagged inferred is surfaced as stock or as a verified range; "not found" is null.

Where it landed. Integration `feat/v3-integration`: `236503b` (migration `20260907210000`, client). Contract `feat/engine-contract-v3`: the engine commit that follows the merge (BFRC, the weight cap and skill offset, the two retune rules, tests), edge deployed to `dev-3-0`. Migration applied on `dev-3-0` with a history row (52 rows), staged for prod. The prompt asked for a `2026090716xxxx` file; that slot was taken by the refine allowance earlier in the day.

---

## 1. Catalog: stock clickers (sub-task 1a)

- **Answer:** the rows the prompt names are written, tagged. KTM 125 SX, 150 SX and Husqvarna TC 125 (AER 2017 to 2022, XACT 2023+): fork 18 / 21, shock LSC 15, HSC 1 turn, rebound 15, factory. Sherco: fork 13 / 13, LSC 14, HSC 1.5 turns, rebound 13, factory, on the three Factory KYB rows from their 2019 KYB start year (the follow-up's correction: the first pass had split the rows at 2022 and attributed the values to the SEF-R line; migration `20260907230000` collapses the split, repoints the 205 bikes and rewrites the source). Inferred, written and never surfaced: KTM 250 SX (2017 to 2022 and 2023+) from the SX-F rows, GasGas MC 125 from the 125 SX, MC 250F and MC 450F from the SX-F rows. The rows sourced by the earlier migrations keep their values and gain a tag from their existing source: manuals = factory (SX-F 2019+, XPLOR rows), MXA = tuner (YZ450F), shared platform = inferred (Husqvarna FC 2023+, GasGas EC).
- **Source:** "KTM 125 SX Owner's Manual (2017+): fork compression 18, rebound 21 (20 with the alternate fork part number); shock LSC 15, HSC 1 turn, rebound 15"; "Sherco Factory line owner's manual (KYB fork, from the 2019 KYB start year): fork 13/13, shock LSC 14, HSC 1.5 turns, rebound 13" (attribution corrected by the follow-up); the inferred rows name the KTM rows they copy.
- **Changed:** `bike_models.stock_clicker_tag` (factory | tuner | inferred), the values above, `stock_clicker_note` with the part-number note. Tags on dev after the migration: factory 35, inferred 10, tuner 2. Preset ranges (Comfort / Standard / Sport) stay in `stock_clicker_note`; no preset columns.
- **Not written, logged (follow-up section 2):** Beta RR Race Edition 2020: the catalog's KYB stands, the report's Sachs row (16 / 14, shock 15 / 12 / 15) is a source conflict. Beta RR-S 2020: no catalog row. Sherco SEF-R Sachs 2019 to 2021 figures conflict with the catalog's KYB-from-2019 Factory line; not written, and no SEF-R figure remains on any row. Suzuki RM-Z250: the catalog's KYB shock stands, the report's BFRC sharing is a source conflict. **Tuner rows (migration `20260907220000`, applied on dev-3-0, staged):** every fork and shock family checked against the catalog first. Honda CRF450R 2017 to 2020: 12 / 13, HSC 3 turns, shock LSC and rebound left null (MXA's 10 to 17 and 7 to 10 are ranges). Honda CRF450R 2021+: 12 / 15, HSC 2.25. Honda CRF250R 2022+: 12 / 13, HSC 2.17 (2 and 1/6). Suzuki RM-Z450 2018+: fork comp 6, shock LSC 1.25 turns and rebound 2 turns inside MXA's 1 to 1.5 and 1 to 3, no HSC; the stock shock columns became numeric(4,2) to hold turns. Yamaha YZ250F (three generations): 10 / 13, LSC 10, HSC 1, rebound 14. Kawasaki KX450 2016 to 2018: 9 / 13. Kawasaki KX250 2017 to 2020: 15 / 15 (the report's SFF-2 matches the row's Showa SFF; its 2020 KYB boundary is flagged). Stark Varg MX: 13 / 12. Tags after the migration: factory 35, tuner 12, inferred 10; 84 rows still without clickers (`docs/catalog-gaps.md`). Preset ranges (KTM 250 SX-F 2023 US fork, Sherco KYB) went into `stock_clicker_note` on the KTM SX-F 2023+ and Sherco rows.
- **Ambiguity:** the Beta Race Edition shock "15/12/15" does not say which figure is the HSC (Sachs HSC is in turns); nothing was written anyway.
- **River:** the KX250 catalog rows (the 2020 KYB boundary, the 2021+ fork family), and the WP shock maxima the report offers but the prompt did not list.

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
- **Follow-up (2026-09-08):** the RM-Z450's stock turns (LSC 1.25, rebound 2; MXA) are in the catalog and ride to the engine as `shock_stock_lsc_turns` / `shock_stock_reb_turns`; the BFRC baseline is now the stock turns plus the formula's move from its click base at a quarter turn per click (a 185 lb intermediate on MX sits exactly on stock; a pro reads a turn firmer on LSC). The quarter-turn-per-click placeholder remains only for a turns shock with no stock turns. RM-Z250 2019+ is NOT marked BFRC (catalog says KYB linkage; conflict logged).

## 5. Engine: skill offset and weight slope (sub-task 2)

- **Answer:** RIVER DECISION A was left blank, so the default ran: the weight slope stays, its total contribution per click circuit is capped at 3 clicks, and a skill offset of -2 clicks per class step on fork and shock compression and -1 on rebound rides on top (novice and C = 0, B = 1 step, A = 2 steps). All three numbers are `app_config` keys read by the edge (`weight_slope_cap_clicks`, `skill_offset_comp_per_step`, `skill_offset_reb_per_step`, cached 60 s, defaults in code). `rider.class` (novice | c | b | a) is an additive optional input; the quiz sends learning = novice, comfortable = C, fast = B, pro = A; the engine derives it from skill when absent (beginner = novice, intermediate = C, pro = A).
- **Source:** the report's finding as stated in the prompt (tuners move weight with springs; skill is the clicker axis, roughly a 5-click compression spread across the speed range; no published clicks-per-pound slope).
- **Changed:** edge `cappedWeight`, `classStepsFor`, `EngineTuning`, the `engineTuning` dep; the shadow comparison script passes the deps. Spring bands in `catalog_constants` per model year: `spring_bands:KTM 450 SX-F:2019` (shock 42 / 45 / 48 N/mm across 65 to 75 / 75 to 85 / 85 to 95 kg), `spring_bands:KTM 250 SX-F:2022` (39 / 42 / 45), `spring_bands:Sherco 250/300 SEF:2025` (fork 4.0 / 4.2 / 4.4), each with its manual as source. `air_pressure_spring_equivalence` (Keefer, tuner: about 2 psi per spring step) as a note; the air slope is unchanged. The spring card does not read the bands yet (a reader is trivial; the card is still gated by decision 9).
- **Follow-up (2026-09-08, section 3):** the skill component came out of the intensity term (pro +1.0, beginner -0.5 are gone; intensity is style only), so the per-class offset is the only skill term: a pro sits exactly 4 clicks firmer on compression and 2 on rebound than a C rider of the same weight and style, a B rider 2 and 1, and a novice equals a C rider. HSC's weight term is now capped in quarter turns behind its own key, `weight_slope_cap_hsc_quarter_turns` (default 2, half a turn; the term reaches 0.225 turn at the engine's 260 lb ceiling, so the default does not bind). The engine's weight input tops out at 260 lb, where the fork compression weight term is exactly 3.0 clicks, so the click cap binds only when River lowers it.
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

**Follow-up re-run (2026-09-08, after the intensity term lost its skill part and HSC's weight term was capped; same 683 baselines, `results/shadow-2026-09-08.md`):** formula p10 / median / p90.

| Band | n | fork comp | fork reb | shock LSC | shock reb | fork air |
|---|---|---|---|---|---|---|
| under 150 lb | 104 | 14 / 16 / 18 | 12 / 13 / 16 | 12 / 13 / 16 | 14 / 16 / 18 | 9.39 / 9.80 / 10.66 |
| 150 to 169 | 123 | 15 / 15 / 17 | 12 / 13 / 15 | 12 / 13 / 15 | 15 / 15 / 17 | 9.96 / 10.08 / 10.26 |
| 170 to 189 | 216 | 14 / 14 / 16 | 12 / 12 / 14 | 12 / 12 / 14 | 14 / 14 / 16 | 10.39 / 10.64 / 10.66 |
| 190 to 209 | 90 | 13 / 15 / 16 | 11 / 13 / 14 | 11 / 13 / 14 | 13 / 15 / 16 | 10.86 / 10.92 / 11.06 |
| 210 and up | 146 | 11 / 13 / 15 | 10 / 12 / 13 | 10 / 12 / 13 | 12 / 13 / 15 | 11.16 / 11.46 / 11.62 |

| Skill | n | fork comp | fork reb | shock LSC | shock reb | shock HSC |
|---|---|---|---|---|---|---|
| beginner (novice) | 95 | 12 / 15 / 17 | 11 / 13 / 15 | 11 / 13 / 15 | 12 / 15 / 17 | 1.25 / 1.50 / 1.75 |
| intermediate (C) | 548 | 13 / 15 / 17 | 11 / 13 / 14 | 11 / 13 / 14 | 13 / 15 / 17 | 1.25 / 1.50 / 1.75 |
| pro (A) | 40 | 10 / 11 / 13 | 10 / 11 / 12 | 8 / 9 / 10 | 12 / 13 / 15 | 1.50 / 1.50 / 1.75 |

What moved between the two runs: a beginner is now the same tune as an intermediate at the same weight and style (the -0.5 intensity term is gone, so the beginner p10 / p90 widen to match); a pro's fork compression p10 rose from 9 to 10 and shock rebound from 11 to 12 (the +1.0 intensity term is gone, the offset alone remains), and the pro's HSC no longer sits low (1.50 / 1.50 / 1.75 instead of 1.25 / 1.50 / 1.50). The weight bands are unchanged except the lightest band's rebound medians (13 instead of 14) and the 210 lb band's air p50 (11.46 instead of 11.40), both the style-only intensity. The HSC cap does not bind at the default. Clamp hits: 27 inputs, all on fork air, as before.
- **River:** DECISION A stands as the default until you fill it in; the four config keys tune it live.

## 6. Engine: the three contested conditions rules (sub-task 4)

- **4a Rutted hardpack:** research supports the current rule (fork rebound +1 out). No change. Tally, now in the rule's comment on both sides: faster rebound 4 (Keefer Inc, PulpMX, MXA hardpack traction guidance, Vital MX rider threads) to slower rebound plus more LSC 2 (Teknik offroad guide, MXA rut-hold-up note); it flips only when the fork packs or deflects out of the rut, where the report says add shock LSC rather than slow the rebound (not built: no packing signal exists yet).
- **4b Watered take-back:** RIVER DECISION B left blank, default adopted. Tally in the comment: keep it soft plus faster rebound 4 (Vital MX, Keefer Inc, PulpMX, Click Suspension) to firm back up 2 (Teknik, some MXA hold-up advice). "Take back the morning's chop softening" is gone: compression holds soft; if the track is choppy, fork rebound +1 out and shock LSC +1 out; compression firms a click only when the rider reported bottoming. `prior_tweaks` stays on the wire and no longer drives a move.
- **4c Roughed:** RIVER DECISION C left blank, default flipped. Tally in the comment: soften 4 (Vital MX rough-track threads, Keefer Inc, PulpMX, Click Suspension) to firm 3 (Teknik, MXA hold-up advice, Troll Training), the closest of the three. Fork compression +1 out (softer) for MX; the old -1 (firmer) only off-road, after logged bottoming, or for an A/pro rider.
- **Changed:** `lib/conditionsRulesCore.ts` (contract) and `lib/conditionsRules.ts` (integration) with a `RetuneContext` (state, bottoming, skill, discipline); the retune screen passes the track state, whether any moto logged bottoming, the rider's skill from the quiz answers and the bike's discipline; the edge's `Tune2Conditions.retune` carries the same four fields, sanitized; the parity test now runs the retune grid across state, bottoming, skill and discipline (both sides locked). Tests on both sides.
- **River:** nothing unless you want B or C the other way; the comments hold the reasoning, the counts wait for the report file.

## 7. Reveal copy

- **Changed:** `lib/stockCopy.ts`: "N clicks softer / firmer than factory stock" or "than tuner-published stock"; an inferred row reads as missing. The reveal shows the line above the values card and `quiz_reveal_viewed` carries `stock_missing` and `stock_tag`. There was no vs-stock column or `stock_missing` log before this pass; both now exist (flagged as an addition, not a branch on existing copy). `v_bikes_with_stock` returns null stock clickers for inferred rows, so the trial card's stock stat ignores them too.

---

## Flags (instead of acting)

1. The report arrived on 2026-09-08 (pasted by River; saved at `docs/suspension-reference-2026-09-07.md`); its tuner rows, not-found list and tallies are applied. Two catalog contradictions it surfaced are flagged, not changed: the KX250's 2020 KYB boundary and 2021+ fork family, and the RM-Z250's fork (report Showa SFF, catalog KYB 49).
2. Source conflicts, nothing written, logged in `docs/catalog-gaps.md`: Beta RR Race 2020 (catalog KYB, report Sachs), Sherco SEF-R Sachs 2019 to 2021 (catalog KYB Factory), Suzuki RM-Z250 (catalog KYB shock, report BFRC).
3. Column naming: `shock_lsc_max` and `shock_hsc_turns_total` are the catalog's `shock_comp_max` and `shock_hsc_turns_max`.
4. The BFRC baseline anchors on the RM-Z450's stock turns now; the quarter-turn-per-click placeholder remains only for a turns shock without stock turns. The WP linkage and PDS shock maxima the report gives (tuner) were not in the prompt's write list and stay unwritten.
5. The spring card does not read `spring_bands` yet.
6. `setup_versions.shock_hsc_turns` can now be null for BFRC bikes; readers already accept null on that column.
7. The Sherco Factory rows keep the KYB figures from 2019 with the corrected source; the three rows' notes name the SEF-R conflict by line name only, no figure.
