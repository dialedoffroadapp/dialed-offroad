// components/quiz/WeightDial.tsx
// Horizontal slide dial: big value in Dialed Blue, one haptic tick per step
// (5 lb / 2 kg), lbs/kg toggle, no keyboard. The value is ALWAYS stored in
// lbs; the unit only changes what the dial shows.
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import {
  clampWeightLbs,
  kgToLbs,
  lbsToKg,
  weightTicks,
} from "../../lib/quizOnboarding";
import { displayFont, Q } from "./quizTheme";

const TICK_W = 14;

export type WeightUnit = "lbs" | "kg";

export function WeightDial({
  valueLbs,
  unit,
  onChangeLbs,
  onChangeUnit,
}: {
  valueLbs: number;
  unit: WeightUnit;
  onChangeLbs: (lbs: number) => void;
  onChangeUnit: (u: WeightUnit) => void;
}) {
  const ticks = useMemo(() => weightTicks(unit), [unit]);
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const lastIndexRef = useRef<number>(-1);
  const programmaticRef = useRef(false);

  const shown = unit === "lbs" ? valueLbs : lbsToKg(valueLbs);
  const nearestIndex = useCallback(
    (v: number) => {
      let best = 0;
      let bestD = Infinity;
      ticks.forEach((t, i) => {
        const d = Math.abs(t - v);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    },
    [ticks]
  );

  // Park the dial on the current value when it lays out or the unit flips.
  useEffect(() => {
    if (!width) return;
    const idx = nearestIndex(shown);
    lastIndexRef.current = idx;
    programmaticRef.current = true;
    scrollRef.current?.scrollTo({ x: idx * TICK_W, animated: false });
    const t = setTimeout(() => {
      programmaticRef.current = false;
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, unit]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (programmaticRef.current) return;
    const idx = Math.max(0, Math.min(ticks.length - 1, Math.round(e.nativeEvent.contentOffset.x / TICK_W)));
    if (idx === lastIndexRef.current) return;
    lastIndexRef.current = idx;
    void Haptics.selectionAsync().catch(() => {});
    const v = ticks[idx];
    onChangeLbs(clampWeightLbs(unit === "lbs" ? v : kgToLbs(v)));
  };

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const side = Math.max(0, (width - TICK_W) / 2);

  return (
    <View style={styles.wrap}>
      <View style={styles.valueRow}>
        <Text style={[styles.value, displayFont("black")]} accessibilityLiveRegion="polite">
          {shown}
        </Text>
        <View style={styles.unitToggle} accessibilityRole="radiogroup">
          {(["lbs", "kg"] as WeightUnit[]).map((u) => (
            <Pressable
              key={u}
              onPress={() => {
                if (u !== unit) {
                  void Haptics.selectionAsync().catch(() => {});
                  onChangeUnit(u);
                }
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: unit === u }}
              style={[styles.unitBtn, unit === u && styles.unitBtnOn]}
            >
              <Text style={[styles.unitText, displayFont("bold"), unit === u && styles.unitTextOn]}>{u}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.dial} onLayout={onLayout}>
        {width > 0 ? (
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={TICK_W}
            decelerationRate="fast"
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentContainerStyle={{ paddingHorizontal: side }}
            accessibilityRole="adjustable"
            accessibilityLabel="Weight"
            accessibilityValue={{ text: `${shown} ${unit}` }}
          >
            {ticks.map((t, i) => {
              const major = i % 5 === 0;
              return (
                <View key={t} style={styles.tickCol}>
                  <View style={[styles.tick, major && styles.tickMajor]} />
                  {major ? <Text style={styles.tickLabel}>{t}</Text> : null}
                </View>
              );
            })}
          </ScrollView>
        ) : null}
        <View pointerEvents="none" style={[styles.indicator, { left: side + TICK_W / 2 - 1.5 }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 6 },
  valueRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  value: { color: Q.BLUE, fontSize: 88, lineHeight: 92, letterSpacing: -1 },
  unitToggle: {
    flexDirection: "row",
    backgroundColor: Q.INK,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Q.BORDER_STRONG,
    padding: 3,
    marginBottom: 14,
  },
  unitBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9 },
  unitBtnOn: { backgroundColor: Q.BLUE },
  unitText: { color: Q.STEEL, fontSize: 16, letterSpacing: 0.4, textTransform: "uppercase" },
  unitTextOn: { color: Q.INK },
  dial: { height: 84, marginTop: 8, justifyContent: "center" },
  tickCol: { width: TICK_W, alignItems: "center", justifyContent: "flex-end", height: 84 },
  tick: { width: 2, height: 22, backgroundColor: "rgba(255,255,255,0.22)", borderRadius: 1, marginBottom: 22 },
  tickMajor: { height: 38, backgroundColor: "rgba(255,255,255,0.5)" },
  tickLabel: { position: "absolute", bottom: 0, color: Q.STEEL, fontSize: 11 },
  indicator: { position: "absolute", top: 4, width: 3, height: 52, borderRadius: 2, backgroundColor: Q.BLUE },
});
