import "dotenv/config";
import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Dialed Offroad",
  slug: "dialed-offroad",
  owner: "dialedoffroad",
  scheme: "dialedoffroad",

  // 🔵 BUMPED APP VERSION (user-facing)
  version: "2.0.5",

  orientation: "portrait",
  icon: "./assets/images/icon.png",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,

  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.dialedoffroad.app",

    // 🔵 iOS build number (must be > previous TF build)
    buildNumber: "22",

    infoPlist: {
      NSPhotoLibraryUsageDescription:
        "We use your photo to set your profile picture in Dialed Offroad.",
      NSCameraUsageDescription:
        "We use the camera to take a profile photo.",
    },
  },

  android: {
    package: "com.dialedoffroad.app",

    // 🔵 ANDROID: internal build counter for Play Store
    versionCode: 22,

    adaptiveIcon: {
      // Use your main icon as the foreground
      foregroundImage: "./assets/images/icon.png",
      // Solid background color (no extra file needed)
      backgroundColor: "#0B0F13",
    },

    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
  },

  web: {
    output: "static",
    favicon: "./assets/images/favicon.png",
  },

  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash.png", // 2048x2048 stacked splash
        imageWidth: 440,                     // bump if you want it bigger, e.g. 460–480
        resizeMode: "contain",
        backgroundColor: "#0B0F13",
        dark: { backgroundColor: "#0B0F13" },
      },
    ],
    // Local ride-reminder notifications (lib/rideReminder.ts). LOCAL
    // scheduling only — no push backend, no tokens. ⚠️ Config-plugin change:
    // a new dev client / EAS build is required before notifications work;
    // they are inert in older binaries.
    "expo-notifications",
  ],

  experiments: {
    typedRoutes: true,
  },

   extra: {
    // Supabase
    SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,

    // RevenueCat public keys
    RC_PUBLIC_IOS_KEY: process.env.RC_PUBLIC_IOS_KEY ?? "",
    RC_PUBLIC_ANDROID_KEY: process.env.RC_PUBLIC_ANDROID_KEY ?? "",

    eas: {
      projectId: "c650cb0a-f65a-4148-ac4d-48037b64d712",
    },
  },

};

export default config;
