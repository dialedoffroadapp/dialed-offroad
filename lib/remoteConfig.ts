// lib/remoteConfig.ts
// Small typed reader over prod `app_config` (migration 20260902110000 + seeds
// in 20260904150000): remote > device cache > build default, same shape as
// lib/paywallPosition.ts. Values flip without a store release.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

export const CONFIG_DEFAULTS = {
  trial_ride_days: 3,
  trial_days: 21,
  lifetime_price_usd: 129,
  lifetime_min_ride_days: 3,
} as const;

export type ConfigKey = keyof typeof CONFIG_DEFAULTS;

const CACHE_KEY = "dialed_remote_config_v1";
let cache: Partial<Record<ConfigKey, number>> = {};
let hydrated = false;

export function getConfigNumber(key: ConfigKey): number {
  const v = cache[key];
  return typeof v === "number" && Number.isFinite(v) ? v : CONFIG_DEFAULTS[key];
}

export async function hydrateRemoteConfig(): Promise<void> {
  if (!hydrated) {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (raw) cache = { ...cache, ...JSON.parse(raw) };
    } catch {
      // defaults stand
    }
    hydrated = true;
  }
  try {
    const keys = Object.keys(CONFIG_DEFAULTS);
    const query = supabase.from("app_config").select("key, value").in("key", keys);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<null>((r) => {
      timer = setTimeout(() => r(null), 4000);
    });
    const res = (await Promise.race([query, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    })) as any;
    const rows = res?.data as { key: string; value: unknown }[] | undefined;
    if (rows?.length) {
      const next = { ...cache };
      for (const r of rows) {
        const n = typeof r.value === "number" ? r.value : Number(r.value);
        if (Number.isFinite(n) && (keys as string[]).includes(r.key)) (next as any)[r.key] = n;
      }
      cache = next;
      try {
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      } catch {
        // ignore
      }
    }
  } catch {
    // offline / pre-migration
  }
}

/** Tests only. */
export function __setRemoteConfigForTests(v: Partial<Record<ConfigKey, number>>): void {
  cache = { ...v };
  hydrated = true;
}
