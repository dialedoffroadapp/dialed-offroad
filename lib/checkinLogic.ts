// lib/checkinLogic.ts
// Pure decision logic for the ride check-in card, extracted from
// components/OutcomeCheckinCard.tsx so it can be unit-tested without native
// modules. Extraction only — behavior is identical to the inline versions.

import { SYMPTOM_PHRASES, Tune2SymptomId } from "./ai";
import { SetupVersionRow } from "./setupVersions";

export const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
export const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_DISMISSALS = 2;

export type DismissRecord = { count: number; until: number };

export const FALLBACK_TITLE = "How's the refined setup treating you?";

/** True while a snooze/dismiss record suppresses the card: either the
 *  2-strike limit is spent or a snooze window is still running. */
export function isRecordBlocking(
  rec: DismissRecord | null | undefined,
  nowMs: number
): boolean {
  if (!rec) return false;
  return (rec.count ?? 0) >= MAX_DISMISSALS || (rec.until ?? 0) > nowMs;
}

/** "Haven't ridden yet": pure 3-day snooze. The strike count is PRESERVED,
 *  never incremented — a rider who genuinely hasn't ridden must not lose the
 *  loop-closing prompt. */
export function applySnooze(
  rec: DismissRecord | null | undefined,
  nowMs: number
): DismissRecord {
  return { count: rec?.count ?? 0, until: nowMs + THREE_DAYS_MS };
}

/** Explicit ✕ — the only action that counts toward MAX_DISMISSALS. */
export function applyDismiss(
  rec: DismissRecord | null | undefined,
  nowMs: number
): DismissRecord {
  return { count: (rec?.count ?? 0) + 1, until: nowMs + THREE_DAYS_MS };
}

/** First-ride branch eligibility for a candidate NEWEST version row:
 *  an uncritiqued baseline with a real bike, at least 12h old. (The "no
 *  ride_feedback critiques it" and "newest" conditions are enforced by the
 *  caller's queries.) `bypassAgeGate` (a ride-reminder tap arrival,
 *  lib/reminderArrival.ts) skips ONLY the 12h age check — the baseline/bike
 *  requirements still hold. */
export function isFirstRideEligible(
  version:
    | Pick<SetupVersionRow, "id" | "source" | "bike_id" | "created_at">
    | null
    | undefined,
  nowMs: number,
  opts?: { bypassAgeGate?: boolean }
): boolean {
  if (!version?.id) return false;
  if (version.source !== "baseline") return false;
  if (!version.bike_id) return false;
  if (opts?.bypassAgeGate) return true;
  return new Date(version.created_at).getTime() <= nowMs - TWELVE_HOURS_MS;
}

/** Build the outcome-card title from the feedback's symptoms jsonb. */
export function titleFromSymptoms(symptoms: unknown): string {
  const issues = (Array.isArray(symptoms) ? symptoms : []).filter(
    (s: any) => s && typeof s.id === "string" && !s.protect
  );
  if (!issues.length) return FALLBACK_TITLE;

  const top = [...issues].sort(
    (a: any, b: any) => (Number(b.severity) || 0) - (Number(a.severity) || 0)
  )[0];
  const phrase = SYMPTOM_PHRASES[top.id as Tune2SymptomId];
  if (!phrase) return FALLBACK_TITLE;

  const where =
    typeof top.where === "string" && top.where.trim().length
      ? ` in ${top.where.trim().toLowerCase()}`
      : "";
  return `Last time you said ${phrase}${where}. Better on the new setup?`;
}
