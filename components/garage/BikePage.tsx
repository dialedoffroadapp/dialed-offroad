// components/garage/BikePage.tsx
// The per-bike page (design/mockups/04): brand eyebrow with fork type,
// model headline, identity card (photo, dialed %, bar, caption), two stat
// tiles, SETUPS list (running bordered + badged, dashed New setup = Pro),
// SETUP STORY card with the two most-changed circuits, and the "Coming to
// your garage" rows shown as "soon" only, never zero bars.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../Toast";
import { Bar, Big, Card, ComingRow, Eyebrow, H1, Label, PhotoTile, Row, SetupRow, Small, Tile } from "../v3/primitives";
import { useV3Fonts, V3 } from "../v3/theme";
import { HoursSheet, NewSetupSheet, TiresSheet } from "./GarageSheets";
import { mostChangedCircuits, GRAPH_LABELS, VersionGraph } from "./VersionGraph";
import { nextOilAt, oilIntervalFor, saveBikeExtras } from "../../lib/bikeExtras";
import { pickAndUploadBikePhoto } from "../../lib/bikePhoto";
import { createNamedSetup, runningSetup } from "../../lib/bikeSetups";
import { meterCaption } from "../../lib/dialedMeter";
import { loadBikePage, loadBikes, loadUserAndPro, type BikePageData } from "../../lib/garageV3";
import { shortDate } from "../../lib/homeCopy";
import { gateIfLocked, showProGate } from "../../lib/proGate";
import { logEvent } from "../../lib/usage";

export const SETUP_SHEET_ROUTE = "/setup-sheet";
export const STORY_ROUTE = "/setup-story";
export const TUNE_ROUTE = "/(tabs)/tune";

