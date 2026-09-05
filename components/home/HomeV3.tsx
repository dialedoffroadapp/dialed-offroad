// components/home/HomeV3.tsx
// The v3 Home tab (design/mockups/01-home-established.html and
// 02-home-day-one.html), same skeleton in both states. Never shows anything
// the app cannot know: no weather, no conditions, no notification tied to
// the next ride. Rendered by app/(tabs)/index.tsx behind HOME_GARAGE_V3_ENABLED.
import { startGarageQuizFlow } from "../../lib/quizOnboarding";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hasSetOnBike, walkthroughSeen } from "../../lib/firstSteps";
import { useToast } from "../Toast";
import { Bar, Big, Body, Button, Card, Divider, Eyebrow, H1, Label, PhotoTile, Row, Small, Step, Sub } from "../v3/primitives";
import { interFont, useV3Fonts, V3 } from "../v3/theme";
import { GoalSheet, NextRideSheet } from "./HomeSheets";
import { NextRideCard, SeasonGoalCard, SeasonStatsCard, SetupStoryCard, SuggestionCard } from "./HomeModules";
import { oilIntervalFor } from "../../lib/bikeExtras";
import { pickAndUploadBikePhoto } from "../../lib/bikePhoto";
import { meterHeroLine } from "../../lib/dialedMeter";
import { dayOneEyebrow, daysBetween, homeEyebrow, homeHeadline, seasonYear, setupEyebrow, valuesSummary } from "../../lib/homeCopy";
import { useHomeV3 } from "../../lib/homeV3";
import { dateToIso, saveNextRideDate } from "../../lib/nextRide";
import { readEndedUnarchived, readOpenSession, readHistory } from "../../lib/rideDay";
import { isEntitled, maybeStartLaunchTrial, resolveEntitlement, subscribeEntitlement, trialNearEnd, type Entitlement, FREE_ENTITLEMENT } from "../../lib/entitlement";
import { emitLifecycleEvent } from "../../lib/lifecycle";
import { meterStalled, stallLine } from "../../lib/meterStall";
import { pricingHref, showProGate } from "../../lib/proGate";
import { HistoryWaitingCard, MeterStallCard, TrialEndingCard, TrialLine } from "./TrialCards";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { saveSeasonGoal, clearSeasonGoal } from "../../lib/seasonGoals";
import { logEvent } from "../../lib/usage";

// Start riding → the ride-day flow (feat/ride-day-flow). An open session
// lands straight in ride mode (the start screen redirects), so Home stays
// the way back into a ride in progress.
const START_RIDING_ROUTE = "/ride/start";
const SETUP_SHEET_ROUTE = "/setup-sheet";
const WALKTHROUGH_ROUTE = "/set-on-bike";
const STORY_ROUTE = "/setup-story";

