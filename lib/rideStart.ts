// lib/rideStart.ts
// Bike + setup choices for Start Riding (mockup 01/02, plan 4.1 step 2):
// auto-selected with one bike, the setup step skipped when the bike has one
// setup, both defaulted to the last ride otherwise.
import { readNamedSetups, readVersionSetupMap, setupsForBike, type SetupWithVersions } from "./bikeSetups";
import { loadBikes } from "./garageV3";
import { fetchModelSpecs } from "./modelSpecs";
import { readLastRide, type RideBike, type RideDraft } from "./rideDay";
import { getHistoryWithFeedback } from "./setupVersions";

export type BikeChoice = { bike: RideBike; setups: SetupWithVersions[]; hasAirFork: boolean };

export async function loadBikeChoices(userId: string): Promise<BikeChoice[]> {
  const bikes = await loadBikes(userId);
  return Promise.all(
    bikes.map(async (b) => {
      const [versions, named, map, specs] = await Promise.all([
        getHistoryWithFeedback(b.id).catch(() => []),
        readNamedSetups(b.id),
        readVersionSetupMap(b.id),
        fetchModelSpecs({ id: b.id, model_id: b.model_id, make: b.make, model: b.model, year: b.year }).catch(() => null),
      ]);
      const setups = setupsForBike(b.id, named, versions, map).filter((s) => s.running);
      const hasAirFork = typeof specs?.has_air_fork === "boolean" ? specs.has_air_fork : typeof versions[0]?.fork_air_bar === "number";
      return { bike: { id: b.id, make: b.make, model: b.model, year: b.year, nickname: b.nickname, model_id: b.model_id }, setups, hasAirFork };
    })
  );
}

export function bikeLine(b: RideBike): string {
  return b.nickname || [b.year, b.model].filter(Boolean).join(" ") || b.make || "Bike";
}

/** "250 SX-F · MX setup v5" */
export function bikeSetupLine(d: Pick<RideDraft, "bike" | "setupName" | "startingVersion">): string | null {
  if (!d.bike || !d.startingVersion) return null;
  return `${d.bike.model ?? bikeLine(d.bike)} · ${d.setupName ?? "Baseline"} v${d.startingVersion.version_number}`;
}

/** Apply the last ride's picks (and the single-bike / single-setup
 *  shortcuts) onto a draft that has nothing chosen yet. */
export async function defaultDraft(draft: RideDraft, choices: BikeChoice[]): Promise<RideDraft> {
  const last = await readLastRide();
  let next = { ...draft };
  if (!next.bike) {
    const pick = (last && choices.find((c) => c.bike.id === last.bikeId)) ?? (choices.length === 1 ? choices[0] : null);
    if (pick) {
      const setup =
        (last && pick.setups.find((s) => s.id === last.setupId)) ?? pick.setups.find((s) => s.isRunning) ?? pick.setups[0] ?? null;
      if (setup?.running) {
        next = { ...next, bike: pick.bike, setupId: setup.id, setupName: setup.name, startingVersion: setup.running, hasAirFork: pick.hasAirFork };
      }
    }
  }
  if (last && !next.trackName && !next.trackId) next = { ...next, trackId: last.trackId, trackName: last.trackName };
  if (last && !next.conditions.surface && !next.conditions.state && !next.conditions.temp) next = { ...next, conditions: last.conditions };
  return next;
}
