-- Add 'bike_search_no_result' to the usage_events event_type whitelist.
-- The garage model picker logs it when a rider free-texts a model not in
-- the catalog (constants/bike-catalog.ts) — ships with the bike-entry
-- canonicalization client work (the event + its constraint go together).
--
-- Same drop + re-add pattern as 20260711090000. The 49 pre-existing values
-- are the LIVE constraint pulled verbatim on 2026-07-15 (pg_get_constraintdef)
-- and confirmed identical to 20260711090000 — no out-of-band drift. Keep this
-- list in sync with the UsageEvent union in lib/usage.ts.

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
    -- new: bike-entry coverage signal
    'bike_search_no_result'
  ]::text[]));
