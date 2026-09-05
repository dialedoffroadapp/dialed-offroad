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
import { roundToStep } from "./format";
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
import { isUuid, newUuid } from "./uuid";
import { ratingFor, severityFor, type SymptomLevel } from "./rideSymptoms";
import { createManualVersion } from "./bikeSetups";
import { primarySurface } from "./rideConditions";

export const RIDE_OPEN_KEY = "ride_day_open_v1";
export const RIDE_DRAFT_KEY = "ride_day_draft_v1";
export const RIDE_LAST_KEY = "ride_day_last_v1";
export const RIDE_OUTBOX_KEY = "ride_day_outbox_v1";
export const RIDE_HISTORY_KEY = "ride_day_history_v1";

/** A forgotten session: idle this long → "Still riding?" on next open. */
export const RIDE_IDLE_PROMPT_MS = 12 * 60 * 60 * 1000;

export type Sentiment = "better" | "same" | "worse";

export type MotoSymptom = { id: string; qualifier: string | null; label: string; level?: SymptomLevel | null };

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
  /** Client-minted id of this moto's ride_feedback row (decision 3: one
   *  feedback row per moto so Home, the outcome loop and analytics see
   *  ride days as rides). Upserted by id, so retries never duplicate. */
  feedbackId?: string | null;
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
  /** Hours this ride day added to the bike (set at settle; season stats sum it). */
  hoursAdded?: number | null;
  /** The manual version the day settled into (set on success, locally or by the outbox). */
  settledVersionId?: string | null;
  /** The settle failed on device (offline) and a settle_version job is queued. */
  settlePending?: boolean;
  meterPct?: number | null;
  /** A quick refine (setup sheet "Refine after ride", or the retired debrief's
   *  redirect): Log → Adjust on the running setup with no track, clock,
   *  conditions or ride_days row. Its motos still write ride_feedback rows and
   *  its changes settle into ONE version when the rider taps Done. Never a
   *  ride-mode takeover. */
  quick?: boolean;
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

/** End ride's reader: the session in the open slot whether or not endedAt is
 *  set. A session closed by the "Still riding?" prompt has endedAt already;
 *  readOpenSession() hid it and End ride bounced to Home (audit item 7). */
export async function readSessionForEnd(): Promise<RideSession | null> {
  return readJson<RideSession>(RIDE_OPEN_KEY);
}

/** A session that ended but was never settled and archived (app killed on
 *  End ride, Android back, the forgotten-session prompt). Home and Start
 *  route it back to End ride instead of starting over it. */
export async function readEndedUnarchived(): Promise<RideSession | null> {
  const s = await readJson<RideSession>(RIDE_OPEN_KEY);
  return s && s.endedAt ? s : null;
}

/** Patch the open session by re-reading it first (the flush used to write a
 *  stale copy back over deltas appended meanwhile). Only the fields in the
 *  patch change; lastActiveAt is untouched. */
export async function patchOpenSession(localId: string, patch: (cur: RideSession) => RideSession): Promise<RideSession | null> {
  const cur = await readJson<RideSession>(RIDE_OPEN_KEY);
  if (!cur || cur.localId !== localId) return null;
  const next = patch(cur);
  await writeJson(RIDE_OPEN_KEY, next);
  return next;
}

export async function patchHistorySession(localId: string, patch: (cur: RideSession) => RideSession): Promise<void> {
  const history = (await readJson<RideSession[]>(RIDE_HISTORY_KEY)) ?? [];
  const i = history.findIndex((h) => h.localId === localId);
  if (i < 0) return;
  history[i] = patch(history[i]);
  await writeJson(RIDE_HISTORY_KEY, history);
}

/** The day's settled change set: which circuits differ between the starting
 *  base and the effective values (moved here from rideEnd so the outbox can
 *  settle without a circular import). */
export function settlePatch(s: RideSession): Partial<Record<keyof SettingsSnapshot, number>> {
  const eff = rideEffective(s);
  const out: Partial<Record<keyof SettingsSnapshot, number>> = {};
  for (const k of Object.keys(eff) as (keyof SettingsSnapshot)[]) {
    const a = s.base[k];
    const b = eff[k];
    if (typeof a === "number" && typeof b === "number" && a !== b) out[k] = Math.round((b - a) * 100) / 100;
  }
  return out;
}

