// __tests__/LoopPreview.test.tsx
// Render-path tests for the WS-D loop preview: the faux 3-entry timeline
// shown pre-paywall on locked results (and reused as onboarding Slide 2's
// visual). Guards the preview framing (PREVIEW tag), the approved entry
// strings, and the single-source-of-truth default entry set.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
  DEFAULT_LOOP_PREVIEW_ENTRIES,
  LoopPreview,
} from "../components/LoopPreview";

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

test("renders the default title, PREVIEW tag, and all three approved entries", () => {
  const r = render(<LoopPreview />);
  const texts = allText(r);

  expect(texts).toContain("It learns every time you ride");
  expect(texts).toContain("PREVIEW");

  for (const entry of DEFAULT_LOOP_PREVIEW_ENTRIES) {
    expect(texts).toContain(entry.version);
    expect(texts).toContain(entry.text);
  }
});

test("default entry set is the approved working copy (single source for both surfaces)", () => {
  expect(DEFAULT_LOOP_PREVIEW_ENTRIES).toEqual([
    { version: "v1", text: "Baseline set for your weight and bike" },
    { version: "v2", text: "Softened compression 2 clicks after braking chatter" },
    { version: "v3", text: "Sag dialed in for 4,800 ft elevation" },
  ]);
  // Copy rule: no em dashes anywhere in user-facing preview strings.
  for (const entry of DEFAULT_LOOP_PREVIEW_ENTRIES) {
    expect(entry.text).not.toMatch(/—/);
  }
});

test("custom title and entries override the defaults (Slide 2 reuse path)", () => {
  const r = render(
    <LoopPreview
      title="Custom headline"
      entries={[{ version: "v9", text: "Custom entry" }]}
    />
  );
  const texts = allText(r);

  expect(texts).toContain("Custom headline");
  expect(texts).toContain("v9");
  expect(texts).toContain("Custom entry");
  expect(texts).not.toContain(DEFAULT_LOOP_PREVIEW_ENTRIES[0].text);
});
