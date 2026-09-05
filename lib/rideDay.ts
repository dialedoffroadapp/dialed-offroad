// lib/rideDay.ts
// The ride day: a persistent on-disk session (design/mockups/ride 05-10 and
// PROMPT §5) plus an offline-first outbox. Everything at the track reads from
// AsyncStorage and writes to a queue; the server mirror (ride_days,
// track_sessions, migration 20260904120000, STAGED) is opportunistic and
// never blocks. Survives app kill and reboot: the open session is restored
// on relaunch by whoever calls readOpenSession().
//
// Pending adjuster deltas reuse lib/currentSetup.ts's shapes (append-only
// delta log over a base snapshot); End ride settles them into ONE manual
// version on the ridden setup's lineage (plan 4.1 settle rule).
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CIRCUIT_STEPS,
  effectiveSettings,
  snapshotFromVersion,
  type CircuitKey,
  type PendingAdjust,
} from "./currentSetup";
import { EMPTY_CONDITIONS, type RideConditions } from "./rideConditions";
import type { SettingsSnapshot, SetupVersionRow } from "./setupVersions";
import { supabase } from "./supabase";
import { logEvent } from "./usage";
import { isUuid } from "./uuid";

export const RIDE_OPEN_KEY = "ride_day_open_v1";
export const RIDE_DRAFT_KEY = "ride_day_draft_v1";
export const RIDE_LAST_KEY = "ride_day_last_v1";
export const RIDE_OUTBOX_KEY = "ride_day_outbox_v1";
export const RIDE_HISTORY_KEY = "ride_day_history_v1";

/** A forgotten session: idle this long → "Still riding?" on next open. */
export const RIDE_IDLE_PROMPT_MS = 12 * 60 * 60 * 1000;

export type Sentiment = "better" | "same" | "worse";

export type MotoSymptom = { id: string; qualifier: string | null; label: string };

export type MotoLog = {
  seq: number; // moto number, 1-based
  loggedAt: string;
  sentiment: Sentiment;
  symptoms: MotoSymptom[];
  note: string | null;
  /** Minutes since the previous log (or the clock start), editable at log time. */
  durationMin: number | null;
  /** Optional lap count the rider typed. */
  laps: number | null;
  /** Effective values in force when the moto was ridden. */
  values: SettingsSnapshot;
  /** Local id until the track_sessions row lands. */
  localId: string;
  serverId: string | null;
};

export type PendingKind = "conditions" | "retune" | "adjust" | "manual";

export type RidePending = PendingAdjust & {
  kind: PendingKind;
  reason: string | null;
  /** Moto the change was made after (0 = before moto 1). */
  afterMoto: number;
};

export type RideBike = { id: string; make: string | null; model: string | null; year: number | null; nickname: string | null; model_id: string | null };

export type RideDraft = {
  bike: RideBike | null;
  setupId: string | null;
  setupName: string | null;
  startingVersion: SetupVersionRow | null;
  hasAirFork: boolean;
  trackId: string | null;
  trackName: string | null;
  conditions: RideConditions;
  updatedAt: string;
};

export type RideSession = {
  localId: string;
  serverId: string | null;
  userId: string | null;
  bike: RideBike;
  setupId: string | null;
  setupName: string;
  startingVersionId: string | null;
  startingVersionNumber: number | null;
  hasAirFork: boolean;
  trackId: string | null;
  trackName: string | null;
  conditions: RideConditions;
  startedAt: string;
  endedAt: string | null;
  /** Values the running setup had at start (before the conditions tweaks). */
  base: SettingsSnapshot;
  pending: RidePending[];
  motos: MotoLog[];
  /** The conditions suggestion (Today's setup) was shown / applied. */
  suggestionShown: boolean;
  suggestionApplied: boolean;
  lastActiveAt: string;
  /** Meter % after End ride (meter-stall detection reads the last two). */
  meterPct?: number | null;
};

