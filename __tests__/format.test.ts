// CLAUDE.md rule b: one display formatter, saved value shown exactly.
import { formatSetting, formatValue, roundToStep } from "../lib/format";

test("integers untouched (the Adjust 10 → \"1\" bug), decimals trimmed, null is the placeholder", () => {
  expect(formatValue(10, 0)).toBe("10");
  expect(formatValue(20, 2)).toBe("20");
  expect(formatValue(0, 2)).toBe("0");
  expect(formatValue(1.25, 2)).toBe("1.25");
  expect(formatValue(1.5, 2)).toBe("1.5");
  expect(formatValue(10.35, 2)).toBe("10.35");
  expect(formatValue(10.2, 2)).toBe("10.2");
  expect(formatValue(null, 2)).toBe("—");
});

test("settings: air and HSC keep two decimals, clicks and sag are whole", () => {
  expect(formatSetting(10.35, "fork_air")).toBe("10.35");
  expect(formatSetting(1.25, "shock_hsc")).toBe("1.25");
  expect(formatSetting(2, "shock_hsc")).toBe("2");
  expect(formatSetting(12, "fork_comp")).toBe("12");
  expect(formatSetting(105, "shock_sag")).toBe("105");
  expect(formatSetting(4.4, "fork_spring")).toBe("4.4");
});

test("stored deltas round to the step precision", () => {
  expect(roundToStep(10.6 - 0.2 - 10.6, "fork_air")).toBe(-0.2);
  expect(roundToStep(0.1 + 0.2, "fork_air")).toBe(0.3);
  expect(roundToStep(1.25, "shock_hsc")).toBe(1.25);
  expect(roundToStep(-2.0000001, "fork_comp")).toBe(-2);
});