export async function loadStartingVersion(s: RideSession): Promise<SetupVersionRow | null> {
  if (!s.startingVersionId) return null;
  try {
    const { data } = await supabase.from("setup_versions").select("*").eq("id", s.startingVersionId).maybeSingle();
    return (data as unknown as SetupVersionRow) ?? null;
  } catch {
    return null;
  }
}

/** Settle a session into ONE manual version (the settle rule). Used on
 *  device at End ride and by the outbox's settle_version job when the device
 *  was offline. Idempotent: a session with settledVersionId is left alone. */
export async function settleSessionVersion(s: RideSession): Promise<SetupVersionRow | null> {
  if (s.settledVersionId) return null;
  const patch = settlePatch(s);
  const changed = Object.keys(patch).length;
  if (changed === 0 || !isUuid(s.bike.id)) return null;
  const from = await loadStartingVersion(s);
  const eff = rideEffective(s);
  return createManualVersion({
    bikeId: s.bike.id,
    setupId: s.setupId && isUuid(s.setupId) ? s.setupId : null,
    from,
    parentId: s.startingVersionId,
    patch: {
      fork_comp_clicks: eff.fork_comp,
      fork_reb_clicks: eff.fork_reb,
      fork_air_bar: eff.fork_air,
      shock_lsc_clicks: eff.shock_lsc,
      shock_hsc_turns: eff.shock_hsc,
      shock_reb_clicks: eff.shock_reb,
      sag_mm: eff.shock_sag,
    },
    terrain: primarySurface(s.conditions) ?? from?.terrain ?? null,
    note: s.quick
      ? `Refined after a ride: ${changed} ${changed === 1 ? "change" : "changes"}`
      : `Ride day settled${s.trackName ? ` at ${s.trackName}` : ""}: ${s.motos.length} ${s.motos.length === 1 ? "moto" : "motos"}, ${changed} ${changed === 1 ? "change" : "changes"}`,
    ...(s.serverId ? { extra: { ride_day_id: s.serverId } } : {}),
  } as any);
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

/** A quick refine on a setup (no ride day): the open-session slot holds it so
 *  Log and Adjust work unchanged; nothing ride-day-shaped is queued. */
export async function startQuickRefineSession(p: {
  bike: RideBike;
  setupId: string | null;
  setupName: string | null;
  startingVersion: SetupVersionRow;
  hasAirFork: boolean;
  userId: string | null;
}): Promise<RideSession> {
  const now = new Date().toISOString();
  const s: RideSession = {
    localId: newLocalId("refine"),
    serverId: null,
    userId: p.userId,
    bike: p.bike,
    setupId: p.setupId,
    setupName: p.setupName ?? "Baseline",
    startingVersionId: p.startingVersion.id,
    startingVersionNumber: p.startingVersion.version_number,
    hasAirFork: p.hasAirFork,
    trackId: null,
    trackName: null,
    conditions: { ...EMPTY_CONDITIONS },
    startedAt: now,
    endedAt: null,
    base: snapshotFromVersion(p.startingVersion),
    pending: [],
    motos: [],
    suggestionShown: false,
    suggestionApplied: false,
    lastActiveAt: now,
    quick: true,
  };
  await writeSession(s);
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
    // Stored at the circuit's step precision (audit item 8): raw float
    // arithmetic put -0.1999999999999993 on the End ride timeline.
    const clamped = roundToStep(Math.min(max, Math.max(min, cur + d.delta)) - cur, d.circuit);
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
    feedbackId: newUuid(),
  };
  const next = await writeSession({ ...s, motos: [...s.motos, moto] });
  // A quick refine has no ride_days row, so no track_sessions row either.
  if (!s.quick) await enqueue({ kind: "moto_insert", localId: s.localId, motoLocalId: moto.localId });
  await enqueue({ kind: "moto_feedback", localId: s.localId, motoLocalId: moto.localId });
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
  /** One ride_feedback row per moto, upserted by its client-minted id. */
  | { kind: "moto_feedback"; localId: string; motoLocalId: string }
  /** The day's ONE manual version, when the device was offline at End ride. */
  | { kind: "settle_version"; localId: string }
  /** Stamp resulting_version_id on the day's ride_feedback rows once settled
   *  (the column-scoped update RLS allows exactly this). */
  | { kind: "feedback_link"; localId: string }
  | { kind: "ride_day_end"; localId: string };

/** Link every moto's ride_feedback row to the version the session settled
 *  into. Throws on the first failed row so the caller can queue a retry. */
export async function linkFeedbackToVersion(s: RideSession): Promise<number> {
  const vid = s.settledVersionId;
  if (!vid || !isUuid(vid)) return 0;
  let n = 0;
  for (const m of s.motos) {
    if (!m.feedbackId) continue;
    const { error } = await supabase.from("ride_feedback").update({ resulting_version_id: vid }).eq("id", m.feedbackId);
    if (error) throw error;
    n += 1;
  }
  return n;
}

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
/** Best-effort server mirror. The conflict target MUST name the whole unique
 *  index, (user_id, local_id) on both tables (20260904120000): Postgres infers
 *  an arbiter only from an exact column match, so "local_id" alone raised
 *  42P10 on every job and nothing ever synced (audit item 2).
 *  Pre-migration every call fails quietly and the Pre-migration every call fails quietly and the
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
    for (let k = 0; k < jobs.length; k += 1) {
      const job = jobs[k];
      const s = findSession(job.localId);
      if (!s) continue; // orphan: drop
      // Quick refines never own ride_days / track_sessions rows.
      if (s.quick && (job.kind === "ride_day_upsert" || job.kind === "ride_day_end" || job.kind === "moto_insert")) continue;
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
          const { data, error } = await supabase.from("ride_days").upsert(row, { onConflict: "user_id,local_id" }).select("id").single();
          if (error) throw error;
          const serverId = (data as any)?.id as string;
          s.serverId = serverId;
          if (open && open.localId === s.localId) await patchOpenSession(s.localId, (cur) => ({ ...cur, serverId }));
          else await patchHistorySession(s.localId, (cur) => ({ ...cur, serverId }));
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
              { onConflict: "user_id,local_id" }
            )
            .select("id")
            .single();
          if (error) throw error;
          const motoServerId = ((data as any)?.id as string | null) ?? null;
          moto.serverId = motoServerId;
          const stamp = (cur: RideSession): RideSession => ({ ...cur, motos: cur.motos.map((m) => (m.localId === moto.localId ? { ...m, serverId: motoServerId } : m)) });
          if (open && open.localId === s.localId) await patchOpenSession(s.localId, stamp);
          else await patchHistorySession(s.localId, stamp);
        } else if (job.kind === "settle_version") {
          if (s.settledVersionId) {
            done += 1;
            continue;
          }
          const version = await settleSessionVersion(s);
          const vid = version?.id ?? null;
          s.settledVersionId = vid;
          s.settlePending = false;
          const stamp = (cur: RideSession): RideSession => ({ ...cur, settledVersionId: vid, settlePending: false });
          // Link the feedback rows that exist (pre-change motos have no id).
          if (vid && isUuid(vid) && s.motos.some((m) => m.feedbackId)) jobs = [...jobs, { kind: "feedback_link", localId: s.localId }];
          if (open && open.localId === s.localId) await patchOpenSession(s.localId, stamp);
          else await patchHistorySession(s.localId, stamp);
        } else if (job.kind === "feedback_link") {
          await linkFeedbackToVersion(s);
        } else if (job.kind === "moto_feedback") {
          const moto = s.motos.find((m) => m.localId === job.motoLocalId);
          // No feedback id (pre-change moto) or no real version to key on: nothing to write, drop the job.
          if (!moto || !moto.feedbackId || !s.startingVersionId || !isUuid(s.startingVersionId)) continue;
          const { error } = await supabase.from("ride_feedback").upsert(
            {
              id: moto.feedbackId,
              user_id: userId,
              setup_version_id: s.startingVersionId,
              overall_rating: ratingFor(moto.sentiment),
              symptoms: moto.symptoms.map((x) => ({ id: x.id, severity: severityFor(moto.sentiment, x.level), ...(x.qualifier ? { where: x.qualifier } : {}) })),
              free_text: moto.note,
              created_at: moto.loggedAt,
            },
            { onConflict: "id" }
          );
          if (error) throw error;
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
