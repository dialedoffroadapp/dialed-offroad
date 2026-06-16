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
