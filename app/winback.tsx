// app/winback.tsx
// Winback flow for lapsed subscribers (pro_until in the past, is_pro false):
// "Welcome back" framing with their OWN data as the hook — bike, version
// count, "your setup history is waiting" — and annual-first offer
// presentation (annual bypasses the cycle-1/2 churn cliff; it's only 16% of
// MRR today). Reached from the TrialPromptModal winback CTA and the Setup
// History gate. Purchases go through the RevenueCat SDK directly; if
// offerings can't load, the CTA falls back to /premium (remote paywall).

import { paywallHref } from "../lib/paywall";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { PurchasesPackage } from "react-native-purchases";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../components/Toast";
import {
  getOfferings,
  markPurchasedThisSession,
  purchasePackage,
  syncProFromRevenueCat,
} from "../lib/purchases";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { logEvent } from "../lib/usage";

type Hook = {
  firstName: string;
  bikeTitle: string | null;
  versionCount: number;
};

export default function WinbackScreen() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C), [C]);

  const [hook, setHook] = useState<Hook | null>(null);
  const [annual, setAnnual] = useState<PurchasesPackage | null>(null);
  const [monthly, setMonthly] = useState<PurchasesPackage | null>(null);
  const [offeringsTried, setOfferingsTried] = useState(false);
  const [buying, setBuying] = useState<"annual" | "monthly" | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user;
        if (!user?.id) return;

        const [{ data: prof }, { data: versions }] = await Promise.all([
          supabase
            .from("profiles")
            .select("display_name")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase
            .from("setup_versions")
            .select("bike_id")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(200),
        ]);
        const rows = (versions ?? []) as { bike_id: string | null }[];
        let bikeTitle: string | null = null;
        const newestBikeId = rows.find((r) => r.bike_id)?.bike_id ?? null;
        if (newestBikeId) {
          const { data: bike } = await supabase
            .from("bikes")
            .select("make, model, nickname")
            .eq("id", newestBikeId)
            .maybeSingle();
          bikeTitle =
            bike?.nickname ||
            [bike?.make, bike?.model].filter(Boolean).join(" ") ||
            null;
        }
        if (!mounted) return;
        setHook({
          firstName:
            (prof?.display_name ?? "").trim().split(" ")[0] || "",
          bikeTitle,
          versionCount: rows.length,
        });
      } catch {
        if (mounted) setHook({ firstName: "", bikeTitle: null, versionCount: 0 });
      }
    })();
    void logEvent("winback_screen_shown", {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    getOfferings()
      .then((offerings) => {
        if (!mounted) return;
        const current = offerings?.current ?? null;
        const pkgs = current?.availablePackages ?? [];
        setAnnual(
          current?.annual ??
            pkgs.find((p: any) => p.packageType === "ANNUAL") ??
            null
        );
        setMonthly(
          current?.monthly ??
            pkgs.find((p: any) => p.packageType === "MONTHLY") ??
            null
        );
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setOfferingsTried(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const savingsPct = useMemo(() => {
    const a = annual?.product?.price;
    const m = monthly?.product?.price;
    if (typeof a !== "number" || typeof m !== "number" || m <= 0) return null;
    const pct = Math.round(((m * 12 - a) / (m * 12)) * 100);
    return pct > 0 && pct < 100 ? pct : null;
  }, [annual, monthly]);

  const perMonth = useMemo(() => {
    const a = annual?.product?.price;
    if (typeof a !== "number" || a <= 0) return null;
    return (a / 12).toFixed(2);
  }, [annual]);

  const buy = async (pkg: PurchasesPackage, kind: "annual" | "monthly") => {
    if (buying) return;
    void logEvent("winback_cta_tapped", { package: kind });
    setBuying(kind);
    try {
      const info = await purchasePackage(pkg);
      if (info?.entitlements?.active?.pro) {
        markPurchasedThisSession();
        void syncProFromRevenueCat();
        toast.show("Welcome back to Pro 🎉", { kind: "success" });
        router.replace("/(tabs)" as any);
      }
      // Cancelled / failed → stay put, no error theater (SDK logs it).
    } finally {
      setBuying(null);
    }
  };

  const onFallbackPaywall = () => {
    void logEvent("winback_cta_tapped", { package: "fallback_paywall" });
    router.push(paywallHref("winback_fallback", "back") as any);
  };

  const hookLine = hook
    ? hook.versionCount > 0
      ? `${hook.bikeTitle ? `Your ${hook.bikeTitle}` : "Your bike"}, with ` +
        `${hook.versionCount} setup version${hook.versionCount === 1 ? "" : "s"} ` +
        `of dialed-in history, is waiting right where you left it.`
      : "Your bikes and setup history are waiting right where you left them."
    : "";

  return (
    <View style={{ flex: 1, backgroundColor: C.BG }}>
      <View style={{ height: insets.top, backgroundColor: C.BG }} />

      <View style={S.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={S.headerBtn}>
          <Ionicons name="chevron-back-outline" size={24} color={C.TEXT} />
        </Pressable>
        <Text style={S.headerTitle}>Pro</Text>
        <View style={S.headerBtn} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}
      >
        <View style={S.heroIcon}>
          <Ionicons name="speedometer-outline" size={30} color={C.ACCENT} />
        </View>
        <Text style={S.title}>
          Welcome back{hook?.firstName ? `, ${hook.firstName}` : ""}
        </Text>
        <Text style={S.subtitle}>{hookLine}</Text>

        {/* Annual first — the plan that skips the month 1-2 churn cliff. */}
        {annual ? (
          <Pressable
            onPress={() => buy(annual, "annual")}
            disabled={buying !== null}
            style={[S.offerCard, S.offerCardAnnual, { borderColor: C.ACCENT }]}
          >
            <View style={S.offerHead}>
              <Text style={S.offerName}>Annual</Text>
              <View style={S.saveBadge}>
                <Text style={S.saveBadgeText}>
                  {savingsPct ? `SAVE ${savingsPct}%` : "BEST VALUE"}
                </Text>
              </View>
            </View>
            <Text style={S.offerPrice}>
              {annual.product?.priceString ?? ""}
              <Text style={S.offerPer}>
                {perMonth ? `  ·  ≈ ${perMonth}/mo billed annually` : "/yr"}
              </Text>
            </Text>
            {buying === "annual" ? (
              <ActivityIndicator color="#fff" style={{ marginTop: 10 }} />
            ) : (
              <View style={S.offerCta}>
                <Text style={S.offerCtaText}>Resubscribe · Annual</Text>
              </View>
            )}
          </Pressable>
        ) : null}

        {monthly ? (
          <Pressable
            onPress={() => buy(monthly, "monthly")}
            disabled={buying !== null}
            style={[S.offerCard, { borderColor: C.BORDER }]}
          >
            <View style={S.offerHead}>
              <Text style={S.offerName}>Monthly</Text>
            </View>
            <Text style={S.offerPrice}>
              {monthly.product?.priceString ?? ""}
              <Text style={S.offerPer}>/mo</Text>
            </Text>
            {buying === "monthly" ? (
              <ActivityIndicator color={C.ACCENT} style={{ marginTop: 10 }} />
            ) : (
              <View style={[S.offerCta, S.offerCtaGhost, { borderColor: C.BORDER }]}>
                <Text style={[S.offerCtaText, { color: C.TEXT }]}>
                  Resubscribe · Monthly
                </Text>
              </View>
            )}
          </Pressable>
        ) : null}

        {/* Offerings unavailable → the remote paywall still works. */}
        {offeringsTried && !annual && !monthly ? (
          <Pressable onPress={onFallbackPaywall} style={S.fallbackBtn}>
            <Text style={S.fallbackBtnText}>See Pro plans</Text>
          </Pressable>
        ) : null}
        {!offeringsTried ? (
          <ActivityIndicator color={C.ACCENT} style={{ marginTop: 24 }} />
        ) : null}

        <Text style={S.footNote}>
          Everything you built is intact: bikes, sessions, setup versions.
          Pro picks up exactly where you left off.
        </Text>
      </ScrollView>
    </View>
  );
}

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
    headerTitle: {
      flex: 1,
      textAlign: "center",
      color: C.TEXT,
      fontSize: 16,
      fontWeight: "800",
    },
    heroIcon: {
      width: 56,
      height: 56,
      borderRadius: 16,
      backgroundColor: "rgba(29,155,240,0.14)",
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
      marginTop: 12,
    },
    title: {
      color: C.TEXT,
      fontSize: 24,
      fontWeight: "900",
      textAlign: "center",
      marginTop: 14,
      letterSpacing: -0.3,
    },
    subtitle: {
      color: C.MUTED,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
      marginTop: 8,
      marginBottom: 20,
      paddingHorizontal: 8,
    },
    offerCard: {
      backgroundColor: C.CARD,
      borderWidth: 1,
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
    },
    offerCardAnnual: {
      borderWidth: 1.5,
    },
    offerHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    offerName: { color: C.TEXT, fontSize: 16, fontWeight: "800" },
    saveBadge: {
      backgroundColor: "rgba(29,155,240,0.16)",
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    saveBadgeText: { color: C.ACCENT, fontSize: 11, fontWeight: "900" },
    offerPrice: { color: C.TEXT, fontSize: 22, fontWeight: "900", marginTop: 8 },
    offerPer: { color: C.MUTED, fontSize: 13, fontWeight: "600" },
    offerCta: {
      backgroundColor: C.ACCENT,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
      marginTop: 12,
    },
    offerCtaGhost: {
      backgroundColor: "transparent",
      borderWidth: 1,
    },
    offerCtaText: { color: "#fff", fontWeight: "900", fontSize: 14 },
    fallbackBtn: {
      backgroundColor: C.ACCENT,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 8,
    },
    fallbackBtnText: { color: "#fff", fontWeight: "900", fontSize: 15 },
    footNote: {
      color: C.MUTED,
      fontSize: 12,
      lineHeight: 17,
      textAlign: "center",
      marginTop: 16,
      paddingHorizontal: 12,
    },
  });