export function newLocalId(prefix = "ride"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

export function emptyDraft(): RideDraft {
  return {
    bike: null,
    setupId: null,
    setupName: null,
    startingVersion: null,
    hasAirFork: false,
    trackId: null,
    trackName: null,
    conditions: { ...EMPTY_CONDITIONS },
    updatedAt: new Date().toISOString(),
  };
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
async function writeJson(key: string, v: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(v));
  } catch {
    // never surface
  }
}

/* ------------------------------- draft ---------------------------------- */

export async function readDraft(): Promise<RideDraft> {
  return (await readJson<RideDraft>(RIDE_DRAFT_KEY)) ?? emptyDraft();
}
export async function writeDraft(d: RideDraft): Promise<RideDraft> {
  const next = { ...d, updatedAt: new Date().toISOString() };
  await writeJson(RIDE_DRAFT_KEY, next);
  return next;
}
export async function clearDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RIDE_DRAFT_KEY);
  } catch {
    // ignore
  }
}

/** Last ride's picks (defaults for the next Start Riding). */
export type LastRide = { bikeId: string; setupId: string | null; setupName: string | null; trackId: string | null; trackName: string | null; conditions: RideConditions };
export async function readLastRide(): Promise<LastRide | null> {
  return readJson<LastRide>(RIDE_LAST_KEY);
}

/* ------------------------------ session --------------------------------- */

export async function readOpenSession(): Promise<RideSession | null> {
  const s = await readJson<RideSession>(RIDE_OPEN_KEY);
  return s && !s.endedAt ? s : null;
}

export async function writeSession(s: RideSession): Promise<RideSession> {
  const next = { ...s, lastActiveAt: new Date().toISOString() };
  await writeJson(RIDE_OPEN_KEY, next);
  return next;
}

export async function clearOpenSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RIDE_OPEN_KEY);
  } catch {
    // ignore
  }
}

/** Effective values now = base + every pending delta, clamped per circuit. */
export function rideEffective(s: RideSession): SettingsSnapshot {
  return effectiveSettings({
    bikeId: s.bike.id,
    baseVersionId: s.startingVersionId,
    baseVersionNumber: s.startingVersionNumber,
    base: s.base,
    pending: s.pending,
    hasAirFork: s.hasAirFork,
    fetchedAt: null,
  });
}

export function elapsedMs(s: RideSession, now = Date.now()): number {
  const end = s.endedAt ? Date.parse(s.endedAt) : now;
  return Math.max(0, end - Date.parse(s.startedAt));
}

