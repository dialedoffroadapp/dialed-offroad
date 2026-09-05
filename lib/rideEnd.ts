// lib/rideEnd.ts
// End ride (design/mockups/ride/10, plan 4.1 settle rule): the day's pending
// deltas become ONE manual version on the ridden setup's lineage; elapsed
// time (editable) is added to bikes.hours; the moto timeline and the dialed
// delta are derived. "Save as [track] baseline" creates or updates that
// track's named setup from the settled values.
import { primarySurface } from "./rideConditions";
import { readBikeExtras, saveBikeExtras } from "./bikeExtras";
import { createManualVersion, createNamedSetup, readNamedSetups } from "./bikeSetups";
import { computeMeter, type MeterInputs } from "./dialedMeter";
import { archiveSession, elapsedMs, enqueue, flushOutbox, loadStartingVersion, readHistory, rideEffective, settlePatch, settleSessionVersion, writeSession, type RideSession } from "./rideDay";
import { endRideActivity } from "./rideLiveActivity";
import type { SetupVersionRow } from "./setupVersions";
import { resolveEntitlement, trialNearEnd } from "./entitlement";
import { emitLifecycleEvent } from "./lifecycle";
import { setSubscriberAttributes } from "./purchases";
import { logEvent } from "./usage";
import { isUuid } from "./uuid";

export type SettleResult = {
  version: SetupVersionRow | null;
  changedCircuits: number;
  hoursAdded: number;
  serverOk: boolean;
  /** The settle is waiting in the outbox (offline at End ride). */
  queued: boolean;
};

export function hoursFromMs(ms: number): number {
  return Math.round((ms / 3600000) * 10) / 10;
}

/** Which circuits differ between the starting base and the effective values. */
export const settledDelta = settlePatch;

/** Settle + hours. Idempotent per session (endedAt set once). */
export async function settleRideDay(s: RideSession, rideHours: number): Promise<{ session: RideSession; result: SettleResult }> {
  const endedAt = s.endedAt ?? new Date().toISOString();
  const changed = Object.keys(settlePatch(s)).length;
  let version: SetupVersionRow | null = null;
  let serverOk = false;
  let queued = false;
  let settledVersionId: string | null = s.settledVersionId ?? null;
  if (changed > 0 && isUuid(s.bike.id) && !settledVersionId) {
    try {
      version = await settleSessionVersion(s);
      settledVersionId = version?.id ?? null;
      serverOk = !!version;
    } catch (e) {
      // Rule (a): never warn-and-continue. Queue the settle so the day's
      // version lands when the device is back online; End ride's "syncs
      // after the next update" line is true only on this path.
      console.warn("[ride] settle failed, queued for the outbox", e);
      await enqueue({ kind: "settle_version", localId: s.localId });
      queued = true;
    }
  }
  // Hours: elapsed (editable) onto the bike.
  try {
    const extras = await readBikeExtras(s.bike.id);
    await saveBikeExtras(s.bike.id, { hours: Math.round(((extras.hours ?? 0) + rideHours) * 10) / 10 });
  } catch {
    // local cache still updated inside saveBikeExtras
  }
  const session = await writeSession({ ...s, endedAt, hoursAdded: rideHours, settledVersionId, settlePending: queued });
  await enqueue({ kind: "ride_day_end", localId: s.localId });
  void flushOutbox(session);
  void endRideActivity();
  return { session, result: { version, changedCircuits: changed, hoursAdded: rideHours, serverOk, queued } };
}

/** Meter before/after the day (rides + outcomes move it; the settled manual
 *  version does not count as a refinement). */
export function meterDelta(before: MeterInputs, s: RideSession): { from: number; to: number } {
  const from = computeMeter(before).pct;
  const after: MeterInputs = {
    ...before,
    ridesLogged: before.ridesLogged + s.motos.length,
    outcomesRecorded: before.outcomesRecorded + s.motos.length,
  };
  return { from, to: computeMeter(after).pct };
}

/** "Save as OMC baseline": create the track's named setup from the settled
 *  values, or add a version to it if it already exists. */
export async function saveTrackBaseline(s: RideSession, settled: SetupVersionRow | null): Promise<{ created: boolean; setupId: string | null }> {
  const name = `${s.trackName ?? "Track"} baseline`;
  const existing = (await readNamedSetups(s.bike.id)).find((x) => x.name.toLowerCase() === name.toLowerCase());
  const from = settled ?? (await loadStartingVersion(s));
  if (existing?.id) {
    try {
      const eff = rideEffective(s);
      await createManualVersion({
        bikeId: s.bike.id,
        setupId: existing.id,
        from,
        parentId: from?.id ?? null,
        patch: { fork_comp_clicks: eff.fork_comp, fork_reb_clicks: eff.fork_reb, fork_air_bar: eff.fork_air, shock_lsc_clicks: eff.shock_lsc, shock_hsc_turns: eff.shock_hsc, shock_reb_clicks: eff.shock_reb, sag_mm: eff.shock_sag },
        terrain: primarySurface(s.conditions) ?? null,
        note: `${s.trackName} baseline updated after a ride day`,
      });
    } catch (e) {
      console.warn("[ride] baseline update failed", e);
    }
    void logEvent("baseline_saved", { track_id: s.trackId, setup_id: existing.id, created: false });
    return { created: false, setupId: existing.id };
  }
  const res = await createNamedSetup({ bikeId: s.bike.id, name, terrain: primarySurface(s.conditions) ?? null, from });
  void logEvent("baseline_saved", { track_id: s.trackId, setup_id: res.setup.id, created: true, server: res.serverOk });
  return { created: true, setupId: res.setup.id };
}

export async function finishRideDay(s: RideSession, extra: Record<string, unknown> = {}, meterPct: number | null = null): Promise<void> {
  const elapsed = elapsedMs(s);
  void logEvent("ride_day_ended", { elapsed_min: Math.round(elapsed / 60000), motos: s.motos.length, settled_delta_count: Object.keys(settledDelta(s)).length, ...extra });
  await archiveSession({ ...s, meterPct });
  // Conversion hooks (playbook Stage 3 / §5): the first logged ride day is
  // the qualified-trial signal for ad optimization; the ride-day leg of the
  // reverse trial advances here; the near-end email fires from the app.
  try {
    const history = await readHistory();
    const loggedDays = history.filter((h) => h.endedAt).length;
    if (loggedDays === 1) {
      void logEvent("qualified_trial", { ride_day_local_id: s.localId, motos: s.motos.length });
      void setSubscriberAttributes({ qualified_trial: "true", qualified_trial_at: new Date().toISOString() });
      void emitLifecycleEvent("first_ride_day_logged", { track: s.trackName, motos: s.motos.length });
    }
    const e = await resolveEntitlement();
    if (e.state === "trial_active" && trialNearEnd(e)) {
      void emitLifecycleEvent("trial_ending", { leg: "ride_days", rides_left: Math.max(0, e.trialRideDayLimit - e.trialRideDays), trial_ends_at: e.trialEndsAt });
    }
    if (e.justEnded) void emitLifecycleEvent("downgraded", { leg: "immediate", reason: e.trialEndReason });
  } catch {
    // never block the wrap
  }
}
