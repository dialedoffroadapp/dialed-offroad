// app/ride/mode.tsx — Ride mode (design/mockups/ride/06, OUTDOOR). Persistent
// session on disk; elapsed time is the hero; running numbers; "Track
// changed? Retune"; huge Log moto; Adjust; End ride. Restored on relaunch by
// Home / Start Riding. "saved on phone" reflects the local outbox. A session
// idle 12+ hours gets the ONLY ride prompt there is: "Still riding?" with an
// editable end time. No notifications of any kind.
import { formatValue } from "../../lib/format";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View, BackHandler } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet } from "../../components/v3/BottomSheet";
import { Chip, Eyebrow, Label, Small } from "../../components/v3/primitives";
import { interFont, V3 } from "../../components/v3/theme";
import { Clock, Cta, Ghost, RideScreenBg } from "../../components/ride/ridePrimitives";
import {
  elapsedMs,
  flushOutbox,
  formatElapsed,
  outboxEmpty,
  readOpenSession,
  rideEffective,
  RIDE_IDLE_PROMPT_MS,
  writeSession,
  type RideSession,
} from "../../lib/rideDay";
import { updateRideActivity } from "../../lib/rideLiveActivity";
import { gateIfLocked } from "../../lib/proGate";
import { logEvent } from "../../lib/usage";

const fmt = (v: number | null, digits = 0) => formatValue(v, digits);

export function runningLine(v: ReturnType<typeof rideEffective>): string {
  return `F ${fmt(v.fork_comp)} / ${fmt(v.fork_reb)} · S ${fmt(v.shock_lsc)} / ${fmt(v.shock_hsc, 2)} / ${fmt(v.shock_reb)}`;
}

