// app/bike-home.tsx
// Bike Home: everything about one bike, one place. Answers "what am I running
// and what do I do next" — current setup, refine/new-tune actions, recent
// versions, and the entry to Setup History. Reached by tapping a bike in the
// Garage; the old per-bike overflow actions (delete) live in the header menu.

import { showProGate } from "../lib/proGate";
import { isEntitled, resolveEntitlement } from "../lib/entitlement";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../components/Toast";
import { SYMPTOM_PHRASES, Tune2SymptomId } from "../lib/ai";
import { deriveIsLapsed, deriveIsPro } from "../lib/proUtils";
import { hasPurchasedThisSession } from "../lib/purchases";
import { buildRefineParams, formatValuesLine } from "../lib/refineFlow";
import {
  getHistoryWithFeedback,
  VersionWithFeedback,
} from "../lib/setupVersions";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { logEvent } from "../lib/usage";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** One-line trigger from a version's linked feedback, if any. */
function triggerLine(fb: VersionWithFeedback["feedback"]): string | null {
  if (!fb) return null;
  const issues = (Array.isArray(fb.symptoms) ? fb.symptoms : []).filter(
    (s: any) => s && typeof s.id === "string" && !s.protect
  );
  if (issues.length) {
    const top = [...issues].sort(
      (a: any, b: any) => (Number(b.severity) || 0) - (Number(a.severity) || 0)
    )[0] as any;
    const phrase = SYMPTOM_PHRASES[top.id as Tune2SymptomId];
    if (phrase) {
      const where =
        typeof top.where === "string" && top.where.trim().length
          ? ` in ${top.where.trim().toLowerCase()}`
          : "";
      return `${phrase}${where}`;
    }
  }
  if (typeof fb.free_text === "string" && fb.free_text.trim().length) {
    return fb.free_text.trim();
  }
  return null;
}

type BikeRow = {
  make: string | null;
  model: string | null;
  year: number | null;
  nickname: string | null;
};

