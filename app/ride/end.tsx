// app/ride/end.tsx — End ride (design/mockups/ride/10): settles pending
// deltas into ONE manual version, adds elapsed time to bikes.hours, shows the
// moto timeline, stats (editable ride time), the dialed delta, and offers
// "Save as [track] baseline", "Just save", and Share.
import { formatSetting } from "../../lib/format";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import React, { useEffect, useState, useCallback } from "react";
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, View, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line, Text as SvgText } from "react-native-svg";
import { useShareSetup } from "../../components/ShareSetupCard";
import { useToast } from "../../components/Toast";
import { DecimalStepper } from "../../components/garage/GarageSheets";
import { BottomSheet } from "../../components/v3/BottomSheet";
import { Bar, Body, Card, Eyebrow, Label, Row, Small } from "../../components/v3/primitives";
import { headingFont, V3, interFont } from "../../components/v3/theme";
import { Cta, Ghost, RideH1, RideScreenBg, Stat } from "../../components/ride/ridePrimitives";
import { nextOilAt, oilIntervalFor, readBikeExtras, type BikeExtras } from "../../lib/bikeExtras";
import { loadBikePage, loadUserAndPro } from "../../lib/garageV3";
import { shortDate } from "../../lib/homeCopy";
import { elapsedMs, formatElapsed, readSessionForEnd, rideEffective, type RideSession } from "../../lib/rideDay";
import { finishRideDay, hoursFromMs, meterDelta, saveTrackBaseline, settleRideDay, type SettleResult } from "../../lib/rideEnd";
import { CIRCUIT_LABELS } from "../../lib/rideAdjust";
import type { MeterInputs } from "../../lib/dialedMeter";

const SENT_COLOR = { better: V3.blue, same: V3.steel, worse: "#E8253F" } as const;