export default function RideModeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<RideSession | null>(null);
  const [now, setNow] = useState(Date.now());
  const [synced, setSynced] = useState(false);
  const [stillOpen, setStillOpen] = useState(false);
  const [endHoursAgo, setEndHoursAgo] = useState<number>(0);

  const load = useCallback(async () => {
    const open = await readOpenSession();
    if (!open) return router.replace("/(tabs)" as never);
    const idle = Date.now() - Date.parse(open.lastActiveAt);
    if (idle > RIDE_IDLE_PROMPT_MS) setStillOpen(true);
    setS(open);
    setSynced(await outboxEmpty());
    void flushOutbox(open).then(async () => setSynced(await outboxEmpty()));
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return undefined;
    }, [load])
  );

  // Hardware back never leaves ride mode (a persistent takeover); End ride is
  // the only way out. gestureEnabled:false covers iOS only.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") void load();
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [load]);

  useEffect(() => {
    if (!s) return;
    void updateRideActivity({ motos: s.motos.length, values: runningLine(rideEffective(s)) });
  }, [s]);

  if (!s) {
    return (
      <View style={[RideScreenBg({ out: true }), styles.center]}>
        <ActivityIndicator color={V3.steel} />
      </View>
    );
  }

  const eff = rideEffective(s);
  const last = s.motos[s.motos.length - 1];
  const lastLine = last
    ? `Moto ${last.seq}: ${last.sentiment[0].toUpperCase()}${last.sentiment.slice(1)} · ${last.symptoms.length ? last.symptoms.map((x) => x.label.toLowerCase()).join(", ") : "nothing flagged"}`
    : "Moto 1 is next. Log it when you're off the bike.";

  const resume = async () => {
    setStillOpen(false);
    const idleMin = Math.round((Date.now() - Date.parse(s.lastActiveAt)) / 60000);
    void logEvent("session_resumed", { idle_min: idleMin, motos: s.motos.length });
    setS(await writeSession(s));
  };
  const closeForgotten = async () => {
    const endedAt = new Date(Date.now() - endHoursAgo * 3600000).toISOString();
    const idleMin = Math.round((Date.now() - Date.parse(s.lastActiveAt)) / 60000);
    void logEvent("session_autoclosed", { idle_min: idleMin, edited_end: endHoursAgo > 0 });
    await writeSession({ ...s, endedAt });
    setStillOpen(false);
    router.replace("/ride/end" as never);
  };

  return (
    <View style={RideScreenBg({ out: true })}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 24 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <View style={styles.row}>
          <Eyebrow style={{ marginBottom: 0 }}>Ride mode</Eyebrow>
          <Small>
            <Ionicons name={synced ? "cloud-done-outline" : "save-outline"} size={12} color={V3.steel} /> {synced ? "synced" : "saved on phone"}
          </Small>
        </View>

        <View style={styles.clockWrap}>
          <Label>{[s.trackName, `moto ${s.motos.length + 1} next`].filter(Boolean).join(" · ")}</Label>
          <View style={{ marginTop: 8 }}>
            <Clock>{formatElapsed(elapsedMs(s, now))}</Clock>
          </View>
          <Small style={{ marginTop: 8, fontSize: 14 }}>on the bike today</Small>
        </View>

        <View style={styles.card}>
          <Label>Running now</Label>
          <Text style={[styles.running, interFont(800)]}>{runningLine(eff)}</Text>
          <Small style={{ marginTop: 4 }}>{lastLine}</Small>
        </View>

        <Pressable onPress={() => void gateIfLocked({ trigger: "adjust", bikeId: s.bike.id }).then((ok) => ok && router.push("/ride/retune" as never))} accessibilityRole="button" style={styles.retune}>
          <Text style={[styles.retuneText, interFont(400)]}>Track changed?</Text>
          <Text style={[styles.retuneLink, interFont(600)]}>Retune</Text>
        </Pressable>

        <View style={{ flex: 1 }} />
        <Cta huge label="Log moto" onPress={() => void gateIfLocked({ trigger: "log_moto", bikeId: s.bike.id }).then((ok) => ok && router.push("/ride/log" as never))} style={{ marginBottom: 10 }} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Ghost label="Adjust" onPress={() => void gateIfLocked({ trigger: "adjust", bikeId: s.bike.id }).then((ok) => ok && router.push({ pathname: "/ride/adjust", params: { manual: "1" } } as never))} />
          <Ghost label="End ride" dim onPress={() => router.push("/ride/end" as never)} />
        </View>
      </ScrollView>

      <BottomSheet open={stillOpen} onClose={() => void resume()} title="Still riding?">
        <Small style={{ fontSize: 14, marginBottom: 14 }}>
          This ride has been open since {new Date(s.startedAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}. If you&apos;re done, pick when you stopped so the hours stay honest.
        </Small>
        <Label style={{ marginBottom: 8 }}>Stopped</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 8, marginBottom: 14 }}>
          {[0, 1, 2, 4, 8, 12, 24].map((h) => (
            <Chip key={h} label={h === 0 ? "Just now" : `${h}h ago`} on={endHoursAgo === h} onPress={() => setEndHoursAgo(h)} />
          ))}
        </View>
        <Cta label="Wrap the day" onPress={() => void closeForgotten()} style={{ padding: 18 }} />
        <Pressable onPress={() => void resume()} accessibilityRole="button" style={{ alignItems: "center", paddingVertical: 14 }}>
          <Small>Still riding, keep it open</Small>
        </Pressable>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: V3.screenPadX, flexGrow: 1 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  clockWrap: { alignItems: "center", marginTop: 28, marginBottom: 12 },
  card: { backgroundColor: V3.panel, borderRadius: 16, padding: 16, marginBottom: 12 },
  running: { fontSize: 20, color: "#FFFFFF", marginTop: 6 },
  retune: { backgroundColor: V3.panel, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 2, borderColor: V3.line, flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 56 },
  retuneText: { fontSize: 15, color: "#FFFFFF" },
  retuneLink: { fontSize: 15, color: V3.blue },
});
