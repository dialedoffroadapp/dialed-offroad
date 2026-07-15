-- Security hardening from a live-DB audit (advisors + manual, 2026-07-15).
-- Sequence: view leak -> function revokes -> policy consolidation -> index/table cleanup.
-- All prod-only facts (function signatures, policy names, index kinds) verified live
-- via the read-only connector on 2026-07-15.

-- ── 1) Fix the v_bikes_with_stock leak (critical) ────────────────────────────
-- Audit: the view ran with definer semantics, so any caller could read every
-- user's bikes through it (RLS bypass). security_invoker makes it respect the
-- caller's RLS (bikes select-own). Consumed only by components/TrialMomentCard.tsx,
-- which reads the signed-in user's own bike by id — so invoker + authenticated-only
-- is sufficient and correct. (Separate migration because 20260715130000 is already
-- applied to prod.)
alter view public.v_bikes_with_stock set (security_invoker = true);
revoke all on public.v_bikes_with_stock from anon, authenticated;
grant select on public.v_bikes_with_stock to authenticated;

-- ── 2) Lock down RPC-exposed / internal functions ───────────────────────────
-- Audit: functions executable by anon/authenticated that should not be RPC-callable.
-- Signatures verified live 2026-07-15.

-- Trigger/internal functions (no-arg; never legitimately RPC-called; revoking
-- execute does not affect trigger firing) — revoke from both roles.
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.set_user_id() from anon, authenticated;
revoke execute on function public.tg_set_user_id() from anon, authenticated;
revoke execute on function public._trg_bikes_insert_log() from anon, authenticated;
revoke execute on function public._trg_bikes_update_log() from anon, authenticated;
revoke execute on function public._trg_sessions_delete_log() from anon, authenticated;
revoke execute on function public._trg_sessions_insert_log() from anon, authenticated;

-- _log_usage(ev_type text, meta jsonb): internal only (zero client/edge callers).
revoke execute on function public._log_usage(text, jsonb) from anon, authenticated;

-- claim_free_tune / refund_free_tune are called by the SIGNED-IN client only
-- (app/(tabs)/tune.tsx, guarded to signed-in users) — revoke anon only.
revoke execute on function public.claim_free_tune() from anon;
revoke execute on function public.refund_free_tune() from anon;

-- Only check_display_name_profanity genuinely lacks a fixed search_path (not
-- security definer, proconfig null, verified live). All the functions above
-- already set search_path = public, so no other alters are needed.
alter function public.check_display_name_profanity() set search_path = public;

-- ── 3) Consolidate bikes + sessions policies ────────────────────────────────
-- Audit: 13 overlapping policies on each table, all semantically user-owns-row
-- (quals verified live = user_id = auth.uid() variants), so this changes no access
-- outcome. Drop each explicitly by name, then recreate exactly one CRUD set per
-- table scoped to (select auth.uid()) = user_id, TO authenticated.

drop policy if exists "Users can delete their own bikes" on public.bikes;
drop policy if exists "Users can insert their own bikes" on public.bikes;
drop policy if exists "Users can read their own bikes"   on public.bikes;
drop policy if exists "Users can update their own bikes" on public.bikes;
drop policy if exists "bikes delete own" on public.bikes;
drop policy if exists "bikes insert own" on public.bikes;
drop policy if exists "bikes select own" on public.bikes;
drop policy if exists "bikes update own" on public.bikes;
drop policy if exists "bikes_delete_own" on public.bikes;
drop policy if exists "bikes_insert_own" on public.bikes;
drop policy if exists "bikes_select_own" on public.bikes;
drop policy if exists "bikes_update_own" on public.bikes;
drop policy if exists "p_bikes_all"      on public.bikes;

drop policy if exists "delete own sessions" on public.sessions;
drop policy if exists "insert own sessions" on public.sessions;
drop policy if exists "select own sessions" on public.sessions;
drop policy if exists "update own sessions" on public.sessions;
drop policy if exists "sessions delete own" on public.sessions;
drop policy if exists "sessions insert own" on public.sessions;
drop policy if exists "sessions select own" on public.sessions;
drop policy if exists "sessions update own" on public.sessions;
drop policy if exists "sessions_delete_own" on public.sessions;
drop policy if exists "sessions_insert_own" on public.sessions;
drop policy if exists "sessions_select_own" on public.sessions;
drop policy if exists "sessions_update_own" on public.sessions;
drop policy if exists "p_sessions_all"      on public.sessions;

alter table public.bikes    enable row level security;
alter table public.sessions enable row level security;

create policy bikes_select_own on public.bikes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy bikes_insert_own on public.bikes
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy bikes_update_own on public.bikes
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy bikes_delete_own on public.bikes
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy sessions_select_own on public.sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy sessions_insert_own on public.sessions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy sessions_update_own on public.sessions
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy sessions_delete_own on public.sessions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ── 4) Drop duplicate indexes ───────────────────────────────────────────────
-- Audit: redundant indexes duplicating an existing pkey / *_idx. All three
-- verified live as plain indexes (not constraint-backed).
drop index if exists public.profiles_user_id_unique;  -- dup of the profiles pkey
drop index if exists public.idx_sessions_bike;        -- dup of sessions_bike_id_idx
drop index if exists public.idx_sessions_user;        -- dup of sessions_user_id_idx

-- ── 5) Drop dead tables ─────────────────────────────────────────────────────
-- Audit: 0 rows, no production usage. Their only repo references are removed in
-- the same commit (lib/tuneEvents.ts deleted; the stale bike_setups mention in
-- scripts/rls-matrix.mjs cleaned up).
drop table if exists public.bike_setups;
drop table if exists public.tune_events;
