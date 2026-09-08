-- One free refinement before the paywall (River, 2026-09-07). The
-- action-gated paywall no longer presents on the FIRST refinement of a bike:
-- it presents on the second refinement on any bike (and, unchanged, on
-- history, a second bike, a second setup). app_config.free_refinements_per_bike
-- (default 1; 0 restores the old always-Pro behavior) is read by BOTH sides:
--   server_refine_allowance(p_user_id, p_bike_id)  service role, called by the
--     ai-tune edge on the refine path BEFORE the tune_calls insert; the edge
--     never trusts a client flag. Counts setup_versions rows with
--     source = 'refinement' for this user and bike (no bike = every bike).
--   refine_allowance(p_bike_id)  the signed-in client's lightweight read for
--     CTA routing (setup sheet, Bike Home, the legacy debrief); the last refine
--     response's refine_allowance_remaining is the fresher signal.
-- STAGED for prod; applied to dev-3-0.
--
-- Grant idiom (20260715150000): the project's default ACLs grant EXECUTE to
-- anon/authenticated individually, so each is revoked by name.

insert into public.app_config (key, value)
values ('free_refinements_per_bike', '1'::jsonb)
on conflict (key) do nothing;

create or replace function public.server_refine_allowance(p_user_id uuid, p_bike_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_profile public.profiles%rowtype;
  v_now timestamptz := now();
  v_free int := coalesce((select (value #>> '{}')::integer from public.app_config where key = 'free_refinements_per_bike'), 1);
  v_used int := 0;
  v_entitled boolean := false;
begin
  select * into v_profile from public.profiles p where p.user_id = p_user_id;
  if found then
    -- The same three doors lib/entitlement.ts:isEntitled opens: RevenueCat
    -- Pro (is_pro / pro_until), or the reverse trial's trial_active state.
    v_entitled := coalesce(v_profile.is_pro, false)
      or (v_profile.pro_until is not null and v_profile.pro_until > v_now)
      or v_profile.entitlement_state in ('pro', 'trial_active');
  end if;

  select count(*) into v_used
    from public.setup_versions v
   where v.user_id = p_user_id
     and v.source = 'refinement'
     and (p_bike_id is null or v.bike_id = p_bike_id);

  return jsonb_build_object(
    'entitled', v_entitled,
    'used', v_used,
    'free', v_free,
    'remaining', greatest(v_free - v_used, 0)
  );
end;
$$;

revoke all on function public.server_refine_allowance(uuid, uuid) from public;
revoke all on function public.server_refine_allowance(uuid, uuid) from anon;
revoke all on function public.server_refine_allowance(uuid, uuid) from authenticated;
grant execute on function public.server_refine_allowance(uuid, uuid) to service_role;

-- The client's read: free refinements left on this bike for the caller.
-- security invoker: setup_versions RLS already scopes the count to own rows.
create or replace function public.refine_allowance(p_bike_id uuid default null)
returns integer
language sql
stable
security invoker
set search_path to 'public'
as $$
  select greatest(
    coalesce((select (value #>> '{}')::integer from public.app_config where key = 'free_refinements_per_bike'), 1)
    - (select count(*)::int
         from public.setup_versions v
        where v.user_id = auth.uid()
          and v.source = 'refinement'
          and (p_bike_id is null or v.bike_id = p_bike_id)),
    0);
$$;

revoke all on function public.refine_allowance(uuid) from public;
revoke all on function public.refine_allowance(uuid) from anon;
grant execute on function public.refine_allowance(uuid) to authenticated;
