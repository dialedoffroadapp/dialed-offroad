// app/(tabs)/sessions.tsx
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../../components/Toast";
import type { ThemeTokens } from "../../constants/theme";
import { useOnboarding } from "../../lib/onboarding";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";

/* ---------------------------- Brand accent color --------------------------- */
const BRAND_ACCENTS: Record<string, string> = {
  KTM: "#FF7A1A",
  Kawasaki: "#46C25B",
  Yamaha: "#3F7FFF",
  Honda: "#FF4D4F",
  Husqvarna: "#294A9D",
  GasGas: "#E53131",
  Suzuki: "#F2D13D",
  Beta: "#E62B2B",
  Sherco: "#2B61FF",
  "TM Racing": "#2B9CFF",
};

const hexToRgba = (hex: string, a: number) => {
  const n = hex.replace("#", "");
  const bigint = parseInt(
    n.length === 3 ? n.split("").map((c) => c + c).join("") : n,
    16
  );
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

type SessionRow = {
  id: string;
  rode_on: string | null;
  surface: string | null;
  track: string | null;
  temp_f: number | null;
  elev_ft: number | null;
  fork_comp: number | null;
  fork_reb: number | null;
  shock_comp: number | null;
  shock_reb: number | null;
  sag_mm: number | null;
  notes: string | null;
  bikes: {
    id: string;
    make: string | null;
    model: string | null;
    year: number | null;
    nickname: string | null;
  } | null;
};

export default function SessionsScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { onboardingActive, state } = useOnboarding();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user?.id) {
        setRows([]);
        return;
      }

      const { data, error } = await supabase
        .from("sessions")
        .select(
          `
          id, rode_on, surface, track, temp_f, elev_ft,
          fork_comp, fork_reb, shock_comp, shock_reb, sag_mm, notes,
          bikes:bike_id ( id, make, model, year, nickname )
        `
        )
        .eq("user_id", user.id)
        .order("rode_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      setRows((data as any) ?? []);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load sessions", { kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const bikeTitle = (r: SessionRow) => {
    const b = r.bikes;
    if (!b) return "Bike";
    const name = [b.year, b.make, b.model].filter(Boolean).join(" ");
    return b.nickname ? `${b.nickname} · ${name}` : name || "Bike";
  };

  const confirmDelete = (id: string) => setDeletingId(id);

  const actuallyDelete = async () => {
    const id = deletingId;
    if (!id) return;
    try {
      const { error } = await supabase.from("sessions").delete().eq("id", id);
      if (error) throw error;
      setRows((x) => x.filter((r) => r.id !== id));
      toast.show("Session deleted", { kind: "success" });
    } catch (e: any) {
      toast.show(e?.message ?? "Delete failed", { kind: "error" });
    } finally {
      setDeletingId(null);
    }
  };

  const renderItem = ({ item }: { item: SessionRow }) => {
    const date = item.rode_on
      ? new Date(item.rode_on).toLocaleDateString()
      : "—";
    const accent = BRAND_ACCENTS[item.bikes?.make ?? ""] ?? "#3A3F4C";

    return (
      <Pressable
        onPress={() =>
          router.push({ pathname: "sessions/[id]", params: { id: item.id } })
        }
        style={({ pressed }) => [
          styles.card,
          styles.lift,
          pressed && { opacity: 0.94 },
        ]}
      >
        {/* Accent stripe */}
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            backgroundColor: accent,
            borderTopLeftRadius: 16,
            borderBottomLeftRadius: 16,
          }}
        />

        {/* Header row: title + date */}
        <View style={styles.rowBetween}>
          <View style={styles.titleWrap}>
            <Text
              style={styles.h1}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {bikeTitle(item)}
            </Text>
          </View>
          <Text style={styles.date}>{date}</Text>
        </View>

        <View style={styles.chipsRow}>
          <View
            style={[
              styles.brandChip,
              {
                borderColor: accent,
                backgroundColor: hexToRgba(accent, 0.14),
              },
            ]}
          >
            <Ionicons name="bicycle-outline" size={12} color={accent} />
          </View>
          {item.surface ? (
            <Chip label={cap(item.surface)} styles={styles} colors={colors} />
          ) : null}
          {typeof item.sag_mm === "number" ? (
            <Chip
              label={`Sag: ${item.sag_mm} mm`}
              styles={styles}
              colors={colors}
            />
          ) : null}
          {item.track ? (
            <Chip label={item.track} styles={styles} colors={colors} />
          ) : null}
        </View>

        {/* Metrics (sliders) */}
        <View style={styles.metricsRow}>
          <Metric
            label="F Comp"
            value={item.fork_comp}
            max={30}
            styles={styles}
            colors={colors}
          />
          <Metric
            label="F Reb"
            value={item.fork_reb}
            max={30}
            styles={styles}
            colors={colors}
          />
          <Metric
            label="S LSC"
            value={item.shock_comp}
            max={30}
            styles={styles}
            colors={colors}
          />
          <Metric
            label="S Reb"
            value={item.shock_reb}
            max={30}
            styles={styles}
            colors={colors}
          />
        </View>

        <View style={styles.footerRow}>
          <Pressable
            onPress={() =>
              router.push({ pathname: "sessions/[id]", params: { id: item.id } })
            }
            style={[
              styles.btnView,
              {
                borderColor: accent,
                backgroundColor: hexToRgba(accent, 0.1),
              },
            ]}
          >
            <Ionicons name="eye-outline" size={14} color={accent} />
            <Text style={[styles.btnViewText, { color: accent }]}>View</Text>
          </Pressable>

          {/* Stop propagation so the card onPress doesn't fire */}
          <Pressable
            onPress={(e: any) => {
              e?.stopPropagation?.();
              confirmDelete(item.id);
            }}
            style={styles.iconDanger}
            hitSlop={12}
          >
            <Ionicons name="trash-outline" size={18} color={colors.ERROR} />
          </Pressable>
        </View>
      </Pressable>
    );
  };

  // Trial step — sessions are locked until the user subscribes.
  if (onboardingActive && state.onboardingStep === "trial") {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <Text style={styles.headerTitle}>My Sessions</Text>
        <View style={styles.emptyWrap}>
          <Ionicons name="time-outline" size={40} color={colors.MUTED} style={{ marginBottom: 14 }} />
          <Text style={styles.emptyTitle}>Your sessions are waiting</Text>
          <Text style={styles.emptySub}>
            Start your free trial to save and revisit every tune.
          </Text>
          <View style={{ height: 20 }} />
          <Pressable
            onPress={() => router.push("/premium")}
            style={styles.btnPrimary}
          >
            <Text style={styles.btnPrimaryText}>Start Free Trial</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <Text style={styles.headerTitle}>My Sessions</Text>

      {loading && rows.length === 0 ? (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={colors.TEXT} />
          <Text style={styles.emptyTitle}>Loading sessions…</Text>
          <Text style={styles.emptySub}>We’ll show your ride history here.</Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No Sessions Yet</Text>
          <Text style={styles.emptySub}>
            Generate a tune and save it as a session to start your history.
          </Text>
          <View style={{ height: 12 }} />
          <Pressable
            onPress={() => router.push("/(tabs)/tune")}
            style={styles.btnPrimary}
          >
            <Text style={styles.btnPrimaryText}>Generate a Tune</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              tintColor={colors.TEXT}
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
          }
        />
      )}

      {/* Delete confirm */}
      {deletingId && (
        <View style={styles.modalWrap} pointerEvents="box-none">
          <Pressable
            style={styles.backdrop}
            onPress={() => setDeletingId(null)}
          />
          <View style={styles.modalCard}>
            <Text style={styles.h1}>Delete session?</Text>
            <Text style={styles.modalSub}>This can’t be undone.</Text>
            <View style={{ height: 12 }} />
            <View style={styles.footerRow}>
              <Pressable
                onPress={() => setDeletingId(null)}
                style={styles.btnGhost}
              >
                <Text style={styles.btnGhostText}>Cancel</Text>
              </Pressable>
              <View style={{ width: 10 }} />
              <Pressable onPress={actuallyDelete} style={styles.btnDangerWide}>
                <Text style={styles.btnDangerText}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function Chip({
  label,
  styles,
  colors,
}: {
  label: string;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeTokens;
}) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

function Metric({
  label,
  value,
  max,
  styles,
  colors,
}: {
  label: string;
  value: number | null;
  max: number;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeTokens;
}) {
  const v = typeof value === "number" ? value : 0;
  const pct = Math.max(0, Math.min(1, v / max));
  return (
    <View style={{ flex: 1, marginRight: 10 }}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.barOuter}>
        <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
      </View>
      <Text style={styles.metricValue}>
        {typeof value === "number" ? `${value}` : "—"}
      </Text>
    </View>
  );
}

function cap(s: string) {
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

/* ------------------------------- Styles ------------------------------- */

const makeStyles = (colors: ThemeTokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.BG,
    },

    headerTitle: {
      color: colors.TEXT,
      fontWeight: "900",
      fontSize: 22,
      marginLeft: 18,
      marginBottom: 4,
    },
    emptyWrap: {
      flex: 1,
      backgroundColor: colors.BG,
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
    },
    emptyTitle: {
      color: colors.TEXT,
      fontWeight: "900",
      fontSize: 18,
      marginTop: 12,
    },
    emptySub: {
      color: colors.MUTED,
      marginTop: 6,
      textAlign: "center",
    },

    card: {
      backgroundColor: colors.CARD,
      borderWidth: 1,
      borderColor: colors.BORDER,
      borderRadius: 16,
      padding: 14,
    },
    lift: {},

    h1: { color: colors.TEXT, fontWeight: "900", fontSize: 16 },

    titleWrap: {
      flex: 1,
      minWidth: 0,
      paddingRight: 8,
    },

    date: {
      color: colors.MUTED,
      fontSize: 12,
      marginLeft: 4,
      flexShrink: 0,
    },

    chipsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 6,
    },
    brandChip: {
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 999,
      borderWidth: 1,
    },
    chip: {
      backgroundColor: "rgba(255,255,255,0.05)",
      borderColor: "rgba(255,255,255,0.08)",
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    chipText: {
      color: colors.TEXT,
      fontWeight: "700",
      fontSize: 12,
    },

    metricsRow: { flexDirection: "row", marginTop: 8, marginBottom: 4 },
    metricLabel: {
      color: "#4B5563",
      fontWeight: "800",
      marginBottom: 4,
      fontSize: 11,
    },
    metricValue: {
      color: colors.TEXT,
      fontWeight: "900",
      marginTop: 3,
      fontSize: 13,
    },

    barOuter: {
      height: 3,
      backgroundColor: "rgba(255,255,255,0.06)",
      borderRadius: 999,
      overflow: "hidden",
    },
    barFill: { height: "100%", backgroundColor: colors.ACCENT },

    notes: { color: colors.MUTED, marginTop: 6, lineHeight: 17, fontSize: 13 },

    footerRow: {
      flexDirection: "row",
      marginTop: 10,
      alignItems: "center",
    },

    btnPrimary: {
      backgroundColor: colors.ACCENT,
      borderRadius: 12,
      paddingVertical: 13,
      paddingHorizontal: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    btnPrimaryText: { color: "#fff", fontWeight: "900" },

    btnView: {
      flex: 1,
      borderRadius: 10,
      borderWidth: 1,
      paddingVertical: 9,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 6,
    },
    btnViewText: { fontWeight: "800", fontSize: 13 },

    iconDanger: {
      marginLeft: 10,
      width: 38,
      height: 38,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.07)",
      backgroundColor: "rgba(240,82,82,0.05)",
      alignItems: "center",
      justifyContent: "center",
    },

    btnGhost: {
      borderColor: colors.BORDER,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 11,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
      flex: 1,
    },
    btnGhostText: { color: colors.TEXT, fontWeight: "800" },

    btnDangerWide: {
      backgroundColor: colors.ERROR,
      borderRadius: 12,
      paddingVertical: 11,
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    btnDangerText: { color: "#fff", fontWeight: "900" },

    rowBetween: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
    },

    modalWrap: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: "center",
      alignItems: "center",
      zIndex: 1000,
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    modalCard: {
      width: "86%",
      backgroundColor: colors.CARD,
      borderColor: colors.BORDER,
      borderWidth: 1,
      borderRadius: 14,
      padding: 16,
    },
    modalSub: { color: colors.MUTED, marginTop: 4 },
  });
