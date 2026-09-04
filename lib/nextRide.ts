// lib/nextRide.ts
// Rider-picked next ride date (Home). NO notification of any kind is attached
// (the night-before push is out of the plan). Local-first with a best-effort
// mirror to profiles.next_ride_date (migration 20260904100000, STAGED).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

const key = (userId: string) => `next_ride_v1:${userId}`;

/** ISO date (YYYY-MM-DD) → local-midnight Date. */
export function isoToLocalDate(iso: string | null | undefined): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function dateToIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function readNextRideDate(userId: string): Promise<string | null> {
  let local: string | null = null;
  try {
    local = await AsyncStorage.getItem(key(userId));
  } catch {
    local = null;
  }
  try {
    const { data } = await supabase.from("profiles").select("next_ride_date").eq("user_id", userId).maybeSingle();
    const remote = (data as any)?.next_ride_date;
    if (typeof remote === "string" && remote.length >= 10) {
      const iso = remote.slice(0, 10);
      void AsyncStorage.setItem(key(userId), iso).catch(() => {});
      return iso;
    }
  } catch {
    // column not migrated yet / offline
  }
  return local;
}

export async function saveNextRideDate(userId: string, iso: string | null): Promise<void> {
  try {
    if (iso) await AsyncStorage.setItem(key(userId), iso);
    else await AsyncStorage.removeItem(key(userId));
  } catch {
    // ignore
  }
  try {
    await supabase.from("profiles").update({ next_ride_date: iso }).eq("user_id", userId);
  } catch {
    // best-effort
  }
}
