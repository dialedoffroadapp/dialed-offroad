/**
 * Derive whether a user has an active Pro subscription from their Supabase
 * profile row. Adds a 60-second buffer on `pro_until` to tolerate minor
 * clock skew between the device and the server.
 */
export function deriveIsPro(
  profile: { is_pro?: boolean | null; pro_until?: string | null } | null
): boolean {
  if (!profile) return false;
  if (profile.is_pro) return true;
  if (!profile.pro_until) return false;
  return new Date(profile.pro_until).getTime() > Date.now() - 60_000;
}

/**
 * Lapsed subscriber: once paid (pro_until was set by the RevenueCat webhook)
 * but no longer entitled. Distinct from free-tier users who never paid —
 * lapsed users get winback surfaces (their own history as the hook) instead
 * of the cold paywall.
 */
export function deriveIsLapsed(
  profile: { is_pro?: boolean | null; pro_until?: string | null } | null
): boolean {
  if (!profile) return false;
  if (deriveIsPro(profile)) return false;
  return !!profile.pro_until;
}
