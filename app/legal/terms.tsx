// app/legal/terms.tsx
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { COLORS } from "../../constants/theme";

const COMPANY = "Atlas Systems LLC";
// ✅ Updated contact email to match your site
const CONTACT_EMAIL = "dialedoffroadapp@gmail.com";
const STATE = "Idaho";

export default function TermsScreen() {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  // Always go to /login (no history)
  const goLogin = () => router.replace("/login");

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.BG }}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={goLogin}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={20} color={COLORS.TEXT} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Terms of Service</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={styles.card}>
          <Text style={styles.muted}>Last updated {today}</Text>

          <H2>1. Agreement to Terms</H2>
          <P>
            By using the app (“Service”), you agree to these terms. If you do
            not agree, do not use the Service.
          </P>

          <H2>2. License</H2>
          <P>
            We grant you a limited, non-transferable license to use the Service
            for personal, non-commercial purposes.
          </P>

          <H2>3. No Professional Advice (Important)</H2>
          <P>
            The suspension “tunes” and setup suggestions are informational only
            and are not professional advice. Vehicle adjustments can affect
            handling and safety. You are solely responsible for verifying
            settings against your owner’s manual and testing in a safe
            environment.
          </P>

          <H2>4. Acceptable Use</H2>
          <P>
            Do not misuse the Service (reverse engineer, scrape, harm, or break
            laws).
          </P>

          <H2>5. Subscriptions & Billing</H2>
          <P>
            If you subscribe, fees are billed via the App Store/Play Store.
            Cancel anytime in your store account settings. We do not handle
            billing directly.
          </P>

          <H2>6. Disclaimers</H2>
          <P>THE SERVICE IS PROVIDED “AS IS” WITHOUT WARRANTIES OF ANY KIND.</P>

          <H2>7. Limitation of Liability</H2>
          <P>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, {COMPANY} IS NOT LIABLE FOR
            ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
            DAMAGES.
          </P>

          <H2>8. Termination</H2>
          <P>We may suspend or end access for breaches of these terms.</P>

          <H2>9. Governing Law</H2>
          <P>These terms are governed by the laws of {STATE}, USA.</P>

          <H2>10. Contact</H2>
          <P>
            Questions? Email <Text style={styles.link}>{CONTACT_EMAIL}</Text>.
          </P>

          <Pressable
            onPress={goLogin}
            style={[styles.closeBtn, { marginTop: 16 }]}
            accessibilityRole="button"
          >
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

/* helpers */
function H2({ children }: { children: React.ReactNode }) {
  return <Text style={styles.h2}>{children}</Text>;
}
function P({ children }: { children: React.ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

/* styles */
const styles = StyleSheet.create({
  header: {
    paddingTop: Platform.OS === "ios" ? 52 : 16,
    paddingBottom: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.BG,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  backText: { color: COLORS.TEXT, fontWeight: "800" },
  headerTitle: { color: COLORS.TEXT, fontWeight: "900", fontSize: 16 },

  card: {
    backgroundColor: COLORS.CARD,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 14,
    padding: 16,
  },
  h2: { color: COLORS.TEXT, fontWeight: "900", marginTop: 10 },
  body: { color: COLORS.TEXT, marginTop: 8, lineHeight: 20 },
  muted: { color: COLORS.MUTED, marginBottom: 8 },
  link: { color: COLORS.ACCENT, fontWeight: "800" },

  closeBtn: {
    alignSelf: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.CARD,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  closeBtnText: { color: COLORS.TEXT, fontWeight: "800" },
});
