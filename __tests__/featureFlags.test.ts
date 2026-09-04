// Both 3.0 flags default OFF when the env is unset, so an unconfigured build
// reproduces the shipped flow; HOME_GARAGE_V3 follows the quiz flag unless
// set explicitly.
describe("feature flags", () => {
  const load = () => {
    jest.resetModules();
    return require("../lib/featureFlags") as typeof import("../lib/featureFlags");
  };
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  test("unset env: both off", () => {
    delete process.env.EXPO_PUBLIC_QUIZ_ONBOARDING;
    delete process.env.EXPO_PUBLIC_HOME_GARAGE_V3;
    const f = load();
    expect(f.QUIZ_ONBOARDING_ENABLED).toBe(false);
    expect(f.HOME_GARAGE_V3_ENABLED).toBe(false);
  });

  test("quiz on lights home/garage unless split", () => {
    process.env.EXPO_PUBLIC_QUIZ_ONBOARDING = "1";
    delete process.env.EXPO_PUBLIC_HOME_GARAGE_V3;
    expect(load().HOME_GARAGE_V3_ENABLED).toBe(true);
    process.env.EXPO_PUBLIC_HOME_GARAGE_V3 = "0";
    expect(load().HOME_GARAGE_V3_ENABLED).toBe(false);
    process.env.EXPO_PUBLIC_QUIZ_ONBOARDING = "0";
    process.env.EXPO_PUBLIC_HOME_GARAGE_V3 = "1";
    const f = load();
    expect(f.QUIZ_ONBOARDING_ENABLED).toBe(false);
    expect(f.HOME_GARAGE_V3_ENABLED).toBe(true);
  });
});
