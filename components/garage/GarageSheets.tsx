// components/garage/GarageSheets.tsx
// Rider-input sheets for the Garage: engine hours (+ "just changed the
// oil"), tire pressures, new named setup, add a bike, fix a number.
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { BottomSheet } from "../v3/BottomSheet";
import { Button, Chip, Label, Small, Sub } from "../v3/primitives";
import { headingFont, interFont, V3 } from "../v3/theme";
import { BIKE_BRANDS, BIKE_CATALOG } from "../../constants/bike-catalog";

export function DecimalStepper({
  value,
  onChange,
  step,
  min,
  max,
  unit,
  digits = 1,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  max: number;
  unit: string;
  digits?: number;
  label?: string;
}) {
  const bump = (d: number) => {
    const next = Math.round(Math.max(min, Math.min(max, value + d)) * 100) / 100;
    if (next !== value) {
      void Haptics.selectionAsync().catch(() => {});
      onChange(next);
    }
  };
  return (
    <View>
      {label ? <Label style={{ marginBottom: 8 }}>{label}</Label> : null}
      <View style={styles.stepper}>
        <Pressable onPress={() => bump(-step)} onLongPress={() => bump(-step * 5)} accessibilityRole="button" accessibilityLabel="Less" style={styles.stepBtn}>
          <Ionicons name="remove" size={22} color={V3.steel} />
        </Pressable>
        <Text style={[styles.stepValue, interFont(700)]}>
          {value.toFixed(digits)}
          <Text style={[styles.stepUnit, interFont(400)]}> {unit}</Text>
        </Text>
        <Pressable onPress={() => bump(step)} onLongPress={() => bump(step * 5)} accessibilityRole="button" accessibilityLabel="More" style={styles.stepBtn}>
          <Ionicons name="add" size={22} color={V3.steel} />
        </Pressable>
      </View>
    </View>
  );
}

export function HoursSheet({
  open,
  onClose,
  hours,
  intervalHours,
  lastServiceHours,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  hours: number | null;
  intervalHours: number;
  lastServiceHours: number | null;
  onSave: (p: { hours: number; intervalHours: number; lastServiceHours: number | null }) => void;
}) {
  const [h, setH] = useState(hours ?? 0);
  const [interval, setInterval_] = useState(intervalHours);
  const [service, setService] = useState<number | null>(lastServiceHours);
  return (
    <BottomSheet open={open} onClose={onClose} title="Engine hours">
      <Sub style={{ marginTop: 0, marginBottom: 14 }}>Off the hour meter. Ride days add to it later; for now you keep it honest.</Sub>
      <DecimalStepper value={h} onChange={setH} step={0.5} min={0} max={2000} unit="hrs" />
      <View style={{ marginTop: 16 }}>
        <DecimalStepper value={interval} onChange={setInterval_} step={1} min={1} max={100} unit="hrs" digits={0} label="Oil interval" />
      </View>
      <Pressable
        onPress={() => {
          void Haptics.selectionAsync().catch(() => {});
          setService(h);
        }}
        accessibilityRole="button"
        style={[styles.inlineBtn, service === h && styles.inlineBtnOn]}
      >
        <Ionicons name="water-outline" size={16} color={service === h ? V3.carbon : V3.blue} />
        <Text style={[styles.inlineBtnText, interFont(600), service === h && { color: V3.carbon }]}>
          {service === h ? `Oil changed at ${h.toFixed(1)}` : "Just changed the oil"}
        </Text>
      </Pressable>
      {service !== null && service !== h ? <Small style={{ marginTop: 8 }}>Last oil change logged at {service.toFixed(1)} hrs.</Small> : null}
      <Button label="Save" style={{ marginTop: 18 }} onPress={() => onSave({ hours: h, intervalHours: interval, lastServiceHours: service })} />
    </BottomSheet>
  );
}

export function TiresSheet({
  open,
  onClose,
  front,
  rear,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  front: number | null;
  rear: number | null;
  onSave: (p: { front: number; rear: number }) => void;
}) {
  const [f, setF] = useState(front ?? 12);
  const [r, setR] = useState(rear ?? 12.5);
  return (
    <BottomSheet open={open} onClose={onClose} title="Tires">
      <Sub style={{ marginTop: 0, marginBottom: 14 }}>Cold pressures, before the first moto.</Sub>
      <DecimalStepper value={f} onChange={setF} step={0.5} min={4} max={30} unit="psi" label="Front" />
      <View style={{ marginTop: 16 }}>
        <DecimalStepper value={r} onChange={setR} step={0.5} min={4} max={30} unit="psi" label="Rear" />
      </View>
      <Button label="Save" style={{ marginTop: 18 }} onPress={() => onSave({ front: f, rear: r })} />
    </BottomSheet>
  );
}

