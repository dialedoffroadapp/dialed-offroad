-- Decision 3 (engine discovery, 2026-09-05): the ai-tune edge enforces the
-- per-bike rule itself, independent of the hourly abuse limit.
--   pro                              → allowed, nothing consumed
--   owned bike with a baseline       → REGENERATE, nothing consumed, capped at
--                                      app_config.regenerates_per_day (5) per
--                                      rolling 24 h per bike, counted from the
--                                      tune_calls rows that produced an output
--   owned bike without a baseline    → FIRST BASELINE, counted once in
--                                      trial_tunes_used (unless the client RPC
--                                      claim_free_tune counted it moments ago)
--   no bike / not the caller's bike  → the legacy single credit
-- The 2-minute client-claim grace window (migration 20260710180000) moves
-- from the edge into this function as the double-consume guard: a fresh
-- trial_claimed_at stamp means claim_free_tune already counted this request.
-- Server claims never stamp. server_claim_free_tune (20260710190000) stays
-- for reference; the edge no longer calls it. STAGED, NOT PUSHED.

insert into public.app_config (key, value)
values ('regenerates_per_day', '5'::jsonb)
on conflict (key) do nothing;

create or replace function public.server_claim_baseline(p_user_id uuid, p_bike_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_profile public.profiles%rowtype;
  v_now timestamptz := now();
  v_trial_limit int := 1;
  v_regen_limit int := coalesce((select (value #>> '{}')::integer from public.app_config where key = 'regenerates_per_day'), 5);
  v_owns boolean := false;
  v_has_baseline boolean := false;
  v_regens int := 0;
  v_grace boolean := false;
begin
  select * into v_profile from public.profiles p where p.user_id = p_user_id for update;
  if not found then
    insert into public.profiles (user_id, is_pro, pro_until, trial_tunes_used)
    values (p_user_id, false, null, 0)
    on conflict (user_id) do nothing;
    select * into v_profile from public.profiles p where p.user_id = p_user_id for update;
  end if;

  if coalesce(v_profile.is_pro, false)
     or (v_profile.pro_until is not null and v_profile.pro_until > v_now) then
    return jsonb_build_object('ok', true, 'reason', 'pro');
  end if;

  -- A fresh client-side claim (claim_free_tune stamps; server claims never do)
  -- means this request was already counted by the RPC.
  v_grace := v_profile.trial_claimed_at is not null
             and v_profile.trial_claimed_at > v_now - interval '2 minutes';

  if p_bike_id is not null then
    select exists (select 1 from public.bikes b where b.id = p_bike_id and b.user_id = p_user_id)
      into v_owns;
    if v_owns then
      select exists (select 1 from public.setup_versions v where v.user_id = p_user_id and v.bike_id = p_bike_id)
        into v_has_baseline;

      if v_has_baseline then
        select count(*) into v_regens
          from public.tune_calls t
         where t.user_id = p_user_id
           and t.mode = 'zero_baseline_v1'
           and t.input->>'bike_id' = p_bike_id::text
           and t.output is not null
           and t.created_at > v_now - interval '24 hours';
        if v_regens >= v_regen_limit then
          return jsonb_build_object('ok', false, 'reason', 'regenerate_limit',
            'regenerates_today', v_regens, 'limit', v_regen_limit);
        end if;
        return jsonb_build_object('ok', true, 'reason', 'regenerate',
          'regenerates_today', v_regens, 'limit', v_regen_limit);
      end if;

      -- First baseline on this bike: counted once, never capped per bike.
      if not v_grace then
        update public.profiles
           set trial_tunes_used = coalesce(trial_tunes_used, 0) + 1
         where user_id = p_user_id;
      end if;
      return jsonb_build_object('ok', true, 'reason', 'first_baseline', 'claimed', not v_grace);
    end if;
  end if;

  -- Legacy path (no bike, or not the caller's bike): one credit, ever.
  if v_grace then
    return jsonb_build_object('ok', true, 'reason', 'client_claimed');
  end if;
  if coalesce(v_profile.trial_tunes_used, 0) >= v_trial_limit then
    return jsonb_build_object('ok', false, 'reason', 'no_trial');
  end if;
  update public.profiles
     set trial_tunes_used = coalesce(trial_tunes_used, 0) + 1
   where user_id = p_user_id;
  return jsonb_build_object('ok', true, 'reason', 'claimed', 'claimed', true);
end;
$$;

revoke all on function public.server_claim_baseline(uuid, uuid) from public, anon, authenticated;
grant execute on function public.server_claim_baseline(uuid, uuid) to service_role;

comment on function public.server_claim_baseline(uuid, uuid) is
  'ai-tune baseline gate (service role): pro passes; owned bike with a baseline = regenerate (not consumed, capped per rolling day by app_config.regenerates_per_day); owned bike without one = first baseline (counted once); no bike = legacy single credit. A fresh trial_claimed_at stamp = the client RPC already counted this request.';
