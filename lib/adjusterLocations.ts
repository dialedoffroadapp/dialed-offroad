// lib/adjusterLocations.ts
// "Set it on the bike" walkthrough copy: WHERE each adjuster is (keyed by
// fork family for fork rows, shock family for shock rows, generic fallback)
// and HOW to set it (count-from-closed convention). DRAFT for River's review
// (2026-09-04); photo slots are placeholders until shot. NO em dashes.
import type { AdjusterKey } from "./adjusterCopy";

export type ForkFamily = "wp_xact_air" | "wp_aer_air" | "wp_xact_spring" | "wp_xplor" | "kyb_sss" | "kyb_psf2" | "showa" | "ohlins" | "sachs" | "generic";
export type ShockFamily = "wp_linkage" | "wp_pds" | "kyb" | "showa" | "ohlins" | "sachs" | "generic";

export const FORK_FAMILY_LABEL: Record<ForkFamily, string> = {
  wp_xact_air: "WP XACT air",
  wp_aer_air: "WP AER air",
  wp_xact_spring: "WP XACT spring",
  wp_xplor: "WP XPLOR",
  kyb_sss: "KYB SSS",
  kyb_psf2: "KYB PSF-2 air",
  showa: "Showa",
  ohlins: "Öhlins",
  sachs: "Sachs",
  generic: "your fork",
};

/** Catalog fork_type strings ("WP XACT air", "KYB SSS 48 coil", ...) to a family. */
export function forkFamilyFor(forkType: string | null | undefined, hasAirFork?: boolean | null): ForkFamily {
  const t = (forkType ?? "").toLowerCase();
  if (t.includes("öhlins") || t.includes("ohlins")) return "ohlins";
  if (t.includes("wp")) {
    if (t.includes("aer")) return "wp_aer_air";
    if (t.includes("xplor")) return "wp_xplor";
    if (t.includes("air")) return "wp_xact_air";
    return "wp_xact_spring";
  }
  if (t.includes("kyb")) return t.includes("psf") || t.includes("air") ? "kyb_psf2" : "kyb_sss";
  if (t.includes("showa")) return "showa";
  if (t.includes("sachs") || t.includes("zf")) return "sachs";
  if (hasAirFork) return "wp_xact_air";
  return "generic";
}

export function shockFamilyFor(shockType: string | null | undefined): ShockFamily {
  const t = (shockType ?? "").toLowerCase();
  if (t.includes("öhlins") || t.includes("ohlins")) return "ohlins";
  if (t.includes("pds")) return "wp_pds";
  if (t.includes("wp")) return "wp_linkage";
  if (t.includes("kyb")) return "kyb";
  if (t.includes("showa")) return "showa";
  if (t.includes("sachs")) return "sachs";
  return "generic";
}

export type LocationCopy = { where: string; how: string; photo: string };

const FORK_WHERE: Record<ForkFamily, Partial<Record<AdjusterKey, string>>> = {
  wp_xact_air: {
    fork_air: "Left fork leg, top cap. The Schrader valve sits under a small screw cap in the center of the cap; the compression clicker is on the right leg, not here.",
    fork_comp: "Right fork leg, top cap. The compression adjuster is the center screw with a slot, marked COMP. Two-way XACT forks put rebound down at the axle.",
    fork_reb: "Right fork leg, bottom of the leg by the axle. The rebound screw sits in the axle lug, marked REB, and points down. Older XACT air forks put it under the top cap of the right leg instead.",
  },
  wp_aer_air: {
    fork_air: "Left fork leg, top cap. Unscrew the small plastic cap to find the Schrader valve. Nothing else is adjusted on this leg.",
    fork_comp: "Right fork leg, top cap. The center slotted screw marked COMP.",
    fork_reb: "Right fork leg, top cap, the outer ring around the compression screw, marked REB. On AER 48 both fork clickers live on the right cap.",
  },
  wp_xact_spring: {
    fork_comp: "Top cap of each leg. The center slotted screw is compression; both legs carry one, set them the same.",
    fork_reb: "Bottom of each leg, in the axle lug, marked REB. Both legs, same number.",
  },
  wp_xplor: {
    fork_comp: "Left fork leg, top cap, the center screw marked COMP. XPLOR splits the circuits: left leg is compression.",
    fork_reb: "Right fork leg, top cap, the center screw marked REB. Both adjusters are up top on XPLOR, one per leg.",
  },
  kyb_sss: {
    fork_comp: "Bottom of each fork leg, the slotted screw in the axle lug. On KYB SSS compression is at the bottom, both legs, same number.",
    fork_reb: "Top cap of each fork leg, the center screw. Both legs, same number.",
  },
  kyb_psf2: {
    fork_air: "Both fork legs, top caps, Schrader valves under small caps. PSF-2 needs both legs at the same pressure.",
    fork_comp: "Bottom of each leg, the slotted screw in the axle lug.",
    fork_reb: "Top cap of each leg, the small screw beside the valve.",
  },
  showa: {
    fork_comp: "Bottom of each leg, the slotted screw in the axle lug. Showa coil forks put compression at the bottom.",
    fork_reb: "Top cap of each leg, the center screw. Both legs, same number.",
  },
  ohlins: {
    fork_comp: "Top cap of each leg, the outer knob or screw marked COMP. Check the cap marking; Öhlins cartridges vary by model.",
    fork_reb: "Bottom of each leg, the screw in the axle lug marked REB.",
  },
  sachs: {
    fork_comp: "Top cap of each leg, the center screw marked COMP.",
    fork_reb: "Bottom of each leg, the screw in the axle lug marked REB.",
  },
  generic: {
    fork_air: "Top cap of the air leg. Look for a Schrader valve under a small cap.",
    fork_comp: "A slotted screw on the top cap or in the axle lug, usually marked COMP. Check both legs; set them the same if both carry one.",
    fork_reb: "A slotted screw at the opposite end from compression, usually marked REB. Same number on both legs if both carry one.",
  },
};

