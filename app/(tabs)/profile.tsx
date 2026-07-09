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
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import RevenueCatUI, { PAYWALL_RESULT } from "react-native-purchases-ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../../components/Toast";
import type { ThemeTokens } from "../../constants/theme";
import {
  hasPurchasedThisSession,
  isPro,
  markPurchasedThisSession,
  resetPurchases,
  restorePurchases,
  syncProFromRevenueCat,
} from "../../lib/purchases";
import { isProfane } from "../../lib/profanity";
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

const SUPPORT_EMAIL = "support@dialedoffroad.com";

const hexToRgba = (hex: string, a: number) => {
  const n = hex.replace("#", "");
  const bigint = parseInt(
    n.length === 3
      ? n.split("").map((c) => c + c).join("")
      : n,
    16
  );
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

export default function ProfileScreen() {
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, mode, setMode, accent, setAccent } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [originalName, setOriginalName] = useState<string>("");

  const [planLabel, setPlanLabel] = useState<"Free" | "Pro">("Free");
  const [proActive, setProActive] = useState(false);

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
    if (isProfane(displayName)) {
      toast.show("Please choose a different name.", { kind: "error" });
      return;
    }
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user?.id) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .upsert({
          user_id: user.id,
          display_name: displayName.trim() || null,
        });
      if (error) throw error;
      setOriginalName(displayName.trim());
      toast.show("Profile saved", { kind: "success" });
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
      await resetPurchases();
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
    toast.show("Data export is coming soon.", { kind: "info" });
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
      await resetPurchases();
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
        extFromUri && extFromUri.length <= 5
          ? extFromUri.toLowerCase()
          : "jpg";

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
      toast.show("Photo updated", { kind: "success" });
    } catch (e: any) {
      console.error("Avatar upload failed", e);
      toast.show(e?.message ?? "Avatar upload failed", { kind: "error" });
    } finally {
      setUploading(false);
    }
  };

  // Suggestions & Feedback email
  const openSupportEmail = async () => {
    try {
      const subject = encodeURIComponent(
        "Dialed Offroad – Suggestions & Feedback"
      );
      const body = encodeURIComponent(
        "Hey Dialed Offroad team,\n\nHere's some feedback or a suggestion:\n\n"
      );
      const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        toast.show("Couldn't open your email app.", { kind: "error" });
        return;
      }
      await Linking.openURL(url);
    } catch {
      toast.show("Couldn't open your email app.", { kind: "error" });
    }
  };

  // ---------- RevenueCat Paywall ----------
  const openPaywall = async () => {
    // Once a purchase succeeded this session, never present the paywall again
    // — refresh state instead.
    if (hasPurchasedThisSession()) {
      await syncProFromRevenueCat();
      await loadProfile();
      toast.show("You're already Pro", { kind: "success" });
      return;
    }
    try {
      const result = await RevenueCatUI.presentPaywall({
        dismissAutomatically: true,
      });

      if (
        result === PAYWALL_RESULT.PURCHASED ||
        result === PAYWALL_RESULT.RESTORED
      ) {
        markPurchasedThisSession();
        await syncProFromRevenueCat();
        await loadProfile();
        toast.show("Pro unlocked", { kind: "success" });
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
      if (isPro(info)) markPurchasedThisSession();

      await syncProFromRevenueCat();
      await loadProfile();

      if (isPro(info)) {
        toast.show("Pro restored", { kind: "success" });
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

  // Accent handler: free users open RevenueCat paywall
  const handleAccentPress = (hex: string) => {
    if (!proActive) {
      openPaywall();
      return;
    }
    setAccent(hex);
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.BG }]}>
        <ActivityIndicator color={colors.TEXT} />
        <Text style={[styles.mutedText, { marginTop: 8 }]}>
          Loading profile…
        </Text>
      </View>
    );
  }

  const managePlanLabel = proActive ? "Manage" : "Go Pro";

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: undefined })}
      style={{ flex: 1, backgroundColor: colors.BG }}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={{ flex: 1, backgroundColor: colors.BG }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingTop: insets.top + 8,
              paddingBottom: 32,
              paddingHorizontal: 16,
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
          >
            {/* ── Header card: avatar + name + email ── */}
            <View style={styles.card}>
              <View style={styles.heroRow}>
                <Pressable
                  onPress={pickAndUploadAvatar}
                  style={styles.avatarWrap}
                >
                  {avatarUrl ? (
                    <Image
                      source={{ uri: avatarUrl }}
                      style={styles.avatar}
                    />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarText}>
                        {(displayName || email || "?")
                          .slice(0, 1)
                          .toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.camFab}>
                    {uploading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Ionicons name="camera" size={12} color="#fff" />
                    )}
                  </View>
                </Pressable>

                <View style={styles.heroTextWrap}>
                  <Text
                    style={styles.heroName}
                    numberOfLines={1}
                  >
                    {displayName || "Your Name"}
                  </Text>
                  <Text
                    style={styles.heroEmail}
                    numberOfLines={1}
                  >
                    {email}
                  </Text>
                </View>
              </View>
            </View>

            {/* ── Plan card ── */}
            <View style={[styles.card, { marginTop: 12 }]}>
              <View style={styles.planRow}>
                <View style={styles.planLeft}>
                  <View
                    style={[
                      styles.planPill,
                      proActive
                        ? {
                            backgroundColor: hexToRgba(accent, 0.14),
                          }
                        : undefined,
                    ]}
                  >
                    <Text
                      style={[
                        styles.planPillText,
                        proActive
                          ? { color: colors.ACCENT }
                          : undefined,
                      ]}
                    >
                      {planLabel}
                    </Text>
                  </View>
                  <Text style={styles.planLabel}>
                    {planLabel} Plan
                  </Text>
                </View>

                <Pressable onPress={openPaywall} hitSlop={8}>
                  <Text style={styles.planManageText}>
                    {managePlanLabel}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.planDivider} />

              <Pressable
                onPress={onRestorePurchases}
                style={styles.restoreLink}
              >
                <Text style={styles.restoreLinkText}>
                  Restore Purchases
                </Text>
              </Pressable>
            </View>

            {/* ── Profile / Display Name card ── */}
            <View style={[styles.card, { marginTop: 12 }]}>
              <Text style={styles.sectionLabel}>PROFILE</Text>

              <Text style={styles.inputLabel}>Display Name</Text>
              <TextInput
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your name"
                placeholderTextColor={colors.MUTED}
                style={styles.input}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
              <Text style={styles.helper}>
                This appears on saved sessions you share.
              </Text>

              <Pressable
                onPress={onSave}
                style={[
                  styles.btnSave,
                  isDirty
                    ? { backgroundColor: colors.ACCENT }
                    : styles.btnSaved,
                ]}
                disabled={!isDirty || saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text
                    style={[
                      styles.btnSaveText,
                      !isDirty && styles.btnSavedText,
                    ]}
                  >
                    {isDirty ? "Save" : "Saved"}
                  </Text>
                )}
              </Pressable>
            </View>

            {/* ── Account card (2×2 grid) ── */}
            <View style={[styles.card, { marginTop: 12 }]}>
              <Text style={styles.sectionLabel}>ACCOUNT</Text>

              <View style={styles.gridRow}>
                <Pressable
                  onPress={onSignOut}
                  style={styles.gridBtn}
                >
                  <Ionicons
                    name="log-out-outline"
                    size={16}
                    color={colors.TEXT}
                  />
                  <Text style={styles.gridBtnText}>Sign Out</Text>
                </Pressable>

                <Pressable
                  onPress={onExportData}
                  style={styles.gridBtn}
                >
                  <Ionicons
                    name="download-outline"
                    size={16}
                    color={colors.TEXT}
                  />
                  <Text style={styles.gridBtnText}>Export Data</Text>
                </Pressable>
              </View>

              <View style={[styles.gridRow, { marginTop: 10 }]}>
                <Pressable
                  onPress={() => setThemeOpen(true)}
                  style={styles.gridBtn}
                >
                  <Ionicons
                    name="color-palette-outline"
                    size={16}
                    color={colors.TEXT}
                  />
                  <Text style={styles.gridBtnText}>Theme</Text>
                </Pressable>

                <Pressable
                  onPress={openSupportEmail}
                  style={styles.gridBtn}
                >
                  <Ionicons
                    name="mail-outline"
                    size={16}
                    color={colors.TEXT}
                  />
                  <Text style={styles.gridBtnText}>Feedback</Text>
                </Pressable>
              </View>
            </View>

            {/* ── Delete account — recessed text link ── */}
            <Pressable
              onPress={() => setConfirmDelete(true)}
              style={styles.deleteLink}
            >
              <Ionicons
                name="trash-outline"
                size={13}
                color={colors.ERROR}
                style={{ opacity: 0.7 }}
              />
              <Text style={styles.deleteLinkText}>Delete account</Text>
            </Pressable>
          </ScrollView>

          {/* ── Delete confirm dialog ── */}
          {confirmDelete && (
            <View style={styles.modalWrap} pointerEvents="box-none">
              <Pressable
                style={styles.backdrop}
                onPress={() => !deleting && setConfirmDelete(false)}
              />
              <View style={styles.confirmCard}>
                <Text style={styles.confirmTitle}>Delete account?</Text>
                <Text style={styles.confirmSub}>
                  This will permanently remove your account and all
                  associated data.
                </Text>
                <View style={{ height: 16 }} />
                <View style={styles.confirmFooter}>
                  <Pressable
                    onPress={() => setConfirmDelete(false)}
                    style={styles.btnCancel}
                    disabled={deleting}
                  >
                    <Text style={styles.btnCancelText}>Cancel</Text>
                  </Pressable>
                  <View style={{ width: 10 }} />
                  <Pressable
                    onPress={actuallyDeleteAccount}
                    style={[
                      styles.btnDanger,
                      deleting && { opacity: 0.6 },
                    ]}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.btnDangerText}>
                        Yes, delete
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          )}

          {/* ── Theme modal — theme-aware ── */}
          <Modal
            visible={themeOpen}
            animationType="slide"
            transparent
            onRequestClose={() => setThemeOpen(false)}
          >
            <Pressable
              style={styles.themeBackdrop}
              onPress={() => setThemeOpen(false)}
            />
            <View style={styles.themeSheet}>
              <View style={styles.themeDragHandle} />
              <ScrollView>
                <Text style={styles.themeTitle}>Theme</Text>

                <Text style={styles.themeSubLabel}>Mode</Text>
                {(["light", "dark"] as const).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setMode(m)}
                    style={[
                      styles.themeModeBtn,
                      {
                        borderColor:
                          mode === m ? colors.ACCENT : colors.BORDER,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color:
                          mode === m ? colors.ACCENT : colors.TEXT,
                        fontWeight: mode === m ? "700" : "500",
                      }}
                    >
                      {m[0].toUpperCase() + m.slice(1)}
                    </Text>
                  </Pressable>
                ))}

                <Text style={[styles.themeSubLabel, { marginTop: 8 }]}>
                  Accent {proActive ? "" : "(Pro)"}
                </Text>
                <View style={styles.swatchRow}>
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
                      style={[
                        styles.swatch,
                        {
                          backgroundColor: hex,
                          borderColor:
                            hex === accent && proActive
                              ? colors.TEXT
                              : "transparent",
                          opacity: proActive ? 1 : 0.55,
                        },
                      ]}
                    />
                  ))}
                </View>

                {!proActive && (
                  <Text style={styles.themeProHint}>
                    Accent colors are part of Pro. Tap a color to see
                    Pro options.
                  </Text>
                )}

                <Pressable
                  onPress={() => setThemeOpen(false)}
                  style={styles.themeDoneBtn}
                >
                  <Text style={styles.themeDoneText}>Done</Text>
                </Pressable>
              </ScrollView>
            </View>
          </Modal>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

