// app/(tabs)/_layout.tsx
import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ThemeTokens } from "../../constants/theme";
import { useOnboarding } from "../../lib/onboarding";
import { useTheme } from "../../lib/theme";

function DefaultIcon({
  routeName,
  focused,
  colors,
}: {
  routeName: string;
  focused: boolean;
  colors: ThemeTokens;
}) {
  const color = focused ? colors.TEXT : colors.MUTED;
  const size = 24;

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
      <View style={[styles.tuneFab, focused && styles.tuneFabActive]}>
        <Ionicons name="flash" size={30} color="#FFFFFF" />
      </View>
      <Text style={[styles.tuneLabel, focused && styles.tuneLabelActive]}>Tune</Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();
  const { onboardingActive } = useOnboarding();
  const styles = makeStyles(colors);

  const hideTabs = onboardingActive;

  return (
    <Tabs
      initialRouteName="index"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: colors.TEXT,
        tabBarInactiveTintColor: colors.MUTED,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "800",
          marginTop: 4,
          marginBottom: 12,
          textAlign: "center",
        },
        tabBarStyle: hideTabs
          ? { display: "none" }
          : {
              backgroundColor: colors.CARD,
              borderTopColor: colors.BORDER,
              borderTopWidth: 1,
              height: 104,
              paddingTop: 8,
              paddingBottom: 12,
            },
        tabBarIcon: ({ focused }) => (
          <DefaultIcon routeName={route.name} focused={focused} colors={colors} />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="garage" options={{ title: "Garage" }} />

      <Tabs.Screen
        name="tune"
        options={{
          tabBarLabel: () => null,
          tabBarButton: (props) => (
            <TuneButton {...props} colors={colors} disabled={hideTabs} />
          ),
        }}
      />

      <Tabs.Screen name="sessions" options={{ title: "Sessions" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />

      <Tabs.Screen name="sessions/[id]" options={{ href: null }} />
      <Tabs.Screen name="[id]" options={{ href: null }} />
      <Tabs.Screen name="login" options={{ href: null }} />
    </Tabs>
  );
}

const FAB_SIZE = 76;

const makeStyles = (C: ThemeTokens) =>
  StyleSheet.create({
    tuneWrap: {
      alignItems: "center",
      justifyContent: "flex-start",
      alignSelf: "center",
      marginTop: -24,
    },
    tuneFab: {
      width: FAB_SIZE,
      height: FAB_SIZE,
      borderRadius: FAB_SIZE / 2,
      backgroundColor: C.ACCENT,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: C.ACCENT,
      shadowOpacity: 0.45,
      shadowOffset: { width: 0, height: 10 },
      shadowRadius: 16,
      elevation: 10,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.18)",
    },
    tuneFabActive: {
      shadowOpacity: 0.6,
      transform: [{ scale: 1.04 }],
    },
    tuneLabel: {
      marginTop: 6,
      fontSize: 12,
      fontWeight: "800",
      color: C.MUTED,
      textAlign: "center",
    },
    tuneLabelActive: { color: C.TEXT },
    disabled: { opacity: 0.35 },
  });
