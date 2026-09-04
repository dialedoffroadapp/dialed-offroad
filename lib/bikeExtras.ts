// lib/bikeExtras.ts
// The v3 bike attributes (hours, tire pressures, spring rates, photo,
// maintenance interval) live on `bikes` after migration 20260904100000
// (STAGED). They are read in their OWN query so a missing column before the
// push fails just this read (falls back to the device cache), never the bike
// itself. Writes go local-first, then best-effort to the row.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_OIL_INTERVAL_HOURS } from "./homeCopy";
import { supabase } from "./supabase";
import { isUuid } from "./uuid";

export type BikeExtras = {
  hours: number | null;
  tireFrontPsi: number | null;
  tireRearPsi: number | null;
  forkSpringRate: number | null;
  shockSpringRate: number | null;
  photoPath: string | null;
  maintenanceIntervalHours: number | null;
  lastServiceHours: number | null;
};

export const EMPTY_EXTRAS: BikeExtras = {
  hours: null,
  tireFrontPsi: null,
  tireRearPsi: null,
  forkSpringRate: null,
  shockSpringRate: null,
  photoPath: null,
  maintenanceIntervalHours: null,
  lastServiceHours: null,
};

const key = (bikeId: string) => `bike_extras_v1:${bikeId}`;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

function fromRow(row: any): BikeExtras {
  return {
    hours: num(row?.hours),
    tireFrontPsi: num(row?.tire_front_psi),
    tireRearPsi: num(row?.tire_rear_psi),
    forkSpringRate: num(row?.fork_spring_rate),
    shockSpringRate: num(row?.shock_spring_rate),
    photoPath: typeof row?.photo_path === "string" ? row.photo_path : null,
    maintenanceIntervalHours: num(row?.maintenance_interval_hours),
    lastServiceHours: num(row?.last_service_hours),
  };
}

function toRow(e: Partial<BikeExtras>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ("hours" in e) out.hours = e.hours;
  if ("tireFrontPsi" in e) out.tire_front_psi = e.tireFrontPsi;
  if ("tireRearPsi" in e) out.tire_rear_psi = e.tireRearPsi;
  if ("forkSpringRate" in e) out.fork_spring_rate = e.forkSpringRate;
  if ("shockSpringRate" in e) out.shock_spring_rate = e.shockSpringRate;
  if ("photoPath" in e) out.photo_path = e.photoPath;
  if ("maintenanceIntervalHours" in e) out.maintenance_interval_hours = e.maintenanceIntervalHours;
  if ("lastServiceHours" in e) out.last_service_hours = e.lastServiceHours;
  return out;
}

export async function readBikeExtras(bikeId: string): Promise<BikeExtras> {
  let local: BikeExtras | null = null;
  try {
    const raw = await AsyncStorage.getItem(key(bikeId));
    if (raw) local = { ...EMPTY_EXTRAS, ...JSON.parse(raw) };
  } catch {
    local = null;
  }
  if (!isUuid(bikeId)) return local ?? EMPTY_EXTRAS;
  try {
    const { data, error } = await supabase
      .from("bikes")
      .select("hours, tire_front_psi, tire_rear_psi, fork_spring_rate, shock_spring_rate, photo_path, maintenance_interval_hours, last_service_hours")
      .eq("id", bikeId)
      .maybeSingle();
    if (!error && data) {
      const remote = fromRow(data);
      // Server wins for any non-null field; the cache keeps values written
      // while the column didn't exist yet.
      const merged: BikeExtras = { ...(local ?? EMPTY_EXTRAS) };
      (Object.keys(remote) as (keyof BikeExtras)[]).forEach((k) => {
        if (remote[k] !== null) (merged as any)[k] = remote[k];
      });
      void AsyncStorage.setItem(key(bikeId), JSON.stringify(merged)).catch(() => {});
      return merged;
    }
  } catch {
    // pre-migration / offline
  }
  return local ?? EMPTY_EXTRAS;
}

export async function saveBikeExtras(bikeId: string, patch: Partial<BikeExtras>): Promise<BikeExtras> {
  let current: BikeExtras = EMPTY_EXTRAS;
  try {
    const raw = await AsyncStorage.getItem(key(bikeId));
    if (raw) current = { ...EMPTY_EXTRAS, ...JSON.parse(raw) };
  } catch {
    // start from empty
  }
  const next = { ...current, ...patch };
  try {
    await AsyncStorage.setItem(key(bikeId), JSON.stringify(next));
  } catch {
    // ignore
  }
  if (isUuid(bikeId)) {
    try {
      await supabase.from("bikes").update(toRow(patch)).eq("id", bikeId);
    } catch {
      // best-effort
    }
  }
  return next;
}

export function oilIntervalFor(e: BikeExtras): number {
  return e.maintenanceIntervalHours ?? DEFAULT_OIL_INTERVAL_HOURS;
}

/** "oil at 15" — the next service mark from the interval. */
export function nextOilAt(e: BikeExtras): number {
  const interval = oilIntervalFor(e);
  const base = e.lastServiceHours ?? 0;
  return base + interval;
}
