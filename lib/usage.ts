// lib/usage.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { getPaywallPosition } from "./paywallPosition";
import { supabase } from "./supabase";

const FUNNEL_ID_KEY = "dialed_onboarding_funnel_id_v1";
const USAGE_QUEUE_KEY = "dialed_usage_event_queue_v1";
const MAX_QUEUED_EVENTS = 25;

export type UsageEvent =
  | "ai_tune_generated"
  | "ai_tune_generated_zero"
  | "version_created"
  | "feedback_submitted"
  | "outcome_recorded"
  | "chip_toggled"
  | "where_selected"
  | "protect_toggled"
  | "conditions_selected"
  | "heard_card_shown"
  | "checkin_shown"
  | "checkin_answered"
  | "checkin_dismissed"
  | "history_opened"
  | "history_version_expanded"
  | "restore_started"
  | "restore_confirmed"
  | "history_gate_hit"
  | "setup_shared"
  | "preride_shown"
  | "preride_history_tapped"
  | "preride_copied"
  | "session_saved"
  | "session_deleted"
  | "bike_created"
  | "bike_updated"
  | "bike_search_no_result"
  | "preset_applied"
  | "sign_in"
  | "sign_up"
  | "onboarding_intro_completed"
  | "onboarding_bike_added"
  | "onboarding_tune_generated"
  | "onboarding_locked_results_viewed"
  | "onboarding_unlock_clicked"
  | "onboarding_signup_started"
  | "onboarding_signup_completed"
  | "onboarding_paywall_shown"
  | "onboarding_paywall_dismissed"
  | "onboarding_trial_started"
  | "onboarding_completed"
  | "decliner_home_landed"
  | "decliner_banner_tapped"
  | "decliner_converted"
  | "trial_countdown_shown"
  | "trial_countdown_cta_tapped"
  | "trial_value_card_shown"
  | "trial_value_card_dismissed"
  | "winback_screen_shown"
  | "winback_cta_tapped"
  // ⚠️ ANALYTICS-DARK until 20260724090000_usage_events_oauth_event_types.sql
  // is pushed: the live CHECK constraint rejects these inserts. Never log them
  // with queueIfAnonymous before that migration applies — one queued unknown
  // type fails the whole pre-auth flush batch and drops the funnel events.
  | "oauth_started"
  | "oauth_failed"
  // WS-D loop surfacing. Same analytics-dark rule: whitelisted by the
  // assembly CHECK migration (after 20260724090000). loop_preview_shown
  // queues pre-auth, so no store build may ship before that migration
  // lands (queue-poison hazard).
  | "loop_preview_shown"
  | "hook_ride_armed"
  // Quiz onboarding (3.0 first-run, feat/quiz-onboarding). Same rule:
  // ANALYTICS-DARK until 20260902100000_usage_events_quiz_event_types.sql
  // is pushed, and ALL of these queue pre-auth (guest riders), so no store
  // build with EXPO_PUBLIC_QUIZ_ONBOARDING=1 may ship before it lands.
  | "quiz_step_viewed"
  | "quiz_step_answered"
  | "quiz_abandoned"
  | "quiz_gate_viewed"
  | "quiz_signin_method_chosen"
  | "quiz_reveal_viewed"
  | "quiz_freetext_expanded"
  | "quiz_freetext_filled"
  // Paywall presentation events for EVERY position/trigger (the onboarding_*
  // ones above stay funnel-only, exactly as shipped). Same migration, same
  // analytics-dark rule. Meta: paywall_position (stamped), paywall_trigger_action.
  | "paywall_shown"
  | "paywall_dismissed"
  | "paywall_purchased"
  // Home + Garage v3 (feat/home-garage-v3). ANALYTICS-DARK until
  // 20260904110000_usage_events_home_garage_v3_types.sql is pushed; logged
  // signed-in only, so no pre-auth queue-poison hazard — rows just drop.
  | "home_module_viewed"
  | "goal_set"
  | "next_ride_set"
  | "sheet_row_expanded"
  | "story_opened"
  | "run_setup_switched"
  // Ride day (feat/ride-day-flow). ANALYTICS-DARK until
  // 20260904130000_usage_events_ride_day_types.sql is pushed; signed-in only.
  | "ride_day_started"
  | "moto_logged"
  | "adjust_shown"
  | "adjust_confirmed"
  | "retune_applied"
  | "ride_day_ended"
  | "baseline_saved"
  | "session_resumed"
  | "session_autoclosed"
  | "track_created"
  | "track_match_confirmed"
  | "sync_queue_flushed"
  // Pro gate sheet (free-tune reconciliation): shown before the paywall,
  // names the Pro action, offers the free alternative. Same staged CHECK.
  | "pro_gate_shown"
  | "pro_gate_alternative"
  // Conversion model (reverse trial + action gates + pricing page).
  | "trial_started"
  | "trial_ended"
  | "downgraded"
  | "gate_shown"
  | "gate_dismissed"
  | "gate_converted"
  | "pricing_page_viewed"
  | "lifetime_offered"
  | "qualified_trial";

// ⚠️ usage_events.event_type has a DB CHECK constraint whitelisting event
// names. Adding a member here requires extending that constraint (see
// supabase/migrations/20260710160000_usage_events_extend_event_types.sql) or
// the insert is rejected and silently dropped by logEvent's catch.

export type UsageEventType = UsageEvent;

type LogEventOptions = {
  allowAnonymous?: boolean;
  queueIfAnonymous?: boolean;
};

type QueuedUsageEvent = {
  event_type: UsageEventType;
  meta: Record<string, any>;
  queued_at: string;
};

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

