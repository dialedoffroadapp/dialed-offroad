// app/pricing.tsx — the pricing page (conversion playbook §7): three tiers,
// monthly shown FIRST as the anchor, annual pre-selected with the discount vs
// monthly and "about $1 per ride day", lifetime hidden until the rider has
// 3+ logged ride days (a reward for the committed; §4 warns $129 is cheap),
// lifetime price from RevenueCat when it has it, else the config value.
// One tap buys the selected tier. Placements pick the offering per trigger.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../components/Toast";
import { Button, Eyebrow, H1, Small } from "../components/v3/primitives";
import { headingFont, interFont, useV3Fonts, V3 } from "../components/v3/theme";
import { readCachedEntitlement, resolveEntitlement } from "../lib/entitlement";
import { anchorLine } from "../lib/gateCopy";
import { gateTriggerFor, packagePrice, packagesForTrigger, type TierPackages } from "../lib/placements";
import { annualDiscountPct, DEFAULT_PRICES, formatUsd, lifetimeFallbackPrice, lifetimeVisible, monthlyEquivalentLine, perRideDayLine, type Tier } from "../lib/pricing";
import { hydrateRemoteConfig } from "../lib/remoteConfig";
import { markPurchasedThisSession, purchasePackage, restorePurchases, syncProFromRevenueCat } from "../lib/purchases";
import { readHistory } from "../lib/rideDay";
import { logEvent } from "../lib/usage";
import type { PaywallTrigger } from "../lib/paywall";

