// lib/symptomReasons.ts
// The Adjust screen's reason line (device pass finding 8, 2026-09-08): one
// sentence per symptom row of docs/symptom-table-draft.md (the engine's
// deterministic move for that id, written for the rider), never the LLM's
// wording. A qualifier TAG that changes the route (the table's NEW routes)
// gets its own sentence. Legacy ids read through LEGACY_TO_V3.
import type { Tune2SymptomId } from "./ai";
import { LEGACY_TO_V3 } from "./rideSymptoms";

const ROW: Record<string, string> = {
  harsh_small_bumps: "Harsh on the small bumps means the fork is not moving enough on the small hits: softer compression, and a touch less air if you run it.",
  bottoming: "Bottoming on landings and G-outs: firmer shock low speed, a quarter turn of high speed, and more fork air for mid-stroke support.",
  rear_kicks: "The rear kicks when the shock rebounds too fast: slower shock rebound stops the kick.",
  front_pushes: "The front pushes when the fork sits too low in the corner: firmer compression holds it up, a click faster on rebound gives it some pop.",
  packs_in_chop: "Packing means the rebound is too slow to recover between hits: faster fork and shock rebound.",
  wallows_dives: "Wallowing and diving mean not enough hold-up: firmer fork compression, and a click firmer on shock low speed.",
  headshake: "Headshake at speed: a click slower on fork and shock rebound for stability.",
  rear_swaps: "The rear swaps when it cannot find traction: softer shock low speed, and a click slower on shock rebound to settle it.",
  deflects: "The front deflects when the fork rebounds too fast: slower fork rebound keeps the tire planted.",
  rear_squats: "The rear squats on the gas: firmer shock low speed holds it up.",
  too_stiff: "Too stiff means the bike is not moving on the small stuff: softer fork compression and shock low speed, with a touch less air.",
  too_soft: "Too soft means it blows through: firmer fork compression and shock low speed, with a touch more air for hold-up.",
  arm_pump: "Arm pump comes from the front hammering your hands: softer fork compression, a click faster on rebound, and a touch less air.",
  chatters: "Chatter means the front is skipping: slower fork rebound to settle it, with a click softer on compression.",
  dead_feel: "Dead, no pop, means the rebound is too slow: faster fork and shock rebound, with a click firmer on fork compression for support.",
  unstable_whoops: "Unstable at speed means both ends are rebounding too fast: slower fork and shock rebound, and a little more fork air to hold it up.",
  harsh_square_edge: "Harsh on square edges: softer fork compression, and a click softer on shock low speed for traction.",
};

/** Qualifier routes that change the move (the table's NEW routes), by tag. */
const WHERE: Record<string, Record<string, string>> = {
  harsh_small_bumps: {
    big_hits: "Harsh on the big hits is a bottoming problem: firmer shock low speed, a quarter turn of high speed, and a touch more fork air.",
    landings: "Harsh on the landings is a bottoming problem: firmer shock low speed, a quarter turn of high speed, and a touch more fork air.",
  },
  rear_kicks: {
    jump_face: "The rear kicks when the shock rebounds too fast: slower shock rebound stops the kick. On the faces it is also blowing through, so a quarter turn of high speed holds it up.",
    braking_bumps: "The rear kicks when the shock rebounds too fast: slower shock rebound stops the kick. In the braking bumps the front joins in, so a click slower on fork rebound keeps it settled.",
    logs_ledges: "The rear kicks when the shock rebounds too fast: slower shock rebound stops the kick. On logs and ledges a click softer on shock low speed lets it absorb the edge.",
  },
  packs_in_chop: {
    rocks: "Packing means the rebound is too slow to recover between hits: faster fork and shock rebound. In the rocks a click softer on fork compression takes the sharp hits.",
  },
};

export function symptomReason(id: Tune2SymptomId | string | null | undefined, qualifier?: string | null): string | null {
  if (!id) return null;
  const key = id in ROW ? id : (LEGACY_TO_V3 as Record<string, { id: string }>)[id]?.id;
  if (!key || !(key in ROW)) return null;
  const q = qualifier?.trim().toLowerCase().replace(/\s+/g, "_");
  return (q && WHERE[key]?.[q]) || ROW[key];
}