function pruneMeta(value: any, depth = 0): Json {
  if (depth > 4) return null; // avoid deep nests

  if (value == null) return null;
  if (typeof value === "string") {
    // cap long strings
    return value.length > 500 ? value.slice(0, 500) + "…" : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    const trimmed = value.slice(0, 10).map((v) => pruneMeta(v, depth + 1));
    return trimmed as Json[];
  }

  if (typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = pruneMeta(v, depth + 1);
    }
    return out;
  }
  return null;
}

function newId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// v2.3.0+ fleet fingerprint: every event's meta carries the version of the
// binary that GENERATED it. Stamped once in logEvent (before queue/insert
// forks), so queued pre-auth events keep their origin version even when a
// later binary flushes them — absence of app_version means a pre-v2.3.0
// generator. Never overrides a caller-provided value.
const APP_VERSION: string | null =
  (Constants as any)?.expoConfig?.version ?? null;

function withAppVersion(meta: Record<string, any>): Record<string, any> {
  if (APP_VERSION && meta.app_version === undefined) {
    return { ...meta, app_version: APP_VERSION };
  }
  return meta;
}

// Paywall-position variant (lib/paywallPosition.ts, 2026-09-02): every
// paywall-related event carries which world it happened in, stamped here so
// no call site can forget it. Callers add paywall_trigger_action themselves
// (they know which Pro action summoned the paywall). Never overrides a
// caller-provided value.
const PAYWALL_EVENTS: ReadonlySet<UsageEventType> = new Set<UsageEventType>([
  "onboarding_paywall_shown",
  "onboarding_paywall_dismissed",
  "onboarding_trial_started",
  "onboarding_completed",
  "onboarding_signup_completed",
  "onboarding_unlock_clicked",
  "sign_up",
  "paywall_shown",
  "paywall_dismissed",
  "paywall_purchased",
  "decliner_home_landed",
  "decliner_banner_tapped",
  "decliner_converted",
  "trial_countdown_shown",
  "trial_countdown_cta_tapped",
  "trial_value_card_shown",
  "trial_value_card_dismissed",
  "winback_screen_shown",
  "winback_cta_tapped",
  "history_gate_hit",
  "quiz_gate_viewed",
  "quiz_signin_method_chosen",
  "quiz_reveal_viewed",
  "pro_gate_shown",
  "pro_gate_alternative",
  "trial_started",
  "trial_ended",
  "downgraded",
  "gate_shown",
  "gate_dismissed",
  "gate_converted",
  "pricing_page_viewed",
  "lifetime_offered",
]);

function withPaywallPosition(
  event_type: UsageEventType,
  meta: Record<string, any>
): Record<string, any> {
  if (PAYWALL_EVENTS.has(event_type) && meta.paywall_position === undefined) {
    return { ...meta, paywall_position: getPaywallPosition() };
  }
  return meta;
}

async function readQueuedUsageEvents(): Promise<QueuedUsageEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(USAGE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueuedUsageEvents(events: QueuedUsageEvent[]): Promise<void> {
  await AsyncStorage.setItem(
    USAGE_QUEUE_KEY,
    JSON.stringify(events.slice(-MAX_QUEUED_EVENTS))
  );
}

async function queueUsageEvent(
  event_type: UsageEventType,
  meta: Record<string, any>
): Promise<void> {
  const queued = await readQueuedUsageEvents();
  queued.push({
    event_type,
    meta,
    queued_at: new Date().toISOString(),
  });
  await writeQueuedUsageEvents(queued);
}

export async function getOrCreateFunnelId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(FUNNEL_ID_KEY);
    if (existing && existing.length > 0) return existing;

    const created = newId("funnel");
    await AsyncStorage.setItem(FUNNEL_ID_KEY, created);
    return created;
  } catch {
    return newId("funnel");
  }
}

export async function clearFunnelId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(FUNNEL_ID_KEY);
  } catch {
    // Ignore cleanup failures for analytics IDs.
  }
}

export async function flushQueuedUsageEvents(userId?: string): Promise<void> {
  try {
    let targetUserId = userId;
    if (!targetUserId) {
      const { data: auth } = await supabase.auth.getUser();
      targetUserId = auth?.user?.id ?? undefined;
    }
    if (!targetUserId) return;

    const queued = await readQueuedUsageEvents();
    if (!queued.length) return;

    const rows = queued.map((evt) => ({
      user_id: targetUserId,
      event_type: evt.event_type,
      meta: evt.meta ?? {},
    }));

    const { error } = await supabase.from("usage_events").insert(rows);
    if (error) {
      console.warn("[usage] queue flush failed:", error.message);
      return;
    }

    await AsyncStorage.removeItem(USAGE_QUEUE_KEY);
  } catch (e) {
    console.warn("[usage] queue flush unexpected error:", e);
  }
}

/**
 * Logs a usage event for the current authenticated user.
 * Can optionally queue anonymous onboarding events until signup/sign-in.
 */
export async function logEvent(
  event_type: UsageEventType,
  meta?: Record<string, any>,
  options?: LogEventOptions
): Promise<void> {
  try {
    const cleaned = withPaywallPosition(
      event_type,
      withAppVersion((meta ? (pruneMeta(meta) as any) : {}) ?? {})
    );
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) {
      if (options?.allowAnonymous && options?.queueIfAnonymous) {
        await queueUsageEvent(event_type, cleaned ?? {});
      }
      return;
    }

    await flushQueuedUsageEvents(auth.user.id);

    const { error } = await supabase.from("usage_events").insert({
      user_id: auth.user.id,
      event_type,
      meta: cleaned ?? {},
    });
    if (error) {
      console.warn("[usage] insert failed:", error.message);
    }
  } catch (e) {
    console.warn("[usage] unexpected error:", e);
  }
}
