// app/(tabs)/_layout.tsx
import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ThemeTokens } from "../../constants/theme";
import { HOME_GARAGE_V3_ENABLED } from "../../lib/featureFlags";
import { useOnboarding } from "../../lib/onboarding";
import { useTheme } from "../../lib/theme";

const ACTIVE_COLOR = "#1D9BF0";
const INACTIVE_COLOR = "rgba(255,255,255,0.4)";

function DefaultIcon({
  routeName,
  focused,
}: {
  routeName: string;
  focused: boolean;
}) {
  const color = focused ? ACTIVE_COLOR : INACTIVE_COLOR;
  const size = 22;

  switch (routeName) {
    case "index":
      return <Ionicons name="home-outline" size={size} color={color} />;
    case "garage":
      return <Ionicons name="bicycle-outline" size={size} color={color} />;
    case "sessions":
      return <Ionicons name="time-outline" size={size} color={color} />;
    case "profile":
      return <Ionicons name="person-circle-outline" size={size} color={color} />;
    default:
      return <Ionicons name="ellipse-outline" size={size} color={color} />;
  }
}

function TuneButton({
  onPress,
  accessibilityState,
  colors,
  disabled,
}: {
  onPress?: () => void;
  accessibilityState?: { selected?: boolean };
  colors: ThemeTokens;
  disabled?: boolean;
}) {
  const focused = !!accessibilityState?.selected;
  const styles = makeStyles(colors);

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[styles.tuneWrap, disabled && styles.disabled]}
      hitSlop={10}
      disabled={disabled}
    >
      {/* Outer ring in bar-background color to separate from bar */}
      <View style={[styles.tuneRing, { backgroundColor: colors.CARD }]}>
        <View style={styles.tuneFab}>
          <Ionicons name="flash" size={26} color="#FFFFFF" />
        </View>
      </View>
      <Text
        style={[
          styles.tuneLabel,
          { color: focused ? ACTIVE_COLOR : INACTIVE_COLOR },
        ]}
      >
        Tune
      </Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();
  const { onboardingActive, state } = useOnboarding();
  const styles = makeStyles(colors);

  // In the "trial" step the tabs are visible — Tune and Sessions show locked
  // content instead of their normal screens. For all earlier steps hide the
  // tab bar entirely so the onboarding flow stays focused.
  const isTrialStep = onboardingActive && state.onboardingStep === "trial";
  const hideTabs = onboardingActive && !isTrialStep;

  return (
    <Tabs
      initialRouteName="index"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: ACTIVE_COLOR,
        tabBarInactiveTintColor: INACTIVE_COLOR,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "700" as const,
          marginTop: 2,
          marginBottom: 10,
          textAlign: "center" as const,
        },
        tabBarStyle: hideTabs
          ? { display: "none" }
          : {
              backgroundColor: colors.CARD,
              borderTopColor: colors.BORDER,
              borderTopWidth: 1,
              height: 96,
              paddingTop: 8,
              paddingBottom: 10,
            },
        tabBarIcon: ({ focused }) => (
          <DefaultIcon routeName={route.name} focused={focused} />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="garage" options={{ title: "Garage" }} />

      {/* 3.0: the Tune flow is relocated into Garage (Add a bike, New setup,
          Update my baseline, New tune). The route stays; only the tab slot and
          its FAB leave the bar, so the bar is Home, Garage, Profile. */}
      <Tabs.Screen
        name="tune"
        options={
          HOME_GARAGE_V3_ENABLED
            ? { href: null }
            : {
                tabBarLabel: () => null,
                tabBarButton: (props) => (
                  <TuneButton {...props} colors={colors} disabled={hideTabs} />
                ),
              }
        }
      />

      {/* 3.0: the ride day replaces the Sessions tab (four tabs). The route
          stays reachable for old links; it just leaves the bar. */}
      <Tabs.Screen name="sessions" options={HOME_GARAGE_V3_ENABLED ? { href: null } : { title: "Sessions" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />

      <Tabs.Screen name="sessions/[id]" options={{ href: null }} />
      <Tabs.Screen name="[id]" options={{ href: null }} />
      <Tabs.Screen name="login" options={{ href: null }} />
    </Tabs>
  );
}

const FAB_SIZE = 52;
const RING_SIZE = FAB_SIZE + 6; // 3px border on each side

const makeStyles = (_C: ThemeTokens) =>
  StyleSheet.create({
    tuneWrap: {
      alignItems: "center",
      justifyContent: "flex-start",
      alignSelf: "center",
      marginTop: -20,
    },
    tuneRing: {
      width: RING_SIZE,
      height: RING_SIZE,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
    },
    tuneFab: {
      width: FAB_SIZE,
      height: FAB_SIZE,
      borderRadius: 16,
      backgroundColor: "#1D9BF0",
      alignItems: "center",
      justifyContent: "center",
    },
    tuneLabel: {
      marginTop: 4,
      fontSize: 10,
      fontWeight: "700",
      textAlign: "center",
    },
    disabled: { opacity: 0.35 },
  });
