// Quiz onboarding pure logic: engine-input mappings, model classification and
// discipline ordering across the WHOLE catalog, search/filter, persistence.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BIKE_BRANDS, BIKE_CATALOG } from "../constants/bike-catalog";
import {
  bikeDisplayName,
  buildQuizTuneInput,
  clampWeightLbs,
  classifyModel,
  DRUMROLL_CIRCUITS,
  DRUMROLL_STAGE_MS,
  drumrollChecklist,
  formatTuneValue,
  kgToLbs,
  lbsToKg,
  METER_CATEGORIES,
  METER_REASON,
  meterPct,
  tuneRowsFor,
  tuneRowValue,
  WEIGHT_DEFAULT_LBS,
  WEIGHT_MAX_LBS,
  WEIGHT_MIN_LBS,
  weightTicks,
  disciplineEcho,
  emptyQuizAnswers,
  engineGoalsFor,
  engineSkillForQuizSkill,
  engineStyleForDiscipline,
  filterModels,
  crossBrandModelHits,
  groupModelsForDiscipline,
  orderModelsForDiscipline,
  parseQuizAnswers,
  QUIZ_ANSWERS_STORAGE_KEY,
  QUIZ_MORE_BRANDS,
  QUIZ_OLDER_YEARS,
  QUIZ_PRIMARY_BRANDS,
  QUIZ_TOTAL_STEPS,
  quizStepIndex,
  readQuizAnswers,
  searchBrands,
  searchCatalog,
  SKILL_OPTIONS,
  skillEcho,
  TERRAIN_OPTIONS,
  writeQuizAnswers,
  type QuizAnswers,
} from "../lib/quizOnboarding";

