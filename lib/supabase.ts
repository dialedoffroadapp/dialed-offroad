// lib/supabase.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";

/**
 * Must be set in .env at project root:
 *  EXPO_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
 *  EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4dWpib2NkanpuYXhwenhheGJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcyMjYxOTUsImV4cCI6MjA3MjgwMjE5NX0.P746901WZ9_dz5nP3C-JBYOI1P06FFy-Sw86G4dWjmA
 *
 * Expo auto-exposes any EXPO_PUBLIC_* to process.env on web/iOS/Android.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// 🔍 Debug: see exactly which Supabase project the app is using at runtime
console.log("[supabase runtime] URL =", url);
console.log("[supabase runtime] anon prefix =", anon?.slice(0, 12));

if (!url || !anon) {
  // Visible once in the console so it's obvious if envs didn't load.
  console.warn(
    "[supabase.ts] Missing envs. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env and restart Expo."
  );
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    // ⬇️ Persist sessions on native via AsyncStorage
    storage: {
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
      removeItem: (key) => AsyncStorage.removeItem(key),
    },
  },
});
