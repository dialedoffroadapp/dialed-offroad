# Engine discovery, 2026-09-05

Read-only discovery of the tune engine and its data plumbing as they exist on `feat/v3-integration` today, a gap analysis against the 3.0 app, and a hardening plan. No code was changed and nothing was committed.

**Sources read end to end:** `supabase/functions/ai-tune/index.ts` (2,143 lines, both modes), the Deno suite (`engine_test.ts`, `handler_attribution_test.ts`, the byte-frozen `engine_v1_snapshot.ts`), `lib/ai.ts`, `lib/quizGenerate.ts`, `lib/rideEngine.ts`, `lib/rideAdjust.ts`, `lib/conditionsRules.ts`, `lib/rideConditions.ts`, `lib/tuneNotes.ts`, `lib/sagBounds.ts`, `lib/modelSpecs.ts`, `lib/bikes.ts` (alias resolution), `lib/freeTune.ts`, `lib/autoBaseline.ts`, `lib/setupVersions.ts`, `lib/currentSetup.ts`, `lib/bikeSetups.ts` (manual versions), the generation block of `app/(tabs)/tune.tsx`, the submit block of `app/tune-feedback.tsx`, the quiz's engine-input mapping in `lib/quizOnboarding.ts`, `supabase/config.toml`, and all 29 migrations that touch `bike_models`, `bike_model_aliases`, `tune_calls`, `setup_versions`, `ride_feedback`, `profiles` trial columns, and `app_config`.

**Data queried (read-only):** the preview branch `dev-3-0` (ref `rxbagshvbavrqtirprdz`), a data clone of production taken 2026-09-04 with all staged 3.0 migrations applied. Counts below are from that clone unless marked otherwise. Production was not touched.

**Two caveats up front.** The edge function I read is the repository file; production runs ai-tune v26 (deployed 2026-08-31) and the branch runs v28. Memory says v26 matched the repo at deploy time, but I did not diff the deployed bundle. And the engine's latency is not captured anywhere in the database; the only figures are the edge-log sample from the 2026-09-01 eval.

---

## Part 1. How it works today

### 1.0 In plain language

A baseline tune is produced by two things stacked on top of each other. First, a deterministic formula on the server computes a starting tune from rider weight, skill, riding style, and a keyword guess at the discipline. Then, if an OpenAI key is present, a prompt goes to `gpt-4o-mini` with the bike, terrain, rider, goals, and free-text issues, and whatever numbers the model returns overwrite the formula's numbers field by field. The formula is therefore a floor that fills gaps, not the source of the numbers a rider sees: in the 680 captured baseline calls on the branch, every single one carries LLM notes and none carries the formula's note signature. After the merge, the server clamps clicks to 0 to 30, high-speed compression to 0 to 3 turns, and sag to the per-model window (or 95 to 112), strips fork air when the catalog says the bike is coil, trims notes to 12, and returns JSON. Fork air pressure is rounded to two decimals but is never clamped on the server.

A refinement never touches the LLM for numbers. The server takes the previous tune, the rider's symptoms (from a fixed list of 11), each with a severity from 1 to 10 and an optional location from a fixed list of 4, plus optional protected areas, an optional free-text note, and the outcome of the last refinement. Free text is sent to `gpt-4o-mini` only to be parsed into the same symptom vocabulary, with a 5-second cap and fail-open. Everything after that is a deterministic table: each symptom contributes click deltas to specific circuits, opposing contributions are resolved by severity, protected circuits are zeroed or capped, a "worse" outcome reverses the last delta on a re-reported circuit, and the total per-circuit move is clamped to 4 clicks, 0.5 turns, or 0.3 bar. Sag is never changed by a refinement. The output is frozen by a byte-identical regression test against the v1 engine.

Around both sit the plumbing: a `tune_calls` row is written before generation (with the full input since v2.4.0) and the output is attached afterward; the client saves the result as an immutable `setup_versions` row whose version number and delta are computed by triggers; per-model sag windows and the spring check come from a client-side lookup of `bike_models`, gated on `spec_verified`; anonymous callers may generate baselines at 10 per hour per IP, signed-in callers at 20 per hour, and a signed-in free rider passes a server-side credit gate that, since the per-bike migration, admits any regenerate.

### 1.1 Baseline: `zero_baseline_v1`

#### Who calls it and what they send

Two client paths build the same input and share one generation routine shape: the legacy Tune tab (`app/(tabs)/tune.tsx`, lines 780 to 1050) and the quiz (`lib/quizGenerate.ts`). Both do: claim the free credit if signed in and not Pro, resolve the bike's verified spec, derive sag bounds and the spring check, call `generateTune` under a 30-second race, force coil on spec-confirmed coil bikes, write the pending tune, and log the funnel event.

The wire input (`lib/ai.ts:213-250`):

| Field | Source | Notes |
|---|---|---|
| `make`, `model`, `year` | bike row or quiz answers | free strings, trimmed |
| `model_id` | verified spec id, else the bike's own `model_id` (Tune tab only; the quiz sends it only for verified rows) | uuid-gated on the edge, stamped on `tune_calls.bike_model_id`, never used for math |
| `terrain` | Tune tab: comma-joined labels such as "hardpack, mixed"; quiz: one tile label such as "Hardpack" | the engine keyword-scans it for discipline |
| `track`, `temp_f`, `elev_ft` | Tune tab only (elevation bucket 0 / 3000 / 8000 ft) | quiz sends none |
| `rider.weight_lbs` | rider input | 733 of 771 captured calls carry a weight |
| `rider.skill` | Tune tab: beginner / intermediate / pro; quiz: learning to beginner, comfortable and fast to intermediate, pro to pro | the engine has no fourth level |
| `rider.style` | Tune tab: short_motos / long_enduro; quiz: MX to short_motos, off-road to long_enduro | |
| `rider.goals` | Tune tab: chips; quiz: derived, ["stability","comfort"] or ["stability","jump support"] (MX fast/pro) or ["stability","grip"] (off-road fast/pro) | 680 of 680 captured calls carry goals |
| `rider.issues` | free text, uncapped on the client | 97 of 680 carry issues, max 203 chars |
| `has_zeroed_clickers` | Tune tab toggle; quiz always true | prompt-only |
| `wants_air_fork` | per-bike toggle or the verified spec | the spec overrides |
| `guardrails` | `defaultGuardrails(sagBounds, hasAirFork)` | see below |
| `location` | coarse fix, ~110 m | stored, never used |
| `anon_id` (top level) | signed-out callers only | uuid-gated |

The guardrails object is the only per-model information the engine ever receives:

| Key | Value sent | Used by |
|---|---|---|
| `clicks_min` / `clicks_max` | 0 / 30 always | prompt, `safeShape` |
| `hsc_turns_min` / `hsc_turns_max` | 0 / 3 always | prompt, `safeShape` |
| `sag_min_mm` / `sag_max_mm` / `sag_target_mm` | per-model window when `spec_verified`, else 95 / 112 / 105 | `baselineSagMm`, prompt, `safeShape` |
| `aer_pressure_bar_default` / `aer_pressure_bar_per_10lb` | 10.6 / 0.2 always | `baselineAirBar` |
| `has_air_fork` | present only when the bike matched a verified row | `buildFallback`, prompt, `safeShape` |

