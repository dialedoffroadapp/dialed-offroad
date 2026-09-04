-- ride_feedback.suspect_flags: data-quality markers the fleet-learning work
-- can filter on. STAGED with the v2.4.1 hotfix (hotfix/v2.4.1-air-display);
-- the same file lives on feat/v3-integration so both branches stay supersets
-- of prod. Additive; rows stay immutable to clients (no client grant change:
-- the update policy is still column-scoped to outcome/resulting_version_id).
--
-- 'air_display_v241': the ride was on an air-fork setup version and the
-- feedback was recorded before the v2.4.1 display fix shipped. Until then
-- both results screens showed fork air = engine value + 0.2 bar per 10 lb
-- from 185 (the engine had already applied that delta), so the pressure the
-- rider actually set may differ from the saved value by that much. The
-- rider's symptoms may therefore describe a fork that was NOT at the saved
-- pressure. Filter: `not ('air_display_v241' = any(suspect_flags))`.
--
-- Backfill rule: every feedback row whose setup version has an air value and
-- whose created_at is before this migration runs. Rows written AFTER this
-- by clients still on <= 2.4.0 are NOT caught here; the fleet-learning pass
-- can extend the flag later using usage_events.meta.app_version per user
-- (first-seen 2.4.1 timestamp), which is why the flag is an array.

alter table public.ride_feedback
  add column if not exists suspect_flags text[] not null default '{}';

comment on column public.ride_feedback.suspect_flags is
  'Data-quality markers. air_display_v241 = pre-2.4.1 feedback on an air-fork version (displayed pressure differed from saved by 0.2 bar/10 lb from 185); filter with NOT (''air_display_v241'' = ANY(suspect_flags)).';

create index if not exists ix_ride_feedback_suspect_flags
  on public.ride_feedback using gin (suspect_flags);

update public.ride_feedback rf
   set suspect_flags = array_append(rf.suspect_flags, 'air_display_v241')
  from public.setup_versions sv
 where sv.id = rf.setup_version_id
   and sv.fork_air_bar is not null
   and rf.created_at < now()
   and not ('air_display_v241' = any(rf.suspect_flags));
