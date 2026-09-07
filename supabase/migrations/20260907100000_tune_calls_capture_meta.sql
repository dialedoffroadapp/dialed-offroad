-- Decision 13 (engine discovery addendum, 2026-09-07): per-call metadata the
-- discovery could not find anywhere. Written by ai-tune's recordOutput
-- (service role) after generation; older function versions leave them null.
--   duration_ms        request start to output write, inside the function
--   engine_source      who decided the numbers: llm / fallback_parse /
--                      fallback_error / formula (baseline), deterministic (tune2)
--   prompt_tokens /    OpenAI usage summed over the call's model requests
--   completion_tokens  (baseline: one; tune2: the free-text parse when it ran)
-- Additive. tune_calls keeps RLS enabled with zero policies (deny-all;
-- service role bypasses). STAGED, NOT PUSHED.

alter table public.tune_calls
  add column if not exists duration_ms integer,
  add column if not exists engine_source text,
  add column if not exists prompt_tokens integer,
  add column if not exists completion_tokens integer;

comment on column public.tune_calls.engine_source is
  'llm | fallback_parse | fallback_error | formula (zero_baseline_v1); deterministic (tune2_v1). Null = a function version before 2026-09-07.';
