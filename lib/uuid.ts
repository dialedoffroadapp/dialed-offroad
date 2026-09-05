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

/** A v4 uuid minted on the device, for rows the outbox upserts by primary
 *  key (idempotent retries). expo-crypto when the binary has it, else a
 *  Math.random fallback that is still a valid v4 shape. */
export function newUuid(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const c = require("expo-crypto");
    if (typeof c?.randomUUID === "function") return c.randomUUID();
  } catch {
    // fall through
  }
  const h = () => Math.floor(Math.random() * 16).toString(16);
  const seg = (n: number) => Array.from({ length: n }, h).join("");
  const y = (8 + Math.floor(Math.random() * 4)).toString(16);
  return `${seg(8)}-${seg(4)}-4${seg(3)}-${y}${seg(3)}-${seg(12)}`;
}
