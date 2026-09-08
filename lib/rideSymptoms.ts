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

/* ---- The full taxonomy on the refine screen (device pass finding 7, 2026-09-08) ---- */

export type SymptomEnd = "front" | "rear" | "both";
export type SymptomGroup = { end: SymptomEnd; title: string; chips: SymptomChip[] };
export type RideDiscipline = "mx" | "offroad";

/** Every engine id once, with the end it lives on and a label per
 *  discipline. UI vocabulary only: the ids are the frozen contract. */
const TAXONOMY: Record<Tune2SymptomId, { end: SymptomEnd; mx: string; offroad: string }> = {
  front_knifes: { end: "front", mx: "Front pushes", offroad: "Front washes out" },
  deflects_in_chop: { end: "front", mx: "Deflects in chop", offroad: "Deflects off rocks" },
  headshake: { end: "front", mx: "Headshake", offroad: "Headshake" },
  rear_kicks_accel: { end: "rear", mx: "Rear kicks", offroad: "Rear kicks" },
  packs_whoops: { end: "rear", mx: "Packs in whoops", offroad: "Packs in rocks" },
  harsh_braking_bumps: { end: "both", mx: "Harsh", offroad: "Harsh" },
  bottoms_landings: { end: "both", mx: "Bottoms on landings", offroad: "Bottoms on drops" },
  dead_feel: { end: "both", mx: "Dead / no pop", offroad: "Dead / no pop" },
  unstable_whoops: { end: "both", mx: "Unstable in whoops", offroad: "Unstable at speed" },
  harsh_square_edge: { end: "both", mx: "Harsh on square edges", offroad: "Harsh on roots and rocks" },
  general_harsh: { end: "both", mx: "Harsh all over", offroad: "Harsh all over" },
};

const GROUP_TITLE: Record<SymptomEnd, string> = { front: "Front", rear: "Rear", both: "Both ends" };

export function symptomLabelFor(id: Tune2SymptomId, discipline: RideDiscipline | null | undefined): string {
  const t = TAXONOMY[id];
  return discipline === "offroad" ? t.offroad : t.mx;
}

/** Front, Rear, Both: each chip carries its discipline label and the
 *  existing qualifier prompt where the id has one. */
export function symptomGroupsFor(discipline: RideDiscipline | null | undefined): SymptomGroup[] {
  const ends: SymptomEnd[] = ["front", "rear", "both"];
  return ends.map((end) => ({
    end,
    title: GROUP_TITLE[end],
    chips: (Object.keys(TAXONOMY) as Tune2SymptomId[])
      .filter((id) => TAXONOMY[id].end === end)
      .map((id) => {
        const base = symptomById(id);
        return { id, label: symptomLabelFor(id, discipline), ...(base?.qualifiers?.length ? { qualifierPrompt: base.qualifierPrompt, qualifiers: base.qualifiers } : {}) };
      }),
  }));
}

/** Tap once = mild, twice = bad, a third tap clears. */
export function cycleLevel(current: SymptomLevel | null | undefined): SymptomLevel | null {
  return !current ? "mild" : current === "mild" ? "bad" : null;
}

export type LoggedSymptom = { id: Tune2SymptomId; level: SymptomLevel; qualifier: string | null };

/** Save enables on Better / Same / Worse plus any chip or any text. A quick
 *  refine needs one of the two (there is nothing to refine otherwise); a
 *  ride-day moto is a record and saves on the sentiment alone. A picked chip
 *  that asks where still needs its answer. */
export function canSaveLog(p: { sentiment: "better" | "same" | "worse" | null; symptoms: LoggedSymptom[]; text: string; quick: boolean }): boolean {
  if (!p.sentiment) return false;
  for (const sym of p.symptoms) {
    const chip = symptomById(sym.id);
    if (chip?.qualifiers?.length && !sym.qualifier) return false;
  }
  if (!p.quick) return true;
  return p.symptoms.length > 0 || p.text.trim().length > 0;
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
