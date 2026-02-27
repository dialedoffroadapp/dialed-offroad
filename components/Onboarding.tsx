// components/Onboarding.tsx
import { useRouter } from "expo-router";
import React, { useMemo, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "../lib/theme";

type OnboardingProps = {
  onFinish: () => void;
};

type Slide = {
  title: string;
  body: string;
};

const { width: SCREEN_W } = Dimensions.get("window");

const Onboarding: React.FC<OnboardingProps> = ({ onFinish }) => {
  const router = useRouter();
  const { colors } = useTheme();

  const slides: Slide[] = useMemo(
    () => [
      {
        title: "Stop guessing suspension settings.",
        body: "Dialed Offroad helps you get a setup that feels stable, smooth, and in control.",
      },
      {
        title: "It’s based on your bike + you.",
        body: "We use your bike, weight, and riding style to generate settings that make sense for your setup.",
      },
      {
        title: "Add your bike to get started.",
        body: "Next we’ll take you to your Garage so you can add your bike and generate your first tune.",
      },
    ],
    []
  );

  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);

  const styles = makeStyles(colors);

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(slides.length - 1, i));
    setIndex(clamped);
    listRef.current?.scrollToIndex({ index: clamped, animated: true });
  };

  const finishToGarage = () => {
    // 1) Tell Root to hide overlay + set onboardingActive(true)
    onFinish();
    // 2) Now route to Garage
    router.replace("/(tabs)/garage");
  };

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={slides}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
          setIndex(i);
        }}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width: SCREEN_W }]}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </View>
        )}
      />

      <View style={styles.dots}>
        {slides.map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.footer}>
        <Pressable
          onPress={() => (index === 0 ? finishToGarage() : goTo(index - 1))}
          style={styles.secondaryBtn}
        >
          <Text style={styles.secondaryText}>{index === 0 ? "Skip" : "Back"}</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            if (index === slides.length - 1) finishToGarage();
            else goTo(index + 1);
          }}
          style={styles.primaryBtn}
        >
          <Text style={styles.primaryText}>
            {index === slides.length - 1 ? "Continue" : "Next"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

export default Onboarding;

const makeStyles = (C: any) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.BG },
    slide: { paddingHorizontal: 28, paddingTop: 120 },
    title: {
      color: C.TEXT,
      fontSize: 34,
      fontWeight: "900",
      lineHeight: 40,
      marginBottom: 14,
    },
    body: { color: C.MUTED, fontSize: 16, lineHeight: 22, maxWidth: 520 },
    dots: {
      position: "absolute",
      bottom: 120,
      left: 0,
      right: 0,
      flexDirection: "row",
      justifyContent: "center",
      gap: 8,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 999,
      backgroundColor: "rgba(255,255,255,0.25)",
    },
    dotActive: { backgroundColor: C.ACCENT, width: 18 },
    footer: {
      position: "absolute",
      bottom: 44,
      left: 18,
      right: 18,
      flexDirection: "row",
      gap: 12,
    },
    secondaryBtn: {
      flex: 1,
      borderWidth: 1,
      borderColor: C.BORDER,
      borderRadius: 999,
      paddingVertical: 14,
      alignItems: "center",
      backgroundColor: "transparent",
    },
    secondaryText: { color: C.TEXT, fontSize: 16, fontWeight: "800" },
    primaryBtn: {
      flex: 1,
      borderRadius: 999,
      paddingVertical: 14,
      alignItems: "center",
      backgroundColor: C.ACCENT,
    },
    primaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  });
