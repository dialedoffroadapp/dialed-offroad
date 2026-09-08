-- Rider profiles (device pass finding 4, 2026-09-08).
--
-- The rider's facts (weight, unit, skill, class, default discipline) lived
-- only in the device-local quiz answers store, so every bike after the first
-- asked them again. One row per rider; profiles.active_rider_profile_id
-- points at the one in use. The quiz pre-fills from it and collapses to
-- "Still 160 lb, C class? Yes / Change"; the Profile screen edits it; tune
-- payloads carry rider.profile_id (additive optional).
--
-- Seed: the quiz answers are device-local and never reached the server, so
-- existing users are seeded from their most recent tune_calls row that
-- carried input.rider.weight_lbs (captured since 20260807120000). The engine
-- skill (beginner / intermediate / pro) maps back onto the quiz skill
-- (learning / comfortable / pro); "fast" also sent intermediate, so a
-- fast rider seeds as comfortable unless their class column says b.
-- Users with no captured tune get no row: the next quiz run creates one.

create table if not exists public.rider_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Me',
  weight_lbs numeric(5,1) check (weight_lbs is null or (weight_lbs >= 40 and weight_lbs <= 400)),
  unit text not null default 'lbs' check (unit in ('lbs', 'kg')),
  skill text check (skill is null or skill in ('learning', 'comfortable', 'fast', 'pro')),
  class text check (class is null or class in ('novice', 'c', 'b', 'a')),
  discipline_default text check (discipline_default is null or discipline_default in ('mx', 'offroad')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.rider_profiles is 'One row per rider (a person, not an account): weight, unit, skill, class, default discipline. profiles.active_rider_profile_id selects the one in use. Seeded from the latest tune_calls.input.rider per user (2026-09-08).';
comment on column public.rider_profiles.skill is 'Quiz skill id: learning | comfortable | fast | pro (lib/quizOnboarding.ts QuizSkillId).';
comment on column public.rider_profiles.class is 'Rider class for the engine skill offset: novice | c | b | a.';

create index if not exists rider_profiles_user_id_idx on public.rider_profiles (user_id, created_at);

alter table public.rider_profiles enable row level security;

drop policy if exists rider_profiles_select_own on public.rider_profiles;
create policy rider_profiles_select_own on public.rider_profiles
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists rider_profiles_insert_own on public.rider_profiles;
create policy rider_profiles_insert_own on public.rider_profiles
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists rider_profiles_update_own on public.rider_profiles;
create policy rider_profiles_update_own on public.rider_profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists rider_profiles_delete_own on public.rider_profiles;
create policy rider_profiles_delete_own on public.rider_profiles
  for delete to authenticated using (auth.uid() = user_id);

revoke all on public.rider_profiles from anon;
grant select, insert, update, delete on public.rider_profiles to authenticated;

create or replace function public.rider_profiles_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists rider_profiles_touch_updated_at on public.rider_profiles;
create trigger rider_profiles_touch_updated_at
  before update on public.rider_profiles
  for each row execute function public.rider_profiles_touch_updated_at();

-- profiles.active_rider_profile_id (column-level grants on profiles: explicit)
alter table public.profiles
  add column if not exists active_rider_profile_id uuid references public.rider_profiles(id) on delete set null;

grant select (active_rider_profile_id), insert (active_rider_profile_id), update (active_rider_profile_id)
  on public.profiles to authenticated;

-- Seed one profile per existing user from the latest captured tune input.
with latest as (
  select distinct on (t.user_id) t.user_id, t.input
  from public.tune_calls t
  where t.user_id is not null
    and t.input is not null
    and (t.input -> 'rider' ->> 'weight_lbs') ~ '^[0-9]+(\.[0-9]+)?$'
  order by t.user_id, t.created_at desc
),
ins as (
  insert into public.rider_profiles (user_id, name, weight_lbs, unit, skill, class, discipline_default)
  select
    l.user_id,
    'Me',
    least(400, greatest(40, (l.input -> 'rider' ->> 'weight_lbs')::numeric)),
    'lbs',
    case l.input -> 'rider' ->> 'skill'
      when 'beginner' then 'learning'
      when 'intermediate' then case when l.input -> 'rider' ->> 'class' = 'b' then 'fast' else 'comfortable' end
      when 'pro' then 'pro'
      else null
    end,
    case when l.input -> 'rider' ->> 'class' in ('novice', 'c', 'b', 'a') then l.input -> 'rider' ->> 'class' else null end,
    case when l.input -> 'rider' ->> 'discipline' in ('mx', 'offroad') then l.input -> 'rider' ->> 'discipline' else null end
  from latest l
  where not exists (select 1 from public.rider_profiles r where r.user_id = l.user_id)
  returning id, user_id
)
update public.profiles p
set active_rider_profile_id = ins.id
from ins
where p.user_id = ins.user_id
  and p.active_rider_profile_id is null;
