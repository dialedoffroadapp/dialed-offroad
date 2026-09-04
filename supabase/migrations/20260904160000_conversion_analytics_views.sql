-- Conversion dashboards (playbook "What to measure and target thresholds").
-- STAGED, NOT PUSHED. Views live in schema analytics, service_role only
-- (read from the SQL editor / a dashboard user, never the app).
--   blended free-to-paid           target 4-6% (2-3x the 2.1% freemium median)
--   reverse-trial trial-to-paid    target 35%+; below 25% = trial too short
--   day-0 / day-1 downgrade intent gate dismissed / pricing viewed without
--                                  purchase within 24 h / 48 h of trial start
--   revenue per account at day 60  vs the pre-3.0 baseline (launch_3_0_at)
create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;
grant usage on schema analytics to service_role;

create or replace view analytics.accounts as
  select u.id as user_id, u.created_at,
         (u.created_at >= coalesce((select nullif(value #>> '{}', 'null')::timestamptz from public.app_config where key = 'launch_3_0_at'), '2099-01-01'::timestamptz)) as post_3_0
    from auth.users u;

create or replace view analytics.paid_accounts as
  select p.user_id, min(e.event_at) as first_paid_at
    from public.profiles p
    join public.rc_events e on e.user_id = p.user_id
   where e.event_type in ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE')
   group by p.user_id;

-- Blended free-to-paid by signup week (post-3.0 accounts).
create or replace view analytics.blended_free_to_paid as
  select date_trunc('week', a.created_at) as cohort_week,
         count(*) as accounts,
         count(pa.user_id) as paid,
         round(100.0 * count(pa.user_id) / greatest(count(*), 1), 2) as pct_paid
    from analytics.accounts a
    left join analytics.paid_accounts pa on pa.user_id = a.user_id
   where a.post_3_0
   group by 1 order by 1;

-- Reverse-trial conversion: trials started → paid within 45 days of start.
create or replace view analytics.reverse_trial_conversion as
  select date_trunc('week', p.trial_started_at) as trial_week,
         count(*) as trials,
         count(*) filter (where p.trial_end_reason = 'purchase'
                          or (pa.first_paid_at is not null and pa.first_paid_at <= p.trial_started_at + interval '45 days')) as converted,
         count(*) filter (where p.trial_end_reason = 'ride_days') as ended_by_ride_days,
         count(*) filter (where p.trial_end_reason = 'clock') as ended_by_clock,
         round(100.0 * count(*) filter (where p.trial_end_reason = 'purchase'
                          or (pa.first_paid_at is not null and pa.first_paid_at <= p.trial_started_at + interval '45 days'))
               / greatest(count(*), 1), 2) as pct_converted
    from public.profiles p
    left join analytics.paid_accounts pa on pa.user_id = p.user_id
   where p.trial_started_at is not null
   group by 1 order by 1;

-- Day-0 / day-1 downgrade intent: a gate dismissed or the pricing page left
-- without purchase inside the first 24 h / 48 h of the trial.
create or replace view analytics.downgrade_intent as
  select date_trunc('week', p.trial_started_at) as trial_week,
         count(distinct p.user_id) as trials,
         count(distinct e.user_id) filter (where e.created_at <= p.trial_started_at + interval '24 hours') as day0_intent,
         count(distinct e.user_id) filter (where e.created_at <= p.trial_started_at + interval '48 hours') as day1_intent
    from public.profiles p
    left join public.usage_events e
      on e.user_id = p.user_id
     and e.event_type in ('gate_dismissed', 'pricing_page_viewed')
     and e.created_at >= p.trial_started_at
   where p.trial_started_at is not null
   group by 1 order by 1;

-- Revenue per account at day 60, pre- vs post-3.0 (the single number that
-- says whether 3.0 earned more than the hard paywall).
create or replace view analytics.revenue_per_account_day60 as
  select a.post_3_0,
         count(*) as accounts,
         round(coalesce(sum(r.rev), 0) / greatest(count(*), 1), 2) as revenue_per_account_60d
    from analytics.accounts a
    left join lateral (
      select sum(e.price) as rev
        from public.rc_events e
       where e.user_id = a.user_id
         and e.event_at <= a.created_at + interval '60 days'
         and e.event_type in ('INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE')
    ) r on true
   where a.created_at <= now() - interval '60 days'
   group by 1;

-- Gate funnel per trigger.
create or replace view analytics.gate_funnel as
  select e.meta ->> 'paywall_trigger_action' as trigger,
         count(*) filter (where e.event_type = 'gate_shown') as shown,
         count(*) filter (where e.event_type = 'gate_dismissed') as dismissed,
         count(*) filter (where e.event_type = 'pricing_page_viewed') as pricing_viewed,
         count(*) filter (where e.event_type = 'gate_converted') as converted
    from public.usage_events e
   where e.event_type in ('gate_shown', 'gate_dismissed', 'pricing_page_viewed', 'gate_converted')
   group by 1 order by shown desc;

grant select on all tables in schema analytics to service_role;
