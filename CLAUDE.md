# CLAUDE.md

Dialed Offroad — an MX (dirt-bike) suspension-tuning app. Riders generate a base
tune, ride, give structured feedback, and get a refined tune; retention loops
bring them back. Stack: **Expo Router + TypeScript + Supabase** (Postgres + Edge
Functions), RevenueCat for IAP. Expo SDK 54, React Native 0.81, New Arch on.

## Run, test, verify

- **Run:** `npx expo start` — this is a **dev-client** app (custom native
  modules); **Expo Go will not run it**. iOS build: `npx expo run:ios`.
- **App tests:** `npx jest` (config `jest.config.js`, ts-jest; native modules
  stubbed in `__tests__/stubs/`). Component tests are `*.test.tsx` rendered
  with `react-test-renderer` against the same stubs (no RN jest preset);
  `stubs/react-native.js` drives AppState via `__emit` and completes Animated
  synchronously. See `__tests__/OutcomeCheckinCard.test.tsx` for the
  fresh-registry pattern components with module-level state need.
- **Typecheck:** no script — run `npx tsc --noEmit`.
- **Engine tests are separate (Deno, not Jest):**
  `AI_TUNE_TEST=1 deno test --allow-env supabase/functions/ai-tune/tests/`
- **Pre-existing baseline you did NOT introduce and should NOT "fix":** ~19
  `tsc` errors and ~16 ESLint `react/no-unescaped-entities` errors across
  unrelated screens. Judge a change by whether it *adds* errors, not by a clean
  global run.

## Repo map — where logic actually lives

