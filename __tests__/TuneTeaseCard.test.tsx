// __tests__/TuneTeaseCard.test.tsx
// Paywall-integrity contract: the tease card renders STATIC DECOYS only —
// it takes no value props, so the rider's real pending tune cannot reach it.
// Row presence (air vs coil) is the only variability.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../lib/theme", () => ({
  useTheme: () => ({
    colors: {
      BG: "#0B0C10",
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
  TEASE_DECOY_AIR,
  TEASE_DECOY_FORK,
  TEASE_DECOY_SHOCK,
  TuneTeaseCard,
} from "../components/TuneTeaseCard";

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

test("renders header and the three DECOY rows under the locked-results blur", () => {
  const r = render(<TuneTeaseCard showAir />);
  const texts = allText(r);
  expect(texts).toContain("YOUR TUNE IS READY");
  expect(texts).toContain(TEASE_DECOY_FORK);
  expect(texts).toContain(TEASE_DECOY_SHOCK);
  expect(texts).toContain(TEASE_DECOY_AIR);

  const blurs = r.root.findAll((n) => (n.type as unknown) === "BlurView");
  expect(blurs).toHaveLength(3);
  expect(blurs[0].props.intensity).toBe(30);
});

test("coil fork: air row dropped, blur count follows", () => {
  const r = render(<TuneTeaseCard showAir={false} />);
  const texts = allText(r);
  expect(texts).not.toContain("Air pressure");
  expect(texts).not.toContain(TEASE_DECOY_AIR);
  expect(r.root.findAll((n) => (n.type as unknown) === "BlurView")).toHaveLength(2);
});

test("decoy values are the approved statics and nothing else renders as a value", () => {
  expect(TEASE_DECOY_FORK).toBe("14 clicks");
  expect(TEASE_DECOY_SHOCK).toBe("11 clicks");
  expect(TEASE_DECOY_AIR).toBe("10.2 bar");

  const r = render(<TuneTeaseCard showAir />);
  const allowed = new Set([
    "YOUR TUNE IS READY",
    "Fork compression",
    "Shock rebound",
    "Air pressure",
    TEASE_DECOY_FORK,
    TEASE_DECOY_SHOCK,
    TEASE_DECOY_AIR,
  ]);
  for (const t of allText(r)) {
    expect(allowed.has(t)).toBe(true);
  }
});