Because the client always sends 10.6 and 0.2, the engine's own discipline-specific air base and slope (10.6 / 0.22 for MX, 10.0 / 0.18 for enduro, 10.2 / 0.20 mixed) are dead code in production; only the discipline clamp windows and the intensity bias still differ.

#### Server sequence

`makeHandler` (`index.ts:1955-2135`): parse JSON (400 on failure) → `sanitizeLocation` → mode defaults to baseline → `getUserId` (anon key alone yields null; baseline permits null) → rate limit (`countRecentCalls`, fail-open on infra error) → `recordCall` with `input` verbatim (the row exists before generation so the rate window counts it) → if signed in, `enforceBaselineCredit` → `buildFallback` → `callOpenAI` and merge → `safeShape` → `recordOutput` → 200.

#### The deterministic layer, with the actual numbers

All of this is in `index.ts:190-450`.

- **Weight:** `getWeight` returns 185 when the weight is missing or under 90, and caps at 260. `weightFactor = (weight - 185) / 10`, so one unit per 10 lb from a 185 lb reference rider.
- **Intensity:** pro +1.0, beginner -0.5, short_motos +0.5, long_enduro -0.2, clamped to plus or minus 1.5. An intermediate MX rider is +0.5; a pro MX rider is +1.5.
- **Discipline:** keyword counts over `terrain`, `track`, and `issues`. MX words: mx, track, motocross, whoops, sand whoops, sx, supercross, jump, table, double, triple, rhythm. Enduro words: enduro, woods, singletrack, gnarly, hard enduro, roots, rocks, rocky, technical, tight, chop. Style adds one to its side. A lead of one decides; ties are "mixed". The quiz's MX terrain labels ("Hardpack", "Loam", "Sand", "Rutted clay") contain no MX keyword, so an MX quiz rider on hardpack scores only the style point and lands on "mx" by one; an off-road rider on "Rocks and roots" scores two enduro words plus style.
- **Fork clicks (out from closed):** base comp 14 / 16 / 15 and reb 12 / 14 / 13 for mx / enduro / mixed; `comp -= wf * 0.4 + intensity * 0.6`; `reb -= wf * 0.3 + intensity * 0.5`; rounded and clamped to 6 to 24.
- **Shock:** LSC base 12 / 14 / 13, reb 14 / 16 / 15, HSC 1.4 / 1.6 / 1.5 turns; `lsc -= wf * 0.3 + intensity * 0.4`; `reb -= wf * 0.4 + intensity * 0.6`; `hsc -= wf * 0.03 + intensity * 0.05`; clamps 6 to 20, 8 to 22, 0.75 to 2.0.
- **Sag:** when `sag_target_mm` is present it is returned clamped to the window, with no rider or discipline adjustment (the note in the code: the model's stock sag is set by preload for the rider's weight). The v1 fallback (no target) is 102 / 108 / 105 plus `wf * 0.5 + intensity * 0.5`, plus 2 for long_enduro, clamped to 98 to 112.
- **Air (air forks only):** `bar = base + wf * per10lb`, then `+ intensity * 0.12` (mx) / `0.06` (enduro) / `0.08` (mixed), then minus 0.1 when goals or issues read as comfort (comfort, plush, traction, grip, compliance, harsh, chatter, chop, spiky) and not support, or plus 0.1 for support (stability, jumps, big hits, g-out, bottom, case, slam) and not comfort; clamped to 9.8 to 11.8 / 9.0 to 11.2 / 9.4 to 11.5; rounded to two decimals.
- **Fork type:** `guardrails.has_air_fork` when boolean, else `wants_air_fork === true` OR the name heuristic `isAERFork` (make contains ktm, husqvarna, or gasgas AND model contains sx, fc, or mc). The heuristic is greedy: "50 SX", "65 SX", "TC 65", "TC 85" all read as air-fork bikes.

Worked example, 185 lb intermediate MX rider, short motos, verified 2023+ KTM 250 SX-F: wf 0, intensity 0.5, discipline mx. Comp 14 - 0.3 = 13.7 → 14; reb 12 - 0.25 → 12; LSC 12 - 0.2 → 12; shock reb 14 - 0.3 → 14; HSC 1.4 - 0.025 = 1.375 → 1.38; sag 105 (target); air 10.6 + 0.06 = 10.66. The captured LLM outputs for that class of rider cluster at 12 / 12 / 10 / 1.0 / 14 / 105 / 10.6 instead.

#### The LLM layer

`callOpenAI` (`index.ts:640-727`): model `gpt-4o-mini`, `temperature 0.2`, `max_tokens 350`, no `response_format`, no abort controller, no timeout of its own. The only time bound on a baseline call is the client's 30-second race.

The system prompt (`buildSystemPrompt`) tells the model it is a world-class tuner, defines zero-based clicks, demands a single JSON object of the exact result shape, restates the clamps from guardrails, adds "Target riding sag for THIS bike is N mm" when a target is present, states the fork rule three ways (confirmed air, confirmed coil, or guess-if-likely), forbids revalving or hardware advice, lists tuning priorities, and asks for 3 to 8 track-side notes in an "If X then +2 fork comp" style. The user prompt (`buildUserPrompt`) is one line each for bike, terrain@track, temperature and elevation, rider weight/skill/style, goals, issues (verbatim, "None described" when empty), the zeroed flag, and the air-fork intent, followed by an example JSON shape whose values are 12 / 12 / 10.6 and 12 / 1.5 / 14 / 105.

Observed behavior on the branch, 680 captured calls: fork comp p50 12 (range 10 to 15), fork reb p50 12 (10 to 14), LSC p50 10 (10 to 12), HSC p50 1.0 (1 to 2), sag p50 105 (98 to 107) and exactly equal to the sent target in all 651 calls that sent one, air p50 10.5. The model anchors hard on the example and the prompt; the "weight adjustment formula" the rider is told about is, in practice, whatever the model does with "185 lb" in a prose line.

The merge (`index.ts:2084-2092`) is `{...fallback, ...ai, fork: {...fallback.fork, ...ai.fork}, shock: {...}, detected: {...}, notes: ai.notes ?? fallback.notes}`. Any field the model returns wins; the formula fills only what the model omitted. If the model's text is not JSON, `callOpenAI` returns `{}` and the formula's numbers ship with the formula's notes; nothing marks this in the output. If the HTTP call throws, the formula ships with an extra note "AI fallback used: <message>". Neither case is a `source` field; a client can only detect them by note text.

#### Clamps and shaping on the way out

`safeShape` (`index.ts:455-528`): clicks are `Math.round(Number(x ?? default))` then clamped to `clicks_min..clicks_max`; the defaults for missing fields are 12 / 12 / 12 / 14. HSC is clamped to `hsc_turns_min..max` then **rounded to one decimal** (`toFixed(1)`). Sag defaults to the target, else 105, then clamps to the window. Air is `toFixed(2)` with **no clamp**. A coil verdict from guardrails deletes air and forces `detected.has_air_fork` false; an air verdict forces it true. Notes slice to 12. A client-supplied `spring_check` passes through untouched.

