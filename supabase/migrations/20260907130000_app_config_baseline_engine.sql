-- Decision 1 (shadow-report decisions, 2026-09-07): deterministic-first
-- baselines behind a remote flag. app_config.baseline_engine:
--   "llm"            the shipped path: the model's numbers merged over the
--                    formula (production default until River flips it)
--   "deterministic"  the formula's numbers; the model only writes the notes
--                    (the ai-explain shape, in-path, fail-open to the
--                    formula's own notes). The dev-3-0 branch runs this.
-- ai-tune reads the key per request with a 60 s in-isolate cache and falls
-- back to "llm" when the read fails. Seeded ON CONFLICT DO NOTHING so a
-- dashboard flip is never clobbered. STAGED, NOT PUSHED.
insert into public.app_config (key, value)
values ('baseline_engine', '"llm"'::jsonb)
on conflict (key) do nothing;
