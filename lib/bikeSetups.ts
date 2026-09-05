// lib/bikeSetups.ts
// Named setups per bike (design/mockups/04, 07; plan 4.10). Every bike has a
// DEFAULT setup = its setup_versions rows with setup_id null (all rows
// today). Named setups live in `bike_setups` + setup_versions.setup_id
// (migration 20260904100000, STAGED): reads are fail-open (pre-migration →
// default setup only), writes are best-effort with a device-cache mirror so
// the screens can be exercised before the push.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { logEvent } from "./usage";
import { supabase } from "./supabase";
import { isUuid } from "./uuid";
import type { SetupVersionRow, VersionWithFeedback } from "./setupVersions";

export type BikeSetup = {
  id: string | null; // null = the default setup
  bikeId: string;
  name: string;
  terrain: string | null;
  isRunning: boolean;
  createdFromVersionId: string | null;
  createdAt: string;
};

const cacheKey = (bikeId: string) => `bike_setups_v1:${bikeId}`;

/** "Hardpack setup" from the running version's terrain, else "Baseline". */
export function defaultSetupName(terrain: string | null | undefined): string {
  const t = terrain?.trim();
  if (!t) return "Baseline";
  const first = t.split(",")[0].trim();
  const cap = first.charAt(0).toUpperCase() + first.slice(1);
  return /setup$/i.test(cap) ? cap : `${cap} setup`;
}

function rowToSetup(r: any): BikeSetup {
  return {
    id: r.id,
    bikeId: r.bike_id,
    name: r.name,
    terrain: r.terrain ?? null,
    isRunning: !!r.is_running,
    createdFromVersionId: r.created_from_version_id ?? null,
    createdAt: r.created_at ?? new Date(0).toISOString(),
  };
}

/** Named setups for a bike (server, else cache). The default setup is NOT
 *  in this list — callers prepend it (see setupsForBike). */
export async function readNamedSetups(bikeId: string): Promise<BikeSetup[]> {
  if (isUuid(bikeId)) {
    try {
      const { data, error } = await supabase
        .from("bike_setups")
        .select("id, bike_id, name, terrain, is_running, created_from_version_id, created_at")
        .eq("bike_id", bikeId)
        .order("created_at", { ascending: true });
      if (!error && data) {
        const list = (data as any[]).map(rowToSetup);
        void AsyncStorage.setItem(cacheKey(bikeId), JSON.stringify(list)).catch(() => {});
        return list;
      }
    } catch {
      // pre-migration / offline
    }
  }
  try {
    const raw = await AsyncStorage.getItem(cacheKey(bikeId));
    return raw ? (JSON.parse(raw) as BikeSetup[]) : [];
  } catch {
    return [];
  }
}

/** version id → setup id (null = default). Pre-migration: everything default. */
export async function readVersionSetupMap(bikeId: string): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (!isUuid(bikeId)) return map;
  try {
    const { data, error } = await supabase.from("setup_versions").select("id, setup_id").eq("bike_id", bikeId);
    if (!error && data) for (const r of data as any[]) map.set(r.id, r.setup_id ?? null);
  } catch {
    // column missing pre-migration → default for all
  }
  return map;
}

export type SetupWithVersions = BikeSetup & {
  versions: VersionWithFeedback[]; // newest first
  running: VersionWithFeedback | null;
};

/** The bike's setups, default first, each with its own version lineage. */
export function setupsForBike(
  bikeId: string,
  named: BikeSetup[],
  versions: VersionWithFeedback[],
  versionSetup: Map<string, string | null>
): SetupWithVersions[] {
  const byId = new Map<string | null, VersionWithFeedback[]>();
  for (const v of versions) {
    const sid = versionSetup.get(v.id) ?? null;
    const arr = byId.get(sid) ?? [];
    arr.push(v);
    byId.set(sid, arr);
  }
  const defaultVersions = byId.get(null) ?? [];
  const anyNamedRunning = named.some((s) => s.isRunning);
  const def: SetupWithVersions = {
    id: null,
    bikeId,
    name: defaultSetupName(defaultVersions[0]?.terrain),
    terrain: defaultVersions[0]?.terrain ?? null,
    isRunning: !anyNamedRunning,
    createdFromVersionId: null,
    createdAt: defaultVersions[defaultVersions.length - 1]?.created_at ?? new Date(0).toISOString(),
    versions: defaultVersions,
    running: defaultVersions[0] ?? null,
  };
  const rest = named.map((s) => {
    const vs = byId.get(s.id) ?? [];
    return { ...s, versions: vs, running: vs[0] ?? null };
  });
  return [def, ...rest];
}

export function runningSetup(setups: SetupWithVersions[]): SetupWithVersions | null {
  return setups.find((s) => s.isRunning) ?? setups[0] ?? null;
}

const VALUE_FIELDS: (keyof SetupVersionRow)[] = [
  "fork_comp_clicks",
  "fork_reb_clicks",
  "fork_air_bar",
  "shock_lsc_clicks",
  "shock_hsc_turns",
  "shock_reb_clicks",
  "sag_mm",
];

/**
 * Insert a version into a setup's lineage: a copy of `from` with `patch`
 * applied. source "manual" = the rider fixed a number / created a setup;
 * numbering + delta come from the DB triggers. Returns the new row.
 */
