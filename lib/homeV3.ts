// lib/homeV3.ts
// Data layer for the v3 Home tab: one hook, one view model, everything the
// mockups show derived from rows the app actually has. Every v3-only read
// (bike extras, goal, next ride) is fail-open so the screen works before the
// staged migration lands and offline (device cache).
import { readHistory } from "./rideDay";
import { readNamedSetups, readVersionSetupMap, runningSetup, setupsForBike } from "./bikeSetups";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { EMPTY_EXTRAS, readBikeExtras, type BikeExtras } from "./bikeExtras";
import { publicUrlForPath, readCachedBikePhotoUrl } from "./bikePhoto";
import { computeMeter, type MeterCategory, type MeterInputs } from "./dialedMeter";
import { seasonYear, startOfDay } from "./homeCopy";
import { isoToLocalDate, readNextRideDate } from "./nextRide";
import { isEntitled, resolveEntitlement } from "./entitlement";
import { deriveIsPro } from "./proUtils";
import { hasPurchasedThisSession } from "./purchases";
import { suggestionFor, type RideSuggestion } from "./rideRules";
import { readSeasonGoal, type SeasonGoal } from "./seasonGoals";
import { buildStory, isSymptom, lastRideRecap, type LastRide, type StoryEntry } from "./setupStory";
import { getHistoryWithFeedback, type RideFeedbackRow, type VersionWithFeedback } from "./setupVersions";
import { supabase } from "./supabase";

export type HomeBike = {
  id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  nickname: string | null;
  model_id: string | null;
  is_primary: boolean;
};

export type SeasonStats = { rideDays: number; ridesLogged: number; hours: number | null };

export type HomeV3Data = {
  userId: string | null;
  displayName: string | null;
  isPro: boolean;
  bike: HomeBike | null;
  bikeCount: number;
  extras: BikeExtras;
  photoUrl: string | null;
  versions: VersionWithFeedback[];
  running: VersionWithFeedback | null;
  /** Name of the running setup ("Baseline", "Dunes setup"), from bike_setups. */
  runningSetupName: string | null;
  feedback: RideFeedbackRow[];
  meterInputs: MeterInputs;
  meterPct: number;
  meterCategories: MeterCategory[];
  story: StoryEntry[];
  lastRide: LastRide | null;
  suggestion: RideSuggestion | null;
  seasonStats: SeasonStats;
  goal: SeasonGoal | null;
  nextRideDate: Date | null;
  /** No ride logged yet on this bike (the mockups' day-one state). */
  dayOne: boolean;
  loadedAt: number;
};

function symptomWhere(fb: RideFeedbackRow | undefined, symptom: string): string | null {
  if (!fb) return null;
  for (const e of fb.symptoms ?? []) {
    if (isSymptom(e) && (e as any).id === symptom) return ((e as any).where as string) ?? null;
  }
  return null;
}