/** "1:47" (h:mm) for the ride-mode clock and end-ride stat. */
export function formatElapsed(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function nextMotoNumber(s: RideSession): number {
  return s.motos.length + 1;
}

/** Start a session from a completed draft. */
export async function startSession(d: RideDraft, userId: string | null): Promise<RideSession> {
  if (!d.bike || !d.startingVersion) throw new Error("Pick a bike with a setup first.");
  const now = new Date().toISOString();
  const s: RideSession = {
    localId: newLocalId(),
    serverId: null,
    userId,
    bike: d.bike,
    setupId: d.setupId,
    setupName: d.setupName ?? "Baseline",
    startingVersionId: d.startingVersion.id,
    startingVersionNumber: d.startingVersion.version_number,
    hasAirFork: d.hasAirFork,
    trackId: d.trackId,
    trackName: d.trackName,
    conditions: d.conditions,
    startedAt: now,
    endedAt: null,
    base: snapshotFromVersion(d.startingVersion),
    pending: [],
    motos: [],
    suggestionShown: false,
    suggestionApplied: false,
    lastActiveAt: now,
  };
  await writeSession(s);
  await writeJson(RIDE_LAST_KEY, {
    bikeId: d.bike.id,
    setupId: d.setupId,
    setupName: d.setupName,
    trackId: d.trackId,
    trackName: d.trackName,
    conditions: d.conditions,
  } satisfies LastRide);
  await clearDraft();
  await enqueue({ kind: "ride_day_upsert", localId: s.localId });
  void flushOutbox();
  return s;
}

/** Append a set of deltas (conditions tweak, retune, or a confirmed adjust). */
export async function applyDeltas(
  s: RideSession,
  deltas: { circuit: CircuitKey; delta: number; reason?: string | null }[],
  kind: PendingKind
): Promise<RideSession> {
  const at = new Date().toISOString();
  const eff = rideEffective(s);
  const pending: RidePending[] = [];
  for (const d of deltas) {
    const cur = eff[d.circuit];
    if (typeof cur !== "number" || !d.delta) continue;
    const { min, max } = CIRCUIT_STEPS[d.circuit];
    const clamped = Math.min(max, Math.max(min, cur + d.delta)) - cur;
    if (!clamped) continue;
    pending.push({ circuit: d.circuit, delta: clamped, at, kind, reason: d.reason ?? null, afterMoto: s.motos.length });
  }
  if (!pending.length) return s;
  return writeSession({ ...s, pending: [...s.pending, ...pending] });
}

/** Set an adjuster to an ABSOLUTE value (Adjust's "Done, turned it" records
 *  the new position; "Different amount" too). */
export async function setAbsolute(
  s: RideSession,
  circuit: CircuitKey,
  value: number,
  kind: PendingKind,
  reason: string | null
): Promise<RideSession> {
  const cur = rideEffective(s)[circuit];
  if (typeof cur !== "number") return s;
  return applyDeltas(s, [{ circuit, delta: value - cur, reason }], kind);
}

/** Minutes from the last log (or the clock start) to now: the moto's duration
 *  by timestamps, shown as "Moto N · 18 min" and editable before saving. */
export function motoDurationMin(s: RideSession, now = Date.now()): number {
  const last = s.motos[s.motos.length - 1];
  const from = Date.parse(last?.loggedAt ?? s.startedAt);
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.round((now - from) / 60000));
}

export async function logMoto(
  s: RideSession,
  entry: { sentiment: Sentiment; symptoms: MotoSymptom[]; note: string | null; durationMin?: number | null; laps?: number | null }
): Promise<RideSession> {
  const moto: MotoLog = {
    seq: nextMotoNumber(s),
    loggedAt: new Date().toISOString(),
    sentiment: entry.sentiment,
    symptoms: entry.symptoms,
    note: entry.note,
    durationMin: typeof entry.durationMin === "number" ? entry.durationMin : motoDurationMin(s),
    laps: typeof entry.laps === "number" && entry.laps > 0 ? Math.round(entry.laps) : null,
    values: rideEffective(s),
    localId: newLocalId("moto"),
    serverId: null,
  };
  const next = await writeSession({ ...s, motos: [...s.motos, moto] });
  await enqueue({ kind: "moto_insert", localId: s.localId, motoLocalId: moto.localId });
  void flushOutbox();
  return next;
}

/* ------------------------------- outbox --------------------------------- */
// Calm sync: every job is idempotent against the local ids it carries; a
// failed job stays queued and the UI only ever says "saved on phone" /
// "synced". Nothing blocks on connectivity.

export type OutboxJob =
  | { kind: "ride_day_upsert"; localId: string }
  | { kind: "moto_insert"; localId: string; motoLocalId: string }
  | { kind: "ride_day_end"; localId: string };

export async function readOutbox(): Promise<OutboxJob[]> {
  return (await readJson<OutboxJob[]>(RIDE_OUTBOX_KEY)) ?? [];
}
async function writeOutbox(jobs: OutboxJob[]): Promise<void> {
  await writeJson(RIDE_OUTBOX_KEY, jobs);
}
export async function enqueue(job: OutboxJob): Promise<void> {
  const jobs = await readOutbox();
  jobs.push(job);
  await writeOutbox(jobs);
}

export type SyncState = "saved" | "syncing" | "synced";