export function HomeV3() {
  useV3Fonts();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [setOnBike, setSetOnBike] = useState(false);
  const { data, loading, refresh, patch } = useHomeV3();
  const [goalOpen, setGoalOpen] = useState(false);
  const [rideOpen, setRideOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [ent, setEnt] = useState<Entitlement>(FREE_ENTITLEMENT);
  const [rideMeters, setRideMeters] = useState<(number | null | undefined)[]>([]);
  const now = new Date();

  // Entitlement (server-resolved, cached): trial line / near-end / downgrade
  // surfaces, plus the 3.0-launch trial for existing free accounts (River:
  // "Pro is on for your next 3 rides"). Lifecycle first_session once.
  useEffect(() => subscribeEntitlement(setEnt), []);
  useEffect(() => {
    if (!data?.userId) return;
    let alive = true;
    (async () => {
      const launched = await maybeStartLaunchTrial(data.userId!);
      if (launched?.state === "trial_active" && alive) toast.show(`Pro is on for your next ${launched.trialRideDayLimit} rides.`, { kind: "success" });
      const e = await resolveEntitlement();
      if (alive) setEnt(e);
      const history = await readHistory();
      if (alive) setRideMeters(history.map((h) => h.meterPct));
      try {
        const k = `dialed_first_session_v1:${data.userId}`;
        if (!(await AsyncStorage.getItem(k))) {
          await AsyncStorage.setItem(k, "1");
          void emitLifecycleEvent("first_session", { bike: data.bike?.model ?? null });
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.userId]);

  // home_module_viewed: once per module per focus (analytics-dark until the
  // v3 CHECK migration lands; signed-in only, so no queue hazard).
  const loggedRef = useRef<Set<string>>(new Set());
  // First Steps step 2 lives in local storage; the walkthrough's "Bike's set"
  // beat lands here, so re-read it on every focus (data alone doesn't change).
  const bikeIdRef = useRef<string | null>(null);
  useEffect(() => {
    bikeIdRef.current = data?.bike?.id ?? null;
  }, [data?.bike?.id]);
  useFocusEffect(
    useCallback(() => {
      loggedRef.current = new Set();
      void hasSetOnBike(bikeIdRef.current).then(setSetOnBike);
      // Ride mode is a persistent takeover: an open session (survives app
      // kill and reboot) lands straight back in it.
      void readOpenSession().then(async (open) => {
        if (open) return router.replace("/ride/mode" as never);
        // Ended but never settled/archived (killed on End ride, Android back,
        // the forgotten-session prompt): finish it before anything else.
        if (await readEndedUnarchived()) router.replace("/ride/end" as never);
      });
      return undefined;
    }, [router])
  );
  useEffect(() => {
    let alive = true;
    void hasSetOnBike(data?.bike?.id).then((v) => alive && setSetOnBike(v));
    return () => {
      alive = false;
    };
  }, [data?.bike?.id, data]);
  useEffect(() => {
    if (!data?.userId) return;
    const modules: [string, string][] = [
      ["glance", data.dayOne ? "day_one" : "established"],
      ["start_riding", data.dayOne ? "set_it" : "start"],
      ["season_goal", data.goal ? "set" : "empty"],
      ["season_stats", data.seasonStats.ridesLogged > 0 ? "data" : "empty"],
      ["next_ride", data.nextRideDate ? "set" : "empty"],
      ["setup_story", data.story.length ? (data.isPro ? "full" : "locked") : "empty"],
    ];
    if (data.lastRide) modules.push(["last_ride", "data"]);
    modules.push(["entitlement", ent.state]);
    if (data.suggestion) modules.push(["suggestion", data.suggestion.symptom]);
    if (data.dayOne) modules.push(["first_steps", data.versions.length ? "step_2" : "step_1"]);
    for (const [module, state] of modules) {
      if (loggedRef.current.has(module)) continue;
      loggedRef.current.add(module);
      void logEvent("home_module_viewed", { module, state, bike_id: data.bike?.id ?? null });
    }
  }, [data, ent.state]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const onPhoto = async () => {
    if (!data?.userId || !data.bike || photoBusy) return;
    setPhotoBusy(true);
    const res = await pickAndUploadBikePhoto(data.userId, data.bike.id);
    setPhotoBusy(false);
    if (res.status === "ok") patch({ photoUrl: res.url });
    else if (res.status === "failed") toast.show(res.message, { kind: "error" });
  };

  const openStory = () => {
    if (!data?.bike) return;
    void logEvent("story_opened", { bike_id: data.bike.id, versions: data.versions.length, source: "home" });
    if (data.isPro) router.push({ pathname: STORY_ROUTE, params: { bikeId: data.bike.id } } as never);
    else {
      void logEvent("history_gate_hit", { bike_id: data.bike.id, version_count: data.versions.length, source: "home_story", paywall_trigger_action: "setup_history" });
      showProGate({ trigger: "setup_history", bikeId: data.bike.id, hasBaseline: data.versions.length > 0 });
    }
  };

  if (loading && !data) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={V3.steel} />
      </View>
    );
  }
  if (!data) return <View style={styles.root} />;

  const { bike, dayOne, running, lastRide, suggestion, goal, seasonStats, nextRideDate, story } = data;
  const isPro = data.isPro || isEntitled(ent);
  const lockedKeys = ["refined", "consistency"] as const;
  const stalled = meterStalled({ rideDayMeters: rideMeters, categories: data.meterCategories, lockedKeys: [...lockedKeys], state: isPro ? "pro" : ent.state });
  const openPricing = (trigger: "history" | "adjust") => router.push(pricingHref(trigger) as never);
  const year = seasonYear(now);
  const goalDone = goal?.type === "engine_hours" ? seasonStats.hours ?? 0 : seasonStats.rideDays;
  // Day one: step 2 ("set the clickers") is done once the rider has opened
  // the running setup's sheet from here; the primary then moves on to the
  // first ride while the glance card stays ghosted until feedback exists.
  const needsSetOnBike = dayOne && !setOnBike;
  const primaryLabel = !bike ? "Add a bike" : !running ? "Build a tune" : needsSetOnBike ? "Set it on the bike" : "Start riding";
  const onPrimary = () => {
    if (!bike) return router.push("/(tabs)/garage" as never);
    // No running version yet: the Tune flow (relocated into Garage, 3.0) builds the baseline.
    if (!running) {
      void startGarageQuizFlow("regenerate", { bikeId: bike.id, make: bike.make ?? undefined, model: bike.model ?? undefined, year: bike.year ?? undefined }).then((first) => router.push(first as never));
      return;
    }
    if (needsSetOnBike) {
      // First time: the per-adjuster walkthrough (completing marks First Steps
      // step 2; skipping opens the plain sheet). Returning riders go straight
      // to the running setup's clicker sheet.
      void walkthroughSeen(bike.id).then((seen) =>
        router.push({ pathname: seen ? SETUP_SHEET_ROUTE : WALKTHROUGH_ROUTE, params: { bikeId: bike.id, setupId: "default" } } as never)
      );
      return;
    }
    return router.push(START_RIDING_ROUTE as never);
  };
  const stepIndex = !running ? 1 : needsSetOnBike ? 2 : 3;
  const eyebrow = !bike
    ? homeEyebrow(now)
    : dayOne
      ? dayOneEyebrow(now)
      : homeEyebrow(now, lastRide ? { date: lastRide.date, place: lastRide.place } : null);
  const headline = !bike ? "Let's get a bike in the garage" : homeHeadline(bike.model, dayOne);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: 16, paddingBottom: 132 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={V3.steel} />}
      >
        <Eyebrow>{eyebrow}</Eyebrow>
        <H1>{headline}</H1>
        <TrialLine e={ent} />

        {dayOne && bike ? (
          <Card>
            <Row style={{ marginBottom: 14 }}>
              <Label>First steps</Label>
              <Small style={{ color: V3.blue, ...interFont(600) }}>{stepIndex} of 3</Small>
            </Row>
            <Step state={stepIndex > 1 ? "done" : "now"} n={1} text="Get your baseline tune" />
            <Step state={stepIndex > 2 ? "done" : stepIndex === 2 ? "now" : "todo"} n={2} text="Set the clickers on your bike" />
            <Step state={stepIndex === 3 ? "now" : "todo"} n={3} text="Start your first ride at the track" last />
          </Card>
        ) : null}

        {/* Glance card: the hero. Ghosted (dashed) until the first ride. */}
        <Card variant={dayOne ? "dashed" : undefined} style={dayOne && styles.ghostCard}>
          <Row align="flex-start">
            <View style={{ flex: 1 }}>
              <Label>Dialed</Label>
              <Big size="xl" style={dayOne && { opacity: 0.7 }}>
                {running ? data.meterPct : 0}
                <Big size="lg">%</Big>
              </Big>
              <Small style={{ marginTop: 8 }}>{meterHeroLine(data.meterInputs, data.meterPct)}</Small>
            </View>
            <PhotoTile caption={data.photoUrl ? undefined : dayOne ? "add photo" : "your bike"} accent={dayOne} onPress={bike ? onPhoto : undefined}>
              {data.photoUrl ? <Image source={{ uri: data.photoUrl }} style={{ width: 72, height: 72 }} /> : undefined}
            </PhotoTile>
          </Row>
          <Bar pct={running ? data.meterPct : 0} dim={dayOne} />
          <Label>{setupEyebrow(bike?.model, running ? data.runningSetupName ?? "Baseline" : null, running?.version_number)}</Label>
          {running ? (
            <Body weight={500} style={{ marginTop: 4 }}>
              {valuesSummary({
                fork_comp: running.fork_comp_clicks,
                fork_reb: running.fork_reb_clicks,
                shock_lsc: running.shock_lsc_clicks,
                shock_hsc: running.shock_hsc_turns,
                shock_reb: running.shock_reb_clicks,
                shock_sag: running.sag_mm,
              })}
            </Body>
          ) : (
            <Body weight={500} style={{ marginTop: 4, color: V3.steel }}>No numbers yet. Build a tune to fill this in.</Body>
          )}
        </Card>

        {lastRide && !dayOne ? (
          <Card onPress={openStory} accessibilityLabel="Last ride">
            <Label style={{ marginBottom: 8 }}>{lastRide.label}</Label>
            <Body>{lastRide.text}</Body>
            <Sub>{lastRide.sub}</Sub>
          </Card>
        ) : null}

        <Divider />

        {trialNearEnd(ent) ? <TrialEndingCard e={ent} onKeep={() => openPricing("adjust")} /> : null}
        {ent.state === "free" && ent.downgradedAt && data.versions.length > 1 ? (
          <HistoryWaitingCard versions={data.versions.length} onOpen={() => openPricing("history")} />
        ) : null}
        {stalled ? (
          <MeterStallCard line={stallLine(data.meterPct, data.meterCategories, [...lockedKeys])} onOpen={() => openPricing("adjust")} />
        ) : null}

        {suggestion ? <SuggestionCard s={suggestion} /> : null}

        <SeasonGoalCard goal={goal} done={goalDone} now={now} onPress={() => setGoalOpen(true)} />

        <SeasonStatsCard stats={seasonStats} intervalHours={oilIntervalFor(data.extras)} lastServiceHours={data.extras.lastServiceHours} dayOne={dayOne} />

        <NextRideCard date={nextRideDate} now={now} onPress={() => setRideOpen(true)} />

        <SetupStoryCard story={story} isPro={isPro} onPress={openStory} />
      </ScrollView>

      {/* Bottom-docked, oversized, above the tab bar. */}
      <View style={[styles.dock, { paddingBottom: 12 }]}>
        <Button
          label={primaryLabel}
          onPress={onPrimary}
          icon={dayOne && running ? <Ionicons name="options-outline" size={18} color={V3.carbon} /> : undefined}
        />
      </View>

      {data.userId ? (
        <>
          <GoalSheet
            key={`goal-${goalOpen}`}
            open={goalOpen}
            onClose={() => setGoalOpen(false)}
            initial={goal}
            seasonYear={year}
            onSave={async (g) => {
              setGoalOpen(false);
              const saved = await saveSeasonGoal(data.userId!, g);
              patch({ goal: saved });
              void logEvent("goal_set", { type: g.type, target: g.target, season_year: g.seasonYear });
            }}
            onClear={
              goal
                ? async () => {
                    setGoalOpen(false);
                    await clearSeasonGoal(data.userId!, year);
                    patch({ goal: null });
                  }
                : undefined
            }
          />
          <NextRideSheet
            key={`ride-${rideOpen}`}
            open={rideOpen}
            onClose={() => setRideOpen(false)}
            initial={nextRideDate}
            onSave={async (d) => {
              setRideOpen(false);
              await saveNextRideDate(data.userId!, dateToIso(d));
              patch({ nextRideDate: d });
              void logEvent("next_ride_set", { days_out: daysBetween(now, d) });
            }}
            onClear={
              nextRideDate
                ? async () => {
                    setRideOpen(false);
                    await saveNextRideDate(data.userId!, null);
                    patch({ nextRideDate: null });
                  }
                : undefined
            }
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: V3.carbon },
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: V3.screenPadX },
  ghostCard: { opacity: 1 },
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: V3.screenPadX,
    paddingTop: 10,
    backgroundColor: V3.carbon,
  },
});
