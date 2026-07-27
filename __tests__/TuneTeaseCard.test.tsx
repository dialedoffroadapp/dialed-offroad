// __tests__/TuneTeaseCard.test.tsx
// The signup tease card: real pending-tune values behind the locked-results
// blur treatment. Row-level behavior lives here; screen-level hide-when-no-
// pending-tune lives in SignupScreen.test.tsx.

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
import { TuneTeaseCard } from "../components/TuneTeaseCard";

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

test("renders header and all three value rows with real units", () => {
  const r = render(
    <TuneTeaseCard values={{ fork_comp: 16, shock_reb: 12, air_bar: 10.76 }} />
  );
  const texts = allText(r);
  expect(texts).toContain("YOUR TUNE IS READY");
  expect(texts).toContain("Fork compression");
  expect(texts).toContain("16 clicks");
  expect(texts).toContain("Shock rebound");
  expect(texts).toContain("12 clicks");
  expect(texts).toContain("Air pressure");
  expect(texts).toContain("10.76 bar");
  // One blur overlay per value, locked-results treatment.
  const blurs = r.root.findAll((n) => (n.type as unknown) === "BlurView");
  expect(blurs).toHaveLength(3);
  expect(blurs[0].props.intensity).toBe(30);
});

test("coil fork (no air value) drops the air row only", () => {
  const r = render(
    <TuneTeaseCard values={{ fork_comp: 14, shock_reb: 11, air_bar: null }} />
  );
  const texts = allText(r);
  expect(texts).toContain("Fork compression");
  expect(texts).toContain("Shock rebound");
  expect(texts).not.toContain("Air pressure");
});

test("no usable values at all renders nothing", () => {
  const r = render(
    <TuneTeaseCard values={{ fork_comp: null, shock_reb: null, air_bar: null }} />
  );
  expect(r.toJSON()).toBeNull();
});
