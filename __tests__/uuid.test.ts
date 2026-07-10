// autoBaseline's uuid guard rests on lib/uuid: guest bikes carry local
// timestamp-style ids that must never reach a uuid column.

import { asUuidOrNull, isUuid } from "../lib/uuid";

describe("isUuid / asUuidOrNull (autoBaseline uuid guard)", () => {
  test("rejects guest-bike timestamp-style local ids", () => {
    expect(isUuid("1783553470201_9a0e52e462e018")).toBe(false);
    expect(asUuidOrNull("1783553470201_9a0e52e462e018")).toBeNull();
  });

  test("accepts real uuids", () => {
    const real = "a3bb189e-8bf9-3888-9912-ace4e6543002";
    expect(isUuid(real)).toBe(true);
    expect(asUuidOrNull(real)).toBe(real);
    expect(isUuid("A3BB189E-8BF9-3888-9912-ACE4E6543002")).toBe(true);
  });

  test("rejects non-strings, empty, and near-misses", () => {
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(123)).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("a3bb189e-8bf9-3888-9912-ace4e654300")).toBe(false); // 11 tail chars
    expect(isUuid("a3bb189e8bf938889912ace4e6543002")).toBe(false); // no dashes
    expect(asUuidOrNull(42)).toBeNull();
  });
});
