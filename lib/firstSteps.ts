// lib/firstSteps.ts
// Home's day-one "First steps" checklist, step 2 ("Set the clickers on your
// bike"): marked done locally the first time the rider opens the running
// setup's sheet from Home. Local-first like the other Home stores; per bike.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "home_first_steps_set_on_bike_v1";

async function readSet(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export async function hasSetOnBike(bikeId: string | null | undefined): Promise<boolean> {
  if (!bikeId) return false;
  return (await readSet()).has(bikeId);
}

export async function markSetOnBike(bikeId: string | null | undefined): Promise<void> {
  if (!bikeId) return;
  try {
    const set = await readSet();
    set.add(bikeId);
    await AsyncStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // local-first: a failed write only delays the checkmark
  }
}
