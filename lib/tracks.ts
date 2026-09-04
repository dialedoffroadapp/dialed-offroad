// lib/tracks.ts
// Track picker data (design/mockups/ride/03, plan 4.4 + 5.1): Recent from the
// rider's own ride days (local history first, server fail-open), Nearby via
// the match_tracks RPC ("ridden by N others" from row counts), "New track
// here" pinned with ONE coarse location read through the existing
// lib/tuneLocation path. Free text always works offline. Table + RPC arrive
// with migration 20260904120000 (STAGED): before it lands, Nearby is empty
// and a new track lives as a local id until the outbox can create it.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { readHistory } from "./rideDay";
import { supabase } from "./supabase";
import { getTuneLocation } from "./tuneLocation";
import { logEvent } from "./usage";
import { isUuid } from "./uuid";

export type TrackChoice = {
  id: string | null; // null = free text only
  name: string;
  rides: number;
  /** "OMC baseline saved" / "Dunes setup" — the named setup tied to this track, if any. */
  setupName: string | null;
  distanceM?: number | null;
  riddenByOthers?: number | null;
  verified?: boolean;
};

const LOCAL_TRACKS_KEY = "ride_local_tracks_v1";

type LocalTrack = { id: string; name: string; lat: number | null; lng: number | null; createdAt: string; serverId: string | null };

async function readLocalTracks(): Promise<LocalTrack[]> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_TRACKS_KEY);
    return raw ? (JSON.parse(raw) as LocalTrack[]) : [];
  } catch {
    return [];
  }
}
async function writeLocalTracks(list: LocalTrack[]): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCAL_TRACKS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

/** Recent tracks from the rider's own ride days, most-ridden first. */
export async function recentTracks(setupNamesByTrack: Map<string, string> = new Map()): Promise<TrackChoice[]> {
  const history = await readHistory();
  const counts = new Map<string, { id: string | null; name: string; rides: number; last: string }>();
  for (const h of history) {
    const key = (h.trackId ?? h.trackName ?? "").toLowerCase();
    if (!key) continue;
    const cur = counts.get(key);
    if (cur) {
      cur.rides += 1;
      if (h.startedAt > cur.last) cur.last = h.startedAt;
    } else counts.set(key, { id: h.trackId, name: h.trackName ?? "Unnamed track", rides: 1, last: h.startedAt });
  }
  // Server ride days (fail-open): older devices / reinstalls.
  try {
    const { data } = await supabase.from("ride_days").select("track_id, track_name_raw, started_at").order("started_at", { ascending: false }).limit(200);
    for (const r of (data ?? []) as any[]) {
      const key = (r.track_id ?? r.track_name_raw ?? "").toLowerCase();
      if (!key || counts.has(key)) continue;
      counts.set(key, { id: r.track_id ?? null, name: r.track_name_raw ?? "Unnamed track", rides: 1, last: r.started_at });
    }
  } catch {
    // pre-migration / offline
  }
  return [...counts.values()]
    .sort((a, b) => b.rides - a.rides || (b.last > a.last ? 1 : -1))
    .slice(0, 6)
    .map((t) => ({ id: t.id, name: t.name, rides: t.rides, setupName: t.id ? setupNamesByTrack.get(t.id) ?? null : null }));
}

/** Nearby tracks from the crowdsourced table. One coarse read, never prompts
 *  (the one-time permission ask stays at first tune generation). */
export async function nearbyTracks(): Promise<TrackChoice[]> {
  const loc = await getTuneLocation(false);
  if (!loc) return [];
  try {
    const { data, error } = await supabase.rpc("match_tracks", { p_lat: loc.lat, p_lng: loc.lng, p_radius_m: 5000 });
    if (error || !Array.isArray(data)) return [];
    return (data as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      rides: 0,
      setupName: null,
      distanceM: typeof r.distance_m === "number" ? r.distance_m : null,
      riddenByOthers: typeof r.rider_count === "number" ? r.rider_count : null,
      verified: !!r.verified,
    }));
  } catch {
    return [];
  }
}

export function formatDistance(m: number | null | undefined): string | null {
  if (typeof m !== "number") return null;
  const mi = m / 1609.344;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

/** "New track here": creates the row pinned with one coarse fix (may be null
 *  offline; the row still exists by name). Local id until the server accepts. */
export async function createTrackHere(name: string, allowPrompt = true): Promise<TrackChoice> {
  const clean = name.trim();
  const loc = await getTuneLocation(allowPrompt);
  let serverId: string | null = null;
  if (loc) {
    try {
      // Dedup guard (plan 5.1): re-run the match at save; an existing track
      // within 500 m with the same name wins.
      const { data: near } = await supabase.rpc("match_tracks", { p_lat: loc.lat, p_lng: loc.lng, p_radius_m: 500 });
      const dup = (Array.isArray(near) ? (near as any[]) : []).find((r) => String(r.name).toLowerCase() === clean.toLowerCase());
      if (dup?.id) {
        void logEvent("track_match_confirmed", { track_id: dup.id, source: "create_dedup" });
        return { id: dup.id, name: dup.name, rides: 0, setupName: null };
      }
      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("tracks")
        .insert({ name: clean, lat: loc.lat, lng: loc.lng, created_by: auth?.user?.id ?? null })
        .select("id")
        .single();
      if (!error && (data as any)?.id) serverId = (data as any).id;
    } catch {
      serverId = null;
    }
  }
  const id = serverId ?? `local_${Date.now()}`;
  const list = await readLocalTracks();
  list.push({ id, name: clean, lat: loc?.lat ?? null, lng: loc?.lng ?? null, createdAt: new Date().toISOString(), serverId });
  await writeLocalTracks(list);
  void logEvent("track_created", { track_id: id, pinned: !!loc, server: !!serverId });
  return { id, name: clean, rides: 0, setupName: null };
}

export function isServerTrackId(id: string | null | undefined): boolean {
  return !!id && isUuid(id);
}
