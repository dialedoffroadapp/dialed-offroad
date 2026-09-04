-- Conversion model (River, 2026-09-04; playbook: compass_artifact_wf-8f89db56,
-- "The Free-to-Paid Conversion Playbook"). STAGED, NOT PUSHED.
--
-- Entitlement state machine, server-side source of truth:
--   trial_active  usage-anchored reverse trial: full Pro through the first
--                 N logged ride days OR D days, whichever first, NO card
--                 (playbook §4 + Details "reverse-trial-plus-day-pass":
--                 short opt-in trials fail for episodic use; anchor to usage)
--   free          post-trial: one baseline per bike (regenerable); loop,
--                 history, extra setups, second bike locked; history keeps
--                 accruing (§3 silent history / Slopes precedent)
--   pro           RevenueCat entitlement (profiles.is_pro / pro_until, written
--                 by the webhook) layered ON TOP: pro always wins
-- Downgrade is a state change, never deletion. Every new account enters
-- trial_active at the reveal; at 3.0 launch existing free accounts enter it
-- on next open ("Pro is on for your next 3 rides"). Clients cache.

alter table public.profiles
  add column if not exists entitlement_state text not null default 'free'
    check (entitlement_state in ('trial_active', 'free', 'pro')),
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists trial_ride_day_limit integer not null default 3,
  add column if not exists trial_ended_at timestamptz,
  add column if not exists trial_end_reason text
    check (trial_end_reason in ('ride_days', 'clock', 'purchase')),
  add column if not exists trial_start_reason text,
  add column if not exists downgraded_at timestamptz;

-- profiles uses column-level grants: readable by the client, written ONLY by
-- the RPCs below (security definer). No client INSERT/UPDATE on these.
grant select (entitlement_state, trial_started_at, trial_ends_at, trial_ride_day_limit,
              trial_ended_at, trial_end_reason, trial_start_reason, downgraded_at)
  on public.profiles to authenticated;

