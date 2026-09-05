// supabase/functions/ai-tune/tests/conditions_parity_test.ts
// Contract v3 (decision 6): the engine's conditions stage is a rule-for-rule
// port of the client's offline rule base (lib/conditionsRules.ts). This test
// runs both over the same grid and requires the same circuits, deltas,
// reasons, and tire psi. It imports the client's dependency-free core module
// (lib/conditionsRulesCore.ts) directly.
import { assertEquals } from "jsr:@std/assert@1";
import { conditionsRuleDeltas } from "../index.ts";
import { coreRetuneRules as retuneRules, coreTodaysSetupRules as todaysSetupRules } from "../../../../lib/conditionsRulesCore.ts";

const surfaces = [[], ["hardpack"], ["loam"], ["sand"], ["mud"], ["loam", "sand"]] as const;
const states = ["fresh", "choppy", "rutted", null] as const;
const temps = ["cold", "mild", "hot", null] as const;

Deno.test("conditions parity: morning rules match lib/conditionsRules.ts over the full grid", () => {
  let n = 0;
  for (const hasAir of [true, false]) {
    const snapshot: any = { fork_comp: 12, fork_reb: 10, fork_air: hasAir ? 10.6 : null, shock_lsc: 10, shock_hsc: 1.5, shock_reb: 12, shock_sag: 105 };
    const effective: any = { fork_comp: 12, fork_reb: 10, shock_lsc: 10, shock_reb: 12, shock_hsc: 1.5, fork_air: hasAir ? 10.6 : null };
    for (const s of surfaces) for (const st of states) for (const t of temps) for (const w of [true, false, null]) {
      const client = todaysSetupRules({ surfaces: [...s] as any, state: st as any, temp: t as any, watered: w }, snapshot, "MX", hasAir);
      const server = conditionsRuleDeltas({ surfaces: [...s], state: st as any, temp_band: t as any, watered: w }, effective, hasAir);
      assertEquals(
        server.deltas.map((d) => [d.circuit, d.delta, d.reason]),
        client.deltas.map((d) => [d.circuit, d.delta, d.reason]),
        `grid ${JSON.stringify([s, st, t, w, hasAir])}`
      );
      assertEquals(server.tirePsiDelta, client.tirePsiDelta);
      n++;
    }
  }
  console.log(`  parity cases: ${n}`);
});

Deno.test("conditions parity: retune tiles match retuneRules, prior tweaks included", () => {
  for (const hasAir of [true, false]) {
    const snapshot: any = { fork_comp: 13, fork_reb: 10, fork_air: hasAir ? 10.4 : null, shock_lsc: 10, shock_hsc: 1.5, shock_reb: 12, shock_sag: 105 };
    const effective: any = { fork_comp: 13, fork_reb: 10, shock_lsc: 10, shock_reb: 12, shock_hsc: 1.5, fork_air: hasAir ? 10.4 : null };
    for (const tile of ["watered", "roughed", "heating"] as const) {
      for (const prior of [[], [{ circuit: "fork_comp" as const, delta: 1 }], [{ circuit: "fork_reb" as const, delta: 1 }]]) {
        const client = retuneRules(tile, snapshot, hasAir, prior);
        const server = conditionsRuleDeltas({ retune: { tile, prior_tweaks: prior } }, effective, hasAir);
        assertEquals(server.deltas.map((d) => [d.circuit, d.delta, d.reason]), client.deltas.map((d) => [d.circuit, d.delta, d.reason]), `${tile} ${JSON.stringify(prior)} air=${hasAir}`);
        assertEquals(server.tirePsiDelta, client.tirePsiDelta);
      }
    }
  }
});
