// lib/adjusterLocations.ts
// "Set it on the bike" walkthrough copy: WHERE each adjuster is (keyed by
// fork family for fork rows, shock family for shock rows, generic fallback)
// and HOW to set it (count-from-closed convention). Photo slots are
// placeholders until shot. NO em dashes.
//
// Sources. Count-from-closed on every family: turn the adjuster in
// (clockwise) until it stops, that is zero, then count out; confirmed for
// every family by the second report (2026-09-07) and cited to Teknik's
// off-road setup guide ("clicks out from full hard"). WP fork rows: WP XACT
// PRO 7448 manual and the KTM SX / SX-F owner's manuals (2017+): AER 48 and
// XACT air put the valve under the LEFT cap and both clickers under the
// RIGHT cap; XPLOR splits compression left, rebound right; nothing at the
// axle. WP shocks: LSC and HSC on the reservoir, rebound at the bottom.
// Second report (2026-09-07, sub-task 3), tagged per row below:
//   kyb_sss (tuner: KYB OEM parts, Dirt Rider): compression on the top cap,
//     rebound in the base bolt at the bottom, both legs; 2024+ Yamaha
//     compression turns by hand.
//   showa_coil (tuner: MXA): compression top cap, rebound bottom of leg;
//     shock LSC and HSC on the reservoir, rebound at the clevis; the Honda
//     cluster moved from the left side to the right for the 2022 CRF250
//     generation (2021 CRF450).
//   showa_sff2 (tuner: MXA): all damping in the LEFT leg, right cap is
//     spring preload.
//   showa_sff_air_tac (tuner: MXA): inner and outer chamber valves on the
//     left cap, balance chamber valve under the left lug, all damping in
//     the RIGHT leg.
//   showa_bfrc (report, section 4): Com and Ten on the piggyback, continuous
//     turns, nothing under the shock, no high-speed adjuster.
//   ohlins (tuner: MXA): fork cap left bleed (T25), center compression (3 mm
//     Allen), right rebound (T25); shock rebound knob at the bottom,
//     compression on the reservoir, HSC clicker on TTX Flow DV 2023+.
//   sachs (factory: Beta and Sherco manuals): both clickers on the fork
//     tops; shock LSC and rebound clicks, HSC turns.
//   kyb shock (tuner: Keefer): LSC small center clicker on the reservoir
//     top, HSC the large outer hex knob, rebound at the clevis.
//   kyb_psf2 (Honda 2013 to 2016): DRAFT. High and low compression AND high
//     and low rebound exist; positions not found.
import type { AdjusterKey } from "./adjusterCopy";

export type ForkFamily =
  | "wp_xact_air"
  | "wp_aer_air"
  | "wp_xact_spring"
  | "wp_xplor"
  | "kyb_sss"
  | "kyb_psf2"
  | "showa_coil"
  | "showa_sff2"
  | "showa_sff_air_tac"
  | "ohlins"
  | "sachs"
  | "generic";
export type ShockFamily = "wp_linkage" | "wp_pds" | "kyb" | "showa" | "showa_bfrc" | "ohlins" | "sachs" | "generic";

export const FORK_FAMILY_LABEL: Record<ForkFamily, string> = {
  wp_xact_air: "WP XACT air",
  wp_aer_air: "WP AER air",
  wp_xact_spring: "WP XACT spring",
  wp_xplor: "WP XPLOR",
  kyb_sss: "KYB SSS",
  kyb_psf2: "KYB PSF-2 air",
  showa_coil: "Showa coil",
  showa_sff2: "Showa SFF-2",
  showa_sff_air_tac: "Showa SFF-Air TAC",
  ohlins: "Öhlins",
  sachs: "Sachs",
  generic: "your fork",
};

/** Rows still DRAFT (unsourced or positions not found) for River's review. */
export const DRAFT_FORK_FAMILIES: readonly ForkFamily[] = ["kyb_psf2", "generic"] as const;
export const DRAFT_SHOCK_FAMILIES: readonly ShockFamily[] = ["generic"] as const;

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
  if (t.includes("showa")) {
    if (t.includes("sff-air") || t.includes("tac")) return "showa_sff_air_tac";
    if (t.includes("sff")) return "showa_sff2";
    return "showa_coil";
  }
  if (t.includes("sachs") || t.includes("zf")) return "sachs";
  if (hasAirFork) return "wp_xact_air";
  return "generic";
}

