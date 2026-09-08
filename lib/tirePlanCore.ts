// lib/tirePlanCore.ts
// Tire pressure as a deterministic engine output (River, 2026-09-07; reverses
// the Sep 5 "tires stay out of the engine" call). This is the DEPENDENCY-FREE
// rule base the client runs offline; the ai-tune edge carries a port of the
// same function over the same table (supabase/functions/ai-tune/
// tire_defaults.json, the single source of truth; lib/generated/
// tireDefaults.json is its generated copy) and a Deno parity test locks the
// two together. The LLM may mention the numbers; it never chooses them.
//
// Rules, in order:
//   start from Dunlop's default for the discipline and PRIMARY surface
//   (hardpack when no surface is known), the rider's saved pressure wins over
//   the default, the conditions delta (watered, half a psi out) adjusts
//   either; a mousse end has no pressure to set; a tubliss end runs its own
//   low range; a heavy tube is a tube. Values land on half-psi steps.

export type TireSystem = "tube" | "heavy_tube" | "tubliss" | "mousse" | "unknown";
export const TIRE_SYSTEMS: TireSystem[] = ["tube", "heavy_tube", "tubliss", "mousse", "unknown"];
export const TIRE_SYSTEM_LABEL: Record<TireSystem, string> = {
  tube: "Tube",
  heavy_tube: "Heavy tube",
  tubliss: "Tubliss",
  mousse: "Mousse",
  unknown: "Not sure",
};
export type TireDiscipline = "mx" | "offroad";
export type TireSurface = "hardpack" | "loam" | "sand" | "mud";
export type TireSource = "dunlop_default" | "rider_saved" | "conditions_adjusted" | "mousse_none";

export type TireTable = {
  version: number;
  source: string;
  watered_psi_delta: number;
  defaults: Record<TireDiscipline, Record<TireSurface, { front: number; rear: number; reason: string }>>;
  systems: {
    tubliss: { front: { psi: number; min: number; max: number }; rear: { psi: number; min: number; max: number }; reason: string };
    mousse: { reason: string };
  };
};

export type TirePlanInput = {
  discipline?: TireDiscipline | null;
  surface?: TireSurface | null;
  /** Freshly watered track: the table's watered delta applies to both ends. */
  watered?: boolean | null;
  /** An explicit psi delta from the conditions stage (both ends); replaces
   *  the watered flag when given. */
  psiDelta?: number | null;
  systemFront?: TireSystem | null;
  systemRear?: TireSystem | null;
  savedFront?: number | null;
  savedRear?: number | null;
};

export type TirePlanOutput = {
  front: number | null;
  rear: number | null;
  reason: string;
  source: TireSource;
  discipline: TireDiscipline;
  surface: TireSurface;
  /** The delta that was applied to both ends (0 when none). */
  delta: number;
  systemFront: TireSystem;
  systemRear: TireSystem;
};

export const TIRE_REASON_MAX = 200;

const half = (n: number) => Math.round(n * 2) / 2;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const sys = (v: unknown): TireSystem => (TIRE_SYSTEMS.includes(v as TireSystem) ? (v as TireSystem) : "unknown");

export function asTireSurface(v: unknown): TireSurface | null {
  return v === "hardpack" || v === "loam" || v === "sand" || v === "mud" ? v : null;
}

/** Map a free-text terrain ("hardpack", "sandy loam", "mx") onto a surface. */
export function surfaceFromTerrain(terrain: unknown): TireSurface | null {
  if (typeof terrain !== "string") return null;
  const t = terrain.toLowerCase();
  if (/\bmud\b|muddy/.test(t)) return "mud";
  if (/\bsand|dunes/.test(t)) return "sand";
  if (/loam|soft|tacky|clay/.test(t)) return "loam";
  if (/hard\s*-?pack|blue\s*groove|slick|intermediate/.test(t)) return "hardpack";
  return null;
}

function capReason(parts: string[]): string {
  const s = parts.filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
  if (s.length <= TIRE_REASON_MAX) return s;
  const cut = s.slice(0, TIRE_REASON_MAX);
  const at = cut.lastIndexOf(" ");
  return (at > 120 ? cut.slice(0, at) : cut).trim();
}

/** The one tire decision, shared by the edge and the offline client. */
export function tirePlan(table: TireTable, input: TirePlanInput): TirePlanOutput {
  const discipline: TireDiscipline = input.discipline === "offroad" ? "offroad" : "mx";
  const surface: TireSurface = asTireSurface(input.surface) ?? "hardpack";
  const surfaceKnown = asTireSurface(input.surface) !== null;
  const d = table.defaults[discipline][surface];
  const delta = isNum(input.psiDelta) ? input.psiDelta : input.watered ? table.watered_psi_delta : 0;
  const systemFront = sys(input.systemFront);
  const systemRear = sys(input.systemRear);
  const savedFront = isNum(input.savedFront) ? input.savedFront : null;
  const savedRear = isNum(input.savedRear) ? input.savedRear : null;

  const end = (which: "front" | "rear", system: TireSystem, saved: number | null): number | null => {
    if (system === "mousse") return null;
    if (system === "tubliss") {
      const t = table.systems.tubliss[which];
      const base = saved ?? t.psi;
      const v = half(base + delta);
      return saved !== null ? v : Math.max(t.min, Math.min(t.max, v));
    }
    return half((saved ?? d[which]) + delta);
  };
  const front = end("front", systemFront, savedFront);
  const rear = end("rear", systemRear, savedRear);

  const anySaved = (systemFront !== "mousse" && savedFront !== null) || (systemRear !== "mousse" && savedRear !== null);
  const bothMousse = systemFront === "mousse" && systemRear === "mousse";
  const source: TireSource = bothMousse ? "mousse_none" : delta !== 0 ? "conditions_adjusted" : anySaved ? "rider_saved" : "dunlop_default";

  const parts: string[] = [];
  if (bothMousse) parts.push(table.systems.mousse.reason);
  else if (anySaved) parts.push("Your saved pressure.");
  else parts.push(surfaceKnown ? d.reason : `No surface given. ${d.reason}`);
  if (!bothMousse && delta !== 0) parts.push(delta < 0 ? `Watered track: ${Math.abs(delta)} psi out front and rear for grip.` : `${delta} psi in front and rear.`);
  if (!bothMousse && (systemFront === "mousse" || systemRear === "mousse")) parts.push(`${systemFront === "mousse" ? "Front" : "Rear"} is a mousse: nothing to set there.`);
  if (systemFront === "tubliss" || systemRear === "tubliss") parts.push(`Tubliss: ${table.systems.tubliss.reason}`);
  return { front, rear, reason: capReason(parts), source, discipline, surface, delta, systemFront, systemRear };
}

/** "12" / "12.5" / "mousse" for a display cell. */
export function tireCell(psi: number | null, system: TireSystem | null | undefined): string {
  if (system === "mousse") return "mousse";
  if (!isNum(psi)) return "—";
  return String(psi).replace(/\.0$/, "");
}
