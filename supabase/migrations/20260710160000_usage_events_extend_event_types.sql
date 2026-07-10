-- Extend the usage_events event_type whitelist to the full client event union.
--
-- The original CHECK allowed only the 5 launch-era event names
-- (ai_tune_generated, session_saved, session_deleted, bike_created,
-- bike_updated). Every other event the client logs — the entire onboarding
-- funnel instrumentation, feedback/check-in/pre-ride events, version_created,
-- sign_in/sign_up — was rejected by this constraint and silently dropped by
-- lib/usage.ts logEvent's console.warn. Confirmed against production on
-- 2026-07-10: select event_type, count(*) from usage_events group by 1
-- returns ONLY those five types.
--
-- This list must stay in sync with the UsageEvent union in lib/usage.ts —
-- a client-side addition without a migration here is silently dropped.

alter table public.usage_events
  drop constraint usage_events_event_type_check;

alter table public.usage_events
  add constraint usage_events_event_type_check
  check (event_type = any (array[
    -- launch-era events (original whitelist)
    'ai_tune_generated',
    'session_saved',
    'session_deleted',
    'bike_created',
    'bike_updated',
    -- tune generation / lineage
    'ai_tune_generated_zero',
    'version_created',
    'feedback_submitted',
    'outcome_recorded',
    -- feedback-screen interactions
    'chip_toggled',
    'where_selected',
    'protect_toggled',
    'conditions_selected',
    'heard_card_shown',
    -- ride check-in + pre-ride
    'checkin_shown',
    'checkin_answered',
    'checkin_dismissed',
    'preride_shown',
    'preride_history_tapped',
    'preride_copied',
    -- setup history
    'history_opened',
    'history_version_expanded',
    'restore_started',
    'restore_confirmed',
    'history_gate_hit',
    'setup_shared',
    -- presets / auth
    'preset_applied',
    'sign_in',
    'sign_up',
    -- onboarding funnel
    'onboarding_intro_completed',
    'onboarding_bike_added',
    'onboarding_tune_generated',
    'onboarding_locked_results_viewed',
    'onboarding_unlock_clicked',
    'onboarding_signup_started',
    'onboarding_signup_completed',
    'onboarding_paywall_shown',
    'onboarding_paywall_dismissed',
    'onboarding_trial_started',
    'onboarding_completed',
    -- paywall-decliner recovery funnel
    'decliner_home_landed',
    'decliner_banner_tapped',
    'decliner_converted'
  ]::text[]));
