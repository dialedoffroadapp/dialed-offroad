// __tests__/RideItHook.test.tsx
// Render-path tests for the WS-D post-reveal hook: the quiet line + button
// under the revealed settings that arms the ride check-in. The component is
// purely presentational (armed/busy/onArm injected), so these tests pin the
// visible copy and the disabled-while-armed/busy contract; the screen-side
// arming behavior (version ensure + scheduleRideReminder, no permission
// prompt) lives in app/tune-results.tsx.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../lib/theme", () => ({
  useTheme: () => ({
    colors: {
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
  RIDE_HOOK_CTA_ARMED,
  RIDE_HOOK_CTA_IDLE,
  RIDE_HOOK_LINE,
  RideItHook,
} from "../components/RideItHook";

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

test("idle: renders the hook line and the arm button, press fires onArm", () => {
  const onArm = jest.fn();
  const r = render(<RideItHook armed={false} onArm={onArm} />);

  const texts = allText(r);
  expect(texts).toContain(RIDE_HOOK_LINE);
  expect(texts).toContain(RIDE_HOOK_CTA_IDLE);

  const btn = r.root.findAll((n) => (n.type as unknown) === "Pressable")[0];
  act(() => btn.props.onPress());
  expect(onArm).toHaveBeenCalledTimes(1);
});

test("armed: shows confirmation label and cannot fire again", () => {
  const onArm = jest.fn();
  const r = render(<RideItHook armed onArm={onArm} />);

  const texts = allText(r);
  expect(texts).toContain(RIDE_HOOK_CTA_ARMED);
  expect(texts).not.toContain(RIDE_HOOK_CTA_IDLE);

  const btn = r.root.findAll((n) => (n.type as unknown) === "Pressable")[0];
  expect(btn.props.onPress).toBeUndefined();
  expect(btn.props.disabled).toBe(true);
  expect(onArm).not.toHaveBeenCalled();
});

test("busy: press is inert while the arm handler is in flight", () => {
  const onArm = jest.fn();
  const r = render(<RideItHook armed={false} busy onArm={onArm} />);

  const btn = r.root.findAll((n) => (n.type as unknown) === "Pressable")[0];
  expect(btn.props.onPress).toBeUndefined();
  expect(btn.props.disabled).toBe(true);
  // Still shows the idle label — busy is not armed.
  expect(allText(r)).toContain(RIDE_HOOK_CTA_IDLE);
});
