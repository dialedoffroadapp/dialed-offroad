// Check-in card decision logic: first-ride eligibility, snooze vs dismissal
// strike accounting, blocking records, and outcome-card title derivation.

import {
  applyDismiss,
  applySnooze,
  FALLBACK_TITLE,
  isFirstRideEligible,
  isRecordBlocking,
  MAX_DISMISSALS,
  THREE_DAYS_MS,
  titleFromSymptoms,
  TWELVE_HOURS_MS,
} from "../lib/checkinLogic";

const NOW = 1_800_000_000_000;

const baseVersion = {
  id: "v-1",
  source: "baseline" as const,
  bike_id: "b-1",
  created_at: new Date(NOW - TWELVE_HOURS_MS - 60_000).toISOString(),
};

describe("isFirstRideEligible (new baseline branch)", () => {
  test("uncritiqued baseline with bike, ≥12h old → eligible", () => {
    expect(isFirstRideEligible(baseVersion, NOW)).toBe(true);
  });

  test("younger than 12h → not eligible", () => {
    const v = {
      ...baseVersion,
      created_at: new Date(NOW - TWELVE_HOURS_MS + 60_000).toISOString(),
    };
    expect(isFirstRideEligible(v, NOW)).toBe(false);
  });

  test("refinement source → not eligible (outcome branch owns it)", () => {
    expect(
      isFirstRideEligible({ ...baseVersion, source: "refinement" }, NOW)
    ).toBe(false);
  });

  test("restore source → not eligible", () => {
    expect(
      isFirstRideEligible({ ...baseVersion, source: "restore" }, NOW)
    ).toBe(false);
  });

  test("bikeless version → not eligible", () => {
    expect(isFirstRideEligible({ ...baseVersion, bike_id: null }, NOW)).toBe(
      false
    );
  });

  test("null/missing version → not eligible", () => {
    expect(isFirstRideEligible(null, NOW)).toBe(false);
    expect(isFirstRideEligible(undefined, NOW)).toBe(false);
  });
});

describe("snooze vs dismiss strike accounting", () => {
  test("'Haven't ridden yet' snooze does NOT increment the count", () => {
    expect(applySnooze(null, NOW)).toEqual({
      count: 0,
      until: NOW + THREE_DAYS_MS,
    });
    expect(applySnooze({ count: 1, until: 0 }, NOW)).toEqual({
      count: 1,
      until: NOW + THREE_DAYS_MS,
    });
    // Unlimited snoozes never reach the strike limit.
    let rec = applySnooze(null, NOW);
    for (let i = 0; i < 10; i++) rec = applySnooze(rec, NOW);
    expect(rec.count).toBe(0);
  });

  test("explicit ✕ dismissal increments the count", () => {
    expect(applyDismiss(null, NOW).count).toBe(1);
    expect(applyDismiss({ count: 1, until: 0 }, NOW).count).toBe(2);
  });

  test("2 explicit dismissals block permanently; snoozes only block while running", () => {
    const twoStrikes = applyDismiss(applyDismiss(null, NOW), NOW);
    expect(twoStrikes.count).toBe(MAX_DISMISSALS);
    // Blocked even after the snooze window has long passed.
    expect(isRecordBlocking(twoStrikes, NOW + 10 * THREE_DAYS_MS)).toBe(true);

    const snoozed = applySnooze(null, NOW);
    expect(isRecordBlocking(snoozed, NOW + 1000)).toBe(true); // window running
    expect(isRecordBlocking(snoozed, NOW + THREE_DAYS_MS + 1)).toBe(false);
    expect(isRecordBlocking(null, NOW)).toBe(false);
  });
});

describe("titleFromSymptoms (outcome/refinement branch)", () => {
  test("uses the highest-severity symptom phrase with location", () => {
    expect(
      titleFromSymptoms([
        { id: "dead_feel", severity: 4 },
        { id: "front_knifes", severity: 9, where: "Corners" },
      ])
    ).toBe("Last time you said the front was tucking in corners. Better on the new setup?");
  });

  test("ignores protect entries; falls back when nothing usable", () => {
    expect(titleFromSymptoms([{ area: "Landings", protect: true }])).toBe(
      FALLBACK_TITLE
    );
    expect(titleFromSymptoms([])).toBe(FALLBACK_TITLE);
    expect(titleFromSymptoms(undefined)).toBe(FALLBACK_TITLE);
    expect(titleFromSymptoms([{ id: "not_a_real_symptom", severity: 8 }])).toBe(
      FALLBACK_TITLE
    );
  });
});