describe("engine mappings (existing inputs only)", () => {
  test("discipline → rider.style", () => {
    expect(engineStyleForDiscipline("mx")).toBe("short_motos");
    expect(engineStyleForDiscipline("offroad")).toBe("long_enduro");
  });

  test("four skill cards → three engine levels, Fast shares intermediate", () => {
    expect(engineSkillForQuizSkill("learning")).toBe("beginner");
    expect(engineSkillForQuizSkill("comfortable")).toBe("intermediate");
    expect(engineSkillForQuizSkill("fast")).toBe("intermediate");
    expect(engineSkillForQuizSkill("pro")).toBe("pro");
  });

  test("goals carry the fourth level: fast/pro swap comfort for support/grip", () => {
    expect(engineGoalsFor("mx", "learning")).toEqual(["stability", "comfort"]);
    expect(engineGoalsFor("offroad", "comfortable")).toEqual(["stability", "comfort"]);
    expect(engineGoalsFor("mx", "fast")).toEqual(["stability", "jump support"]);
    expect(engineGoalsFor("offroad", "fast")).toEqual(["stability", "grip"]);
    expect(engineGoalsFor("mx", "pro")).toEqual(["stability", "jump support"]);
  });

  test("never the word Beginner on a card", () => {
    for (const o of SKILL_OPTIONS) {
      expect(`${o.label} ${o.subtitle}`.toLowerCase()).not.toContain("beginner");
    }
  });

  test("buildQuizTuneInput is null until every required answer exists", () => {
    const base: QuizAnswers = {
      ...emptyQuizAnswers(),
      discipline: "mx",
      make: "KTM",
      model: "250 SX-F",
      year: 2025,
      skill: "fast",
    };
    expect(buildQuizTuneInput(base)).toBeNull();
    const full = { ...base, terrainMain: "hardpack", weightLbs: 175, freeText: "  " };
    expect(buildQuizTuneInput(full)).toEqual({
      make: "KTM",
      model: "250 SX-F",
      year: 2025,
      terrain: "Hardpack",
      rider: {
        weight_lbs: 175,
        skill: "intermediate",
        style: "short_motos",
        goals: ["stability", "jump support"],
        issues: undefined,
      },
      has_zeroed_clickers: true,
      wants_air_fork: false,
    });
    expect(
      buildQuizTuneInput({ ...full, freeText: " stock springs " })?.rider.issues
    ).toBe("stock springs");
    // Off-road ids resolve against the off-road set; unknown ids pass through.
    expect(
      buildQuizTuneInput({ ...full, discipline: "offroad", terrainMain: "rocks_roots" })?.terrain
    ).toBe("Rocks and roots");
    expect(buildQuizTuneInput({ ...full, terrainMain: "custom" })?.terrain).toBe("custom");
  });

  test("weight helpers: steps, clamps, unit ticks", () => {
    expect(lbsToKg(175)).toBe(79);
    expect(kgToLbs(80)).toBe(176);
    expect(clampWeightLbs(173)).toBe(175);
    expect(clampWeightLbs(20)).toBe(WEIGHT_MIN_LBS);
    expect(clampWeightLbs(900)).toBe(WEIGHT_MAX_LBS);
    const lbs = weightTicks("lbs");
    expect(lbs[0]).toBe(80);
    expect(lbs[lbs.length - 1]).toBe(350);
    expect(lbs).toContain(WEIGHT_DEFAULT_LBS);
    const kg = weightTicks("kg");
    expect(kg[0] % 2).toBe(0);
    expect(kg[0]).toBeGreaterThanOrEqual(36);
    expect(kg[kg.length - 1]).toBeLessThanOrEqual(159);
  });

  test("tune rows: air row only for air forks, values + formatting", () => {
    const coil = {
      fork: { comp_clicks: 12, reb_clicks: 14 },
      shock: { lsc_clicks: 13, hsc_turns: 1.5, reb_clicks: 12, sag_mm: 105 },
    };
    expect(tuneRowsFor(coil).map((r) => r.key)).toEqual([
      "fork_comp", "fork_reb", "shock_lsc", "shock_hsc", "shock_reb", "shock_sag",
    ]);
    const air = { ...coil, fork: { ...coil.fork, air_pressure_bar: 10.4 } };
    expect(tuneRowsFor(air).map((r) => r.key)[2]).toBe("fork_air");
    expect(tuneRowValue(air, "fork_air")).toBe(10.4);
    expect(tuneRowValue(coil, "fork_air")).toBeNull();
    expect(formatTuneValue(10.4, "bar")).toBe("10.4");
    expect(formatTuneValue(1.5, "turns")).toBe("1.5");
    expect(formatTuneValue(2, "turns")).toBe("2");
    expect(formatTuneValue(12.4, "clicks")).toBe("12");
    expect(formatTuneValue(null, "mm")).toBe("—");
    expect(formatTuneValue(10.45, "bar")).toBe("10.45");
    expect(formatTuneValue(1.25, "turns")).toBe("1.25");
  });

  test("drumroll checklist: real facts in, honest generic copy otherwise", () => {
    const full = drumrollChecklist({
      forkType: "WP XACT air",
      shockType: "WP linkage",
      weightLbs: 175,
      terrainLabel: "Hardpack",
      skill: "fast",
    });
    expect(full).toHaveLength(6);
    expect(full[0]).toBe("Read your WP XACT air fork and WP linkage shock specs");
    expect(full[1]).toBe("Set spring rates for 175 lbs geared up");
    expect(full[3]).toBe("Dialing clickers for hardpack...");
    expect(full[4]).toBe("Balancing for race pace");
    const generic = drumrollChecklist({});
    expect(generic[0]).toBe("Read your fork and shock baseline specs");
    expect(generic[1]).toBe("Set spring rates for your geared-up weight");
    expect(generic.join(" ")).not.toMatch(/undefined|null/);
    expect(DRUMROLL_CIRCUITS).toHaveLength(6);
    expect(DRUMROLL_CIRCUITS.length * DRUMROLL_STAGE_MS).toBe(3000);
  });

  test("meter: endowed 20% with a reason, Pro rows locked, sums to 100", () => {
    expect(meterPct()).toBe(20);
    expect(METER_REASON).toBe("Baseline's in. That's the first 20%. Measure your sag for 15 more; every ride pushes it from there.");
    expect(METER_CATEGORIES.reduce((n, c) => n + c.pct, 0)).toBe(100);
    expect(METER_CATEGORIES.filter((c) => c.state === "locked_pro").map((c) => c.key)).toEqual([
      "first_refinement",
      "setup_history",
    ]);
  });

  test("terrain labels double as engine terrain strings the edge keys on", () => {
    const labels = TERRAIN_OPTIONS.offroad.map((t) => t.label.toLowerCase());
    expect(labels).toContain("singletrack");
    expect(labels.some((l) => l.includes("rocks") && l.includes("roots"))).toBe(true);
    expect(labels.some((l) => l.includes("enduro"))).toBe(true);
    expect(TERRAIN_OPTIONS.mx.map((t) => t.label)).toContain("Supercross");
    expect(TERRAIN_OPTIONS.mx).toHaveLength(6);
    expect(TERRAIN_OPTIONS.offroad).toHaveLength(6);
  });
});

