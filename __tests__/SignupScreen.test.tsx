// __tests__/SignupScreen.test.tsx
// v2.3.0 signup redesign, screen-level render paths:
//   - tease card shows with a pending tune, hides without one
//   - "Continue with email" expands/collapses the existing form, and the
//     expand rides heard_card_shown meta (no new event type — live CHECK)
//   - provider path proceeds WITHOUT the terms checkbox (passive line covers
//     it); email path still requires the checkbox via canSubmit
// Heavy mocks, same approach as OutcomeCheckinCard.test.tsx; auth flows
// themselves are covered by authSuccess/socialAuth suites, not re-tested.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useLocalSearchParams: () => ({}),
}));

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("../lib/theme", () => ({
  useTheme: () => ({
    colors: {
      BG: "#0B0C10",
      CARD: "#111",
      TEXT: "#fff",
      MUTED: "#888",
      ACCENT: "#1d9bf0",
      BORDER: "#333",
      INPUT_BG: "#0f1115",
      ERROR: "#e24b4a",
    },
  }),
}));

const toastShow = jest.fn();
jest.mock("../components/Toast", () => ({
  ToastProvider: ({ children }: any) => children,
  useToast: () => ({ show: toastShow }),
}));

const readPendingTune = jest.fn(async () => ({ tune: null, isExpired: false }));
jest.mock("../lib/onboarding", () => ({
  readPendingTune: (...a: any[]) => readPendingTune(...(a as [])),
  useOnboarding: () => ({
    state: {
      onboardingStep: "signup",
      hasSeenIntro: true,
      accountCreated: false,
      trialStarted: false,
      onboardingComplete: false,
      lastUpdatedAt: "2026-07-28T00:00:00.000Z",
    },
    markAccountCreated: jest.fn(async () => {}),
    setStep: jest.fn(async () => {}),
  }),
}));

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: { signUp: jest.fn(), signInWithPassword: jest.fn() },
    from: jest.fn(() => ({ upsert: jest.fn(async () => ({ error: null })) })),
  },
}));

const mockLogEvent = jest.fn(async (..._args: any[]) => {});
jest.mock("../lib/usage", () => ({
  logEvent: (...a: any[]) => mockLogEvent(...(a as [])),
  getOrCreateFunnelId: jest.fn(async () => "funnel_test"),
}));

jest.mock("../lib/authSuccess", () => ({
  completeAuthSuccess: jest.fn(async () => {}),
}));
jest.mock("../lib/tuneAttribution", () => ({
  claimAnonTuneCalls: jest.fn(async () => {}),
}));

const signInWithApple = jest.fn(async () => ({ status: "cancelled" as const }));
jest.mock("../lib/socialAuth", () => ({
  isAppleSignInAvailable: jest.fn(async () => true),
  isGoogleSignInAvailable: jest.fn(() => true),
  signInWithApple: (...a: any[]) => signInWithApple(...(a as [])),
  signInWithGoogle: jest.fn(async () => ({ status: "cancelled" as const })),
}));

/* eslint-disable import/first -- imports must follow the mock factories */
import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import SignupScreen from "../app/signup";

function textsIn(node: any): string[] {
  return node
    .findAll((n: any) => (n.type as unknown) === "Text")
    .map((n: any) =>
      (Array.isArray(n.props.children)
        ? n.props.children
            .map((c: any) => (typeof c === "string" ? c : ""))
            .join("")
        : String(n.props.children ?? "")
      ).trim()
    )
    .filter(Boolean);
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let r: ReactTestRenderer;
  await act(async () => {
    r = create(<SignupScreen />);
  });
  // flush availability + pending-tune effects
  await act(async () => {});
  return r!;
}

function pressableWithText(r: ReactTestRenderer, text: string) {
  return r.root
    .findAll((n) => (n.type as unknown) === "Pressable")
    .find((p) => textsIn(p).some((t) => t.includes(text)));
}

const PENDING = {
  tune: {
    r: encodeURIComponent(
      JSON.stringify({
        fork: { comp_clicks: 16, air_pressure_bar: 10.76 },
        shock: { reb_clicks: 12 },
      })
    ),
    meta: encodeURIComponent("{}"),
    bikeId: null,
    savedAt: 1,
  },
  isExpired: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  readPendingTune.mockResolvedValue({ tune: null, isExpired: false } as any);
});

test("tease card renders the rider's REAL pending values", async () => {
  readPendingTune.mockResolvedValue(PENDING as any);
  const r = await renderScreen();
  const texts = textsIn(r.root);
  expect(texts).toContain("YOUR TUNE IS READY");
  expect(texts).toContain("16 clicks");
  expect(texts).toContain("12 clicks");
  expect(texts).toContain("10.76 bar");
});

test("no pending tune (direct route): tease card fully hidden", async () => {
  const r = await renderScreen();
  expect(textsIn(r.root)).not.toContain("YOUR TUNE IS READY");
});

test("email form expands and collapses; expand rides heard_card_shown meta exactly once", async () => {
  const r = await renderScreen();
  expect(textsIn(r.root)).not.toContain("Password");

  const row = pressableWithText(r, "Continue with email")!;
  await act(async () => row.props.onPress());
  expect(textsIn(r.root)).toContain("Password");
  expect(mockLogEvent).toHaveBeenCalledWith(
    "heard_card_shown",
    expect.objectContaining({ surface: "signup_email_expand" }),
    expect.objectContaining({ allowAnonymous: true, queueIfAnonymous: true })
  );

  await act(async () => row.props.onPress()); // collapse
  expect(textsIn(r.root)).not.toContain("Password");

  await act(async () => row.props.onPress()); // re-expand
  const expandEvents = mockLogEvent.mock.calls.filter(
    (c) => c[0] === "heard_card_shown"
  );
  expect(expandEvents).toHaveLength(1); // once per screen session
});

test("provider path proceeds WITHOUT the terms checkbox", async () => {
  const r = await renderScreen();
  const apple = pressableWithText(r, "Continue with Apple")!;
  await act(async () => apple.props.onPress());
  expect(signInWithApple).toHaveBeenCalledTimes(1);
  expect(toastShow).not.toHaveBeenCalledWith(
    expect.stringContaining("agree"),
    expect.anything()
  );
});

test("email path still requires the checkbox", async () => {
  const r = await renderScreen();
  await act(async () => pressableWithText(r, "Continue with email")!.props.onPress());

  const inputs = r.root.findAll((n) => (n.type as unknown) === "TextInput");
  await act(async () => inputs[0].props.onChangeText("rider@example.com"));
  await act(async () => inputs[1].props.onChangeText("hunter22"));

  const submit = pressableWithText(r, "Create Account")!;
  expect(submit.props.disabled).toBe(true); // checkbox unchecked

  const checkbox = r.root.find(
    (n) => n.props?.accessibilityRole === "checkbox"
  );
  await act(async () => checkbox.props.onPress());

  const submitAfter = pressableWithText(r, "Create Account")!;
  expect(submitAfter.props.disabled).toBe(false);
});
