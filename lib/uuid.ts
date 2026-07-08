// lib/uuid.ts
// Guest bikes created while signed out get LOCAL ids shaped like
// "1783553470201_9a0e52e462e018" (Date.now() + hex — see garage.tsx
// makeLocalId). Those ids live in AsyncStorage and inside pending-tune meta
// snapshots, and must never reach a uuid column. Guard every DB boundary.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Coerce a maybe-bike-id to a DB-safe value: uuid or null, never garbage. */
export function asUuidOrNull(v: unknown): string | null {
  return isUuid(v) ? v : null;
}
