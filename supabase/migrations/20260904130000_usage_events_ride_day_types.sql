-- Add the ride-day event types to the usage_events event_type CHECK
-- constraint (design/mockups/ride/PROMPT.md DATA). STAGED, NOT PUSHED.
--
-- Carries the FULL list: live 54 + quiz 8 + paywall 3 + Home/Garage 6 (the
-- 20260904110000 set, 71) + 12 ride-day + 2 Pro-gate = 85. The staged 3.0 re-adds apply in
-- order and only ever widen: 20260902100000 (65) → 20260904110000 (71) →
-- this file (85: +12 ride day, +2 Pro gate). Never add another re-add
-- without carrying all 85.
--
-- Event semantics (meta in lib/rideDay.ts and the ride screens):
--   ride_day_started     {bike_id, setup_id, track_id, suggestion_shown, suggestion_applied, entry}
--   moto_logged          {moto, sentiment, symptom_ids, qualifiers, has_note}
--   adjust_shown         {moto, changes, symptom_id, qualifier}
--   adjust_confirmed     {circuit, from, to (absolute), engine_delta, custom}
--   retune_applied       {reason, changes}
--   ride_day_ended       {elapsed_min, hours_edited, settled_delta_count, motos}
--   baseline_saved       {track_id, setup_id, created}
--   session_resumed      {idle_min}
--   session_autoclosed   {idle_min, edited_end}
--   track_created        {track_id, pinned, server}
--   track_match_confirmed{track_id, source}
--   sync_queue_flushed   {jobs, remaining}
--   pro_gate_shown       {paywall_trigger_action, has_alternative, bike_id}
--   pro_gate_alternative {paywall_trigger_action}  "Update my baseline instead" taken

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
    'run_setup_switched',
    'ride_day_started',
    'moto_logged',
    'adjust_shown',
    'adjust_confirmed',
    'retune_applied',
    'ride_day_ended',
    'baseline_saved',
    'session_resumed',
    'session_autoclosed',
    'track_created',
    'track_match_confirmed',
    'sync_queue_flushed',
    'pro_gate_shown',
    'pro_gate_alternative'
  ));
