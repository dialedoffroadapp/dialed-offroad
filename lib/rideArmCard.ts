// lib/rideArmCard.ts
// Lifecycle + eligibility for the Home "arm your ride check-in" card
// (v2.3.0 design promotion of the post-reveal hook).
//
// The card shows when the user's NEWEST setup version:
//   - has no feedback submitted (server truth: ride_feedback.setup_version_id),
//   - hasn't been armed from either surface (local latch, per version),
//   - isn't snoozed ("Not now" → 24h, per version),
//   - is younger than 14 days.
// A new setup version resets the cycle by construction: all local state is
// keyed by version id.
//
// Mutual exclusion with the check-in cards (outcome/first-ride) is a RENDER
// rule on Home, not an eligibility rule here: homeArmSlotVisible() is the
// exact gate Home uses, kept pure so the matrix is testable.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

export const HOME_ARM_CARD_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const HOME_ARM_SNOOZE_MS = 24 * 60 * 60 * 1000;

const STORE_KEY = "dialed_ride_arm_card_v1";

export type ArmCardLocalState = {
  /** Versions armed from EITHER surface — permanently hidden. */
  armedVersionIds: string[];
  /** versionId → epoch-ms until which "Not now" suppresses the card. */
  snoozes: Record<string, number>;
};

const EMPTY: ArmCardLocalState = { armedVersionIds: [], snoozes: {} };

export async function readArmCardLocal(): Promise<ArmCardLocalState> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    return {
      armedVersionIds: Array.isArray(parsed?.armedVersionIds)
        ? parsed.armedVersionIds.filter((v: unknown) => typeof v === "string")
        : [],
      snoozes:
        parsed?.snoozes && typeof parsed.snoozes === "object"
          ? parsed.snoozes
          : {},
    };
  } catch {
    return EMPTY;
  }
}

async function writeArmCardLocal(state: ArmCardLocalState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // nudge-card state is best-effort
  }
}

/** Permanent per-version latch — call on successful arm from ANY surface. */
export async function markArmCardArmed(versionId: string): Promise<void> {
  const local = await readArmCardLocal();
  if (local.armedVersionIds.includes(versionId)) return;
  await writeArmCardLocal({
    ...local,
    armedVersionIds: [...local.armedVersionIds, versionId].slice(-20),
  });
}

/** "Not now": suppress this version for 24h. */
export async function snoozeArmCard(
  versionId: string,
  now: number = Date.now()
): Promise<void> {
  const local = await readArmCardLocal();
  await writeArmCardLocal({
    ...local,
    snoozes: { ...local.snoozes, [versionId]: now + HOME_ARM_SNOOZE_MS },
  });
}

export type ArmCardCandidate = {
  versionId: string;
  versionNumber: number;
  bikeId: string | null;
  bikeTitle: string;
  createdAtMs: number;
};

/** Newest setup version + bike title + server feedback truth. RLS scopes to
 *  the signed-in user; returns null candidate when signed out / no versions. */
export async function getArmCardCandidate(): Promise<{
  candidate: ArmCardCandidate | null;
  hasFeedback: boolean;
}> {
  try {
    const { data: v } = await supabase
      .from("setup_versions")
      .select("id, version_number, bike_id, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!v?.id) return { candidate: null, hasFeedback: false };

    let bikeTitle = "Your bike";
    if (v.bike_id) {
      const { data: bike } = await supabase
        .from("bikes")
        .select("make, model, year, nickname")
        .eq("id", v.bike_id)
        .maybeSingle();
      bikeTitle =
        bike?.nickname ||
        [bike?.make, bike?.model].filter(Boolean).join(" ") ||
        "Your bike";
    }

    const { data: fb } = await supabase
      .from("ride_feedback")
      .select("id")
      .eq("setup_version_id", v.id)
      .limit(1)
      .maybeSingle();

    return {
      candidate: {
        versionId: v.id,
        versionNumber: v.version_number ?? 1,
        bikeId: v.bike_id ?? null,
        bikeTitle,
        createdAtMs: Date.parse(v.created_at),
      },
      hasFeedback: !!fb?.id,
    };
  } catch {
    return { candidate: null, hasFeedback: false };
  }
}

/** Pure lifecycle rule — the full show/hide matrix, testable. */
export function computeArmCardEligible(args: {
  candidate: { versionId: string; createdAtMs: number } | null;
  hasFeedback: boolean;
  local: ArmCardLocalState;
  now: number;
}): boolean {
  const { candidate, hasFeedback, local, now } = args;
  if (!candidate) return false;
  if (hasFeedback) return false;
  if (!Number.isFinite(candidate.createdAtMs)) return false;
  if (now - candidate.createdAtMs > HOME_ARM_CARD_WINDOW_MS) return false;
  if (local.armedVersionIds.includes(candidate.versionId)) return false;
  const snoozedUntil = local.snoozes[candidate.versionId];
  if (typeof snoozedUntil === "number" && now < snoozedUntil) return false;
  return true;
}

/** The exact render gate Home uses for the arm-card slot. Mutual exclusion:
 *  any rendering check-in card (outcome or first-ride) wins; until the
 *  check-in decision arrives, nothing renders (no flash-then-hide). Paywall
 *  decliners never see it (no revealed setup to ride; the unlock banner owns
 *  their Home real estate — same rule as the check-in slot). */
export function homeArmSlotVisible(args: {
  paywallDecliner: boolean;
  checkinDecided: boolean;
  checkinVisible: boolean;
  armEligible: boolean;
}): boolean {
  return (
    !args.paywallDecliner &&
    args.checkinDecided &&
    !args.checkinVisible &&
    args.armEligible
  );
}