describe("model classification across the whole catalog", () => {
  test("every catalog model classifies; only Stark's supermoto is 'other'", () => {
    const others: string[] = [];
    for (const [make, models] of Object.entries(BIKE_CATALOG)) {
      for (const m of models) {
        const k = classifyModel(make, m);
        expect(["mx", "offroad", "other", "mini"]).toContain(k);
        if (k === "other") others.push(`${make} ${m}`);
      }
    }
    expect(others).toEqual(["Stark Varg SM"]);
  });

  test("spot checks per make", () => {
    expect(classifyModel("KTM", "250 SX-F")).toBe("mx");
    expect(classifyModel("KTM", "450 SX-F Factory")).toBe("mx");
    expect(classifyModel("KTM", "300 XC-W")).toBe("offroad");
    expect(classifyModel("KTM", "250 XC-F")).toBe("offroad");
    expect(classifyModel("KTM", "85 SX Big Wheel")).toBe("mini");
    expect(classifyModel("Husqvarna", "FC 450")).toBe("mx");
    expect(classifyModel("Husqvarna", "TE 300")).toBe("offroad");
    expect(classifyModel("Husqvarna", "TC 85")).toBe("mini");
    expect(classifyModel("GasGas", "MC 250F")).toBe("mx");
    expect(classifyModel("GasGas", "EC 300")).toBe("offroad");
    expect(classifyModel("Yamaha", "YZ450F")).toBe("mx");
    expect(classifyModel("Yamaha", "YZ250FX")).toBe("offroad");
    expect(classifyModel("Yamaha", "WR450F")).toBe("offroad");
    expect(classifyModel("Yamaha", "YZ85")).toBe("mini");
    expect(classifyModel("Honda", "CRF450R")).toBe("mx");
    expect(classifyModel("Honda", "CRF450RWE")).toBe("mx");
    expect(classifyModel("Honda", "CRF450RX")).toBe("offroad");
    expect(classifyModel("Honda", "CRF150R")).toBe("mini");
    expect(classifyModel("Kawasaki", "KX450")).toBe("mx");
    expect(classifyModel("Kawasaki", "KX450X")).toBe("offroad");
    expect(classifyModel("Kawasaki", "KX100")).toBe("mini");
    expect(classifyModel("Suzuki", "RM-Z450")).toBe("mx");
    expect(classifyModel("Suzuki", "RMX450Z")).toBe("offroad");
    expect(classifyModel("Beta", "RR 2T 300")).toBe("offroad");
    expect(classifyModel("TM Racing", "MX 250")).toBe("mx");
    expect(classifyModel("TM Racing", "EN 300")).toBe("offroad");
    expect(classifyModel("Stark", "Varg MX")).toBe("mx");
    expect(classifyModel("Stark", "Varg EX")).toBe("offroad");
  });

  test("MX discipline ORDERS track bikes first; every model stays listed", () => {
    const ordered = orderModelsForDiscipline("KTM", "mx");
    expect(ordered[0]).toBe("125 SX");
    expect(ordered).toHaveLength(BIKE_CATALOG.KTM.length);
    expect(new Set(ordered)).toEqual(new Set(BIKE_CATALOG.KTM));
    const groups = groupModelsForDiscipline("KTM", "mx");
    expect(groups.map((g) => g.key)).toEqual(["matched", "all"]);
    expect(groups[0].label).toBe("Track bikes first");
    expect(groups[0].models.every((m) => classifyModel("KTM", m) === "mx")).toBe(true);
    expect(groups[1].label).toBe("All KTM models");
    expect(groups[1].models).toEqual(BIKE_CATALOG.KTM.filter((m) => classifyModel("KTM", m) !== "mx"));
  });

  test("off-road discipline lists trail bikes first, then the rest", () => {
    const groups = groupModelsForDiscipline("Yamaha", "offroad");
    expect(groups.map((g) => g.key)).toEqual(["matched", "all"]);
    expect(groups[0].label).toBe("Trail bikes first");
    expect(groups[0].models[0]).toBe("YZ125X");
    expect(groups.flatMap((g) => g.models)).toHaveLength(BIKE_CATALOG.Yamaha.length);
    expect(orderModelsForDiscipline("Honda", "offroad")[0]).toBe("CRF250RX");
  });

  test("a brand with no match for the discipline is never hidden: one 'All' section", () => {
    const groups = groupModelsForDiscipline("Beta", "mx");
    expect(groups.map((g) => g.key)).toEqual(["all"]);
    expect(groups[0].label).toBe("All Beta models");
    expect(groups[0].models).toEqual([...BIKE_CATALOG.Beta]);
  });

  test("unknown make → empty list, null discipline defaults to MX ordering", () => {
    expect(orderModelsForDiscipline("Fantic", "mx")).toEqual([]);
    expect(orderModelsForDiscipline("KTM", null)[0]).toBe("125 SX");
  });

  test("model search covers the full catalog: other-brand hits, own brand excluded", () => {
    const hits = crossBrandModelHits("KTM", "yz250f");
    expect(hits[0]).toEqual({ make: "Yamaha", model: "YZ250F" });
    expect(hits.some((h) => h.make === "KTM")).toBe(false);
    expect(crossBrandModelHits("KTM", "   ")).toEqual([]);
    expect(crossBrandModelHits(null, "crf450r").some((h) => h.make === "Honda")).toBe(true);
  });
});

