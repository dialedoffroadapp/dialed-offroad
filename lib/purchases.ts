import Constants from "expo-constants";
import { Platform } from "react-native";
import Purchases, {
  CustomerInfo,
  LOG_LEVEL,
  Offerings,
  PurchasesPackage,
} from "react-native-purchases";
import { supabase } from "./supabase";

/** RevenueCat SDK is native-only; guard web. */
export const isWeb = Platform.OS !== "ios" && Platform.OS !== "android";

/** Read RC keys from Expo config (set in app.config.ts -> extra.*). */
const extra: any =
  (Constants as any)?.expoConfig?.extra ??
  (Constants as any)?.manifest?.extra ??
  {};

// Expect these to be set in app.config.ts
const RC_PUBLIC_IOS_KEY: string | undefined =
  typeof extra.RC_PUBLIC_IOS_KEY === "string"
    ? extra.RC_PUBLIC_IOS_KEY.trim()
    : undefined;

const RC_PUBLIC_ANDROID_KEY: string | undefined =
  typeof extra.RC_PUBLIC_ANDROID_KEY === "string"
    ? extra.RC_PUBLIC_ANDROID_KEY.trim()
    : undefined;

/** Validate the key matches the current platform. */
function keyLooksValidForPlatform(key: string | undefined): boolean {
  if (!key) return false;
  const isIOS = Platform.OS === "ios";
  const isAndroid = Platform.OS === "android";
  const prefix = key.slice(0, 5); // appl_, goog_, web_
  if (isIOS) return prefix === "appl_";
  if (isAndroid) return prefix === "goog_";
  return false;
}

/** Pick the right key for this platform. */
function getPlatformKey(): string | undefined {
  return Platform.select({
    ios: RC_PUBLIC_IOS_KEY,
    android: RC_PUBLIC_ANDROID_KEY,
    default: undefined,
  });
}

let configured = false;

/**
 * Session-level purchase flag. Set SYNCHRONOUSLY in every purchase success
 * handler BEFORE any navigation or onboarding state advance; checked by every
 * paywall presentation point. Once a purchase succeeds in-session, no gate may
 * present the paywall again — profile reads and RevenueCat cache can lag, but
 * this flag cannot. Cleared on sign-out (resetPurchases).
 */
let purchasedThisSession = false;

export function markPurchasedThisSession(): void {
  purchasedThisSession = true;
}

export function hasPurchasedThisSession(): boolean {
  return purchasedThisSession;
}

/**
 * Reset RevenueCat state on sign-out so the next user gets a clean session.
 * Call this before navigating to the login screen on sign-out or account deletion.
 */
export async function resetPurchases(): Promise<void> {
  if (isWeb) return;
  try {
    if (configured) {
      await Purchases.logOut();
    }
  } catch (e) {
    if (__DEV__) console.warn("[RC] logOut error:", e);
  } finally {
    configured = false;
    purchasedThisSession = false; // next user must not inherit the flag
  }
}

/**
 * Init RevenueCat and (optionally) log in a specific Supabase user.
 *
 * - Call once on app start with no args:    initPurchases()
 * - After auth, call again with user.id:    initPurchases(user.id)
 */
export async function initPurchases(userId?: string) {
  if (isWeb) return;

  const apiKey = getPlatformKey();
  if (!keyLooksValidForPlatform(apiKey)) {
    if (__DEV__) {
      const where = Platform.OS;
      console.warn(
        `[RC] Missing or invalid RevenueCat key for ${where}.` +
          ` Expected a ${
            where === "ios" ? "`appl_...`" : "`goog_...`"
          } public key.` +
          ` Check your env + app.config.ts (extra.RC_PUBLIC_${
            where === "ios" ? "IOS" : "ANDROID"
          }_KEY).`
      );
    }
    return;
  }

  try {
    // 1) Configure once per app launch
    if (!configured) {
      Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.INFO);
      await Purchases.configure({ apiKey: apiKey as string });
      configured = true;
      if (__DEV__) console.log("[RC] Purchases configured ✅");
    }

    // 2) If we have a user id, log them in even if already configured
    if (userId) {
      try {
        const info = await Purchases.logIn(userId);
        if (__DEV__) {
          console.log("[RC] logIn ✅", {
            appUserId: info?.customerInfo?.originalAppUserId ?? userId,
          });
        }
      } catch (e) {
        console.warn("[RC] logIn failed:", e);
      }
    }
  } catch (e) {
    console.warn("[RC] initPurchases error:", e);
  }
}

