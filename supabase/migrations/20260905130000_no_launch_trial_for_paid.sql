-- Decision 8 (2026-09-04): no launch trial for any account that ever paid;
-- winback is an email job. The launch_3_0 reason is refused whenever the
-- profile carries a pro_until (lapsed or live) or is_pro. Also hardens the
-- app_config reads (audit S3): (value #>> '{}') tolerates a jsonb string
-- where (value)::text::integer raised. Same body as 20260904150000 otherwise.
create or replace function public.start_reverse_trial(p_reason text default 'reveal')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_profile public.profiles%rowtype;
  v_now timestamptz := now();
  v_days integer := coalesce((select (value #>> '{}')::integer from public.app_config where key = 'trial_days'), 21);
  v_rides integer := coalesce((select (value #>> '{}')::integer from public.app_config where key = 'trial_ride_days'), 3);
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_profile from public.profiles p where p.user_id = auth.uid() for update;
  if not found then
    insert into public.profiles (user_id, is_pro, pro_until, trial_tunes_used)
    values (auth.uid(), false, null, 0) returning * into v_profile;
  end if;

  if coalesce(v_profile.is_pro, false) or (v_profile.pro_until is not null and v_profile.pro_until > v_now) then
    return jsonb_build_object('state', 'pro', 'started', false);
  end if;
  -- Ever paid (lapsed subscription, expired pro_until): no launch trial.
  if p_reason = 'launch_3_0' and (v_profile.pro_until is not null or coalesce(v_profile.is_pro, false)) then
    return jsonb_build_object('state', v_profile.entitlement_state, 'started', false, 'refused', 'ever_paid');
  end if;
  if v_profile.trial_started_at is not null then
    return jsonb_build_object('state', v_profile.entitlement_state, 'started', false,
      'trial_ends_at', v_profile.trial_ends_at, 'trial_ride_day_limit', v_profile.trial_ride_day_limit);
  end if;

  update public.profiles
     set entitlement_state = 'trial_active',
         trial_started_at = v_now,
         trial_ends_at = v_now + make_interval(days => v_days),
         trial_ride_day_limit = v_rides,
         trial_start_reason = p_reason
   where user_id = auth.uid()
   returning * into v_profile;

  return jsonb_build_object('state', 'trial_active', 'started', true,
    'trial_started_at', v_profile.trial_started_at, 'trial_ends_at', v_profile.trial_ends_at,
    'trial_ride_day_limit', v_profile.trial_ride_day_limit, 'trial_ride_days', 0);
end;
$$;
revoke all on function public.start_reverse_trial(text) from public, anon;
grant execute on function public.start_reverse_trial(text) to authenticated;
