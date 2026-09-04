// lib/currentSetup.ts
// Offline-first store for the Current Setup screen (ride-day plan 4.2).
// The running setup is cached per bike in AsyncStorage; +/- adjustments are
// appended to a pending-delta log immediately (no network, no confirm) and the
// screen always renders base + pending. Sync of pending deltas to a
// setup_versions row (source: "manual") is a later slice — the queue shape is
// final, the uploader is not wired yet.
//
// Storage backend note (CC-Q 6 open): AsyncStorage on purpose for now — it is
// already in every shipped binary, so this screen is testable on the existing
// dev client. The API below is storage-agnostic; swapping MMKV/expo-sqlite in
// later touches only the four *Raw helpers.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getVersionHistory,
  settingsFromRecommended,
  type SettingsSnapshot,
  type SetupVersionRow,
} from "./setupVersions";

export type CircuitKey = keyof SettingsSnapshot;

export type PendingAdjust = {
  circuit: CircuitKey;
  delta: number;
  at: string; // ISO timestamp of the tap
};

export type CurrentSetupState = {
  bikeId: string;
  /** setup_versions row the base came from; null when nothing synced yet. */
  baseVersionId: string | null;
  baseVersionNumber: number | null;
  base: SettingsSnapshot;
  pending: PendingAdjust[];
  /** Fork type for the air-pressure row decision (see resolveShowsAir). */
  hasAirFork: boolean;
  fetchedAt: string | null;
};

/** Per-circuit step size and clamp range for the +/- adjusters. Clicks move by
 *  1, HSC by a quarter turn (hardware granularity), air by 0.1 bar, sag by
 *  1 mm. Ranges are wide sanity bounds, not model guardrails — the screen must
 *  work offline where guardrails may be unknown. */
export const CIRCUIT_STEPS: Record<CircuitKey, { step: number; min: number; max: number; decimals: number }> = {
  fork_comp: { step: 1, min: 0, max: 40, decimals: 0 },
  fork_reb: { step: 1, min: 0, max: 40, decimals: 0 },
  fork_air: { step: 0.1, min: 5, max: 15, decimals: 1 },
  shock_lsc: { step: 1, min: 0, max: 40, decimals: 0 },
  shock_hsc: { step: 0.25, min: 0, max: 4, decimals: 2 },
  shock_reb: { step: 1, min: 0, max: 40, decimals: 0 },
  shock_sag: { step: 1, min: 80, max: 130, decimals: 0 },
};

const EMPTY_SNAPSHOT: SettingsSnapshot = {
  fork_comp: null,
  fork_reb: null,
  fork_air: null,
  shock_lsc: null,
  shock_hsc: null,
  shock_reb: null,
  shock_sag: null,
};

const keyFor = (bikeId: string) => `current_setup_v1:${bikeId}`;

async function readRaw(bikeId: string): Promise<CurrentSetupState | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(bikeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.base) return null;
    return parsed as CurrentSetupState;
  } catch {
    return null; // a corrupt cache reads as empty, never throws into the screen
  }
}

async function writeRaw(state: CurrentSetupState): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(state.bikeId), JSON.stringify(state));
  } catch {
    // Cache write failures must never surface; the in-memory state is live.
  }
}

/** Snapshot from a version row's typed columns (authoritative over jsonb). */
export function snapshotFromVersion(v: SetupVersionRow): SettingsSnapshot {
  const typed: SettingsSnapshot = {
    fork_comp: v.fork_comp_clicks,
    fork_reb: v.fork_reb_clicks,
    fork_air: v.fork_air_bar,
    shock_lsc: v.shock_lsc_clicks,
    shock_hsc: v.shock_hsc_turns,
    shock_reb: v.shock_reb_clicks,
    shock_sag: v.sag_mm,
  };
  // Older rows may have sparse typed columns; fill gaps from applied/recommended.
  const fallback =
    v.applied_settings ?? settingsFromRecommended(v.recommended_settings);
  if (!fallback) return typed;
  const out = { ...typed };
  for (const k of Object.keys(out) as CircuitKey[]) {
    if (out[k] === null && typeof fallback[k] === "number") out[k] = fallback[k];
  }
  return out;
}

