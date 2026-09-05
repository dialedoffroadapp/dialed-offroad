// lib/adjusterPhotos.ts
// "Set it on the bike" photo registry: keyed by fork FAMILY (or shock family)
// first, then adjuster, so one WP XACT air shoot covers every bike on that
// fork. An empty slot renders NOTHING on the card (no placeholder, no
// "photo coming", no accessibility label). Metro needs static require paths,
// so each shot is registered here by hand:
//   assets/adjusters/fork/<ForkFamily>/<AdjusterKey>.jpg
//   assets/adjusters/shock/<ShockFamily>/<AdjusterKey>.jpg
// e.g. wp_xact_air: { fork_air: require("../assets/adjusters/fork/wp_xact_air/fork_air.jpg") }
import type { ImageSourcePropType } from "react-native";
import type { AdjusterKey } from "./adjusterCopy";
import type { ForkFamily, ShockFamily } from "./adjusterLocations";

type Slots = Partial<Record<AdjusterKey, ImageSourcePropType>>;

/** Fork-side adjusters (fork_air, fork_comp, fork_reb) by fork family. */
export const FORK_PHOTOS: Partial<Record<ForkFamily, Slots>> = {};

/** Shock-side adjusters (shock_sag, shock_lsc, shock_hsc, shock_reb) by shock family. */
export const SHOCK_PHOTOS: Partial<Record<ShockFamily, Slots>> = {};

/** The registered shot for this adjuster on this bike's fork / shock family, else null. */
export function adjusterPhoto(key: AdjusterKey, fork: ForkFamily, shock: ShockFamily): ImageSourcePropType | null {
  const slot = key.startsWith("fork_") ? FORK_PHOTOS[fork]?.[key] : SHOCK_PHOTOS[shock]?.[key];
  return slot ?? null;
}
