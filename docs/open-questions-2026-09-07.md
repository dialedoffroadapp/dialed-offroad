# Open questions, 2026-09-07

Every question across the audit (`docs/audit-v3-2026-09-04.md`), the engine discovery (`docs/engine-discovery-2026-09-05.md`), the shadow report (`scripts/engine-tools/results/shadow-2026-09-07.md`), the symptom table draft (`docs/symptom-table-draft.md`), the conditions rules (`lib/conditionsRulesCore.ts`), the migrations, the ride-day plan, and CLAUDE.md that is still waiting on a human answer or an external source. The fifteen audit decisions of 2026-09-04, the fourteen engine decisions of 2026-09-05 and 2026-09-07, and the five shadow-report decisions are answered and excluded; questions those decisions opened are included.

Each entry: the question in one sentence; where it came from; what the code assumes today; what happens if the assumption is wrong; what kind of answer settles it; and whether it can be answered by research from published sources (**Research**), needs River's own judgment (**River**), or both (**Both**). Ranked within each group by how much rides on the answer.

---

## 1. Engine tuning

### 1.1 Are the deterministic formula's coefficients right for shipping as the numbers riders see?
- **Source:** engine discovery Part 1.1 (the deterministic layer), shadow report 2026-09-07, shadow-report decision 1.
- **Assumes today:** fork base 14 / 12 (MX), 16 / 14 (enduro), 15 / 13 (mixed); shock 12 / 14 / 1.4, 14 / 16 / 1.6, 13 / 15 / 1.5; weight slopes per 10 lb of 0.4 / 0.3 (fork comp / reb), 0.3 / 0.4 / 0.03 (shock LSC / reb / HSC); intensity slopes 0.6 / 0.5 / 0.4 / 0.6 / 0.05; clamps 6 to 24, 6 to 20, 8 to 22, 0.75 to 2.0. None has ever been ridden: the formula was the fallback and never fired in production.
- **If wrong:** every deterministic baseline is off in the same direction for a whole band of riders; the first ride carries it and the loop corrects only after feedback. The shadow report shows the medians the formula will ship per weight band.
- **Settles it:** River riding the formula's own bikes against it, then outcome data through the permanent regression script. Manufacturer setup sheets can anchor the bases per model but not the slopes.
- **Answer by:** Both.

### 1.2 Are the discipline air windows and slopes right, and what should happen to the 27 riders who land on a clamp?
- **Source:** discovery 1.1 (`baselineAirBar`), shadow report clamp section (27 of 680 inputs on the air window; riders under about 145 lb on the MX floor of 9.8 bar, riders over about 220 lb on the enduro or mixed ceilings), engine decision 11 (client defaults dropped, discipline math live).
- **Assumes today:** MX 10.6 bar at 185 lb and 0.22 per 10 lb inside 9.8 to 11.8; enduro 10.0 / 0.18 inside 9.0 to 11.2; mixed 10.2 / 0.20 inside 9.4 to 11.5; a comfort or support bias of 0.1.
- **If wrong:** light riders get more air than the window should allow or heavy riders less, and the clamp flattens the slope at both ends.
- **Settles it:** WP's published AER and XACT pressure-by-weight charts (in the KTM, Husqvarna, and GasGas owner's manuals) for the base and slope; River for where the windows should end.
- **Answer by:** Both (Research for the chart, River for the ends).

### 1.3 Should skill and style move the formula more than they do?
- **Source:** discovery 1.1 (`intensityFactor`), shadow report by-skill tables (beginner, intermediate, and pro medians are identical on every circuit), quiz mapping note in `lib/quizOnboarding.ts` (four quiz skills onto three engine levels; Fast shares intermediate).
- **Assumes today:** pro +1.0, beginner -0.5, short motos +0.5, long enduro -0.2, clamped to 1.5; a 4-level quiz answer folded into 3 plus derived goals.
- **If wrong:** a pro and a beginner of the same weight get the same tune, which the shadow report says is the case today.
- **Settles it:** River's judgment on how far skill should move a baseline; outcome data later.
- **Answer by:** River.