Two consequences visible in the data. First, the missing air clamp is live: 7 captured calls (a 50 SX twice, a 65, a TC 65, a TC 85, and a "Stark 80hp") went out with 1.5 to 1.6 bar of fork air, because the name heuristic or the toggle made them air-fork bikes and the model answered with a mini's fork pressure or a guess; 5 `setup_versions` rows carry 1.5 to 1.8 bar today. Second, the one-decimal HSC rounding is the origin of the 1.25-to-1.3 class of display bug: the engine itself quantizes HSC to 0.1 turns while the app's stepper (`CIRCUIT_STEPS`) moves HSC in quarter turns and `lib/format.ts` displays two decimals. The refine engine's HSC unit is 0.15 turns, so a 1.4 minus 0.15 becomes 1.25 in arithmetic and 1.3 after `safeShape`.

The client's `normalizeResult` (`lib/ai.ts:503-550`) re-clamps: clicks 0 to 30, HSC 0 to 3 at one decimal, sag to the same bounds it sent, air accepted when 0 < bar <= 15 (so 1.5 passes), notes 12, and `detected.has_air_fork` is inferred true whenever a sane air value exists.

#### Notes and how `tuneNotes` matches them

Baseline notes are the model's free prose (3 to 8 lines) or, on fallback, `buildPersonalBaselineNotes`: a bike/terrain/discipline line, a rider assumption line, goals, issues, "set sag close to N mm", "set fork air to about N bar", a 5 to 7 minute test loop, and three "if X then Y" lines. `lib/tuneNotes.ts` was written for the refine templates; every baseline note classifies as "routine". `reasonFromNotes` mines the text before an arrow glyph on lines that name a circuit; LLM baseline notes often use that arrow style, so the setup sheet's history line sometimes finds a reason and sometimes does not.

#### What gets persisted

