# PR: engine contract v3 (decisions 4, 5, 6 from the 2026-09-05 discovery)

Branch `feat/engine-contract-v3` off `feat/v3-integration`. One PR, its own tests. Open it at:
https://github.com/dialedoffroadapp/dialed-offroad/compare/feat/v3-integration...feat/engine-contract-v3

## What changes, in one paragraph

The Tune Two edge grows a conditions input and runs the ride-day rule base itself, takes the setup lineage so the adaptive step never crosses setups, accepts the plan's 14-symptom taxonomy with its mandatory qualifier tags alongside the 11 legacy ids, moves HSC in quarter turns, clamps fork air to 7 to 14 bar, refuses to invent a value for a circuit the setup never recorded, treats a non-number as no value, and says on every response who decided the numbers. The v1 regression stays byte-identical for every legacy input except the two deliberate changes (HSC unit, `engine_source`), which the harness masks and checks separately.

## The change set

| # | Change | Engine | Tests | Note matcher | Client | Risk |
|---|---|---|---|---|---|---|
| 4 | HSC in quarter turns | `quarterTurns`; `CIRCUIT_META.shock_hsc.unit` 0.25; bottoming and the two new HSC routes move 0.25 / 0.50; a refinement snaps HSC only when it moves it; baselines always emit quarter turns | test 15; regression harness masks HSC and the two HSC note fragments and checks moved values land on a quarter turn within one of v1's move (32 of 336 fixtures move HSC) | none (notes keep the arrow form) | `normalizeTune2Result` keeps two decimals; the stepper already moves 0.25 | low; the only visible change is bottoming notes reading -0.25 / -0.50 |
| 5 | Adaptive step scoped to the setup lineage | `input.setup_id` (uuid-gated, captured in `tune_calls.input`) | test 20 (captured) | none | `fetchLastOutcome(bikeId, setupId)` filters versions by `setup_id` (null = default lineage); every refine caller passes the session's setup | nil |
| 6a | Conditions input | `Tune2Conditions`, `sanitizeConditions`, `conditionsRuleDeltas` (rule-for-rule port), contributions tagged `conditions` at severity 5 through conflict and protect, `tire_psi_delta`, honest echo when nothing applies | test 17; `conditions_parity_test.ts` holds the port equal to `lib/conditionsRulesCore.ts` over 576 morning cases and every retune tile | `conditions` bucket for "Conditions: " and "Tires: " | `wireConditions`; `suggestForConditions` asks the engine every time it is reachable (no free-text gate) and runs the local rules only when the call fails | low; the parity test pins drift |
| 6b | Taxonomy | 14 v3 ids + 11 legacy ids; legacy ids keep their rows; `LEGACY_TO_V3`; parse vocabulary is the v3 set; `feedback.source` | test 18; regression unchanged for legacy input | none | `Tune2SymptomId` widened; `rideSymptoms` 8 + 6 chips with qualifier tags; phrases, story labels, ride rules, legacy debrief records filled | medium: seven authored rows need sign-off (below) |
| 6c | Qualifiers | `WhereTag` grows to 11; routes: harsh + big_hits → bottoming; rear_kicks + jump_face → HSC -0.25; + logs_ledges → shock LSC +1; + braking_bumps → fork reb -1; packs + rocks → fork comp +1 | test 18 | none | chips send tags, never labels; `qualifierLabel` for display | low |
| 6d | Honest previous values | `PreviousTune` with nullable circuits, `sanitizePrevious`, `add()` skips unknown circuits and names them, `safeShapeSparse` keeps null | test 19 | none | `snapshotToTune` sends nulls; `Tune2Result`; `completeTune` for the legacy debrief | low |
| 6e | Shape hardening | air clamp 7 to 14 (guardrail-driven), NaN guard, `engine_source` on baseline and refine | tests 16, 20 | none | `AIR_MIN_BAR` / `AIR_MAX_BAR` in guardrails and `normalizeResult` | low |

## Rows that need River's sign-off (marked SIGN-OFF in `buildTuneTwo`)

| Id or route | Move authored | Rationale to confirm |
|---|---|---|
| wallows_dives | fork comp -(scale-1), shock LSC -1 | under-damped compression: firmer front, a click firmer rear |
| rear_swaps | shock LSC +scale, shock reb -1 | the rear steps out: softer LSC for traction, slower rebound to settle |
| rear_squats | shock LSC -(scale-1); HSC -0.25 when scale is 3 or more | squats on the gas: firmer low speed, a quarter turn of high speed when bad |
| too_soft | mirror of too_stiff: fork comp -(scale-1), shock LSC -1, air +0.5 × airScale | |
| arm_pump | fork comp +scale, fork reb +1, air -0.5 × airScale | comfort first |
| chatters | fork reb -scale, fork comp +1 | chatter as rebound too fast plus a spiky front |
| rear_kicks + jump_face / logs_ledges / braking_bumps | see 6c | the three mandatory qualifiers on rear kicks |
| LEGACY_TO_V3: dead_feel, unstable_whoops, harsh_square_edge | map to themselves | no clean v3 equivalent; general_harsh maps to too_stiff |

`too_stiff` mirrors `general_harsh` and `harsh_small_bumps`, `bottoming`, `front_pushes`, `deflects`, `rear_kicks`, `packs_in_chop` mirror their legacy rows, so they inherit the frozen behavior.

## Compatibility

- Old clients on the new edge: legacy ids and the four legacy tags route exactly as before (byte-identical regression), no conditions stage, complete previous tunes, one new response key.
- New clients on the old edge: `conditions`, `setup_id`, `feedback.source` are stored in `input` verbatim and ignored; null circuits in `previous` would be defaulted by the old `safeShape`, so deploy the edge before the 3.0 client ships.
- No migration. `tune_calls.input` captures the new keys as-is.

## Evidence

- Deno: 27 tests, 0 failures. Regression fixtures checked: 336 (HSC moved in 32). Parity cases: 576.
- Jest: 41 suites, 288 tests. Typecheck at the 20-error baseline. Lint clean on every touched file.

## Follow-ups the PR does not do

- Discipline-localized chip labels (plan 4.3): labels default to the MX vocabulary.
- The debrief screen is retired under the v3 flag; its 8 legacy chips still work through `completeTune`.
- `lib/rideRules.ts` (Home's one-line suggestion) gained first-order moves for the 14 ids; they mirror the engine rows and carry the same sign-off.