export default function PricingScreen() {
  useV3Fonts();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { trigger } = useLocalSearchParams<{ trigger?: string }>();
  const gate = gateTriggerFor((trigger as PaywallTrigger) ?? "unspecified");
  const [pk, setPk] = useState<TierPackages | null>(null);
  const [tier, setTier] = useState<Tier>("annual");
  const [rideDays, setRideDays] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      await hydrateRemoteConfig();
      const [packages, history, ent] = await Promise.all([packagesForTrigger(gate), readHistory(), readCachedEntitlement()]);
      if (!alive) return;
      const days = Math.max(history.filter((h) => h.endedAt).length, ent.trialRideDays);
      setPk(packages);
      setRideDays(days);
      const showLifetime = lifetimeVisible(days);
      void logEvent("pricing_page_viewed", { paywall_trigger_action: gate, tier_selected: "annual", lifetime_visible: showLifetime, offering: packages.offeringId });
      if (showLifetime) void logEvent("lifetime_offered", { ride_days: days });
    })();
    return () => {
      alive = false;
    };
  }, [gate]);

  const monthly = packagePrice(pk?.monthly ?? null)?.amount ?? DEFAULT_PRICES.monthly;
  const annual = packagePrice(pk?.annual ?? null)?.amount ?? DEFAULT_PRICES.annual;
  const lifetime = packagePrice(pk?.lifetime ?? null)?.amount ?? lifetimeFallbackPrice();
  const showLifetime = lifetimeVisible(rideDays);
  const discount = useMemo(() => annualDiscountPct(monthly, annual), [monthly, annual]);

  const tiers: { id: Tier; title: string; price: string; per: string; lines: string[]; badge?: string }[] = [
    { id: "monthly", title: "Monthly", price: `${formatUsd(monthly)}`, per: "a month", lines: [`${formatUsd(monthly * 12)} a year at this rate`, "Cancel any time"] },
    { id: "annual", title: "Annual", price: `${formatUsd(annual)}`, per: "a year", lines: [perRideDayLine(annual), monthlyEquivalentLine(annual)], badge: discount > 0 ? `Best value · ${discount}% off` : "Best value" },
    ...(showLifetime ? [{ id: "lifetime" as Tier, title: "Lifetime", price: `${formatUsd(lifetime)}`, per: "once", lines: ["For the rider who's all in", "Every future setup tool included"] }] : []),
  ];

  const buy = async () => {
    if (busy) return;
    const pkg = tier === "monthly" ? pk?.monthly : tier === "annual" ? pk?.annual : pk?.lifetime;
    if (!pkg) {
      toast.show("Plans aren't loading right now. Try again with signal.", { kind: "error" });
      return;
    }
    setBusy(true);
    try {
      const info = await purchasePackage(pkg);
      if (info?.entitlements?.active?.pro) {
        markPurchasedThisSession();
        void syncProFromRevenueCat();
        await resolveEntitlement();
        void logEvent("gate_converted", { paywall_trigger_action: gate, tier, offering: pk?.offeringId ?? null });
        toast.show("Pro unlocked 🎉", { kind: "success" });
        if (router.canGoBack()) router.back();
        else router.replace("/(tabs)" as never);
      }
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    const info = await restorePurchases();
    if (info?.entitlements?.active?.pro) {
      markPurchasedThisSession();
      void syncProFromRevenueCat();
      await resolveEntitlement();
      toast.show("Pro restored", { kind: "success" });
      router.back();
    } else toast.show("No Pro purchase to restore on this account.", { kind: "info" });
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 24 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color={V3.steel} />
          </Pressable>
          <Eyebrow style={{ marginBottom: 0 }}>Dialed Pro</Eyebrow>
        </View>
        <H1>Pick your season</H1>
        <Small style={{ fontSize: 14, marginTop: -6, marginBottom: 16 }}>The whole loop: log motos, get the change, keep every version. Cancel any time.</Small>

        {!pk ? (
          <ActivityIndicator color={V3.steel} style={{ marginVertical: 24 }} />
        ) : (
          tiers.map((t) => {
            const on = tier === t.id;
            return (
              <Pressable key={t.id} onPress={() => setTier(t.id)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.tier, on && styles.tierOn]}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={[styles.tierTitle, headingFont()]}>{t.title.toUpperCase()}</Text>
                    {t.badge ? (
                      <View style={styles.badge}>
                        <Text style={[styles.badgeText, interFont(600)]}>{t.badge}</Text>
                      </View>
                    ) : null}
                  </View>
                  {t.lines.map((l) => (
                    <Small key={l} style={{ marginTop: 3 }}>{l}</Small>
                  ))}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.price, interFont(700), on && { color: V3.blue }]}>{t.price}</Text>
                  <Small>{t.per}</Small>
                </View>
              </Pressable>
            );
          })
        )}

        <View style={styles.anchor}>
          <Small style={{ lineHeight: 19, fontSize: 13 }}>{anchorLine(formatUsd(annual))}</Small>
        </View>

        <View style={{ flex: 1 }} />
        <Button label={busy ? "Opening the store…" : tier === "lifetime" ? "Get Pro for life" : `Start Pro · ${tier === "monthly" ? formatUsd(monthly) : formatUsd(annual)}`} onPress={() => void buy()} disabled={busy || !pk} />
        <Pressable onPress={() => void restore()} accessibilityRole="button" style={styles.restore}>
          <Small>Restore purchase</Small>
        </Pressable>
        <Small style={{ textAlign: "center", fontSize: 11, color: V3.muted }}>Billed by the App Store or Google Play. No trial: your Pro rides already happened.</Small>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: V3.carbon },
  content: { paddingHorizontal: V3.screenPadX, flexGrow: 1 },
  top: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  tier: { backgroundColor: V3.panel, borderRadius: 16, padding: 16, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: V3.line, minHeight: 72 },
  tierOn: { borderColor: V3.blue },
  tierTitle: { fontSize: 22, lineHeight: 22, color: V3.white },
  badge: { backgroundColor: V3.blueDim, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 10, color: V3.blue },
  price: { fontSize: 26, lineHeight: 28, color: V3.white },
  anchor: { backgroundColor: V3.panel, borderRadius: 14, padding: 14, marginTop: 6, marginBottom: 12 },
  restore: { alignItems: "center", paddingVertical: 14 },
});