/** base + pending, clamped per circuit. This is what the screen displays. */
export function effectiveSettings(state: CurrentSetupState): SettingsSnapshot {
  const out = { ...state.base };
  for (const p of state.pending) {
    const cur = out[p.circuit];
    if (typeof cur !== "number") continue; // never invent a value from a delta
    const { min, max } = CIRCUIT_STEPS[p.circuit];
    out[p.circuit] = clampRound(cur + p.delta, min, max, CIRCUIT_STEPS[p.circuit].decimals);
  }
  return out;
}

function clampRound(n: number, min: number, max: number, decimals: number): number {
  const clamped = Math.min(max, Math.max(min, n));
  const f = Math.pow(10, decimals);
  return Math.round(clamped * f) / f;
}

/** Cached state immediately (null when this bike has never been cached). */
export async function loadCachedSetup(
  bikeId: string
): Promise<CurrentSetupState | null> {
  return readRaw(bikeId);
}

/**
 * Refresh the base from the newest setup version. Network errors return the
 * cache untouched — offline is a normal state here, not an error.
 * hasAirFork is resolved by the caller (screen) because it needs model context.
 */
export async function refreshSetupFromServer(
  bikeId: string,
  hasAirFork: boolean
): Promise<CurrentSetupState | null> {
  let newest: SetupVersionRow | undefined;
  try {
    newest = (await getVersionHistory(bikeId))[0];
  } catch {
    return readRaw(bikeId);
  }
  const cached = await readRaw(bikeId);
  if (!newest) return cached;

  // A new server version supersedes the cached base. Pending deltas made
  // against the OLD base are kept only when the base is unchanged — a new
  // version means a tune/refine/restore happened and the pending log is stale.
  const state: CurrentSetupState = {
    bikeId,
    baseVersionId: newest.id,
    baseVersionNumber: newest.version_number,
    base: snapshotFromVersion(newest),
    pending:
      cached && cached.baseVersionId === newest.id ? cached.pending : [],
    hasAirFork,
    fetchedAt: new Date().toISOString(),
  };
  await writeRaw(state);
  return state;
}

/** Log one +/- tap. Returns the new state (also persisted). */
export async function adjust(
  state: CurrentSetupState,
  circuit: CircuitKey,
  direction: 1 | -1
): Promise<CurrentSetupState> {
  const { step, min, max, decimals } = CIRCUIT_STEPS[circuit];
  const current = effectiveSettings(state)[circuit];
  if (typeof current !== "number") return state; // no base value to adjust
  const target = clampRound(current + direction * step, min, max, decimals);
  if (target === current) return state; // clamped: don't log a no-op delta
  const next: CurrentSetupState = {
    ...state,
    pending: [
      ...state.pending,
      { circuit, delta: direction * step, at: new Date().toISOString() },
    ],
  };
  await writeRaw(next);
  return next;
}

/** Remove the most recent pending tap ("Undo last"). */
export async function undoLast(
  state: CurrentSetupState
): Promise<CurrentSetupState> {
  if (!state.pending.length) return state;
  const next = { ...state, pending: state.pending.slice(0, -1) };
  await writeRaw(next);
  return next;
}

/**
 * Air-row visibility (RIVER-Q 7): verified bike_models.has_air_fork is
 * authoritative when a model is matched. Unmatched bikes fall back to the
 * running setup itself — if the version has a fork air value, the bike is
 * de facto running an air fork and hiding the row would hide a real setting.
 */
export function resolveShowsAir(
  modelHasAirFork: boolean | null | undefined,
  base: SettingsSnapshot
): boolean {
  if (typeof modelHasAirFork === "boolean") return modelHasAirFork;
  return typeof base.fork_air === "number";
}