### 1.4 Are the six authored symptom moves and the five authored qualifier routes right?
- **Source:** `docs/symptom-table-draft.md` (25 rows marked NEW), PR body sign-off table, engine decision 12, shadow-report decision 5 (held as draft).
- **Assumes today:** wallows_dives firmer comp and firmer LSC; rear_swaps softer LSC and slower rebound; rear_squats firmer LSC with a quarter turn of HSC when bad; too_soft the mirror of too_stiff; arm_pump softer comp, faster rebound, less air; chatters slower rebound and a click softer comp; harsh + big hits routed to bottoming; rear kicks + jump face adds a quarter turn of HSC, + logs and ledges adds a click of LSC, + braking bumps slows fork rebound; packs + rocks adds a click of fork comp.
- **If wrong:** a refinement moves a circuit the wrong way for that symptom, bounded by the 4-click, 0.5-turn, 0.3-bar clamps.
- **Settles it:** River reviewing the draft next session; tuner references can support a direction but the table is his.
- **Answer by:** River.

### 1.5 Which end bottoms, and should the bottoming row ask?
- **Source:** ride-day plan 4.3 ("Bottoming: none (ask which end)"), symptom draft (the bottoming row is rear-focused: LSC, HSC, and air).
- **Assumes today:** bottoming means the rear, with a small air move for the front.
- **If wrong:** a fork that bottoms gets a shock change.
- **Settles it:** River, on whether the chip gets a front-or-rear qualifier.
- **Answer by:** River.

### 1.6 How should the three legacy ids without a v3 twin read, and is general_harsh really too_stiff?
- **Source:** `LEGACY_TO_V3` in the engine and in `lib/rideSymptoms.ts`, PR body.
- **Assumes today:** dead_feel, unstable_whoops, and harsh_square_edge stay first-class; general_harsh reads as too_stiff; harsh_braking_bumps reads as harsh_small_bumps under braking; packs_whoops as packs_in_chop in whoops.
- **If wrong:** historical feedback rows display under the wrong chip, and the parse vocabulary has no target for a rider's "dead" or "square-edge" note.
- **Settles it:** River.
- **Answer by:** River.

### 1.7 Are the severity mappings right: tap once 4, twice 8, sentiment 8 / 6 / 4, overall 8 / 5 / 3?
- **Source:** `lib/rideSymptoms.ts`, discovery 1.2 (globalScale and clickDeltaForSeverity tables), device pass round 3 item 5.
- **Assumes today:** mild is 4 and bad is 8 on the engine's 1 to 10 scale; without a tap level the moto's sentiment decides; the overall rating from sentiment sets the global step scale (0.4 to 1.5).
- **If wrong:** every refinement's step size is scaled up or down together.
- **Settles it:** River, then outcome data.
- **Answer by:** River.

### 1.8 Is the adaptive step's rule right, given it has never fired?
- **Source:** discovery 1.2 (adaptive notes in 0 of 69 captured refinements), engine decision 5 (scoped to the setup lineage).
- **Assumes today:** a "worse" outcome replaces the computed move with the negative of last round's move on that circuit; "same" adds one unit.
- **If wrong:** a full reversal overshoots, or the enlargement compounds.
- **Settles it:** outcome data once outcomes are recorded again (7 outcomes on 138 rows today); River on the rule until then.
- **Answer by:** Both.

### 1.9 Should any LLM stay in the synchronous path once the numbers are deterministic?
- **Source:** shadow-report decision 1 (explanation-only model call, in-path, 5 s cap), the first live deterministic call (about 3 s, one wrong-direction note before the prompt fix).
- **Assumes today:** the notes come from the model when it answers in time, else from the formula's own notes.
- **If wrong:** the reveal waits on a model for prose that adds latency and occasionally contradicts the numbers.
- **Settles it:** River after reading a batch of deterministic reveals; the async ai-explain shape from the surface map is the alternative.
- **Answer by:** River.

### 1.10 What sag should an unmatched bike get?
- **Source:** discovery 1.3 (the v1 fallback: 102 / 108 / 105 plus 0.5 per 10 lb and per intensity unit, plus 2 for long enduro, clamped 98 to 112) and 1.4 (33 percent of bikes unmatched).
- **Assumes today:** the fallback numbers above; matched bikes get the catalog target exactly.
- **If wrong:** a third of riders get a sag target that is a guess with a weight term the catalog path deliberately dropped.
- **Settles it:** published race-sag guidance per platform; River on whether the weight term stays.
- **Answer by:** Both.

