// Tire pressure as an engine output (2026-09-07): the table-driven rules the
// client runs offline, over the GENERATED copy of the server's table; the
// copy must equal the server file byte for byte.
import * as fs from "fs";
import * as path from "path";
import table from "../lib/generated/tireDefaults.json";
import { surfaceFromTerrain, tireCell, tirePlan, TIRE_REASON_MAX, type TireTable } from "../lib/tirePlanCore";

const T = table as TireTable;

test("the client's copy equals the server's table (run scripts/engine-tools/sync_tire_defaults.sh after editing the server file)", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "supabase", "functions", "ai-tune", "tire_defaults.json"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "..", "lib", "generated", "tireDefaults.json"), "utf8");
  expect(client).toBe(server);
  expect(T.source).toMatch(/^Dunlop/);
  // The Tubliss and mousse starting points are ours, tagged so nobody reads them as Dunlop numbers.
  expect(T.systems.tubliss.tag).toBe("tuner");
  expect(T.systems.tubliss.source).toMatch(/Dialed pick within the published range/);
});

const cases: { name: string; input: Parameters<typeof tirePlan>[1]; front: number | null; rear: number | null; source: string; reason?: RegExp }[] = [
  { name: "mx hardpack default", input: { discipline: "mx", surface: "hardpack" }, front: 12, rear: 12.5, source: "dunlop_default", reason: /^Dunlop starting point for hardpack/ },
  { name: "mx loam", input: { discipline: "mx", surface: "loam" }, front: 12, rear: 12, source: "dunlop_default" },
  { name: "mx sand", input: { discipline: "mx", surface: "sand" }, front: 12, rear: 11.5, source: "dunlop_default", reason: /sand range/ },
  { name: "mx mud", input: { discipline: "mx", surface: "mud" }, front: 12, rear: 10, source: "dunlop_default" },
  { name: "offroad hardpack", input: { discipline: "offroad", surface: "hardpack" }, front: 13, rear: 14, source: "dunlop_default" },
  { name: "offroad loam", input: { discipline: "offroad", surface: "loam" }, front: 13, rear: 14, source: "dunlop_default" },
  { name: "offroad sand", input: { discipline: "offroad", surface: "sand" }, front: 12, rear: 12, source: "dunlop_default" },
  { name: "offroad mud", input: { discipline: "offroad", surface: "mud" }, front: 12, rear: 10, source: "dunlop_default" },
  { name: "no surface: hardpack, and the reason says so", input: { discipline: "mx" }, front: 12, rear: 12.5, source: "dunlop_default", reason: /^No surface given/ },
  { name: "no discipline: mx", input: { surface: "sand" }, front: 12, rear: 11.5, source: "dunlop_default" },
  { name: "watered: half a psi out of the default", input: { discipline: "mx", surface: "hardpack", watered: true }, front: 11.5, rear: 12, source: "conditions_adjusted", reason: /Watered track: 0\.5 psi out/ },
  { name: "rider-saved wins over the default", input: { discipline: "mx", surface: "sand", savedFront: 14, savedRear: 13 }, front: 14, rear: 13, source: "rider_saved", reason: /^Your saved pressure/ },
  { name: "rider-saved, conditions still adjust", input: { discipline: "mx", surface: "sand", savedFront: 14, savedRear: 13, watered: true }, front: 13.5, rear: 12.5, source: "conditions_adjusted" },
  { name: "an explicit psi delta replaces the watered flag", input: { discipline: "mx", surface: "hardpack", watered: true, psiDelta: 0 }, front: 12, rear: 12.5, source: "dunlop_default" },
  { name: "mousse rear: null, the mousse note", input: { discipline: "mx", surface: "hardpack", systemRear: "mousse" }, front: 12, rear: null, source: "dunlop_default", reason: /Rear is a mousse: nothing to set there\./ },
  { name: "both mousse: nothing to set", input: { discipline: "offroad", surface: "loam", systemFront: "mousse", systemRear: "mousse", savedFront: 13 }, front: null, rear: null, source: "mousse_none", reason: /^No pressure to set on a mousse/ },
  { name: "tubliss rear: its own low range", input: { discipline: "offroad", surface: "hardpack", systemRear: "tubliss" }, front: 13, rear: 6, source: "dunlop_default", reason: /Tubliss: Low pressure grips at crawl speed and gets vague at high speed\./ },
  { name: "tubliss front", input: { discipline: "offroad", surface: "hardpack", systemFront: "tubliss" }, front: 8, rear: 14, source: "dunlop_default" },
  { name: "tubliss rear, watered: clamped inside 3 to 8", input: { discipline: "offroad", surface: "hardpack", systemRear: "tubliss", watered: true }, front: 12.5, rear: 5.5, source: "conditions_adjusted" },
  { name: "tubliss with a saved pressure keeps the saved value", input: { discipline: "offroad", surface: "hardpack", systemRear: "tubliss", savedRear: 4 }, front: 13, rear: 4, source: "rider_saved" },
  { name: "heavy tube is a tube", input: { discipline: "mx", surface: "mud", systemFront: "heavy_tube", systemRear: "heavy_tube" }, front: 12, rear: 10, source: "dunlop_default" },
  { name: "unknown system is a tube", input: { discipline: "mx", surface: "mud", systemFront: "unknown" }, front: 12, rear: 10, source: "dunlop_default" },
];

test.each(cases)("$name", ({ input, front, rear, source, reason }) => {
  const out = tirePlan(T, input);
  expect(out.front).toBe(front);
  expect(out.rear).toBe(rear);
  expect(out.source).toBe(source);
  expect(out.reason.length).toBeLessThanOrEqual(TIRE_REASON_MAX);
  expect(out.reason).not.toMatch(/—/);
  if (reason) expect(out.reason).toMatch(reason);
});

test("terrain words map onto a surface; unknown words do not", () => {
  expect(surfaceFromTerrain("Hardpack")).toBe("hardpack");
  expect(surfaceFromTerrain("sandy loam")).toBe("sand");
  expect(surfaceFromTerrain("deep loam")).toBe("loam");
  expect(surfaceFromTerrain("muddy ruts")).toBe("mud");
  expect(surfaceFromTerrain("mx")).toBeNull();
  expect(surfaceFromTerrain(null)).toBeNull();
});

test("display cell: mousse reads as mousse, numbers trim, missing is a dash", () => {
  expect(tireCell(12.5, "tube")).toBe("12.5");
  expect(tireCell(12, "unknown")).toBe("12");
  expect(tireCell(null, "mousse")).toBe("mousse");
  expect(tireCell(9, "mousse")).toBe("mousse");
  expect(tireCell(null, "tube")).toBe("—");
});