export function shockFamilyFor(shockType: string | null | undefined): ShockFamily {
  const t = (shockType ?? "").toLowerCase();
  if (t.includes("öhlins") || t.includes("ohlins")) return "ohlins";
  if (t.includes("bfrc")) return "showa_bfrc";
  if (t.includes("pds")) return "wp_pds";
  if (t.includes("wp")) return "wp_linkage";
  if (t.includes("kyb")) return "kyb";
  if (t.includes("showa")) return "showa";
  if (t.includes("sachs")) return "sachs";
  return "generic";
}

export type LocationCopy = { where: string; how: string; photo: string };

/** Bike context for year-conditional notes (the Honda shock cluster side). */
export type LocationContext = { make?: string | null; year?: number | null };

const FORK_WHERE: Record<ForkFamily, Partial<Record<AdjusterKey, string>>> = {
  wp_xact_air: {
    fork_air: "Left fork leg, top cap. The Schrader valve sits under a small screw cap in the center of the cap. Nothing else is adjusted on this leg; both clickers are on the right leg.",
    fork_comp: "Right fork leg, top cap. The outer adjuster marked COMP. Rebound is the screw in the center of the same cap. Nothing is adjusted at the bottom of an XACT air leg.",
    fork_reb: "Right fork leg, top cap. The center screw marked REB, inside the compression ring. Both fork clickers live under this one cap; there is no adjuster at the axle.",
  },
  wp_aer_air: {
    fork_air: "Left fork leg, top cap. Unscrew the small plastic cap to find the Schrader valve. Nothing else is adjusted on this leg.",
    fork_comp: "Right fork leg, top cap. The outer adjuster marked COMP. Rebound is the screw in the center of the same cap.",
    fork_reb: "Right fork leg, top cap. The center screw marked REB, inside the compression ring. On AER 48 both clickers are up top on the right leg; nothing is adjusted at the axle.",
  },
  wp_xact_spring: {
    fork_comp: "Top cap of each leg. The center slotted screw is compression; both legs carry one, set them the same.",
    fork_reb: "Bottom of each leg, in the axle lug, marked REB. Both legs, same number.",
  },
  wp_xplor: {
    fork_comp: "Left fork leg, top cap, the center screw marked COMP. XPLOR splits the circuits: left leg is compression. Nothing is adjusted at the bottom of either leg.",
    fork_reb: "Right fork leg, top cap, the center screw marked REB. Both adjusters are up top on XPLOR, one per leg; nothing at the axle.",
  },
  kyb_sss: {
    fork_comp: "Top cap of each fork leg, the clicker in the center of the cap. Both legs carry damping: set them the same. On 2024 and newer Yamahas it turns by hand.",
    fork_reb: "Bottom of each fork leg, the slotted screw in the base bolt by the axle. Both legs, same number.",
  },
  kyb_psf2: {
    fork_air: "Both fork legs, top caps, Schrader valves under small caps. PSF-2 needs both legs at the same pressure.",
    fork_comp: "DRAFT: PSF-2 has high and low speed compression adjusters; their positions were not found in a source. Check the owner's manual and set both legs the same.",
    fork_reb: "DRAFT: PSF-2 has high and low speed rebound adjusters; their positions were not found in a source. Check the owner's manual.",
  },
  showa_coil: {
    fork_comp: "Top cap of each leg, the center clicker marked COMP. Both legs, same number.",
    fork_reb: "Bottom of each leg, the slotted screw at the base of the leg by the axle, marked REB. Both legs, same number.",
  },
  showa_sff2: {
    fork_comp: "Left fork leg, top cap. SFF-2 keeps all the damping in the left leg; the right cap is spring preload, not a clicker.",
    fork_reb: "Left fork leg, bottom of the leg by the axle. All damping is in the left leg; the right leg has no rebound screw.",
  },
  showa_sff_air_tac: {
    fork_air: "Left fork leg. The inner and outer chamber valves are on the left top cap and the balance chamber valve is under the left lug. Three pressures; the manual gives all three.",
    fork_comp: "Right fork leg, top cap. All the damping is in the right leg on SFF-Air TAC.",
    fork_reb: "Right fork leg, bottom of the leg by the axle. All the damping is in the right leg.",
  },
  ohlins: {
    fork_comp: "Top cap of each leg, the center adjuster (3 mm Allen). The left screw on the cap is the bleed (T25), not a clicker.",
    fork_reb: "Top cap of each leg, the right-hand adjuster (T25). Both legs, same number.",
  },
  sachs: {
    fork_comp: "Top cap of each leg, the clicker marked COMP. Count out from fully closed; both legs the same.",
    fork_reb: "Top cap of each leg, the clicker marked REB. Count out from fully closed; both legs the same.",
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
    shock_lsc: "Top of the reservoir, the small center clicker.",
    shock_hsc: "Top of the reservoir, the large outer hex knob around the center clicker. Counted in turns.",
    shock_reb: "Bottom of the shock, the slotted screw on the clevis by the lower mount.",
    shock_sag: "Threaded preload collar on the shock body, locked with a lock ring.",
  },
  showa: {
    shock_lsc: "On the reservoir, the small slotted screw in the center of the high speed knob.",
    shock_hsc: "On the reservoir, the large hex knob around the center screw. Counted in turns.",
    shock_reb: "Bottom of the shock, the slotted screw on the clevis by the lower mount.",
    shock_sag: "Threaded preload collar on the shock body, locked with a lock ring.",
  },
  showa_bfrc: {
    shock_lsc: "On the piggyback reservoir, the adjuster labeled Com. It turns continuously: count turns out from fully closed, not clicks. Nothing is adjusted under the shock.",
    shock_hsc: "This shock has no high-speed compression adjuster. Nothing to set.",
    shock_reb: "On the piggyback reservoir, the adjuster labeled Ten. Turns, not clicks, counted out from fully closed. There is no rebound screw at the clevis.",
    shock_sag: "Threaded preload collar on the shock body, locked with a lock ring.",
  },
  ohlins: {
    shock_lsc: "On the reservoir, the compression adjuster.",
    shock_hsc: "On the reservoir beside the compression adjuster. A clicker on TTX Flow DV (2023 and newer); turns on earlier TTX.",
    shock_reb: "Bottom of the shock, the rebound knob at the lower mount.",
    shock_sag: "Threaded preload collar, locked with a lock ring.",
  },
  sachs: {
    shock_lsc: "On the reservoir, the small center screw. Clicks, counted out from closed.",
    shock_hsc: "On the reservoir, the large knob around the center screw. Turns, counted out from closed.",
    shock_reb: "Bottom of the shock, the slotted screw near the lower mount. Clicks, counted out from closed.",
    shock_sag: "Threaded preload collar, locked with a lock ring.",
  },
  generic: {
    shock_lsc: "On the reservoir at the top of the shock, the small center screw.",
    shock_hsc: "On the reservoir, the large knob around the center screw.",
    shock_reb: "At the bottom of the shock by the lower mount.",
    shock_sag: "The spring preload collar on the shock body. Sag is measured at the rear axle.",
  },
};

