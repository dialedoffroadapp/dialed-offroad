-- Decision 13 (engine discovery addendum, 2026-09-07): anonymous tune_calls
-- rows (guest baselines: an IP, a coarse location, free text, no account)
-- had no retention. purge_anon_tune_calls(p_days) deletes rows that have no
-- user_id and are older than p_days (default 90). Safe by construction: the
-- anon rate limit reads the last hour, claim_anon_tune_calls reads the last
-- 48 hours, and capture analytics use the attributed rows. On 2026-09-07 no
-- anonymous row is older than 90 days (the table starts 2026-07-07), so the
-- first deletions land in early October.
--
-- Scheduling: pg_cron is not enabled on the linked project. This file
-- enables it when the role may (Supabase allows `create extension pg_cron`
-- for the postgres role on hosted projects) and schedules a daily run at
-- 04:15 UTC; when it cannot, it raises a notice and the function stays
-- callable by hand (`select public.purge_anon_tune_calls();` as service role).
-- Idempotent: re-applying unschedules and reschedules the same job name.
-- STAGED, NOT PUSHED.

create or replace function public.purge_anon_tune_calls(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_deleted integer;
begin
  if p_days is null or p_days < 30 then
    raise exception 'purge_anon_tune_calls: p_days must be at least 30 (got %)', p_days;
  end if;
  delete from public.tune_calls
   where user_id is null
     and created_at < now() - make_interval(days => p_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_anon_tune_calls(integer) from public, anon, authenticated;
grant execute on function public.purge_anon_tune_calls(integer) to service_role;

comment on function public.purge_anon_tune_calls(integer) is
  'Deletes anonymous (user_id null) tune_calls rows older than p_days (default 90). Scheduled daily by pg_cron when available; otherwise run by hand as service role.';

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not enabled (%): purge_anon_tune_calls is not scheduled; enable pg_cron in the dashboard and re-apply, or run it by hand.', sqlerrm;
    return;
  end;
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge_anon_tune_calls_daily';
    perform cron.schedule('purge_anon_tune_calls_daily', '15 4 * * *', 'select public.purge_anon_tune_calls(90)');
    raise notice 'purge_anon_tune_calls scheduled daily at 04:15 UTC';
  else
    raise notice 'pg_cron extension created but no cron schema found; purge_anon_tune_calls is not scheduled';
  end if;
end $$;
