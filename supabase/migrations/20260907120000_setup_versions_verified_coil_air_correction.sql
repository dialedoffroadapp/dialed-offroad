-- Decision 3 (shadow-report decisions, 2026-09-07): eleven baseline versions
-- carry a fork air value (9.8 to 10.6 bar) on bikes whose VERIFIED catalog
-- row is a coil fork (KTM 300 EXC / XC / XC-W on WP XPLOR or XACT coil, Beta
-- RR Race 300, Honda CRF250R, Yamaha YZ125). They predate the catalog fork
-- override (2026-07-19) or came from a rider toggle on a matched coil bike.
-- Same shape as the mini fix (20260906100000): null the air on the typed
-- column and both jsonb snapshots, append a note. Set-based on the catalog
-- flag rather than on ids, guarded to verified coil rows only. None of the
-- rows has children. STAGED, NOT PUSHED; applied to dev-3-0.

update public.setup_versions sv
   set fork_air_bar = null,
       applied_settings = case
         when sv.applied_settings is not null then jsonb_set(sv.applied_settings, '{fork_air}', 'null'::jsonb, true)
         else sv.applied_settings end,
       recommended_settings = case
         when sv.recommended_settings ? 'settings' then jsonb_set(sv.recommended_settings, '{settings,fork_air}', 'null'::jsonb, true)
         when sv.recommended_settings ? 'fork_air' then jsonb_set(sv.recommended_settings, '{fork_air}', 'null'::jsonb, true)
         else sv.recommended_settings end,
       notes = coalesce(sv.notes, '[]'::jsonb)
         || '["Fork air cleared 2026-09-07: this bike runs a coil fork per its verified catalog row. The air value was recorded before the catalog fork type was authoritative."]'::jsonb
  from public.bikes b
  join public.bike_models m on m.id = b.model_id
 where b.id = sv.bike_id
   and sv.fork_air_bar is not null
   and m.spec_verified
   and m.has_air_fork = false;
