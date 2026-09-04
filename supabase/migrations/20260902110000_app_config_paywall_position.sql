-- Remote-switchable app config (River, 2026-09-02): a key/value table the
-- client reads anonymously at boot so product-flow flags can flip WITHOUT a
-- store release. First key: paywall_position — "interstitial" (the shipped
-- signup → paywall → reveal ordering) or "action_gated" (reveal first; the
-- paywall presents on the first Pro action). See lib/paywallPosition.ts.
--
-- STAGED, NOT PUSHED at authoring. Push from a superset branch only
-- (CLAUDE.md migration-history rule). Until it lands the client falls back
-- to its build default (action_gated on feat/quiz-onboarding) — the flag is
-- simply not remotely switchable yet, nothing breaks.
--
-- Access: read-only for anon + authenticated (the flag must resolve before
-- the rider has an account); writes are service-role / dashboard only.
-- Grant idiom: explicit table grants (no default ACL reliance).

create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.app_config is
  'Client-readable remote flags. Edit values in the dashboard; clients cache the last value per device.';

alter table public.app_config enable row level security;

drop policy if exists "app_config_read_all" on public.app_config;
create policy "app_config_read_all"
  on public.app_config
  for select
  to anon, authenticated
  using (true);

revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to anon, authenticated;

-- Seed. ON CONFLICT DO NOTHING so a later dashboard edit is never clobbered
-- if this file is ever re-applied.
insert into public.app_config (key, value)
values ('paywall_position', '"action_gated"'::jsonb)
on conflict (key) do nothing;