/** Safe on web; returns null there. */
export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (isWeb) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch (e) {
    if (__DEV__) console.warn("[RC] getCustomerInfo error:", e);
    return null;
  }
}

/**
 * Drop the SDK's cached customer info so the next getCustomerInfo() hits the
 * network. The cache can lag a just-completed purchase, which is how a fresh
 * subscriber can be told they aren't Pro.
 */
export async function invalidateCustomerInfoCache(): Promise<void> {
  if (isWeb) return;
  try {
    await Purchases.invalidateCustomerInfoCache();
  } catch (e) {
    if (__DEV__) console.warn("[RC] invalidateCustomerInfoCache error:", e);
  }
}

export async function getOfferings(): Promise<Offerings | null> {
  if (isWeb) return null;
  try {
    return await Purchases.getOfferings();
  } catch (e) {
    if (__DEV__) console.warn("[RC] getOfferings error:", e);
    return null;
  }
}

export async function purchasePackage(
  pkg: PurchasesPackage
): Promise<CustomerInfo | null> {
  if (isWeb) return null;
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return customerInfo;
  } catch (e: any) {
    if (!e?.userCancelled) console.warn("[RC] purchasePackage error:", e);
    return null;
  }
}

export async function restorePurchases(): Promise<CustomerInfo | null> {
  if (isWeb) return null;
  try {
    return await Purchases.restorePurchases();
  } catch (e) {
    if (__DEV__) console.warn("[RC] restorePurchases error:", e);
    return null;
  }
}

/** Helper: whether “pro” entitlement is active. */
export function isPro(info: CustomerInfo | null | undefined): boolean {
  return !!info?.entitlements?.active?.pro;
}

/** Helper: pull metadata for the active `pro` entitlement. */
export function activeProMeta(
  info: CustomerInfo | null | undefined
): {
  isPro: boolean;
  expiration: string | null;
  productId: string | null;
} {
  const ent: any = info?.entitlements?.active?.pro ?? null;
  return {
    isPro: !!ent,
    expiration: ent?.expirationDate ?? null, // ISO string or null for lifetime
    productId: ent?.productIdentifier ?? null, // e.g. com.dialedoffroad.app.pro_monthly
  };
}

/**
 * Sync the current device's RevenueCat `pro` entitlement into Supabase.
 *
 * - No-op on web.
 * - No-op if the user isn't signed in.
 * - Upserts `profiles.is_pro` and `profiles.pro_until`.
 */
export async function syncProFromRevenueCat(opts?: {
  /**
   * By default this sync only UPGRADES the profile. Downgrades (expiry,
   * cancellation) are the RevenueCat webhook's job — a stale or anonymous
   * customer-info read on the client must never wipe a real Pro entitlement
   * (which re-shows the paywall to a paying user).
   */
  allowDowngrade?: boolean;
}): Promise<boolean> {
  if (isWeb) return false;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user?.id) return false;

    // The SDK cache can lag a just-completed purchase — always read fresh
    // before writing anything to the profile.
    await invalidateCustomerInfoCache();
    const info = await getCustomerInfo();
    if (!info) return false;

    const { isPro: hasPro, expiration } = activeProMeta(info);

    if (!hasPro && !opts?.allowDowngrade) {
      if (__DEV__) console.log("[RC] sync: no entitlement, downgrade skipped");
      return false;
    }

    const payload: any = {
      user_id: user.id,
      is_pro: hasPro,
      pro_until: hasPro ? expiration : null,
    };

    const { error } = await supabase.from("profiles").upsert(payload);
    if (error) {
      console.warn("[RC] syncProFromRevenueCat upsert failed:", error);
      return false;
    }
    if (__DEV__) console.log("[RC] Synced pro → Supabase", payload);
    return true;
  } catch (e) {
    if (__DEV__) console.warn("[RC] syncProFromRevenueCat error:", e);
    return false;
  }
}
