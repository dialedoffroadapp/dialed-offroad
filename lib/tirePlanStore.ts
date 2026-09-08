// lib/tirePlanStore.ts
// The last tire plan per bike (engine or the offline core), kept on the
// device so Current Setup can show the pressure with its reason without a
// conditions ask. Written by Today's setup; a bike-page save clears it (the
// saved pressure becomes the plan).
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TirePlanOutput } from "./tirePlanCore";

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

export async function clearTirePlan(bikeId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(bikeId));
  } catch {
    // ignore
  }
}
