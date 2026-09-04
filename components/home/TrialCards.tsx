// components/home/TrialCards.tsx
// Trial surfaces on Home (conversion playbook §5: convert at real ride
// moments with in-app cards, never push): the trial line, the loss-framed
// near-end card, the post-downgrade "history is waiting" card, and the
// meter-stall card. Every card is honest and crisp (§3), one primary action.
import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { StyleSheet, View } from "react-native";
import { Body, Card, Label, Small, StoryRow } from "../v3/primitives";
import { interFont, V3 } from "../v3/theme";
import { trialLine, trialRidesLeft, type Entitlement } from "../../lib/entitlement";

export function TrialLine({ e }: { e: Entitlement }) {
  const line = trialLine(e);
  if (!line) return null;
  return (
    <View style={styles.line}>
      <Ionicons name="flash" size={13} color={V3.blue} />
      <Small style={{ color: V3.blue, ...interFont(600) }}>{line}</Small>
    </View>
  );
}

export function TrialEndingCard({ e, onKeep }: { e: Entitlement; onKeep: () => void }) {
  const rides = trialRidesLeft(e);
  return (
    <Card variant="callout" onPress={onKeep} accessibilityLabel="Keep Pro">
      <Label style={{ color: V3.blue, marginBottom: 8 }}>{rides <= 1 ? "One more Pro ride day" : "Pro trial ending"}</Label>
      <Body>After it, clicker suggestions pause. Your setup story keeps saving.</Body>
      <Small style={{ marginTop: 6 }}>Your bike, its baseline, and a fresh one whenever you want stay free.</Small>
      <Small style={{ color: V3.blue, marginTop: 10, ...interFont(600) }}>Keep Pro · about $1 per ride day →</Small>
    </Card>
  );
}

export function HistoryWaitingCard({ versions, onOpen }: { versions: number; onOpen: () => void }) {
  const hidden = Math.max(0, versions - 1);
  return (
    <Card onPress={onOpen} accessibilityLabel="Your setup story is waiting">
      <Label style={{ marginBottom: 12 }}>Your story is still saving</Label>
      <StoryRow v="v1" text="Baseline tune" date="" current />
      <StoryRow v={`+${hidden}`} text={`${hidden} ${hidden === 1 ? "version" : "versions"}, every reason attached`} locked last />
      <Small style={{ marginTop: 8 }}>Pro opens all of it, plus the next clicker change.</Small>
    </Card>
  );
}

export function MeterStallCard({ line, onOpen }: { line: string; onOpen: () => void }) {
  return (
    <Card variant="callout" onPress={onOpen} accessibilityLabel="Finish dialing it">
      <Label style={{ color: V3.blue, marginBottom: 8 }}>Stuck here?</Label>
      <Body>{line}</Body>
      <Small style={{ color: V3.blue, marginTop: 10, ...interFont(600) }}>Finish dialing it →</Small>
    </Card>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -6, marginBottom: 12 },
});
