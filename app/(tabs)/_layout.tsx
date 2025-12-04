// app/(tabs)/_layout.tsx
import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ThemeTokens } from "../../constants/theme";
import { useTheme } from "../../lib/theme";

/** Default icons for all tabs except Tune */
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

/** Custom center FAB for Tune (circle + label as one unit) */
function TuneButton({
  onPress,
  accessibilityState,
  colors,
}: {
  onPress?: () => void;
  accessibilityState?: { selected?: boolean };
  colors: ThemeTokens;
}) {
  const focused = !!accessibilityState?.selected;
  const styles = makeStyles(colors);

  return (
    <Pressable onPress={onPress} style={styles.tuneWrap} hitSlop={10}>
      <View style={[styles.tuneFab, focused && styles.tuneFabActive]}>
        <Ionicons name="flash" size={30} color="#FFFFFF" />
      </View>
      <Text style={[styles.tuneLabel, focused && styles.tuneLabelActive]}>Tune</Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

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
          marginBottom: 12, // lowers baseline a touch to match Tune label
          textAlign: "center",
        },
        tabBarStyle: {
          backgroundColor: colors.CARD,
          borderTopColor: colors.BORDER,
          borderTopWidth: 1,
          height: 104,
          paddingTop: 8,
          paddingBottom: 12,
        },
        // Default icon renderer (Tune overrides with a custom button)
        tabBarIcon: ({ focused }) => (
          <DefaultIcon routeName={route.name} focused={focused} colors={colors} />
        ),
      })}
    >
      {/* Visible tabs */}
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="garage" options={{ title: "Garage" }} />

      {/* Center FAB (custom button renders icon + label together) */}
      <Tabs.Screen
        name="tune"
        options={{
          tabBarLabel: () => null, // we render our own label below the FAB
          tabBarButton: (props) => <TuneButton {...props} colors={colors} />,
        }}
      />

      <Tabs.Screen name="sessions" options={{ title: "Sessions" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />

      {/* Hide nested detail routes from appearing as extra tabs */}
      <Tabs.Screen name="sessions/[id]" options={{ href: null }} />
      <Tabs.Screen name="[id]" options={{ href: null }} />
      <Tabs.Screen name="login" options={{ href: null }} />
    </Tabs>
  );
}

const FAB_SIZE = 76; // larger circle

const makeStyles = (C: ThemeTokens) =>
  StyleSheet.create({
    /** Container for Tune button inside the tab item */
    tuneWrap: {
      alignItems: "center",
      justifyContent: "flex-start",
      alignSelf: "center",
      marginTop: -24, // lift so it visually centers with the taller bar
    },
    /** The circle */
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
      borderColor: "rgba(255,255,255,0.18)", // light ring looks good on both themes
    },
    tuneFabActive: {
      shadowOpacity: 0.6,
      transform: [{ scale: 1.04 }],
    },
    /** The "Tune" text rendered by us (not the default label) */
    tuneLabel: {
      marginTop: 6,
      fontSize: 12,
      fontWeight: "800",
      color: C.MUTED,
      textAlign: "center",
    },
    tuneLabelActive: {
      color: C.TEXT,
    },
  });