export async function loadHomeV3(now = new Date()): Promise<HomeV3Data> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id ?? null;
  const year = seasonYear(now);
  const base: HomeV3Data = {
    userId,
    displayName: null,
    isPro: false,
    bike: null,
    bikeCount: 0,
    extras: EMPTY_EXTRAS,
    photoUrl: null,
    versions: [],
    running: null,
    runningSetupName: null,
    feedback: [],
    meterInputs: { hasBaseline: false, sagMeasured: false, ridesLogged: 0, refinements: 0, outcomesRecorded: 0 },
    meterPct: 0,
    meterCategories: computeMeter({ hasBaseline: false, sagMeasured: false, ridesLogged: 0, refinements: 0, outcomesRecorded: 0 }).categories,
    story: [],
    lastRide: null,
    suggestion: null,
    seasonStats: { rideDays: 0, ridesLogged: 0, hours: null },
    goal: null,
    nextRideDate: null,
    dayOne: true,
    loadedAt: Date.now(),
  };
  if (!userId) return base;

  // Profile: Pro + name.
  try {
    const { data: prof } = await supabase.from("profiles").select("display_name, is_pro, pro_until").eq("user_id", userId).maybeSingle();
    base.displayName = (prof as any)?.display_name ?? null;
    base.isPro = deriveIsPro(prof as any) || hasPurchasedThisSession();
  } catch {
    base.isPro = hasPurchasedThisSession();
  }
  // Reverse trial: trial_active is entitled (server-resolved, cached).
  if (!base.isPro) base.isPro = isEntitled(await resolveEntitlement());

  // Bikes: primary first, else oldest.
  let bikes: HomeBike[] = [];
  try {
    const { data } = await supabase
      .from("bikes")
      .select("id, make, model, year, nickname, model_id, is_primary")
      .eq("user_id", userId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });
    bikes = ((data ?? []) as any[]).map((b) => ({
      id: b.id,
      make: b.make ?? null,
      model: b.model ?? null,
      year: b.year ?? null,
      nickname: b.nickname ?? null,
      model_id: b.model_id ?? null,
      is_primary: !!b.is_primary,
    }));
  } catch {
    bikes = [];
  }
  base.bikeCount = bikes.length;
  const bike = bikes[0] ?? null;
  base.bike = bike;

  // Goal + next ride are per rider (not per bike).
  const [goal, nextIso] = await Promise.all([readSeasonGoal(userId, year), readNextRideDate(userId)]);
  base.goal = goal;
  base.nextRideDate = isoToLocalDate(nextIso);

  if (!bike) return base;

  const [versions, extras, cachedPhoto, sessionsRes] = await Promise.all([
    (async (): Promise<VersionWithFeedback[]> => {
      try {
        return await getHistoryWithFeedback(bike.id);
      } catch {
        return [];
      }
    })(),
    readBikeExtras(bike.id),
    readCachedBikePhotoUrl(bike.id),
    (async (): Promise<{ id: string; rode_on: string; sag_measured: boolean | null }[]> => {
      try {
        const { data } = await supabase.from("sessions").select("id, rode_on, sag_measured").eq("bike_id", bike.id);
        return (data ?? []) as { id: string; rode_on: string; sag_measured: boolean | null }[];
      } catch {
        return [];
      }
    })(),
  ]);
  base.versions = versions;
  // Running = the is_running setup's newest version, exactly as Garage, the
  // sheet and ride start define it (audit item 6); versions[0] was the newest
  // across ALL setups and lost to a higher-numbered default once a named
  // setup was running.
  const [named, versionSetup] = await Promise.all([readNamedSetups(bike.id), readVersionSetupMap(bike.id)]);
  const setups = setupsForBike(bike.id, named, versions, versionSetup);
  const runningS = runningSetup(setups);
  base.running = runningS?.running ?? versions[0] ?? null;
  base.runningSetupName = runningS?.name ?? null;
  base.extras = extras;
  base.photoUrl = publicUrlForPath(extras.photoPath) ?? cachedPhoto;

  // Every ride logged on this bike (a ride = a ride_feedback row).
  let feedback: RideFeedbackRow[] = [];
  if (versions.length) {
    try {
      const { data } = await supabase
        .from("ride_feedback")
        .select("*")
        .in("setup_version_id", versions.map((v) => v.id))
        .order("created_at", { ascending: false });
      feedback = (data ?? []) as unknown as RideFeedbackRow[];
    } catch {
      feedback = [];
    }
  }
  base.feedback = feedback;

  const versionsById = new Map<string, VersionWithFeedback>(versions.map((v) => [v.id, v]));
  const feedbackByRidden = new Map<string, RideFeedbackRow>();
  for (const f of [...feedback].reverse()) feedbackByRidden.set(f.setup_version_id, f); // newest wins

  const sagMeasured =
    versions.some((v) => v.sag_measured) || sessionsRes.some((s) => s.sag_measured === true);
  // Ride days count as rides (decision 3): the archived ride days on this
  // phone plus the server feedback rows (one per moto, upserted by id), merged
  // without double counting.
  const history = (await readHistory()).filter((h) => h.bike?.id === bike.id);
  const seasonStartMs = startOfDay(new Date(year, 0, 1)).getTime();
  const rideStats = homeRideStats(feedback, history, seasonStartMs);
  const inputs: MeterInputs = {
    hasBaseline: versions.length > 0,
    sagMeasured,
    ridesLogged: rideStats.ridesAllTime,
    refinements: versions.filter((v) => v.source === "refinement").length,
    outcomesRecorded: feedback.filter((f) => !!f.outcome).length,
  };
  const meter = computeMeter(inputs);
  base.meterInputs = inputs;
  base.meterPct = meter.pct;
  base.meterCategories = meter.categories;

  base.story = buildStory(versions, feedbackByRidden);
  base.lastRide = lastRideRecap(feedback, versionsById);
  base.dayOne = rideStats.ridesAllTime === 0;

  if (base.lastRide?.unaddressedSymptom) {
    const sym = base.lastRide.unaddressedSymptom;
    base.suggestion = suggestionFor(sym, symptomWhere(feedback[0], sym));
  }

  // This season: rides and ride days from feedback + local history; engine
  // hours are the ride days' hours THIS season, not the bike's lifetime meter
  // (audit finding 27).
  base.seasonStats = { rideDays: rideStats.rideDaysSeason, ridesLogged: rideStats.ridesSeason, hours: rideStats.hoursSeason };

  base.loadedAt = Date.now();
  return base;
}