const TERRAINS = ["Hardpack", "Loam", "Sand", "Rutted clay", "Supercross", "Mud", "Singletrack", "Rocks and roots", "Desert", "Dunes", "Hard enduro"];

export function NewSetupSheet({
  open,
  onClose,
  fromVersionLabel,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  fromVersionLabel: string | null;
  onCreate: (p: { name: string; terrain: string | null }) => void;
}) {
  const [name, setName] = useState("");
  const [terrain, setTerrain] = useState<string | null>(null);
  return (
    <BottomSheet open={open} onClose={onClose} title="New setup">
      <Sub style={{ marginTop: 0, marginBottom: 14 }}>
        {fromVersionLabel ? `Starts from ${fromVersionLabel}. Its own history from here.` : "Its own history from here."}
      </Sub>
      <Label style={{ marginBottom: 8 }}>Name</Label>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Dunes, OMC, race day..."
        placeholderTextColor={V3.muted}
        style={[styles.input, interFont(500)]}
        maxLength={30}
        autoCorrect={false}
      />
      <Label style={{ marginTop: 16, marginBottom: 8 }}>Terrain</Label>
      <View style={styles.chips}>
        {TERRAINS.map((t) => (
          <Chip key={t} label={t} on={terrain === t} onPress={() => setTerrain(terrain === t ? null : t)} />
        ))}
      </View>
      <Button label="Create setup" disabled={name.trim().length === 0} style={{ marginTop: 18 }} onPress={() => onCreate({ name: name.trim(), terrain })} />
    </BottomSheet>
  );
}

export function AddBikeSheet({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (p: { make: string; model: string; year: number }) => void;
}) {
  const [make, setMake] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const models = make ? BIKE_CATALOG[make] ?? [] : [];
  const years = useMemo(() => {
    const y = new Date().getFullYear() + 1;
    return Array.from({ length: y - 2000 + 1 }, (_, i) => y - i);
  }, []);
  return (
    <BottomSheet open={open} onClose={onClose} title="Add a bike">
      <Label style={{ marginBottom: 8 }}>Brand</Label>
      <View style={styles.chips}>
        {BIKE_BRANDS.map((b) => (
          <Chip key={b} label={b} on={make === b} onPress={() => { setMake(b); setModel(null); }} />
        ))}
      </View>
      {make ? (
        <>
          <Label style={{ marginTop: 16, marginBottom: 8 }}>Model</Label>
          <View style={styles.chips}>
            {models.map((m) => (
              <Chip key={m} label={m} on={model === m} onPress={() => setModel(m)} />
            ))}
          </View>
        </>
      ) : null}
      {model ? (
        <>
          <Label style={{ marginTop: 16, marginBottom: 8 }}>Year</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {years.map((y) => (
              <Chip key={y} label={String(y)} on={year === y} onPress={() => setYear(y)} />
            ))}
          </ScrollView>
        </>
      ) : null}
      <Button label="Add it" disabled={!make || !model || !year} style={{ marginTop: 18 }} onPress={() => make && model && year && onAdd({ make, model, year })} />
    </BottomSheet>
  );
}

export function FixNumberSheet({
  open,
  onClose,
  label,
  value,
  unit,
  step,
  min,
  max,
  digits,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  value: number;
  unit: string;
  step: number;
  min: number;
  max: number;
  digits: number;
  onSave: (v: number) => void;
}) {
  const [v, setV] = useState(value);
  return (
    <BottomSheet open={open} onClose={onClose} title="Fix the number">
      <Sub style={{ marginTop: 0, marginBottom: 14 }}>What&apos;s actually on the bike. Saved as a new version; nothing is deleted.</Sub>
      <DecimalStepper value={v} onChange={setV} step={step} min={min} max={max} unit={unit} digits={digits} label={label} />
      <Button label="Save it" disabled={v === value} style={{ marginTop: 18 }} onPress={() => onSave(v)} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: V3.carbon, borderRadius: 14, padding: 8 },
  stepBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: V3.panel2, alignItems: "center", justifyContent: "center" },
  stepValue: { color: V3.white, fontSize: 30 },
  stepUnit: { color: V3.steel, fontSize: 13 },
  inlineBtn: { marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: V3.line, paddingVertical: 12 },
  inlineBtnOn: { backgroundColor: V3.blue, borderColor: V3.blue },
  inlineBtnText: { color: V3.white, fontSize: 14 },
  input: { backgroundColor: V3.carbon, borderRadius: 12, paddingHorizontal: 14, height: 48, color: V3.white, fontSize: 16, borderWidth: 1, borderColor: V3.line },
  chips: { flexDirection: "row", flexWrap: "wrap", rowGap: 8 },
  _h: { ...headingFont() },
});
