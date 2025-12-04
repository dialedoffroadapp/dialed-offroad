// lib/usage.ts
import { supabase } from "./supabase";

export type UsageEventType =
  | "ai_tune_generated"
  | "session_saved"
  | "session_deleted"
  | "bike_created"
  | "bike_updated";

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

/**
 * Logs a usage event for the current authenticated user.
 * Safe to call and will no-op if the user is not logged in.
 */
export async function logEvent(event_type: UsageEventType, meta?: Record<string, any>): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) {
      // Not logged in → skip logging
      return;
    }
    const cleaned = meta ? (pruneMeta(meta) as any) : {};
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
