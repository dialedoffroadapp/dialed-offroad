// components/LoopPreview.tsx
// Workstream D: the Ride & Refine loop, shown as a faux 3-entry setup
// timeline BEFORE the paywall/signup. Rendered on the locked results screen
// (between the why-teaser and the unlock CTA) and reused as Slide 2's visual
// in onboarding — one component so the two surfaces stay identical.
//
// This is a PREVIEW, not the rider's data: entries are hardcoded examples,
// the rail is faded, and the header carries a PREVIEW tag so it can't be
// mistaken for real history. Visually rhymes with the real timeline in
// app/setup-history.tsx (version badge + trigger line) without importing
// its data-bound rows.
//
// Copy note: entry strings are the approved working set (WS-D fork 1/3);
// swap DEFAULT_LOOP_PREVIEW_ENTRIES in ONE place to update both surfaces.
// No em dashes in any user-facing string (copy rule).

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../lib/theme";

export type LoopPreviewEntry = {
  /** Version badge label, e.g. "v1". */
  version: string;
  /** One-line cause-and-effect entry a rider recognizes. */
  text: string;
};

export const DEFAULT_LOOP_PREVIEW_ENTRIES: LoopPreviewEntry[] = [
  { version: "v1", text: "Baseline set for your weight and bike" },
  { version: "v2", text: "Softened compression 2 clicks after braking chatter" },
  { version: "v3", text: "Sag dialed in for 4,800 ft elevation" },
];

export function LoopPreview({
  title = "It learns every time you ride",
  entries = DEFAULT_LOOP_PREVIEW_ENTRIES,
}: {
  title?: string;
  entries?: LoopPreviewEntry[];
}) {
  const { colors: C } = useTheme();
  const S = React.useMemo(() => makeStyles(C), [C]);

  return (
    <View style={S.card}>
      <View style={S.headerRow}>
        <Text style={S.title}>{title}</Text>
        <View style={S.previewTag}>
          <Text style={S.previewTagText}>PREVIEW</Text>
        </View>
      </View>

      {entries.map((e, i) => (
        <View key={e.version} style={S.entryRow}>
          <View style={S.railCol}>
            <View style={S.versionBadge}>
              <Text style={S.versionBadgeText}>{e.version}</Text>
            </View>
            {i < entries.length - 1 ? <View style={S.rail} /> : null}
          </View>
          <Text style={S.entryText}>{e.text}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (C: {
  CARD: string;
  TEXT: string;
  MUTED: string;
  ACCENT: string;
  BORDER: string;
}) =>
  StyleSheet.create({
    card: {
      marginHorizontal: 16,
      marginTop: 12,
      padding: 14,
      borderRadius: 16,
      backgroundColor: C.CARD,
      borderWidth: 1,
      borderColor: C.BORDER,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 12,
      gap: 8,
    },
    title: {
      flex: 1,
      color: C.TEXT,
      fontSize: 15,
      fontWeight: "800",
    },
    previewTag: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: C.BORDER,
    },
    previewTagText: {
      color: C.MUTED,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1,
    },
    entryRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
    },
    railCol: {
      alignItems: "center",
      width: 30,
    },
    versionBadge: {
      minWidth: 30,
      paddingVertical: 3,
      borderRadius: 8,
      alignItems: "center",
      backgroundColor: C.ACCENT + "22",
    },
    versionBadgeText: {
      color: C.ACCENT,
      fontSize: 11,
      fontWeight: "800",
    },
    // Faded connector rail: preview styling, deliberately quieter than the
    // real history timeline.
    rail: {
      width: 2,
      flex: 1,
      minHeight: 14,
      marginVertical: 3,
      borderRadius: 1,
      backgroundColor: C.BORDER,
      opacity: 0.6,
    },
    entryText: {
      flex: 1,
      color: C.TEXT,
      opacity: 0.85,
      fontSize: 13,
      lineHeight: 18,
      paddingBottom: 14,
    },
  });
