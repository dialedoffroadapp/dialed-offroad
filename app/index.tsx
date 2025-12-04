// app/index.tsx
import { useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { supabase } from "../lib/supabase";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function IndexGate() {
  const router = useRouter();
  const [readyToHide, setReadyToHide] = useState(false);
  const hidOnce = useRef(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;

        // Route once based on session
        router.replace(data?.session ? "/(tabs)" : "/signup"); // 👈 now lands on signup
      } finally {
        // Allow hide after we’ve requested navigation
        setReadyToHide(true);

        // Safety fallback so we never get stuck on splash
        setTimeout(() => {
          if (!hidOnce.current) {
            SplashScreen.hideAsync().catch(() => {});
            hidOnce.current = true;
          }
        }, 1200);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  // Hide splash after first layout of the routed screen
  const onLayout = useCallback(() => {
    if (readyToHide && !hidOnce.current) {
      requestAnimationFrame(() => {
        SplashScreen.hideAsync().catch(() => {});
        hidOnce.current = true;
      });
    }
  }, [readyToHide]);

  // Render an empty root that receives the layout callback.
  return <View style={{ flex: 1 }} onLayout={onLayout} />;
}