/** Year-conditional note: the Honda Showa shock cluster sits on the right of
 *  the bike from the 2022 CRF250 generation (2021 CRF450), on the left before. */
function shockSideNote(shock: ShockFamily, key: AdjusterKey, ctx?: LocationContext): string {
  if (shock !== "showa" || !ctx?.make || ctx.make.toLowerCase() !== "honda" || typeof ctx.year !== "number") return "";
  if (key !== "shock_lsc" && key !== "shock_hsc") return "";
  return ctx.year >= 2021 ? " The cluster is on the right side of the bike on this generation." : " The cluster is on the left side of the bike on this generation.";
}

const HOW: Record<AdjusterKey, (value: string, unit: string) => string> = {
  fork_air: (v) => `Front wheel off the ground, fork fully extended, cold. With a fork pump, set ${v} bar. Screw the pump on slowly, read after the hose fills, and bleed down if you overshoot. Put the cap back on.`,
  fork_comp: (v) => `Turn the screw clockwise gently until it stops. That is fully closed, zero. Now turn it counterclockwise ${v} clicks, counting each click. Same number on both legs if both have the adjuster.`,
  fork_reb: (v) => `Turn the screw clockwise gently until it stops. That is fully closed, zero. Back it out counterclockwise ${v} clicks. Same number on both legs if both have the adjuster.`,
  fork_spring: (v) => `Spring rate ${v} N/mm is a part, not a click. If your fork spring is different, note it on the bike page and the tune adjusts around it.`,
  shock_lsc: (v, unit) =>
    unit === "turns"
      ? `Turn the Com adjuster clockwise gently until it stops. Zero. Back it out counterclockwise ${v} turns; a quarter turn is 0.25.`
      : `Turn the small center screw clockwise gently until it stops. Zero. Back it out counterclockwise ${v} clicks.`,
  shock_hsc: (v) => `Turn the large knob clockwise gently until it stops. Zero. Back it out counterclockwise ${v} turns; a quarter turn is 0.25.`,
  shock_reb: (v, unit) =>
    unit === "turns"
      ? `Turn the Ten adjuster clockwise gently until it stops. Zero. Back it out counterclockwise ${v} turns; a quarter turn is 0.25.`
      : `Turn the screw clockwise gently until it stops. Zero. Back it out counterclockwise ${v} clicks.`,
  shock_sag: (v) => `Bike on a stand, measure from the axle to a mark on the fender. Then sit on the bike in gear, centered, feet on the pegs, and measure again. The difference is race sag. Turn the preload collar until it reads ${v} mm, then lock it.`,
  shock_spring: (v) => `Spring rate ${v} N/mm is a part, not a click. If your shock spring is different, note it on the bike page.`,
};

