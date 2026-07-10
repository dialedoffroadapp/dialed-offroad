// isPaywallDecliner derivation + the decliner_converted 5-minute resume gate.

import {
  deriveIsPaywallDecliner,
  shouldLogDeclinerConversion,
} from "../lib/paywallDecliner";

const base = {
  hydrated: true,
  onboardingStep: "trial" as const,
  onboardingComplete: false,
  isPro: false,
  purchasedThisSession: false,
};

describe("deriveIsPaywallDecliner", () => {
  test("trial step, not entitled → decliner", () => {
    expect(deriveIsPaywallDecliner(base)).toBe(true);
  });

  test("not hydrated → never a decliner (no flash before state loads)", () => {
    expect(deriveIsPaywallDecliner({ ...base, hydrated: false })).toBe(false);
  });

  test("any non-trial step → not a decliner", () => {
    for (const step of [
      "intro",
      "garage_locked",
      "tune",
      "results_locked",
      "signup",
      "complete",
    ] as const) {
      expect(
        deriveIsPaywallDecliner({ ...base, onboardingStep: step })
      ).toBe(false);
    }
  });

  test("reactive to conversion: complete flag, pro flag, or session purchase each kill it", () => {
    expect(
      deriveIsPaywallDecliner({ ...base, onboardingComplete: true })
    ).toBe(false);
    expect(deriveIsPaywallDecliner({ ...base, isPro: true })).toBe(false);
    expect(
      deriveIsPaywallDecliner({ ...base, purchasedThisSession: true })
    ).toBe(false);
  });
});

describe("shouldLogDeclinerConversion (5-minute resume gate)", () => {
  test("trial step + 5min age → logged", () => {
    expect(shouldLogDeclinerConversion("trial", 5)).toBe(true);
    expect(shouldLogDeclinerConversion("trial", 60 * 24 * 3)).toBe(true);
  });

  test("trial step but fresh (straight-through day-0 purchase) → not logged", () => {
    expect(shouldLogDeclinerConversion("trial", 0)).toBe(false);
    expect(shouldLogDeclinerConversion("trial", 4)).toBe(false);
  });

  test("non-trial steps never log regardless of age", () => {
    expect(shouldLogDeclinerConversion("complete", 600)).toBe(false);
    expect(shouldLogDeclinerConversion("signup", 600)).toBe(false);
  });
});
