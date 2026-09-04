// components/v3/ProGateSheet.tsx
// The action gate (conversion playbook §2, Recommendations Stage 1): fires
// only in the free state, names the action, states the immediate payoff,
// includes the cost anchor, and puts ONE tap on purchase (annual, the
// pre-selected tier) with "See all plans" beside it. Still offers the free
// alternative ("Update my baseline instead") when a baseline exists, and
// the locked-row Pro set. Mounted once in the root layout (ProGateHost).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useToast } from "../Toast";
import { BottomSheet } from "./BottomSheet";
import { Button, Eyebrow, Small } from "./primitives";
import { headingFont, interFont, V3 } from "./theme";
import { isEntitled, readCachedEntitlement, resolveEntitlement } from "../../lib/entitlement";
import { anyBikeWithBaseline, hasBaselineForBike } from "../../lib/freeTune";
import { anchorLine, GATE_COPY } from "../../lib/gateCopy";
import { gateTriggerFor, packagePrice, packagesForTrigger, type TierPackages } from "../../lib/placements";
import { hideProGate, PRO_SET, pricingHref, regenerateHref, subscribeProGate, type ProGateRequest } from "../../lib/proGate";
import { markPurchasedThisSession, purchasePackage, syncProFromRevenueCat } from "../../lib/purchases";
import { logEvent } from "../../lib/usage";

export function ProGateHost() {
  const router = useRouter();
  const toast = useToast();
  const [req, setReq] = useState<ProGateRequest | null>(null);
  const [altBike, setAltBike] = useState<string | null>(null);
  const [pk, setPk] = useState<TierPackages | null>(null);
  const [buying, setBuying] = useState(false);

  useEffect(() => subscribeProGate(setReq), []);

  useEffect(() => {
    let alive = true;
    setAltBike(null);
    setPk(null);
    if (!req) return;
    (async () => {
      // Defensive: never gate an entitled rider (trial_active / pro).
      const e = await readCachedEntitlement();
      if (isEntitled(e)) {
        hideProGate();
        return;
      }
      const gate = gateTriggerFor(req.trigger);
      void logEvent("gate_shown", { paywall_trigger_action: gate, raw_trigger: req.trigger, entitlement_state: e.state, bike_id: req.bikeId ?? null });
      const [bike, packages] = await Promise.all([
        (async () => {
          if (req.hasBaseline === true && req.bikeId) return req.bikeId;
          if (req.hasBaseline === false) return null;
          if (req.bikeId && (await hasBaselineForBike(req.bikeId))) return req.bikeId;
          return anyBikeWithBaseline();
        })(),
        packagesForTrigger(gate),
      ]);
      if (!alive) return;
      setAltBike(bike);
      setPk(packages);
    })();
    return () => {
      alive = false;
    };
  }, [req]);

  if (!req) return null;
  const gate = gateTriggerFor(req.trigger);
  const copy = GATE_COPY[gate];
  const annual = packagePrice(pk?.annual ?? null);

  const close = () => {
    void logEvent("gate_dismissed", { paywall_trigger_action: gate });
    const cb = req.onDismiss;
    hideProGate();
    cb?.();
  };
  const seePlans = () => {
    hideProGate();
    router.push(pricingHref(req.trigger) as never);
  };
  const buyAnnual = async () => {
    if (!pk?.annual) return seePlans();
    if (buying) return;
    setBuying(true);
    try {
      const info = await purchasePackage(pk.annual);
      if (info?.entitlements?.active?.pro) {
        markPurchasedThisSession();
        void syncProFromRevenueCat();
        void resolveEntitlement();
        void logEvent("gate_converted", { paywall_trigger_action: gate, tier: "annual", offering: pk.offeringId });
        toast.show("Pro unlocked 🎉", { kind: "success" });
        hideProGate();
      }
    } finally {
      setBuying(false);
    }
  };
  const regenerate = () => {
    if (!altBike) return;
    void logEvent("pro_gate_alternative", { paywall_trigger_action: gate, bike_id: altBike });
    hideProGate();
    router.push(regenerateHref(altBike) as never);
  };

  return (
    <BottomSheet open onClose={close}>
      <Eyebrow style={{ color: V3.blue }}>Pro</Eyebrow>
      <Text style={[styles.title, headingFont()]}>{copy.name.toUpperCase()}</Text>
      <Text style={[styles.action, interFont(600)]}>{copy.action}</Text>
      <Small style={{ fontSize: 14, lineHeight: 20, marginBottom: 12 }}>{copy.payoff}</Small>

      <View style={styles.rows}>
        {PRO_SET.map((p, i) => {
          const lit = gateTriggerFor(p.trigger) === gate;
          return (
            <View key={p.trigger} style={[styles.row, i < PRO_SET.length - 1 && styles.rowBorder]}>
              <Text style={[styles.rowLabel, interFont(lit ? 600 : 400), { color: lit ? V3.white : V3.steel }]}>{p.label}</Text>
              <View style={styles.rowRight}>
                <Text style={[styles.dashes, interFont(700), lit && { color: V3.blue }]}>{lit ? "PRO" : "— —"}</Text>
                <Ionicons name="lock-closed" size={14} color={lit ? V3.blue : V3.steel} />
              </View>
            </View>
          );
        })}
      </View>
      <Small style={{ marginTop: 12, lineHeight: 18 }}>{anchorLine(annual?.string ?? null)}</Small>

      <Button label={buying ? "Opening the store…" : `Get Pro · ${annual?.string ?? "$59.99"} a year`} onPress={() => void buyAnnual()} disabled={buying} style={{ marginTop: 16 }} />
      <Button label="See all plans" ghost onPress={seePlans} style={{ marginTop: 10 }} />
      {altBike ? <Button label="Update my baseline instead" ghost onPress={regenerate} style={{ marginTop: 10 }} /> : null}
      <Pressable onPress={close} accessibilityRole="button" style={styles.notNow}>
        <Small>Not now</Small>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 30, lineHeight: 30, color: V3.white, marginBottom: 6 },
  action: { fontSize: 15, color: V3.white, marginBottom: 4 },
  rows: { backgroundColor: V3.carbon, borderRadius: 14, paddingHorizontal: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, minHeight: 48 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: V3.hair },
  rowLabel: { fontSize: 15 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  dashes: { fontSize: 14, color: V3.steel, letterSpacing: 1.5 },
  notNow: { alignItems: "center", paddingVertical: 14 },
});
