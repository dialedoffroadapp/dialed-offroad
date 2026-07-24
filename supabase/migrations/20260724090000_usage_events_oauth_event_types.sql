-- Add 'oauth_started' / 'oauth_failed' to the usage_events event_type
-- whitelist. Ships with the v2.3.0 Apple/Google sign-in client work
-- (lib/socialAuth.ts logs them; they are analytics-dark until this applies).
--
-- ⚠️ STAGED, NOT PUSHED — batch with Workstream C's migration push. Until it
-- is applied, lib/socialAuth.ts must keep logging these WITHOUT
-- queueIfAnonymous: a queued unknown type fails the entire pre-auth flush
-- batch insert in lib/usage.ts and drops the onboarding funnel events with it.
--
-- Same drop + re-add pattern as 20260715120000. The 50 pre-existing values
-- are the LIVE constraint pulled verbatim on 2026-07-24 (pg_get_constraintdef)
-- — no out-of-band drift. Keep this list in sync with the UsageEvent union in
-- lib/usage.ts.

alter table public.usage_events
  drop constraint usage_events_event_type_check;

alter table public.usage_events
  add constraint usage_events_event_type_check
  check (event_type = any (array[
    'ai_tune_generated',
    'session_saved',
    'session_deleted',
    'bike_created',
    'bike_updated',
    'ai_tune_generated_zero',
    'version_created',
    'feedback_submitted',
    'outcome_recorded',
    'chip_toggled',
    'where_selected',
    'protect_toggled',
    'conditions_selected',
    'heard_card_shown',
    'checkin_shown',
    'checkin_answered',
    'checkin_dismissed',
    'preride_shown',
    'preride_history_tapped',
    'preride_copied',
    'history_opened',
    'history_version_expanded',
    'restore_started',
    'restore_confirmed',
    'history_gate_hit',
    'setup_shared',
    'preset_applied',
    'sign_in',
    'sign_up',
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
    'decliner_home_landed',
    'decliner_banner_tapped',
    'decliner_converted',
    'trial_countdown_shown',
    'trial_countdown_cta_tapped',
    'trial_value_card_shown',
    'trial_value_card_dismissed',
    'winback_screen_shown',
    'winback_cta_tapped',
    'bike_search_no_result',
    -- new: native Apple/Google sign-in funnel signals (v2.3.0)
    'oauth_started',
    'oauth_failed'
  ]::text[]));