export default function RideEndScreen() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { shareView, share, available: canShare } = useShareSetup();
  // The offscreen capture view mounts only once Share is tapped.
  const [shareMounted, setShareMounted] = useState(false);
  const [s, setS] = useState<RideSession | null>(null);
  const [extras, setExtras] = useState<BikeExtras | null>(null);
  const [meterBefore, setMeterBefore] = useState<MeterInputs | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [hours, setHours] = useState(0);
  const [editHours, setEditHours] = useState(false);
  const [settled, setSettled] = useState<SettleResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // Read the session whether or not endedAt is already set (the
      // forgotten-session prompt sets it before routing here).
      const closed = await readSessionForEnd();
      if (!closed) return router.replace("/(tabs)" as never);
      setS(closed);
      setHours(hoursFromMs(elapsedMs(closed)));
      const [{ userId, isPro: pro }, e] = await Promise.all([loadUserAndPro(), readBikeExtras(closed.bike.id)]);
      setIsPro(pro);
      setExtras(e);
      if (userId) {
        try {
          const page = await loadBikePage({ id: closed.bike.id, make: closed.bike.make, model: closed.bike.model, year: closed.bike.year, nickname: closed.bike.nickname, model_id: closed.bike.model_id, is_primary: true });
          setMeterBefore(page.meterInputs);
        } catch {
          setMeterBefore(null);
        }
      }
    })();
  }, [router]);

  // Settle once on arrival (idempotent: endedAt is set once).
  const runSettle = useCallback(async (session: RideSession) => {
    setBusy(true);
    setSettleError(null);
    try {
      const { session: next, result } = await settleRideDay(session, hours);
      setS(next);
      setSettled(result);
      // Hours changed during the settle: re-read so the stat and the ride-time
      // editor start from the post-settle number (audit finding 22).
      setExtras(await readBikeExtras(next.bike.id));
    } catch (e: any) {
      setSettleError(e?.message ?? "Couldn't settle the day.");
    } finally {
      setBusy(false);
    }
  }, [hours]);

  useEffect(() => {
    if (!s || settled || busy || settleError) return;
    void runSettle(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.localId]);

  // Android hardware back: never drop a day mid-settle; after settle, leave
  // the way "Just save" does not (the session stays for End ride next time).
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!settled || busy) return true;
      router.replace("/(tabs)" as never);
      return true;
    });
    return () => sub.remove();
  }, [settled, busy, router]);

  if (s && settleError && !settled) {
    return (
      <View style={[RideScreenBg({ out: true }), styles.center]}>
        <Small style={{ textAlign: "center", marginBottom: 16, paddingHorizontal: 24 }}>{settleError} Your motos and changes are still on this phone.</Small>
        <Cta label="Try again" onPress={() => void runSettle(s)} style={{ alignSelf: "stretch", marginHorizontal: 24 }} />
        <Ghost thin label="Leave for now" onPress={() => router.replace("/(tabs)" as never)} style={{ marginTop: 10 }} />
      </View>
    );
  }

  if (!s || !extras || !settled) {
    return (
      <View style={[RideScreenBg({}), styles.center]}>
        <ActivityIndicator color={V3.steel} />
        <Small style={{ marginTop: 12 }}>Settling the day…</Small>
      </View>
    );
  }

  const eff = rideEffective(s);
  const delta = meterBefore ? meterDelta(meterBefore, s) : null;
  const changes = s.pending.filter((p) => p.kind === "adjust" || p.kind === "retune");
  const lastSolved = [...s.motos].reverse().find((m) => m.sentiment === "better");
  const solvedLine = lastSolved && s.motos.some((m) => m.seq < lastSolved.seq && m.symptoms.length)
    ? `${s.motos.find((m) => m.seq < lastSolved.seq && m.symptoms.length)!.symptoms[0].label}: solved on moto ${lastSolved.seq}.`
    : s.motos.length
      ? `${s.motos.length} ${s.motos.length === 1 ? "moto" : "motos"} logged. ${changes.length ? `${changes.length} ${changes.length === 1 ? "change" : "changes"} turned.` : "Nothing turned."}`
      : "No motos logged. The clock still counts.";
  const newHours = (extras.hours ?? 0);
  const oilDue = newHours >= nextOilAt(extras);
  const savedLine = settled.version
    ? `Saved as ${s.setupName} v${settled.version.version_number}${oilDue ? ` · oil is due, you're past ${nextOilAt(extras)}` : ""}`
    : settled.changedCircuits === 0
      ? `No changes today. ${s.setupName} stays ${typeof s.startingVersionNumber === "number" ? `at v${s.startingVersionNumber}` : "where it was"}.`
      : settled.queued
        ? "Changes saved on this phone. They sync after the next update."
        : "Changes saved on this phone.";

  const done = async (how: "baseline" | "just_save") => {
    if (busy) return;
    setBusy(true);
    try {
      if (how === "baseline") {
        if (!isPro) {
          toast.show("Track baselines are a Pro thing. Saved as your running setup instead.", { kind: "info" });
        } else {
          const r = await saveTrackBaseline(s, settled.version);
          toast.show(r.created ? `${s.trackName} baseline saved` : `${s.trackName} baseline updated`, { kind: "success" });
        }
      }
      await finishRideDay(s, { how, hours_edited: hours !== hoursFromMs(elapsedMs(s)) }, delta?.to ?? null);
      router.replace("/(tabs)" as never);
    } finally {
      setBusy(false);
    }
  };

  const onShare = () => {
    setShareMounted(true);
    void share(
      {
        bikeTitle: [s.bike.year, s.bike.make, s.bike.model].filter(Boolean).join(" "),
        versionNumber: settled.version?.version_number ?? s.startingVersionNumber ?? null,
        date: shortDate(new Date(s.startedAt)),
        values: { forkComp: eff.fork_comp, forkReb: eff.fork_reb, shockLsc: eff.shock_lsc, shockHsc: eff.shock_hsc, shockReb: eff.shock_reb, sag: eff.shock_sag },
      },
      "history"
    );
  };

  const W = 300;
  const n = Math.max(1, s.motos.length);
  const x = (i: number) => (n === 1 ? W / 2 : 34 + (i * (W - 68)) / (n - 1));

  return (
    <View style={RideScreenBg({})}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 24 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <Eyebrow>End ride</Eyebrow>
        <RideH1>Day wrapped{s.trackName ? ` · ${s.trackName}` : ""}</RideH1>

        <Card style={{ paddingTop: 18, paddingBottom: 12, paddingHorizontal: 14 }}>
          {s.motos.length ? (
            <Svg viewBox={`0 0 ${W} 90`} width="100%" height={90}>
              <Line x1={x(0)} y1={42} x2={x(n - 1)} y2={42} stroke={V3.line} strokeWidth={2} />
              {changes.map((c, k) => {
                const i = Math.min(n - 1, Math.max(0, c.afterMoto - 1));
                const px = n === 1 ? W / 2 : x(i) + (i < n - 1 ? (x(i + 1) - x(i)) / 2 : 0);
                return (
                  <React.Fragment key={k}>
                    <Line x1={px} y1={22} x2={px} y2={62} stroke={V3.blue} strokeWidth={2} strokeDasharray="3 3" />
                    <SvgText x={px} y={14} fontSize={10} fill={V3.blue} textAnchor="middle">{`${c.delta > 0 ? "+" : "−"}${formatSetting(Math.abs(c.delta), c.circuit)} ${CIRCUIT_LABELS[c.circuit].replace(/^(Fork|Shock) /, "").toLowerCase().replace("low speed comp", "LSC").replace("rebound", "reb")}`}</SvgText>
                  </React.Fragment>
                );
              })}
              {s.motos.map((m, i) => (
                <React.Fragment key={m.localId}>
                  <Circle cx={x(i)} cy={42} r={13} fill={m.sentiment === "better" ? V3.blue : V3.panel} stroke={SENT_COLOR[m.sentiment]} strokeWidth={2.5} />
                  <SvgText x={x(i)} y={46} fontSize={11} fontWeight="700" fill={m.sentiment === "better" ? V3.carbon : SENT_COLOR[m.sentiment]} textAnchor="middle">{String(m.seq)}</SvgText>
                  <SvgText x={x(i)} y={74} fontSize={11} fill={SENT_COLOR[m.sentiment]} textAnchor="middle">{m.sentiment[0].toUpperCase() + m.sentiment.slice(1)}</SvgText>
                </React.Fragment>
              ))}
            </Svg>
          ) : null}
          <Body style={{ textAlign: "center", marginTop: 6 }}>{solvedLine}</Body>
        </Card>

        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
          <Stat v={String(s.motos.length)} k="motos" />
          <Pressable onPress={() => setEditHours(true)} accessibilityRole="button" style={{ flex: 1 }}>
            <Stat v={formatElapsed(hours * 3600000)} k="ride time" icon={<Ionicons name="pencil-outline" size={11} color={V3.steel} />} />
          </Pressable>
          <Stat v={newHours.toFixed(1)} k="engine hrs" blue />
        </View>

        <Card>
          <Row>
            <Label>Dialed</Label>
            <Text style={[styles.delta, headingFont()]}>{delta ? `${delta.from} → ${delta.to}%` : "—"}</Text>
          </Row>
          <Bar pct={delta?.to ?? 0} />
          <Small>{savedLine}</Small>
        </Card>

        <View style={{ flex: 1 }} />
        <Cta
          label={`Save as ${s.trackName ?? "track"} baseline`}
          icon={<Ionicons name="bookmark-outline" size={18} color={V3.carbon} />}
          style={{ padding: 18, marginBottom: 10 }}
          onPress={() => void done("baseline")}
          disabled={busy}
        />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Ghost thin label="Just save" onPress={() => void done("just_save")} />
          {canShare ? <Ghost thin label="Share" icon={<Ionicons name="share-outline" size={16} color="#FFFFFF" />} onPress={onShare} /> : null}
        </View>
      </ScrollView>
      {shareMounted && canShare ? shareView : null}
      <BottomSheet open={editHours} onClose={() => setEditHours(false)} title="Ride time">
        <Small style={{ marginBottom: 14 }}>Prefilled from the clock. Fix it if you sat around; engine hours follow it.</Small>
        <DecimalStepper value={hours} onChange={setHours} step={0.1} min={0} max={24} unit="hrs" digits={1} />
        <Cta
          label="Set ride time"
          style={{ marginTop: 18, padding: 18 }}
          onPress={async () => {
            setEditHours(false);
            // Re-apply the hours difference onto the bike.
            const diff = Math.round((hours - settled.hoursAdded) * 10) / 10;
            if (diff !== 0) {
              const { saveBikeExtras } = await import("../../lib/bikeExtras");
              const e = await saveBikeExtras(s.bike.id, { hours: Math.round(((extras.hours ?? 0) + diff) * 10) / 10 });
              setExtras(e);
              setSettled({ ...settled, hoursAdded: hours });
            }
          }}
        />
      </BottomSheet>
      <Text style={[{ display: "none" }, interFont(400)]}>{oilIntervalFor(extras)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: V3.screenPadX, flexGrow: 1 },
  delta: { fontSize: 26, lineHeight: 28, color: V3.blue },
});
