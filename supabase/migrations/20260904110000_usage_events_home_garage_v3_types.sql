-- Add the Home + Garage v3 event types to the usage_events event_type CHECK
-- constraint. CONSOLIDATED on feat/v3-integration (2026-09-04): this re-add
-- is the SUPERSET of 20260902100000 (quiz onboarding: 8 quiz types + 3
-- paywall types) plus the six Home/Garage types, so the staged 3.0 migration
-- set applies in order without ever narrowing the constraint:
--   20260902100000  live 54 + quiz 8 + paywall 3          = 65
--   20260902110000  app_config (paywall_position)          (different table)
--   20260904100000  Home/Garage schema                     (different tables)
--   20260904110000  this file: 65 + home/garage 6          = 71
--
-- STAGED, NOT PUSHED. List provenance: the LIVE prod constraint via
-- pg_get_constraintdef on 2026-09-04 (54 types), then the two branches'
-- additions in commit order. Push only from feat/v3-integration (superset of
-- prod through 20260807150000).
--
-- Event semantics (Home/Garage; the quiz/paywall ones are documented in
-- 20260902100000):
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
    'quiz_step_viewed',
    'quiz_step_answered',
    'quiz_abandoned',
    'quiz_gate_viewed',
    'quiz_signin_method_chosen',
    'quiz_reveal_viewed',
    'quiz_freetext_expanded',
    'quiz_freetext_filled',
    'paywall_shown',
    'paywall_dismissed',
    'paywall_purchased',
    'home_module_viewed',
    'goal_set',
    'next_ride_set',
    'sheet_row_expanded',
    'story_opened',
    'run_setup_switched'
  ));
