// __tests__/bikeReconcile.test.ts
// The retry stash is user-bound: a stash written for user A must never
// materialize a bike for user B at cold-start retry (the consumer drops
// other-user records). Predicate coverage for the binding logic used by
// reconcileGuestBikes step 3.

import { stashBelongsToUser } from "../lib/bikeReconcile";

const A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

const stashForA = { make: "KTM", model: "300 XC-W", year: 2020, userId: A };

test("stash for user A fires only for user A", () => {
  expect(stashBelongsToUser(stashForA, A)).toBe(true);
});

test("stash for user A never writes into user B", () => {
  expect(stashBelongsToUser(stashForA, B)).toBe(false);
});

test("unbound or malformed stash never fires", () => {
  expect(stashBelongsToUser({ make: "KTM", model: "300 XC-W", year: 2020 }, A)).toBe(false);
  expect(stashBelongsToUser(null, A)).toBe(false);
  expect(stashBelongsToUser({ ...stashForA, make: "" }, A)).toBe(false);
});
