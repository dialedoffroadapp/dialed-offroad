// lib/bikeReconcile.ts
// Launch-time reconciliation for guest-era bike ids.
//
// Guest bikes are created with LOCAL ids ("1783553470201_…", garage.tsx
// genLocalId) that live in AsyncStorage and in pending-tune meta snapshots.
// After signup the bikes table is the source of truth, but three things can
// survive with local ids: the guest garage store (if garage's own sync never
// ran or partially failed), the guest default-bike key, and the pending tune.
// A local-id bike now saves versions as bike_id null — no history, no lineage,
// no check-in keying — so signed-in users must be healed, not just guarded.
//
// Everything here is fail-silent and idempotent; it runs on every signed-in
// app launch and no-ops when there's nothing to reconcile.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { PENDING_GUEST_BIKE_SYNC_KEY, readPendingTune, remapPendingTuneBikeId } from "./onboarding";
import { normalizeBikeStrings, resolveModelId } from "./bikes";
import { supabase } from "./supabase";
import { isUuid } from "./uuid";

// Same keys the Garage screen uses for guest mode.
const GUEST_BIKES_KEY = "dialed_guest_bikes_v1";
const GUEST_DEFAULT_BIKE_KEY = "dialed_guest_default_bike_v1";

type GuestBike = {
  id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  nickname?: string | null;
};

type TableBike = {
  id: string;
  make: string | null;
  model: string | null;
  year: number | null;
};

const bikeKey = (b: { make?: string | null; model?: string | null; year?: number | null }) =>
  `${(b.make ?? "").trim().toLowerCase()}|${(b.model ?? "").trim().toLowerCase()}|${b.year ?? ""}`;

/**
 * Ensure a bike with these values exists in the table; returns its uuid.
 * Dedupes by make/model/year so repeated reconciles never duplicate.
 */
async function ensureTableBike(
  userId: string,
  bike: { make: string; model: string; year: number; nickname?: string | null },
  existing: TableBike[]
): Promise<string | null> {
  const { make, model } = normalizeBikeStrings(bike.make, bike.model);
  const match = existing.find(
    (e) => bikeKey(e) === bikeKey({ make, model, year: bike.year })
  );
  if (match) return match.id;

  const model_id = await resolveModelId(make, model, bike.year);
  const { data, error } = await supabase
    .from("bikes")
    .insert({
      user_id: userId,
      make,
      model,
      year: bike.year,
      nickname: bike.nickname ?? null,
      model_id,
    })
    .select("id, make, model, year")
    .single();
  if (error || !data?.id) return null;

  existing.push(data as TableBike);
  return data.id;
}

/**
 * reconcileGuestBikes — run once per signed-in launch (fail-silent).
 * 1. Migrates any surviving guest-store bikes into the bikes table (deduped).
 * 2. Remaps the guest default-bike key from local id → table uuid.
 * 3. Retries the signup-time single-bike sync record (deduped).
 * 4. Heals the pending tune's bike ids via the resulting id map, falling back
 *    to a make/model/year match against the user's garage.
 */
/**
 * The signup-time retry stash (PENDING_GUEST_BIKE_SYNC_KEY) is bound to the
 * user whose migration failed — it must NEVER fire for whoever happens to be
 * signed in at retry time (that's the cross-account write shape of the
 * 2026-07-27 dup-bike incident; the stash was already bound, this predicate
 * just makes the binding testable).
 */
export function stashBelongsToUser(syncData: any, userId: string): boolean {
  return !!(
    syncData &&
    syncData.userId === userId &&
    syncData.make &&
    syncData.model &&
    syncData.year
  );
}