export default function BikeHomeScreen() {
  const { bikeId } = useLocalSearchParams<{ bikeId?: string }>();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C), [C]);

  const [loading, setLoading] = useState(true);
  const [bike, setBike] = useState<BikeRow | null>(null);
  const [history, setHistory] = useState<VersionWithFeedback[]>([]);
  const [isPro, setIsPro] = useState(false);
  const [isLapsed, setIsLapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (typeof bikeId !== "string" || !bikeId) {
      router.back();
      return;
    }
    try {
      const [{ data: bikeRow }, rows, { data: auth }] = await Promise.all([
        supabase
          .from("bikes")
          .select("make, model, year, nickname")
          .eq("id", bikeId)
          .maybeSingle(),
        getHistoryWithFeedback(bikeId),
        supabase.auth.getUser(),
      ]);
      setBike((bikeRow as BikeRow) ?? null);
      setHistory(rows);

      if (auth?.user?.id) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("pro_until, is_pro")
          .eq("user_id", auth.user.id)
          .maybeSingle();
        setIsPro(deriveIsPro(prof ?? null));
        setIsLapsed(deriveIsLapsed(prof ?? null));
      } else {
        setIsPro(false);
        setIsLapsed(false);
      }
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't load bike", { kind: "error" });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bikeId]);

  // Refresh on every focus — returning from a refinement must show the new
  // current version.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const bikeTitle =
    [bike?.year, bike?.make, bike?.model].filter(Boolean).join(" ") || "Bike";
  const current = history[0] ?? null;
  const recent = history.slice(0, 3);

  /* ------------------------------ actions ------------------------------ */

  const onRefine = () => {
    if (!current) return;
    router.push({
      pathname: "/tune-feedback",
      params: buildRefineParams(current, bikeTitle),
    } as any);
  };

  const onNewTune = () => {
    router.push({
      pathname: "/(tabs)/tune",
      params: { bikeId: String(bikeId) },
    } as any);
  };

  const onHistory = async () => {
    if (isPro || hasPurchasedThisSession() || isLapsed || isEntitled(await resolveEntitlement())) {
      // Lapsed subscribers see the list + stats strip (their own data IS the
      // winback hook); setup-history enforces the detail/restore gate with
      // winback CTAs.
      router.push({
        pathname: "/setup-history",
        params: { bikeId: String(bikeId) },
      } as any);
    } else {
      void logEvent("history_gate_hit", {
        bike_id: bikeId,
        version_count: history.length,
        source: "bike_home",
        paywall_trigger_action: "setup_history",
      });
      showProGate({ trigger: "setup_history", bikeId: String(bikeId), hasBaseline: history.length > 0 });
    }
  };

  const onCopyValues = async () => {
    if (!current) return;
    try {
      await Clipboard.setStringAsync(
        `${bikeTitle} · v${current.version_number}: ${formatValuesLine(current)}`
      );
      toast.show("Setup copied", { kind: "success" });
      void logEvent("preride_copied", { bike_id: bikeId, source: "bike_home" });
    } catch {
      // non-critical
    }
  };

  const onDeleteConfirmed = async () => {
    if (deleting) return;
    try {
      setDeleting(true);
      const { error } = await supabase
        .from("bikes")
        .delete()
        .eq("id", String(bikeId));
      if (error) throw error;
      toast.show("Bike deleted", { kind: "success" });
      setConfirmDelete(false);
      router.back();
    } catch (e: any) {
      toast.show(e?.message ?? "Delete failed", { kind: "error" });
    } finally {
      setDeleting(false);
    }
  };

  /* ------------------------------- render ------------------------------- */

  return (
    <View style={{ flex: 1, backgroundColor: C.BG }}>
      <View style={{ height: insets.top, backgroundColor: C.BG }} />

      {/* Header */}
      <View style={S.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={S.headerBtn}>
          <Ionicons name="chevron-back-outline" size={24} color={C.TEXT} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={S.headerTitle} numberOfLines={1}>
            {bike ? `${bike.make ?? ""} ${bike.model ?? ""}`.trim() : "Bike"}
          </Text>
          <Text style={S.headerSub} numberOfLines={1}>
            {[bike?.year, bike?.nickname].filter(Boolean).join(" · ") || " "}
          </Text>
        </View>
        <Pressable
          onPress={() => setMenuOpen(true)}
          hitSlop={8}
          style={S.headerBtn}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={C.TEXT} />
        </Pressable>
      </View>

      {loading ? (
        <View style={S.centerFill}>
          <ActivityIndicator color={C.ACCENT} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
        >
          {current ? (
            <>
              {/* Current setup */}
              <View style={S.currentCard}>
                <View style={S.currentTopRow}>
                  <Text style={S.runningLabel}>RUNNING</Text>
                  <Text style={S.currentDate}>
                    refined {fmtDate(current.created_at)}
                  </Text>
                </View>
                <Text style={S.runningVersion}>v{current.version_number}</Text>
                <Pressable onPress={onCopyValues} hitSlop={4}>
                  <Text style={S.valuesLine}>{formatValuesLine(current)}</Text>
                  <Text style={S.copyHint}>tap to copy</Text>
                </Pressable>
              </View>

              {/* Actions */}
              <View style={S.actionsRow}>
                <Pressable onPress={onRefine} style={S.btnPrimary}>
                  <Ionicons name="swap-horizontal-outline" size={17} color="#fff" />
                  <Text style={S.btnPrimaryText}>Refine after ride</Text>
                </Pressable>
                <Pressable onPress={onNewTune} style={S.btnSecondary}>
                  <Text style={S.btnSecondaryText}>New tune</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/current-setup",
                    params: { bikeId: String(bikeId) },
                  } as any)
                }
                style={S.historyRow}
              >
                <Ionicons name="speedometer-outline" size={17} color={C.TEXT} />
                <Text style={S.historyRowText}>Current Setup</Text>
                <View style={{ flex: 1 }} />
                <Text style={S.historyRowCount}>offline ready</Text>
                <Ionicons
                  name="chevron-forward"
                  size={15}
                  color={C.MUTED}
                  style={{ marginLeft: 4 }}
                />
              </Pressable>

              <Pressable onPress={onHistory} style={S.historyRow}>
                <Ionicons name="time-outline" size={17} color={C.TEXT} />
                <Text style={S.historyRowText}>Setup history</Text>
                <View style={{ flex: 1 }} />
                <Text style={S.historyRowCount}>
                  {history.length} version{history.length === 1 ? "" : "s"}
                </Text>
                {!isPro && (
                  <Ionicons
                    name="lock-closed"
                    size={13}
                    color={C.MUTED}
                    style={{ marginLeft: 6 }}
                  />
                )}
                <Ionicons
                  name="chevron-forward"
                  size={15}
                  color={C.MUTED}
                  style={{ marginLeft: 4 }}
                />
              </Pressable>

              {/* Recent versions */}
              <Text style={S.sectionLabel}>RECENT</Text>
              {recent.map((v) => {
                const trigger = triggerLine(v.feedback);
                return (
                  <View key={v.id} style={S.recentRow}>
                    <Text style={S.recentVersion}>v{v.version_number}</Text>
                    <View style={{ flex: 1 }}>
                      {trigger ? (
                        <Text style={S.recentTrigger} numberOfLines={1}>
                          “{trigger}”
                        </Text>
                      ) : (
                        <Text style={S.recentTrigger} numberOfLines={1}>
                          {v.source === "baseline"
                            ? "Baseline tune"
                            : v.source === "restore"
                            ? "Restored setup"
                            : "Refinement"}
                        </Text>
                      )}
                    </View>
                    <Text style={S.recentDate}>{fmtDate(v.created_at)}</Text>
                  </View>
                );
              })}
              <Pressable onPress={onHistory} hitSlop={6} style={S.fullHistoryLink}>
                <Text style={S.fullHistoryText}>Full history →</Text>
              </Pressable>
            </>
          ) : (
            /* No versions yet */
            <View style={S.emptyWrap}>
              <Ionicons name="speedometer-outline" size={34} color={C.MUTED} />
              <Text style={S.emptyTitle}>No setup yet</Text>
              <Text style={S.emptyBody}>
                Generate a tune for this bike and it becomes your v1. Every
                refinement after that builds the history.
              </Text>
              <Pressable onPress={onNewTune} style={[S.btnPrimary, { marginTop: 18 }]}>
                <Text style={S.btnPrimaryText}>Generate first tune</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}

      {/* Header overflow menu */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <View style={S.sheetWrap}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setMenuOpen(false)}
          />
          <View style={[S.sheet, { paddingBottom: insets.bottom + 14 }]}>
            <Text style={S.sheetTitle}>{bikeTitle}</Text>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                setConfirmDelete(true);
              }}
              style={S.sheetRow}
            >
              <Ionicons name="trash-outline" size={18} color={C.ERROR ?? "#F05252"} />
              <Text style={[S.sheetRowText, { color: C.ERROR ?? "#F05252" }]}>
                Delete bike
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Delete confirm */}
      <Modal
        visible={confirmDelete}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmDelete(false)}
      >
        <View style={S.sheetWrap}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setConfirmDelete(false)}
          />
          <View style={[S.sheet, { paddingBottom: insets.bottom + 14 }]}>
            <Text style={S.sheetTitle}>Delete {bikeTitle}?</Text>
            <Text style={S.sheetBody}>
              Its saved sessions and setup history stay in your account but
              will no longer be linked to a garage bike.
            </Text>
            <View style={S.sheetBtnRow}>
              <Pressable
                onPress={() => setConfirmDelete(false)}
                style={S.sheetBtnGhost}
              >
                <Text style={S.sheetBtnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={onDeleteConfirmed}
                disabled={deleting}
                style={[S.sheetBtnDanger, deleting && { opacity: 0.6 }]}
              >
                {deleting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={S.sheetBtnDangerText}>Delete</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* -------------------------------- styles -------------------------------- */

const makeStyles = (C: any) =>
  StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 4,
      paddingVertical: 6,
    },
    headerBtn: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: { color: C.TEXT, fontSize: 16, fontWeight: "800" },
    headerSub: { color: C.MUTED, fontSize: 12, marginTop: 1 },

    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },

    currentCard: {
      backgroundColor: C.CARD,
      borderRadius: 16,
      padding: 18,
      marginHorizontal: 16,
      marginTop: 10,
    },
    currentTopRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    runningLabel: {
      color: C.MUTED,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1.6,
    },
    currentDate: { color: C.MUTED, fontSize: 12 },
    runningVersion: {
      color: C.TEXT,
      fontSize: 34,
      fontWeight: "900",
      marginTop: 4,
    },
    valuesLine: {
      color: C.TEXT,
      fontSize: 14,
      fontWeight: "600",
      opacity: 0.9,
      marginTop: 8,
      fontVariant: ["tabular-nums"],
    },
    copyHint: { color: C.MUTED, fontSize: 11, marginTop: 3 },

    actionsRow: {
      flexDirection: "row",
      gap: 10,
      marginHorizontal: 16,
      marginTop: 14,
    },
    btnPrimary: {
      flex: 1,
      flexDirection: "row",
      gap: 7,
      backgroundColor: C.ACCENT,
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: "center",
      justifyContent: "center",
    },
    btnPrimaryText: { color: "#fff", fontWeight: "900", fontSize: 14 },
    btnSecondary: {
      paddingHorizontal: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.BORDER,
      alignItems: "center",
      justifyContent: "center",
    },
    btnSecondaryText: { color: C.TEXT, fontWeight: "800", fontSize: 14 },

    historyRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      backgroundColor: C.CARD,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 13,
      marginHorizontal: 16,
      marginTop: 10,
    },
    historyRowText: { color: C.TEXT, fontWeight: "700", fontSize: 14 },
    historyRowCount: { color: C.MUTED, fontSize: 12, fontWeight: "700" },

    sectionLabel: {
      color: C.MUTED,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1.6,
      marginHorizontal: 16,
      marginTop: 22,
      marginBottom: 4,
    },
    recentRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    recentVersion: { color: C.TEXT, fontWeight: "900", fontSize: 14, width: 34 },
    recentTrigger: {
      color: C.MUTED,
      fontSize: 13,
      fontStyle: "italic",
    },
    recentDate: { color: C.MUTED, fontSize: 12 },
    fullHistoryLink: {
      marginHorizontal: 16,
      marginTop: 8,
      alignSelf: "flex-start",
    },
    fullHistoryText: { color: C.ACCENT, fontSize: 13, fontWeight: "700" },

    emptyWrap: {
      alignItems: "center",
      paddingHorizontal: 32,
      paddingTop: 60,
    },
    emptyTitle: {
      color: C.TEXT,
      fontSize: 17,
      fontWeight: "800",
      marginTop: 12,
    },
    emptyBody: {
      color: C.MUTED,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center",
      marginTop: 6,
    },

    sheetWrap: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: C.CARD,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingHorizontal: 18,
      paddingTop: 16,
    },
    sheetTitle: { color: C.TEXT, fontSize: 16, fontWeight: "800", marginBottom: 8 },
    sheetBody: { color: C.MUTED, fontSize: 13, lineHeight: 19, marginBottom: 6 },
    sheetRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 13,
    },
    sheetRowText: { fontSize: 15, fontWeight: "700" },
    sheetBtnRow: { flexDirection: "row", gap: 10, marginTop: 12 },
    sheetBtnGhost: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: "center",
      borderWidth: 1,
      borderColor: C.BORDER,
    },
    sheetBtnGhostText: { color: C.TEXT, fontWeight: "800" },
    sheetBtnDanger: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: "center",
      backgroundColor: C.ERROR ?? "#F05252",
    },
    sheetBtnDangerText: { color: "#fff", fontWeight: "900" },
  });
