// Pure logic behind the v3 Home: meter, copy templates, story/recap
// derivation, and the one-rule suggestion table.
import { computeMeter, meterCaption, meterHeroLine } from "../lib/dialedMeter";
import {
  bikeShortName,
  daysBetween,
  goalProgressLine,
  homeEyebrow,
  homeHeadline,
  maintenanceLine,
  nextRideLine,
  setupEyebrow,
  valuesSummary,
} from "../lib/homeCopy";
import { RIDE_RULES, suggestionFor } from "../lib/rideRules";
import { biggestDelta, buildStory, lastRideRecap, primarySymptom } from "../lib/setupStory";
import type { RideFeedbackRow, VersionWithFeedback } from "../lib/setupVersions";

const NOW = new Date(2026, 8, 12); // Sat Sep 12 2026

function version(p: Partial<VersionWithFeedback> & { id: string; version_number: number }): VersionWithFeedback {
  return {
    user_id: "u",
    bike_id: "b",
    source: "baseline",
    parent_version_id: null,
    restored_from_version_id: null,
    fork_comp_clicks: 12,
    fork_reb_clicks: 12,
    fork_air_bar: null,
    shock_lsc_clicks: 11,
    shock_hsc_turns: 1,
    shock_reb_clicks: 14,
    sag_mm: 105,
    sag_measured: false,
    notes: [],
    terrain: null,
    context: null,
    recommended_settings: null,
    applied_settings: null,
    settings_delta: null,
    created_at: "2026-08-31T12:00:00Z",
    feedback: null,
    ...p,
  };
}
function feedback(p: Partial<RideFeedbackRow> & { id: string; setup_version_id: string }): RideFeedbackRow {
  return { user_id: "u", resulting_version_id: null, overall_rating: null, symptoms: [], free_text: null, outcome: null, created_at: "2026-09-03T12:00:00Z", ...p };
}

describe("dialed meter", () => {
  test("endowed 20% for a bare baseline, with the reason line", () => {
    const i = { hasBaseline: true, sagMeasured: false, ridesLogged: 0, refinements: 0, outcomesRecorded: 0 };
    const m = computeMeter(i);
    expect(m.pct).toBe(20);
    expect(meterHeroLine(i, m.pct)).toBe("Baseline's in. Every ride from here pushes this number.");
  });
  test("two refinements + sag + rides ≈ the mockup's 45%", () => {
    const i = { hasBaseline: true, sagMeasured: true, ridesLogged: 3, refinements: 2, outcomesRecorded: 2 };
    const m = computeMeter(i);
    expect(m.pct).toBeGreaterThanOrEqual(40);
    expect(m.pct).toBeLessThanOrEqual(75);
    expect(meterCaption(m.categories)).toBe("Baseline ✓ · Sag ✓ · First ride ✓");
    expect(meterHeroLine(i, m.pct)).toBe("Two rides of refinement in. Sag measured, not guessed.");
  });
  test("never a dead 100%", () => {
    expect(computeMeter({ hasBaseline: true, sagMeasured: true, ridesLogged: 9, refinements: 9, outcomesRecorded: 9 }).pct).toBeLessThan(100);
  });
});

describe("home copy", () => {
  test("eyebrows and headlines", () => {
    expect(homeEyebrow(NOW, { date: new Date(2026, 8, 3), place: "OMC" })).toBe("Saturday · Sep 12 · 9 days since OMC");
    expect(homeEyebrow(NOW, { date: new Date(2026, 8, 11), place: null })).toBe("Saturday · Sep 12 · 1 day since your last ride");
    expect(homeEyebrow(NOW)).toBe("Saturday · Sep 12");
    expect(homeHeadline("250 SX-F", false)).toBe("Your 250 is ready to ride");
    expect(homeHeadline("250 SX-F", true)).toBe("Let's get your 250 dialed");
    expect(bikeShortName("YZ450F")).toBe("YZ450F");
    expect(setupEyebrow("250 SX-F", "MX setup", 5)).toBe("250 SX-F · MX setup · v5");
    expect(setupEyebrow("250 SX-F", null, 1)).toBe("250 SX-F · Baseline · v1");
  });
  test("values summary matches the mockup format", () => {
    expect(valuesSummary({ fork_comp: 13, fork_reb: 12, shock_lsc: 11, shock_hsc: 1, shock_reb: 15, shock_sag: 105 })).toBe("Fork 13/12 · Shock 11/1/15 · Sag 105"); // shared formatter: whole turns show as integers (rule b)
    expect(valuesSummary({ fork_comp: null, shock_hsc: 1.5 })).toBe("Fork —/— · Shock —/1.5/— · Sag —");
  });
  test("goal, maintenance, next ride", () => {
    expect(goalProgressLine("ride_days", 14, 25, NOW)).toBe("14 down, 11 to go. Oct's yours.");
    expect(goalProgressLine("ride_days", 25, 25, NOW)).toBe("Done. Set the next one.");
    expect(goalProgressLine("race", 0, 1, NOW, new Date(2026, 9, 3))).toBe("21 days out. Every ride counts.");
    expect(maintenanceLine(14.2, 15)).toBe("15 hours is close. Fresh oil before the next ride day.");
    expect(maintenanceLine(16, 15)).toBe("Past 15 hours. Fresh oil before the next ride day.");
    expect(maintenanceLine(0, 15)).toBeNull();
    expect(maintenanceLine(20, 15, 15)).toBe("10.0 hours until oil at 30.");
    expect(nextRideLine(NOW, NOW)).toMatchObject({ big: "TODAY", state: "today" });
    expect(nextRideLine(NOW, new Date(2026, 8, 19))).toMatchObject({ big: "7d", state: "future" });
    expect(nextRideLine(NOW, null).state).toBe("empty");
    expect(daysBetween(new Date(2026, 8, 3), NOW)).toBe(9);
  });
});

