// lib/reminderArrival.ts
// Short-lived "the user arrived via a ride-reminder tap" flag, bridging the
// notification-tap handler (app/_layout.tsx) and OutcomeCheckinCard's
// eligibility check. The flag bypasses ONLY the 12-hour age gate on the
// first-ride branch — every other exclusion (dismiss strikes, existing
// feedback, guest, one-per-session) still applies.
//
// Persisted in AsyncStorage so a tap that cold-starts the app survives boot,
// with a TTL so a stale flag can't resurrect the override days later. Live
// subscribers exist because on cold start the Home tab focuses (and runs its
// eligibility check) BEFORE the delayed tap handler runs — the ping lets an
// already-focused card re-check instead of missing the flag.

import AsyncStorage from "@react-native-async-storage/async-storage";

const ARRIVAL_KEY = "ride_reminder_arrival_v1";
const ARRIVAL_TTL_MS = 10 * 60 * 1000;

type ArrivalRecord = { versionId: string | null; at: number };

type Listener = () => void;
const listeners = new Set<Listener>();

/** Notifies when an arrival is marked while the app is running. Returns an
 *  unsubscribe function. */
export function subscribeReminderArrival(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Called from the ride-reminder tap handler. Fail-silent: the tap must
 *  still navigate even if the flag can't be written. */
export async function markReminderArrival(
  versionId?: string | null
): Promise<void> {
  try {
    const rec: ArrivalRecord = { versionId: versionId ?? null, at: Date.now() };
    await AsyncStorage.setItem(ARRIVAL_KEY, JSON.stringify(rec));
  } catch {
    // storage failed — subscribers still get the in-memory ping
  }
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // one bad listener must not block the rest
    }
  });
}

/** Read-and-clear. Returns null when no flag is set, it has expired, or the
 *  record is unreadable — the caller then applies the normal age gate. */
export async function consumeReminderArrival(): Promise<ArrivalRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(ARRIVAL_KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(ARRIVAL_KEY);
    const rec = JSON.parse(raw) as ArrivalRecord;
    if (!rec || Date.now() - (rec.at ?? 0) > ARRIVAL_TTL_MS) return null;
    return rec;
  } catch {
    return null;
  }
}
