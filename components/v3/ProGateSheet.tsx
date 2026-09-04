// components/v3/ProGateSheet.tsx
// Renders lib/proGate.ts requests: the locked-row gate that names the Pro
// action, lists the Pro set (attempted one lit, the rest locked), and offers
// "Update my baseline instead" when a baseline exists. Mounted ONCE in the
// root layout (ProGateHost). Fixed dark palette like the other 3.0 surfaces.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "./BottomSheet";
import { Button, Eyebrow, Small } from "./primitives";
import { headingFont, interFont, V3 } from "./theme";
import { anyBikeWithBaseline, hasBaselineForBike } from "../../lib/freeTune";
import { FREE_LINE, hideProGate, paywallHrefFor, PRO_SET, proActionFor, regenerateHref, subscribeProGate, type ProGateRequest } from "../../lib/proGate";
import { logEvent } from "../../lib/usage";

export function ProGateHost() {
  const router = useRouter();
  const [req, setReq] = useState<ProGateRequest | null>(null);
  const [altBike, setAltBike] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => subscribeProGate(setReq), []);

  useEffect(() => {
    let alive = true;
    setResolved(false);
    setAltBike(null);
    if (!req) return;
    (async () => {
      let bike: string | null = null;
      if (req.hasBaseline === true && req.bikeId) bike = req.bikeId;
      else if (req.hasBaseline === false) bike = null;
      else if (req.bikeId && (await hasBaselineForBike(req.bikeId))) bike = req.bikeId;
      else bike = await anyBikeWithBaseline();
      if (!alive) return;
      setAltBike(bike);
      setResolved(true);
      void logEvent("pro_gate_shown", { paywall_trigger_action: req.trigger, has_alternative: !!bike, bike_id: req.bikeId ?? null });
    })();
    return () => {
      alive = false;
    };
  }, [req]);

  if (!req) return null;
  const action = proActionFor(req.trigger);

  const close = () => {
    const cb = req.onDismiss;
    hideProGate();
    cb?.();
  };
  const seePro = () => {
    hideProGate();
    router.push(paywallHrefFor(req) as never);
  };
  const regenerate = () => {
    if (!altBike) return;
    void logEvent("pro_gate_alternative", { paywall_trigger_action: req.trigger, bike_id: altBike });
    hideProGate();
    router.push(regenerateHref(altBike) as never);
  };

  return (
    <BottomSheet open onClose={close}>
      <Eyebrow style={{ color: V3.blue }}>{action.eyebrow}</Eyebrow>
      <Text style={[styles.title, headingFont()]}>{action.title.toUpperCase()}</Text>
      <Small style={{ fontSize: 14, marginBottom: 14 }}>That one&apos;s a Pro thing. Here&apos;s the whole set.</Small>

      <View style={styles.rows}>
        {PRO_SET.map((p, i) => {
          const lit = p.trigger === req.trigger || (req.trigger === "second_tune" && false);
          return (
            <View key={p.trigger} style={[styles.row, i < PRO_SET.length - 1 && styles.rowBorder]}>
              <Text style={[styles.rowLabel, interFont(lit ? 600 : 400), lit ? { color: V3.white } : { color: V3.steel }]}>{p.label}</Text>
              <View style={styles.rowRight}>
                <Text style={[styles.dashes, interFont(700), lit && { color: V3.blue }]}>{lit ? "PRO" : "— —"}</Text>
                <Ionicons name="lock-closed" size={14} color={lit ? V3.blue : V3.steel} />
              </View>
            </View>
          );
        })}
      </View>
      <Small style={{ marginTop: 12 }}>{FREE_LINE}</Small>

      <Button label="See Pro" onPress={seePro} style={{ marginTop: 18 }} />
      {resolved && altBike ? (
        <Button label="Update my baseline instead" ghost onPress={regenerate} style={{ marginTop: 10 }} />
      ) : null}
      <Pressable onPress={close} accessibilityRole="button" style={styles.notNow}>
        <Small>Not now</Small>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 30, lineHeight: 30, color: V3.white, marginBottom: 6 },
  rows: { backgroundColor: V3.carbon, borderRadius: 14, paddingHorizontal: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, minHeight: 48 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: V3.hair },
  rowLabel: { fontSize: 15 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  dashes: { fontSize: 14, color: V3.steel, letterSpacing: 1.5 },
  notNow: { alignItems: "center", paddingVertical: 14 },
});
