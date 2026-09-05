// lib/rideSymptoms.ts
// Log-moto vocabulary (design/mockups/ride/08): 4 large chips + "More
// symptoms", and a terrain qualifier ONLY for the ambiguous chips, phrased
// per chip. This is UI vocabulary over the EXISTING engine ids
// (Tune2SymptomId, the frozen three-way contract) — it maps NOTHING to
// adjusters; the change set comes from the engine (app/ride/adjust.tsx).
// The plan's 14-id taxonomy (4.3) is a separate contract change set.
import type { Tune2SymptomId } from "./ai";

export type SymptomChip = { id: Tune2SymptomId; label: string; qualifierPrompt?: string; qualifiers?: string[] };

export const PRIMARY_SYMPTOMS: SymptomChip[] = [
  { id: "rear_kicks_accel", label: "Rear kicks", qualifierPrompt: "Where did it kick?", qualifiers: ["Square edges", "Landings", "Braking bumps"] },
  { id: "harsh_braking_bumps", label: "Harsh", qualifierPrompt: "Where was it harsh?", qualifiers: ["Small chop", "Under braking", "Big hits"] },
  { id: "front_knifes", label: "Front pushes" },
  { id: "bottoms_landings", label: "Bottoming" },
];

export const MORE_SYMPTOMS: SymptomChip[] = [
  { id: "packs_whoops", label: "Packs", qualifierPrompt: "Where does it pack?", qualifiers: ["Whoops", "Rocks"] },
  { id: "dead_feel", label: "Dead / no pop" },
  { id: "unstable_whoops", label: "Unstable" },
  { id: "deflects_in_chop", label: "Deflects" },
  { id: "harsh_square_edge", label: "Harsh on edges" },
  { id: "headshake", label: "Headshake" },
  { id: "general_harsh", label: "Harsh all over" },
];

export const ALL_SYMPTOMS: SymptomChip[] = [...PRIMARY_SYMPTOMS, ...MORE_SYMPTOMS];

export function symptomById(id: string): SymptomChip | undefined {
  return ALL_SYMPTOMS.find((s) => s.id === id);
}

/** Chip tap level (ported from the legacy debrief's 1-5 picker): one tap =
 *  mild, a second tap = bad, a third clears the chip. */
export type SymptomLevel = "mild" | "bad";

/** Engine severity (1-10): the chip's tap level when the rider set one
 *  (mild = 4, bad = 8: the debrief's 2 and 4 on its 1-5 scale, doubled
 *  once), else derived from the moto's sentiment. */
export function severityFor(sentiment: "better" | "same" | "worse", level?: SymptomLevel | null): number {
  if (level === "bad") return 8;
  if (level === "mild") return 4;
  return sentiment === "worse" ? 8 : sentiment === "same" ? 6 : 4;
}

/** Engine overall_rating (1-10) from the moto's sentiment. */
export function ratingFor(sentiment: "better" | "same" | "worse"): number {
  return sentiment === "better" ? 8 : sentiment === "same" ? 5 : 3;
}
