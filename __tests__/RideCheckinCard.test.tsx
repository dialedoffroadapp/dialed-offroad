// __tests__/RideCheckinCard.test.tsx
// Shared arming card, both surface shapes: Setup ("THE NEXT STEP", no
// snooze) and Home ("YOUR TUNE IS LIVE" + "Not now"). Arming logic lives in
// the host screens; lifecycle in lib/rideArmCard (own suite).

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../lib/theme", () => ({
  useTheme: () => ({
    colors: {
      CARD: "#111",
      TEXT: "#fff",
      MUTED: "#888",
      ACCENT: "#1d9bf0",
      BORDER: "#333",
    },
  }),
}));

import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import {
  RIDE_CHECKIN_ARMED,
  RIDE_CHECKIN_CTA,
  RideCheckinCard,
} from "../components/RideCheckinCard";

function allText(r: ReactTestRenderer): string[] {
  return r.root
    .findAll((n) => (n.type as unknown) === "Text")
    .map((n) =>
      (Array.isArray(n.props.children)
        ? n.props.children.join("")
        : String(n.props.children ?? "")
      ).trim()
    )
    .filter(Boolean);
}

function render(el: React.ReactElement): ReactTestRenderer {
  let r: ReactTestRenderer;
  act(() => {
    r = create(el);
  });
  return r!;
}

function pressableWithText(r: ReactTestRenderer, text: string) {
  return r.root
    .findAll((n) => (n.type as unknown) === "Pressable")
    .find((p) =>
      p
        .findAll((t: any) => (t.type as unknown) === "Text")
        .some((t: any) =>
          String(
            Array.isArray(t.props.children)
              ? t.props.children.join("")
              : t.props.children
          ).includes(text)
        )
    );
}

test("setup shape: caps + body + CTA, arm fires, no Not-now", () => {
  const onArm = jest.fn();
  const r = render(
    <RideCheckinCard
      caps="THE NEXT STEP"
      body="Ride it, then tell me how it felt. I'll adjust."
      armed={false}
      onArm={onArm}
    />
  );
  const texts = allText(r);
  expect(texts).toContain("THE NEXT STEP");
  expect(texts).toContain("Ride it, then tell me how it felt. I'll adjust.");
  expect(texts).toContain(RIDE_CHECKIN_CTA);
  expect(texts).not.toContain("Not now");

  act(() => pressableWithText(r, RIDE_CHECKIN_CTA)!.props.onPress());
  expect(onArm).toHaveBeenCalledTimes(1);
});

test("home shape: Not now renders and fires", () => {
  const onNotNow = jest.fn();
  const r = render(
    <RideCheckinCard
      caps="YOUR TUNE IS LIVE"
      body="KTM 300 XC-W is set up. Tell me how the next ride feels and I'll refine it."
      armed={false}
      onArm={jest.fn()}
      onNotNow={onNotNow}
    />
  );
  expect(allText(r)).toContain("Not now");
  act(() => pressableWithText(r, "Not now")!.props.onPress());
  expect(onNotNow).toHaveBeenCalledTimes(1);
});

test("armed state: label swaps, button inert, Not-now gone", () => {
  const onArm = jest.fn();
  const r = render(
    <RideCheckinCard
      caps="YOUR TUNE IS LIVE"
      body="Body"
      armed
      onArm={onArm}
      onNotNow={jest.fn()}
    />
  );
  const texts = allText(r);
  expect(texts).toContain(RIDE_CHECKIN_ARMED);
  expect(texts).not.toContain(RIDE_CHECKIN_CTA);
  expect(texts).not.toContain("Not now");

  const btn = pressableWithText(r, RIDE_CHECKIN_ARMED)!;
  expect(btn.props.onPress).toBeUndefined();
  expect(btn.props.disabled).toBe(true);
  expect(onArm).not.toHaveBeenCalled();
});

test("busy: CTA label retained but press is inert", () => {
  const onArm = jest.fn();
  const r = render(
    <RideCheckinCard caps="X" body="Y" armed={false} busy onArm={onArm} />
  );
  const btn = pressableWithText(r, RIDE_CHECKIN_CTA)!;
  expect(btn.props.onPress).toBeUndefined();
  expect(btn.props.disabled).toBe(true);
});