export function BikePage({ bikeId, inTab }: { bikeId: string; inTab?: boolean }) {
  useV3Fonts();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<BikePageData | null>(null);
  const [missing, setMissing] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [tiresOpen, setTiresOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { userId, isPro } = await loadUserAndPro();
      if (!userId) return setMissing(true);
      const bikes = await loadBikes(userId);
      const bike = bikes.find((b) => b.id === bikeId) ?? null;
      if (!bike) return setMissing(true);
      const page = await loadBikePage(bike);
      setData({ userId, isPro, ...page });
    } catch (e) {
      console.warn("[garage-v3] bike page load failed", e);
    }
  }, [bikeId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return undefined;
    }, [load])
  );

  if (missing) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Small>That bike isn&apos;t in your garage anymore.</Small>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={V3.steel} />
      </View>
    );
  }

  const { bike, specs, extras, setups, isPro, story, versions } = data;
  const running = runningSetup(setups);
  const asc = [...versions].reverse();
  const circuits = mostChangedCircuits(asc, 2);
  const forkType = specs?.fork_type ?? null;
  const title = [bike.year, bike.model].filter(Boolean).join(" ") || bike.nickname || "Your bike";
  const bikeTitle = [bike.year, bike.make, bike.model].filter(Boolean).join(" ");

  const gatePro = (source: string, trigger: "setup_history" | "second_setup" = "setup_history"): boolean => {
    if (isPro) return true;
    void logEvent("history_gate_hit", { bike_id: bike.id, version_count: versions.length, source, paywall_trigger_action: trigger });
    showProGate({ trigger, bikeId: bike.id, hasBaseline: versions.length > 0 });
    return false;
  };

  const openStory = () => {
    void logEvent("story_opened", { bike_id: bike.id, versions: versions.length, source: "bike_page" });
    if (!gatePro("bike_page_story")) return;
    router.push({ pathname: STORY_ROUTE, params: { bikeId: bike.id } } as never);
  };

  const onPhoto = async () => {
    if (photoBusy || !data.userId) return;
    setPhotoBusy(true);
    const res = await pickAndUploadBikePhoto(data.userId, bike.id);
    setPhotoBusy(false);
    if (res.status === "ok") setData({ ...data, photoUrl: res.url });
    else if (res.status === "failed") toast.show(res.message, { kind: "error" });
  };

  const hoursValue = extras.hours !== null ? extras.hours.toFixed(1) : "—";
  const tiresValue = extras.tireFrontPsi !== null && extras.tireRearPsi !== null ? `${trim(extras.tireFrontPsi)} / ${trim(extras.tireRearPsi)}` : "—";

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + (inTab ? 16 : 10), paddingBottom: 40 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <Row style={{ marginBottom: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {!inTab ? (
              <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
                <Ionicons name="arrow-back" size={20} color={V3.steel} />
              </Pressable>
            ) : null}
            <Eyebrow brand={bike.make} style={{ marginBottom: 0 }}>
              {[bike.make, forkType].filter(Boolean).join(" · ")}
            </Eyebrow>
          </View>
          <Pressable onPress={() => router.push("/(tabs)/garage" as never)} hitSlop={12} accessibilityRole="button" accessibilityLabel="More">
            <Ionicons name="ellipsis-horizontal" size={18} color={V3.steel} />
          </Pressable>
        </Row>
        <H1>{title}</H1>

        <Card>
          <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
            <PhotoTile size={64} onPress={onPhoto} caption={data.photoUrl ? undefined : undefined}>
              {data.photoUrl ? <Image source={{ uri: data.photoUrl }} style={{ width: 64, height: 64 }} /> : undefined}
            </PhotoTile>
            <View style={{ flex: 1 }}>
              <Row>
                <Label>Dialed</Label>
                <Big size="lg">{versions.length ? data.meterPct : 0}%</Big>
              </Row>
              <Bar pct={versions.length ? data.meterPct : 0} style={{ marginTop: 8, marginBottom: 6 }} />
              <Small>{versions.length ? meterCaption(data.meterCategories) : "No baseline yet. Build a tune to start."}</Small>
            </View>
          </View>
        </Card>

        <View style={styles.tiles}>
          <Tile label="Engine hrs" value={hoursValue} sub={extras.hours !== null ? `oil at ${trim(nextOilAt(extras))}` : "tap to set"} onPress={() => setHoursOpen(true)} muted={extras.hours === null} />
          <Tile label="Tires" value={tiresValue} sub={extras.tireFrontPsi !== null ? "psi front / rear" : "tap to set"} onPress={() => void gateIfLocked({ trigger: "tire_pressure", bikeId: bike.id, hasBaseline: versions.length > 0 }).then((ok) => ok && setTiresOpen(true))} muted={extras.tireFrontPsi === null} />
        </View>

        <Label style={{ marginBottom: 8 }}>Setups</Label>
        {setups.map((s) => {
          const v = s.running;
          const sub = v
            ? s.isRunning
              ? `v${v.version_number} · ${n(v.fork_comp_clicks)}/${n(v.fork_reb_clicks)} · ${n(v.shock_lsc_clicks)}/${hsc(v.shock_hsc_turns)}/${n(v.shock_reb_clicks)}`
              : [s.terrain?.toLowerCase(), v ? `v${v.version_number}` : null, shortDate(new Date(v.created_at))].filter(Boolean).join(" · ")
            : "no versions yet";
          const locked = !isPro && s.id !== null;
          return (
            <SetupRow
              key={s.id ?? "default"}
              title={s.name}
              sub={sub}
              running={s.isRunning}
              badge={s.isRunning ? "running" : undefined}
              locked={locked}
              onPress={() => {
                if (locked && !gatePro("named_setup", "second_setup")) return;
                router.push({ pathname: SETUP_SHEET_ROUTE, params: { bikeId: bike.id, setupId: s.id ?? "default" } } as never);
              }}
            />
          );
        })}
        <Card variant="dashed" style={{ paddingVertical: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }} onPress={() => gatePro("second_setup", "second_setup") && setNewOpen(true)} accessibilityLabel="New setup, Pro">
          <Ionicons name="add" size={16} color={V3.blue} />
          <Small style={{ fontSize: 13 }}>New setup</Small>
          {!isPro ? <Ionicons name="lock-closed" size={12} color={V3.steel} /> : null}
        </Card>

        {versions.length ? (
          <Card onPress={openStory} accessibilityLabel="Setup story">
            <Row style={{ marginBottom: 8 }}>
              <Label>Setup story · {versions.length} {versions.length === 1 ? "version" : "versions"}</Label>
              <Ionicons name={isPro ? "chevron-forward" : "lock-closed"} size={16} color={V3.steel} />
            </Row>
            <VersionGraph versionsAsc={asc} circuits={circuits} runningId={running?.running?.id ?? versions[0]?.id} />
            <View style={{ flexDirection: "row", gap: 14, marginTop: 6 }}>
              <Small style={{ color: V3.blue }}>● {GRAPH_LABELS[circuits[0]]}</Small>
              {circuits[1] ? <Small>● {GRAPH_LABELS[circuits[1]]}</Small> : null}
            </View>
            {!isPro ? <Small style={{ marginTop: 8 }}>Already recording. Pro opens every version, every reason.</Small> : null}
          </Card>
        ) : null}

        <Label style={{ marginBottom: 8 }}>Coming to your garage</Label>
        <Card style={{ paddingVertical: 4 }}>
          <ComingRow label="Gearing" right="soon" />
          <ComingRow label="Jetting and premix" right="2-strokes" />
          <ComingRow label="Spring rate check" right="soon" last />
        </Card>
      </ScrollView>

      <HoursSheet
        key={`h-${hoursOpen}`}
        open={hoursOpen}
        onClose={() => setHoursOpen(false)}
        hours={extras.hours}
        intervalHours={oilIntervalFor(extras)}
        lastServiceHours={extras.lastServiceHours}
        onSave={async (p) => {
          setHoursOpen(false);
          const next = await saveBikeExtras(bike.id, { hours: p.hours, maintenanceIntervalHours: p.intervalHours, lastServiceHours: p.lastServiceHours });
          setData({ ...data, extras: next });
        }}
      />
      <TiresSheet
        key={`t-${tiresOpen}`}
        open={tiresOpen}
        onClose={() => setTiresOpen(false)}
        front={extras.tireFrontPsi}
        rear={extras.tireRearPsi}
        onSave={async (p) => {
          setTiresOpen(false);
          const next = await saveBikeExtras(bike.id, { tireFrontPsi: p.front, tireRearPsi: p.rear });
          setData({ ...data, extras: next });
        }}
      />
      <NewSetupSheet
        key={`n-${newOpen}`}
        open={newOpen}
        onClose={() => setNewOpen(false)}
        fromVersionLabel={running?.running ? `${running.name} v${running.running.version_number}` : null}
        onCreate={async (p) => {
          setNewOpen(false);
          const res = await createNamedSetup({ bikeId: bike.id, name: p.name, terrain: p.terrain, from: running?.running ?? null });
          toast.show(res.serverOk ? `${p.name} created. Build its tune.` : `${p.name} saved on this phone. Syncs after the next update.`, { kind: res.serverOk ? "success" : "info" });
          void load();
          // Door into the relocated Tune flow: bike + setup + terrain pre-filled.
          // A local_* setup id (offline) is dropped by the version writer, so the
          // baseline lands on the default setup until sync; acceptable.
          router.push({
            pathname: TUNE_ROUTE,
            params: {
              bikeId: bike.id,
              setupId: res.setup.id,
              ...(p.terrain ? { prefill: encodeURIComponent(JSON.stringify({ terrain: p.terrain })) } : {}),
            },
          } as never);
        }}
      />
      {photoBusy ? (
        <View style={styles.busy} pointerEvents="none">
          <ActivityIndicator color={V3.blue} />
        </View>
      ) : null}
      {/* bikeTitle is used by sub-routes via params; kept for share later */}
      <View style={{ height: 0 }} accessibilityElementsHidden>{null}</View>
    </View>
  );
}

const n = (x: number | null) => (typeof x === "number" ? String(Math.round(x)) : "—");
const hsc = (x: number | null) => (typeof x === "number" ? (Number.isInteger(x) ? `${x}.0` : String(x)) : "—");
const trim = (x: number) => (Number.isInteger(x) ? String(x) : String(x));

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: V3.carbon },
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: V3.screenPadX },
  tiles: { flexDirection: "row", gap: 10, marginBottom: 12 },
  busy: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(11,12,16,0.5)" },
});
