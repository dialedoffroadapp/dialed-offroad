-- Tune Two v2: setup version lineage + ride feedback persistence.
-- Shadow tables: the existing `sessions` write path is untouched and runs in parallel.
-- bikes.id verified uuid against the linked project on 2026-07-06.

-- ─── setup_versions ─────────────────────────────────────────────────────────

create table public.setup_versions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users (id) on delete cascade,
  -- Nullable: tunes can be generated/refined with no bike selected ("Custom Bike").
  bike_id                   uuid references public.bikes (id) on delete cascade,
  -- Assigned by trigger below: max+1 per (user_id, bike_id). First row for a bike = 1.
  version_number            int not null,
  source                    text not null
                              check (source in ('baseline','refinement','restore','manual')),
  parent_version_id         uuid references public.setup_versions (id),
  restored_from_version_id  uuid references public.setup_versions (id),

  fork_comp_clicks          int,
  fork_reb_clicks           int,
  fork_air_bar              numeric,
  shock_lsc_clicks          int,
  shock_hsc_turns           numeric,
  shock_reb_clicks          int,
  sag_mm                    int,

  notes                     jsonb not null default '[]'::jsonb,  -- engine notes[], structured
  terrain                   text,
  context                   jsonb,                               -- Tune2Context snapshot
  created_at                timestamptz not null default now(),

  -- TODO: rows with bike_id IS NULL are not protected by this constraint
  -- (Postgres treats NULLs as distinct), so duplicate version_numbers are
  -- possible for bikeless tunes if two inserts race. The numbering trigger
  -- below is the only guard for those rows.
  unique (bike_id, version_number)
);

create index setup_versions_user_created_idx
  on public.setup_versions (user_id, created_at desc);
create index setup_versions_parent_idx
  on public.setup_versions (parent_version_id);

-- Per-bike version numbering, race-backstopped by the unique constraint above.
-- Runs as invoker: RLS limits the max() scan to the inserting user's own rows.
create or replace function public.assign_setup_version_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.version_number is null then
    select coalesce(max(v.version_number), 0) + 1
      into new.version_number
      from public.setup_versions v
     where v.user_id = new.user_id
       and v.bike_id is not distinct from new.bike_id;
  end if;
  return new;
end;
$$;

create trigger trg_setup_versions_version_number
  before insert on public.setup_versions
  for each row execute function public.assign_setup_version_number();

-- ─── ride_feedback ──────────────────────────────────────────────────────────

create table public.ride_feedback (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  -- The version this feedback critiques.
  setup_version_id      uuid not null references public.setup_versions (id) on delete cascade,
  -- The refinement it produced (linked after the refinement insert succeeds).
  resulting_version_id  uuid references public.setup_versions (id),
  overall_rating        int check (overall_rating between 1 and 10),  -- post-conversion 1–10
  symptoms              jsonb not null,                               -- [{id, severity, where?}]
  free_text             text,                                         -- raw notes field
  outcome               text check (outcome in ('improved','same','worse')),
  created_at            timestamptz not null default now()
);

create index ride_feedback_setup_version_idx
  on public.ride_feedback (setup_version_id);
create index ride_feedback_user_created_idx
  on public.ride_feedback (user_id, created_at desc);

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.setup_versions enable row level security;
alter table public.ride_feedback  enable row level security;

-- setup_versions: select/insert own rows only. No update/delete policies exist,
-- so RLS denies both regardless of grants (matches "no client-side update/delete").
create policy "setup_versions_select_own"
  on public.setup_versions for select
  using (auth.uid() = user_id);

create policy "setup_versions_insert_own"
  on public.setup_versions for insert
  with check (
    auth.uid() = user_id
    -- lineage pointers may only reference your own versions
    and (parent_version_id is null or exists (
      select 1 from public.setup_versions p
      where p.id = parent_version_id and p.user_id = auth.uid()
    ))
    and (restored_from_version_id is null or exists (
      select 1 from public.setup_versions r
      where r.id = restored_from_version_id and r.user_id = auth.uid()
    ))
  );

-- ride_feedback: select/insert own; update own rows.
-- NOTE: RLS cannot restrict *columns* — the "outcome only" rule is enforced via
-- the column-level grant below, widened to also allow resulting_version_id
-- because the write path must link the refinement after inserting it. Every
-- other column is un-updatable from the client.
create policy "ride_feedback_select_own"
  on public.ride_feedback for select
  using (auth.uid() = user_id);

create policy "ride_feedback_insert_own"
  on public.ride_feedback for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.setup_versions v
      where v.id = setup_version_id and v.user_id = auth.uid()
    )
  );

create policy "ride_feedback_update_own"
  on public.ride_feedback for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (resulting_version_id is null or exists (
      select 1 from public.setup_versions v
      where v.id = resulting_version_id and v.user_id = auth.uid()
    ))
  );

-- ─── Column-level privileges ────────────────────────────────────────────────
-- Supabase default-grants ALL on new public tables to anon/authenticated; tighten.

revoke all on table public.setup_versions from anon, authenticated;
grant select, insert on table public.setup_versions to authenticated;

revoke all on table public.ride_feedback from anon, authenticated;
grant select, insert on table public.ride_feedback to authenticated;
grant update (outcome, resulting_version_id) on table public.ride_feedback to authenticated;
