-- Tire pressure moves into the engine (River, 2026-09-07; reverses the Sep 5
-- "tires stay out of the engine" call). The bike records what is in each
-- tire so the engine can say "nothing to set" for a mousse and run the low
-- range for a Tubliss. Default unknown, never blocks. STAGED for prod;
-- applied to dev-3-0. Table-level grants cover the new columns.

alter table public.bikes
  add column if not exists tire_system_front text not null default 'unknown'
    check (tire_system_front in ('tube', 'heavy_tube', 'tubliss', 'mousse', 'unknown')),
  add column if not exists tire_system_rear text not null default 'unknown'
    check (tire_system_rear in ('tube', 'heavy_tube', 'tubliss', 'mousse', 'unknown'));

comment on column public.bikes.tire_system_front is
  'What is in the front tire: tube | heavy_tube | tubliss | mousse | unknown (engine tire output, 2026-09-07).';
comment on column public.bikes.tire_system_rear is
  'What is in the rear tire: tube | heavy_tube | tubliss | mousse | unknown (engine tire output, 2026-09-07).';
