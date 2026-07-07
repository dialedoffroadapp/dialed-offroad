-- Engine v2 Change 1: abuse-protection rate limiting for the ai-tune edge function.
-- Written ONLY by the function via service role; no client access at all.
-- This is abuse protection, not product quota — claim_free_tune stays the product gate.

create table public.tune_calls (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete cascade,
  ip          text,   -- set only for anon-key baseline callers
  mode        text not null,
  created_at  timestamptz not null default now(),
  check (user_id is not null or ip is not null)
);

create index tune_calls_user_time_idx on public.tune_calls (user_id, created_at desc);
create index tune_calls_ip_time_idx   on public.tune_calls (ip, created_at desc);

alter table public.tune_calls enable row level security;

-- No policies on purpose: RLS denies everything, and service role bypasses RLS.
revoke all on table public.tune_calls from anon, authenticated;
