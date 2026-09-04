// lib/rideConditions.ts
// Conditions vocabulary for the ride day (design/mockups/ride/04): rider-tapped
// only, nothing predicted. Discipline-aware sets come later; this is the
// shipped set. Labels are the mockups' verbatim.
export type Surface = "hardpack" | "loam" | "sand" | "mud";
export type TrackState = "fresh" | "choppy" | "rutted";
export type TempBand = "cold" | "mild" | "hot";

export type RideConditions = {
  surface: Surface | null;
  state: TrackState | null;
  temp: TempBand | null;
  watered: boolean | null;
};

export const EMPTY_CONDITIONS: RideConditions = { surface: null, state: null, temp: null, watered: null };

export const SURFACES: { id: Surface; label: string }[] = [
  { id: "hardpack", label: "Hardpack" },
  { id: "loam", label: "Loam" },
  { id: "sand", label: "Sand" },
  { id: "mud", label: "Mud" },
];
export const TRACK_STATES: { id: TrackState; label: string }[] = [
  { id: "fresh", label: "Fresh" },
  { id: "choppy", label: "Choppy" },
  { id: "rutted", label: "Rutted" },
];
export const TEMP_BANDS: { id: TempBand; label: string; sub?: string }[] = [
  { id: "cold", label: "Cold", sub: "under 50°" },
  { id: "mild", label: "Mild" },
  { id: "hot", label: "Hot", sub: "over 85°" },
];

export function conditionsComplete(c: RideConditions): boolean {
  return !!c.surface && !!c.state && !!c.temp;
}

/** "Hardpack · choppy · hot" (watered folded in when yes). */
export function conditionsSummary(c: RideConditions): string {
  const parts = [
    c.surface ? SURFACES.find((s) => s.id === c.surface)?.label : null,
    c.state ? TRACK_STATES.find((s) => s.id === c.state)?.label.toLowerCase() : null,
    c.temp ? TEMP_BANDS.find((t) => t.id === c.temp)?.label.toLowerCase() : null,
    c.watered ? "watered" : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** Representative °F for the engine's temp_f context. */
export function tempBandToF(t: TempBand | null): number | undefined {
  if (t === "cold") return 45;
  if (t === "mild") return 70;
  if (t === "hot") return 92;
  return undefined;
}

/** Lower-cased surface for engine terrain strings. */
export function surfaceLabel(s: Surface | null): string | null {
  return s ? SURFACES.find((x) => x.id === s)?.label ?? null : null;
}
