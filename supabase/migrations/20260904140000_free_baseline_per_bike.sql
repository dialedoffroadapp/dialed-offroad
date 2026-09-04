-- Free-tune reconciliation (River, 2026-09-04): the legacy "one free AI tune
-- ever" credit conflicts with the reveal-first Free/Pro model. New rule:
--   free riders get ONE BASELINE PER BIKE and may REGENERATE it (replaces the
--   running baseline; free UI shows current values only, history is Pro).
--   Pro gates: second setup, refine after ride, history, second bike.
-- Accounting stays server-side. STAGED, NOT PUSHED.
--
-- claim_free_tune gains an optional p_bike_id. Old clients (v2.4.0 in the
-- wild) call it with no arguments → the defaulted overload → the legacy
-- one-credit rule, unchanged. New clients pass the bike:
--   pro                       → ok, reason 'pro'            (no change)
--   bike has a baseline row   → ok, reason 'regenerate'     NOT consumed
--   bike has no baseline yet  → ok, reason 'first_baseline' consumed (count)
--   no bike (custom bike)     → legacy: ok 'trial' once, then no_trial
-- Both new cases stamp trial_claimed_at so ai-tune's existing interim
-- pass-through (CLIENT_CLAIM_GRACE_MS, migration 20260710180000) admits the
-- request that follows without the edge learning about bikes.id. The edge is
-- untouched; the grace window must therefore stay >= one generation round
-- trip until ai-tune's server claim takes a bike id (follow-up, flagged).
-- trial_tunes_used becomes "first baselines generated" (analytics), no
-- longer a hard cap for riders with a bike.

drop function if exists public.claim_free_tune();

create or replace function public.claim_free_tune(p_bike_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_profile public.profiles%ROWTYPE;
  v_now timestamptz := now();
  v_trial_limit int := 1;
  v_owns_bike boolean := false;
  v_has_baseline boolean := false;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_profile from public.profiles p where p.user_id = auth.uid() for update;
  if not found then
    insert into public.profiles (user_id, is_pro, pro_until, trial_tunes_used)
    values (auth.uid(), false, null, 0)
    returning * into v_profile;
  end if;

  if coalesce(v_profile.is_pro, false)
     or (v_profile.pro_until is not null and v_profile.pro_until > v_now) then
    return jsonb_build_object('ok', true, 'reason', 'pro',
      'trial_tunes_used', coalesce(v_profile.trial_tunes_used, 0));
  end if;

  if p_bike_id is not null then
    select exists (select 1 from public.bikes b where b.id = p_bike_id and b.user_id = auth.uid())
      into v_owns_bike;
    if v_owns_bike then
      select exists (
        select 1 from public.setup_versions v
         where v.user_id = auth.uid() and v.bike_id = p_bike_id
      ) into v_has_baseline;

      if v_has_baseline then
        -- Regenerate: replaces the running baseline. Not consumed.
        update public.profiles set trial_claimed_at = v_now where user_id = auth.uid();
        return jsonb_build_object('ok', true, 'reason', 'regenerate',
          'trial_tunes_used', coalesce(v_profile.trial_tunes_used, 0));
      end if;

      -- First baseline on this bike: counted, never capped per bike.
      update public.profiles
         set trial_tunes_used = coalesce(trial_tunes_used, 0) + 1,
             trial_claimed_at = v_now
       where user_id = auth.uid()
       returning * into v_profile;
      return jsonb_build_object('ok', true, 'reason', 'first_baseline',
        'trial_tunes_used', coalesce(v_profile.trial_tunes_used, 0));
    end if;
  end if;

  -- Legacy path (no bike / not the caller's bike): one credit, ever.
  if coalesce(v_profile.trial_tunes_used, 0) >= v_trial_limit then
    return jsonb_build_object('ok', false, 'reason', 'no_trial',
      'trial_tunes_used', coalesce(v_profile.trial_tunes_used, 0));
  end if;

  update public.profiles
     set trial_tunes_used = coalesce(trial_tunes_used, 0) + 1,
         trial_claimed_at = v_now
   where user_id = auth.uid()
   returning * into v_profile;

  return jsonb_build_object('ok', true, 'reason', 'trial',
    'trial_tunes_used', coalesce(v_profile.trial_tunes_used, 0));
end;
$$;

-- Grant idiom (CLAUDE.md): default ACLs grant EXECUTE to anon/authenticated
-- as individual roles, so revoke from anon explicitly.
revoke all on function public.claim_free_tune(uuid) from public, anon;
grant execute on function public.claim_free_tune(uuid) to authenticated;

comment on function public.claim_free_tune(uuid) is
  'Free baseline credit: one baseline per bike, regenerable (not consumed). No bike → legacy single credit. Stamps trial_claimed_at for ai-tune pass-through.';
