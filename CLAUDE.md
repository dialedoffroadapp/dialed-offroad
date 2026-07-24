# CLAUDE.md

Dialed Offroad — an MX (dirt-bike) suspension-tuning app. Riders generate a base
tune, ride, give structured feedback, and get a refined tune; retention loops
bring them back. Stack: **Expo Router + TypeScript + Supabase** (Postgres + Edge
Functions), RevenueCat for IAP. Expo SDK 54, React Native 0.81, New Arch on.

## Run, test, verify

- **Run:** `npx expo start` — this is a **dev-client** app (custom native
  modules); **Expo Go will not run it**. iOS build: `npx expo run:ios`.
- **App tests:** `npx jest` (config `jest.config.js`, ts-jest; native modules
  stubbed in `__tests__/stubs/`).
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
| Symptom picker (post-ride debrief) | `app/tune-feedback.tsx` |
| Tune results | `app/tune-two-results.tsx` (baseline: `app/tune-results.tsx`) |
| Post-ride check-in card | `components/OutcomeCheckinCard.tsx`, `lib/checkinLogic.ts` |
| Local notifications | `lib/rideReminder.ts`, `lib/reminderArrival.ts`, `lib/trialReminder.ts`, `lib/guestRecovery.ts` (30h guest-abandon nudge — armed when a guest backgrounds off locked results, cancelled on any auth session; NEVER prompts for permission; analytics-dark until a `usage_events` CHECK migration adds `guest_recovery_*` types) |
| Paywall / Pro / IAP | `app/premium.tsx`, `lib/purchases.ts`, `hooks/usePro.ts`, `supabase/functions/revenuecat-webhook` (`verify_jwt = false` — it's a public webhook) |
| Onboarding | `lib/onboarding.tsx`, `app/index.tsx`, root `app/_layout.tsx` |
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
total check-in surfacing = the SUM of both. The notification-permission prompt
logs its outcome in `heard_card_shown` meta (`surface: "notif_prompt"`,
`outcome: granted|denied|declined`) — no dedicated event type (new types need
a `usage_events_event_type_check` migration).

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
- **v2.3.0 release-assembly checklist item (Workstream D, DO NOT FORGET):**
  after A, B, C, D merge and the release branch is cut, author a NEW
  `usage_events_event_type_check` migration ON THE RELEASE BRANCH, sequenced
  after WS-A's `20260724090000`, re-adding the constraint with A's full oauth
  list PLUS `loop_preview_shown` and `hook_ride_armed`. It must land in the
  batched push BEFORE any store build ships from the release branch —
  `loop_preview_shown` queues pre-auth, and one unwhitelisted queued type
  rejects the ENTIRE flush batch (the oauth queue-poison failure mode). D
  deliberately ships no migration file on its own branch: the re-added
  constraint list needs A's merged migration to be visible first.
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
- **Edge function deploy (observed workflow, not repo-documented):**
  `supabase functions deploy <name> --use-api` (no Docker). Confirm before use.

## Stable contracts — do not let these drift

- **Symptom taxonomy:** `Tune2SymptomId` (`lib/ai.ts:91`) ↔ engine `SymptomId`
  (`ai-tune/index.ts`) ↔ `SYMPTOM_PHRASES` ↔ the picker's `ISSUE_CHIPS`. Change
  all of them or none.
- **Circuit fields, one vocabulary everywhere:** `ZeroTuneResult`
  (`fork.comp_clicks/reb_clicks/air_pressure_bar`,
  `shock.lsc_clicks/hsc_turns/reb_clicks/sag_mm`) ↔ `setup_versions` columns ↔
  `settings_delta` keys
  (`fork_comp/fork_reb/fork_air/shock_lsc/shock_hsc/shock_reb/shock_sag`).
- **Engine output is frozen by a byte-identical v1 regression test.** Clamps:
  ±4 clicks/step, ±0.5 hsc turns, ±0.3 air bar; severities 1–10. Don't change
  engine math or note wording without updating the tests.
- **`lib/tuneNotes.ts` must track the engine's literal note strings**
  (`ai-tune` `buildTuneTwo`). Reword one side and classification silently
  degrades to "routine."
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
  end-to-end (client override, guardrails, edge `safeShape`/fallback/prompt).
  The `isAERFork` name heuristic and the rider toggle decide only for unmatched
  bikes. Same pattern for sag: per-model bounds/target from `lib/sagBounds.ts`
  ride guardrails; client and edge clamp to the SAME window.

## Landmines

- **Native modules → dev-client required.** expo-notifications,
  react-native-view-shot, expo-sharing. A fresh dev-client / EAS build is needed
  after any config-plugin change; **notifications are inert in binaries built
  before the plugin existed.**
- **`app/feedback.tsx` (a support-email screen) is NOT `app/tune-feedback.tsx`
  (the symptom picker).** Easy to edit the wrong one.
- **`lib/tuneEvents.ts` was deleted** on `feat/bike-entry-canonicalization`
  (confirmed unused). If you see it referenced, that code predates the merge.
- **Guest/legacy bike ids are not UUIDs.** Run ids through `asUuidOrNull`;
  bikeless (`null`) rows are valid.
- **Shadow writes are non-fatal by design.** `setupVersions` helpers throw;
  callers catch and fall back to `lib/feedbackRetry.ts`. Don't let them block the
  tune/refine flow.
- **`loop_preview_shown` / `hook_ride_armed` are unwhitelisted until the
  assembly migration** (see checklist item in Data model). Guest sessions on
  dev/TestFlight builds of `feat/loop-surfacing` will queue
  `loop_preview_shown` pre-auth — if such a build's user signs up BEFORE the
  migration lands in prod, the whole queued funnel batch is rejected at
  flush. Accepted for dev; the store build must ship after the migration.

## How to work here

- **Branch discipline:** default branch is `main`; release work on `release/*`;
  features on `feat/*`. **Don't commit or push unless asked. Ask before pushing
  to the prod DB or acting on a release branch.** Keep commits scoped to one
  logical change.
- **Audit before building.** Much of this app already exists under other names
  (e.g. `setup_versions`/`ride_feedback` already cover "sessions/refinements").
  Search first; extend rather than rebuild.
- **Decisions in force:** `applied_settings == recommended_settings` until an
  override UI ships (schema is ready for the split); `settings_delta` is
  server-computed.

## Current state — update this section when structure changes
*(As of 2026-07-18. Standing rule: any commit that changes branch structure,
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
  schema + backfill, security hardening).
- `release/v2.1.0`: build 34, was in App Review as of 2026-07-14 — contains
  NONE of the merged work above.
- `ai-tune` edge function: deployed and verified live post-`57e7edc`
  (sag-target fallback + spec-authoritative fork type) as of 2026-07-18.
- Results/input value pass (2026-07-19, sprint items 1+2): spring-check card
  (ok/marginal/out_of_range, above the Fork card, NEVER blurred), sag
  provenance caption + range bar (`spec_verified` only), "Fork · {type}" /
  "Shock · {type}" headers, temp chips replacing the drag slider (same single
  `temp_f` wire number), and the locked-screen value stack —
  `LOCKED_VARIANT` in `app/tune-results.tsx` is now `"value_stack_v1"`
  (was `fork_comp_reveal_v1`). `meta.spec` carries display-only
  `fork_type`/`shock_type`; the persisted `recommended_settings.context`
  shape is unchanged.
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
  extended react-native stub) so the merge is byte-identical. **Onboarding
  Slide 2 update is HELD un-edited pending copy approval** (fork 1/3):
  planned change swaps the static clicker card for `<LoopPreview />` +
  headline revision; the onboarding state machine is untouched either way.
- **Unverified:** E2E of `settings_delta` on real rows; on-device 36h
  notification path, warm-resume check-in surfacing, the feedback-submit
  permission alert, and the guest-recovery 30h nudge (need a dev-client
  build); on-device visual pass of the new results cards, locked value
  stack, and temp chips (existing dev client is fine — pure JS); on-device
  visual pass of the locked-screen LoopPreview (~200pt budget) and the
  post-reveal hook, plus the hook's reminder arming end-to-end.

## Sprint focus (in order)

1. Results page
2. Input quick wins
3. Input rebuild + schema
4. Garage
