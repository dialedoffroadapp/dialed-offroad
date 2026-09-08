# Rider profiles

Device pass finding 4 (2026-09-08). Migration `20260908100000_rider_profiles.sql`
(applied on dev-3-0, STAGED for prod). Client: `lib/riderProfile.ts`.

## Why

The rider's facts (weight, unit, skill, class, default discipline) lived only
in the device-local quiz answers store. Every bike after the first asked them
again on a new device, and nothing on the server knew who the rider was. A
profile is a person, not an account.

## Schema

`rider_profiles`: `id`, `user_id`, `name` (default "Me"), `weight_lbs`,
`unit` (lbs | kg), `skill` (the quiz skill id: learning | comfortable | fast |
pro), `class` (novice | c | b | a), `discipline_default` (mx | offroad),
`created_at`, `updated_at`. Own-rows RLS, no anon grant.
`profiles.active_rider_profile_id` (nullable, column-level grant) selects the
row in use.

## Where it shows

- **Quiz skill step**: on any bike after the first (garage flows, or a
  signed-in first run on a new device), the skill screen collapses to
  "Still 160 lb, C class? Yes / Change". Yes writes both facts into the
  answers and skips the weight screen. Change shows the normal cards.
- **Quiz weight step**: a rider with a profile sees "Just this bike. Keep
  my profile as it is." Off (the default) means the new weight, unit and
  skill update the profile. On means the answers stay on this bike's tune
  only. A failed profile write surfaces as a toast and the tune still builds.
- **Profile screen, Rider section**: weight, unit, skill, class, default
  discipline. Editing changes the defaults only. Tunes already built keep the
  numbers they were built with; nothing regenerates.
- **Tune payloads**: `rider.profile_id` (uuid only, additive optional) on
  both the baseline and the refine payload. The edge strips a non-uuid
  value and never reads it for generation; it lands in `tune_calls.input`.

## Seeding existing users

The quiz answers never reached the server, so the migration seeds one
profile per user from their most recent `tune_calls` row that carried
`input.rider.weight_lbs` (captured since `20260807120000`). The engine skill
maps back: beginner = learning, intermediate = comfortable (fast when the
row's class says b), pro = pro. Users with no captured tune get no row; the
next quiz weight step creates one. Unit seeds as lbs (the wire only carries
pounds).

## The switcher trigger: the kids' bike

A parent adds their kid's 85. The skill step asks "Still 175 lb, B class?"
and the honest answer is Change. Today, Change with "Just this bike" off
would overwrite the parent's profile with the kid's numbers, which is why
the checkbox exists. That moment is the trigger for a second profile: the
Change path should offer "Not you? Add a rider" and create a second
`rider_profiles` row, with the bike remembering which profile built its
tunes. Not built yet. What it needs:

- a `bikes.rider_profile_id` (or per-setup) pointer, so the confirm line on
  a bike reads that bike's rider, not the account's active one;
- a switcher on the Profile screen (list, rename, set active, delete);
- `rider.profile_id` already on the payload, so the engine input is
  attributable per rider without a contract change.
