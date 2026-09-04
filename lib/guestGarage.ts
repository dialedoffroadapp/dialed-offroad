// lib/guestGarage.ts
// The guest (pre-auth) garage store, shared with app/(tabs)/garage.tsx and
// lib/bikeReconcile.ts (which still carry private copies of these keys —
// same strings, same row shape). Signup migration (lib/authSuccess.ts →
// reconcileGuestBikes) reads exactly this store, so a bike the quiz writes
// here migrates into the account like a garage-added one.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { resolveModelId } from "./bikes";
import { supabase } from "./supabase";
import { isUuid } from "./uuid";

export const GUEST_BIKES_KEY = "dialed_guest_bikes_v1";
export const GUEST_DEFAULT_BIKE_KEY = "dialed_guest_default_bike_v1";

export type GuestBike = {
  id: string;
  make: string;
  model: string;
  year: number;
  nickname: string | null;
};

/** Same id shape garage.tsx mints (NOT a uuid — see asUuidOrNull callers). */
export function genLocalBikeId(): string {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function readGuestBikes(): Promise<GuestBike[]> {
  try {
    const raw = await AsyncStorage.getItem(GUEST_BIKES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as GuestBike[]) : [];
  } catch {
    return [];
  }
}

export async function writeGuestBikes(bikes: GuestBike[]): Promise<void> {
  await AsyncStorage.setItem(GUEST_BIKES_KEY, JSON.stringify(bikes));
}

export async function writeGuestDefaultBikeId(id: string | null): Promise<void> {
  if (!id) {
    await AsyncStorage.removeItem(GUEST_DEFAULT_BIKE_KEY);
    return;
  }
  await AsyncStorage.setItem(GUEST_DEFAULT_BIKE_KEY, id);
}

export type UpsertQuizBikeInput = {
  make: string;
  model: string;
  year: number;
  /** The bike this quiz run created earlier (re-answering Q2 replaces it). */
  previousId?: string | null;
};

/**
 * Create or replace the quiz's bike and make it the default. Guest → the
 * local store (garage parity). Signed in (rare: mid-onboarding with a
 * session) → the bikes table, resolving model_id like garage.tsx does; a
 * duplicate (ux_bikes_unique_desc_per_user) resolves to the existing row.
 * Returns the bike id (local id or uuid).
 */
export async function upsertQuizBike(input: UpsertQuizBikeInput): Promise<string> {
  const { make, model, year, previousId } = input;

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  if (userId) {
    const model_id = await resolveModelId(make, model, year);
    if (previousId && isUuid(previousId)) {
      const { error } = await supabase
        .from("bikes")
        .update({ make, model, year, model_id })
        .eq("id", previousId);
      if (!error) return previousId;
    }
    const { data, error } = await supabase
      .from("bikes")
      .insert({ user_id: userId, make, model, year, nickname: null, model_id })
      .select("id")
      .single();
    if (!error && (data as any)?.id) return (data as any).id as string;
    if (error && (error as any).code === "23505") {
      const { data: existing } = await supabase
        .from("bikes")
        .select("id")
        .eq("user_id", userId)
        .eq("make", make)
        .eq("model", model)
        .eq("year", year)
        .limit(1)
        .maybeSingle();
      if ((existing as any)?.id) return (existing as any).id as string;
    }
    if (error) throw error;
  }

  const bikes = await readGuestBikes();
  const idx = previousId ? bikes.findIndex((b) => b.id === previousId) : -1;
  const id = idx >= 0 ? (previousId as string) : genLocalBikeId();
  const row: GuestBike = {
    id,
    make,
    model,
    year,
    nickname: idx >= 0 ? bikes[idx].nickname ?? null : null,
  };
  if (idx >= 0) bikes[idx] = row;
  else bikes.push(row);
  await writeGuestBikes(bikes);
  await writeGuestDefaultBikeId(id);
  return id;
}
