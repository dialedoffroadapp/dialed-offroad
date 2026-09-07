// lib/discipline.ts
// Rider discipline from the bike (pure, no imports): the model naming
// conventions each make uses. Moved out of lib/quizOnboarding.ts (contract
// v3, decision 11) so the engine client can send rider.discipline without
// pulling the quiz module graph. The quiz module re-exports both functions;
// the quiz suite tests classifyModel against the whole catalog.

/** What the engine takes as rider.discipline (offroad maps to its enduro math). */
export type RiderDiscipline = "mx" | "offroad";

export type ModelDiscipline = "mx" | "offroad" | "other" | "mini";

const MINI_GENERIC = /(^|\D)(50|65|85)(\D|$)/;

export function classifyModel(make: string, model: string): ModelDiscipline {
  const m = model.trim();
  if (
    MINI_GENERIC.test(m) ||
    /^KX100$/i.test(m) ||
    /^CRF1(10|25|50)/i.test(m) ||
    /^CR8[05]R/i.test(m)
  ) {
    return "mini";
  }
  switch (make) {
    case "KTM":
      return /\bSX(-F)?\b/i.test(m) ? "mx" : "offroad";
    case "Husqvarna":
      return /^(TC|FC)\b/i.test(m) ? "mx" : "offroad";
    case "GasGas":
      return /^MC\b/i.test(m) ? "mx" : "offroad";
    case "Yamaha":
      return /^YZ\d+F?$/i.test(m) ? "mx" : "offroad";
    case "Honda":
      return /^CRF\d+R(WE)?$/i.test(m) ? "mx" : "offroad";
    case "Kawasaki":
      return /^KX\d+$/i.test(m) ? "mx" : "offroad";
    case "Suzuki":
      return /^RM-?Z/i.test(m) ? "mx" : "offroad";
    case "Beta":
    case "Sherco":
      return "offroad";
    case "TM Racing":
      if (/^MX\b/i.test(m)) return "mx";
      if (/^EN\b/i.test(m)) return "offroad";
      return "other";
    case "Stark":
      if (/\bMX\b/i.test(m)) return "mx";
      if (/\bEX\b/i.test(m)) return "offroad";
      return "other";
    default:
      return "other";
  }
}

export function disciplineFromBike(make: string | null | undefined, model: string | null | undefined): RiderDiscipline | null {
  if (!make || !model) return null;
  const k = classifyModel(make, model);
  return k === "mx" ? "mx" : k === "offroad" ? "offroad" : null;
}
