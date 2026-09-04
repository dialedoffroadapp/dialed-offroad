// components/home/HomeV3.tsx
// The v3 Home tab (design/mockups/01-home-established.html and
// 02-home-day-one.html), same skeleton in both states. Never shows anything
// the app cannot know: no weather, no conditions, no notification tied to
// the next ride. Rendered by app/(tabs)/index.tsx behind HOME_GARAGE_V3_ENABLED.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { saveSeasonGoal, clearSeasonGoal } from "../../lib/seasonGoals";
import { logEvent } from "../../lib/usage";

// Until the ride-mode workstream lands, Start riding routes to the shipped
// tune flow (PROMPT: "routes to the existing tune flow for now").
const START_RIDING_ROUTE = "/(tabs)/tune";
const SETUP_SHEET_ROUTE = "/setup-sheet";
const STORY_ROUTE = "/setup-story";

export function HomeV3() {
  useV3Fonts();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { data, loading, refresh, patch } = useHomeV3();
  const [goalOpen, setGoalOpen] = useState(false);
  const [rideOpen, setRideOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const now = new Date();

  // home_module_viewed: once per module per focus (analytics-dark until the
  // v3 CHECK migration lands; signed-in only, so no queue hazard).
  const loggedRef = useRef<Set<string>>(new Set());
  useFocusEffect(
    useCallback(() => {
      loggedRef.current = new Set();
      return undefined;
    }, [])
  );
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
    if (data.suggestion) modules.push(["suggestion", data.suggestion.symptom]);
    if (data.dayOne) modules.push(["first_steps", data.versions.length ? "step_2" : "step_1"]);
    for (const [module, state] of modules) {
      if (loggedRef.current.has(module)) continue;
      loggedRef.current.add(module);
      void logEvent("home_module_viewed", { module, state, bike_id: data.bike?.id ?? null });
    }
  }, [data]);

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
      void logEvent("history_gate_hit", { bike_id: data.bike.id, version_count: data.versions.length, source: "home_story" });
      router.push("/premium?source=history_gate" as never);
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

  const { bike, dayOne, running, lastRide, suggestion, goal, seasonStats, nextRideDate, story, isPro } = data;
  const year = seasonYear(now);
  const goalDone = goal?.type === "engine_hours" ? seasonStats.hours ?? 0 : seasonStats.rideDays;
  const primaryLabel = !bike ? "Add a bike" : !running ? "Build a tune" : dayOne ? "Set it on the bike" : "Start riding";
  const onPrimary = () => {
    if (!bike) return router.push("/(tabs)/garage" as never);
    if (!running) return router.push(START_RIDING_ROUTE as never);
    if (dayOne) return router.push({ pathname: SETUP_SHEET_ROUTE, params: { bikeId: bike.id } } as never);
    return router.push(START_RIDING_ROUTE as never);
  };
  const stepIndex = !running ? 1 : dayOne ? 2 : 3;
  const eyebrow = !bike
    ? homeEyebrow(now)
    : dayOne
      ? dayOneEyebrow(now)
      : homeEyebrow(now, lastRide ? { date: lastRide.date, place: lastRide.place } : null);
  const headline = !bike ? "Let's get a bike in the garage" : homeHeadline(bike.model, dayOne);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: 132 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={V3.steel} />}
      >
        <Eyebrow>{eyebrow}</Eyebrow>
        <H1>{headline}</H1>

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
          <Label>{setupEyebrow(bike?.model, running ? (running.source === "baseline" && data.versions.length === 1 ? "Baseline" : "MX setup") : null, running?.version_number)}</Label>
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
