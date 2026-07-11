// Trial status day-math + trial-card priority (countdown beats value card).

import {
  deriveTrialStatus,
  MS_PER_DAY,
  pickTrialCard,
} from "../lib/trialStatus";

const NOW = 1_800_000_000_000;
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();

describe("deriveTrialStatus day math", () => {
  test("no entitlement → not in trial", () => {
    expect(deriveTrialStatus(null, NOW)).toEqual({
      isInTrial: false,
      daysRemaining: null,
      expirationDate: null,
      willRenew: null,
    });
    expect(deriveTrialStatus(undefined, NOW).isInTrial).toBe(false);
  });

  test("lifetime pro (null expiration) is never a trial", () => {
    const s = deriveTrialStatus(
      { periodType: "TRIAL", expirationDate: null, willRenew: false },
      NOW
    );
    expect(s.isInTrial).toBe(false);
  });

  test("paid entitlement (NORMAL) is not a trial", () => {
    const s = deriveTrialStatus(
      { periodType: "NORMAL", expirationDate: iso(30 * MS_PER_DAY), willRenew: true },
      NOW
    );
    expect(s.isInTrial).toBe(false);
    expect(s.willRenew).toBe(true);
  });

  test("mid-trial: 6.5 days left → ceil to 7", () => {
    const s = deriveTrialStatus(
      { periodType: "TRIAL", expirationDate: iso(6.5 * MS_PER_DAY), willRenew: true },
      NOW
    );
    expect(s).toMatchObject({ isInTrial: true, daysRemaining: 7 });
  });

  test("day 5 boundary: exactly 2 days left → 2; just over → 3", () => {
    expect(
      deriveTrialStatus(
        { periodType: "TRIAL", expirationDate: iso(2 * MS_PER_DAY) },
        NOW
      ).daysRemaining
    ).toBe(2);
    expect(
      deriveTrialStatus(
        { periodType: "TRIAL", expirationDate: iso(2 * MS_PER_DAY + 60_000) },
        NOW
      ).daysRemaining
    ).toBe(3);
  });

  test("final hours → 1 day (sandbox minutes-long trials land here too)", () => {
    const s = deriveTrialStatus(
      { periodType: "TRIAL", expirationDate: iso(5 * 60 * 1000) },
      NOW
    );
    expect(s).toMatchObject({ isInTrial: true, daysRemaining: 1 });
  });

  test("expired trial → not in trial (negative days never leak)", () => {
    const s = deriveTrialStatus(
      { periodType: "TRIAL", expirationDate: iso(-1 * MS_PER_DAY) },
      NOW
    );
    expect(s.isInTrial).toBe(false);
    expect(s.daysRemaining).toBe(0);
  });

  test("sandbox/clock weirdness: huge expiry clamps to trial length", () => {
    const s = deriveTrialStatus(
      { periodType: "TRIAL", expirationDate: iso(400 * MS_PER_DAY) },
      NOW
    );
    expect(s).toMatchObject({ isInTrial: true, daysRemaining: 7 });
  });

  test("unparseable expiration → not in trial", () => {
    const s = deriveTrialStatus(
      { periodType: "TRIAL", expirationDate: "not-a-date" },
      NOW
    );
    expect(s.isInTrial).toBe(false);
  });
});

describe("pickTrialCard priority", () => {
  const base = {
    isInTrial: true,
    daysRemaining: 6,
    accountAgeDays: 2,
    hasTune: true,
    valueCardDismissed: false,
  };

  test("countdown beats value card when both are eligible", () => {
    expect(pickTrialCard({ ...base, daysRemaining: 2 })).toBe("countdown");
    expect(pickTrialCard({ ...base, daysRemaining: 1 })).toBe("countdown");
  });

  test("value card in the day 1-3 window with a tune, before countdown", () => {
    expect(pickTrialCard(base)).toBe("value");
    expect(pickTrialCard({ ...base, accountAgeDays: 1 })).toBe("value");
    expect(pickTrialCard({ ...base, accountAgeDays: 3 })).toBe("value");
  });

  test("value card excluded: day 0, day 4+, no tune, or dismissed", () => {
    expect(pickTrialCard({ ...base, accountAgeDays: 0 })).toBeNull();
    expect(pickTrialCard({ ...base, accountAgeDays: 4 })).toBeNull();
    expect(pickTrialCard({ ...base, hasTune: false })).toBeNull();
    expect(pickTrialCard({ ...base, valueCardDismissed: true })).toBeNull();
    expect(pickTrialCard({ ...base, accountAgeDays: null })).toBeNull();
  });

  test("not in trial → never any card", () => {
    expect(pickTrialCard({ ...base, isInTrial: false })).toBeNull();
    expect(
      pickTrialCard({ ...base, isInTrial: false, daysRemaining: 1 })
    ).toBeNull();
  });
});