---

## 2. Catalog provenance

### 2.1 Are the sag windows factory numbers or platform conventions?
- **Source:** discovery 1.3 (9 distinct windows across 116 rows; 105 / 98 to 110 on every WP linkage and Showa row, 107 / 100 to 112 on every PDS and FE row, 102 / 95 to 108 on KYB), migration `20260906120000` (flags default false, no per-row source in any migration).
- **Assumes today:** the window is the engine's sag target on every matched bike (target hit in 651 of 651 captured calls) and the client's final clamp.
- **If wrong:** every matched bike's rear sag target is off by several millimeters, the largest single lever on the rear and the one the loop never revisits.
- **Settles it:** each model's owner's manual (KTM, Husqvarna, and GasGas print race sag; Yamaha and Honda print a range) recorded per row with its source, then `sag_window_verified`.
- **Answer by:** Research.

### 2.2 Do the 2016 model-year KTM SX and Husqvarna FC and TC rows really carry the AER air fork?
- **Source:** migrations `20260715130000` and `20260728100000` (rows starting at 2016 with "WP AER 48 air"), discovery 1.4, engine decision 1 (the catalog flag is now the only automatic fork-type source).
- **Assumes today:** a 2016 250 SX-F, 125 SX, 150 SX, 350 SX-F, 450 SX-F, FC 250, FC 350, FC 450, and TC 125 are air forks.
- **If wrong:** the auditor's recollection is that AER 48 arrived with the 2017 model year and 2016 ran the WP 4CS coil fork; if so, every 2016 rider is told an air pressure for a coil fork and the spring card is suppressed for them.
- **Settles it:** the 2016 and 2017 KTM and Husqvarna spec sheets.
- **Answer by:** Research.

### 2.3 Are the KTM 250 XC and 300 XC two-stroke rows really coil, when the same-year XC-F rows and the Husqvarna TX 300 are air?
- **Source:** migrations `20260715130000` (300 XC 2017 to 2022 "WP XPLOR 48 coil", 2023+ "WP XACT coil") and `20260728100000` (250 XC the same; 250 / 350 / 450 XC-F "WP AER 48 air"; TX 300 "WP AER 48 air").
- **Assumes today:** the two-stroke XC is a coil bike and the four-stroke XC-F an air bike on the same platform in the same years.
- **If wrong:** the auditor believes the XC two-strokes share the SX's AER and XACT air fork (the XC-W is the XPLOR coil bike); if so, XC riders get coil tunes with no air value and no air row.
- **Settles it:** KTM's 2017 and 2023 XC spec sheets.
- **Answer by:** Research.

### 2.4 Are the rider weight ranges factory numbers or copies?
- **Source:** discovery 1.3 (8 combinations across 116 rows), migration `20260728100000` line 53 ("GasGas rider-weight ranges copied from the KTM equivalent displacement"), engine decision 9 (spring card gated off until sourced).
- **Assumes today:** nothing user-facing, because the card is gated; the ranges still sit in `computeSpringCheck` waiting for the flag.
- **If wrong:** once re-enabled the PASS / FAIL card tells a rider the stock spring suits them when it does not, or the reverse.
- **Settles it:** supplier fitment charts (Race Tech, K-Tech, WP, KYB spring-rate calculators) per platform, recorded per row, then `weight_range_verified`.
- **Answer by:** Research.

### 2.5 Which spring rates are still provisional or contested?
- **Source:** migration `20260728120000` (13 provisional rows: Beta RR 2T 250 and 300, CRF250RX, CRF450X, KX450, RM-Z250 2016 to 2018, RM-Z450, WR250F, YZ125X, YZ250 2006 to 2021, YZ250FX, YZ250X, YZ450FX), migration `20260728100000` (contested: 350 SX-F shock 45 versus 44, FC 250 2023+ 45 versus 42, 500 EXC-F fork 4.6 versus 4.2, FE 350 2017 to 2019 fork 4.4 versus 4.6; the FE shock sequence 48 then 42 then 45 across generations looks odd), Sherco shocks and the Xtrainer fork unpublished.
- **Assumes today:** provisional rows surface nothing; verified rows display their rates verbatim on the spring card.
- **If wrong:** a displayed rate is wrong (display only; the engine never computes with rates).
- **Settles it:** factory parts fiches and fitment charts per row.
- **Answer by:** Research.

