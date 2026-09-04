// lib/gateCopy.ts
// Per-trigger gate copy (playbook §2 + Recommendations Stage 1): name the
// action, state the immediate payoff, include the cost anchor. The anchor
// (§6 "pays for itself"): a suspension tuner visit runs about $500, a
// revalve $295 to $600; Dialed Pro is $59.99 a year. Copy is the app's
// voice, no em dashes. Prices come from RevenueCat when available.
import type { GateTrigger } from "./placements";

export type GateCopy = { name: string; action: string; payoff: string };

export const GATE_COPY: Record<GateTrigger, GateCopy> = {
  log_moto: {
    name: "Log this moto",
    action: "Logging motos is Pro.",
    payoff: "Log it and the app tells you exactly which clickers to turn before the next one.",
  },
  adjust: {
    name: "Get the clicker change",
    action: "Clicker suggestions are Pro.",
    payoff: "Turn today's ride into a better setup: one change at a time, with the reason.",
  },
  second_setup: {
    name: "Add a second setup",
    action: "A second setup is Pro.",
    payoff: "Keep a dunes setup and a track setup on the same bike, each with its own history.",
  },
  second_bike: {
    name: "Add a second bike",
    action: "A second bike is Pro.",
    payoff: "Every bike in your garage gets its own baseline, setups, and story.",
  },
  history: {
    name: "Open your setup story",
    action: "Setup history is Pro.",
    payoff: "Every version, every reason, every outcome. It has been saving the whole time.",
  },
  tire_pressure: {
    name: "Track tire pressure",
    action: "Tire pressure tracking is Pro.",
    payoff: "Log front and rear for every ride day and see what worked on which dirt.",
  },
};

export const COST_ANCHOR = {
  tuner: "A suspension tuner runs about $500 a visit.",
  revalve: "A revalve is $295 to $600.",
  /** Filled with the live annual price when RevenueCat has it. */
  dialed: (annualPrice: string) => `Dialed Pro is ${annualPrice} a year.`,
};

export function anchorLine(annualPrice: string | null): string {
  return `${COST_ANCHOR.tuner} ${COST_ANCHOR.revalve} ${COST_ANCHOR.dialed(annualPrice ?? "$59.99")}`;
}
