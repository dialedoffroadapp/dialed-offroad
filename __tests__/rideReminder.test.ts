// nextReminderDate:
//   Mon–Thu tune → coming Saturday 7pm (after the weekend ride).
//   Fri–Sun tune → 36h after the tune, nudged into a 9am–8pm local window.
// 2026-07-07 Tue, 07-08 Wed, 07-09 Thu, 07-10 Fri, 07-11 Sat, 07-12 Sun,
// 07-13 Mon, 07-14 Tue, 07-18 Sat.

import { nextReminderDate } from "../lib/rideReminder";

const local = (
  y: number,
  m1: number, // 1-based month
  d: number,
  h: number,
  min = 0
) => new Date(y, m1 - 1, d, h, min, 0, 0);

describe("nextReminderDate", () => {
  // Fri–Sun tunes: plain 36h, clamped into the daytime window.

  test("Fri 2pm → +36h lands Sun 2am → clamped up to Sun 9am", () => {
    const now = local(2026, 7, 10, 14); // Fri 14:00
    expect(nextReminderDate(now)).toEqual(local(2026, 7, 12, 9));
  });

  test("Fri 10pm → +36h lands Sun 10am, inside the window → kept", () => {
    const now = local(2026, 7, 10, 22); // Fri 22:00
    expect(nextReminderDate(now)).toEqual(local(2026, 7, 12, 10));
  });

  test("Sat 10am → +36h lands Sun 10pm → pushed to Mon 9am", () => {
    const now = local(2026, 7, 11, 10); // Sat 10:00
    expect(nextReminderDate(now)).toEqual(local(2026, 7, 13, 9));
  });

  test("Sun 10am → +36h lands Mon 10pm → pushed to Tue 9am", () => {
    const now = local(2026, 7, 12, 10); // Sun 10:00
    expect(nextReminderDate(now)).toEqual(local(2026, 7, 14, 9));
  });

  // Mon–Thu tunes: the coming Saturday at 7pm, regardless of the 36h mark.

  test("Mon 10am → Saturday 7pm (5 days out)", () => {
    const now = local(2026, 7, 13, 10); // Mon 10:00
    expect(nextReminderDate(now)).toEqual(local(2026, 7, 18, 19));
  });

  test("Tue 10pm → coming Saturday 7pm", () => {
    const now = local(2026, 7, 7, 22); // Tue 22:00
    expect(nextReminderDate(now)).toEqual(local(2026, 7, 11, 19));
  });

  test("Wed 8am → coming Saturday 7pm", () => {
    const now = local(2026, 7, 8, 8); // Wed 08:00
    expect(nextReminderDate(now)).toEqual(local(2026, 7, 11, 19));
  });

  test("Thu 11pm → coming Saturday 7pm (2 days out, not 36h)", () => {
    const now = local(2026, 7, 9, 23); // Thu 23:00
    expect(nextReminderDate(now)).toEqual(local(2026, 7, 11, 19));
  });

  test("always future and inside 9am–8pm; midweek → Saturday 7pm", () => {
    const MAX_WEEKEND_MS = 49 * 60 * 60 * 1000; // 36h + at most a 13h push
    for (let day = 6; day <= 14; day++) {
      for (const hour of [0, 8, 9, 10, 14, 20, 23]) {
        const now = local(2026, 7, day, hour);
        const fire = nextReminderDate(now);
        expect(fire.getTime()).toBeGreaterThan(now.getTime());
        expect(fire.getHours()).toBeGreaterThanOrEqual(9);
        expect(fire.getHours()).toBeLessThan(20);

        const dow = now.getDay(); // 0 Sun … 6 Sat
        if (dow >= 1 && dow <= 4) {
          expect(fire.getDay()).toBe(6); // Saturday
          expect(fire.getHours()).toBe(19); // 7pm
        } else {
          expect(fire.getTime() - now.getTime()).toBeLessThanOrEqual(
            MAX_WEEKEND_MS
          );
        }
      }
    }
  });
});