### 2.6 What are the real click ranges and HSC turn ranges per fork and shock family?
- **Source:** discovery 1.4 (`fork_comp_max` and friends at the seed default 30 on all 116 rows, `shock_hsc_turns_max` null, `click_range_verified` false everywhere), CLAUDE.md landmine.
- **Assumes today:** every clicker has 30 positions; the engine clamps 0 to 30; the range bars are hidden.
- **If wrong:** the engine can emit a click count a fork does not have (a 20-click KYB rebound told to run 22), and the stepper lets a rider record one.
- **Settles it:** the factory manual per fork and shock family, recorded per row, then `click_range_verified`.
- **Answer by:** Research.

### 2.7 What are the stock clicker positions per generation?
- **Source:** discovery 1.4 (0 of 116 rows carry `stock_fork_comp` or its siblings), roadmap item "per-model stock-anchored clamps", `v_bikes_with_stock` reading null.
- **Assumes today:** nothing; no "versus stock" display and no stock-anchored clamp exists.
- **If wrong or absent:** the formula's bases stay discipline-wide instead of model-anchored; the trial card's stock delta stat stays empty.
- **Settles it:** the factory manual per generation.
- **Answer by:** Research.

### 2.8 Which models get catalog rows next, and are minis in scope at all?
- **Source:** CLAUDE.md current state (unmatched top: pre-2018 CRF250R, pre-2017 300 EXC, pre-2019 KX450, minis, FX 350 and 450, Varg EX, Beta RR 4T, 2023+ 300 SX), migration `20260728120000` (minis and pre-2005 out of scope), engine decision 1 (the five 1.5-bar tunes were all minis).
- **Assumes today:** a mini rider gets an adult coil tune with adult clamps and no catalog anchor.
- **If wrong:** either a third of riders keep getting default sag and no fork type, or minis keep getting numbers built for full-size bikes.
- **Settles it:** River's scope call, then research per row.
- **Answer by:** Both.

### 2.9 Are the 2024+ PDS linear rates (69 and 72 N/mm) and the K-Tech progressive codes confirmed?
- **Source:** migration `20260728100000` header (K-Tech fitment charts for 2017 to 2023, a WP R&D interview via Transmoto for 2024+).
- **Assumes today:** true engineering rates on every PDS row, 60 to 72 N/mm.
- **If wrong:** the displayed rate on PDS bikes is wrong (display only).
- **Settles it:** the WP or KTM PowerParts spring listing for the 2024 platform.
- **Answer by:** Research.

---

## 3. Physics and practice

### 3.1 Are the conditions rules right, now that the engine serves them too?
- **Source:** `lib/conditionsRulesCore.ts` (plan 4.5 v1 text, "revise later from outcome data"), engine decision 6 (the same rules run server-side, parity-tested).
- **Assumes today:** choppy hardpack +1 fork comp; rutted hardpack +1 fork rebound; sand or non-fresh loam -1 comp and -1 rebound; mud -2 comp; hot -0.2 bar on air forks else -1 shock LSC; cold +0.1 bar; watered -0.5 psi; retune roughed -1 comp; heating -0.1 bar or -1 comp; watered reverses the morning's chop softening.
- **If wrong:** every Today's setup suggestion pushes the wrong way, bounded to one or two clicks, and the parity test locks the wrong rule in on both sides.
- **Settles it:** River's judgment now, then outcome data per rule.
- **Answer by:** River.

