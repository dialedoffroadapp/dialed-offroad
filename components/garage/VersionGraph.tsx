// components/garage/VersionGraph.tsx
// The setup story graph (design/mockups/04, 06, 07): one polyline per chosen
// circuit across versions, the running version's point lit blue. Pure SVG,
// no library. Y is normalized per circuit so two circuits with different
// scales can share the chart, exactly like the mockups' two lines.
import React from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { interFont, V3 } from "../v3/theme";
import type { SetupVersionRow } from "../../lib/setupVersions";

export type GraphCircuit = "fork_comp" | "fork_reb" | "fork_air" | "shock_lsc" | "shock_hsc" | "shock_reb" | "shock_sag";

export const GRAPH_LABELS: Record<GraphCircuit, string> = {
  fork_comp: "Fork comp",
  fork_reb: "Fork reb",
  fork_air: "Fork air",
  shock_lsc: "Shock LSC",
  shock_hsc: "HSC",
  shock_reb: "Shock reb",
  shock_sag: "Sag",
};

const FIELD: Record<GraphCircuit, keyof SetupVersionRow> = {
  fork_comp: "fork_comp_clicks",
  fork_reb: "fork_reb_clicks",
  fork_air: "fork_air_bar",
  shock_lsc: "shock_lsc_clicks",
  shock_hsc: "shock_hsc_turns",
  shock_reb: "shock_reb_clicks",
  shock_sag: "sag_mm",
};

export function circuitValue(v: SetupVersionRow, c: GraphCircuit): number | null {
  const x = v[FIELD[c]];
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/** The two circuits that moved most across the lineage (mockup default). */
export function mostChangedCircuits(versionsAsc: SetupVersionRow[], n = 2): GraphCircuit[] {
  const all = Object.keys(GRAPH_LABELS) as GraphCircuit[];
  const score = all.map((c) => {
    const vals = versionsAsc.map((v) => circuitValue(v, c)).filter((x): x is number => x !== null);
    if (vals.length < 2) return { c, s: 0 };
    let s = 0;
    for (let i = 1; i < vals.length; i++) s += Math.abs(vals[i] - vals[i - 1]);
    return { c, s };
  });
  score.sort((a, b) => b.s - a.s);
  const picked = score.filter((x) => x.s > 0).slice(0, n).map((x) => x.c);
  const fallback: GraphCircuit[] = ["shock_reb", "fork_comp"];
  for (const f of fallback) if (picked.length < n && !picked.includes(f)) picked.push(f);
  return picked;
}

export function VersionGraph({
  versionsAsc,
  circuits,
  height = 76,
  axes,
  runningId,
}: {
  versionsAsc: SetupVersionRow[];
  circuits: GraphCircuit[];
  height?: number;
  /** History view: y axis with three ticks (mockup 06). */
  axes?: boolean;
  runningId?: string | null;
}) {
  const W = 320;
  const padL = axes ? 46 : 26;
  const padR = 22;
  const top = axes ? 20 : 14;
  const bottom = axes ? 26 : 22;
  const n = versionsAsc.length;
  const x = (i: number) => (n <= 1 ? W / 2 : padL + (i * (W - padL - padR)) / (n - 1));
  const chartH = height - top - bottom;
  const colors = [V3.blue, V3.steel, "#5BC0F8", "#B6BFCF"];

  return (
    <View>
      <Svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height}>
        {axes ? (
          <>
            <Line x1={30} y1={top} x2={30} y2={height - bottom + 4} stroke={V3.hair} />
            <Line x1={30} y1={height - bottom + 4} x2={W - 10} y2={height - bottom + 4} stroke={V3.hair} />
          </>
        ) : null}
        {circuits.map((c, ci) => {
          const vals = versionsAsc.map((v) => circuitValue(v, c));
          const nums = vals.filter((v): v is number => v !== null);
          if (nums.length === 0) return null;
          const min = Math.min(...nums);
          const max = Math.max(...nums);
          const span = max - min || 1;
          const y = (v: number) => top + chartH - ((v - min) / span) * chartH;
          const pts = vals.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ");
          const color = colors[ci % colors.length];
          const primary = ci === 0;
          return (
            <React.Fragment key={c}>
              {axes && primary ? (
                <>
                  <SvgText x={8} y={top + 4} fontSize={9} fill={V3.muted} {...(interFont(400) as any)}>{max}</SvgText>
                  <SvgText x={8} y={top + chartH / 2 + 3} fontSize={9} fill={V3.muted}>{Math.round((max + min) / 2)}</SvgText>
                  <SvgText x={8} y={height - bottom + 6} fontSize={9} fill={V3.muted}>{min}</SvgText>
                </>
              ) : null}
              <Polyline points={pts} fill="none" stroke={color} strokeWidth={primary ? 2.5 : 2} />
              {vals.map((v, i) =>
                v === null ? null : (
                  <Circle
                    key={i}
                    cx={x(i)}
                    cy={y(v)}
                    r={versionsAsc[i].id === runningId && primary ? 3.5 : 3}
                    fill={color}
                    opacity={i === 0 || i === n - 1 || (i > 0 && vals[i - 1] !== v) ? 1 : 0}
                  />
                )
              )}
            </React.Fragment>
          );
        })}
        {versionsAsc.map((v, i) => (
          <SvgText
            key={v.id}
            x={x(i)}
            y={height - 4}
            fontSize={10}
            fill={v.id === runningId ? V3.blue : V3.steel}
            textAnchor="middle"
          >
            {`v${v.version_number}`}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}