| Concern | Files |
|---|---|
| Refine engine (deterministic, no LLM) | `supabase/functions/ai-tune/index.ts` |
| Engine client + tune/feedback types | `lib/ai.ts` (`generateTune`, `generateTuneTwo`, `ZeroTuneResult`, `Tune2*`, `SYMPTOM_PHRASES`) |
| Setup-version lineage (v2 persistence) | `lib/setupVersions.ts`, `lib/refineFlow.ts` |
| Per-model specs (sag bounds, spring check, fork type) | `lib/modelSpecs.ts`, `lib/sagBounds.ts` |
| Symptom picker (legacy post-ride debrief; RETIRED under the v3 flag: `app/tune-feedback.tsx` redirects every caller to `/ride/log?quick=1` for the same bike + version) | `app/tune-feedback.tsx` |
| Tune tab (legacy input screen, stays for 3.0) | `app/(tabs)/tune.tsx`. RETIRED from it 2026-09-04: presets (link, param, banner, apply), the ride check-in card, and the "Use 1 free tune credit" label (free copy is "Update my baseline" / "Generate tune"; the server decides). No "modes" concept exists in its JSX |
| Tune results | `app/tune-two-results.tsx` (baseline: `app/tune-results.tsx`) |
| Post-ride check-in card | `components/OutcomeCheckinCard.tsx`, `lib/checkinLogic.ts` |
| Ride-arm cards (Setup + Home) | `components/RideCheckinCard.tsx`, `lib/rideArmCard.ts` (per-version lifecycle: armed latch, 24h snooze, 14d window; Home slot mutually exclusive with check-in cards via `homeArmSlotVisible` + OutcomeCheckinCard's `onEligibility`) |
| Local notifications | `lib/rideReminder.ts`, `lib/reminderArrival.ts`, `lib/trialReminder.ts`, `lib/guestRecovery.ts` (30h guest-abandon nudge — armed when a guest backgrounds off locked results, cancelled on any auth session; NEVER prompts for permission; analytics-dark until a `usage_events` CHECK migration adds `guest_recovery_*` types) |
| Conversion model (3.0, 2026-09-04; playbook compass_artifact_wf-8f89db56) | `lib/entitlement.ts` (client of `resolve_entitlement` / `start_reverse_trial`, migration `20260904150000` STAGED: `trial_active` → `free` → `pro`, usage-anchored reverse trial 3 ride days / 21 days, no card, downgrade never deletes; pro from the UNCHANGED RC webhook always wins; device cache), `lib/proGate.ts:gateIfLocked` (gate fires ONLY in free), `lib/placements.ts` (RC Placements `feature_gate_*` per trigger), `lib/gateCopy.ts` (name action + payoff + cost anchor), `app/pricing.tsx` (monthly anchor, annual default, lifetime after 3 ride days, config price), `components/home/TrialCards.tsx`, `lib/meterStall.ts`, `lib/remoteConfig.ts`, `lib/lifecycle.ts` + `supabase/functions/lifecycle-events` (Loops; NOT deployed; drafts in `docs/lifecycle-emails.md`), dashboards `20260904160000` (schema `analytics`) + `docs/analytics/conversion-dashboards.md` |
| Free baseline credit + Pro gate (3.0, 2026-09-04) | `lib/freeTune.ts` (`claimBaselineCredit(bikeId)` → `claim_free_tune(p_bike_id)`, migration `20260904140000` STAGED: one baseline per bike, `regenerate` NOT consumed / never refunded, no bike = legacy single credit; both new cases stamp `trial_claimed_at` so the UNCHANGED edge admits the request through its interim grace window), `lib/proGate.ts` + `components/v3/ProGateSheet.tsx` (imperative locked-row gate mounted once in the root layout; names the Pro action, offers "Update my baseline instead" → `/(tabs)/tune?bikeId&regenerate=1`; `createBaselineVersion({parentVersionId})` parents the regenerate onto the running version). All four Pro gates (refine, history, second setup, second bike) call `showProGate`, never `/premium` directly. **Dev-only fail-open (2026-09-04):** against a project WITHOUT `20260904140000` (prod today) the per-bike signature is missing and PostgREST answers PGRST202, which killed the quiz reveal for signed-in riders ("Couldn't check your free tune"); `claimBaselineCredit` treats exactly that error as a no-consume regenerate when `isDevBuild()` (`lib/featureFlags.ts`, `__DEV__` = literal false in release bundles), logs a warning, and still fails closed on every other error |
| Paywall position + triggers (3.0) | `lib/paywallPosition.ts` (remote flag: prod `app_config.paywall_position` > device cache > `EXPO_PUBLIC_PAYWALL_POSITION` > `action_gated`; migration `20260902110000` STAGED), `lib/paywall.ts` (`paywallHref(trigger, "back")` is the ONE way to open `/premium`; `paywall_trigger_action` on every paywall event), `lib/onboardingCompletion.ts` (the ONE completion sequence: paywall success in the interstitial world, signup in the action-gated one), `lib/usage.ts` stamps `paywall_position` on every paywall-related event |
| Paywall / Pro / IAP | `app/premium.tsx`, `lib/purchases.ts`, `hooks/usePro.ts`, `supabase/functions/revenuecat-webhook` (`verify_jwt = false` — it's a public webhook; acks FK-23503 upsert failures with 200 so RC stops retrying deleted users) |
| Account deletion | `supabase/functions/delete-account` (auth-user delete + avatar cleanup; DB rows cascade). The legacy typo slug `delete-acount` was RETIRED (deleted from prod) 2026-08-31 after zero invocations across the full log-retention window — `app/(tabs)/profile.tsx` still tries correct name then typo (fallback harmless: correct name succeeds first); drop the typo entry from its `names` array in a v2.5.x client pass |
| Auth (email + native Apple/Google) | `app/signup.tsx`, `app/login.tsx` (both have provider buttons), `lib/authSuccess.ts` (**`completeAuthSuccess` is the ONE post-auth success path** — profile upsert, guest-bike migration, events, onboarding advance; email signup and both screens' OAuth call it, never reimplement it; `mode: "login"` = email login's heal-only profile write for returning users — NEVER downgrades onboarding columns), `lib/socialAuth.ts` (signInWithIdToken flows, module-presence feature gates), `lib/emailSignup.ts` (**the ONE email auth sequence**: signUp → already-registered recovery signIn → auto signIn, status result; `app/signup.tsx` and the quiz gate both call it, never reimplement it). **Under the quiz flag `app/signup.tsx` is a redirect** (pending tune → `/quiz/gate`, else `/quiz`; its blurred tease and `returnTo` retire with it): email sign-up happens INLINE on `app/quiz/gate.tsx`, and its recovered-account case goes through `completeAuthSuccess` (the legacy screen keeps its inline heal for the flag-off world). Same-email OAuth collisions rely on Supabase auto-linking (default-on, verified email) — no in-app linking code by decision |
| Onboarding | `lib/onboarding.tsx`, `app/index.tsx`, root `app/_layout.tsx` |
| Quiz onboarding (3.0 first-run, flagged; garage flows `add_bike` / `new_setup` / `regenerate` reuse the screens: regenerate opens on the terrain tiles with the running setup's terrain preselected (`terrainIdFor`), asks only missing rider facts, and the reveal saves the NEXT version on that running setup (`flowSetupId`); the shell's progress bar counts the flow's own questions from `flowSteps`, snapshotted at start) | `lib/featureFlags.ts` (`EXPO_PUBLIC_QUIZ_ONBOARDING=1`), `lib/quizOnboarding.ts` (answers store, engine-input mappings, model classification/ordering, catalog search, `logQuizEvent`), `lib/quizContext.tsx` (provider + `useQuizStepView`), `lib/guestGarage.ts` (the guest bike store the garage sheet + signup migration already use), `components/quiz/*` (fixed Carbon palette, Barlow Condensed via `-google-fonts/barlow-condensed` runtime load, `useAnswerRhythm` = the one tap→hold→advance rhythm), `app/quiz/*` (one screen per question; `_layout` owns fonts + slide stack) |
| Ride day (3.0, `feat/ride-day-flow` off the integration branch) | (2026-09-04 device pass: `conditions.surfaces` is an ARRAY, primary first, read via `surfacesOf`/`primarySurface`; `lib/rideEngine.ts:suggestForConditions` = engine when online with free text, rules fallback, `source` + `engineSkipped` in event meta; the Tune Two edge has NO conditions input, adding one is a frozen-contract change; moto `durationMin`/`laps` → `track_sessions.duration_min`/`laps` via staged `20260905110000`; shared `components/ride/SayItYourWay.tsx`) | `lib/rideDay.ts` (on-disk session + idempotent outbox; pending deltas reuse `lib/currentSetup.ts` shapes; settle rule = ONE manual version at End ride), `lib/conditionsRules.ts` (deterministic conditions rule base, v1 text), `lib/rideAdjust.ts` (Adjust change set = Tune Two diff, reasons from engine notes; NO hardcoded symptom→adjuster mapping; two-change PRESENTATION cap), `lib/rideSymptoms.ts` (4 + More over the existing 11 engine ids; qualifiers = `where`), `lib/tracks.ts` (recent / nearby via `match_tracks` / new-track-here), `lib/rideEnd.ts` (also `finishQuickRefine` / `abandonQuickRefine`), `lib/rideRefine.ts` (QUICK refine: the setup sheet's "Refine after ride" and the retired debrief's redirect open Log → Adjust on a `RideSession.quick` session with no track / clock / ride_days row; Done settles ONE version on that setup and links each moto's `ride_feedback` row via the `feedback_link` outbox job; a quick session is never a ride-mode takeover), `lib/rideLiveActivity.ts` (require-guarded no-op until native), `components/ride/*`, `app/ride/*` (start, track, conditions, today, mode, retune, log, adjust, end). Log chips carry the debrief's severity (tap once = mild → 4, twice = bad → 8 on the engine scale; `MotoSymptom.level`, `severityFor(sentiment, level)`). Mockups: `design/mockups/ride/` |
| Home + Garage v3 (3.0 core screens, flagged) | (2026-09-04 round 2: Garage ALWAYS opens to the list; the Tune tab slot leaves the bar under the flag and the flow is reached via Garage doors: Add a bike, New setup (Pro, `setupId` → `setup_versions.setup_id`), Update my baseline (`regenerate=1`), New tune; Home day-one CTA opens `/setup-sheet` and marks First Steps step 2 via `lib/firstSteps.ts`; `components/ShareSetupCard.tsx` loads BOTH natives (`expo-sharing`, `react-native-view-shot`) lazily inside a try, Share hides when absent, pinned by `__tests__/shareSetupCard.test.ts`; Garage flows reuse the QUIZ screens post-onboarding via `answers.flow` (`lib/quizOnboarding.ts`: `startGarageQuizFlow`, `nextQuizRoute`, `resetQuizForNextRun` keeps rider facts): Add a bike = picker → drumroll → reveal (`autoCreateBaselineFromPendingTune`), New setup = terrain tiles → drumroll → reveal (named from the terrain, `setup_id` + parent = running version, rename by long-press on the bike page); "Set it on the bike" first run = `app/set-on-bike.tsx` walkthrough (copy DRAFT in `lib/adjusterLocations.ts`, keyed by fork/shock family; complete marks First Steps step 2, skip opens the sheet, returning riders skip it) | `lib/featureFlags.ts` (`HOME_GARAGE_V3_ENABLED`, follows the quiz flag when unset), `components/v3/*` (dialed.css tokens/primitives, Barlow Condensed headings + Inter 700 numbers via runtime `useFonts`), `components/home/*` + `lib/homeV3.ts` (Home view model; rides = `ride_feedback` rows), `components/garage/*` + `lib/garageV3.ts` + `lib/bikeSetups.ts` (named setups, default = `setup_id` null), `app/garage-bike.tsx` / `app/setup-sheet.tsx` / `app/setup-story.tsx`, pure logic in `lib/dialedMeter.ts`, `lib/homeCopy.ts`, `lib/setupStory.ts`, `lib/rideRules.ts`, `lib/adjusterCopy.ts`; local-first stores `lib/bikeExtras.ts`, `lib/seasonGoals.ts`, `lib/nextRide.ts`, `lib/bikePhoto.ts`. Mockups: `design/mockups/` (visual source of truth) |
| Theme | `useTheme()` from `lib/theme`; tokens in `constants/theme.ts` (also `lib/themeManager.ts`, `theme/ThemeProvider.tsx`) |
| Analytics | `lib/usage.ts` (`logEvent`, `UsageEvent` union) |
| Legacy sessions | `lib/sessions.ts` + many screens (see Data model) |

## The Tune Two loop (the core product flow)

`app/tune-feedback.tsx` (chips: symptom + severity + where + protect) →
`lib/ai.ts:generateTuneTwo` → `ai-tune` edge function (`mode: "tune2_v1"`,
deterministic rules, **no LLM** in the refine path) → `app/tune-two-results.tsx`.

Persistence (v2): every tune is a row in `setup_versions`
(baseline/refinement/restore lineage via `parent_version_id`); rider feedback is
a row in `ride_feedback`. Retention: a 36h local reminder → outcome check-in
card ("Better/Same/Worse") → funnels into the picker for the next refinement.
The adaptive engine reads the last recorded outcome to reverse/enlarge its step.
The reminder re-arms at every feedback submit for the new refinement ("How did
the new setup feel?") and is cancelled when its outcome is answered; the
notification permission ask lives at feedback-submit success in
`tune-feedback.tsx` (NOT the results screen). Check-in eligibility runs on tab
focus AND on warm resume (AppState background→active, one check per background
episode; >1h backgrounded resets the one-card-per-session latch).

**Check-in analytics counting rule:** a surfaced check-in card logs
`checkin_shown` (outcome mode) **or** `preride_shown` (first-ride mode) —
total check-in surfacing = the SUM of both. Both carry `checkin_source` meta
(`home_mount | warm_resume | notification | tune_focus`), threaded through the
card's refine params so `feedback_submitted` meta has `checkin_source` exactly
when the submission started from a card (absent = results-screen / garage /
Bike Home entries — most submissions, by design). The key's presence also
fingerprints v2.3.0+ clients. The notification-permission prompt
logs its outcome in `heard_card_shown` meta (`surface: "notif_prompt"`,
`outcome: granted|denied|declined`) — no dedicated event type (new types need
a `usage_events_event_type_check` migration).

**Fleet fingerprint (v2.3.0+):** every event's meta carries `app_version`,
stamped in `logEvent` at generation time — queued pre-auth events keep their
origin version through the flush, so absence of `app_version` means a
pre-v2.3.0 generator, not a pre-auth event. Prefer it as the general
version gate.

**Pre-v2.3.0 tune-attribution correction (Workstream C audit, 2026-07-24):**
before v2.3.0, pre-auth onboarding tunes exist in `tune_calls` only as
`user_id IS NULL` ip-only rows — attributed rows therefore massively
undercount "generated a tune" for signups (July 2026: 25% attributed vs ~91%
add-a-bike). For historical windows, estimate the tune-before-signup rate as
`min(1, anon zero_baseline_v1 rows / signups)` over the same window.
Assumptions: ~1 pre-auth tune per onboarding device (measured 1.07 =
930 rows / 872 distinct IPs, Jul 7–24) and anon rows ≈ onboarding guests
(direct-API abuse is bounded by the 10/hr per-IP limit). **Never row-link
historical anon rows to users:** auth audit logs store no IPs, and time-window
matching is ambiguous (only 8 of 292 July guest-tune signups had a unique
candidate in a 2h window).

## Data model & Supabase

- **Two parallel data models — know which you're touching:** legacy **`sessions`**
  (coarse, single `shock_comp`, still written/read across ~8 screens for
  history/display) and the v2 **`setup_versions` + `ride_feedback`** lineage. New
  tuning work belongs in the v2 tables.
- **RLS:** every user-facing table is own-rows-only via `auth.uid() = user_id`.
  `setup_versions` has **no update/delete policy → rows are immutable**.
  `ride_feedback` is insert + a column-scoped update of only
  `(outcome, resulting_version_id)`.
- **Self-referential RLS subqueries MUST table-qualify their outer columns** — an
  unqualified `parent_version_id` bound to the inner alias and silently broke
  every refinement insert (fixed in `20260707100000`).
- **Migrations:** `supabase/migrations/YYYYMMDDHHMMSS_name.sql`, additive.
  **Canonical workflow: `supabase db push` against the linked project
  (ref `urqpiwxapckaiorvdvfi`).** No local Postgres/Docker. Table-level grants
  cover new columns automatically; `profiles` uses column-level grants (a new
  client-writable column needs an explicit `grant`). A new `UsageEvent` type
  needs a drop/re-add migration of `usage_events_event_type_check`.
- **Migration-history rule: `db push` ONLY from a branch whose
  `supabase/migrations/` folder is a superset of everything already applied to
  prod.** Pushing from a branch missing an applied migration diverges history.
  `release/v2.2.0` satisfies this (it merged `feat/bike-entry-canonicalization`
  first, which carries all applied prod migrations — through `20260715150000`).
- **3.0 push order (decision 2026-09-04):** the 3.0 batch is pushed with
  `supabase db push --include-all --dry-run` first, then `--include-all`,
  regardless of what the hotfix branch pushed before it. Reason: the hotfix
  carries `20260905100000`; once prod's newest applied version is that, a
  default `db push` skips every older staged file and `20260905110000` then
  fails on a missing `track_sessions`. `--include-all` applies every file
  missing from the remote history, in order.
- **v2.3.0 migration batch: APPLIED to prod 2026-07-27** from
  `release/v2.3.0` — `20260724090000` (oauth event types), `20260724110000`
  (tune_calls anon claim), `20260727100000` (loop event types; 54-type
  constraint verified live), plus `20260727110000` (claim RPC anon revoke).
  `ai-tune` was redeployed AFTER the batch; store builds may now ship
  (before this, the queued loop events would have poisoned the pre-auth
  flush batch). **Grant idiom rule from the stage-1 finding:** this
  project's default ACLs grant function EXECUTE to anon/authenticated as
  INDIVIDUAL roles, so `revoke ... from public` alone leaves anon able to
  execute — auth-required RPCs must `revoke execute ... from anon`
  explicitly (the `20260715150000` idiom).
- **v2.4.0 data capture (2026-08-07, migration `20260807120000`):**
  `tune_calls` gained `input` jsonb (the full validated request `body.input`,
  verbatim; top-level `mode`/`anon_id` excluded — they have dedicated
  columns), `output` jsonb (the generated tune, attached post-generation by
  the `recordOutput` dep — the insert stays pre-generation so rate limiting
  is unchanged), `rider_weight_lbs` (promoted from `input.rider.weight_lbs`),
  and `bike_model_id` (uuid FK → `bike_models`; the edge accepts optional
  `input.model_id`, uuid-gated). **Step 2 (client, ships with v2.4.0):**
  both tune paths now send `model_id` when the bike resolved to a model —
  baseline via `tune.tsx` (verified spec row id, else the bike's own
  `model_id`), refine via `Tune2Context.model_id` (tune-results reads
  `metaObj.spec.model_id`; `buildRefineParams` reads the stored
  `recommended_settings.context.model_id`); omitted (not null) when
  unmatched. `sessions.sag_measured` + `setup_versions.sag_measured`
  (boolean, default false): false means "not confirmed measured".
  `sessions.sag_mm` is RIDER-MEASURED ONLY now: both save flows gate the
  insert with `components/SagSaveModal.tsx` (optional field, empty by
  default, 50-150 mm sanity bounds) — a value saves `sag_mm` +
  `sag_measured: true`, blank saves null + false, and the engine's
  recommended sag is NEVER written to sessions (it lives on the
  setup_version, whose writers still stamp `sag_measured: false`).
  **Step 3 (client + edge + migration, SHIPPED 2026-08-31):** coarse
  location capture at tune time — `lib/tuneLocation.ts` (expo-location
  behind a require guard; ONE permission ask ever, at first tune
  generation, latched in AsyncStorage `tune_location_prompted_v1`; input
  screens prewarm, generate does a 3 s-capped read) attaches
  `input.location = {lat, lng, accuracy_m}` (~110 m rounding) inside BOTH
  `lib/ai.ts` builders; key omitted when unavailable; the rider's elevation
  input is NOT auto-filled from it yet. Edge `sanitizeLocation` normalizes
  to exactly that shape or strips the key; generation never reads it.
  Migration `20260807150000` (APPLIED to prod 2026-08-31; ai-tune v26
  deployed same day with `sanitizeLocation` live)
  drops the never-written columns — sessions `terrain`/`rating_1_5`/
  `tire_pressure_f/r`/`elevation_ft` (0 non-null of 6,223; `elev_ft` is the
  live one) and bikes `current_fork_comp/reb`/`current_shock_comp/reb`/
  `current_sag_mm` (0 non-null of 20,104) — and rebuilds
  `v_bikes_with_stock` without the `current_*` columns (drop+create:
  security_invoker=true and the authenticated-SELECT/service_role-ALL
  grants restored explicitly; TrialMomentCard's column set unaffected).
- **bike_models spring convention (2026-07-28): `stock_shock_spring_nmm`
  stores the TRUE engineering rate on every row, PDS included.** PDS has no
  linkage reduction, so true PDS rates are ~60-72 N/mm (K-Tech progressive
  60/63/66 for 2017-2023, WP linear 69/72 for 2024+), far stiffer than the
  linkage-relative ~42-48 the original seed stored. Safe because nothing
  computes with the rate: the `ai-tune` edge never reads `bike_models` (its
  two mentions are comments; the client sends resolved guardrails), and
  `computeSpringCheck` (`lib/modelSpecs.ts`) decides status from the
  rider-weight range alone, carrying rates as display values that
  tune-results renders verbatim. Displayed rates must be real rates. Never
  mix conventions; migration `20260728100000` corrected the five original
  PDS rows and documents per-value sources inline.
- **Backfill year sanity guard (2026-07-28): `bikes.year` participates in
  generation matching ONLY when 1990-2027.** Prod holds corrupt years (24,
  213, 2825, 20250, 5019, ...). Invalid-year bikes get a `model_id` only on
  an unambiguous name match to a single-generation model; multi-generation
  matches stay NULL, never guessed (`20260728110000` idiom, reused in
  `20260728120000`). Make-casing residue ('Ktm', 'Gas gas', ...) came from
  pre-v2.2.0 binaries inserting without `normalizeBikeStrings`; no
  server-side path writes `bikes`, so there is no source to fix, only
  residue. One row was left misnamed deliberately: its user also has the
  same bike under canonical casing, and normalizing would violate
  `ux_bikes_unique_desc_per_user`.
- **`bike_models.spec_verified = false` means PROVISIONAL:** at least one
  spring rate is unconfirmed against a factory/fitment source. The client
  spec path (`fetchModelSpecs`) trusts ONLY `spec_verified = true`, so
  provisional rows surface nothing in-app; they still canonicalize strings
  and attribute `bikes.model_id`. Rows whose stored values are all
  confirmed stay verified even when a rate column is NULL because the
  factory publishes none (Sherco shocks, Stark's weight-swapped spring,
  Beta Xtrainer).
- **Prod division of labor:** read-only Claude (claude.ai chat, MCP) *verifies*
  prod — inspects rows, checks advisors/logs. Claude Code *writes* — migrations
  (`db push`) and edge deploys, and only when asked.
- **Server-computed fields are trigger-owned — never write them from the
  client:** `setup_versions.version_number` and `setup_versions.settings_delta`.
- **Base schema is not in the repo.** `bikes`, `sessions`, `profiles`,
  `usage_events` predate migration tracking and live only in prod — pull their
  shape from the linked project, don't infer it from code. *(Pre-`20260714`
  migrations are assumed applied to prod from commit history; not verified
  against the live DB.)*
- **Supabase preview branch `dev-3-0` (created 2026-09-04, org on Pro):**
  ref `rxbagshvbavrqtirprdz`, persistent, cloned WITH prod data (auth users,
  bikes, setup_versions, bike_models, migration history). ALL twelve staged
  3.0 migrations (`20260902100000`..`20260905120000`) are APPLIED THERE
  (36 total; `20260905100000` suspect flags, `20260905110000` moto duration
  and laps, `20260905120000` per-setup numbering indexes), `ai-tune` deployed from the repo (v28). `scripts/dev-branch.sh`
  is idempotent and refuses prod. Connection rules learned the hard way:
  the API-supplied branch password does not authenticate (a branch-scoped
  Management API reset was done; the password lives ONLY in
  `~/.supabase/dialed-dev-3-0-db-password`, mode 600, or `BRANCH_DB_PASSWORD`);
  `db push` MUST use the SESSION pooler (`aws-0-us-west-1.pooler.supabase.com:5432`,
  user `postgres.<ref>`): the transaction pooler on 6543 fails with
  `prepared statement ... already exists`, and the direct host is IPv6-only.
  Branch has NO `OPENAI_API_KEY` (set it in the branch project's dashboard
  before a reveal test). `.env.branch` (gitignored) holds the branch URL and
  anon key; its header has the one-line swap into `.env`. Enabling branching
  also created a default "main" branch whose ref IS prod: never target it.
  `supabase/.temp/*` is TRACKED in git (pooler-url holds only the
  `[YOUR-PASSWORD]` placeholder); never write a real secret there.
  Migration-order bug found by the branch push: `20260904120000` created
  the SQL-language `match_tracks` before `ride_days` (validated at CREATE
  time); the function now sits after the table. Migrations apply one
  transaction each (four committed before the failing file, five after).
- **Edge function deploy (observed workflow, not repo-documented):**
  `supabase functions deploy <name> --use-api` (no Docker). Confirm before use.

## Stable contracts — do not let these drift

- **Symptom taxonomy (contract v3, 2026-09-05, `feat/engine-contract-v3`):**
  `Tune2SymptomId` = 11 legacy ids + the plan's 14 v3 ids (headshake shared,
  24 total) ↔ engine `SymptomId` ↔ `SYMPTOM_PHRASES` ↔ `lib/rideSymptoms.ts`
  chips (8 first-screen + 6 more) ↔ `lib/setupStory.ts` labels ↔
  `lib/rideRules.ts`. Legacy ids keep their ORIGINAL engine rows (the v1
  regression stays byte-identical); `LEGACY_TO_V3` (engine + client copies)
  says how each reads today; three (dead_feel, unstable_whoops,
  harsh_square_edge) have no v3 equivalent and stay first-class. `where` is
  a TAG from the 11-tag `Tune2WhereTag` set (4 legacy + 7 qualifiers); the
  edge drops anything else, so never send labels. Seven authored v3 rows
  (wallows_dives, rear_swaps, rear_squats, too_soft, arm_pump, chatters,
  plus the three qualifier routes on rear_kicks) are marked SIGN-OFF in the
  engine and await River's per-row confirmation. Change all of them or none.
- **Circuit fields, one vocabulary everywhere:** `ZeroTuneResult`
  (`fork.comp_clicks/reb_clicks/air_pressure_bar`,
  `shock.lsc_clicks/hsc_turns/reb_clicks/sag_mm`) ↔ `setup_versions` columns ↔
  `settings_delta` keys
  (`fork_comp/fork_reb/fork_air/shock_lsc/shock_hsc/shock_reb/shock_sag`).
- **The engine's `fork.air_pressure_bar` is FINAL and is what `setup_versions` stores.**
  It already carries the rider-weight adjustment (`defaultGuardrails`:
  10.6 bar at 185 lb, 0.2 bar per 10 lb). Display code must show the saved
  value verbatim; the weight estimate exists ONLY for rows with no air
  value. `deriveAirBar` in `app/tune-results.tsx` and `app/tune-two-results.tsx`
  re-applied the delta on top of the engine value until 2026-09-04 (reveal
  10.2, legacy results 9.80 for the same tune). Every screen reads the
  saved version; none re-derives.
- **A write that fails must surface to the rider or to the outbox, never
  warn-and-continue** (audit rule a, 2026-09-04). supabase-js returns
  `{ error }` instead of throwing: check it. Offline or failed writes either
  enqueue a retry (the ride-day outbox in `lib/rideDay.ts` is the one outbox;
  extend its job kinds, never build a second) or show the rider an honest
  state. "Syncs after the next update" copy is allowed ONLY on paths that
  really enqueue.
- **Every screen shows the saved value exactly, through one shared
  formatter, never a re-derived or re-rounded one** (audit rule b). The
  air-display bug and the HSC 1.25 → "1.3" class both came from screen-local
  rounding. Format for display with `lib/format.ts:formatSetting` (two
  decimals, trailing zeros trimmed, integers untouched); store deltas rounded
  to the circuit's decimals (`CIRCUIT_STEPS`).
- **Engine output is frozen by a byte-identical v1 regression test.** Clamps:
  ±4 clicks/step, ±0.5 hsc turns, ±0.3 air bar; severities 1–10. Don't change
  engine math or note wording without updating the tests. **Contract v3
  exceptions, both deliberate:** HSC moves in QUARTER turns (unit 0.25, was
  0.15; a refinement snaps HSC to a quarter turn only when it moves it, a
  baseline always emits quarter turns) and the refine response carries
  `engine_source`; the regression harness masks exactly those two things and
  checks moved HSC lands on a quarter turn within one of v1's move.
- **Contract v3 wire additions (2026-09-05):** tune2 `input.conditions`
  (`Tune2Conditions`: surfaces / state / temp_band / watered / retune tile +
  prior tweaks) runs the ride-day rule base SERVER-side as a contributions
  stage (`conditionsRuleDeltas`, symptomId "conditions", severity 5, through
  conflict and protect; notes "Conditions: <label> → ...", output
  `tire_psi_delta`); `lib/conditionsRulesCore.ts` (NO imports) is the client
  copy and the Deno parity test holds the two equal over 576 cases, so
  change a rule in both or neither. `feedback.source` ("debrief" |
  "ride_log" | "conditions"; a conditions ask never runs the adaptive step),
  `input.setup_id` (captured; the client scopes `last_outcome` to that
  lineage, decision 5), HONEST previous values (`previous` circuits may be
  null; the engine leaves them null, names them in a note, and `safeShapeSparse`
  never invents 12 / 12 / 1.5 / 14 / 105; `snapshotToTune` sends nulls),
  fork air clamped to `air_min_bar..air_max_bar` (7 to 14) on both sides, a
  NaN guard (a non-number is not a value), and `engine_source` on every
  response ("llm" / "fallback_parse" / "fallback_error" / "formula" /
  "deterministic"). `generateTuneTwo` returns the sparse `Tune2Result`;
  callers that must persist a full tune go through `completeTune`.
- **`lib/tuneNotes.ts` must track the engine's literal note strings**
  (`ai-tune` `buildTuneTwo`). Reword one side and classification silently
  degrades to "routine." Contract v3 added the `conditions` bucket
  ("Conditions: " / "Tires: " prefixes).
- **Severity scale:** UI is 1–5, engine is 1–10, converted **exactly once** in
  `tune-feedback.tsx`. `ai.ts` clamps only — never re-scale (double-scaling was
  a shipped bug).
- **`ride_feedback.symptoms`** is a flat jsonb array mixing issue entries
  `{id, severity, where?}` and protect entries `{area, protect: true}`.
- **`setup_versions.recommended_settings` is canonically
  `{ settings: SettingsSnapshot, context: RecommendedContext }`**
  (`lib/setupVersions.ts`). `context` is the engine-input capture: `model_id`,
  `spec_verified`, `sag_target_mm`, `sag_bounds`, `rider_weight_lbs`,
  `spring_check`, `engine` (`"zero_baseline_v1"` | `"tune2_v1"` — must match
  `lib/ai.ts` wire modes). Prod ALSO holds bare `SettingsSnapshot` rows from
  older store builds — **readers must go through `settingsFromRecommended()`**
  (dual-shape safe), never assume the wrapper. `applied_settings` stays a bare
  snapshot (it IS just settings). Never bind the `settings` key to a possibly-
  undefined value — `JSON.stringify` drops it and you get the malformed
  `{"context": null}` rows already seen in prod.
- **Verified `bike_models.has_air_fork` is authoritative for fork type** —
  end-to-end (client override, guardrails, edge `resolveAirFork`/fallback/prompt).
  For unmatched bikes ONLY the rider's explicit toggle decides; the name-based
  `isAERFork` heuristic was REMOVED 2026-09-05 (decision 1: it air-forked
  minis and shipped 1.5-bar tunes) and the LLM is told never to guess. A
  baseline on a bike that is neither catalog-air nor toggle-air ships with no
  air value even if the model invented one. Migration `20260906100000`
  (STAGED) nulls the five mini versions that carried 1.5 to 1.8 bar. Same pattern for sag: per-model bounds/target from `lib/sagBounds.ts`
  ride guardrails; client and edge clamp to the SAME window.

## Landmines

- **Native modules → dev-client required.** expo-notifications,
  react-native-view-shot, expo-sharing, expo-apple-authentication, expo-crypto,
  @react-native-google-signin, expo-location (v2.4.0; `lib/tuneLocation.ts`
  require-guards it — unavailable, not broken, in older binaries). A fresh dev-client / EAS build is needed
  after any config-plugin change; **notifications are inert in binaries built
  before the plugin existed.** Social sign-in buttons feature-gate on module
  presence (`lib/socialAuth.ts` require guards) — absent, not broken, in old
  binaries. The Google config plugin is skipped entirely until
  `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` is set (empty env ⇒ no plugin, button hidden).
- **`oauth_started`/`oauth_failed` are analytics-dark AND must never be queued**
  (`queueIfAnonymous`) until `20260724090000_usage_events_oauth_event_types.sql`
  is applied: one queued unknown event type fails the ENTIRE pre-auth flush
  batch insert in `lib/usage.ts` and silently drops the onboarding funnel
  events with it.
- **`app/feedback.tsx` (a support-email screen) is NOT `app/tune-feedback.tsx`
  (the symptom picker).** Easy to edit the wrong one.
- **`lib/tuneEvents.ts` was deleted** on `feat/bike-entry-canonicalization`
  (confirmed unused). If you see it referenced, that code predates the merge.
- **Guest/legacy bike ids are not UUIDs.** Run ids through `asUuidOrNull`;
  bikeless (`null`) rows are valid.
- **Shadow writes are non-fatal by design.** `setupVersions` helpers throw;
  callers catch and fall back to `lib/feedbackRetry.ts`. Don't let them block the
  tune/refine flow.
- **Usage-event queue limits (known, accepted 2026-07-24):** the pre-auth
  AsyncStorage queue keeps only the LAST 25 events (older silently dropped)
  and the flush discards each event's `queued_at` — flushed rows get
  signup-time `created_at`. Generation time is unrecoverable; only
  `meta.app_version` reflects the generating binary. Don't "fix" these in
  passing — changing either alters analytics semantics.
- **`quiz_*` event types (8, `lib/usage.ts`) are analytics-dark until
  `20260902100000_usage_events_quiz_event_types.sql` is pushed** — and ALL
  of them queue pre-auth, so a dev-client signup with the quiz flag on
  before that migration lands loses that user's whole queued funnel batch.
  Accepted for dev; no store build may ship with the flag on before it.
  The 25-event pre-auth queue cap is also tight for the quiz (~18-20 queued
  events per run) — not changed, flagged.
- **`app_config` (migration `20260902110000`) is STAGED, NOT PUSHED** — until it
  lands the paywall position is NOT remotely switchable (build default
  `action_gated` on this branch); nothing breaks, the remote read fails open.
  Push it before the 3.0 store build. Both staged migrations must go from a
  superset branch.
- **Staged 3.0 events CHECK re-adds are a coherent ordered set (consolidated
  2026-09-04 on `feat/v3-integration`):** `20260902100000` (live 54 + quiz 8
  + paywall 3 = 65) then `20260904110000` (65 + Home/Garage 6 = 71). Never
  add a third re-add without carrying the full list — `20260904130000`
  (ride day) is the current superset at 94.
- **Three different "trials" coexist:** the shipped onboarding `trial` step
  (paywall shown/declined, interstitial world; untouched), RevenueCat's store
  intro trial (`lib/trialStatus.ts`, legacy Home cards), and the 3.0
  usage-anchored reverse trial (`profiles.entitlement_state`). Gates must
  use `lib/entitlement.ts` (`isEntitled`), never `deriveIsPro` alone. Store
  intro trials must be removed from the RC offering before "one tap to
  purchase" is true (dashboard work).
- **`claim_free_tune()` (zero-arg) is DROPPED by staged `20260904140000`;** the
  defaulted `claim_free_tune(p_bike_id uuid default null)` replaces it, so
  old clients' `rpc("claim_free_tune")` still resolves. **Since 2026-09-05
  (decision 3, staged `20260906110000`) the edge enforces the per-bike rule
  itself through `server_claim_baseline(p_user_id, p_bike_id)`:** pro passes;
  an owned bike with a baseline is a REGENERATE, not consumed, capped at
  `app_config.regenerates_per_day` (5) per rolling 24 h per bike (counted
  from `tune_calls` rows with an output whose `input.bike_id` matches; 429
  `regenerate_limit`); an owned bike without one is a FIRST BASELINE counted
  once; no bike = the legacy single credit (402 `no_trial`). The gate runs
  BEFORE the `tune_calls` insert and independently of the hourly limit. The
  2-minute client-claim grace window lives in the SQL function now, as the
  double-consume guard only; `CLIENT_CLAIM_GRACE_MS` is gone from the edge.
  Both baseline builders send `input.bike_id` (uuid only). The gate, the
  catalog check and the insert are dep-injected (`HandlerDeps.claimBaseline`
  / `refundClaim` / `modelExists`), so the Deno suite covers the signed-in
  leg offline (the old #10 failure is gone).
- **`bike_models.fork_comp_max` etc. are seed defaults (30 on all 116 rows),
  not data.** Never treat them as "known"; the v3 setup sheet renders a
  range bar only when `click_range_verified` is true.
  **Same rule for the spring PASS/FAIL card (decision 9, 2026-09-05):**
  `computeSpringCheck` renders only when the row's `sag_window_verified` AND
  `weight_range_verified` are true (staged `20260906120000`, both default
  false, no backfill: the sag windows are 9 platform conventions across 116
  rows and the weight ranges 8, with no per-row source). `fetchModelSpecs`
  retries without the two columns on 42703 so a project without the
  migration still resolves sag bounds and fork type.
- **`loop_preview_shown` / `hook_ride_armed` are unwhitelisted until the
  assembly migration** (see checklist item in Data model). Guest sessions on
  dev/TestFlight builds of `feat/loop-surfacing` will queue
  `loop_preview_shown` pre-auth — if such a build's user signs up BEFORE the
  migration lands in prod, the whole queued funnel batch is rejected at
  flush. Accepted for dev; the store build must ship after the migration.

## How to work here

- **Branch discipline (convention set 2026-07-24):** `main` tracks the shipped
  release — it was fast-forwarded to `release/v2.2.0` (build 35, the live
  binaries) and stays the source of truth. Feature branches come off `main`;
  release branches are cut from `main`. **Don't commit or push unless asked.
  Ask before pushing to the prod DB or acting on a release branch.** Keep
  commits scoped to one logical change.
- **Audit before building.** Much of this app already exists under other names
  (e.g. `setup_versions`/`ride_feedback` already cover "sessions/refinements").
  Search first; extend rather than rebuild.
- **Copy conventions (2026-07-28): NO em dashes in user-facing copy** —
  strings, toasts, notifications, accessibility labels, onboarding slides.
  Rewrite with periods, commas, or colons; machine-joined value summaries
  (share text, session notes) use " · ". Exceptions that KEEP their glyphs:
  the "—" empty-value placeholder (it's data, not prose), en-dash numeric
  ranges ("95–110 lb"), code comments, console logs, and — critically —
  engine note strings (`ai-tune` ↔ `lib/tuneNotes.ts` matchers are
  byte-frozen contract; one match string carries an em dash and MUST keep it
  until an engine+tests+tuneNotes three-way change).
- **Decisions in force:** `applied_settings == recommended_settings` until an
  override UI ships (schema is ready for the split); `settings_delta` is
  server-computed.

## Current state — update this section when structure changes
*(As of 2026-09-04. Standing rule: any commit that changes branch structure,
canonical data shapes, applied migrations, established conventions, or sprint
focus updates the relevant section of this file IN THE SAME COMMIT; commits
that change none of those skip it.)*

- **`release/v2.2.0` is the integration branch** — created off `release/v2.1.0`,
  merged in order: `feat/bike-entry-canonicalization` (first — its migrations
  folder is the branch's spine), `fix/onboarding-analytics`,
  `feat/locked-results-partial-reveal`, `feat/ride-loop-foundation` (last;
  `lib/setupVersions.ts` conflict resolved: canonical `{settings, context}`
  writer + ride-loop's trigger/columns/check-in machinery both kept).
- Migrations applied to prod AND present here: `20260714120000` through
  `20260715150000` (recommended/applied/delta columns, bike_models generations
  schema + backfill, security hardening), plus the v2.3.0 batch
  `20260724090000`–`20260727110000` (applied 2026-07-27), plus the
  spec-expansion batch `20260728100000`–`20260728120000` (applied
  2026-07-28 from `feat/bike-specs-expansion`, cut off `release/v2.3.0`),
  plus the v2.4.0 pair `20260807120000` (applied 2026-08-07) and
  `20260807150000` (applied 2026-08-31 from `release/v2.4.0`).
- **`release/v2.4.0` is the v2.4.0 release branch** (cut 2026-08-31 off
  `main` = `e7fbb34`; merged `feature/v2.4.0-data-capture` `--no-ff`).
  Ship sequence executed 2026-08-31: migration `20260807150000` pushed,
  `ai-tune` redeployed (v26, `sanitizeLocation` verified in deployed code,
  model string unchanged `gpt-4o-mini`), app version bumped to 2.4.0,
  production EAS builds kicked off (new native build REQUIRED: the
  expo-location config plugin is new in this release). `main`
  fast-forwards to this branch at release per convention.
- **bike_models coverage (2026-07-28, spec-expansion sprint):** 116
  generation rows (was 24): Stage 1 WP platform (KTM/Husqvarna/GasGas, all
  verified), Stage 2 Japanese/Beta/Sherco/Stark (mixed verified/provisional).
  `bikes.model_id` matched 67.2% (was 29.7%). Remaining unmatched top: bikes
  OLDER than covered generation windows (pre-2018 CRF250R, pre-2017 300 EXC,
  pre-2019 KX450), minis (85/65/50 classes, out of scope), Husqvarna FX
  350/450, Stark Varg EX, Beta RR 4T line, and KTM's 2023+ 300 SX (real
  model, no spec row; '300 sx' strings deliberately NOT aliased to another
  model). Those need spec rows, not aliases.
- `release/v2.1.0`: build 34, was in App Review as of 2026-07-14 — contains
  NONE of the merged work above.
- `ai-tune` edge function: redeployed 2026-07-27 (anon_id stamping,
  v2.3.0) and verified live end-to-end: anon request → row with anon_id;
  authenticated request → user_id-only with a supplied anon_id IGNORED;
  anon 10/hr IP limit returns 429 at call 11 with no row recorded.
  (Previous deploy: post-`57e7edc`, 2026-07-18.) NOTE: the 2026-07-27
  verification left 10 anon test rows (anon_id `d0d0feed-…-0001`, one IP)
  and test account `dialedoffroadapp+ws-assembly-test@gmail.com` in prod —
  exclude that day's cluster from anon-row analytics, delete at will.
- **`feat/social-auth` (v2.3.0 Workstream A, 2026-07-24, off `release/v2.2.0`):**
  native Apple + Google sign-in via `signInWithIdToken` (no web OAuth, no new
  deep links; auth-callback machinery untouched). Email signup's success
  sequence extracted verbatim into `lib/authSuccess.ts:completeAuthSuccess`
  (equivalence-pinned by `__tests__/authSuccess.test.ts`); OAuth new-vs-returning
  uses `created_at ≈ last_sign_in_at` (email keeps its `identities[]` check).
  Apple first-auth name → `display_name` for NEW accounts only. Login screen
  has the same provider buttons (no hint line, `mode: "login"` heal-only
  profile writes). Migration
  `20260724090000_usage_events_oauth_event_types.sql` is part of the
  three-migration v2.3.0 batched push. **Dashboard prerequisites DONE
  2026-07-24:** Sign in with Apple capability on `com.dialedoffroad.app`;
  Supabase Apple provider enabled (client ID `com.dialedoffroad.app`,
  empty secret — native id-token flow needs no JWT secret); Google Cloud
  iOS/Web/Android OAuth clients created (project `611855927324`); Supabase
  Google provider configured (iOS + Web client IDs comma-separated, Web
  client secret). Still needed: River flips the Google consent screen
  Testing → Production before store submission. **Google nonce (RESOLVED
  2026-07-28):** GoogleSignIn's iOS SDK embeds an unknowable nonce claim and
  GoTrue accepts only sha256(passed)==claim, so `skip_nonce_check` is now
  ENABLED on the Supabase Google provider (option A; per-provider — Apple's
  nonce flow untouched) and Google sign-in is verified working on device.
  v2.3.x follow-up: migrate to the wrapper's Universal Sign-In with real
  nonce support, then disable the toggle.
- Results/input value pass (2026-07-19, sprint items 1+2): spring-check card
  (ok/marginal/out_of_range, above the Fork card, NEVER blurred), sag
  provenance caption + range bar (`spec_verified` only), "Fork · {type}" /
  "Shock · {type}" headers, temp chips replacing the drag slider (same single
  `temp_f` wire number), and the locked-screen value stack —
  `LOCKED_VARIANT` in `app/tune-results.tsx` is now `"value_stack_v1"`
  (was `fork_comp_reveal_v1`). `meta.spec` carries display-only
  `fork_type`/`shock_type`; the persisted `recommended_settings.context`
  shape is unchanged.
- **v2.2.0 is LIVE** (iOS 2026-07-22, Android 2026-07-24) — but fleet adoption
  lags: prod events still look v2.1.0-shaped (zero `notif_prompt` outcomes,
  ~zero reminder arrivals). Gate check-in analysis on `checkin_source` presence
  (v2.3.0+ clients) or by date once adoption is confirmed in the store consoles.
- **`feat/checkin-instrumentation` (v2.3.0 Workstream B, 2026-07-24, off
  `release/v2.2.0`):** checkin_source attribution (see counting rule above),
  check-in card moved above the presets rail on Home (first content block),
  and the OutcomeCheckinCard render-path test suite. Audit verdict behind it:
  surfacing logic is sound (4/4 returning-eligible users got the card); the
  gaps were split-event undercounting, below-fold placement (11 impressions,
  0 answers), and the dead notification arm. Meta-only — no migration.
  Based on `release/v2.2.0`'s tip = `main`'s tip since the 2026-07-24
  fast-forward, so it merges onto `main` clean (verified; so does
  `feat/social-auth`, and the two merge clean with each other).
- **`feat/tune-attribution` (v2.3.0 Workstream C, 2026-07-24, off `main`):**
  pre-auth onboarding tune attribution. Client mints one random `anon_id`
  uuid (`lib/tuneAttribution.ts`, AsyncStorage); signed-out `generateTune`
  sends it top-level in the wire payload; the `ai-tune` edge stamps it on
  anon `tune_calls` rows only. `claim_anon_tune_calls(p_anon_id)` RPC
  (migration `20260724110000` — STAGED, NOT PUSHED; see batched-push rule)
  attributes rows server-side: exact anon_id + `user_id IS NULL` one-shot
  guard + 48h window; table stays deny-all. **Claim consolidated at v2.3.0
  assembly (`098e9dd`):** fires inside `completeAuthSuccess` immediately
  before the flush-triggering sign_up/sign_in event (covers email signup +
  Apple/Google on both screens), PLUS two documented inline sites on paths
  that bypass that function — `login.tsx` email sign-in (own IndexGate-mirror
  routing) and `signup.tsx`'s already-registered recovery branch (the gap C
  flagged, now closed). Every auth path claims exactly once (verified:
  disjoint handlers); rotation-on-success unchanged. **v2.3.x follow-up:**
  reroute those two inline flows through `completeAuthSuccess`, then delete
  the direct calls. Historical row-level backfill ruled out;
  use the aggregate correction factor (see counting rule). Ride-along:
  `meta.app_version` on all events. Edge NOT redeployed (assembly-time, after
  the migration). Known pre-existing red: engine_test #10's authenticated leg
  fails offline on `main` too (`enforceBaselineCredit`'s service client isn't
  dep-injected) — not introduced by this branch.
- **`feat/loop-surfacing` (v2.3.0 Workstream D, 2026-07-24, off `main`):**
  Ride & Refine loop surfaced pre-paywall. `components/LoopPreview.tsx` —
  faux 3-entry timeline (PREVIEW-tagged, faded rail, hardcoded entries in
  `DEFAULT_LOOP_PREVIEW_ENTRIES`, the single copy source for all surfaces) —
  renders on locked tune-results between the why-teaser and the unlock CTA,
  never blurred. `components/RideItHook.tsx` — post-reveal line + quiet
  button under the Shock card (unlocked, non-TuneTwo) — arms the ride
  check-in via the save flow's idempotent version-ensure +
  `scheduleRideReminder`; NO permission prompt (ask stays at
  feedback-submit). Events `loop_preview_shown` (queued pre-auth, once per
  mount) and `hook_ride_armed` are in the union but analytics-dark until the
  assembly CHECK migration (see checklist + landmine). Adopted WS-B's
  component-test infra verbatim (react-test-renderer, .test.tsx testMatch,
  extended react-native stub) so the merge is byte-identical. **Slide 2
  shipped (fork 1/3 approved 2026-07-24):** headline "Three steps. / Then it
  learns every ride."; the static clicker card (and its ClickerRow + 3
  icons + styles) replaced by `<LoopPreview />` with a fixed dark palette
  (the overlay ignores app theme) and `marginHorizontal: 0` (slide root
  already pads 28). State machine untouched. **Copy decisions in force:**
  entries live ONLY in `DEFAULT_LOOP_PREVIEW_ENTRIES`; no em dashes in
  loop-preview copy; v3 reads in **bar, not psi** (user preferred psi but
  every in-product air display is bar; consistency rule won) — if the app
  ever switches air display to psi, update v3 in the same commit.
- **`release/v2.3.0` is the v2.3.0 integration branch** (cut 2026-07-27 off
  `main` = `b3df976`). Merged `--no-ff` in order: `feat/social-auth`,
  `feat/tune-attribution` (one signup.tsx conflict — A's
  `completeAuthSuccess` owns the sign_up/sign_in events, so C's inline
  logEvent was dropped, claim kept), `feat/checkin-instrumentation`,
  `feat/loop-surfacing` (usage.ts union tail + CLAUDE.md, keep-both). Then
  the WS-C claim consolidation (`098e9dd`, see C entry) and D's CHECK
  migration `20260727100000` (assembly-authored). Branch suites at
  assembly: jest 14 suites / 116 tests green, tsc 19 = baseline, Deno 14
  passed + the known pre-existing #10. `main` fast-forwards to this branch
  at release per convention.
- **Ride-arm card promotion (2026-07-28, approved design):** the Setup
  screen's inline post-reveal hook is now a full card ("THE NEXT STEP",
  accent border, primary CTA), and Home gained a "YOUR TUNE IS LIVE" arming
  card below the check-in slot with strict mutual exclusion (a rendering
  outcome/first-ride card suppresses it; nothing renders until the check-in
  decision). Lifecycle per newest version in `lib/rideArmCard.ts`: armed
  (either surface) and feedback-submitted hide permanently, "Not now"
  snoozes 24h, 14-day window, new version resets. `hook_ride_armed` meta
  now carries `source: setup_card|home_card` + `variant: card_v1` +
  `notif: scheduled|in_app_only`; Home impressions ride heard_card_shown
  meta (`surface: "home_arm_card"`). **Permission-on-arm (2026-07-28,
  supersedes the hook's original no-prompt rule):** arming from either card
  runs `armRideCheckinWithPermission` — undetermined → system prompt;
  grant → schedule; deny → honest in-app-only armed state, never
  re-prompts, no Settings nag. The feedback-submit inline rationale stays
  the unchanged fallback (a card-arm denial stamps its 30-day decline).
  `RideItHook` deleted (replaced). OutcomeCheckinCard's `onEligibility`
  callback is consumed for the first time (shipped in WS-B untested — the
  slot-gate matrix is tested, the callback itself still isn't).
- **v2.3.x login/signup alignment pass (queued 2026-07-28, drift report
  accepted):** bring `app/login.tsx` up to the signup redesign — (1)
  headline to the display style (900 uppercase, tight leading, accent
  period: "WELCOME BACK."), (2) subtitle tone from marketing line to
  task-focused copy, (3) decide whether login's always-expanded email form
  should adopt signup's collapsed "Continue with email" row. The passive
  provider-path terms line was NOT deferred — it shipped 2026-07-28 on both
  screens (legal coverage: login's auto-link can mint accounts).
- **Unverified:** E2E of `settings_delta` on real rows; on-device 36h
  notification path, warm-resume check-in surfacing, the feedback-submit
  permission alert, and the guest-recovery 30h nudge (need a dev-client
  build); on-device visual pass of the new results cards, locked value
  stack, and temp chips (existing dev client is fine — pure JS) — plus the
  relocated Home check-in card position; on-device E2E of the pre-auth
  tune → signup → claim flow against a pushed migration (unit/handler
  suites cover each hop, not the live RPC); on-device visual pass of the
  locked-screen LoopPreview (~200pt budget) and the post-reveal hook, plus
  the hook's reminder arming end-to-end.

- **`hotfix/v2.4.1-air-display` (cut 2026-09-04 off `main` = `6dab399`; worktree
  `../dialed-offroad-hotfix`):** ONE commit, the fork-air display fix only
  (`lib/airDisplay.ts:displayAirBar` replaces the local `deriveAirBar` in
  `app/tune-results.tsx` + `app/tune-two-results.tsx`, test
  `__tests__/airDisplay.test.ts`), then `35e12be` (one-time
  `components/AirDisplayNotice.tsx` on both results screens, air-fork tunes
  only, latch `air_display_notice_v241_seen`), `58c00e1` (STAGED migration
  `20260905100000_ride_feedback_suspect_flags.sql`: `ride_feedback.suspect_flags
  text[]` + GIN index + `air_display_v241` backfill; mirrored on
  `feat/v3-integration`; applied to dev-3-0, 39/138 flagged; prod push only on
  explicit go-ahead), `786671e` (version 2.4.1). Nothing else merges into it.
  Release artifacts in `~/Downloads/dialed-2.4.1-*` (expedited review text,
  release notes, air-notice email + recipients CSV, 102 rows / 95 emails). Prod impact (read-only,
  2026-09-04): since output capture began 2026-08-07, 192 of 768 tune calls
  were air-fork (25%); of the 184 with a weight, display-vs-saved gap p50
  0.51 bar, p90 1.38, max 2.70, 83% off by ≥0.1 bar. The same fix is
  applied on `feat/v3-integration` inline (no shared helper there yet;
  reconcile to `lib/airDisplay.ts` when the hotfix merges back to main).

- **`feat/quiz-onboarding` (3.0 first-run, cut 2026-09-02 off `release/v2.4.0`
  = `6dab399`; `main` still at `e7fbb34`, NOT yet fast-forwarded to v2.4.0 —
  same situation as `feat/ride-day-current-setup`, whose slice-1 WIP was
  parked as `5b93605` on its own branch):** the quiz is a RESKIN of the
  onboarding state machine, not a rewrite — Q1 (discipline) + Q2 (bike) run
  under `garage_locked`, the year tap runs the garage sheet's exact
  transition (`setGuestBikeId` → `setStep("tune")` + `onboarding_bike_added`
  with `source_route: "/quiz/bike"`), Q3–Q5 run under `tune`, and the build
  step will write the same pending tune + `results_locked` as `tune.tsx`.
  Behind `EXPO_PUBLIC_QUIZ_ONBOARDING` (default OFF; the flag only changes
  the intro's finish route and the `garage_locked`/`tune` cold-start
  targets in `app/index.tsx` → `/quiz`). Every answer maps onto an EXISTING
  engine input: discipline → `rider.style`, 4 skill cards → 3 `rider.skill`
  levels (Fast shares intermediate) + derived `rider.goals`, terrain label
  → `terrain`, weight → `weight_lbs`, free text → `issues`; no ai-tune
  change. Slice 1 (Q1–Q3) built 2026-09-02, Q4 is a placeholder screen.
  **Migration `20260902100000` (quiz event types) is STAGED, NOT PUSHED** —
  all `quiz_*` events queue pre-auth, so it is queue-poison until applied
  (see Landmines). No `profiles.discipline` column exists yet: the answer
  lives in the local quiz store until a migration + column grant lands.
  **Sep 2 flip decision (River): reveal-first + action-gated paywall.**
  Slices 2 (Q4 terrain tiles, Q5 weight dial + free text + RiskGate) and 3
  (drumroll `building`, account `gate`, `reveal` with the meter card) are
  built. The paywall position is remote-switchable (see repo map);
  `completeAuthSuccess` completes onboarding at signup when action-gated
  (test-pinned), `/premium` reads `trigger` + honors `returnTo: "back"`,
  every Pro gate names its trigger, Tune Two submit is now Pro-gated
  (`app/tune-feedback.tsx`, the refine choke point), and the cold-start
  TrialPromptModal waits for a first gate-presented paywall when
  action-gated. Interstitial-only surfaces (Home decliner banner,
  `decliner_*`, Tune-tab trial lock, Sessions lock) stay for the switch-back.
- **`feat/home-garage-v3` (3.0 Home + Garage, cut 2026-09-04 off
  `release/v2.4.0` = `6dab399`; `main` still at `e7fbb34`):** the quiz branch
  was parked as `4c26af8` on `feat/quiz-onboarding` first. Spec =
  `design/mockups/PROMPT.md` (transcribed to plan section 17). Home and
  Garage tabs switch on `HOME_GARAGE_V3_ENABLED` at the top of
  `app/(tabs)/index.tsx` / `garage.tsx` (legacy screens renamed, untouched).
  All five slices built 2026-09-04, none device-verified. Two migrations
  STAGED, NOT PUSHED: `20260904100000` (bikes hours/tires/springs/photo/
  interval, `bike_models.click_range_verified` + `shock_hsc_turns_max`,
  `profiles.next_ride_date` + column grant, `season_goals`, `bike_setups` +
  `setup_versions.setup_id` + per-setup numbering trigger, `bike-photos`
  bucket) and `20260904110000` (6 event types). Every v3-only read is
  fail-open in its own query with a device cache, so the screens run before
  the push. `lib/featureFlags.ts` and `package.json` are add/add conflicts
  with the quiz branch at merge (identical quiz flag; union the rest).

- **`feat/v3-integration` is THE 3.0 integration branch (cut 2026-09-04 off
  `main` = `6dab399`, right after `main` fast-forwarded to `release/v2.4.0`
  and was pushed).** Merged `--no-ff` in dependency order:
  `feat/ride-day-current-setup` (`724b808`), `feat/quiz-onboarding`
  (clean), `feat/home-garage-v3` (`cd64db3`; conflicts resolved keep-both in
  `.env.example`, both tab files' imports, `lib/usage.ts` union, CLAUDE.md,
  `package.json`; `lib/featureFlags.ts` took the home-garage superset;
  lockfile regenerated). Then the consolidation commit: events CHECK
  superset (above), v3 Garage/Home gates routed through `paywallHref`
  triggers (`setup_history` / `second_setup` / `second_bike`), flag-default
  test. Staged 3.0 migrations, in order, NONE pushed: `20260902100000`,
  `20260902110000`, `20260904100000`, `20260904110000`. From here all 3.0
  work happens on this branch (or short-lived branches off it); `main` moves
  only for v2.4.x hotfixes. The three feature branches were deleted locally
  after the push (their history lives in the merge commits).

- **`feat/ride-day-flow` (Ride day, cut 2026-09-04 off `feat/v3-integration`
  = `f765eb1`):** spec = `design/mockups/ride/PROMPT.md` (plan section 18).
  All four slices built 2026-09-04, none device-verified, UNCOMMITTED at
  session end. Home's Start Riding now routes to `/ride/start`; an open
  session (AsyncStorage `ride_day_open_v1`) takes Home over into
  `/ride/mode`; the Sessions tab leaves the bar behind the v3 flag. Two more
  STAGED migrations: `20260904120000` (tracks + `match_tracks`, ride_days,
  track_sessions, `setup_versions.ride_day_id`, `bikes.hours_updated_at`)
  and `20260904130000` (events CHECK, now the full 94). No notification of
  any kind is tied to ride days; the only prompt is the in-app "Still
  riding?" after 12 h idle. Native lock-screen presence (Live Activity /
  foreground service) and voice are adapter stubs pending a native build.

- **Audit follow-through decisions (River, 2026-09-04; audit at
  `docs/audit-v3-2026-09-04.md`):** (1) widen the Tune Two contract to accept
  conditions, in the same PR as the symptom-taxonomy change set; client rules
  stay the offline fallback; (2) map the six dropped qualifier labels onto the
  engine's four `where` tags client-side now; (3) ride days count on Home
  (archived history folded into the meter and season stats) AND End ride
  writes one `ride_feedback` row per moto; (4) the ride-day outbox grows job
  kinds for garage writes (extras, rename, running switch); (5) draft tire
  defaults stay but Start never persists them, only rider-saved values;
  (6) AER 48 rebound is at the bottom of the right leg (adjuster copy still
  under review); (7) the passive terms line covers email sign-up; (8) no
  launch trial for any account that ever paid, winback is email; (9) one
  `downgraded` leg (the 3-day cron), separate clock-ended `trial_ending`
  copy, lower bounds on both cron legs; (10) intro-trial removal is on the
  RC dashboard checklist, prices 7.99 / 59.99, `analytics.paid_accounts`
  excludes `period_type = 'TRIAL'`; (11) bike photos private with signed
  URLs and purged on account deletion, `rc_events.raw` stripped of subscriber
  attributes, `tracks` select column-scoped; (12) R8 + resource shrinking
  on for Android release builds, portrait stays for 3.0; (13) push order
  rule above; (14) PROMPT.md follows the code on Home's newest-plus-N,
  the Pro-gated tires tile and the list-first Garage; (15) `paywall_position`
  stays action-gated, `premium.tsx` honors `returnTo` anyway.

## Sprint focus (in order)

1. Results page
2. Input quick wins
3. Input rebuild + schema
4. Garage