export async function createManualVersion(params: {
  bikeId: string;
  setupId: string | null;
  from: SetupVersionRow | null;
  patch?: Partial<Pick<SetupVersionRow, "fork_comp_clicks" | "fork_reb_clicks" | "fork_air_bar" | "shock_lsc_clicks" | "shock_hsc_turns" | "shock_reb_clicks" | "sag_mm">>;
  terrain?: string | null;
  note?: string;
  parentId?: string | null;
  /** Extra columns (e.g. ride_day_id once migration 20260904120000 lands). */
  extra?: Record<string, unknown>;
}): Promise<SetupVersionRow> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) throw new Error("Not signed in");
  const base: Record<string, unknown> = { user_id: userId, bike_id: params.bikeId, source: "manual" };
  for (const f of VALUE_FIELDS) base[f] = params.from ? (params.from as any)[f] ?? null : null;
  Object.assign(base, params.patch ?? {});
  base.parent_version_id = params.parentId === undefined ? params.from?.id ?? null : params.parentId;
  base.terrain = params.terrain === undefined ? params.from?.terrain ?? null : params.terrain;
  base.notes = params.note ? [params.note] : [];
  base.sag_measured = false;
  if (params.from?.recommended_settings) base.recommended_settings = params.from.recommended_settings;
  if (params.from?.applied_settings) base.applied_settings = params.from.applied_settings;
  if (params.setupId) base.setup_id = params.setupId;
  Object.assign(base, params.extra ?? {});
  const { data, error } = await supabase.from("setup_versions").insert(base).select("*").single();
  if (error) throw error;
  void logEvent("version_created", { bike_id: params.bikeId, source: "manual", setup_id: params.setupId ?? null });
  return data as unknown as SetupVersionRow;
}

/** Create a named setup (Pro) seeded from a version. Best-effort server;
 *  a local placeholder keeps the UI honest pre-migration (no versions). */
export async function createNamedSetup(params: {
  bikeId: string;
  name: string;
  terrain: string | null;
  from: SetupVersionRow | null;
}): Promise<{ setup: BikeSetup; firstVersion: SetupVersionRow | null; serverOk: boolean }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) throw new Error("Not signed in");
  let setup: BikeSetup | null = null;
  let serverOk = false;
  try {
    const { data, error } = await supabase
      .from("bike_setups")
      .insert({ user_id: userId, bike_id: params.bikeId, name: params.name, terrain: params.terrain, is_running: false, created_from_version_id: params.from?.id ?? null })
      .select("id, bike_id, name, terrain, is_running, created_from_version_id, created_at")
      .single();
    if (!error && data) {
      setup = rowToSetup(data);
      serverOk = true;
    }
  } catch {
    setup = null;
  }
  if (!setup) {
    setup = {
      id: `local_${Date.now()}`,
      bikeId: params.bikeId,
      name: params.name,
      terrain: params.terrain,
      isRunning: false,
      createdFromVersionId: params.from?.id ?? null,
      createdAt: new Date().toISOString(),
    };
  }
  // cache mirror
  try {
    const raw = await AsyncStorage.getItem(cacheKey(params.bikeId));
    const list = raw ? (JSON.parse(raw) as BikeSetup[]) : [];
    list.push(setup);
    await AsyncStorage.setItem(cacheKey(params.bikeId), JSON.stringify(list));
  } catch {
    // ignore
  }
  let firstVersion: SetupVersionRow | null = null;
  if (serverOk && setup.id && params.from) {
    try {
      firstVersion = await createManualVersion({
        bikeId: params.bikeId,
        setupId: setup.id,
        from: params.from,
        parentId: params.from.id,
        terrain: params.terrain,
        note: `Started from v${params.from.version_number}`,
      });
    } catch (e) {
      console.warn("[setups] first version insert failed", e);
    }
  }
  return { setup, firstVersion, serverOk };
}

/** "Run this setup": one running setup per bike, switching explicit. */
export async function switchRunningSetup(bikeId: string, setupId: string | null): Promise<boolean> {
  let ok = false;
  if (isUuid(bikeId)) {
    try {
      const off = await supabase.from("bike_setups").update({ is_running: false }).eq("bike_id", bikeId);
      if (!off.error) {
        if (setupId && isUuid(setupId)) {
          const on = await supabase.from("bike_setups").update({ is_running: true }).eq("id", setupId);
          ok = !on.error;
        } else ok = true; // default setup: no named row running
      }
    } catch {
      ok = false;
    }
  }
  try {
    const raw = await AsyncStorage.getItem(cacheKey(bikeId));
    const list = raw ? (JSON.parse(raw) as BikeSetup[]) : [];
    for (const s of list) s.isRunning = s.id === setupId;
    await AsyncStorage.setItem(cacheKey(bikeId), JSON.stringify(list));
  } catch {
    // ignore
  }
  void logEvent("run_setup_switched", { bike_id: bikeId, setup_id: setupId, server_ok: ok });
  return ok;
}

/** Rename a NAMED setup (the default setup's name is derived, never stored).
 *  Server first (bike_setups own-rows update), cache mirror always. */
export async function renameSetup(bikeId: string, setupId: string, name: string): Promise<boolean> {
  const next = name.trim().slice(0, 30);
  if (!next) return false;
  let serverOk = false;
  try {
    const { error } = await supabase.from("bike_setups").update({ name: next }).eq("id", setupId);
    serverOk = !error;
  } catch {
    serverOk = false;
  }
  try {
    const raw = await AsyncStorage.getItem(cacheKey(bikeId));
    const list = raw ? (JSON.parse(raw) as BikeSetup[]) : [];
    await AsyncStorage.setItem(cacheKey(bikeId), JSON.stringify(list.map((s) => (s.id === setupId ? { ...s, name: next } : s))));
  } catch {
    // ignore
  }
  return serverOk;
}
