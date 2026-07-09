// components/ActiveSetupCard.tsx
// Home tab merged garage/setup card (per mockup): when the most recently
// refined bike has a current version, this replaces the old "Your Garage"
// card. Header row (bike + refined date + vN pill) taps to Bike Home; the
// recessed values panel taps to copy; actions row = primary refine + a
// bordered chevron square into Bike Home. Renders nothing when no versions
// exist anywhere — the host shows the old garage layout instead.

import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
import { useToast } from "./Toast";
import { buildRefineParams, formatValuesLine } from "../lib/refineFlow";
import { SetupVersionRow } from "../lib/setupVersions";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { logEvent } from "../lib/usage";

const VERSION_COLUMNS =
  "id, user_id, bike_id, version_number, source, parent_version_id, " +
  "restored_from_version_id, fork_comp_clicks, fork_reb_clicks, fork_air_bar, " +
  "shock_lsc_clicks, shock_hsc_turns, shock_reb_clicks, sag_mm, notes, terrain, " +
  "context, created_at";

const SPARK_W = 64;
const SPARK_H = 30;

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => ({
    x: pad + (i / (values.length - 1)) * (SPARK_W - pad * 2),
    y:
      max === min
        ? SPARK_H / 2
        : pad + (SPARK_H - pad * 2) * (1 - (v - min) / span),
  }));
  const last = pts[pts.length - 1];
  return (
    <Svg width={SPARK_W} height={SPARK_H}>
      <Polyline
        points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle cx={last.x} cy={last.y} r={2.5} fill={color} />
    </Svg>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Values line without sag (sag gets its own subline in the panel). */
function valuesLineNoSag(v: SetupVersionRow): string {
  const part = (val: number | null, digits = 0): string =>
    typeof val === "number" && Number.isFinite(val) ? val.toFixed(digits) : "—";
  return [
    `Fork ${part(v.fork_comp_clicks)}/${part(v.fork_reb_clicks)}`,
    `Shock ${part(v.shock_lsc_clicks)}/${part(v.shock_hsc_turns, 1)}/${part(
      v.shock_reb_clicks
    )}`,
  ].join(" · ");
}

export function ActiveSetupCard({
  onBikeResolved,
}: {
  /** Reports which bike the card is showing (null = card hidden) so the host
   *  can swap the garage layout and drop redundant sections. */
  onBikeResolved?: (bikeId: string | null) => void;
}) {
  const { colors: C } = useTheme();
  const router = useRouter();
  const toast = useToast();

  const [version, setVersion] = useState<SetupVersionRow | null>(null);
  const [bikeTitle, setBikeTitle] = useState("");
  const [sparkValues, setSparkValues] = useState<number[]>([]);
  const onResolvedRef = useRef(onBikeResolved);
  onResolvedRef.current = onBikeResolved;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const { data: auth } = await supabase.auth.getUser();
          if (!auth?.user?.id) {
            if (!cancelled) {
              setVersion(null);
              onResolvedRef.current?.(null);
            }
            return;
          }

          // Most recently refined bike's current version.
          const { data: v } = await supabase
            .from("setup_versions")
            .select(VERSION_COLUMNS)
            .eq("user_id", auth.user.id)
            .not("bike_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const current = (v as unknown as SetupVersionRow) ?? null;
          if (cancelled) return;
          if (!current?.bike_id) {
            setVersion(null);
            onResolvedRef.current?.(null);
            return;
          }

          const [{ data: bike }, { data: series }] = await Promise.all([
            supabase
              .from("bikes")
              .select("make, model, year")
              .eq("id", current.bike_id)
              .maybeSingle(),
            supabase
              .from("setup_versions")
              .select("version_number, fork_comp_clicks")
              .eq("bike_id", current.bike_id)
              .order("version_number", { ascending: true }),
          ]);
          if (cancelled) return;

          setVersion(current);
          setBikeTitle(
            [bike?.make, bike?.model, bike?.year].filter(Boolean).join(" ") ||
              "your bike"
          );
          setSparkValues(
            ((series ?? []) as { fork_comp_clicks: number | null }[])
              .map((r) => r.fork_comp_clicks)
              .filter((n): n is number => typeof n === "number")
          );
          onResolvedRef.current?.(current.bike_id);
        } catch {
          if (!cancelled) {
            setVersion(null);
            onResolvedRef.current?.(null);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (!version) return null;

  const terrain =
    version.terrain ?? (version.context as any)?.terrain ?? null;
  const sublineParts = [`refined ${fmtDate(version.created_at)}`];
  if (terrain) sublineParts.push(String(terrain));

  const onBikeHome = () => {
    router.push({
      pathname: "/bike-home",
      params: { bikeId: version.bike_id },
    } as any);
  };

  const onRefine = () => {
    router.push({
      pathname: "/tune-feedback",
      params: buildRefineParams(version, bikeTitle),
    } as any);
  };

  const onCopy = async () => {
    try {
      await Clipboard.setStringAsync(
        `${bikeTitle} — v${version.version_number}: ${formatValuesLine(version)}`
      );
      toast.show("Setup copied", { kind: "success" });
      void logEvent("preride_copied", {
        bike_id: version.bike_id,
        source: "home_setup_card",
      });
    } catch {
      // non-critical
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: C.CARD }]}>
      {/* Header row → Bike Home */}
      <Pressable onPress={onBikeHome} style={styles.headerRow}>
        <View
          style={[styles.iconTile, { backgroundColor: "rgba(29,155,240,0.14)" }]}
        >
          <Ionicons name="bicycle" size={19} color={C.ACCENT} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.bikeName, { color: C.TEXT }]} numberOfLines={1}>
            {bikeTitle}
          </Text>
          <Text style={[styles.subline, { color: C.MUTED }]} numberOfLines={1}>
            {sublineParts.join(" · ")}
          </Text>
        </View>
        <View
          style={[styles.vPill, { backgroundColor: "rgba(29,155,240,0.16)" }]}
        >
          <Text style={[styles.vPillText, { color: C.ACCENT }]}>
            v{version.version_number}
          </Text>
        </View>
      </Pressable>

      {/* Recessed values panel → copy */}
      <Pressable onPress={onCopy} style={[styles.panel, { backgroundColor: C.BG }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.values, { color: C.TEXT }]} numberOfLines={1}>
            {valuesLineNoSag(version)}
          </Text>
          <Text style={[styles.panelSub, { color: C.MUTED }]}>
            {typeof version.sag_mm === "number" ? `Sag ${version.sag_mm}mm · ` : ""}
            tap to copy
          </Text>
        </View>
        <Sparkline values={sparkValues} color={C.ACCENT} />
      </Pressable>

      {/* Actions */}
      <View style={styles.actionRow}>
        <Pressable
          onPress={onRefine}
          style={[styles.refineBtn, { backgroundColor: C.ACCENT }]}
        >
          <Ionicons name="swap-horizontal-outline" size={16} color="#fff" />
          <Text style={styles.refineBtnText}>Refine after ride</Text>
        </Pressable>
        <Pressable
          onPress={onBikeHome}
          style={[styles.chevronSquare, { borderColor: C.BORDER }]}
        >
          <Ionicons name="chevron-forward" size={18} color={C.TEXT} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  bikeName: {
    fontSize: 15,
    fontWeight: "800",
  },
  subline: {
    fontSize: 12,
    marginTop: 2,
  },
  vPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  vPillText: {
    fontSize: 11,
    fontWeight: "900",
  },
  panel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
    marginTop: 12,
  },
  values: {
    fontSize: 13.5,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  panelSub: {
    fontSize: 11,
    marginTop: 3,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  refineBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 12,
    paddingVertical: 13,
  },
  refineBtnText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  chevronSquare: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
