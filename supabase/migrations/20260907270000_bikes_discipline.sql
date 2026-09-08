-- Device pass finding 3 (2026-09-08): no discipline assumptions in Add a
-- bike. The rider answers "What do you mostly ride this bike on?" and the
-- answer lives on the bike; it becomes the default terrain for the quiz on
-- that bike. Null = never asked (older bikes fall back to the platform
-- classifier until the rider answers). STAGED for prod; applied to dev-3-0.
-- Table-level grants cover the new column.

alter table public.bikes
  add column if not exists discipline text
    check (discipline in ('mx', 'offroad'));

comment on column public.bikes.discipline is
  'What the rider mostly rides this bike on: mx | offroad. The rider''s answer from Add a bike (2026-09-08); null = not asked.';
