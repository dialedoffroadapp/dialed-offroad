-- Refund path for claim_free_tune.
--
-- The client claims the free-tune credit BEFORE calling the AI engine — this
-- ordering is deliberate (claiming after generation would allow free-credit
-- race abuse). The cost was that a generation timeout/failure consumed the
-- user's only free credit with nothing delivered. refund_free_tune reverses
-- exactly what claim_free_tune does: decrement profiles.trial_tunes_used by
-- one, floored at zero, under the same row lock.
--
-- Provenance: claim_free_tune is NOT in repo migrations (it was applied
-- directly to the live database). Its definition was read from production on
-- 2026-07-10 and this function mirrors its exact shape — profiles.%ROWTYPE,
-- FOR UPDATE row lock, and columns user_id / is_pro / pro_until /
-- trial_tunes_used. If claim_free_tune changes, change this to match.
--
-- Known limitation (accepted, documented): any client-callable refund can be
-- farmed (claim → generate → refund → repeat). This does not weaken the
-- current posture — the ai-tune edge function enforces only an hourly abuse
-- rate limit (see 20260707090000_tune_calls_rate_limit.sql), not the product
-- quota, so direct calls already bypass the credit. A server-side pairing of
-- claims to delivered generations is the real fix and is out of scope here.

create or replace function public.refund_free_tune()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_profile public.profiles%ROWTYPE;
  v_now timestamptz := now();
begin
  -- must be signed in (mirrors claim_free_tune)
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- lock the profile row for this user (same lock claim_free_tune takes)
  select *
  into v_profile
  from public.profiles p
  where p.user_id = auth.uid()
  for update;

  -- no profile row → nothing was ever claimed
  if not found then
    return jsonb_build_object(
      'ok', false,
      'reason', 'no_profile',
      'trial_tunes_used', 0
    );
  end if;

  -- Pro entitlement never consumes a credit in claim_free_tune, so there is
  -- nothing to refund; report ok so callers don't treat this as an error.
  if coalesce(v_profile.is_pro, false)
     or (v_profile.pro_until is not null and v_profile.pro_until > v_now) then
    return jsonb_build_object(
      'ok', true,
      'reason', 'pro',
      'trial_tunes_used', coalesce(v_profile.trial_tunes_used, 0)
    );
  end if;

  -- nothing claimed → nothing to refund
  if coalesce(v_profile.trial_tunes_used, 0) <= 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'nothing_claimed',
      'trial_tunes_used', 0
    );
  end if;

  -- reverse the claim: decrement, floored at zero
  update public.profiles
  set trial_tunes_used = greatest(coalesce(trial_tunes_used, 0) - 1, 0)
  where user_id = auth.uid()
  returning * into v_profile;

  return jsonb_build_object(
    'ok', true,
    'reason', 'refunded',
    'trial_tunes_used', coalesce(v_profile.trial_tunes_used, 0)
  );
end;
$$;

revoke all on function public.refund_free_tune() from public;
grant execute on function public.refund_free_tune() to authenticated;
