// app/(tabs)/profile.tsx
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import RevenueCatUI, { PAYWALL_RESULT } from "react-native-purchases-ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../../components/Toast";
import type { ThemeTokens } from "../../constants/theme";
import {
  isPro,
  restorePurchases,
  syncProFromRevenueCat,
} from "../../lib/purchases";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";

type ProfileRow = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  pro_until: string | null;
};

/** Default Dialed Offroad theme for new / signed-out users */
const DEFAULT_MODE: "light" | "dark" = "dark";
const DEFAULT_ACCENT = "#1D9BF0";

// 👇 your feedback/support email
const SUPPORT_EMAIL = "support@dialedoffroad.com";

export default function ProfileScreen() {
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, mode, setMode, accent, setAccent } = useTheme();
  const styles = makeStyles(colors);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [originalName, setOriginalName] = useState<string>("");

  const [planLabel, setPlanLabel] = useState<"Free" | "Pro">("Free");
  const [proActive, setProActive] = useState(false); // controls Pro features

  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  // ---- Load profile + pro status from Supabase ----
  const loadProfile = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;

      setEmail(user?.email ?? "");

      if (!user?.id) {
        setProActive(false);
        setPlanLabel("Free");
        setDisplayName("");
        setOriginalName("");
        setAvatarUrl(null);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name, avatar_url, pro_until")
        .eq("user_id", user.id)
        .maybeSingle<ProfileRow>();

      if (error) throw error;

      if (data) {
        setDisplayName(data.display_name ?? "");
        setOriginalName(data.display_name ?? "");
        setAvatarUrl(data.avatar_url ?? null);

        const untilMs = data.pro_until
          ? new Date(data.pro_until).getTime()
          : 0;
        const isProNow = untilMs > Date.now();

        setProActive(isProNow);
        setPlanLabel(isProNow ? "Pro" : "Free");
      } else {
        // No profile row yet
        setProActive(false);
        setPlanLabel("Free");
      }
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load profile", {
        kind: "error",
      });
    }
  }, [toast]);

  // Initial load
  useEffect(() => {
    let isMounted = true;
    (async () => {
      await loadProfile();
      if (isMounted) setLoading(false);
    })();
    return () => {
      isMounted = false;
    };
  }, [loadProfile]);

  // Refresh whenever Profile tab regains focus (e.g. after purchasing Pro)
  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  const isDirty = useMemo(
    () => displayName.trim() !== (originalName ?? "").trim(),
    [displayName, originalName]
  );

  const onSave = async () => {
    if (!isDirty) return;
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user?.id) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .upsert({ user_id: user.id, display_name: displayName.trim() || null });
      if (error) throw error;
      setOriginalName(displayName.trim());
      toast.show("Profile saved ✅", { kind: "success" });
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to save", { kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  const resetThemeToDefault = () => {
    setMode(DEFAULT_MODE);
    setAccent(DEFAULT_ACCENT);
    setThemeOpen(false);
  };

  const onSignOut = async () => {
    try {
      resetThemeToDefault();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      toast.show("Signed out", { kind: "success" });
      router.replace("/login");
      if (Platform.OS === "web" && typeof window !== "undefined") {
        setTimeout(() => {
          if (window.location.pathname !== "/login")
            window.location.assign("/login");
        }, 30);
      }
    } catch (e: any) {
      toast.show(e?.message ?? "Sign out failed", { kind: "error" });
    }
  };

  const onExportData = () => {
    toast.show("We’ll email your data export shortly.", { kind: "info" });
  };

  const invokeDeleteFn = async () => {
    const names = ["delete-account", "delete-acount"];
    let lastErr: any = null;
    for (const n of names) {
      const { error } = await supabase.functions.invoke(n, { method: "POST" });
      if (!error) return;
      lastErr = error;
    }
    throw lastErr;
  };

  const actuallyDeleteAccount = async () => {
    setDeleting(true);
    try {
      await invokeDeleteFn();
      toast.show("Account deleted", { kind: "success" });

      resetThemeToDefault();

      await supabase.auth.signOut();
      router.replace("/login");
      if (Platform.OS === "web" && typeof window !== "undefined") {
        setTimeout(() => {
          if (window.location.pathname !== "/login")
            window.location.assign("/login");
        }, 30);
      }
    } catch (e: any) {
      toast.show(e?.message ?? "Delete failed", { kind: "error" });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
      setMoreOpen(false);
    }
  };

  // ---------- AVATAR PICK & UPLOAD ----------
  const pickAndUploadAvatar = async () => {
    try {
      setUploading(true);

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast.show("Photo access denied", { kind: "error" });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes:
          (ImagePicker as any).MediaType?.Images ??
          ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });

      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];

      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user?.id) throw new Error("Not signed in");

      const res = await fetch(asset.uri);
      const arrayBuffer = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      const extFromUri = asset.uri.split(".").pop();
      const fileExt =
        extFromUri && extFromUri.length <= 5 ? extFromUri.toLowerCase() : "jpg";

      const filePath = `${user.id}/${Date.now()}.${fileExt}`;

      const { error: uploadErr } = await supabase.storage
        .from("avatars")
        .upload(filePath, bytes, {
          upsert: true,
          cacheControl: "3600",
          contentType: (asset as any).mimeType || "image/jpeg",
        });

      if (uploadErr) throw uploadErr;

      const { data: pub, error: pubErr } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);
      if (pubErr) throw pubErr;

      const publicUrl = pub?.publicUrl;
      if (!publicUrl) throw new Error("Failed to resolve public URL");

      const { error: upsertErr } = await supabase
        .from("profiles")
        .upsert({ user_id: user.id, avatar_url: publicUrl });
      if (upsertErr) throw upsertErr;

      setAvatarUrl(publicUrl);
      toast.show("Photo updated ✅", { kind: "success" });
    } catch (e: any) {
      console.error("Avatar upload failed", e);
      toast.show(e?.message ?? "Avatar upload failed", { kind: "error" });
    } finally {
      setUploading(false);
    }
  };
  // ---------------------------------------------------

  // Suggestions & Feedback email
  const openSupportEmail = async () => {
    try {
      const subject = encodeURIComponent("Dialed Offroad – Suggestions & Feedback");
      const body = encodeURIComponent(
        "Hey Dialed Offroad team,\n\nHere’s some feedback or a suggestion:\n\n"
      );
      const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        toast.show("Couldn’t open your email app.", { kind: "error" });
        return;
      }
      await Linking.openURL(url);
    } catch {
      toast.show("Couldn’t open your email app.", { kind: "error" });
    }
  };

  // ---------- RevenueCat Paywall ----------
  const openPaywall = async () => {
    try {
      const result = await RevenueCatUI.presentPaywall({
        dismissAutomatically: true,
      });

      if (
        result === PAYWALL_RESULT.PURCHASED ||
        result === PAYWALL_RESULT.RESTORED
      ) {
        // 1) Sync RC entitlements into Supabase immediately
        await syncProFromRevenueCat();
        // 2) Reload profile to update plan label / proActive
        await loadProfile();

        toast.show("Pro unlocked 🎉", { kind: "success" });
      }
    } catch (e: any) {
      console.log("Paywall error", e);
      toast.show("Could not open paywall", { kind: "error" });
    }
  };

  // ---------- Restore Purchases ----------
  const onRestorePurchases = async () => {
    try {
      const info = await restorePurchases();

      // Force RC → Supabase sync in case webhook is slow/missed
      await syncProFromRevenueCat();
      await loadProfile();

      if (isPro(info)) {
        toast.show("Pro restored 🎉", { kind: "success" });
      } else {
        toast.show(
          "No active Pro subscription found for this Apple ID.",
          { kind: "info" }
        );
      }
    } catch (e: any) {
      console.log("Restore error", e);
      toast.show("Could not restore purchases", { kind: "error" });
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.BG }]}>
        <ActivityIndicator color={colors.TEXT} />
        <Text style={[styles.muted, { marginTop: 8 }]}>Loading profile…</Text>
      </View>
    );
  }

  const managePlanLabel = proActive ? "Manage Plan" : "Go Pro";

  // Accent handler: free users open RevenueCat paywall
  const handleAccentPress = (hex: string) => {
    if (!proActive) {
      // Just show the paywall on top of the Theme sheet
      openPaywall();
      return;
    }

    // Pro users just change the accent
    setAccent(hex);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.BG }}>
      {/* Scrollable content so you can always reach the bottom */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: 24,
        }}
      >
        <View
          style={[
            styles.card,
            styles.shadow,
            { backgroundColor: colors.CARD, borderColor: colors.BORDER },
          ]}
        >
          {/* Header */}
          <View style={styles.heroRow}>
            <Pressable onPress={pickAndUploadAvatar} style={styles.avatarWrap}>
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={[
                    styles.avatar,
                    { borderColor: "rgba(255,255,255,0.08)" },
                  ]}
                />
              ) : (
                <View
                  style={[
                    styles.avatarFallback,
                    {
                      backgroundColor: "#0C1222",
                      borderColor: "rgba(255,255,255,0.08)",
                    },
                  ]}
                >
                  <Text style={styles.avatarText}>
                    {(displayName || email || "?")
                      .slice(0, 1)
                      .toUpperCase()}
                  </Text>
                </View>
              )}
              <View
                style={[
                  styles.camFab,
                  { backgroundColor: colors.ACCENT, borderColor: colors.CARD },
                ]}
              >
                {uploading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Ionicons name="camera" size={14} color="#fff" />
                )}
              </View>
            </Pressable>

            <View style={{ flex: 1, paddingHorizontal: 8 }}>
              <Text
                style={[styles.titleName, { color: colors.TEXT }]}
                numberOfLines={1}
              >
                {displayName || "Your Name"}
              </Text>
              <Text
                style={[styles.email, { color: colors.MUTED }]}
                numberOfLines={1}
              >
                {email}
              </Text>
            </View>
          </View>

          {/* Plan row */}
          <View style={styles.planRow}>
            <Text
              style={[
                styles.planLabel,
                { color: colors.TEXT },
              ]}
            >
              {planLabel} Plan
            </Text>

            <Pressable
              style={[
                styles.planCta,
                {
                  borderColor: colors.ACCENT,
                  backgroundColor: colors.ACCENT + "22",
                },
              ]}
              onPress={openPaywall}
            >
              <Text
                style={[
                  styles.planCtaText,
                  { color: colors.ACCENT },
                ]}
                numberOfLines={1}
              >
                {managePlanLabel}
              </Text>
            </Pressable>
          </View>

          <Pressable
            onPress={onRestorePurchases}
            style={styles.restoreLink}
          >
            <Text
              style={[
                styles.restoreLinkText,
                { color: colors.MUTED },
              ]}
            >
              Restore Purchases
            </Text>
          </Pressable>

          {/* Profile form */}
          <Text style={[styles.sectionLabel, { color: colors.MUTED }]}>
            Profile
          </Text>
          <Text style={[styles.inputLabel, { color: colors.MUTED }]}>
            Display Name
          </Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            placeholderTextColor={colors.MUTED}
            style={[
              styles.input,
              {
                borderColor: colors.BORDER,
                backgroundColor:
                  (colors as any).INPUT_BG ??
                  colors.SURFACE_ALT ??
                  colors.CARD,
                color: (colors as any).INPUT_TEXT ?? colors.TEXT,
              },
            ]}
          />
          <Text style={[styles.helper, { color: colors.MUTED }]}>
            This appears on saved sessions you share.
          </Text>

          <Pressable
            onPress={onSave}
            style={[
              styles.btnPrimary,
              { backgroundColor: colors.ACCENT },
              !isDirty && styles.btnDisabled,
            ]}
            disabled={!isDirty || saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnPrimaryText}>
                {isDirty ? "Save" : "Saved"}
              </Text>
            )}
          </Pressable>

          {/* Security & Data */}
          <Text
            style={[
              styles.sectionLabel,
              { marginTop: 18, color: colors.MUTED },
            ]}
          >
            Security & Data
          </Text>

          <View style={styles.rowButtons}>
            <Pressable
              onPress={onSignOut}
              style={[styles.btnOutline, { borderColor: colors.BORDER }]}
            >
              <Ionicons name="log-out-outline" size={16} color={colors.TEXT} />
              <Text style={[styles.btnOutlineText, { color: colors.TEXT }]}>
                Sign Out
              </Text>
            </Pressable>

            <Pressable
              onPress={onExportData}
              style={[styles.btnOutline, { borderColor: colors.BORDER }]}
            >
              <Ionicons
                name="download-outline"
                size={16}
                color={colors.TEXT}
              />
              <Text style={[styles.btnOutlineText, { color: colors.TEXT }]}>
                Export My Data
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setThemeOpen(true)}
              style={[styles.btnOutline, { borderColor: colors.BORDER }]}
            >
              <Ionicons
                name="color-palette-outline"
                size={16}
                color={colors.TEXT}
              />
              <Text style={[styles.btnOutlineText, { color: colors.TEXT }]}>
                Theme
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setMoreOpen(true);
                setConfirmDelete(false);
              }}
              style={[styles.btnOutline, { borderColor: colors.BORDER }]}
            >
              <Ionicons
                name="ellipsis-horizontal"
                size={18}
                color={colors.TEXT}
              />
            </Pressable>

            {/* Smaller pill for feedback (same size as others) */}
            <Pressable
              onPress={openSupportEmail}
              style={[styles.btnOutline, { borderColor: colors.BORDER }]}
            >
              <Ionicons name="mail-outline" size={16} color={colors.TEXT} />
              <Text style={[styles.btnOutlineText, { color: colors.TEXT }]}>
                Feedback
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Bottom sheet: More (delete account) */}
      {moreOpen && (
        <View style={styles.sheetWrap}>
          <Pressable
            style={styles.backdrop}
            onPress={() => (!deleting ? setMoreOpen(false) : null)}
          />
          <View
            style={[
              styles.sheetCard,
              { backgroundColor: colors.CARD, borderColor: colors.BORDER },
            ]}
          >
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.TEXT }]}>
                {confirmDelete ? "Confirm deletion" : "More"}
              </Text>
            </View>

            {confirmDelete ? (
              <>
                <Text
                  style={[
                    styles.muted,
                    { marginHorizontal: 4, color: colors.MUTED },
                  ]}
                >
                  This will permanently remove your account and associated
                  data.
                </Text>

                <View style={{ height: 10 }} />

                <Pressable
                  onPress={actuallyDeleteAccount}
                  disabled={deleting}
                  style={[
                    styles.sheetRow,
                    styles.sheetDangerRow,
                    { justifyContent: "center", gap: 8 },
                    deleting && { opacity: 0.6 },
                  ]}
                >
                  {deleting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Ionicons name="trash-outline" size={16} color="#fff" />
                  )}
                  <Text
                    style={[
                      styles.sheetRowText,
                      { color: "#fff", textAlign: "center" },
                    ]}
                  >
                    {deleting ? "Deleting…" : "Yes, delete my account"}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setConfirmDelete(false)}
                  disabled={deleting}
                  style={[
                    styles.sheetRow,
                    {
                      justifyContent: "center",
                      borderColor: colors.BORDER,
                      backgroundColor: colors.CARD,
                    },
                  ]}
                >
                  <Text style={[styles.sheetRowText, { color: colors.TEXT }]}>
                    Cancel
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  onPress={() => setConfirmDelete(true)}
                  style={[styles.sheetRow, styles.sheetDangerRow]}
                >
                  <Ionicons name="trash-outline" size={16} color="#fff" />
                  <Text style={[styles.sheetRowText, { color: "#fff" }]}>
                    Delete Account
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      )}

      {/* THEME SHEET – modes for everyone, accents Pro-only */}
      <Modal
        visible={themeOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setThemeOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }}
          onPress={() => setThemeOpen(false)}
        />
        <View
          style={{
            backgroundColor: colors.BG,
            paddingBottom: 24,
            paddingTop: 12,
            paddingHorizontal: 16,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderTopWidth: 1,
            borderColor: colors.BORDER,
          }}
        >
          <View
            style={{
              alignSelf: "center",
              width: 40,
              height: 5,
              borderRadius: 3,
              backgroundColor: colors.BORDER,
              marginBottom: 12,
            }}
          />
          <ScrollView>
            <Text
              style={{
                color: colors.TEXT,
                fontSize: 18,
                fontWeight: "700",
                marginBottom: 12,
              }}
            >
              Theme
            </Text>

            <Text style={{ color: colors.MUTED, marginBottom: 8 }}>Mode</Text>
            {(["light", "dark"] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor:
                    mode === m ? colors.ACCENT : colors.BORDER,
                  backgroundColor: colors.CARD,
                  marginBottom: 8,
                }}
              >
                <Text
                  style={{
                    color: mode === m ? colors.ACCENT : colors.TEXT,
                    fontWeight: mode === m ? "700" : "500",
                  }}
                >
                  {m[0].toUpperCase() + m.slice(1)}
                </Text>
              </Pressable>
            ))}

            <Text style={{ color: colors.MUTED, marginVertical: 8 }}>
              Accent {proActive ? "" : "(Pro)"}
            </Text>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              {[
                "#1D9BF0",
                "#F59E0B",
                "#10B981",
                "#EF4444",
                "#8B5CF6",
                "#14B8A6",
              ].map((hex) => (
                <Pressable
                  key={hex}
                  onPress={() => handleAccentPress(hex)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    borderWidth: 2,
                    borderColor:
                      hex === accent && proActive
                        ? colors.TEXT
                        : "transparent",
                    backgroundColor: hex,
                    opacity: proActive ? 1 : 0.55,
                  }}
                />
              ))}
            </View>

            {!proActive && (
              <Text
                style={{
                  color: colors.MUTED,
                  fontSize: 12,
                  marginTop: 6,
                }}
              >
                Accent colors are part of Pro. Tap a color to see Pro options.
              </Text>
            )}

            <Pressable
              onPress={() => setThemeOpen(false)}
              style={{
                marginTop: 20,
                alignSelf: "flex-end",
                paddingVertical: 10,
                paddingHorizontal: 16,
                borderRadius: 12,
                backgroundColor: colors.ACCENT,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>Done</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const AVATAR_SIZE = 78;

const makeStyles = (colors: ThemeTokens) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },

    card: { margin: 16, borderWidth: 1, borderRadius: 14, padding: 14 },
    shadow: {
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3,
    },

    heroRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 8,
    },

    avatarWrap: { width: AVATAR_SIZE, height: AVATAR_SIZE },
    avatar: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      borderWidth: 2,
    },
    avatarFallback: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
    },
    avatarText: {
      color: "#fff",
      fontWeight: "800",
      fontSize: 22,
    },

    camFab: {
      position: "absolute",
      right: -2,
      bottom: -2,
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
    },

    titleName: { fontWeight: "900", fontSize: 20 },
    email: { marginTop: 2, fontSize: 13 },

    planRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 6,
      marginBottom: 4,
    },
    planLabel: {
      fontWeight: "900",
      fontSize: 14,
    },
    planCta: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 40,
      maxWidth: 180,
      flexShrink: 0,
      alignSelf: "flex-start",
    },
    planCtaText: {
      fontWeight: "800",
      fontSize: 13,
    },
    restoreLink: {
      alignSelf: "flex-start",
      marginBottom: 4,
    },
    restoreLinkText: {
      fontSize: 12,
      textDecorationLine: "underline",
    },

    sectionLabel: {
      marginTop: 8,
      marginBottom: 6,
      fontWeight: "900",
      fontSize: 12,
      letterSpacing: 0.3,
    },

    inputLabel: { fontWeight: "700", marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "ios" ? 10 : 8,
      fontSize: 16,
      marginBottom: 6,
    },
    helper: { fontSize: 12, marginBottom: 8 },

    btnPrimary: {
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    btnDisabled: { opacity: 0.6 },
    btnPrimaryText: { color: "#fff", fontWeight: "900" },

    rowButtons: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 6,
      alignItems: "center",
    },
    btnOutline: {
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      backgroundColor: "transparent",
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      justifyContent: "center",
      flexBasis: "48%", // pills, 2 per row where possible
      maxWidth: "48%",
    },
    btnOutlineText: { fontWeight: "800" },

    muted: {},

    sheetWrap: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: "flex-end",
      alignItems: "stretch",
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    sheetCard: {
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      borderWidth: 1,
      padding: 12,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 4,
      marginBottom: 4,
    },
    sheetTitle: { fontWeight: "900", fontSize: 16 },
    sheetRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 10,
      borderRadius: 12,
      borderWidth: 1,
      marginTop: 8,
      backgroundColor: colors.CARD,
    },
    sheetRowText: { fontWeight: "800", flex: 1 },
    sheetDangerRow: {
      backgroundColor: "rgba(239,68,68,0.9)",
      borderColor: "rgba(239,68,68,1)",
    },
  });
