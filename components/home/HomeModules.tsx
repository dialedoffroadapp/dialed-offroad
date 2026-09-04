// components/home/HomeModules.tsx
// Below-the-fold Home modules (design/mockups/01 + 02): the callout
// suggestion, season goal, this-season stats, next ride, setup story. Each
// is a pure presentational card; the screen owns data + sheets.
import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Bar, Big, Body, Card, Label, Row, Small, StatRow, StoryRow, Sub } from "../v3/primitives";
import { interFont, V3 } from "../v3/theme";
import { goalProgressLine, goalTitle, maintenanceLine, nextRideLine } from "../../lib/homeCopy";
import type { RideSuggestion } from "../../lib/rideRules";
import type { SeasonGoal } from "../../lib/seasonGoals";
import type { StoryEntry } from "../../lib/setupStory";
import type { SeasonStats } from "../../lib/homeV3";

export function SuggestionCard({ s }: { s: RideSuggestion }) {
  return (
    <Card variant="callout">
      <Label style={{ color: V3.blue, marginBottom: 8 }}>Next time, try this</Label>
      <Body>{s.text}</Body>
      <Sub>{s.sub}</Sub>
    </Card>
  );
}

export function SeasonGoalCard({
  goal,
  done,
  now,
  onPress,
}: {
  goal: SeasonGoal | null;
  /** Progress toward the goal in its own unit (days or hours). */
  done: number;
  now: Date;
  onPress: () => void;
}) {
  if (!goal) {
    return (
      <Card variant="dashed" onPress={onPress} accessibilityLabel="Set a season goal">
        <Row>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Label style={{ marginBottom: 6 }}>Season goal</Label>
            <Body>What&apos;s this season about?</Body>
            <Sub>Ride days, hours, a race. Pick one.</Sub>
          </View>
          <Small style={{ color: V3.blue, ...interFont(600) }}>Set</Small>
        </Row>
      </Card>
    );
  }
  const pct = goal.type === "race" ? 0 : goal.target > 0 ? Math.min(100, (done / goal.target) * 100) : 0;
  const raceDate = goal.raceDate ? new Date(goal.raceDate + "T00:00:00") : null;
  return (
    <Card onPress={onPress} accessibilityLabel="Edit your season goal">
      <Row style={{ marginBottom: 10 }}>
        <Label>Season goal</Label>
        <Small>{goal.seasonYear}</Small>
      </Row>
      <Row>
        <Body>{goalTitle(goal.type, goal.target, goal.raceName)}</Body>
        {goal.type === "race" ? (
          <Big size="md">{raceDate ? `${Math.max(0, Math.round((raceDate.getTime() - now.getTime()) / 86400000))}d` : "—"}</Big>
        ) : (
          <Text style={[styles.goalNum, { color: V3.blue }]}>
            {goal.type === "engine_hours" ? done.toFixed(1) : done}
            <Text style={[styles.goalUnit, interFont(400)]}> / {goal.target}</Text>
          </Text>
        )}
      </Row>
      {goal.type !== "race" ? <Bar pct={pct} /> : <View style={{ height: 8 }} />}
      <Small>{goalProgressLine(goal.type, done, goal.target, now, raceDate)}</Small>
    </Card>
  );
}

export function SeasonStatsCard({
  stats,
  intervalHours,
  lastServiceHours,
  dayOne,
}: {
  stats: SeasonStats;
  intervalHours: number;
  lastServiceHours: number | null;
  dayOne: boolean;
}) {
  const hours = stats.hours ?? 0;
  const maint = maintenanceLine(hours, intervalHours, lastServiceHours ?? 0);
  const zero = dayOne && stats.rideDays === 0 && stats.ridesLogged === 0 && !stats.hours;
  return (
    <Card>
      <Label style={{ marginBottom: 12 }}>This season</Label>
      <StatRow
        stats={[
          { v: String(stats.rideDays), k: "ride days", muted: zero },
          { v: String(stats.ridesLogged), k: "rides logged", muted: zero },
          { v: (stats.hours ?? 0).toFixed(1), k: "engine hrs", muted: zero },
        ]}
      />
      <View style={styles.statsFoot}>
        {maint ? (
          <Small>
            <Ionicons name="water-outline" size={12} color={V3.blue} /> {maint}
          </Small>
        ) : (
          <Small>Starts counting the second you tap Start riding.</Small>
        )}
      </View>
    </Card>
  );
}

export function NextRideCard({ date, now, onPress }: { date: Date | null; now: Date; onPress: () => void }) {
  const line = nextRideLine(now, date);
  if (line.state === "empty" || line.state === "past") {
    return (
      <Card variant="dashed" onPress={onPress} accessibilityLabel="Pick your next ride day">
        <Row>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Label style={{ marginBottom: 6 }}>Next ride</Label>
            <Body>{line.state === "past" ? line.text : "When's the first one?"}</Body>
            <Sub>Count it down. Your setup&apos;s already waiting.</Sub>
          </View>
          <Small style={{ color: V3.blue, ...interFont(600) }}>Pick a day</Small>
        </Row>
      </Card>
    );
  }
  return (
    <Card onPress={onPress} accessibilityLabel="Change your next ride day">
      <Row>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Label style={{ marginBottom: 6 }}>Next ride</Label>
          <Body>{line.text}</Body>
        </View>
        <Big size="md">{line.big}</Big>
      </Row>
    </Card>
  );
}

export function SetupStoryCard({
  story,
  isPro,
  onPress,
}: {
  story: StoryEntry[];
  isPro: boolean;
  onPress: () => void;
}) {
  if (story.length === 0) return null;
  const shown = isPro ? story.slice(0, 4) : story.slice(0, 1);
  const hidden = story.length - shown.length;
  return (
    <Card onPress={onPress} accessibilityLabel="Open the setup story">
      <Label style={{ marginBottom: 12 }}>Setup story</Label>
      {shown.map((e, i) => (
        <StoryRow key={e.id} v={`v${e.v}`} text={e.text} date={e.date} current={i === 0} last={isPro && i === shown.length - 1 && hidden === 0} />
      ))}
      {!isPro ? (
        <StoryRow
          v={story.length === 1 ? "v2" : `+${hidden}`}
          text={story.length === 1 ? "Your first refinement lands here" : `${hidden} more ${hidden === 1 ? "version" : "versions"}, already recorded`}
          locked
          last
        />
      ) : null}
      {isPro ? (
        <Small style={{ color: V3.blue, marginTop: 8 }}>Every version, every reason. Full history in Garage →</Small>
      ) : (
        <Small style={{ marginTop: 6 }}>Chapter one is written. The rest is up to you.</Small>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  goalNum: { fontSize: 26, lineHeight: 28, fontWeight: "900", fontStyle: "italic" },
  goalUnit: { fontSize: 12, color: V3.steel },
  statsFoot: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: V3.hair },
});
