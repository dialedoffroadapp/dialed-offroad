// lib/onboarding.tsx
import React, { createContext, useContext, useMemo, useState } from "react";

type OnboardingState = {
  onboardingActive: boolean;
  setOnboardingActive: (v: boolean) => void;
  completeOnboarding: () => void;
};

const Ctx = createContext<OnboardingState>({
  onboardingActive: false,
  setOnboardingActive: () => {},
  completeOnboarding: () => {},
});

export function OnboardingProvider({
  children,
  initialActive = false,
}: {
  children: React.ReactNode;
  initialActive?: boolean;
}) {
  const [onboardingActive, setOnboardingActive] = useState(initialActive);

  const completeOnboarding = () => setOnboardingActive(false);

  const value = useMemo(
    () => ({ onboardingActive, setOnboardingActive, completeOnboarding }),
    [onboardingActive]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOnboarding() {
  return useContext(Ctx);
}