-- Remote config seeds (lib/remoteConfig.ts). ON CONFLICT DO NOTHING keeps
-- dashboard edits. lifetime_price_usd is a display fallback only: the
-- RevenueCat package price is the truth when the SDK has it.
insert into public.app_config (key, value) values
  ('trial_ride_days', '3'::jsonb),
  ('trial_days', '21'::jsonb),
  ('lifetime_price_usd', '129'::jsonb),
  ('lifetime_min_ride_days', '3'::jsonb),
  ('launch_3_0_at', 'null'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Ride days counted toward the trial = ended ride days since the trial start.
-- Sync is offline-first and best-effort (lib/rideDay.ts outbox), so a lagging
-- sync only ever LENGTHENS the trial. Never shortens it.
-- ---------------------------------------------------------------------------
create or replace function public._trial_ride_days(p_user_id uuid, p_since timestamptz)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.ride_days r
   where r.user_id = p_user_id
     and r.ended_at is not null
     and r.started_at >= coalesce(p_since, '-infinity'::timestamptz);
$$;
revoke all on function public._trial_ride_days(uuid, timestamptz) from public, anon, authenticated;

-- start_reverse_trial: idempotent. Eligible when not Pro and no trial was
-- ever started. p_reason: 'reveal' (new account) | 'launch_3_0' (existing
-- free account, first open after launch) | 'manual'.
create or replace function public.start_reverse_trial(p_reason text default 'reveal')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_profile public.profiles%rowtype;
  v_now timestamptz := now();
  v_days integer := coalesce((select (value)::text::integer from public.app_config where key = 'trial_days'), 21);
  v_rides integer := coalesce((select (value)::text::integer from public.app_config where key = 'trial_ride_days'), 3);
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

-- resolve_entitlement: the read every client does on open / focus / after
-- End ride. Applies the trial → free transition (state change, nothing
-- deleted) and returns the current state with its anchors.
create or replace function public.resolve_entitlement()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_profile public.profiles%rowtype;
  v_now timestamptz := now();
  v_rides integer := 0;
  v_reason text := null;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_profile from public.profiles p where p.user_id = auth.uid() for update;
  if not found then
    return jsonb_build_object('state', 'free', 'trial_ride_days', 0);
  end if;

  -- Pro (RevenueCat, via the webhook) wins over everything.
  if coalesce(v_profile.is_pro, false) or (v_profile.pro_until is not null and v_profile.pro_until > v_now) then
    if v_profile.entitlement_state = 'trial_active' then
      update public.profiles set entitlement_state = 'pro', trial_ended_at = v_now, trial_end_reason = 'purchase'
       where user_id = auth.uid();
    elsif v_profile.entitlement_state <> 'pro' then
      update public.profiles set entitlement_state = 'pro' where user_id = auth.uid();
    end if;
    return jsonb_build_object('state', 'pro', 'pro_until', v_profile.pro_until,
      'trial_started_at', v_profile.trial_started_at, 'downgraded_at', v_profile.downgraded_at);
  end if;

  -- Lapsed Pro (webhook revoked) lands in free, not back into a trial.
  if v_profile.entitlement_state = 'pro' then
    update public.profiles set entitlement_state = 'free', downgraded_at = v_now where user_id = auth.uid()
      returning * into v_profile;
  end if;

  if v_profile.entitlement_state = 'trial_active' then
    v_rides := public._trial_ride_days(auth.uid(), v_profile.trial_started_at);
    if v_rides >= coalesce(v_profile.trial_ride_day_limit, 3) then v_reason := 'ride_days';
    elsif v_profile.trial_ends_at is not null and v_now >= v_profile.trial_ends_at then v_reason := 'clock';
    end if;
    if v_reason is not null then
      update public.profiles
         set entitlement_state = 'free', trial_ended_at = v_now, trial_end_reason = v_reason, downgraded_at = v_now
       where user_id = auth.uid()
       returning * into v_profile;
      return jsonb_build_object('state', 'free', 'just_ended', true, 'trial_end_reason', v_reason,
        'trial_ride_days', v_rides, 'trial_ride_day_limit', v_profile.trial_ride_day_limit,
        'trial_started_at', v_profile.trial_started_at, 'trial_ends_at', v_profile.trial_ends_at,
        'downgraded_at', v_profile.downgraded_at);
    end if;
    return jsonb_build_object('state', 'trial_active', 'trial_ride_days', v_rides,
      'trial_ride_day_limit', v_profile.trial_ride_day_limit, 'trial_started_at', v_profile.trial_started_at,
      'trial_ends_at', v_profile.trial_ends_at);
  end if;

  return jsonb_build_object('state', 'free',
    'trial_started_at', v_profile.trial_started_at, 'trial_ended_at', v_profile.trial_ended_at,
    'trial_end_reason', v_profile.trial_end_reason, 'downgraded_at', v_profile.downgraded_at,
    'trial_ride_days', public._trial_ride_days(auth.uid(), v_profile.trial_started_at));
end;
$$;
revoke all on function public.resolve_entitlement() from public, anon;
grant execute on function public.resolve_entitlement() to authenticated;

-- ---------------------------------------------------------------------------
-- Lifecycle email sends (dedupe for the cron-driven ones) and RevenueCat
-- revenue events (for revenue-per-account dashboards; the webhook logs, the
-- entitlement write path is unchanged).
-- ---------------------------------------------------------------------------
create table if not exists public.lifecycle_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null,
  sent_at timestamptz not null default now(),
  unique (user_id, event)
);
alter table public.lifecycle_sends enable row level security;
revoke all on public.lifecycle_sends from anon, authenticated;  -- service role only

create table if not exists public.rc_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  event_type text not null,
  product_id text,
  price numeric(10,2),
  currency text,
  period_type text,
  store text,
  event_at timestamptz not null default now(),
  raw jsonb
);
create index if not exists ix_rc_events_user_at on public.rc_events (user_id, event_at);
alter table public.rc_events enable row level security;
revoke all on public.rc_events from anon, authenticated;  -- service role only