describe("brand grid + search", () => {
  test("seven primary tiles, the rest under More, nothing lost", () => {
    expect(QUIZ_PRIMARY_BRANDS).toHaveLength(7);
    expect([...QUIZ_PRIMARY_BRANDS, ...QUIZ_MORE_BRANDS].sort()).toEqual(
      [...BIKE_BRANDS].sort()
    );
  });

  test("searchCatalog is case/space/hyphen-insensitive and ranks exact first", () => {
    expect(searchCatalog("yz250f")[0]).toEqual({ make: "Yamaha", model: "YZ250F" });
    expect(searchCatalog("250 sxf")[0]).toEqual({ make: "KTM", model: "250 SX-F" });
    const xcw = searchCatalog("xcw");
    expect(xcw.length).toBeGreaterThan(0);
    expect(xcw.every((h) => /XC-W/.test(h.model))).toBe(true);
    expect(searchCatalog("")).toEqual([]);
    expect(searchCatalog("zzz")).toEqual([]);
  });

  test("searchCatalog matches brand names too", () => {
    const hits = searchCatalog("sherco");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.make === "Sherco")).toBe(true);
  });

  test("filterModels + searchBrands", () => {
    expect(filterModels(BIKE_CATALOG.KTM, "sx-f")).toEqual(
      BIKE_CATALOG.KTM.filter((m) => m.includes("SX-F"))
    );
    expect(filterModels(BIKE_CATALOG.KTM, "")).toEqual(BIKE_CATALOG.KTM);
    expect(searchBrands("gas")).toEqual(["GasGas"]);
    expect(searchBrands("tm")).toEqual(["KTM", "TM Racing"]);
  });

  test("older years run 2023 → 2000 inline", () => {
    expect(QUIZ_OLDER_YEARS[0]).toBe(2023);
    expect(QUIZ_OLDER_YEARS[QUIZ_OLDER_YEARS.length - 1]).toBe(2000);
  });
});

describe("copy + progress", () => {
  test("echoes and names", () => {
    expect(disciplineEcho("mx")).toBe("Track it is");
    expect(disciplineEcho("offroad")).toBe("Trail it is");
    expect(skillEcho("fast")).toBe("Fast. Noted.");
    expect(bikeDisplayName({ year: 2025, make: "KTM", model: "250 SX-F" })).toBe(
      "2025 KTM 250 SX-F"
    );
    expect(bikeDisplayName({ make: "KTM" })).toBe("KTM");
  });

  test("five honest segments", () => {
    expect(QUIZ_TOTAL_STEPS).toBe(5);
    expect(quizStepIndex("discipline")).toBe(1);
    expect(quizStepIndex("bike")).toBe(2);
    expect(quizStepIndex("weight")).toBe(5);
  });
});

describe("answers persistence", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test("round-trips through AsyncStorage", async () => {
    const a: QuizAnswers = {
      ...emptyQuizAnswers(),
      discipline: "offroad",
      make: "KTM",
      model: "300 XC-W",
      year: 2022,
      bikeLocalId: "1700000000000_abc",
      catalogMatch: true,
      skill: "comfortable",
      lastStep: "skill",
    };
    await writeQuizAnswers(a);
    expect(await readQuizAnswers()).toEqual(a);
  });

  test("tolerant parse drops invalid fields and never throws", async () => {
    expect(parseQuizAnswers(null).discipline).toBeUndefined();
    expect(parseQuizAnswers("{not json").version).toBe(1);
    const p = parseQuizAnswers(
      JSON.stringify({
        discipline: "both",
        skill: "beginner",
        year: "2024",
        make: "Honda",
        terrainSecondary: ["Sand", 4, null],
        lastStep: "gate",
      })
    );
    expect(p.discipline).toBeUndefined();
    expect(p.skill).toBeUndefined();
    expect(p.year).toBeUndefined();
    expect(p.make).toBe("Honda");
    expect(p.terrainSecondary).toEqual(["Sand"]);
    expect(p.lastStep).toBeUndefined();
    await AsyncStorage.setItem(QUIZ_ANSWERS_STORAGE_KEY, "[]");
    expect((await readQuizAnswers()).make).toBeUndefined();
  });
});
