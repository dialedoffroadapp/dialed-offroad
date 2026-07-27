-- Add 'loop_preview_shown' / 'hook_ride_armed' to the usage_events event_type
-- CHECK constraint (Workstream D, v2.3.0 loop surfacing).
--
-- Authored at release assembly on release/v2.3.0 per the CLAUDE.md checklist
-- item: D deliberately shipped no migration on its feature branch because
-- this re-add must be a strict superset of WS-A's 20260724090000 list, which
-- is only visible once A merges. Sequencing within the v2.3.0 batched push:
--   20260724090000 (A: +oauth_started, +oauth_failed)
--   20260724110000 (C: tune_calls anon claim — different table, no overlap)
--   20260727100000 (this file: A's full list +loop_preview_shown,
--                   +hook_ride_armed)
--
-- List provenance: pulled from the LIVE prod constraint via
-- pg_get_constraintdef on 2026-07-27 (50 types), verified identical to
-- 20260724090000's re-add minus its two oauth additions — so after A applies,
-- this drop/re-add only ever widens, never narrows.
--
-- ⚠️ MUST land in prod before any v2.3.0 store build ships:
-- loop_preview_shown queues pre-auth, and one unwhitelisted queued type
-- rejects the ENTIRE pre-auth flush batch at signup (queue-poison).

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
    'hook_ride_armed'
  ));
