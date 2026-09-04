-- Add the quiz-onboarding event types AND the position-agnostic paywall
-- events to the usage_events event_type CHECK constraint
-- (feat/quiz-onboarding, the 3.0 first-run experience).
--
-- STAGED, NOT PUSHED at authoring (2026-09-02). Push only from a branch whose
-- migrations folder is a superset of prod (CLAUDE.md migration-history rule);
-- feat/quiz-onboarding is cut off release/v2.4.0, which carries every applied
-- migration through 20260807150000.
--
-- List provenance: pulled from the LIVE prod constraint via
-- pg_get_constraintdef on 2026-09-02 (54 types, identical to
-- 20260727100000's re-add), plus the eight quiz types — so this drop/re-add
-- only ever widens, never narrows.
--
-- ⚠️ MUST land in prod before any store build ships with
-- EXPO_PUBLIC_QUIZ_ONBOARDING=1: every quiz event queues pre-auth (the rider
-- is a guest until the account gate), and one unwhitelisted queued type
-- rejects the ENTIRE pre-auth flush batch at signup (lib/usage.ts
-- queue-poison rule) — the whole onboarding funnel for that user is lost.
--
-- Event semantics (meta documented in lib/quizOnboarding.ts):
--   quiz_step_viewed           {step, substep?}           one per screen focus
--   quiz_step_answered         {step, answer}             one per committed answer
--   quiz_abandoned             {last_step}                app backgrounded mid-quiz
--   quiz_gate_viewed           {}                         account gate shown
--   quiz_signin_method_chosen  {method: apple|google}     gate button tapped
--   quiz_reveal_viewed         {}                         reveal screen shown
--   quiz_freetext_expanded     {}                         Q5 optional line opened
--   quiz_freetext_filled       {len}                      Q5 optional text submitted
--   paywall_shown              {paywall_position, paywall_trigger_action, onboarding}
--   paywall_dismissed          {…, result: dismissed|error}
--   paywall_purchased          {…, result: purchased|restored|entitled}
-- (paywall_position is stamped on every paywall-related event by
-- lib/usage.ts; the shipped onboarding_paywall_* / onboarding_trial_started
-- events keep firing unchanged in the interstitial funnel so the two worlds
-- compare from day one.)

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
    'paywall_purchased'
  ));