- `tune_calls`: `user_id` or `ip` (ip only for anon), `mode`, `anon_id` (anon only, uuid), `input` (the validated `body.input` verbatim, including issues, location, weight), `rider_weight_lbs`, `bike_model_id`, then `output` (the shaped result) by a second update. Since capture began (2026-08-07): 771 rows, 749 with input and output, 733 with weight, 27 with a model id (3.5%, because only v2.4.0+ clients send it and only when the bike resolved).
- `setup_versions` (`createBaselineVersion`): typed circuit columns, `sag_measured` false, `notes`, `terrain`, `context` (the Tune2Context echo), `recommended_settings = { settings, context: { model_id, spec_verified, sag_target_mm, sag_bounds, rider_weight_lbs, spring_check {status, direction}, engine } }`, `applied_settings` (same snapshot), `parent_version_id` for regenerates, `setup_id` for named setups. Triggers assign `version_number` (max + 1 per user, bike, and setup) and `settings_delta` (typed columns minus the parent's). Rows are immutable to clients. The branch holds 511 versions: 371 baseline, 138 refinement, 1 manual, 1 restore; 290 carry the wrapper shape and 221 are bare snapshots from older builds; 85 carry a model id in context.
- Guests: the tune lives in AsyncStorage as a pending tune until sign-in, when `autoCreateBaselineFromPendingTune` writes the version (and refuses a pending tune stamped for another user).

#### Failure paths

| Failure | Server behavior | What the rider sees |
|---|---|---|
| OpenAI HTTP error or network throw | formula values, note "AI fallback used: ..." appended, 200 | a tune with a slightly odd note; no other signal |
| OpenAI returns non-JSON | `{}` merged, formula values and notes, 200 | a formula tune, indistinguishable except by note style |
| No API key | formula values, note "OPENAI_API_KEY not set", 200 | same |
| Generation throws inside the try | server refunds its own claim, 400 `{ error }` | "AI tune failed" toast; a client-consumed credit is refunded by the client |
| Rate limit | 429 with the hourly message | the message, surfaced by `edgeErrorMessage` |
| No credit | 402 `no_trial` | Pro gate |
| `tune_calls` insert fails | logged, `callId` null, generation proceeds | nothing; the call is uncounted and uncaptured |
| Client race exceeds 30 s | client rejects | "taking longer than expected"; the server call keeps running |

Since capture: 0 fallback notes, 0 no-key notes, 0 formula-signature outputs. The LLM path has been up every time it was measured.

### 1.2 Refinement: `tune2_v1`

#### Callers and feedback shape

Three client paths call `generateTuneTwo`:

1. The legacy debrief (`app/tune-feedback.tsx`), now a redirect under the v3 flag but still the shape the engine was designed for. Overall 1 to 5 → ×2 (the only rating conversion). Chip levels: mild → severity 5, bad → 9. Where labels "Braking", "Corners", "Whoops", "Landings". Protect options rear traction, front planted, landings, cornering. Terrain tags = the surface and condition chips. Free text = the notes field.
2. The ride-day Adjust and the new quick refine (`lib/rideAdjust.ts:fetchAdjustResult`): one symptom, its qualifier string as `where`, severity from the tap level (mild 4, bad 8) or from sentiment (worse 8, same 6, better 4), overall from sentiment (better 8, same 5, worse 3), terrain tags = surfaces plus track state plus "watered", free text = the moto note. `previous` = the session's effective values through `snapshotToTune`.
3. Today's setup and mid-day retune (`lib/rideEngine.ts`): only when the rider typed something; `overall_rating: 5`, `symptoms: []`, free text, terrain tags from conditions; the result is diffed against the effective values and capped at two changes.

The wire shape (`lib/ai.ts:308-347`): context (bike, model_id, terrain, track, temp_f, elev_ft, rider without issues), `has_zeroed_clickers: true`, `wants_air_fork`, `location`, `guardrails: defaultGuardrails()` (**the default sag window 95 to 112 and no `has_air_fork`**: per-model sag bounds and the verified fork type are not sent on refine), `previous`, `feedback` (rating and severities clamped to 1 to 10, free text trimmed to 800), and `last_outcome`.

`last_outcome` is computed client-side (`fetchLastOutcome`): the newest `ride_feedback` row for any version of the bike that has both an outcome and a `resulting_version_id`, with per-circuit deltas from the linked parent and child version rows and the symptom ids from the feedback row. It is fetched by bike, not by setup.

#### Server pipeline

Auth required (401 "Sign in to refine your tune."), rate limit 20 per hour per user, `recordCall`, then:

1. **Parse** (`callParseFeedback`): `gpt-4o-mini`, `temperature 0`, `max_tokens 300`, `response_format json_object`, 5-second abort, free text sliced to 1,000 chars. The parse prompt whitelists the 11 ids, the 4 where tags, and the 4 protect areas, and tells the model to omit anything that does not map. Any failure returns null and the pipeline continues on explicit input.
2. **Sanitize** (`sanitizeParsedFeedback`): unknown ids dropped, severity clamped 1 to 10 (5 when missing), where normalized to the 4 tags or dropped, protect areas normalized.
3. **Merge** (`mergeFeedback`): explicit chips win per id on severity and where; parsed symptoms add only new ids and are listed in a "From your written note, I also picked up" note.
4. **Last outcome** (`sanitizeLastOutcome`): outcome must be improved / same / worse; symptoms filtered to known ids; deltas limited to the five click circuits, clamped to plus or minus 10; the whole thing dropped when either list is empty.
5. **`buildTuneTwo`**, then `safeShape` with the default guardrails, then `recordOutput`.

#### The refine table

`globalScale` from overall rating: 9 to 10 → 0.4, 7 to 8 → 0.7, 5 to 6 → 1.0, 3 to 4 → 1.3, 1 to 2 → 1.5. `clickDeltaForSeverity`: base 1 (severity 1 to 3), 2 (4 to 7), 3 (8 to 9), 4 (10), times scale, rounded, clamped 1 to 4. `airDeltaForSeverity`: 0.05 / 0.1 / 0.2 / 0.25 times scale, clamped 0.03 to 0.3. Plus is clicks out (softer or faster); minus is clicks in.

| Symptom id | Default move | Where modifiers |
|---|---|---|
| harsh_braking_bumps | fork comp +scale; air -0.5 × airScale | landings → routed to bottoming; corners → comp only, no air; whoops → also shock LSC +1 |
| deflects_in_chop | fork reb -scale | none |
| rear_kicks_accel | shock reb -scale | none |
| bottoms_landings | shock LSC -(scale-1, min 1); HSC -0.15 (or -0.30 at scale ≥ 3); air +0.7 × airScale | whoops → also shock reb -1 |
| front_knifes | fork comp -(scale-1, min 1); fork reb +1 | none |
| dead_feel | fork reb +scale; shock reb +(scale-1, min 1); fork comp -1 | corners → fork only |
| unstable_whoops | fork reb -scale; shock reb -scale; air +0.4 × airScale | corners → routed to front_knifes |
| packs_whoops | fork reb +scale; shock reb +scale | none |
| harsh_square_edge | fork comp +scale; shock LSC +(scale-1, min 1) | corners → also fork reb +1 |
| headshake | fork reb -1; shock reb -1 | none |
| general_harsh | fork comp +(scale-1, min 1); shock LSC +1; air -0.5 × airScale | none |

Then: per-circuit conflict resolution (opposing signs: the higher severity wins, magnitude shrinks by the largest opposer, never below one unit; a "pull ... opposite ways" note); protect pass (`PROTECT_MAP`: rear_traction → shock LSC and reb; front_planted → fork comp and reb; landings → HSC and LSC; cornering → fork comp and reb; a protected circuit is zeroed, or capped at one unit when a severity ≥ 8 symptom demands it); adaptive step (only when the last outcome was not "improved", the circuit is not protected, and this round re-reports one of the symptoms the last refinement addressed: "worse" replaces the computed delta with the negative of the last delta; "same" adds one unit in the computed direction); total clamps plus or minus 4 clicks, 0.5 turns, 0.3 bar; sag unchanged; notes in the order summary, adaptive, protect, conflict, per-symptom. With no symptoms at all the previous tune is echoed with two "No specific issues were selected" notes.

Circuit units for conflict and protect math: 1 click, 0.15 turns HSC, 0.05 bar air.

#### What the engine can and cannot express

It can: move six circuits by bounded steps, route a handful of symptom-plus-location combinations to a different table row, resolve two symptoms fighting over one circuit, honor "leave that alone", and undo or enlarge last round's move on the same circuit.

It cannot: change sag, spring, preload, or tire pressure; take conditions, discipline, track, temperature, or elevation into account (they appear only in the summary note string); express a location outside braking / corners / whoops / landings; distinguish "small-bump harsh" from "mid-stroke harsh" except through the four tags; move HSC in the hardware's quarter-turn steps; respect per-model click limits (clamps are the generic 0 to 30); or know which named setup it is refining.

#### Refinement data on the branch

160 refine calls all time, 69 with capture. Of the 69: 23 had no symptoms (14 produced the echo), 31 carried free text (max 127 chars, average 55), 20 outputs say the parse added something, 13 carried a last outcome, **0 outputs carry an adaptive note** (the reverse-or-enlarge path has never fired in captured data), 7 carry a conflict note, 30 carried protected areas, 15 are the conditions path's signature (no symptoms plus free text). Symptom mix: front_knifes 17, harsh_square_edge 13, harsh_braking_bumps 13, rear_kicks_accel 9, unstable_whoops 8, dead_feel 4, packs_whoops 4, bottoms_landings 3 (average severity 9); three ids never appear. A where tag was present on 25 of 71 symptom entries. 10 of 69 outputs hit the 4-click cap on at least one circuit; none hit the HSC or air caps. `ride_feedback`: 138 rows, all 138 linked to a resulting version, 57 with text, 7 with an outcome, 39 flagged `air_display_v241`.

#### Notes and the matcher contract

`lib/tuneNotes.ts` classifies by literal fragments: "Tune Two for " (summary), "Re-test on the same section" (retest), "Goals: ", "reversing that this round" and "slightly bigger step this round" (adaptive), "capping that change at" and the protect line "alone ... you said it was working" (protect; this fragment carries an em dash glyph inside it and must keep it), "opposite ways" (conflict; the engine's conflict note also carries an em dash), "From your written note" (parse). Everything else is routine. `NOTE_HINTS` maps circuits to the words that identify them in a note. Rewording any of these on one side degrades classification silently to routine; nothing tests the pair together.

### 1.3 The sag and spring layer

**Sag bounds** (`lib/sagBounds.ts`): a verified row with all of `stock_sag_mm`, `sag_min`, `sag_max` yields `{ target, min, max }`; anything else yields 105 / 95 / 112. `fetchModelSpecs` returns null for provisional rows, unmatched bikes, and guest-local bikes whose name does not resolve. All 116 catalog rows carry a full window, but there are only 9 distinct windows across 116 rows: 105 / 98 to 110 (67 rows: every WP linkage bike, every Showa Honda), 107 / 100 to 112 (27 rows: every PDS KTM and every Husqvarna FE), 102 / 95 to 107 or 108 (KYB Yamaha), 100 / 95 to 105 (YZ two-strokes), 103 / 96 to 108 (Kawasaki), 98 / 95 to 101 (Stark), and three singletons. These read as platform conventions rather than per-model factory figures. **I could not find a per-value source for the sag windows in the migrations** (the spring rates are annotated with sources; the sag columns are not), so treat the windows as reasonable conventions, not verified factory numbers.

**How sag is used:** the target goes out in guardrails, the prompt tells the model to return it, `baselineSagMm` returns it, `safeShape` clamps to it, and the client clamps to the same window. Result: sag equals target in 651 of 651 captured calls that sent a target. Refinement never changes sag. Rider weight never adjusts the target when a model matched.

**`computeSpringCheck`** (`lib/modelSpecs.ts:152-201`) needs a verified spec, a rider weight, and both `rider_weight_min_lbs` and `rider_weight_max_lbs`. It compares the rider's weight to the range: inside → ok; up to 10 lb outside → marginal; further → out_of_range, with direction stiffer (heavier) or softer. It reports which components are comparable: the shock when a shock rate exists; the fork when a fork rate exists and the fork is neither SFF nor air. It carries the stock rates as display values and never computes with them. It is a legitimacy check on the stock spring for the rider's weight. **Nothing in the codebase suggests a spring rate.** The weight ranges themselves come in 8 combinations across 116 rows (150 to 180 on 34 rows, 150 to 185 on 18, 155 to 185 on 17, 160 to 195 on 15, ...), and the stage-1 migration says GasGas ranges were copied from the KTM equivalent; the ranges look like platform conventions too. Flagged as unsure.

**Spring rates:** 111 rows carry a shock rate, 74 a fork rate (air rows are null by design; Stark, Xtrainer, and Sherco shocks are null because the factory publishes none). The PDS convention is the true engineering rate (60 to 72 N/mm), documented in `20260728100000`.

**Measured sag:** `setup_versions.sag_measured` is false on all 511 rows. `sessions.sag_measured` is false on all 6,231 rows. The only writer of a measured sag is the legacy `SagSaveModal` on the sessions save flows; no 3.0 surface asks for it. The Home meter's "Sag measured" category (15 points) reads both tables and can never fill for a 3.0 rider today. The engine never receives a measured sag.

### 1.4 The model catalog

`bike_models` has 32 columns. The ones that carry data: `make`, `model`, `year_start`, `year_end` (null = current), `rear_suspension` (linkage / pds), `fork_type`, `shock_type` (free strings such as "WP XACT air", "KYB SSS 48 coil"), `has_air_fork`, `stock_fork_spring_nmm`, `stock_shock_spring_nmm`, `rider_weight_min_lbs`, `rider_weight_max_lbs`, `stock_sag_mm`, `sag_min`, `sag_max`, `spec_verified`. The ones that do not: `stock_fork_comp` / `stock_fork_reb` / `stock_shock_comp` / `stock_shock_reb` (0 of 116 populated), `air_pressure_chart` (0), `fork_comp_max` / `fork_reb_max` / `shock_comp_max` / `shock_reb_max` (30 on all 116 rows: the column default, not data), `shock_hsc_turns_max` (null everywhere), `click_range_verified` (false everywhere), and the legacy `fork_min` / `fork_max` / `shock_min` / `shock_max` (defaults 0 and 30).

Counts: 116 generation rows, 103 verified, 13 provisional (Beta RR 2T 250 and 300, CRF250RX, CRF450X, KX450, RM-Z250 2016 to 2018, RM-Z450, WR250F, YZ125X, YZ250 2006 to 2021, YZ250FX, YZ250X, YZ450FX), 40 air-fork rows. By make: KTM 39, Husqvarna 28, Yamaha 15 (9 verified), GasGas 9, Honda 9 (7), Beta 5 (3), Kawasaki 4 (3), Sherco 3, Suzuki 3 (1), Stark 1.

**Aliases** (`bike_model_aliases`, 55 rows): lowercased, whitespace-collapsed user strings mapped to a canonical model; the alias points at the earliest generation and the year is re-resolved. Resolution order in `resolveModelId`: canonical make and model plus year within the generation window; then alias lookup, then the canonical name re-resolved by year. The server-side backfills use the same waterfall plus a canon-key strategy (strip spaces and hyphens), with the year sanity guard (1990 to 2027) and the rule that invalid-year bikes match only single-generation models. 13,579 of 20,257 bikes (67.0%) carry a model id.

**Unmatched bikes** get `DEFAULT_SAG`, no spring check, no `has_air_fork` in guardrails, and therefore the fork type is decided by the rider's toggle or the name heuristic. That is the path the seven 1.5-bar tunes took.

**Access:** both tables are world-readable (anon and authenticated SELECT), writable only by service role and the dashboard.

### 1.5 Cost and behavior

| Item | Value | Source |
|---|---|---|
| Model string, both calls | `gpt-4o-mini` | `index.ts:653, 1004` |
| Baseline call | temperature 0.2, `max_tokens` 350, no JSON mode, no server timeout | `index.ts:640-727` |
| Parse call | temperature 0, `max_tokens` 300, JSON mode, 5 s abort, fail-open | `index.ts:985-1030` |
| Client cap | 30 s race on baseline; none on refine | `tune.tsx:895`, `quizGenerate.ts:22` |
| Prod latency, ai-tune POST | p50 4,858 ms, p90 5,925 ms, max 6,856 ms (16 calls, 24 h to 2026-09-01) | edge logs, eval README |
| Pure API latency, 4o-mini | 2.1 s median over 10 replays | eval, 2026-09-01 |
| Token volume | roughly 600 in and up to 350 out per baseline; 200 in and up to 300 out per parse | prompt sizes |
| Monthly cost at ~900 baselines plus ~90 refines | under one dollar at $0.15 / $0.60 per million | surface map pricing basis |
| Fallback rate since capture | 0 of 680 baselines (no throw note, no key note, no formula signature) | branch |
| Clamp hits since capture | clicks at 0 or 30: 0; HSC at 0 or 3: 0; sag at a bound: 0; air at a discipline clamp: 2 of 183; refine click step at the 4-click cap: 10 of 69 | branch |
| Implausible air shipped | 7 calls under 8.5 bar (1.5 to 1.6), 5 saved versions at 1.5 to 1.8 bar | branch |
| Anon rate limit reached | 1 of 1,327 IP-hours hit 10; 3 reached 5 or more | branch |
| Signed-in peak | 19 calls in one user-hour (limit 20) | branch |
| Latency captured in DB | no; `tune_calls` has no duration column | schema |

---

## Part 2. Gaps against the 3.0 app

For each: what the app now sends or expects, and what the engine does with it.

### 2.1 Conditions

**App:** Start Riding collects `surfaces[]` (hardpack, loam, sand, mud; primary first), `state` (fresh, choppy, rutted), `temp` (cold under 50, mild, hot over 85), and `watered`. Today's setup and the retune tiles promise up to two clicker tweaks plus a tire pressure from these. `lib/conditionsRules.ts` is the deterministic rule base (choppy hardpack → fork comp +1; rutted → fork reb +1; sand or non-fresh loam → comp -1 and reb -1; mud → comp -2; hot → air -0.2 or LSC -1; cold → air +0.1; watered → tires -0.5 psi; retune: watered reverses a morning softening, roughed → comp -1, heating → air -0.1 or comp -1).

**Engine:** the Tune Two contract has no conditions input. The client sends the primary surface as `terrain`, the temperature band as a representative `temp_f` (45 / 70 / 92), and everything else as `terrain_tags`; `buildTuneTwo` reads `terrain` only to print the summary line and ignores `temp_f` and `terrain_tags` completely. The engine therefore has an opinion about conditions only when the rider typed free text that the parser turns into one of the 11 symptoms. With no text, `suggestForConditions` runs the rules locally and marks `engineSkipped: "no_free_text"`; with text but no parsed symptom it gets the echo and falls back to the rules. The "engine when online" path is, for conditions, a free-text symptom path with a conditions label on it.

### 2.2 Symptom taxonomy and qualifiers

**App today:** the ride log shows 11 chips over the engine's 11 ids (4 primary: Rear kicks, Harsh, Front pushes, Bottoming; 7 more) with 8 qualifier labels on three chips: Rear kicks (Square edges, Landings, Braking bumps), Harsh (Small chop, Under braking, Big hits), Packs (Whoops, Rocks). Tap level carries severity (mild 4, bad 8).

**App as planned (plan section 4.3):** 14 stable ids: harsh_small_bumps, bottoming, rear_kicks, front_pushes, packs_in_chop, wallows_dives, headshake, rear_swaps, deflects, rear_squats, too_stiff, too_soft, arm_pump, chatters; mandatory qualifiers on harsh, rear kicks, and packs; discipline-localized labels; the engine takes discipline as an input.

**Engine:** accepts exactly the 11 ids and the 4 where tags. The qualifier string is sent as `where`; `normalizeWhere` lowercases it and keeps it only if it is braking, corners, whoops, or landings. So "Landings" and "Whoops" survive, and "Square edges", "Braking bumps", "Small chop", "Under braking", "Big hits", and "Rocks" are dropped silently while `adjust_shown` meta records them as qualified. Decision 2 (map client-side) can honestly cover only part of it: Braking bumps → braking and Under braking → braking are faithful; Big hits → landings is defensible; Square edges has no tag but could switch the id to harsh_square_edge; Small chop and Rocks have no honest target. The parse prompt's vocabulary and `sanitizeParsedFeedback` whitelists are part of the same contract and change with it. Of the 14 planned ids, 6 have no engine table row today (wallows_dives, rear_swaps, rear_squats, too_stiff, too_soft, arm_pump, chatters, depending on how deflects maps), which means the taxonomy change is engine authoring, not a rename.

### 2.3 Named setups and per-setup lineage

**App:** versions carry `setup_id`; numbering and uniqueness are per setup (staged `20260904100000` and `20260905120000`); the quick refine settles onto the running setup; Update my baseline parents onto the running setup's version.

**Engine:** has no setup concept, and does not need one for the math. It matters in one place: `fetchLastOutcome` (`lib/ai.ts:362-424`) selects the newest outcome-rated feedback across all versions of the bike, so an outcome recorded on a Sand setup can drive the adaptive step (reversing or enlarging a delta) on the default setup's next refinement. The adaptive path has never fired in captured data, so this is latent, not observed. The fix is a client-side filter by setup when building `last_outcome`; no contract change.

### 2.4 Tire pressure

**App:** Today's setup always shows a front and rear psi: the rider's saved values when present, else a per-surface draft (13.5 / 13 hardpack, 13 / 12.5 loam, 12.5 / 12 sand and mud) marked as a default, with -0.5 psi when watered; drafts are never persisted (decision 5).

**Engine:** no tire input, no tire output, no tire vocabulary. The app's promise is met entirely by `conditionsRules.ts`. Recommendation in Part 4: keep it that way for 3.0, and record the tire plan in the ride-day rows rather than widen the engine.

### 2.5 Spring rate

**App:** `bike_extras` holds rider-entered `fork_spring_rate` and `shock_spring_rate` for the setup sheet's spring rows; the reveal and results screens show the spring check card (stock rate versus the rider's weight range).

**Engine:** never receives a rate, a rider range, or the check result (the check rides through `safeShape` only as an opaque passthrough). Nothing suggests a rate.

What a suggested rate would take: the rider's weight (captured on 95% of calls), the bike's stock rate and the weight range that rate is specified for (111 shock rows, 74 fork rows, ranges on all rows but of uncertain provenance), the discipline and whether the rear is linkage or PDS (captured), and a rate-per-weight slope per platform. The defensible form is the one the aftermarket fitment charts use: interpolate from the stock rate at the middle of its range along a published step (fork rates step in roughly 0.1 to 0.2 N/mm and shock rates in roughly 3 N/mm per fitment band). **The repository holds no such table, and I would not derive a slope from the nine seeded windows.** Until a sourced per-platform table exists (WP, KYB, Showa, and the PDS family separately), a "suggested rate" should be stated as "one step stiffer / softer than stock", which the current check already implies through `direction`, with a named catalog source per platform.

### 2.6 Measured sag

**App:** the meter has a "Sag measured" category; the reveal's meter card lists it; the setup sheet shows race sag as a row; the ride-day flow never asks for a measurement; the 3.0 writers stamp `sag_measured: false`.

**Engine:** treats sag as a target only; refinement holds it constant.

How the loop should use it: a rider-measured sag belongs on the version as a fact (`sag_mm` with `sag_measured: true`, or a separate `measured_sag_mm`), the engine should receive both the target and the measurement, and the first thing it should do is compare them: within the window → nothing; out of the window at the correct preload → say "preload" not "clicker" and, when the preload is at its limit, say "spring", which is the honest route to a spring suggestion. That is a contract widening (an input field and a new note family), so it belongs in the roadmap, not the 3.0 PR.

### 2.7 "Why N for you"

**App:** the setup sheet renders a "Why N for you" block per adjuster from `whyForYou` (`lib/adjusterCopy.ts`): a template that folds in weight, terrain, skill, and the version history line. The mockup says "template text now, wired to ai-explain output later."

**Engine:** emits only `notes[]`. For a baseline the numbers are the LLM's, so there is no per-circuit derivation to explain; the deterministic formula could emit one exactly (base by discipline, weight term, intensity term, goal term, clamp), but its numbers are not the ones shipped. For a refinement the engine already has everything internally: `contribs` per circuit with symptom id and severity, the resolved delta, the conflict, protect, and adaptive decisions. Emitting a structured `changes[]` next to `notes[]` (circuit, from, to, contributions, resolution, reason template) would make the refine explanations true with no change to the numbers or to the note strings; a baseline explanation is only true if the baseline becomes deterministic-first or the model is asked for per-field rationale under a schema.

### 2.8 Invented previous values and synthetic refine rows

**`snapshotToTune`** (`lib/rideAdjust.ts:50-57`) fills 12 / 12 / 1.5 / 14 / 105 into any null circuit before sending `previous`. The branch shows 0 refine inputs with all five defaults at once and 57 of 69 with sag 105 (mostly real targets), so the fabrication has been rare so far; it becomes common the moment a version with sparse typed columns (older rows, manual rows with a null) reaches the ride-day path. `safeShape` does the same on the way out (12 / 12 / 12 / 14 / 1.5 / 105 for missing fields), and a `ZeroResult` cannot represent "unknown".

**Synthetic refine rows:** the conditions path sends `overall_rating: 5, symptoms: []` with the bike id, so each "say it your way" ask on Today's setup or retune is recorded as a `tune2_v1` call, counts against the 20 per hour limit, runs the adaptive-step logic against the bike's last outcome, and lands in refine analytics as a no-symptom call (15 such rows on the branch; the 14 echo outputs are mostly these).

---

## Part 3. Plumbing and security

Audited as an attacker and as an accountant.

### 3.1 Auth and rate limiting

- The gateway has `verify_jwt = true` for ai-tune, which admits the anon key's own JWT; the handler's `getUserId` calls `auth.getUser(token)` and treats the anon key as no user. Baseline accepts no user; refine returns 401.
- `anon_id` must match a strict uuid regex, is lowercased, and is stamped only on anon rows; authenticated rows ignore it. Verified by the attribution tests.
- Rate limits: 20 per hour for a user across both modes; 10 per hour per IP for anon baselines. The IP is the first entry of `x-forwarded-for`, else `cf-connecting-ip`, else "unknown". **Unsure:** whether the Supabase gateway overwrites or appends to a client-supplied `x-forwarded-for`. If it appends, a caller controls the first entry and the anon limit is per made-up IP; if it overwrites, the limit holds. This needs one live check with a spoofed header on the branch.
- `countRecentCalls` fails open on infra error (allow, logged). `recordCall` failing leaves the call uncounted and uncaptured but still served.
- **The rate limit depends on the insert succeeding, and the insert can be made to fail by the caller.** `bike_model_id` is uuid-gated but not existence-checked; it is a foreign key to `bike_models`. A random uuid makes the insert raise 23503, `recordCall` catches and returns null, no row is written, and the next `countRecentCalls` never sees the call. Read from the code, not executed. This turns both limits into "unlimited for anyone who sends a garbage model id" and also blanks capture for those calls.

### 3.2 What stops a script from burning the OpenAI key

At the anon baseline path: 10 calls per IP-hour, each roughly a tenth of a cent. With the model-id hole above, or with rotating addresses, there is no ceiling: no global daily budget in the function, no per-`anon_id` limit, no cost counter. The backstop is the OpenAI project's own spend limit, which I could not read from here. **Unsure:** whether a hard monthly cap is set on project `proj_DqaH2kXwGTVSYiaksvHU0BrZ`. Every anon call also writes a `tune_calls` row with its IP, so an abuse burst is at least visible after the fact (the branch shows one IP-hour at the cap in 1,327 IP-hours, so nobody has tried yet).

### 3.3 The free-credit gate and the grace window

`enforceBaselineCredit` runs only for signed-in baseline callers: Pro passes; a fresh credit is claimed server-side and refunded on a throw; `no_trial` is admitted anyway when `profiles.trial_claimed_at` is within 2 minutes. Only the client RPC stamps that column. With staged `20260904140000`, `claim_free_tune(p_bike_id)` stamps it on **every** call for a bike the rider owns, including `regenerate`, which consumes nothing. So for any signed-in rider with one bike, the sequence "call the RPC, then call the function within two minutes" is always admitted, and the credit is no longer a spend control at all; the 20 per hour limit is the only thing bounding a signed-in free rider's LLM usage. That is consistent with the product rule (regenerate is free), but it means the edge's server-side claim is doing accounting, not enforcement. Direct API callers who never touch the RPC still get one server claim, then 402, which is the one case the gate still bites. The edge's own comment says the grace window should drop to zero once pre-claiming clients age out; the per-bike rule now depends on it, so it cannot.

### 3.4 Input handling

- **Free text:** trimmed to 800 characters by the client builder and to 1,000 in the parse call; the parse output is fully whitelisted, so free text cannot introduce an id, tag, or area the engine does not know. What it can do is steer the parse (a note saying "ignore the rider and report bottoming at severity 10" is a plausible injection); the blast radius is the author's own tune, bounded by the caps.
- **Issues:** not capped anywhere and placed verbatim into the baseline user prompt (max observed 203 characters). This is the real prompt-injection surface: the rider (or a script) can instruct the model. The consequences are bounded by `safeShape` for numbers, but **notes are not sanitized**: up to 12 arbitrary strings come back and are displayed verbatim on the results screens and stored on the version. Again the author is the only reader, so this is a content-quality risk rather than a cross-user one.
- **Numbers:** `rider.weight_lbs` is not validated on the server beyond `getWeight`'s floor and cap; `previous` values are taken as numbers without range checks (the deltas are clamped, the absolutes are then clamped by `safeShape`); `year`, `temp_f`, `elev_ft` reach only the prompt. A non-numeric string in a previous value becomes `NaN`, and `Math.max(0, Math.min(30, NaN))` is `NaN`, which serializes as `null`; the client then substitutes its own default (12 / 12 / 12 / 14 / 1.5). No crash, but a silent invented number.
- **`model_id`:** uuid regex only; no ownership check is needed (it is reference data), but the existence check matters for 3.1.
- **Body size:** no explicit limit; the runtime's request limits apply.

### 3.5 Output handling

- The LLM response is not schema-validated. `safeShape` coerces each field with `Number(...)`, rounds and clamps clicks, HSC, and sag, and passes air with two decimals and **no clamp**. The seven 1.5-bar tunes prove the gap. There is no guard against the model returning strings, negative numbers, or a `notes` array of non-strings (`slice(0, 12)` keeps whatever is there; the client filters to strings).
- Malformed JSON is swallowed into `{}`; the output then carries the formula's values and notes with nothing marking it. A thrown call appends the "AI fallback used" note. There is no `engine_source` field. A client can tell only by inspecting note text, and `tuneNotes` does not classify either marker.
- Clamps are enforced before persistence on the server (`recordOutput` stores the shaped result) and again on the client before the version write. The one value that is persisted un-clamped is air.

### 3.6 Secrets, config, logging, retention

- `OPENAI_API_KEY` lives only in Supabase function secrets (production and the branch; the listing exposes digests, not values). The OpenAI project carried a model allowlist pinned to `gpt-4o-mini` until 2026-09-01. Spend caps: unknown (see 3.2).
- Logging: the function logs only failure messages sliced to 120 to 160 characters (`console.warn`); it never logs prompts or model responses. The persistent record is `tune_calls.input`, which stores issues, free text, rider weight, and the coarse location verbatim, for every call, indefinitely. Deleting an account cascades the user's rows (`user_id references auth.users on delete cascade`); anonymous rows, with IP and location, are never deleted, and rows claimed at signup keep their IP. There is no retention job.

### 3.7 Data integrity and what analytics can trust

- Capture completeness: 749 of 771 rows since 2026-08-07 carry input and output; the 22 without were served by the pre-capture function version around the deploy. Before that date rows carry only mode, user or IP, and time.
- Failed `tune_calls` inserts drop rows silently; failed output updates leave input-only rows. Neither is counted anywhere.
- `setup_versions`: 221 of 511 rows are bare snapshots without context; 85 carry a model id; `sag_measured` is never true; `settings_delta` is trigger-owned and trustworthy.
- `ride_feedback.suspect_flags`: 39 of 138 flagged `air_display_v241`; the flag catches only rows written before the migration, not rows from clients still on 2.4.0 afterward.
- Trust rules: baseline analysis should use `tune_calls` rows with output present and a first note not starting with the formula signature; refine analysis should exclude rows with an empty symptom list and free text (the conditions path) until those are marked; version analysis should go through `settingsFromRecommended` and filter on `context.engine`; feedback analysis should exclude flagged rows; the 2026-07-27 verification cluster (anon id `d0d0feed-...-0001`) and the assembly test account should be excluded from anon-row counts.

---

## Part 4. Recommendations

### 4a. The minimum change set for 3.0 (one PR: engine, tests, note matchers, client)

The frozen-contract PR. Everything below keeps the v1 regression byte-identical for inputs that do not use the new fields, which is the discipline the existing suite already follows for the v2 fields.

| # | Change | Engine | Tests | Note matcher | Client | Risk |
|---|---|---|---|---|---|---|
| 1 | **Conditions input.** `input.conditions { surfaces[], state, temp_band, watered }` on `tune2_v1`. Port `conditionsRules` server-side as a contributions stage that runs before symptoms (each rule is a contribution tagged `conditions` so conflict and protect resolution see it), with the tire psi delta returned as a separate `tire_psi_delta` field. Clamps unchanged. | new stage, new note templates ("Choppy hardpack → +1 fork compression") | new fixtures per rule; regression suite unchanged because the stage is skipped when the field is absent; a client-rules parity test asserting the server port equals `conditionsRules` for the same inputs | add the conditions note fragments and a `conditions` bucket | `rideEngine` and `rideAdjust` send conditions; rules stay the offline fallback (decision 1) | low; the risk is drift between the two copies, which the parity test pins |
| 2 | **Taxonomy.** The 14 planned ids with an input-side translation table from the 11 legacy ids, so old clients and old `ride_feedback` rows still resolve. New table rows for the ids with no engine move today. Discipline as an input that can flip a chip's default direction. | 14-row switch, `SYMPTOM_LABELS`, `KNOWN_SYMPTOM_IDS`, `PARSE_SYSTEM_PROMPT`, translation map | the v1 regression keeps passing through the translation map; new per-id fixtures at three severities; parse re-eval with the harness on the new vocabulary | new per-symptom note strings; `NOTE_HINTS` unchanged | `Tune2SymptomId`, `SYMPTOM_PHRASES`, `rideSymptoms`, the historical-row mapping | medium; the new moves are tuning authorship, not code, and need River's sign-off per row |
| 3 | **Qualifiers.** Extend `where` to the plan's mandatory sets (small chop, under braking, big hits, jump face, braking bumps, logs and ledges, whoops, rocks, plus the four legacy tags). Each pair with a special move gets a table entry; pairs without one keep the note suffix. | `KNOWN_WHERES`, where modifiers | fixtures per new pair | none | send tags, not labels; keep the decision-2 label map as the bridge until this lands | low |
| 4 | **Tire model: keep it out of the engine.** Record the tire plan (source, front, rear, delta) on the ride-day rows and in `tune_calls.input.conditions`; let the engine echo `tire_psi_delta` from item 1 only. | none beyond item 1 | none | none | persist the plan the rider saw | nil; widening the engine with a tire model it cannot justify would create a second unsourced table |
| 5 | **Honest previous values.** `previous` accepts null circuits; `snapshotToTune` stops fabricating; `safeShape` returns null for a circuit the engine never had (and never invents 12 / 12 / 12 / 14 / 1.5 / 105); a `NaN` guard on every coerced number. | `ZeroResult` fields nullable on input and output; `safeShape` rewrite for the null case | regression fixtures unchanged (all fully populated); new sparse-previous fixtures; a NaN fixture | none | `snapshotToTune`, `normalizeResult`, `tuneToSnapshot` tolerate null | low |
| 6 | **Mark the conditions path.** `feedback.source: "conditions"` when symptoms are empty and text is present; skip `last_outcome` on that path; analytics filter on it. | one flag, one skip | one fixture | none | `rideEngine` sets it | nil |
| 7 | **Hardening that rides in the same PR because it touches `safeShape`.** Air clamped to the guardrail window (send `air_min_bar` / `air_max_bar`, default 7 to 14); the name heuristic excludes minis (50, 65, 85) and requires a full-size model string; an `engine_source` field ("llm", "fallback_error", "fallback_parse", "deterministic"); HSC rounded to the hardware quarter turn instead of one decimal (or left unrounded and quantized on the client, which is the smaller contract change); `bike_model_id` existence-checked before the insert so a bad id cannot blank the rate limit. | `safeShape`, `isAERFork`, handler | the regression fixtures all have in-window air and HSC values that survive both roundings, which must be asserted, not assumed | none | read `engine_source`; stop inferring from notes | medium only for the HSC rounding, which changes emitted values on existing tunes and needs a decision |

Order inside the PR: 5 and 7 first (they change `safeShape` and the regression harness), then 1, then 2 and 3 together, then 6, then 4's persistence. The parse prompt rewrite lands with 2.

### 4b. The engine-quality roadmap beyond 3.0

| Item | What it needs | Do we have it |
|---|---|---|
| **Deterministic-first baseline.** Make the formula the number source and the LLM the explainer (surface 1's `ai-explain`), so weight, skill, terrain, and goals affect the tune the way the notes claim, and so "Why N for you" can be derived from the actual terms. | the discipline-specific formula already exists; a decision to trust it over the model; a per-circuit contribution record emitted with the result | yes; the formula has never been exercised in production (0 fallback calls), so a shadow comparison over the 680 captured inputs is the first step |
| **Suggested spring rate** | a sourced per-platform rate-versus-weight table (WP linkage, WP PDS, KYB SSS, Showa, KYB PSF and SFF handled separately), the stock rate and its rated range with provenance, rider weight, discipline | rates yes (111 shock, 74 fork); rated ranges and sag windows of uncertain provenance; no slope table. Do not derive from the seeded windows |
| **Measured-sag feedback** | a measurement field on the version (`sag_measured` true with the number), the engine receiving target and measurement, a preload-versus-spring note family, and a place in the app that asks for it (the walkthrough's sag card is the obvious spot) | schema yes, data none (0 measured rows anywhere), no engine input |
| **Per-model stock-anchored clamps** | `click_range_verified` with real `fork_comp_max` etc. and `shock_hsc_turns_max`, and stock clicker positions per generation | no: 0 verified ranges, 0 stock clicker rows, all max columns at the default 30 |
| **Outcome-weighted priors** | enough outcome-rated refinements per symptom and platform to move a step size or direction | no: 7 outcomes on 138 feedback rows; the surface map's principle 6 (n = 1 framing until roughly 1,000 labeled rows) applies |
| **Adaptive step, proven** | the reverse-or-enlarge path firing at least once in the wild, then outcome data on whether the reversal helped | never fired in captured data; the per-setup `last_outcome` filter from 2.3 first |
| **The Terra async surfaces** (surface map, 2026-09-01) | `ai-explain` hybrid why-explanation: inputs fully captured today, no schema, separate edge function; night-before test plan: Phase 1 tables plus weather; ride-wrap synthesis: ride_days and track_sessions; fleet-learning monthly job: `tune_calls` capture plus outcomes; per-track memory: visit volume | explanation and fleet job are buildable now; the rest wait on ride-day volume and outcomes. The eval established the deployable shape for 5.6 models (`max_completion_tokens` at 1,000 or more, no temperature, `reasoning_effort: "low"`) and that terra misses the synchronous latency bar |
| **Discipline as a first-class input** | `rider.discipline` replacing the keyword scan; the quiz already knows it | yes on the client, no on the wire |
| **Latency and cost capture** | a `duration_ms`, `engine_source`, and token-usage column on `tune_calls` written by `recordOutput` | schema change, trivial |

### Things I am unsure of, stated plainly

1. Whether the sag windows and rider weight ranges in `bike_models` are factory numbers or platform conventions; the migrations source the spring rates line by line and say nothing about these two columns.
2. Whether the gateway lets a client control the first `x-forwarded-for` entry.
3. Whether the OpenAI project has a hard spend cap.
4. Whether production's ai-tune v26 is byte-identical to the repository file (memory says yes at deploy; not re-verified).
5. The exact cause of the 22 uncaptured rows since 2026-08-07 (most likely the rollout window on that day).
6. Any factory spring-rate-versus-weight slope; I have not stated one and would not without a named source per platform.
