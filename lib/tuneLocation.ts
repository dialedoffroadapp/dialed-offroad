// lib/tuneLocation.ts
// Coarse one-shot location for tune requests (v2.4.0 data capture).
// Silent-with-permission model: the ONLY system prompt fires at the first
// tune generation (never app launch); denial, timeout, or a missing native
// module all degrade to "no location" with no nagging and no re-prompt.
// Coordinates are rounded to 3 decimals (~110 m) on purpose: region, not
// meters. Tune generation must never block on this — input screens prewarm
// a fix so the generate-time read is usually instant, and the acquisition
// itself is capped by a hard 3 s timeout.

import AsyncStorage from "@react-native-async-storage/async-storage";

export type TuneLocation = {
  lat: number;
  lng: number;
  accuracy_m: number | null;
};

// Module-presence gate (CLAUDE.md landmine): binaries built before
// expo-location joined the dev client see "unavailable", not a crash.
let Location: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Location = require("expo-location");
} catch {
  Location = null;
}

const PROMPTED_KEY = "tune_location_prompted_v1";
const FIX_TTL_MS = 5 * 60 * 1000;
const FIX_TIMEOUT_MS = 3000;

let lastFix: { value: TuneLocation | null; at: number } | null = null;
let inflight: Promise<TuneLocation | null> | null = null;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

async function acquireFix(): Promise<TuneLocation | null> {
  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const lat = pos?.coords?.latitude;
    const lng = pos?.coords?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const acc = pos?.coords?.accuracy;
    return {
      lat: round3(lat),
      lng: round3(lng),
      accuracy_m: Number.isFinite(acc) ? Math.round(acc) : null,
    };
  } catch {
    return null;
  }
}

/** Start (or join) the single in-flight acquisition; caches the result. */
function startFix(): Promise<TuneLocation | null> {
  if (!inflight) {
    inflight = acquireFix().then((v) => {
      lastFix = { value: v, at: Date.now() };
      inflight = null;
      return v;
    });
  }
  return inflight;
}

/** Permission state, optionally spending the one-time ask. Never prompts
 *  unless allowPrompt AND the OS state is still undetermined AND the ask was
 *  never spent before (AsyncStorage latch survives reinstall-less updates). */
async function hasPermission(allowPrompt: boolean): Promise<boolean> {
  if (!Location) return false;
  try {
    const cur = await Location.getForegroundPermissionsAsync();
    if (cur?.status === "granted") return true;
    if (!allowPrompt || cur?.status !== "undetermined") return false;
    const asked = await AsyncStorage.getItem(PROMPTED_KEY);
    if (asked) return false;
    await AsyncStorage.setItem(PROMPTED_KEY, "1");
    const req = await Location.requestForegroundPermissionsAsync();
    return req?.status === "granted";
  } catch {
    return false;
  }
}

/** Fire-and-forget from tune input screens: if permission is ALREADY granted,
 *  start a fix so it's ready by generate time. Never prompts. */
export function prewarmTuneLocation(): void {
  void (async () => {
    if (!(await hasPermission(false))) return;
    if (lastFix && Date.now() - lastFix.at < FIX_TTL_MS) return;
    void startFix();
  })();
}

/** One coarse fix for the tune payload, or null (proceed without location).
 *  allowPrompt=true only at tune generation — the decided one-time ask
 *  moment. Bounded by the 3 s hard timeout; a fix that lands after the
 *  timeout is cached for the next generation instead of being lost. */
export async function getTuneLocation(
  allowPrompt = true
): Promise<TuneLocation | null> {
  if (!(await hasPermission(allowPrompt))) return null;
  if (lastFix && Date.now() - lastFix.at < FIX_TTL_MS && lastFix.value) {
    return lastFix.value;
  }
  return Promise.race([
    startFix(),
    new Promise<null>((res) => setTimeout(() => res(null), FIX_TIMEOUT_MS)),
  ]);
}