export function locationCopy(key: AdjusterKey, value: string, unit: string, fork: ForkFamily, shock: ShockFamily, ctx?: LocationContext): LocationCopy {
  const isFork = key.startsWith("fork_");
  const where =
    ((isFork ? FORK_WHERE[fork][key] ?? FORK_WHERE.generic[key] : SHOCK_WHERE[shock][key] ?? SHOCK_WHERE.generic[key]) ??
      "Check your owner's manual for this adjuster's location.") + (isFork ? "" : shockSideNote(shock, key, ctx));
  const photo = isFork ? `fork/${fork}/${key}` : `shock/${shock}/${key}`;
  return { where, how: HOW[key](value, unit), photo };
}

const SHORT_NAME: Record<AdjusterKey, string> = {
  fork_air: "Air",
  fork_comp: "Compression",
  fork_reb: "Rebound",
  shock_sag: "Sag",
  shock_lsc: "Low speed",
  shock_hsc: "High speed",
  shock_reb: "Shock rebound",
  fork_spring: "Fork spring",
  shock_spring: "Shock spring",
};

/** "Compression: right fork leg, top cap" for the Adjust screen (finding 8,
 *  2026-09-08): the first sentence of the walkthrough copy. null when the
 *  family's row is a DRAFT or the manual fallback, so nothing is asserted. */
export function shortLocation(key: AdjusterKey, fork: ForkFamily, shock: ShockFamily, ctx?: LocationContext): string | null {
  const { where } = locationCopy(key, "", "", fork, shock, ctx);
  if (/^DRAFT|owner's manual/.test(where)) return null;
  const first = where.split(/(?<=\.)\s+/)[0]?.replace(/\.$/, "").trim();
  if (!first) return null;
  return `${SHORT_NAME[key]}: ${first.charAt(0).toLowerCase()}${first.slice(1)}`;
}

/** One card per settable adjuster, in the clicker sheet's order. */
export const WALKTHROUGH_ORDER: readonly AdjusterKey[] = ["fork_air", "fork_comp", "fork_reb", "shock_sag", "shock_lsc", "shock_hsc", "shock_reb"] as const;
