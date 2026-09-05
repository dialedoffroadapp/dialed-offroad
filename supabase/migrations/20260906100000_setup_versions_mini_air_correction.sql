-- Decision 1 (engine discovery, 2026-09-05): five baseline versions carry
-- 1.5 to 1.8 bar of fork air on KTM minis (50 SX x2, 85 SX, 85 SX Big Wheel,
-- SX-E 5). None of those models has a bike_models row, so the retired
-- name-based air-fork heuristic in ai-tune called them air forks and
-- gpt-4o-mini answered with a mini's number; ai-tune had no server-side air
-- clamp. Coil-fork bikes carry no air value: null the air on exactly those
-- rows (typed column and both jsonb snapshots) and append a note. Nothing
-- else on the rows changes; the numbering and delta triggers fire only on
-- insert, and every row is a v1 with no children. There is no catalog flag
-- to correct because no catalog row exists for these models.
--
-- Not touched here, reported for a separate decision: 11 other versions
-- carry an air value on bikes whose VERIFIED catalog row says coil (a
-- different class: pre-spec-override clients or a rider toggle on a matched
-- coil bike).
--
-- STAGED, NOT PUSHED to prod. Applied to the dev-3-0 branch.

update public.setup_versions
   set fork_air_bar = null,
       applied_settings = case
         when applied_settings is not null then jsonb_set(applied_settings, '{fork_air}', 'null'::jsonb, true)
         else applied_settings end,
       recommended_settings = case
         when recommended_settings ? 'settings' then jsonb_set(recommended_settings, '{settings,fork_air}', 'null'::jsonb, true)
         when recommended_settings ? 'fork_air' then jsonb_set(recommended_settings, '{fork_air}', 'null'::jsonb, true)
         else recommended_settings end,
       notes = coalesce(notes, '[]'::jsonb)
         || '["Fork air cleared 2026-09-06: this is a coil-fork mini. The retired name-based air-fork guess had recorded a pressure here."]'::jsonb
 where id in (
   '74da9208-3ad5-4d88-bf3a-84a79c9b4105',
   '8a2c059c-925a-42d3-927a-250ee6dc2aa6',
   '75b065d0-45b0-4922-bba7-7320c4b2bc2b',
   '26fe659c-09cb-478e-a9d7-bacffd3ec67f',
   'a615df89-7113-452a-8e42-a8c60d397a09'
 )
   and fork_air_bar is not null
   and fork_air_bar < 7;