/* --------------------------------- Styles --------------------------------- */

const AVATAR_SIZE = 60;

const makeStyles = (C: ThemeTokens) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    mutedText: { color: C.MUTED },

    /* ── Card shell ── */
    card: {
      backgroundColor: C.CARD,
      borderWidth: 1,
      borderColor: C.BORDER,
      borderRadius: 16,
      padding: 16,
    },

    /* ── Header / hero ── */
    heroRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    avatarWrap: { width: AVATAR_SIZE, height: AVATAR_SIZE },
    avatar: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      borderWidth: 2,
      borderColor: C.BORDER,
    },
    avatarFallback: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      backgroundColor: C.SURFACE_ALT ?? C.INK,
      borderColor: C.BORDER,
    },
    avatarText: {
      color: C.TEXT,
      fontWeight: "800",
      fontSize: 20,
    },
    camFab: {
      position: "absolute",
      right: -2,
      bottom: -2,
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      backgroundColor: C.ACCENT,
      borderColor: C.CARD,
    },
    heroTextWrap: {
      flex: 1,
      marginLeft: 14,
      minWidth: 0,
    },
    heroName: {
      color: C.TEXT,
      fontWeight: "700",
      fontSize: 19,
    },
    heroEmail: {
      color: C.MUTED,
      fontSize: 13,
      marginTop: 2,
    },

    /* ── Plan card ── */
    planRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    planLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    planPill: {
      backgroundColor: C.CHIP_BG ?? "rgba(255,255,255,0.05)",
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    planPillText: {
      color: C.MUTED,
      fontWeight: "800",
      fontSize: 11,
    },
    planLabel: {
      color: C.TEXT,
      fontWeight: "800",
      fontSize: 14,
    },
    planManageText: {
      color: C.ACCENT,
      fontWeight: "700",
      fontSize: 13,
    },
    planDivider: {
      height: 1,
      backgroundColor: C.BORDER,
      marginVertical: 12,
    },
    restoreLink: {
      alignSelf: "flex-start",
    },
    restoreLinkText: {
      color: C.MUTED,
      fontSize: 12,
      textDecorationLine: "underline",
    },

    /* ── Section labels ── */
    sectionLabel: {
      color: C.MUTED,
      fontWeight: "700",
      fontSize: 11,
      letterSpacing: 0.6,
      marginBottom: 10,
    },

    /* ── Display Name input ── */
    inputLabel: {
      color: C.MUTED,
      fontWeight: "700",
      fontSize: 13,
      marginBottom: 6,
    },
    input: {
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: C.INPUT_BG ?? C.SURFACE_ALT ?? C.CARD,
      color: C.INPUT_TEXT ?? C.TEXT,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "ios" ? 12 : 10,
      fontSize: 15,
      marginBottom: 6,
    },
    helper: {
      color: C.MUTED,
      fontSize: 12,
      marginBottom: 10,
    },

    /* ── Save button (fixed disabled state) ── */
    btnSave: {
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    btnSaved: {
      backgroundColor: C.CHIP_BG ?? "rgba(255,255,255,0.05)",
    },
    btnSaveText: {
      color: "#fff",
      fontWeight: "900",
    },
    btnSavedText: {
      color: C.MUTED,
    },

    /* ── Account grid (2×2) ── */
    gridRow: {
      flexDirection: "row",
      gap: 10,
    },
    gridBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderWidth: 1,
      borderColor: C.BORDER,
      borderRadius: 12,
      paddingVertical: 12,
      backgroundColor: C.CARD,
    },
    gridBtnText: {
      color: C.TEXT,
      fontWeight: "800",
      fontSize: 13,
    },

    /* ── Delete account (recessed text) ── */
    deleteLink: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 14,
      marginTop: 10,
    },
    deleteLinkText: {
      color: C.ERROR,
      fontWeight: "600",
      fontSize: 13,
      opacity: 0.7,
    },

    /* ── Delete confirm dialog ── */
    modalWrap: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: "center",
      alignItems: "center",
      zIndex: 1000,
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: C.OVERLAY,
    },
    confirmCard: {
      width: "86%",
      backgroundColor: C.CARD,
      borderColor: C.BORDER,
      borderWidth: 1,
      borderRadius: 16,
      padding: 20,
    },
    confirmTitle: {
      color: C.TEXT,
      fontWeight: "900",
      fontSize: 17,
    },
    confirmSub: {
      color: C.MUTED,
      marginTop: 4,
      fontSize: 14,
      lineHeight: 20,
    },
    confirmFooter: {
      flexDirection: "row",
      alignItems: "center",
    },
    btnCancel: {
      borderColor: C.BORDER,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
      flex: 1,
    },
    btnCancelText: { color: C.TEXT, fontWeight: "800" },
    btnDanger: {
      backgroundColor: C.ERROR,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    btnDangerText: { color: "#fff", fontWeight: "900" },

    /* ── Theme modal (theme-aware) ── */
    themeBackdrop: {
      flex: 1,
      backgroundColor: C.OVERLAY,
    },
    themeSheet: {
      backgroundColor: C.CARD,
      paddingBottom: 24,
      paddingTop: 12,
      paddingHorizontal: 16,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      borderTopWidth: 1,
      borderColor: C.BORDER,
    },
    themeDragHandle: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: C.BORDER,
      marginBottom: 14,
    },
    themeTitle: {
      color: C.TEXT,
      fontSize: 18,
      fontWeight: "700",
      marginBottom: 12,
    },
    themeSubLabel: {
      color: C.MUTED,
      marginBottom: 8,
    },
    themeModeBtn: {
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      backgroundColor: C.CARD,
      marginBottom: 8,
    },
    swatchRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    swatch: {
      width: 36,
      height: 36,
      borderRadius: 999,
      borderWidth: 2,
    },
    themeProHint: {
      color: C.MUTED,
      fontSize: 12,
      marginTop: 6,
    },
    themeDoneBtn: {
      marginTop: 20,
      alignSelf: "flex-end",
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 12,
      backgroundColor: C.ACCENT,
    },
    themeDoneText: {
      color: "#fff",
      fontWeight: "700",
    },
  });
