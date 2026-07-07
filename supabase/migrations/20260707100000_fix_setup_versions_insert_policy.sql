-- Fix: setup_versions insert policy rejected every refinement/restore row.
--
-- In the original policy the ownership subqueries used UNQUALIFIED column
-- names, e.g.  `where p.id = parent_version_id`. Because the aliased inner
-- table (p = setup_versions) also has a parent_version_id column, Postgres
-- binds the name to the INNERMOST scope — so the check was effectively
-- `p.id = p.parent_version_id`, which is never true. Result: any insert with
-- parent_version_id (source 'refinement') or restored_from_version_id set
-- failed RLS with 42501. Baseline inserts passed via the `is null` arm.
--
-- Client impact until this fix: createRefinementVersion() shadow writes
-- failed silently, leaving ride_feedback.resulting_version_id null — which
-- also starved the engine's adaptive step and the outcome check-in card.
--
-- The fix qualifies the outer row's columns with the table name.

drop policy "setup_versions_insert_own" on public.setup_versions;

create policy "setup_versions_insert_own"
  on public.setup_versions for insert
  with check (
    auth.uid() = user_id
    -- lineage pointers may only reference your own versions
    and (setup_versions.parent_version_id is null or exists (
      select 1 from public.setup_versions p
      where p.id = setup_versions.parent_version_id
        and p.user_id = auth.uid()
    ))
    and (setup_versions.restored_from_version_id is null or exists (
      select 1 from public.setup_versions r
      where r.id = setup_versions.restored_from_version_id
        and r.user_id = auth.uid()
    ))
  );
