// lib/symptomReasons.ts
// The Adjust screen's reason line (device pass finding 8, 2026-09-08): one
// sentence per symptom row of docs/symptom-table-draft.md (the engine's
// deterministic move for that id, written for the rider), never the LLM's
// wording. A qualifier that changes the route gets its own sentence. The
// ids are the frozen Tune2SymptomId set; the table is the source.
import type { Tune2SymptomId } from "./ai";

const ROW: Record<Tune2SymptomId, string> = {
  harsh_braking_bumps: "Harsh on the bumps means the fork is not moving enough on the small hits: softer compression, and a touch less air if you run it.",
  deflects_in_chop: "The front deflects when the fork rebounds too fast: slower fork rebound keeps the tire planted.",
  rear_kicks_accel: "The rear kicks when the shock rebounds too fast: slower shock rebound stops the kick.",
  bottoms_landings: "Bottoming on landings and G-outs: firmer shock low speed, a quarter turn of high speed, and more fork air for mid-stroke support.",
  front_knifes: "The front pushes when the fork sits too low in the corner: firmer compression holds it up, a click faster on rebound gives it some pop.",
  dead_feel: "Dead, no pop, means the rebound is too slow: faster fork and shock rebound, with a click firmer on fork compression for support.",
  unstable_whoops: "Unstable at speed means both ends are rebounding too fast: slower fork and shock rebound, and a little more fork air to hold it up.",
  packs_whoops: "Packing means the rebound is too slow to recover between hits: faster fork and shock rebound.",
  harsh_square_edge: "Harsh on square edges: softer fork compression, and a click softer on shock low speed for traction.",
  headshake: "Headshake at speed: a click slower on fork and shock rebound for stability.",
  general_harsh: "Harsh all over means too stiff: softer fork compression and shock low speed, with a touch less air.",
};

/** Qualifier routes that change the move (the table's NEW routes). */
const WHERE: Partial<Record<Tune2SymptomId, Record<string, string>>> = {
  harsh_braking_bumps: {
    "big hits": "Harsh on the big hits is a bottoming problem: firmer shock low speed, a quarter turn of high speed, and a touch more fork air.",
  },
  rear_kicks_accel: {
    landings: "The rear kicks when the shock rebounds too fast: slower shock rebound stops the kick. On the faces it is also blowing through, so a quarter turn of high speed holds it up.",
    "braking bumps": "The rear kicks when the shock rebounds too fast: slower shock rebound stops the kick. In the braking bumps the front joins in, so a click slower on fork rebound keeps it settled.",
  },
  packs_whoops: {
    rocks: "Packing means the rebound is too slow to recover between hits: faster fork and shock rebound. In the rocks a click softer on fork compression takes the sharp hits.",
  },
};

export function symptomReason(id: Tune2SymptomId | null | undefined, qualifier?: string | null): string | null {
  if (!id || !(id in ROW)) return null;
  const q = qualifier?.trim().toLowerCase();
  return (q && WHERE[id]?.[q]) || ROW[id];
}
