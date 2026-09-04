// app/ride/track.tsx — Track picker (design/mockups/ride/03): search-or-name
// at the top, Recent with a per-track story line, Nearby from match_tracks,
// "New track here" (one coarse location read). Free text always works.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Eyebrow, Label, Small } from "../../components/v3/primitives";
import { interFont, V3 } from "../../components/v3/theme";
import { PickCard, RideH1, RideScreenBg } from "../../components/ride/ridePrimitives";
import { readDraft, readOpenSession, writeDraft, writeSession } from "../../lib/rideDay";
import { createTrackHere, formatDistance, nearbyTracks, recentTracks, type TrackChoice } from "../../lib/tracks";
import { logEvent } from "../../lib/usage";

export default function RideTrackScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const sessionMode = mode === "session";
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<TrackChoice[]>([]);
  const [nearby, setNearby] = useState<TrackChoice[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await readDraft();
      if (alive) setCurrentId(d.trackId ?? (d.trackName ? `name:${d.trackName.toLowerCase()}` : null));
      const r = await recentTracks();
      if (alive) setRecent(r);
      const n = await nearbyTracks();
      if (alive) setNearby(n.filter((t) => !r.some((x) => x.id && x.id === t.id)));
    })();
    return () => {
      alive = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const filteredRecent = useMemo(() => (q ? recent.filter((t) => t.name.toLowerCase().includes(q)) : recent), [recent, q]);
  const filteredNearby = useMemo(() => (q ? nearby.filter((t) => t.name.toLowerCase().includes(q)) : nearby), [nearby, q]);

  const choose = async (t: TrackChoice, source: string) => {
    if (t.id) void logEvent("track_match_confirmed", { track_id: t.id, source });
    if (sessionMode) {
      // Mid-day "New track": update the open session, then re-enter
      // conditions for the new dirt (retune re-runs the rules from there).
      const open = await readOpenSession();
      if (open) await writeSession({ ...open, trackId: t.id, trackName: t.name });
      router.replace({ pathname: "/ride/conditions", params: { mode: "session" } } as never);
      return;
    }
    const d = await readDraft();
    await writeDraft({ ...d, trackId: t.id, trackName: t.name });
    router.back();
  };

  const useFreeText = async () => {
    if (!query.trim()) return;
    await choose({ id: null, name: query.trim(), rides: 0, setupName: null }, "free_text");
  };

  const newHere = async () => {
    if (creating) return;
    const name = query.trim();
    if (!name) return;
    setCreating(true);
    const t = await createTrackHere(name);
    setCreating(false);
    await choose(t, "created");
  };

  return (
    <View style={RideScreenBg({})}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 24 + insets.bottom }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color={V3.steel} />
          </Pressable>
          <Eyebrow style={{ marginBottom: 0 }}>Track</Eyebrow>
        </View>
        <RideH1>Where are you riding?</RideH1>

        <View style={styles.search}>
          <Ionicons name="search" size={20} color={V3.steel} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search or name a track"
            placeholderTextColor={V3.steel}
            style={[styles.searchInput, interFont(400)]}
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => void useFreeText()}
          />
        </View>
        {q && filteredRecent.length === 0 && filteredNearby.length === 0 ? (
          <PickCard title={`Use "${query.trim()}"`} onPress={() => void useFreeText()} icon="checkmark" iconColor={V3.blue} />
        ) : null}

        {filteredRecent.length ? <Label style={styles.section}>Recent</Label> : null}
        {filteredRecent.map((t) => (
          <PickCard
            key={t.id ?? t.name}
            title={t.name}
            on={currentId === (t.id ?? `name:${t.name.toLowerCase()}`)}
            onPress={() => void choose(t, "recent")}
            icon={t.setupName ? "bookmark" : null}
            iconColor={V3.blue}
          />
        ))}
        {filteredRecent.map((t) => null)}

        {filteredNearby.length ? <Label style={styles.section}>Nearby</Label> : null}
        {filteredNearby.map((t) => (
          <PickCard
            key={t.id ?? t.name}
            title={t.name}
            onPress={() => void choose(t, "nearby")}
            icon="location-outline"
          />
        ))}

        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => void newHere()}
          disabled={!query.trim() || creating}
          accessibilityRole="button"
          style={[styles.newHere, (!query.trim() || creating) && { opacity: 0.6 }]}
        >
          <Ionicons name="add" size={16} color={V3.blue} />
          <Small style={{ fontSize: 14 }}>
            {query.trim() ? `New track "${query.trim()}" here (uses your location once)` : "New track here (name it above; uses your location once)"}
          </Small>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: V3.screenPadX, flexGrow: 1 },
  top: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  search: { backgroundColor: V3.panel, borderRadius: 16, minHeight: 56, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  searchInput: { flex: 1, color: V3.white, fontSize: 16, paddingVertical: 12 },
  section: { marginTop: 6, marginBottom: 8 },
  newHere: { borderWidth: 1, borderStyle: "dashed", borderColor: V3.line, borderRadius: 16, padding: 16, minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10 },
});
