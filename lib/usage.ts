// lib/usage.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
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
  // WS-D loop surfacing. NOT whitelisted in prod yet: the CHECK migration is
  // authored at v2.3.0 release assembly (after WS-A's 20260724090000 merges —
  // see CLAUDE.md). loop_preview_shown queues pre-auth, so no store build may
  // ship these events before that migration lands (queue-poison hazard).
  | "loop_preview_shown"
  | "hook_ride_armed";

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
    const cleaned = meta ? (pruneMeta(meta) as any) : {};
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
