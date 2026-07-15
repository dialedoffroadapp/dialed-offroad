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
| Symptom picker (post-ride debrief) | `app/tune-feedback.tsx` |
| Tune results | `app/tune-two-results.tsx` (baseline: `app/tune-results.tsx`) |
| Post-ride check-in card | `components/OutcomeCheckinCard.tsx`, `lib/checkinLogic.ts` |
| Local notifications | `lib/rideReminder.ts`, `lib/reminderArrival.ts`, `lib/trialReminder.ts` |
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

## Landmines

- **Native modules → dev-client required.** expo-notifications,
  react-native-view-shot, expo-sharing. A fresh dev-client / EAS build is needed
  after any config-plugin change; **notifications are inert in binaries built
  before the plugin existed.**
- **`app/feedback.tsx` (a support-email screen) is NOT `app/tune-feedback.tsx`
  (the symptom picker).** Easy to edit the wrong one.
- **`lib/tuneEvents.ts` appears unused** (no static imports found) — verify
  before relying on or deleting it.
- **Guest/legacy bike ids are not UUIDs.** Run ids through `asUuidOrNull`;
  bikeless (`null`) rows are valid.
- **Shadow writes are non-fatal by design.** `setupVersions` helpers throw;
  callers catch and fall back to `lib/feedbackRetry.ts`. Don't let them block the
  tune/refine flow.

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

## Current state — update this section at the end of every session
*(As of 2026-07-14.)*
- `feat/ride-loop-foundation` (pushed): 4 commits — migration `20260714120000`
  (recommended/applied/`settings_delta`), setup-version snapshot writes,
  36h/Saturday-7pm reminder retarget, outcome-first check-in funnel.
- `release/v2.1.0`: build 34, in App Review — does **not** contain the ride-loop work.
- Migration `20260714120000` **applied to prod** (`supabase db push`, succeeded).
- **Unverified:** E2E of the new columns/`settings_delta` on real rows;
  on-device 36h notification path (needs a dev-client build).
