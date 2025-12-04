// components/Toast.tsx
import React, { createContext, useContext, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";

type ToastKind = "success" | "error" | "info";
type ToastOptions = { kind?: ToastKind; durationMs?: number };

type Ctx = {
  show: (message: string, opts?: ToastOptions) => void;
};

const ToastContext = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string>("");
  const [kind, setKind] = useState<ToastKind>("info");
  const [visible, setVisible] = useState(false);

  const opacity = useRef(new Animated.Value(0)).current;

  const show = (msg: string, opts?: ToastOptions) => {
    const duration = opts?.durationMs ?? 2200;
    setKind(opts?.kind ?? "info");
    setMessage(msg);
    setVisible(true);

    opacity.stopAnimation();
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true, easing: Easing.out(Easing.quad) }).start(
      () => {
        setTimeout(() => {
          Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true, easing: Easing.in(Easing.quad) }).start(
            () => setVisible(false)
          );
        }, duration);
      }
    );
  };

  const value = useMemo<Ctx>(() => ({ show }), []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {visible ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wrap,
            {
              opacity,
            },
          ]}
        >
          <View style={[styles.toast, kindStyles[kind]]}>
            <Text style={styles.txt}>{message}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): Ctx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider />");
  return ctx;
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: Platform.select({ ios: 32, android: 24, default: 24 }),
    alignItems: "center",
  },
  toast: {
    maxWidth: 520,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  txt: { color: "white", fontWeight: "700" },
});

const kindStyles: Record<ToastKind, any> = {
  info: { backgroundColor: "#111827" },
  success: { backgroundColor: "#16a34a" },
  error: { backgroundColor: "#dc2626" },
};
