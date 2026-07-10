// nextReminderDate: min(next Saturday 9:00am local, now + 48h).
// 2026-07-10 is a Friday; 07-11 Saturday; 07-12 Sunday; 07-13 Monday.

import { nextReminderDate } from "../lib/rideReminder";

const local = (
  y: number,
  m1: number, // 1-based month
  d: number,
  h: number,
  min = 0
) => new Date(y, m1 - 1, d, h, min, 0, 0);

describe("nextReminderDate", () => {
  test("Friday 2pm → Saturday 9am (next-Sat wins over +48h)", () => {
    const now = local(2026, 7, 10, 14); // Fri 14:00
    expect(nextReminderDate(now)).toEqual(local(2026, 7, 11, 9));
  });

  test("Saturday 8am → same-day Saturday 9am", () => {
    const now = local(2026, 7, 11, 8); // Sat 08:00
    expect(nextReminderDate(now)).toEqual(local(2026, 7, 11, 9));
  });

  test("Saturday 2pm → Monday 2pm via +48h (next Sat is 7 days out)", () => {
    const now = local(2026, 7, 11, 14); // Sat 14:00
    expect(nextReminderDate(now)).toEqual(local(2026, 7, 13, 14));
  });

  test("Sunday 10am → Tuesday 10am via +48h", () => {
    const now = local(2026, 7, 12, 10); // Sun 10:00
    expect(nextReminderDate(now)).toEqual(local(2026, 7, 14, 10));
  });

  test("result is never in the past and never more than 48h out", () => {
    for (let day = 8; day <= 14; day++) {
      for (const hour of [0, 8, 9, 10, 23]) {
        const now = local(2026, 7, day, hour);
        const fire = nextReminderDate(now);
        expect(fire.getTime()).toBeGreaterThan(now.getTime());
        expect(fire.getTime() - now.getTime()).toBeLessThanOrEqual(
          48 * 60 * 60 * 1000
        );
      }
    }
  });
});
