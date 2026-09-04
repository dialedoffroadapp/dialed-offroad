-- Add the Home + Garage v3 event types to the usage_events event_type CHECK
-- constraint (feat/home-garage-v3, design/mockups/PROMPT.md DATA section).
--
-- STAGED, NOT PUSHED. List provenance: the LIVE prod constraint via
-- pg_get_constraintdef on 2026-09-04 (54 types) + these six.
--
-- ⚠️ ASSEMBLY RULE: feat/quiz-onboarding also stages a drop/re-add of this
-- constraint (20260902100000: +8 quiz types, +3 paywall types). Whichever
-- lands SECOND must carry the other's additions or it narrows the
-- constraint back — at release assembly, fold both lists into ONE re-add
-- (the WS-D precedent, 20260727100000) before pushing either. Home/Garage
-- events are logged signed-in only (no pre-auth queue), so unlike the quiz
-- there is no queue-poison hazard — just silently dropped rows until it lands.
--
-- Event semantics:
--   home_module_viewed   {module, state}      once per module per Home focus
--   goal_set             {type, target}       season goal saved
--   next_ride_set        {days_out}           next ride date saved (no notification)
--   sheet_row_expanded   {adjuster, setup_id} setup sheet row opened
--   story_opened         {bike_id, versions}  setup story / history opened
--   run_setup_switched   {bike_id, setup_id}  "Run this setup" on a non-running setup

alter table public.usage_events
  drop constraint usage_events_event_type_check;

alter table public.usage_events
  add constraint usage_events_event_type_check
  check (event_type in (
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
    'oauth_started',
    'oauth_failed',
    'loop_preview_shown',
    'hook_ride_armed',
    'home_module_viewed',
    'goal_set',
    'next_ride_set',
    'sheet_row_expanded',
    'story_opened',
    'run_setup_switched'
  ));
