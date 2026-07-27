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
| Symptom picker (post-ride debrief) | `app/tune-feedback.tsx` |
| Tune results | `app/tune-two-results.tsx` (baseline: `app/tune-results.tsx`) |
| Post-ride check-in card | `components/OutcomeCheckinCard.tsx`, `lib/checkinLogic.ts` |
| Local notifications | `lib/rideReminder.ts`, `lib/reminderArrival.ts`, `lib/trialReminder.ts`, `lib/guestRecovery.ts` (30h guest-abandon nudge — armed when a guest backgrounds off locked results, cancelled on any auth session; NEVER prompts for permission; analytics-dark until a `usage_events` CHECK migration adds `guest_recovery_*` types) |
| Paywall / Pro / IAP | `app/premium.tsx`, `lib/purchases.ts`, `hooks/usePro.ts`, `supabase/functions/revenuecat-webhook` (`verify_jwt = false` — it's a public webhook) |
| Auth (email + native Apple/Google) | `app/signup.tsx`, `app/login.tsx` (both have provider buttons), `lib/authSuccess.ts` (**`completeAuthSuccess` is the ONE post-auth success path** — profile upsert, guest-bike migration, events, onboarding advance; email signup and both screens' OAuth call it, never reimplement it; `mode: "login"` = email login's heal-only profile write for returning users — NEVER downgrades onboarding columns), `lib/socialAuth.ts` (signInWithIdToken flows, module-presence feature gates). Same-email OAuth collisions rely on Supabase auto-linking (default-on, verified email) — no in-app linking code by decision |
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
- **v2.3.0 batched push — HOLD until release assembly.** `20260724090000`
  (oauth event types, Workstream A) and `20260724110000` (tune_calls anon
  claim, Workstream C) push TOGETHER from the release branch cut off `main`
  after A, B, and C have all merged — one branch satisfies the superset rule
  in one shot. Never push either from a feature branch. Order within
  assembly: migration first, THEN the `ai-tune` edge redeploy — the new edge
  inserts `anon_id`, which fails (and silently drops rate-limit rows) if the
  column doesn't exist yet. Old edge + new migration is harmless.
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
  react-native-view-shot, expo-sharing, expo-apple-authentication, expo-crypto,
  @react-native-google-signin. A fresh dev-client / EAS build is needed
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
- **`feat/social-auth` (v2.3.0 Workstream A, 2026-07-24, off `release/v2.2.0`):**
  native Apple + Google sign-in via `signInWithIdToken` (no web OAuth, no new
  deep links; auth-callback machinery untouched). Email signup's success
  sequence extracted verbatim into `lib/authSuccess.ts:completeAuthSuccess`
  (equivalence-pinned by `__tests__/authSuccess.test.ts`); OAuth new-vs-returning
  uses `created_at ≈ last_sign_in_at` (email keeps its `identities[]` check).
  Apple first-auth name → `display_name` for NEW accounts only. Login screen
  has the same provider buttons (no hint line, `mode: "login"` heal-only
  profile writes). Staged
  UNAPPLIED migration `20260724090000_usage_events_oauth_event_types.sql` —
  batch with Workstream C's push. Needs before it works on device: new
  dev-client build, Apple provider config in Supabase dashboard + App ID
  capability, Google client IDs (env + Supabase authorized list).
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
  guard + 48h window; table stays deny-all. Claim fires at auth success in
  `signup.tsx` and `login.tsx` next to the analytics flush, then rotates the
  stored id — TODO markers in both files: fold into `completeAuthSuccess`
  when `feat/social-auth` merges. Historical row-level backfill ruled out;
  use the aggregate correction factor (see counting rule). Ride-along:
  `meta.app_version` on all events. Edge NOT redeployed (assembly-time, after
  the migration). Known pre-existing red: engine_test #10's authenticated leg
  fails offline on `main` too (`enforceBaselineCredit`'s service client isn't
  dep-injected) — not introduced by this branch.
- **Unverified:** E2E of `settings_delta` on real rows; on-device 36h
  notification path, warm-resume check-in surfacing, the feedback-submit
  permission alert, and the guest-recovery 30h nudge (need a dev-client
  build); on-device visual pass of the new results cards, locked value
  stack, and temp chips (existing dev client is fine — pure JS) — plus the
  relocated Home check-in card position; on-device E2E of the pre-auth
  tune → signup → claim flow against a pushed migration (unit/handler
  suites cover each hop, not the live RPC).

## Sprint focus (in order)

1. Results page
2. Input quick wins
3. Input rebuild + schema
4. Garage
