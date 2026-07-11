-- Extend the usage_events whitelist with the trial-experience + winback
-- funnel events (trial-experience-v1: WS1 countdown, WS2 value card,
-- WS4 winback). Same pattern as 20260710160000 — this list must stay in
-- sync with the UsageEvent union in lib/usage.ts.

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
    'decliner_converted',
    -- trial experience (trial-experience-v1)
    'trial_countdown_shown',
    'trial_countdown_cta_tapped',
    'trial_value_card_shown',
    'trial_value_card_dismissed',
    -- winback funnel (trial-experience-v1)
    'winback_screen_shown',
    'winback_cta_tapped'
  ]::text[]));
