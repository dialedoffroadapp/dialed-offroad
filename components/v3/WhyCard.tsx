// "Why this setup" card (device pass finding 6, 2026-09-08): title, the
// first two sentences, "Read more" expands the rest in place. Replaces the
// collapsed link on the reveal and sits under the values on the setup sheet.
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { splitWhy } from "../../lib/whyCopy";
import { V3 } from "./theme";

export type WhyCardColors = { bg: string; border: string; text: string; muted: string; link: string };

export const WHY_CARD_V3: WhyCardColors = { bg: V3.panel, border: V3.line, text: V3.white, muted: V3.steel, link: V3.blue };

export function WhyCard({ text, colors = WHY_CARD_V3, onExpand, testID = "why-card" }: { text: string; colors?: WhyCardColors; onExpand?: () => void; testID?: string }) {
  const [open, setOpen] = useState(false);
  const { lead, rest } = splitWhy(text);
  if (!lead) return null;
  return (
    <View style={[styles.card, { backgroundColor: colors.bg, borderColor: colors.border }]} testID={testID}>
      <Text style={[styles.title, { color: colors.muted }]}>Why this setup</Text>
      <Text style={[styles.body, { color: colors.text }]} testID="why-card-lead">{lead}</Text>
      {open && rest ? <Text style={[styles.body, { color: colors.text, marginTop: 8 }]} testID="why-card-rest">{rest}</Text> : null}
      {rest ? (
        <Pressable
          onPress={() => {
            setOpen((o) => !o);
            if (!open) onExpand?.();
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          hitSlop={8}
          style={styles.more}
          testID="why-card-toggle"
        >
          <Text style={[styles.moreText, { color: colors.link }]}>{open ? "Show less" : "Read more"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 14 },
  title: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 },
  body: { fontSize: 15, lineHeight: 22 },
  more: { marginTop: 8, alignSelf: "flex-start" },
  moreText: { fontSize: 14, fontWeight: "600" },
});
