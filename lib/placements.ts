// lib/placements.ts
// RevenueCat Placements keyed by trigger (playbook §2: named triggers with
// trigger-specific offers served server-side, no app update). The placement
// picks the OFFERING; copy is client-side (lib/gateCopy.ts). Falls back to
// the current offering when a placement is unconfigured.
import Purchases, { type PurchasesOffering, type PurchasesPackage } from "react-native-purchases";
import { getOfferings, isWeb } from "./purchases";
import type { PaywallTrigger } from "./paywall";

export type GateTrigger = "log_moto" | "adjust" | "second_setup" | "second_bike" | "history" | "tire_pressure";

/** Every paywall trigger folds onto one of the six gate placements. */
export function gateTriggerFor(t: PaywallTrigger | GateTrigger): GateTrigger {
  switch (t) {
    case "log_moto":
    case "adjust":
    case "second_setup":
    case "second_bike":
    case "history":
    case "tire_pressure":
      return t;
    case "refine":
      return "adjust";
    case "setup_history":
      return "history";
    default:
      return "adjust";
  }
}

export function placementId(t: GateTrigger): string {
  return `feature_gate_${t}`;
}

export type TierPackages = { monthly: PurchasesPackage | null; annual: PurchasesPackage | null; lifetime: PurchasesPackage | null; offeringId: string | null };

function pick(o: PurchasesOffering | null | undefined): TierPackages {
  const pk = o?.availablePackages ?? [];
  const byType = (t: string) => pk.find((p: any) => p?.packageType === t) ?? null;
  return {
    monthly: byType("MONTHLY") ?? (o as any)?.monthly ?? null,
    annual: byType("ANNUAL") ?? (o as any)?.annual ?? null,
    lifetime: byType("LIFETIME") ?? (o as any)?.lifetime ?? null,
    offeringId: o?.identifier ?? null,
  };
}

/** Offering for a trigger's placement, else the current offering. */
export async function packagesForTrigger(t: GateTrigger | null): Promise<TierPackages> {
  if (isWeb) return { monthly: null, annual: null, lifetime: null, offeringId: null };
  try {
    if (t) {
      const placed = await Purchases.getCurrentOfferingForPlacement(placementId(t));
      if (placed) return pick(placed);
    }
  } catch {
    // placement unconfigured / offline → current offering
  }
  const all = await getOfferings();
  return pick(all?.current ?? null);
}

/** "$59.99" from a package, else null. */
export function packagePrice(p: PurchasesPackage | null): { amount: number; string: string; currency: string } | null {
  const pr: any = p?.product;
  if (!pr) return null;
  const amount = typeof pr.price === "number" ? pr.price : Number(pr.price);
  if (!Number.isFinite(amount)) return null;
  return { amount, string: typeof pr.priceString === "string" ? pr.priceString : `$${amount.toFixed(2)}`, currency: pr.currencyCode ?? "USD" };
}
