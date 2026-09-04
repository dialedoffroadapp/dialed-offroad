// components/home/HomeSheets.tsx
// The two rider-input sheets Home needs: the season goal (ride days, engine
// hours, or a race) and the next-ride date. No keyboard for numbers; the race
// name is the one text field. Nothing schedules a notification.
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { BottomSheet } from "../v3/BottomSheet";
import { DateChips } from "../v3/DateChips";
import { Button, Chip, Label, Small, Sub } from "../v3/primitives";
import { headingFont, interFont, V3 } from "../v3/theme";
import type { SeasonGoalType } from "../../lib/homeCopy";
import { dateToIso, isoToLocalDate } from "../../lib/nextRide";
import type { SeasonGoal } from "../../lib/seasonGoals";

const GOAL_TYPES: { id: SeasonGoalType; label: string; unit: string; step: number; def: number; min: number; max: number }[] = [
  { id: "ride_days", label: "Ride days", unit: "days", step: 1, def: 20, min: 1, max: 200 },
  { id: "engine_hours", label: "Engine hours", unit: "hours", step: 5, def: 50, min: 5, max: 500 },
  { id: "race", label: "A race", unit: "", step: 0, def: 0, min: 0, max: 0 },
];

function Stepper({ value, onChange, step, min, max, unit }: { value: number; onChange: (v: number) => void; step: number; min: number; max: number; unit: string }) {
  const bump = (d: number) => {
    const next = Math.max(min, Math.min(max, value + d));
    if (next !== value) {
      void Haptics.selectionAsync().catch(() => {});
      onChange(next);
    }
  };
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => bump(-step)} accessibilityRole="button" accessibilityLabel="Less" style={styles.stepBtn}>
        <Ionicons name="remove" size={22} color={V3.steel} />
      </Pressable>
      <Text style={[styles.stepValue, headingFont()]}>
        {value}
        <Text style={[styles.stepUnit, interFont(400)]}> {unit}</Text>
      </Text>
      <Pressable onPress={() => bump(step)} accessibilityRole="button" accessibilityLabel="More" style={styles.stepBtn}>
        <Ionicons name="add" size={22} color={V3.steel} />
      </Pressable>
    </View>
  );
}

export function GoalSheet({
  open,
  onClose,
  initial,
  seasonYear,
  onSave,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  initial: SeasonGoal | null;
  seasonYear: number;
  onSave: (goal: Omit<SeasonGoal, "updatedAt">) => void;
  onClear?: () => void;
}) {
  const [type, setType] = useState<SeasonGoalType>(initial?.type ?? "ride_days");
  const def = GOAL_TYPES.find((g) => g.id === type)!;
  const [target, setTarget] = useState<number>(initial?.type === type && initial.target ? initial.target : def.def);
  const [raceName, setRaceName] = useState(initial?.raceName ?? "");
  const [raceDate, setRaceDate] = useState<Date | null>(isoToLocalDate(initial?.raceDate));

  const pickType = (t: SeasonGoalType) => {
    setType(t);
    const d = GOAL_TYPES.find((g) => g.id === t)!;
    setTarget(initial?.type === t && initial.target ? initial.target : d.def);
  };

  const canSave = type === "race" ? raceName.trim().length > 0 : target > 0;

  return (
    <BottomSheet open={open} onClose={onClose} title="Season goal">
      <Sub style={{ marginTop: 0, marginBottom: 14 }}>What&apos;s {seasonYear} about? Ride days, hours, a race. Pick one.</Sub>
      <View style={styles.chips}>
        {GOAL_TYPES.map((g) => (
          <Chip key={g.id} label={g.label} on={type === g.id} onPress={() => pickType(g.id)} />
        ))}
      </View>
      {type === "race" ? (
        <View style={{ marginTop: 18 }}>
          <Label style={{ marginBottom: 8 }}>Race</Label>
          <TextInput
            value={raceName}
            onChangeText={setRaceName}
            placeholder="Which one?"
            placeholderTextColor={V3.muted}
            style={[styles.input, interFont(500)]}
            maxLength={60}
            autoCorrect={false}
          />
          <View style={{ marginTop: 16 }}>
            <DateChips value={raceDate} onChange={setRaceDate} />
          </View>
        </View>
      ) : (
        <View style={{ marginTop: 18 }}>
          <Label style={{ marginBottom: 8 }}>Target</Label>
          <Stepper value={target} onChange={setTarget} step={def.step} min={def.min} max={def.max} unit={def.unit} />
        </View>
      )}
      <Button
        label="Set it"
        disabled={!canSave}
        style={{ marginTop: 20 }}
        onPress={() =>
          onSave({
            type,
            target: type === "race" ? 1 : target,
            raceName: type === "race" ? raceName.trim() : null,
            raceDate: type === "race" && raceDate ? dateToIso(raceDate) : null,
            seasonYear,
          })
        }
      />
      {initial && onClear ? (
        <Pressable onPress={onClear} accessibilityRole="button" style={styles.clear}>
          <Small>Clear this goal</Small>
        </Pressable>
      ) : null}
    </BottomSheet>
  );
}

export function NextRideSheet({
  open,
  onClose,
  initial,
  onSave,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  initial: Date | null;
  onSave: (date: Date) => void;
  onClear?: () => void;
}) {
  const [date, setDate] = useState<Date | null>(initial);
  return (
    <BottomSheet open={open} onClose={onClose} title="Next ride">
      <Sub style={{ marginTop: 0, marginBottom: 14 }}>Count it down. Your setup&apos;s already waiting. No reminders, no pings: just the number.</Sub>
      <DateChips value={date} onChange={setDate} />
      <Button label="Pick this day" disabled={!date} style={{ marginTop: 20 }} onPress={() => date && onSave(date)} />
      {initial && onClear ? (
        <Pressable onPress={onClear} accessibilityRole="button" style={styles.clear}>
          <Small>Clear the date</Small>
        </Pressable>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", rowGap: 8 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: V3.carbon, borderRadius: 14, padding: 8 },
  stepBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: V3.panel2, alignItems: "center", justifyContent: "center" },
  stepValue: { color: V3.white, fontSize: 34 },
  stepUnit: { color: V3.steel, fontSize: 13 },
  input: { backgroundColor: V3.carbon, borderRadius: 12, paddingHorizontal: 14, height: 48, color: V3.white, fontSize: 16, borderWidth: 1, borderColor: V3.line },
  clear: { alignItems: "center", paddingVertical: 14 },
});
