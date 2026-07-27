-- Close the anon EXECUTE gap on claim_anon_tune_calls (stage-1 finding,
-- 2026-07-27).
--
-- 20260724110000 used the older revoke-from-PUBLIC idiom, but this project's
-- default privileges (pg_default_acl, verified live) grant EXECUTE on new
-- public-schema functions to anon/authenticated/service_role as INDIVIDUAL
-- roles — so revoking from PUBLIC left the per-role anon grant in place and
-- has_function_privilege('anon', ...) read true.
--
-- Impact was defense-in-depth only: the function's first statement raises
-- 'not authenticated' when auth.uid() is null, so anon callers could never
-- claim rows. This aligns the RPC with the hardened idiom the 20260715150000
-- security pass established for claim_free_tune / refund_free_tune
-- (signed-in-only RPCs: revoke anon explicitly). Future auth-required RPCs
-- should use this idiom from the start, not revoke-from-PUBLIC alone.

revoke execute on function public.claim_anon_tune_calls(uuid) from anon;
