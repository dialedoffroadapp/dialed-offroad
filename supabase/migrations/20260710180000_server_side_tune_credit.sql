-- H2 support: server-side free-credit enforcement in the ai-tune function.
--
-- The free-tune quota was client-enforced only (tune.tsx calls
-- claim_free_tune before invoking ai-tune), so direct API calls bypassed the
-- credit entirely and the claim/refund pairing was client-trusted. ai-tune
-- now enforces Pro/credit itself (service role, atomic guarded update).
--
-- This migration adds the interim-compatibility signal: deployed v2.0.x
-- clients claim client-side FIRST and then call ai-tune — a second,
-- server-side claim would double-consume and reject legitimate first tunes.
-- claim_free_tune therefore stamps trial_claimed_at when (and only when) it
-- consumes the credit; ai-tune treats "credit consumed + fresh stamp" as a
-- request that carries the client's claim and passes it through WITHOUT
-- claiming again. Server-side claims deliberately do NOT stamp, so a
-- server-claimed request opens no grace window of its own.
--
-- refund_free_tune clears the stamp so a refunded credit leaves no stale
-- window behind.
--
-- trial_claimed_at gets NO client INSERT/UPDATE grants — 20260710170000
-- moved profiles to column-level grants, so new columns are locked by
-- default. (Table-level SELECT still exposes it read-only; harmless.)
--
-- Interim abuse ceiling, accepted and time-boxed: within the grace window a
-- signed-in user who claims via the RPC can pass extra direct calls for
-- ~2 minutes, bounded by the 20/hour rate limit. Strictly better than the
-- pre-fix state (same rate limit, NO credit check at all); drops to zero
-- when the grace window is removed after pre-claiming clients age out.

alter table public.profiles
  add column if not exists trial_claimed_at timestamptz;

-- claim_free_tune: identical to the production definition (read 2026-07-10)
-- plus the trial_claimed_at stamp on the consuming update.
create or replace function public.claim_free_tune()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_profile public.profiles%ROWTYPE;
  v_now timestamptz := now();
  v_trial_limit int := 1;
begin
  -- must be signed in
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- lock the profile row for this user
  select *
  into v_profile
  from public.profiles p
  where p.user_id = auth.uid()
  for update;

  -- if there is no profile row yet, create one with 0 trials used
  if not found then
    insert into public.profiles (user_id, is_pro, pro_until, trial_tunes_used)
    values (auth.uid(), false, null, 0)
    returning * into v_profile;
  end if;

  -- check Pro entitlement
  if coalesce(v_profile.is_pro, false)
     or (v_profile.pro_until is not null and v_profile.pro_until > v_now) then
    return jsonb_build_object(
      'ok', true,
      'reason', 'pro',
      'trial_tunes_used', coalesce(v_profile.trial_tunes_used, 0)
    );
  end if;

  -- trial already used?
  if coalesce(v_profile.trial_tunes_used, 0) >= v_trial_limit then
    return jsonb_build_object(
      'ok', false,
      'reason', 'no_trial',
      'trial_tunes_used', coalesce(v_profile.trial_tunes_used, 0)
    );
  end if;

  -- consume one trial + stamp the client-claim window for ai-tune's
  -- interim pass-through
  update public.profiles
  set trial_tunes_used = coalesce(trial_tunes_used, 0) + 1,
      trial_claimed_at = v_now
  where user_id = auth.uid()
  returning * into v_profile;

  return jsonb_build_object(
    'ok', true,
    'reason', 'trial',
    'trial_tunes_used', coalesce(v_profile.trial_tunes_used, 0)
  );
end;
$$;

-- refund_free_tune: identical to 20260710120000 plus clearing the stamp.
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
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = auth.uid()
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'reason', 'no_profile',
      'trial_tunes_used', 0
    );
  end if;

  if coalesce(v_profile.is_pro, false)
     or (v_profile.pro_until is not null and v_profile.pro_until > v_now) then
    return jsonb_build_object(
      'ok', true,
      'reason', 'pro',
      'trial_tunes_used', coalesce(v_profile.trial_tunes_used, 0)
    );
  end if;

  if coalesce(v_profile.trial_tunes_used, 0) <= 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'nothing_claimed',
      'trial_tunes_used', 0
    );
  end if;

  update public.profiles
  set trial_tunes_used = greatest(coalesce(trial_tunes_used, 0) - 1, 0),
      trial_claimed_at = null
  where user_id = auth.uid()
  returning * into v_profile;

  return jsonb_build_object(
    'ok', true,
    'reason', 'refunded',
    'trial_tunes_used', coalesce(v_profile.trial_tunes_used, 0)
  );
end;
$$;

revoke all on function public.claim_free_tune() from public;
grant execute on function public.claim_free_tune() to authenticated;
revoke all on function public.refund_free_tune() from public;
grant execute on function public.refund_free_tune() to authenticated;
