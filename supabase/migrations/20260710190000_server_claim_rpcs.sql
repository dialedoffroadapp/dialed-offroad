-- H2 follow-up: atomic server-side claim/refund RPCs for the ai-tune function.
--
-- The first implementation used a PostgREST guarded update
-- (PATCH ...&or=(trial_tunes_used.is.null,trial_tunes_used.lt.1)), which
-- Postgres rejects with 42703 "column profiles.trial_tunes_used does not
-- exist" — a PostgREST quirk with logic-tree filters on UPDATE (the same
-- column selects fine). The function's fail-open error handling then let
-- every request through unclaimed. These SECURITY DEFINER functions do the
-- claim atomically under the same row lock claim_free_tune uses, callable
-- ONLY by service_role (the edge function's client).
--
-- Split of responsibilities: SQL decides pro/claimed/no_trial and reports
-- trial_claimed_at; the edge function applies the interim old-client
-- pass-through window on top (see ai-tune/index.ts H2 comment).
-- Server claims deliberately do NOT stamp trial_claimed_at — only the
-- client RPC claim_free_tune stamps, so a server claim opens no grace
-- window of its own.

create or replace function public.server_claim_free_tune(p_user_id uuid)
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
  select * into v_profile
  from public.profiles p
  where p.user_id = p_user_id
  for update;

  if not found then
    -- Direct-API caller whose profile row doesn't exist yet (the
    -- on_auth_user_created trigger normally creates it). Race-safe create,
    -- then re-lock.
    insert into public.profiles (user_id, is_pro, pro_until, trial_tunes_used)
    values (p_user_id, false, null, 0)
    on conflict (user_id) do nothing;

    select * into v_profile
    from public.profiles p
    where p.user_id = p_user_id
    for update;
  end if;

  if coalesce(v_profile.is_pro, false)
     or (v_profile.pro_until is not null and v_profile.pro_until > v_now) then
    return jsonb_build_object('ok', true, 'reason', 'pro');
  end if;

  if coalesce(v_profile.trial_tunes_used, 0) >= v_trial_limit then
    -- Not claimable — report the client-claim stamp so the caller can apply
    -- the interim pass-through window.
    return jsonb_build_object(
      'ok', false,
      'reason', 'no_trial',
      'claimed_at', v_profile.trial_claimed_at
    );
  end if;

  -- Consume WITHOUT stamping trial_claimed_at (server claims never open a
  -- pass-through window; only client claims via claim_free_tune stamp).
  update public.profiles
  set trial_tunes_used = coalesce(trial_tunes_used, 0) + 1
  where user_id = p_user_id;

  return jsonb_build_object('ok', true, 'reason', 'claimed');
end;
$$;

-- Exact inverse of a server claim, guarded so it can only undo a consumed
-- credit. Leaves trial_claimed_at alone (server claims never set it).
create or replace function public.server_refund_free_tune(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rows int;
begin
  update public.profiles
  set trial_tunes_used = greatest(coalesce(trial_tunes_used, 0) - 1, 0)
  where user_id = p_user_id
    and coalesce(trial_tunes_used, 0) >= 1;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok', v_rows > 0);
end;
$$;

-- Service-role only: these take an arbitrary user id, so client roles must
-- never be able to execute them.
revoke all on function public.server_claim_free_tune(uuid) from public, anon, authenticated;
grant execute on function public.server_claim_free_tune(uuid) to service_role;
revoke all on function public.server_refund_free_tune(uuid) from public, anon, authenticated;
grant execute on function public.server_refund_free_tune(uuid) to service_role;