export function useHomeV3() {
  const [data, setData] = useState<HomeV3Data | null>(null);
  const [loading, setLoading] = useState(true);
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    inflight.current = (async () => {
      try {
        const next = await loadHomeV3();
        setData(next);
      } catch (e) {
        console.warn("[home-v3] load failed", e);
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return undefined;
    }, [refresh])
  );

  /** Optimistic local patch (goal, next ride, extras) without a refetch. */
  const patch = useCallback((p: Partial<HomeV3Data>) => {
    setData((d) => (d ? { ...d, ...p } : d));
  }, []);

  return { data, loading, refresh, patch };
}

/** Pure: merge server feedback rows (one per debrief or per moto, keyed by
 *  id) with archived ride days on this phone. A moto whose feedback row has
 *  already synced is counted once (its feedbackId is the row id). */
export function homeRideStats(
  feedback: { id: string; created_at: string }[],
  history: { startedAt: string; motos: { feedbackId?: string | null; loggedAt: string }[]; hoursAdded?: number | null }[],
  seasonStartMs: number
): { ridesAllTime: number; ridesSeason: number; rideDaysSeason: number; hoursSeason: number | null } {
  const synced = new Set(feedback.map((f) => f.id));
  const unsynced = history.flatMap((h) => h.motos.filter((m) => !m.feedbackId || !synced.has(m.feedbackId)));
  const ridesAllTime = feedback.length + unsynced.length;
  const inSeasonFeedback = feedback.filter((f) => Date.parse(f.created_at) >= seasonStartMs);
  const inSeasonUnsynced = unsynced.filter((m) => Date.parse(m.loggedAt) >= seasonStartMs);
  const days = new Set<number>();
  for (const f of inSeasonFeedback) days.add(startOfDay(new Date(f.created_at)).getTime());
  for (const h of history) if (Date.parse(h.startedAt) >= seasonStartMs) days.add(startOfDay(new Date(h.startedAt)).getTime());
  const hours = history.filter((h) => Date.parse(h.startedAt) >= seasonStartMs).reduce((acc, h) => acc + (typeof h.hoursAdded === "number" ? h.hoursAdded : 0), 0);
  return {
    ridesAllTime,
    ridesSeason: inSeasonFeedback.length + inSeasonUnsynced.length,
    rideDaysSeason: days.size,
    hoursSeason: history.length ? Math.round(hours * 10) / 10 : null,
  };
}
