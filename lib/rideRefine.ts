// lib/rideRefine.ts
// "Refine after ride" (setup sheet) and the retired legacy debrief's redirect
// both land on the ride-day Log screen in QUICK mode: this resolves the bike,
// the setup and the version to refine from route ids and opens the quick
// session. Errors are thrown for the screen to show (rule a).
import { runningSetup } from "./bikeSetups";
import { loadBikePage, loadBikes, loadUserAndPro } from "./garageV3";
import { startQuickRefineSession, type RideSession } from "./rideDay";

export type QuickRefineParams = { bikeId: string; setupId?: string | null; versionId?: string | null };

export async function startQuickRefine(p: QuickRefineParams): Promise<RideSession> {
  const { userId } = await loadUserAndPro();
  const bikes = userId ? await loadBikes(userId) : [];
  const bike = bikes.find((b) => b.id === p.bikeId) ?? null;
  if (!bike) throw new Error("Bike not found.");
  const page = await loadBikePage(bike);
  const wanted = p.setupId && p.setupId !== "default" ? p.setupId : null;
  const byId = wanted ? page.setups.find((s) => s.id === wanted) ?? null : null;
  const byVersion = !byId && p.versionId ? page.setups.find((s) => s.versions.some((v) => v.id === p.versionId)) ?? null : null;
  const setup = byId ?? byVersion ?? runningSetup(page.setups) ?? page.setups[0] ?? null;
  const version = (p.versionId ? setup?.versions.find((v) => v.id === p.versionId) : null) ?? setup?.running ?? setup?.versions[0] ?? null;
  if (!setup || !version) throw new Error("No setup to refine yet. Build a tune first.");
  const hasAirFork = typeof page.specs?.has_air_fork === "boolean" ? page.specs.has_air_fork : version.fork_air_bar !== null && version.fork_air_bar !== undefined;
  return startQuickRefineSession({
    bike: { id: bike.id, make: bike.make, model: bike.model, year: bike.year, nickname: bike.nickname, model_id: bike.model_id },
    setupId: setup.id,
    setupName: setup.name,
    startingVersion: version,
    hasAirFork,
    userId,
  });
}
