-- Log moto captures the moto's duration by timestamps (minutes since the
-- previous log or the clock start, editable) and an optional lap count
-- (ride-day device pass, 2026-09-04). STAGED, additive; the outbox writes
-- both on every track_sessions upsert.
alter table public.track_sessions
  add column if not exists duration_min integer,
  add column if not exists laps integer;
comment on column public.track_sessions.duration_min is 'Minutes since the previous moto log or the ride clock start; rider-editable at log time.';
comment on column public.track_sessions.laps is 'Optional lap count typed by the rider.';
