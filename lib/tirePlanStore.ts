// lib/tirePlanStore.ts
// The last tire plan per bike (engine or the offline core), kept on the
// device so Current Setup can show the pressure with its reason without a
// conditions ask. Written by Today's setup; a bike-page save clears it (the
// saved pressure becomes the plan).
import AsyncStorage from "@react-native-async-storage/async-storage";
import tireTable from "./generated/tireDefaults.json";
import { surfaceFromTerrain, tirePlan, type TirePlanOutput, type TireSystem, type TireTable } from "./tirePlanCore";

const TIRE_TABLE = tireTable as TireTable;

export type StoredTirePlan = { plan: TirePlanOutput; from: "engine" | "rules"; at: string };
const key = (bikeId: string) => `tire_plan_v1:${bikeId}`;

export async function rememberTirePlan(bikeId: string, plan: TirePlanOutput, from: "engine" | "rules"): Promise<void> {
  try {
    const stored: StoredTirePlan = { plan, from, at: new Date().toISOString() };
    await AsyncStorage.setItem(key(bikeId), JSON.stringify(stored));
  } catch {
    // device cache only
  }
}

export async function readTirePlan(bikeId: string): Promise<StoredTirePlan | null> {
  try {
    const raw = await AsyncStorage.getItem(key(bikeId));
    return raw ? (JSON.parse(raw) as StoredTirePlan) : null;
  } catch {
    return null;
  }
}

/** What the Tires sheet SHOWS (finding 2, 2026-09-08): the last plan Today's
 *  setup computed for this bike, else the same table from the bike's
 *  discipline and the running setup's terrain. Never the MX default by
 *  accident: the discipline is the rider's stored answer first. */
export async function garageTirePlan(p: {
  bikeId: string;
  discipline: "mx" | "offroad" | null;
  terrain: string | null | undefined;
  setupName: string | null | undefined;
  systems: { front: TireSystem; rear: TireSystem };
  saved: { front: number | null; rear: number | null };
}): Promise<{ front: number | null; rear: number | null; subtitle: string; from: "engine" | "rules" | "table" }> {
  const stored = await readTirePlan(p.bikeId);
  const name = p.setupName ?? "running";
  if (stored?.plan) {
    const cond = [stored.plan.surface, stored.plan.delta !== 0 ? "watered" : null].filter(Boolean).join(", ");
    return { front: stored.plan.front, rear: stored.plan.rear, subtitle: `From your ${name} tune, ${cond}${stored.from === "rules" ? " (offline rules)" : ""}.`, from: stored.from };
  }
  const plan = tirePlan(TIRE_TABLE, { discipline: p.discipline, surface: surfaceFromTerrain(p.terrain), systemFront: p.systems.front, systemRear: p.systems.rear, savedFront: p.saved.front, savedRear: p.saved.rear });
  const cond = surfaceFromTerrain(p.terrain) ?? (p.discipline === "offroad" ? "off-road" : "hardpack");
  return { front: plan.front, rear: plan.rear, subtitle: `From your ${name} tune, ${cond}.`, from: "table" };
}

export async function clearTirePlan(bikeId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(bikeId));
  } catch {
    // ignore
  }
}
