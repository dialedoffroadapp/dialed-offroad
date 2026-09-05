// lib/rideConditions.ts
// Conditions vocabulary for the ride day (design/mockups/ride/04): rider-tapped
// only, nothing predicted. Discipline-aware sets come later; this is the
// shipped set. Labels are the mockups' verbatim.
export type Surface = "hardpack" | "loam" | "sand" | "mud";
export type TrackState = "fresh" | "choppy" | "rutted";
export type TempBand = "cold" | "mild" | "hot";

export type RideConditions = {
  /** Multi-select (2026-09-04): first tap is the PRIMARY surface, the rest
   *  are secondary. Stored as an array, primary first. */
  surfaces: Surface[];
  state: TrackState | null;
  temp: TempBand | null;
  watered: boolean | null;
};

export const EMPTY_CONDITIONS: RideConditions = { surfaces: [], state: null, temp: null, watered: null };

/** Tolerant reader: sessions written before the multi-select stored a single
 *  `surface` string. Never throws on either shape. */
export function surfacesOf(c: Partial<RideConditions> & { surface?: Surface | null } | null | undefined): Surface[] {
  if (!c) return [];
  if (Array.isArray(c.surfaces)) return c.surfaces.filter((x): x is Surface => typeof x === "string");
  return c.surface ? [c.surface] : [];
}

export function primarySurface(c: Partial<RideConditions> & { surface?: Surface | null } | null | undefined): Surface | null {
  return surfacesOf(c)[0] ?? null;
}

/** Normalize any stored shape to the current one. */
export function normalizeConditions(raw: unknown): RideConditions {
  const c = (raw ?? {}) as Partial<RideConditions> & { surface?: Surface | null };
  return { surfaces: surfacesOf(c), state: c.state ?? null, temp: c.temp ?? null, watered: c.watered ?? null };
}

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
  return surfacesOf(c).length > 0 && !!c.state && !!c.temp;
}

/** "Hardpack · choppy · hot" (watered folded in when yes). */
export function conditionsSummary(c: RideConditions): string {
  const surfaces = surfacesOf(c);
  const parts = [
    surfaces.length ? surfaces.map((id) => SURFACES.find((s) => s.id === id)?.label ?? id).join(" + ") : null,
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
