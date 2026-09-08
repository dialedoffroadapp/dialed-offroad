// The 2016 air-or-coil banner (2026-09-08): shows only for an ambiguous row
// with no stored answer, disappears once the answer is saved, and
// effectiveAirFork picks the answer up.
import React from "react";
import renderer, { act } from "react-test-renderer";
import { AirForkBanner, AIR_FORK_BANNER_LINE } from "../components/garage/AirForkBanner";
import { effectiveAirFork, shouldShowAirForkBanner, type ModelSpecs } from "../lib/modelSpecs";

const row = (over: Partial<ModelSpecs>): ModelSpecs => ({
  id: "x", make: "KTM", model: "250 SX-F", stock_sag_mm: 105, sag_min: 102, sag_max: 112, stock_fork_spring_nmm: null, stock_shock_spring_nmm: 45,
  rider_weight_min_lbs: 165, rider_weight_max_lbs: 187, fork_type: "WP AER 48 air (EU) or WP 4CS coil (US, Australia)", shock_type: "WP linkage", has_air_fork: null, spec_verified: true, fork_type_ambiguous: true, ...over,
} as ModelSpecs);

test("shows only for an ambiguous row with a null override", () => {
  expect(shouldShowAirForkBanner(row({}), null)).toBe(true);
  expect(shouldShowAirForkBanner(row({}), undefined)).toBe(true);
  expect(shouldShowAirForkBanner(row({}), true)).toBe(false);
  expect(shouldShowAirForkBanner(row({}), false)).toBe(false);
  expect(shouldShowAirForkBanner(row({ fork_type_ambiguous: false, has_air_fork: true }), null)).toBe(false);
  expect(shouldShowAirForkBanner(null, null)).toBe(false);
});

test("the banner renders the line and two choices; save hides it and the answer reaches effectiveAirFork", () => {
  // A tiny harness standing in for the bike page: the banner is visible until
  // the override is stored, then the fork type resolves from it.
  const specs = row({});
  let override: boolean | null = null;
  const chosen: boolean[] = [];
  function Harness() {
    const [o, setO] = React.useState<boolean | null>(override);
    const visible = shouldShowAirForkBanner(specs, o);
    return visible ? (
      <AirForkBanner
        onChoose={(air) => {
          chosen.push(air);
          override = air;
          setO(air);
        }}
        onDismiss={() => undefined}
      />
    ) : null;
  }
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<Harness />);
  });
  const texts = tree.root.findAllByType("Text" as any).map((t) => String(t.props.children));
  expect(texts.some((t) => t === AIR_FORK_BANNER_LINE)).toBe(true);
  expect(AIR_FORK_BANNER_LINE).not.toMatch(/—/);
  const coil = tree.root.find((n) => n.props.testID === "air-fork-banner-coil");
  act(() => {
    coil.props.onPress();
  });
  expect(chosen).toEqual([false]);
  expect(tree.root.findAll((n) => n.props.testID === "air-fork-banner-coil")).toHaveLength(0); // gone after the save
  expect(effectiveAirFork(specs, override)).toBe(false);
  expect(effectiveAirFork(specs, true)).toBe(true);
});

test("dismiss keeps the override null, so the banner is due again next visit", () => {
  const specs = row({});
  let dismissed = false;
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<AirForkBanner onChoose={() => undefined} onDismiss={() => (dismissed = true)} />);
  });
  act(() => {
    tree.root.find((n) => n.props.testID === "air-fork-banner-dismiss").props.onPress();
  });
  expect(dismissed).toBe(true);
  expect(shouldShowAirForkBanner(specs, null)).toBe(true);
});
