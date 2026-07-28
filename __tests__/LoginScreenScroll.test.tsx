// __tests__/LoginScreenScroll.test.tsx
// Layout regression guard for the login scroll fix (same class as signup
// c9f052d): the whole screen lives in a ScrollView that keeps buttons
// tappable with the keyboard up and clears the home indicator. Layout only —
// auth logic is covered by authSuccess/socialAuth suites.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock("expo-linking", () => ({ createURL: () => "dialedoffroad://x" }));
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

jest.mock("../components/Toast", () => ({
  ToastProvider: ({ children }: any) => children,
  useToast: () => ({ show: jest.fn() }),
}));

jest.mock("../lib/onboarding", () => ({
  readLocalOnboardingState: jest.fn(async () => ({
    onboardingStep: "complete",
    onboardingComplete: true,
  })),
  readPendingTune: jest.fn(async () => ({ tune: null, isExpired: false })),
  useOnboarding: () => ({
    state: {
      onboardingStep: "complete",
      onboardingComplete: true,
      accountCreated: true,
      trialStarted: false,
      lastUpdatedAt: "2026-07-28T00:00:00.000Z",
      hasSeenIntro: true,
    },
    markAccountCreated: jest.fn(async () => {}),
    setStep: jest.fn(async () => {}),
  }),
}));

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: { signInWithPassword: jest.fn(), getUser: jest.fn(), resetPasswordForEmail: jest.fn() },
    from: jest.fn(() => ({ upsert: jest.fn(async () => ({ error: null })) })),
  },
}));
jest.mock("../lib/proUtils", () => ({ deriveIsPro: () => false }));
jest.mock("../lib/usage", () => ({
  logEvent: jest.fn(async () => {}),
  getOrCreateFunnelId: jest.fn(async () => "f"),
}));
jest.mock("../lib/authSuccess", () => ({
  completeAuthSuccess: jest.fn(async () => {}),
}));
jest.mock("../lib/tuneAttribution", () => ({
  claimAnonTuneCalls: jest.fn(async () => {}),
}));
jest.mock("../lib/socialAuth", () => ({
  isAppleSignInAvailable: jest.fn(async () => true),
  isGoogleSignInAvailable: jest.fn(() => true),
  signInWithApple: jest.fn(async () => ({ status: "cancelled" })),
  signInWithGoogle: jest.fn(async () => ({ status: "cancelled" })),
}));

/* eslint-disable import/first -- imports must follow the mock factories */
import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import LoginScreen from "../app/login";

async function renderScreen(): Promise<ReactTestRenderer> {
  let r: ReactTestRenderer;
  await act(async () => {
    r = create(<LoginScreen />);
  });
  await act(async () => {});
  return r!;
}

test("login lives in a keyboard-safe ScrollView with flexGrow + bottom clearance", async () => {
  const r = await renderScreen();

  const scroll = r.root.findAll((n) => (n.type as unknown) === "ScrollView")[0];
  expect(scroll).toBeTruthy();
  expect(scroll.props.keyboardShouldPersistTaps).toBe("handled");
  expect(scroll.props.keyboardDismissMode).toBe("interactive");
  expect(scroll.props.contentContainerStyle.flexGrow).toBe(1);
  expect(scroll.props.contentContainerStyle.paddingBottom).toBeGreaterThanOrEqual(48);

  // Tap-to-dismiss stays INSIDE the scroll container.
  const twf = scroll.findAll(
    (n) => (n.type as unknown) === "TouchableWithoutFeedback"
  );
  expect(twf.length).toBeGreaterThanOrEqual(1);

  // The full form is in the scrollable tree: inputs + provider buttons.
  expect(
    scroll.findAll((n) => (n.type as unknown) === "TextInput").length
  ).toBeGreaterThanOrEqual(2);
  const texts = scroll
    .findAll((n) => (n.type as unknown) === "Text")
    .map((n) =>
      Array.isArray(n.props.children)
        ? n.props.children.join("")
        : String(n.props.children ?? "")
    );
  expect(texts).toContain("Continue with Apple");
  expect(texts.some((t) => t.includes("Welcome back"))).toBe(true);
});
