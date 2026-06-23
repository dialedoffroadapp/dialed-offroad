// app/(tabs)/sessions/[id].tsx
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
import type { ThemeTokens } from "../../../constants/theme";
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  const actuallyDelete = async () => {
    if (!row) return;
    setConfirmingDelete(false);
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("sessions")
        .delete()
        .eq("id", row.id);
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
          style={S.backBtn}
        >
          <Ionicons name="chevron-back" size={18} color={C.ACCENT} />
          <Text style={S.backText}>Sessions</Text>
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

  const Chip = ({ label }: { label: string }) => (
    <View style={S.chip}>
      <Text style={S.chipText}>{label}</Text>
    </View>
  );

  const MeterRow = ({
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
      <View style={S.meterRow}>
        <View style={S.meterLabelRow}>
          <Text style={S.meterLabel}>{label}</Text>
          <Text style={S.meterValue}>
            {typeof value === "number" ? `${value}` : "—"}
          </Text>
        </View>
        <View style={S.meterTrack}>
          <View style={[S.meterFill, { width: `${pct * 100}%` }]} />
        </View>
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
      {/* Top back affordance */}
      <Pressable
        onPress={() => router.replace("/(tabs)/sessions")}
        style={S.backBtn}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={20} color={C.ACCENT} />
        <Text style={S.backText}>Sessions</Text>
      </Pressable>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <View style={S.card}>
          {/* Header: brand chip + title + date */}
          <View style={S.cardHeader}>
            <View
              style={[
                S.brandChip,
                { backgroundColor: hexToRgba(accent, 0.14) },
              ]}
            >
              <Ionicons name="bicycle" size={20} color={accent} />
            </View>
            <View style={S.cardTitleWrap}>
              <Text
                style={S.title}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {bikeTitle}
              </Text>
              <Text style={S.date}>{date}</Text>
            </View>
          </View>

          {/* Chips */}
          <View style={S.chipsRow}>
            {row.surface ? <Chip label={cap(row.surface)} /> : null}
            {typeof row.sag_mm === "number" ? (
              <Chip label={`Sag: ${row.sag_mm} mm`} />
            ) : null}
            {row.track ? <Chip label={row.track} /> : null}
          </View>

          {/* Readable meters */}
          <View style={{ marginTop: 16 }}>
            <MeterRow label="F Comp" value={row.fork_comp} max={30} />
            <MeterRow label="F Reb" value={row.fork_reb} max={30} />
            <MeterRow label="S LSC" value={row.shock_comp} max={30} />
            <MeterRow label="S Reb" value={row.shock_reb} max={30} />
            <MeterRow label="Sag" value={row.sag_mm} max={120} />
          </View>
        </View>

        {/* Notes card */}
        {row.notes ? (
          <View style={S.notesCard}>
            <Text style={S.notesTitle}>Notes</Text>
            <Text style={S.notesBody}>{row.notes}</Text>
          </View>
        ) : null}

        {/* Delete — recessed text button */}
        <Pressable
          onPress={() => setConfirmingDelete(true)}
          style={S.deleteBtn}
          disabled={deleting}
        >
          {deleting ? (
            <ActivityIndicator color={C.ERROR} size="small" />
          ) : (
            <>
              <Ionicons name="trash-outline" size={14} color={C.ERROR} />
              <Text style={S.deleteText}>Delete session</Text>
            </>
          )}
        </Pressable>
      </ScrollView>

      {/* Confirm delete dialog */}
      {confirmingDelete && (
        <View style={S.modalWrap} pointerEvents="box-none">
          <Pressable
            style={S.backdrop}
            onPress={() => setConfirmingDelete(false)}
          />
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>Delete session?</Text>
            <Text style={S.modalSub}>This can't be undone.</Text>
            <View style={{ height: 16 }} />
            <View style={S.modalFooter}>
              <Pressable
                onPress={() => setConfirmingDelete(false)}
                style={S.btnCancel}
              >
                <Text style={S.btnCancelText}>Cancel</Text>
              </Pressable>
              <View style={{ width: 10 }} />
              <Pressable onPress={actuallyDelete} style={S.btnDelete}>
                <Text style={S.btnDeleteText}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function cap(s: string) {
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

/* --------------------------------- Styles --------------------------------- */

const makeStyles = (C: ThemeTokens) =>
  StyleSheet.create({
    center: {
      flex: 1,
      backgroundColor: C.BG,
      alignItems: "center",
      justifyContent: "center",
    },

    /* Top back affordance */
    backBtn: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 8,
      gap: 2,
    },
    backText: {
      color: C.ACCENT,
      fontWeight: "700",
      fontSize: 15,
    },

    /* Main card */
    card: {
      backgroundColor: C.CARD,
      borderWidth: 1,
      borderColor: C.BORDER,
      borderRadius: 16,
      padding: 16,
      marginTop: 8,
      marginHorizontal: 16,
    },

    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
    },
    brandChip: {
      width: 42,
      height: 42,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
    },
    cardTitleWrap: {
      flex: 1,
      marginLeft: 12,
      minWidth: 0,
    },

    title: { color: C.TEXT, fontWeight: "900", fontSize: 17 },
    date: {
      color: C.MUTED,
      fontSize: 12,
      marginTop: 2,
    },
    muted: { color: C.MUTED },

    /* Chips */
    chipsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 10,
    },
    chip: {
      backgroundColor: C.CHIP_BG ?? "rgba(255,255,255,0.05)",
      borderColor: C.BORDER_SUBTLE ?? C.BORDER,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    chipText: { color: C.TEXT, fontWeight: "800", fontSize: 12 },

    /* Readable meters */
    meterRow: {
      marginBottom: 12,
    },
    meterLabelRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: 6,
    },
    meterLabel: {
      color: C.MUTED,
      fontWeight: "700",
      fontSize: 13,
    },
    meterValue: {
      color: C.TEXT,
      fontWeight: "900",
      fontSize: 15,
    },
    meterTrack: {
      height: 4,
      backgroundColor: C.TRACK ?? "rgba(255,255,255,0.06)",
      borderRadius: 999,
      overflow: "hidden",
    },
    meterFill: {
      height: "100%",
      backgroundColor: C.ACCENT,
      borderRadius: 999,
    },

    /* Notes card */
    notesCard: {
      backgroundColor: C.CARD,
      borderWidth: 1,
      borderColor: C.BORDER,
      borderRadius: 16,
      padding: 16,
      marginTop: 12,
      marginHorizontal: 16,
    },
    notesTitle: {
      color: C.TEXT,
      fontWeight: "900",
      fontSize: 14,
      marginBottom: 6,
    },
    notesBody: {
      color: C.MUTED,
      lineHeight: 20,
      fontSize: 14,
    },

    /* Delete text button (recessed) */
    deleteBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 14,
      marginTop: 8,
    },
    deleteText: {
      color: C.ERROR,
      fontWeight: "600",
      fontSize: 13,
    },

    /* Confirm modal */
    modalWrap: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: "center",
      alignItems: "center",
      zIndex: 1000,
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: C.OVERLAY,
    },
    modalCard: {
      width: "86%",
      backgroundColor: C.CARD,
      borderColor: C.BORDER,
      borderWidth: 1,
      borderRadius: 16,
      padding: 20,
    },
    modalTitle: {
      color: C.TEXT,
      fontWeight: "900",
      fontSize: 17,
    },
    modalSub: { color: C.MUTED, marginTop: 4, fontSize: 14 },
    modalFooter: {
      flexDirection: "row",
      alignItems: "center",
    },
    btnCancel: {
      borderColor: C.BORDER,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
      flex: 1,
    },
    btnCancelText: { color: C.TEXT, fontWeight: "800" },
    btnDelete: {
      backgroundColor: C.ERROR,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    btnDeleteText: { color: "#fff", fontWeight: "900" },
  });
