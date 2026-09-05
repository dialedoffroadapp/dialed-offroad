-- Per-setup version numbering needs a per-setup uniqueness guarantee
-- (audit item 3, 2026-09-04). 20260904100000 rescoped the numbering
-- trigger to (user_id, bike_id, setup_id), but production still carries
-- unique (bike_id, version_number) from 20260706120000, so the FIRST version
-- of any named setup on a bike that already has a baseline collides (23505)
-- and every named-setup writer swallowed it. Replace the constraint with two
-- partial unique indexes: the default lineage keeps today's guarantee byte
-- for byte, named setups get their own. Partial indexes touch no existing
-- row (every row today has setup_id null) and stay safe on populated tables.
alter table public.setup_versions
  drop constraint if exists setup_versions_bike_id_version_number_key;

create unique index if not exists ux_setup_versions_default_numbering
  on public.setup_versions (bike_id, version_number)
  where setup_id is null;

create unique index if not exists ux_setup_versions_setup_numbering
  on public.setup_versions (bike_id, setup_id, version_number)
  where setup_id is not null;

comment on index public.ux_setup_versions_default_numbering is
  'Default-setup lineage: one version_number per bike (the original 20260706120000 guarantee, now partial).';
comment on index public.ux_setup_versions_setup_numbering is
  'Named setups: one version_number per (bike, setup); pairs with assign_setup_version_number() from 20260904100000.';