/** True when nothing is waiting: the ride-mode status line shows "synced". */
export async function outboxEmpty(): Promise<boolean> {
  return (await readOutbox()).length === 0;
}

let flushing = false;
/** Best-effort server mirror. Pre-migration every call fails quietly and the
 *  jobs stay queued for a later build. */
export async function flushOutbox(sessionOverride?: RideSession | null): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let done = 0;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return 0;
    let jobs = await readOutbox();
    const open = sessionOverride ?? (await readJson<RideSession>(RIDE_OPEN_KEY));
    const history = (await readJson<RideSession[]>(RIDE_HISTORY_KEY)) ?? [];
    const findSession = (localId: string) =>
      open?.localId === localId ? open : history.find((h) => h.localId === localId) ?? null;
    const remaining: OutboxJob[] = [];
    for (const job of jobs) {
      const s = findSession(job.localId);
      if (!s) continue; // orphan: drop
      try {
        if (job.kind === "ride_day_upsert" || job.kind === "ride_day_end") {
          const row: Record<string, unknown> = {
            user_id: userId,
            bike_id: isUuid(s.bike.id) ? s.bike.id : null,
            setup_id: s.setupId && isUuid(s.setupId) ? s.setupId : null,
            track_id: s.trackId && isUuid(s.trackId) ? s.trackId : null,
            track_name_raw: s.trackName,
            rode_on: s.startedAt.slice(0, 10),
            started_at: s.startedAt,
            ended_at: s.endedAt,
            conditions: s.conditions,
            starting_version_id: s.startingVersionId,
            local_id: s.localId,
          };
          const { data, error } = await supabase.from("ride_days").upsert(row, { onConflict: "local_id" }).select("id").single();
          if (error) throw error;
          const serverId = (data as any)?.id as string;
          s.serverId = serverId;
          if (open && open.localId === s.localId) await writeJson(RIDE_OPEN_KEY, { ...open, serverId });
        } else if (job.kind === "moto_insert") {
          if (!s.serverId) throw new Error("ride day not synced yet");
          const moto = s.motos.find((m) => m.localId === job.motoLocalId);
          if (!moto) continue;
          const { data, error } = await supabase
            .from("track_sessions")
            .upsert(
              {
                user_id: userId,
                ride_day_id: s.serverId,
                bike_id: isUuid(s.bike.id) ? s.bike.id : null,
                setup_version_id: s.startingVersionId,
                moto_number: moto.seq,
                sentiment: moto.sentiment,
                symptoms: moto.symptoms.map((x) => ({ id: x.id, qualifier: x.qualifier })),
                effective_values: moto.values,
                note: moto.note,
                duration_min: moto.durationMin ?? null,
                laps: moto.laps ?? null,
                logged_at: moto.loggedAt,
                local_id: moto.localId,
              },
              { onConflict: "local_id" }
            )
            .select("id")
            .single();
          if (error) throw error;
          moto.serverId = (data as any)?.id ?? null;
          if (open && open.localId === s.localId) await writeJson(RIDE_OPEN_KEY, open);
        }
        done += 1;
      } catch {
        remaining.push(job);
      }
    }
    await writeOutbox(remaining);
    if (done) void logEvent("sync_queue_flushed", { jobs: done, remaining: remaining.length });
    return done;
  } catch {
    return done;
  } finally {
    flushing = false;
  }
}

/* ------------------------------ history --------------------------------- */

export async function readHistory(): Promise<RideSession[]> {
  return (await readJson<RideSession[]>(RIDE_HISTORY_KEY)) ?? [];
}

/** Move the open session into local history (called by End ride after
 *  settling). Keeps the last 50. */
export async function archiveSession(s: RideSession): Promise<void> {
  const history = await readHistory();
  const next = [s, ...history.filter((h) => h.localId !== s.localId)].slice(0, 50);
  await writeJson(RIDE_HISTORY_KEY, next);
  await clearOpenSession();
}