const SHOCK_WHERE: Record<ShockFamily, Partial<Record<AdjusterKey, string>>> = {
  wp_linkage: {
    shock_lsc: "Top of the shock, on the reservoir. Low speed is the small slotted screw in the center of the big knob.",
    shock_hsc: "Top of the shock, on the reservoir. High speed is the large hex knob that surrounds the low speed screw.",
    shock_reb: "Bottom of the shock, the slotted screw on the clevis by the lower mount.",
    shock_sag: "Spring preload collar on the shock body, locked by a small pinch bolt or lock ring. Sag is measured at the rear axle, not set with a clicker.",
  },
  wp_pds: {
    shock_lsc: "Top of the shock, on the reservoir, the small center screw.",
    shock_hsc: "Top of the shock, on the reservoir, the large hex knob around the center screw.",
    shock_reb: "Bottom of the shock, the slotted screw near the lower mount.",
    shock_sag: "Preload collar on the shock body with a pinch bolt. PDS runs more sag than linkage bikes; use the number shown.",
  },
  kyb: {
    shock_lsc: "Reservoir, the small slotted screw in the center of the high speed knob.",
    shock_hsc: "Reservoir, the large knob around the low speed screw.",
    shock_reb: "Bottom of the shock, the slotted screw on the clevis.",
    shock_sag: "Threaded preload collar on the shock body, locked with a lock ring.",
  },
  showa: {
    shock_lsc: "Reservoir, the small slotted screw in the center.",
    shock_hsc: "Reservoir, the large hex knob around the center screw.",
    shock_reb: "Bottom of the shock, the slotted screw on the clevis.",
    shock_sag: "Threaded preload collar on the shock body, locked with a lock ring.",
  },
  ohlins: {
    shock_lsc: "Reservoir, the small screw in the center of the knob.",
    shock_hsc: "Reservoir, the large knob around the center screw.",
    shock_reb: "Bottom of the shock, the knob or screw at the lower mount.",
    shock_sag: "Threaded preload collar, locked with a lock ring.",
  },
  sachs: {
    shock_lsc: "Reservoir, the small center screw.",
    shock_hsc: "Reservoir, the large knob around the center screw.",
    shock_reb: "Bottom of the shock, the slotted screw near the lower mount.",
    shock_sag: "Threaded preload collar, locked with a lock ring.",
  },
  generic: {
    shock_lsc: "On the reservoir at the top of the shock, the small center screw.",
    shock_hsc: "On the reservoir, the large knob around the center screw.",
    shock_reb: "At the bottom of the shock by the lower mount.",
    shock_sag: "The spring preload collar on the shock body. Sag is measured at the rear axle.",
  },
};

const HOW: Record<AdjusterKey, (value: string, unit: string) => string> = {
  fork_air: (v) => `Front wheel off the ground, fork fully extended, cold. With a fork pump, set ${v} bar. Screw the pump on slowly, read after the hose fills, and bleed down if you overshoot. Put the cap back on.`,
  fork_comp: (v) => `Turn the screw clockwise gently until it stops. That is fully closed, zero. Now turn it counterclockwise ${v} clicks, counting each click. Same number on both legs if both have the adjuster.`,
  fork_reb: (v) => `Turn the screw clockwise gently until it stops. That is fully closed, zero. Back it out counterclockwise ${v} clicks. Same number on both legs if both have the adjuster.`,
  fork_spring: (v) => `Spring rate ${v} N/mm is a part, not a click. If your fork spring is different, note it on the bike page and the tune adjusts around it.`,
  shock_lsc: (v) => `Turn the small center screw clockwise gently until it stops. Zero. Back it out counterclockwise ${v} clicks.`,
  shock_hsc: (v) => `Turn the large knob clockwise gently until it stops. Zero. Back it out counterclockwise ${v} turns; a quarter turn is 0.25.`,
  shock_reb: (v) => `Turn the screw clockwise gently until it stops. Zero. Back it out counterclockwise ${v} clicks.`,
  shock_sag: (v) => `Bike on a stand, measure from the axle to a mark on the fender. Then sit on the bike in gear, centered, feet on the pegs, and measure again. The difference is race sag. Turn the preload collar until it reads ${v} mm, then lock it.`,
  shock_spring: (v) => `Spring rate ${v} N/mm is a part, not a click. If your shock spring is different, note it on the bike page.`,
};

export function locationCopy(key: AdjusterKey, value: string, unit: string, fork: ForkFamily, shock: ShockFamily): LocationCopy {
  const isFork = key.startsWith("fork_");
  const where =
    (isFork ? FORK_WHERE[fork][key] ?? FORK_WHERE.generic[key] : SHOCK_WHERE[shock][key] ?? SHOCK_WHERE.generic[key]) ??
    "Check your owner's manual for this adjuster's location.";
  const photo = isFork ? `fork/${fork}/${key}` : `shock/${shock}/${key}`;
  return { where, how: HOW[key](value, unit), photo };
}

/** One card per settable adjuster, in the clicker sheet's order. */
export const WALKTHROUGH_ORDER: readonly AdjusterKey[] = ["fork_air", "fork_comp", "fork_reb", "shock_sag", "shock_lsc", "shock_hsc", "shock_reb"] as const;
