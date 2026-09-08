// The tire system picker (2026-09-07): two rows of the five systems, taps
// report the pair, and a mousse end reads "mousse" on every display cell.
import React from "react";
import renderer, { act } from "react-test-renderer";
import { TireSystemPicker } from "../components/garage/TireSystemPicker";
import { tireCell } from "../lib/tirePlanCore";

test("renders five chips per end, marks the current pick, and reports a change for the tapped end only", () => {
  const onChange = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<TireSystemPicker front="tube" rear="unknown" onChange={onChange} />);
  });
  const chips = tree.root.findAll((n) => typeof n.props.testID === "string" && n.props.testID.startsWith("tire-"));
  expect(chips).toHaveLength(10);
  const selected = chips.filter((c) => c.props.accessibilityState?.selected);
  expect(selected.map((c) => c.props.testID)).toEqual(["tire-front-tube", "tire-rear-unknown"]);
  act(() => {
    chips.find((c) => c.props.testID === "tire-rear-mousse")!.props.onPress();
  });
  expect(onChange).toHaveBeenCalledWith({ front: "tube", rear: "mousse" });
  act(() => {
    chips.find((c) => c.props.testID === "tire-front-tubliss")!.props.onPress();
  });
  expect(onChange).toHaveBeenLastCalledWith({ front: "tubliss", rear: "unknown" });
});

test("a mousse end displays as mousse, never a number", () => {
  expect(tireCell(12, "mousse")).toBe("mousse");
  expect(tireCell(null, "mousse")).toBe("mousse");
  expect(tireCell(12.5, "tube")).toBe("12.5");
});
