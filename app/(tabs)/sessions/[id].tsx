// app/sessions/[id]/index.tsx
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../../../components/Toast";
import { supabase } from "../../../lib/supabase";
import { useTheme } from "../../../lib/theme";

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

/* --------------------------------- Types ---------------------------------- */
type Detail = {
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

export default function SessionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C), [C]);

  const [row, setRow] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("sessions")
          .select(
            `
          id, rode_on, surface, track, temp_f, elev_ft,
          fork_comp, fork_reb, shock_comp, shock_reb, sag_mm, notes,
          bikes:bike_id ( id, make, model, year, nickname )
        `
          )
          .eq("id", id)
          .maybeSingle<Detail>();
        if (error) throw error;
        setRow(data);
      } catch (e: any) {
        toast.show(e?.message ?? "Failed to load session", { kind: "error" });
      } finally {
        setLoading(false);
      }
    })();
  }, [id, toast]);

  const onDelete = async () => {
    if (!row) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("sessions").delete().eq("id", row.id);
      if (error) throw error;
      toast.show("Session deleted", { kind: "success" });
      router.replace("/(tabs)/sessions");
    } catch (e: any) {
      toast.show(e?.message ?? "Delete failed", { kind: "error" });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <View style={[S.center, { paddingTop: insets.top + 6 }]}>
        <ActivityIndicator color={C.ACCENT} />
        <Text style={[S.muted, { marginTop: 8 }]}>Loading…</Text>
      </View>
    );
  }

  if (!row) {
    return (
      <View style={[S.center, { paddingTop: insets.top + 6 }]}>
        <Text style={S.title}>Session not found</Text>
        <View style={{ height: 12 }} />
        <Pressable
          onPress={() => router.replace("/(tabs)/sessions")}
          style={S.btnGhost}
        >
          <Text style={S.btnGhostText}>Back to Sessions</Text>
        </Pressable>
      </View>
    );
  }

  const date = row.rode_on ? new Date(row.rode_on).toLocaleDateString() : "—";
  const accent = BRAND_ACCENTS[row.bikes?.make ?? ""] ?? "#3A3F4C";

  const bikeTitle = (() => {
    const b = row.bikes;
    if (!b) return "Bike";
    const name = [b.year, b.make, b.model].filter(Boolean).join(" ");
    return b.nickname ? `${b.nickname} · ${name}` : name || "Bike";
  })();

  // Inline helpers so they can share styles
  const Chip = ({ label }: { label: string }) => (
    <View style={S.chip}>
      <Text style={S.chipText}>{label}</Text>
    </View>
  );

  const Metric = ({
    label,
    value,
    max,
  }: {
    label: string;
    value: number | null;
    max: number;
  }) => {
    const v = typeof value === "number" ? value : 0;
    const pct = Math.max(0, Math.min(1, v / max));
    return (
      <View style={{ marginBottom: 10 }}>
        <Text style={S.metricLabel}>{label}</Text>
        <View style={S.barOuter}>
          <View style={[S.barFill, { width: `${pct * 100}%` }]} />
        </View>
        <Text style={S.metricValue}>
          {typeof value === "number" ? `${value}` : "—"}
        </Text>
      </View>
    );
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.BG,
        paddingTop: insets.top + 6,
      }}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <View style={[S.card, S.lift]}>
          {/* Brand accent stripe */}
          <View style={[S.stripe, { backgroundColor: accent }]} />

          {/* Title + date */}
          <View style={S.rowBetween}>
            <View style={S.titleWrap}>
              <Text
                style={S.title}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {bikeTitle}
              </Text>
            </View>
            <Text style={S.date}>{date}</Text>
          </View>

          <View style={S.chipsRow}>
            <View
              style={[
                S.brandChip,
                {
                  borderColor: accent,
                  backgroundColor: hexToRgba(accent, 0.14),
                },
              ]}
            >
              <Ionicons name="bicycle-outline" size={12} color={accent} />
            </View>
            {row.surface ? <Chip label={cap(row.surface)} /> : null}
            {typeof row.sag_mm === "number" ? (
              <Chip label={`Sag: ${row.sag_mm} mm`} />
            ) : null}
            {row.track ? <Chip label={row.track} /> : null}
          </View>

          {/* Slider-style metrics */}
          <View style={{ marginTop: 12 }}>
            <Metric label="F Comp" value={row.fork_comp} max={30} />
            <Metric label="F Reb" value={row.fork_reb} max={30} />
            <Metric label="S LSC" value={row.shock_comp} max={30} />
            <Metric label="S Reb" value={row.shock_reb} max={30} />
            <Metric label="Sag" value={row.sag_mm} max={120} />
          </View>

          {row.notes ? (
            <>
              <View style={{ height: 14 }} />
              <Text style={S.h2}>Notes</Text>
              <Text style={S.notes}>{row.notes}</Text>
            </>
          ) : null}
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable
              onPress={() => router.replace("/(tabs)/sessions")}
              style={[
                S.btnGhost,
                {
                  borderColor: accent,
                  backgroundColor: hexToRgba(accent, 0.14),
                  flex: 1,
                },
              ]}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Ionicons
                  name="arrow-back-outline"
                  size={14}
                  color={accent}
                />
                <Text style={[S.btnGhostText, { color: accent }]}>Back</Text>
              </View>
            </Pressable>

            <View style={{ width: 10 }} />

            <Pressable
              onPress={onDelete}
              style={S.btnDangerSmall}
              disabled={deleting}
              hitSlop={6}
            >
              {deleting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Ionicons name="trash-outline" size={14} color="#fff" />
                  <Text style={S.btnDangerText}>Delete</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function cap(s: string) {
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

const makeStyles = (C: {
  BG: string;
  CARD: string;
  TEXT: string;
  MUTED: string;
  BORDER: string;
  ACCENT: string;
  ERROR: string;
}) =>
  StyleSheet.create({
    center: {
      flex: 1,
      backgroundColor: C.BG,
      alignItems: "center",
      justifyContent: "center",
    },
    card: {
      backgroundColor: C.CARD,
      borderWidth: 1,
      borderColor: C.BORDER,
      borderRadius: 14,
      padding: 16,
      marginTop: 16,
      marginHorizontal: 16,
    },
    stripe: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: 5,
      borderTopLeftRadius: 14,
      borderBottomLeftRadius: 14,
    },
    lift: {
      shadowColor: C.ACCENT,
      shadowOpacity: 0.18,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 10 },
      elevation: 5,
    },
    rowBetween: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
    },

    titleWrap: {
      flex: 1,
      minWidth: 0,
      paddingRight: 8,
    },

    title: { color: C.TEXT, fontWeight: "900", fontSize: 18 },

    date: {
      color: C.MUTED,
      fontSize: 12,
      marginLeft: 4,
      flexShrink: 0,
    },

    h2: { color: C.TEXT, fontWeight: "900", marginTop: 8 },
    notes: { color: C.MUTED, marginTop: 4, lineHeight: 20 },
    muted: { color: C.MUTED },

    chipsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 8,
    },
    brandChip: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
    },
    chip: {
      backgroundColor:
        C.BG === "#FFFFFF"
          ? "rgba(0,0,0,0.04)"
          : "rgba(255,255,255,0.05)",
      borderColor:
        C.BG === "#FFFFFF"
          ? "rgba(0,0,0,0.06)"
          : "rgba(255,255,255,0.18)",
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    chipText: { color: C.TEXT, fontWeight: "800", fontSize: 12 },

    metricLabel: {
      color: C.MUTED,
      fontWeight: "800",
      marginBottom: 4,
      fontSize: 12,
    },
    metricValue: {
      color: C.TEXT,
      fontWeight: "900",
      marginTop: 3,
      fontSize: 12,
    },
    barOuter: {
      height: 6,
      backgroundColor:
        C.BG === "#FFFFFF"
          ? "rgba(0,0,0,0.06)"
          : "rgba(255,255,255,0.06)",
      borderRadius: 999,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: C.BORDER,
    },
    barFill: { height: "100%", backgroundColor: C.ACCENT },

    btnGhost: {
      borderColor: "rgba(255,255,255,0.25)",
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 11,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
    },
    btnGhostText: { color: C.TEXT, fontWeight: "800" },

    btnDangerSmall: {
      backgroundColor: C.ERROR,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    btnDangerText: { color: "#fff", fontWeight: "900" },
  });
