// components/ActiveSetupCard.tsx
// Home tab active-setup card: the user's most recently updated bike with a
// current version. RUNNING vN · bike, values line, a mini fork-comp sparkline
// across versions, refine as the primary action, Bike Home as the quiet link.
// Renders nothing when no versions exist anywhere (home stays as today).

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { buildRefineParams, formatValuesLine } from "../lib/refineFlow";
import { SetupVersionRow } from "../lib/setupVersions";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";

const VERSION_COLUMNS =
  "id, user_id, bike_id, version_number, source, parent_version_id, " +
  "restored_from_version_id, fork_comp_clicks, fork_reb_clicks, fork_air_bar, " +
  "shock_lsc_clicks, shock_hsc_turns, shock_reb_clicks, sag_mm, notes, terrain, " +
  "context, created_at";

const SPARK_W = 72;
const SPARK_H = 22;

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const points = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (SPARK_W - pad * 2);
      const y =
        max === min
          ? SPARK_H / 2
          : pad + (SPARK_H - pad * 2) * (1 - (v - min) / span);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <Svg width={SPARK_W} height={SPARK_H}>
      <Polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function ActiveSetupCard({
  onBikeResolved,
}: {
  /** Reports which bike the card is showing (null = card hidden) so the host
   *  can drop redundant sections (e.g. Last Session for the same bike). */
  onBikeResolved?: (bikeId: string | null) => void;
}) {
  const { colors: C } = useTheme();
  const router = useRouter();

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

          // Most recently updated bike's current version.
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
          // Compact title: make/model first; year is the first thing to drop,
          // so it lives at the end where a clip costs the least.
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

  const onRefine = () => {
    router.push({
      pathname: "/tune-feedback",
      params: buildRefineParams(version, bikeTitle),
    } as any);
  };

  const onBikeHome = () => {
    router.push({
      pathname: "/bike-home",
      params: { bikeId: version.bike_id },
    } as any);
  };

  return (
    <View style={[styles.card, { backgroundColor: C.CARD }]}>
      <View style={styles.topRow}>
        <Text style={[styles.runningLabel, { color: C.MUTED }]}>RUNNING</Text>
        <Sparkline values={sparkValues} color={C.ACCENT} />
      </View>

      <Text style={[styles.title, { color: C.TEXT }]} numberOfLines={1}>
        v{version.version_number} · {bikeTitle}
      </Text>
      <Text style={[styles.values, { color: C.TEXT }]}>
        {formatValuesLine(version)}
      </Text>

      <View style={styles.actionRow}>
        <Pressable
          onPress={onRefine}
          style={[styles.refineBtn, { backgroundColor: C.ACCENT }]}
        >
          <Ionicons name="swap-horizontal-outline" size={16} color="#fff" />
          <Text style={styles.refineBtnText}>Refine after ride</Text>
        </Pressable>
        <Pressable onPress={onBikeHome} hitSlop={8} style={styles.homeLink}>
          <Text style={[styles.homeLinkText, { color: C.ACCENT }]}>
            Bike Home →
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  runningLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  title: {
    fontSize: 17,
    fontWeight: "900",
    marginTop: 6,
  },
  values: {
    fontSize: 13,
    fontWeight: "600",
    opacity: 0.85,
    marginTop: 5,
    fontVariant: ["tabular-nums"],
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
  },
  refineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  refineBtnText: { color: "#fff", fontWeight: "900", fontSize: 13 },
  homeLink: { marginLeft: "auto" },
  homeLinkText: { fontSize: 12, fontWeight: "700" },
});