### 3.2 Are the tire pressure defaults right?
- **Source:** `lib/conditionsRules.ts` line 135 ("DRAFT defaults for River's review"), audit decision 5 (drafts stay, Start never persists them; the numbers themselves were not decided).
- **Assumes today:** hardpack 13.5 / 13, loam 13 / 12.5, sand and mud 12.5 / 12 psi front / rear; watered takes 0.5 off both.
- **If wrong:** a rider without a saved pressure is shown a starting point that is off for their tire and terrain.
- **Settles it:** the tire makers' published MX and off-road pressure guidance (Dunlop, Michelin, Bridgestone) plus River's own numbers.
- **Answer by:** Both.

### 3.3 Are the adjuster locations right for each fork and shock family?
- **Source:** `lib/adjusterLocations.ts` ("DRAFT for River's review"), audit decision 6 (AER 48 rebound at the bottom of the right leg; copy still under review), device pass round 3 item 3 (photos keyed by family this weekend).
- **Assumes today:** AER and XACT air rebound at the axle lug of the right leg with older XACT under the top cap; XPLOR splits compression left and rebound right up top; KYB SSS and Showa compression at the bottom and rebound on the cap; PSF-2 both legs; Öhlins varies; shock LSC and HSC on the reservoir, rebound at the clevis, sag at the preload collar.
- **If wrong:** the walkthrough sends a rider to the wrong screw and they turn the wrong circuit.
- **Settles it:** River's own bikes and the weekend's photos, the factory manual for the rest.
- **Answer by:** Both.

### 3.4 Does "clockwise to the stop is zero, count clicks out" hold for every adjuster on every family?
- **Source:** `lib/adjusterLocations.ts` HOW copy, `app/set-on-bike.tsx` convention line, the engine's zero-based contract.
- **Assumes today:** every clicker and the HSC knob close clockwise and count out; the same number on both legs where both carry an adjuster.
- **If wrong:** a family whose adjuster counts from open, or whose two legs are not meant to match, gets set backwards.
- **Settles it:** the factory manual per family.
- **Answer by:** Research.

### 3.5 Is the HSC hardware step a quarter turn on every shock family?
- **Source:** engine decision 4 (quarter-turn HSC), `CIRCUIT_STEPS.shock_hsc` step 0.25.
- **Assumes today:** WP, KYB, Showa, Öhlins, and Sachs high-speed knobs all step in quarter turns.
- **If wrong:** the engine's moves and the stepper do not land on a detent for that family.
- **Settles it:** the factory manual per shock family.
- **Answer by:** Research.