export async function reconcileGuestBikes(userId: string): Promise<void> {
  try {
    const idMap = new Map<string, string>(); // localId -> uuid

    const { data: tableRows } = await supabase
      .from("bikes")
      .select("id, make, model, year")
      .eq("user_id", userId);
    const existing: TableBike[] = (tableRows ?? []) as TableBike[];

    // 1. Surviving guest-store bikes
    try {
      const raw = await AsyncStorage.getItem(GUEST_BIKES_KEY);
      const guestBikes: GuestBike[] = raw ? JSON.parse(raw) : [];
      if (Array.isArray(guestBikes) && guestBikes.length > 0) {
        let allHandled = true;
        for (const gb of guestBikes) {
          if (!gb?.make || !gb?.model || typeof gb?.year !== "number") continue;
          const uuid = await ensureTableBike(
            userId,
            { make: gb.make, model: gb.model, year: gb.year, nickname: gb.nickname },
            existing
          );
          if (uuid) {
            if (gb.id && !isUuid(gb.id)) idMap.set(gb.id, uuid);
          } else {
            allHandled = false;
          }
        }
        if (allHandled) {
          await AsyncStorage.removeItem(GUEST_BIKES_KEY);
        }
      }
    } catch {
      // non-critical
    }

    // 2. Guest default-bike key: remap local id → uuid (or drop if unmappable)
    try {
      const def = await AsyncStorage.getItem(GUEST_DEFAULT_BIKE_KEY);
      if (def && !isUuid(def)) {
        const mapped = idMap.get(def);
        if (mapped) {
          await AsyncStorage.setItem(GUEST_DEFAULT_BIKE_KEY, mapped);
        } else {
          await AsyncStorage.removeItem(GUEST_DEFAULT_BIKE_KEY);
        }
      }
    } catch {
      // non-critical
    }

    // 3. Signup-time single-bike sync retry (previously "Fix 4" in index.tsx)
    try {
      const syncRaw = await AsyncStorage.getItem(PENDING_GUEST_BIKE_SYNC_KEY);
      if (syncRaw) {
        const syncData = JSON.parse(syncRaw);
        if (stashBelongsToUser(syncData, userId)) {
          const uuid = await ensureTableBike(
            userId,
            {
              make: String(syncData.make),
              model: String(syncData.model),
              year: Number(syncData.year),
            },
            existing
          );
          if (uuid) {
            await AsyncStorage.removeItem(PENDING_GUEST_BIKE_SYNC_KEY);
          }
        } else {
          // Record belongs to another user or is malformed — drop it.
          await AsyncStorage.removeItem(PENDING_GUEST_BIKE_SYNC_KEY);
        }
      }
    } catch {
      // non-critical
    }

    // 4. Heal the pending tune's bike ids
    try {
      const { tune } = await readPendingTune();
      if (tune) {
        let localId: string | null = null;
        let metaBike: any = null;
        try {
          const m = JSON.parse(decodeURIComponent(tune.meta));
          metaBike = m?.bike ?? null;
          const candidates = [
            tune.bikeId,
            m?.bike_id,
            m?.bike?.id,
            m?.bike?.selectedBikeId,
            m?.context?.bike_id,
            m?.context?.selectedBikeId,
          ];
          localId =
            candidates.find(
              (c) => typeof c === "string" && c.length > 0 && !isUuid(c)
            ) ?? null;
        } catch {
          localId = tune.bikeId && !isUuid(tune.bikeId) ? tune.bikeId : null;
        }

        if (localId) {
          let uuid = idMap.get(localId) ?? null;
          if (!uuid && metaBike?.make && metaBike?.model && metaBike?.year) {
            uuid =
              existing.find(
                (e) =>
                  bikeKey(e) ===
                  bikeKey({
                    make: String(metaBike.make),
                    model: String(metaBike.model),
                    year: Number(metaBike.year),
                  })
              )?.id ?? null;
          }
          if (uuid) {
            await remapPendingTuneBikeId(uuid);
          }
        }
      }
    } catch {
      // non-critical
    }
  } catch (e) {
    console.warn("reconcileGuestBikes skipped", e);
  }
}
