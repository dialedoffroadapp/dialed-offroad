// The Profile screen's Rider section (rider profiles, 2026-09-08): weight,
// unit, skill, class, default discipline. Editing changes the DEFAULTS only;
// tunes already built keep their numbers. Guests see nothing.
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useToast } from "../Toast";
import { useTheme } from "../../lib/theme";
import { SKILL_OPTIONS, type QuizSkillId } from "../../lib/quizOnboarding";
import { CLASS_LABEL, CLASS_OPTIONS, fetchActiveRiderProfile, saveRiderProfile, type RiderClass, type RiderProfile } from "../../lib/riderProfile";

type Draft = { weight: string; unit: "lbs" | "kg"; skill: QuizSkillId | null; klass: RiderClass | null; discipline: "mx" | "offroad" | null };

function draftOf(p: RiderProfile | null): Draft {
  const w = p?.weight_lbs;
  return {
    weight: typeof w === "number" ? String(p?.unit === "kg" ? Math.round(w / 2.2046) : Math.round(w)) : "",
    unit: p?.unit ?? "lbs",
    skill: p?.skill ?? null,
    klass: p?.class ?? null,
    discipline: p?.discipline_default ?? null,
  };
}

/** Parse the draft's weight into pounds (null = empty or not a number). */
export function draftWeightLbs(weight: string, unit: "lbs" | "kg"): number | null {
  const n = Number(weight.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return unit === "kg" ? Math.round(n * 2.2046 * 10) / 10 : n;
}

export function RiderProfileCard({ style }: { style?: object }) {
  const { colors } = useTheme();
  const toast = useToast();
  const [profile, setProfile] = useState<RiderProfile | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(draftOf(null));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchActiveRiderProfile().then((p) => {
      if (!alive) return;
      setProfile(p);
      setDraft(draftOf(p));
    });
    return () => {
      alive = false;
    };
  }, []);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(draftOf(profile ?? null)), [draft, profile]);

  if (profile === undefined) return null;

  const onSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const saved = await saveRiderProfile({
        weight_lbs: draftWeightLbs(draft.weight, draft.unit),
        unit: draft.unit,
        skill: draft.skill,
        class: draft.klass,
        discipline_default: draft.discipline,
      });
      if (saved) {
        setProfile(saved);
        setDraft(draftOf(saved));
        toast.show("Rider profile saved", { kind: "success" });
      }
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't save your rider profile.", { kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  const chip = (label: string, on: boolean, onPress: () => void, testID?: string) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} testID={testID} style={[styles.chip, { borderColor: on ? colors.ACCENT : colors.BORDER, backgroundColor: on ? colors.ACCENT : "transparent" }]}>
      <Text style={[styles.chipText, { color: on ? "#fff" : colors.TEXT }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.card, { backgroundColor: colors.CARD, borderColor: colors.BORDER }, style]} testID="rider-profile-card">
      <Text style={[styles.sectionLabel, { color: colors.MUTED }]}>RIDER</Text>
      <Text style={[styles.label, { color: colors.MUTED }]}>Weight, geared up</Text>
      <View style={styles.row}>
        <TextInput
          value={draft.weight}
          onChangeText={(t) => setDraft((d) => ({ ...d, weight: t.replace(/[^0-9.,]/g, "") }))}
          keyboardType="decimal-pad"
          placeholder={draft.unit === "kg" ? "73" : "160"}
          placeholderTextColor={colors.MUTED}
          style={[styles.input, { color: colors.TEXT, borderColor: colors.BORDER }]}
          testID="rider-profile-weight"
        />
        <View style={styles.chips}>
          {chip("lb", draft.unit === "lbs", () => setDraft((d) => ({ ...d, unit: "lbs" })))}
          {chip("kg", draft.unit === "kg", () => setDraft((d) => ({ ...d, unit: "kg" })))}
        </View>
      </View>
      <Text style={[styles.label, { color: colors.MUTED }]}>How hard you push</Text>
      <View style={styles.chips}>{SKILL_OPTIONS.map((o) => chip(o.label, draft.skill === o.id, () => setDraft((d) => ({ ...d, skill: o.id })), `rider-profile-skill-${o.id}`))}</View>
      <Text style={[styles.label, { color: colors.MUTED }]}>Class</Text>
      <View style={styles.chips}>{CLASS_OPTIONS.map((c) => chip(CLASS_LABEL[c], draft.klass === c, () => setDraft((d) => ({ ...d, klass: c })), `rider-profile-class-${c}`))}</View>
      <Text style={[styles.label, { color: colors.MUTED }]}>Default discipline</Text>
      <View style={styles.chips}>
        {chip("Motocross", draft.discipline === "mx", () => setDraft((d) => ({ ...d, discipline: "mx" })))}
        {chip("Off-road", draft.discipline === "offroad", () => setDraft((d) => ({ ...d, discipline: "offroad" })))}
      </View>
      <Text style={[styles.helper, { color: colors.MUTED }]}>Editing changes your defaults for the next bike only. Tunes you already built keep the numbers they were built with.</Text>
      <Pressable onPress={() => void onSave()} disabled={!dirty || saving} accessibilityRole="button" style={[styles.save, { backgroundColor: dirty ? colors.ACCENT : colors.BORDER }]} testID="rider-profile-save">
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={[styles.saveText, { color: dirty ? "#fff" : colors.MUTED }]}>{dirty ? "Save" : "Saved"}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16 },
  sectionLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 1, marginBottom: 12 },
  label: { fontSize: 13, marginTop: 10, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 13, fontWeight: "600" },
  helper: { fontSize: 12, marginTop: 12, lineHeight: 17 },
  save: { marginTop: 12, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  saveText: { fontSize: 15, fontWeight: "700" },
});