describe("setup story + last ride", () => {
  const v1 = version({ id: "v1", version_number: 1, created_at: "2026-08-31T10:00:00Z" });
  const fb1 = feedback({ id: "f1", setup_version_id: "v1", resulting_version_id: "v3", symptoms: [{ id: "dead_feel", severity: 6 } as any], created_at: "2026-08-31T18:00:00Z", outcome: "same" });
  const v3 = version({ id: "v3", version_number: 3, source: "refinement", parent_version_id: "v1", settings_delta: { fork_reb: 3 }, feedback: fb1, fork_reb_clicks: 15, created_at: "2026-08-31T18:05:00Z" });
  const fb3 = feedback({ id: "f3", setup_version_id: "v3", resulting_version_id: "v4", symptoms: [{ id: "rear_kicks_accel", severity: 7, where: "corner exits" } as any], created_at: "2026-09-03T12:00:00Z", outcome: "improved" });
  const v4 = version({ id: "v4", version_number: 4, source: "refinement", parent_version_id: "v3", settings_delta: { shock_reb: 2 }, feedback: fb3, created_at: "2026-09-03T12:05:00Z" });
  const versions = [v4, v3, v1];
  const byRidden = new Map([["v1", fb1], ["v3", fb3]]);

  test("story lines: solved / quoted / baseline", () => {
    const story = buildStory(versions, byRidden);
    // v4 was built for rear kicks and hasn't been ridden → quoted symptom;
    // v3 was built for dead feel and its ride (fb3) came back improved → solved.
    expect(story.map((s) => s.text)).toEqual(['"the rear was kicking"', "Dead feel solved", "Baseline tune"]);
    const noOutcomes = buildStory(versions, new Map());
    expect(noOutcomes.map((s) => s.text)).toEqual(['"the rear was kicking"', '"it felt dead"', "Baseline tune"]);
    const ridden4 = buildStory(versions, new Map([["v3", fb3], ["v4", feedback({ id: "f4", setup_version_id: "v4", outcome: "improved" })]]));
    expect(ridden4[0].text).toBe("Rear kicks solved");
    expect(story[0].current).toBe(true);
    expect(story[2].date).toBe("Aug 31");
  });

  test("last ride recap: outcome transition + what did it", () => {
    const recap = lastRideRecap([fb3, fb1], new Map(versions.map((v) => [v.id, v])));
    expect(recap?.label).toBe("Last ride · Sep 3");
    expect(recap?.text).toBe("Same → Better");
    expect(recap?.sub).toBe("Rear kicks: gone. +2 shock rebound did it.");
    expect(recap?.unaddressedSymptom).toBeNull();
  });

  test("unaddressed symptom → one deterministic suggestion", () => {
    const open = feedback({ id: "f9", setup_version_id: "v4", symptoms: [{ id: "front_knifes", severity: 5, where: "flat corners" } as any], created_at: "2026-09-10T12:00:00Z" });
    const recap = lastRideRecap([open, fb3], new Map(versions.map((v) => [v.id, v])));
    expect(recap?.unaddressedSymptom).toBe("front_knifes");
    expect(recap?.sub).toBe("Front tuck logged. No change applied yet.");
    const s = suggestionFor("front_knifes", "flat corners");
    expect(s.text).toBe("The front tucked in the corners in flat corners and you rode it out.");
    expect(s.sub).toBe("Next time, don't. Start with −1 fork comp.");
    expect(Object.keys(RIDE_RULES)).toHaveLength(11);
    expect(primarySymptom(fb3)).toBe("rear_kicks_accel");
    expect(biggestDelta({ fork_comp: 1, shock_reb: -3 })?.text).toBe("−3 shock rebound");
  });
});
