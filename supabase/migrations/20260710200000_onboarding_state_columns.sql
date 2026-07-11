-- Add the onboarding-state columns the app has been writing into the void.
--
-- Discovered 2026-07-10: profiles never had onboarding_step /
-- onboarding_complete / theme_key, yet ~10 client call sites upsert them
-- (every write failed silently with PGRST204) and login.tsx / themes.tsx
-- SELECT them (the whole select 400s, so login routing degraded to local
-- state and the themes screen never restored a saved theme or saw Pro).
--
-- Compatibility audit performed before applying (see security-day3 report):
-- - Every reader guards with isOnboardingStep(...) fallback-to-local or
--   strict `=== true`, so both NULL and the false backfill behave exactly
--   like today's undefined.
-- - Writers are forward transitions of the funnel state machine; the login
--   heal only fires when the profile row is missing entirely. One
--   questionable site is flagged for client follow-up (signup.tsx recovery
--   path can write "complete" for a mid-funnel user) — not a blocker.
--
-- These are NOT privileged columns: they mirror the client-owned funnel
-- state machine, so they join the client-writable grant list from
-- 20260710170000. The CHECK keeps client-writable step values inside the
-- app's state-machine union.

alter table public.profiles
  add column if not exists onboarding_step text
    check (
      onboarding_step is null or onboarding_step in (
        'intro', 'garage_locked', 'tune', 'results_locked',
        'signup', 'trial', 'complete'
      )
    ),
  add column if not exists onboarding_complete boolean not null default false,
  add column if not exists theme_key text;

-- Column-level grants are additive — extend the 20260710170000 lists.
grant update (onboarding_step, onboarding_complete, theme_key)
  on public.profiles to authenticated;
grant insert (onboarding_step, onboarding_complete, theme_key)
  on public.profiles to authenticated;
