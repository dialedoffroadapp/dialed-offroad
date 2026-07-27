import "dotenv/config";
import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Dialed Offroad",
  slug: "dialed-offroad",
  owner: "dialedoffroad",
  scheme: "dialedoffroad",

  // 🔵 BUMPED APP VERSION (user-facing)
  version: "2.3.0",

  orientation: "portrait",
  icon: "./assets/images/icon.png",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,

  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.dialedoffroad.app",

    // Sign in with Apple entitlement (lib/socialAuth.ts). Must also be
    // enabled on the App ID in the Apple Developer portal.
    usesAppleSignIn: true,

    // 🔵 iOS build number (must be > previous TF build)
    // eas.json appVersionSource="remote" auto-increments this at build time
    // (last shipped 34 → next 35); kept in sync here for honest local config.
    buildNumber: "35",

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
    versionCode: 35,

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
    // Sign in with Apple (lib/socialAuth.ts). ⚠️ Native module — same
    // dev-client rule as expo-notifications: inert in older binaries; the
    // signup screen feature-gates the button on module presence.
    "expo-apple-authentication",
    // Native Google sign-in. The plugin needs the REVERSED iOS client id
    // (com.googleusercontent.apps.xxx) as a URL scheme; until that env var
    // is set the plugin is skipped and the Google button hides itself
    // (GOOGLE_WEB_CLIENT_ID gate in lib/socialAuth.ts).
    ...(process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME
      ? [
          [
            "@react-native-google-signin/google-signin",
            { iosUrlScheme: process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME },
          ] as [string, any],
        ]
      : []),
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

    // Google sign-in client IDs (lib/socialAuth.ts). Web client id is what
    // Supabase validates the ID token against; empty ⇒ Google button hidden.
    GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "",
    GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "",

    eas: {
      projectId: "c650cb0a-f65a-4148-ac4d-48037b64d712",
    },
  },

};

export default config;
