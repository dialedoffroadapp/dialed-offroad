// The Pro gate store + copy: names the action, lists the four Pro gates,
// routes the alternative to a baseline regenerate.
import { paywallHref } from "../lib/paywall";
import { currentProGate, hideProGate, PRO_SET, paywallHrefFor, proActionFor, regenerateHref, showProGate, subscribeProGate } from "../lib/proGate";

test("four Pro gates in order, every one has copy", () => {
  expect(PRO_SET.map((p) => p.trigger)).toEqual(["refine", "setup_history", "second_setup", "second_bike"]);
  for (const p of PRO_SET) expect(proActionFor(p.trigger).title.length).toBeGreaterThan(3);
  expect(proActionFor("refine").title).toBe("Refine after ride");
  expect(proActionFor("winback_fallback").title).toBe("That one's Pro");
});

test("store: show → subscribers see it, hide clears, paywall keeps the trigger", () => {
  const seen: any[] = [];
  const off = subscribeProGate((r) => seen.push(r));
  expect(seen).toEqual([null]);
  showProGate({ trigger: "second_bike" });
  expect(currentProGate()?.trigger).toBe("second_bike");
  expect(seen[1]?.trigger).toBe("second_bike");
  expect(paywallHrefFor(seen[1])).toBe(paywallHref("second_bike", "back"));
  hideProGate();
  expect(currentProGate()).toBeNull();
  off();
  showProGate({ trigger: "refine" });
  expect(seen).toHaveLength(3);
  hideProGate();
});

test("regenerate alternative routes to the Tune tab for that bike", () => {
  expect(regenerateHref("abc")).toBe("/(tabs)/tune?bikeId=abc&regenerate=1");
});
