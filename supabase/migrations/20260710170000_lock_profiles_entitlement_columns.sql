-- Lock the entitlement columns on profiles (fixes INT-7 privilege escalation).
--
-- scripts/integration-check.mjs INT-7 proved a signed-in user could PATCH
-- their own profiles row with is_pro=true / pro_until=2030 using only the
-- anon key + their JWT — self-granting Pro, since every gate reads exactly
-- those columns (lib/proUtils.ts deriveIsPro). Root cause: table-level
-- INSERT/UPDATE grants to anon+authenticated cover every column, and the
-- own-row RLS policies constrain WHICH rows you touch, not WHICH columns.
--
-- Fix: column-level grants, mirroring the ride_feedback approach — revoke
-- the blanket INSERT/UPDATE and regrant only the columns the client
-- legitimately writes. INSERT is locked alongside UPDATE because a fresh
-- account has no profiles row yet: without it, a user could self-grant by
-- POSTing their first row with is_pro=true.
--
-- Protected (server-only) columns:
--   is_pro, pro_until       — written by the RevenueCat webhook, which uses
--                             the service role key (verified:
--                             supabase/functions/revenuecat-webhook/index.ts
--                             lines 9-15) and is unaffected by these grants.
--   trial_tunes_used        — written only by claim_free_tune /
--                             refund_free_tune, both SECURITY DEFINER
--                             (verified against production 2026-07-10);
--                             repo-wide grep confirms no client write.
--
-- Client-writable columns = every OTHER column the app actually writes
-- (verified by grepping all supabase.from("profiles") write sites), plus the
-- accepted_* consent columns. NOTE, discovered while building this list:
-- the app also upserts onboarding_step / onboarding_complete / theme_key,
-- but those columns DO NOT EXIST in production profiles — every such write
-- already fails silently (PGRST204) and is unaffected by this migration.
-- If those columns are ever added, extend the grants below.
--
-- Known intentional degradations after this migration (both fail-soft):
--   * lib/purchases.ts syncProFromRevenueCat can no longer client-write
--     is_pro/pro_until — it already treats failure as "defer to webhook".
--   * app/premium.tsx forceProForDev (__DEV__-only) can no longer flip
--     is_pro directly against production.

-- UPDATE: revoke blanket, regrant legitimate columns. user_id and updated_at
-- are included because PostgREST upserts SET every payload column on
-- conflict (profile.tsx / lib/profiles.ts send both); the own-row RLS
-- policies still prevent pointing user_id at anyone else.
revoke update on table public.profiles from anon, authenticated;
grant update (
  user_id,
  display_name,
  avatar_url,
  experience,
  location,
  dark_mode,
  accepted_terms_at,
  accepted_terms_version,
  accepted_risk_at,
  accepted_risk_version,
  accepted_privacy_at,
  accepted_privacy_version,
  updated_at
) on public.profiles to authenticated;

-- INSERT: same shape (created_at is defaulted; clients never send it).
-- claim_free_tune's insert-if-missing runs as SECURITY DEFINER — unaffected.
revoke insert on table public.profiles from anon, authenticated;
grant insert (
  user_id,
  display_name,
  avatar_url,
  experience,
  location,
  dark_mode,
  accepted_terms_at,
  accepted_terms_version,
  accepted_risk_at,
  accepted_risk_version,
  accepted_privacy_at,
  accepted_privacy_version,
  updated_at
) on public.profiles to authenticated;

-- anon gets no write access at all (RLS already blocked it — auth.uid() is
-- null — but there is no reason for the grants to exist).
