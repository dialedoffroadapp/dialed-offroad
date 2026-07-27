-- Workstream C (v2.3.0): attribute pre-auth onboarding tunes to the account
-- created at signup.
--
-- Problem: guest onboarding generates the baseline tune BEFORE signup, so the
-- ai-tune edge function records the call with user_id = null and only the
-- caller IP (20260707090000_tune_calls_rate_limit.sql). Nothing ever
-- reconciled those rows — only ~25% of July 2026 signups had any attributed
-- tune_calls row despite ~91% adding a bike, and 930 of 1,678 zero_baseline
-- rows since table creation were anonymous.
--
-- Mechanism (fork (a), approved 2026-07-24):
--   * The client mints one random uuid (AsyncStorage, lib/tuneAttribution.ts)
--     and sends it as anon_id with PRE-AUTH zero_baseline calls only; the
--     edge function stamps it on anon rows only (authenticated rows keep
--     anon_id null — their user_id is already correct).
--   * At auth success the client calls claim_anon_tune_calls(anon_id). The
--     claim runs server-side and matches ONLY rows that (1) carry that exact
--     anon_id, (2) are still unclaimed (user_id is null — one-shot: a second
--     account on the same device can never take rows the first account
--     already claimed), and (3) were created within the last 48 hours
--     (2x the pending-tune TTL, lib/onboarding.tsx PENDING_TUNE_TTL_MS).
--   * The client rotates (deletes) its stored anon_id after a successful
--     claim, so a later account on the same device starts from a fresh id.
--
-- Security posture unchanged: tune_calls keeps RLS enabled with NO policies
-- and NO table grants — clients still cannot read or write it directly. The
-- only new client-reachable surface is this RPC, which can set user_id to
-- auth.uid() and nothing else. anon_id is a 128-bit random value known only
-- to the device that generated it (never exposed by any read path). ip stays
-- on claimed rows for audit, and both rate-limit windows keep counting them
-- (per-IP via ip, per-user via the new user_id).

alter table public.tune_calls
  add column anon_id uuid;

-- Claim lookups only ever touch unclaimed anon rows; claimed rows fall out
-- of the partial index automatically.
create index tune_calls_anon_claim_idx
  on public.tune_calls (anon_id, created_at desc)
  where anon_id is not null and user_id is null;

create or replace function public.claim_anon_tune_calls(p_anon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_claimed integer;
begin
  -- must be signed in (mirrors refund_free_tune)
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_anon_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_anon_id', 'claimed', 0);
  end if;

  update public.tune_calls
  set user_id = auth.uid()
  where anon_id = p_anon_id
    and user_id is null                            -- one-shot guard
    and created_at > now() - interval '48 hours';  -- bounded window
  get diagnostics v_claimed = row_count;

  return jsonb_build_object('ok', true, 'claimed', v_claimed);
end;
$$;

revoke all on function public.claim_anon_tune_calls(uuid) from public;
grant execute on function public.claim_anon_tune_calls(uuid) to authenticated;