### 3.6 How should the measure-sag walkthrough define and measure sag?
- **Source:** shadow-report decision 7 (three-measurement method, saves `sag_measured`), the current `shock_sag` HOW copy (two measurements), discovery 1.3 (the catalog's `stock_sag_mm` is used as the race sag target).
- **Assumes today:** race sag is axle-to-fender unloaded minus the same measurement with the rider on the bike in gear.
- **If wrong:** the measurement the rider enters is a different quantity from the target it is compared against (static versus race sag, gear or no gear).
- **Settles it:** River's method and the manual's definition per platform.
- **Answer by:** Both.

---

## 4. Product and business (new questions only)

### 4.1 What is the trigger to flip production to deterministic, and what is the rollback signal?
- **Source:** shadow-report decision 1 (approved behind `app_config.baseline_engine`; production stays "llm" until River flips it), the extended shadow report.
- **Assumes today:** production keeps the shipped LLM path; the dev branch runs deterministic.
- **If wrong:** either the flip waits on nothing in particular, or it happens without a signal that would tell River to flip back.
- **Settles it:** a business decision on the evidence threshold (device pass on River's bikes, a week of `engine_source` rows, a ride outcome).
- **Answer by:** River.

### 4.2 Do minis and other out-of-scope bikes get refused, a catalog row, or an adult tune?
- **Source:** engine decision 1 (the 1.5-bar class), migration `20260728120000` (minis out of scope), catalog question 2.8.
- **Assumes today:** an adult coil tune with adult clamps.
- **If wrong:** a parent setting up a 65 follows adult numbers.
- **Settles it:** a product decision.
- **Answer by:** River.

### 4.3 Do off-road riders get discipline-localized chip labels and a different first screen?
- **Source:** ride-day plan 4.3 (labels swap by discipline, same id; off-road may warrant a different first screen), PR body follow-ups.
- **Assumes today:** the MX labels for everyone.
- **If wrong:** an off-road rider reads "Deflects" without the roots-and-rocks framing the plan promised.
- **Settles it:** River's vocabulary per discipline.
- **Answer by:** River.

### 4.4 Where does the rider's discipline persist after sign-up?
- **Source:** plan open flag 3 (`profiles.discipline` does not exist), engine decision 11 (the engine now takes `rider.discipline` from the quiz answer or the bike).
- **Assumes today:** the quiz store on the device and, for the Tune tab and ride day, inference from the bike.
- **If wrong:** a rider who told the quiz "off-road" on a bike the classifier calls MX gets MX math everywhere except the quiz.
- **Settles it:** a decision to add the column and grant, or to keep inferring from the bike.
- **Answer by:** River.

### 4.5 Should the pre-auth event queue cap stay at 25 now that the quiz queues about 20 events per run?
- **Source:** plan open flag 4, CLAUDE.md landmine (changing it alters analytics semantics).
- **Assumes today:** 25, oldest dropped.
- **If wrong:** a guest who tunes twice before signing up loses the first run's funnel events.
- **Settles it:** an analytics decision.
- **Answer by:** River.

### 4.6 Which attributed `tune_calls` fields get a retention window?
- **Source:** discovery 3.6 (free text, coarse location, and weight stored verbatim indefinitely on attributed rows), engine decision 13 (a 90-day window for anonymous rows only).
- **Assumes today:** attributed rows live until the account is deleted.
- **If wrong:** rider free text sits in the table for years for no analytical reason.
- **Settles it:** a privacy decision (a window, or strip free text and location after N days).
- **Answer by:** River.

### 4.7 Does 3.0 ship track creation to the server?
- **Source:** audit S2 (local tracks mint local ids, no outbox kind, `serverId` never updated).
- **Assumes today:** "Name this track" stays on the device.
- **If wrong:** the crowdsourced matching the plan describes never accumulates rows.
- **Settles it:** a scope decision for 3.0 versus the tracks phase.
- **Answer by:** River.

### 4.8 Should `tune_calls` link to the version it produced and carry `bike_id` as a column?
- **Source:** plan 5.x still-open item and CC-Q 1 (`resulting_version_id`, `bike_id`), engine decision 3 (`input.bike_id` now stored inside the jsonb).
- **Assumes today:** the bike id is in the jsonb and no call-to-version link exists.
- **If wrong:** the fleet-learning job cannot join a call to the outcome it led to without a heuristic.
- **Settles it:** an analytics decision, then a small migration and a client write at save time.
- **Answer by:** River.

### 4.9 Which Boise-area tracks are seeded verified, and what are the season window dates?
- **Source:** plan 4.4 item 4 ("list from River pending: names, rough location, soil type"), RIVER-Q 6 (season window, a v2.7.0 concern; Season Pass rename pending).
- **Assumes today:** no seeded tracks; no season window.
- **If wrong:** nothing breaks; the track confirm chip and the recap wait.
- **Settles it:** River's list and dates.
- **Answer by:** River.

### 4.10 The remaining Claude Code homework from the plan.
- **Source:** plan section 14: CC-Q 2 (check-in timing reuse), CC-Q 3 (preride_copied base), CC-Q 4 (legacy sessions readers), CC-Q 6 (AsyncStorage versus MMKV or SQLite), CC-Q 7 (offline blockers at launch), CC-Q 9 (night-before notification infra, v2.6.0), CC-Q 11 (entitlement gating for the flip), CC-Q 13 (shared component layer). CC-Q 10 (cron feasibility) is answered: pg_cron enabled and scheduled on the branch.
- **Assumes today:** AsyncStorage everywhere, the outbox as the offline path, legacy sessions readers untouched.
- **If wrong:** each is a scoping question rather than a correctness one.
- **Settles it:** River's priorities for the beta.
- **Answer by:** River.

---

## 5. External

### 5.1 Does the OpenAI project have a hard spend cap?
- **Source:** discovery 3.2 and its unsure list item 3; the anonymous baseline path is bounded only by 10 calls per IP-hour.
- **Assumes today:** no cap is known.
- **If wrong:** a script with rotating addresses can spend without a ceiling until someone notices the bill.
- **Settles it:** the OpenAI dashboard for project `proj_DqaH2kXwGTVSYiaksvHU0BrZ`.
- **Answer by:** River (a dashboard check).

### 5.2 Has the store intro trial been removed from the RevenueCat offering, and are 7.99 and 59.99 confirmed in both stores?
- **Source:** audit decision 10 (decided: removal is on the RC dashboard checklist, prices confirmed; the action itself is external), CLAUDE.md three-trials landmine, `lib/trialStatus.ts`.
- **Assumes today:** the copy "No trial: your Pro rides already happened" and "one tap to purchase" are true.
- **If wrong:** a store intro trial and the reverse trial coexist and the copy lies.
- **Settles it:** the RevenueCat dashboard and both store consoles.
- **Answer by:** River (dashboard work).

### 5.3 Is the sending domain registered with Apple's private email relay?
- **Source:** the v2.4.1 air-notice recipient list (11 of 95 addresses are Apple relay addresses), `docs/lifecycle-emails.md` (Loops drafts, nothing sends yet).
- **Assumes today:** nothing has been sent to a relay address from the app's domain.
- **If wrong:** mail to Sign in with Apple riders bounces at Apple's relay unless the domain and sender are registered under the app's Sign in with Apple configuration and pass SPF.
- **Settles it:** the Apple Developer portal (Certificates, Identifiers and Profiles, Services, Sign in with Apple for Email Communication) and a test send to one relay address.
- **Answer by:** Both (Research for the requirement, River for the portal).

### 5.4 Has the Google consent screen been moved from Testing to Production?
- **Source:** CLAUDE.md social-auth entry ("Still needed: River flips the Google consent screen Testing to Production before store submission").
- **Assumes today:** still Testing.
- **If wrong:** Google sign-in fails for anyone not on the test-user list at launch.
- **Settles it:** the Google Cloud console for project `611855927324`.
- **Answer by:** River.

### 5.5 Will `create extension pg_cron` succeed on production at push time?
- **Source:** migration `20260907110000` (attempts the extension and schedules the purge; degrades to a notice if refused), the dev branch where it succeeded.
- **Assumes today:** the postgres role may create the extension on a hosted project, as it did on the branch.
- **If wrong:** the purge function exists but nothing runs it; the migration says so in its notice and the function can be run by hand.
- **Settles it:** the dry run and push of the 3.0 batch.
- **Answer by:** a live test (River's go-ahead to push).

### 5.6 Is the Loops account and API key in place for the lifecycle function?
- **Source:** `docs/lifecycle-emails.md` ("nothing sends yet"), `lib/lifecycle.ts` (function not deployed).
- **Assumes today:** no email infrastructure.
- **If wrong:** the reverse-trial and downgrade legs have no email.
- **Settles it:** a Loops account, its key in function secrets, and River's approval of the drafts.
- **Answer by:** River.

### 5.7 What produced the 22 uncaptured `tune_calls` rows on the capture deploy day?
- **Source:** discovery unsure list item 5 (749 of 771 rows since 2026-08-07 carry input and output).
- **Assumes today:** the rollout window of ai-tune v25 on 2026-08-07.
- **If wrong:** a capture gap exists that the analytics trust rules do not exclude.
- **Settles it:** the edge function logs for that day, if still retained.
- **Answer by:** Research (a log check).

---

## Summary of what rides the most on an answer

1. Sag windows (2.1): every matched bike's rear target, never revisited by the loop.
2. Air-fork flags by model year and platform (2.2, 2.3): the fork type is now catalog-only end to end.
3. The formula's coefficients and air windows (1.1, 1.2): the numbers every deterministic baseline will ship.
4. Adjuster locations and the count-from-closed convention (3.3, 3.4): the walkthrough physically directs the rider.
5. The conditions rules (3.1): served from both sides and locked together by the parity test.
6. The OpenAI spend cap (5.1): the only ceiling on an unauthenticated cost.

Questions marked Research are ones Claude can take to published manuals, spec sheets, and fitment charts and bring back with sources per row; the catalog group is almost entirely that kind. Questions marked River are the ones only a rider's judgment or a business decision can settle.
