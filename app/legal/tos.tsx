// app/legal/terms.tsx
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { COLORS } from "../../constants/theme";

const COMPANY = "Atlas Systems LLC";
const STATE = "Idaho";
const COUNTY = "Ada County";
const FEDERAL_COURT = "U.S. District Court for the District of Idaho";

export default function TermsScreen() {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const goBack = () => {
    try {
      // expo-router doesn't always expose canGoBack cross-platform; safe fallback:
      router.back();
    } catch {
      router.replace("/login");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.BG }}>
      {/* Inline header (so there’s always a way out) */}
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} style={styles.backBtn} accessibilityRole="button">
          <Ionicons name="chevron-back" size={20} color={COLORS.TEXT} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Terms of Service</Text>
        <View style={{ width: 60 }} />{/* spacer */}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={styles.card}>
          <Text style={styles.muted}>Last updated {today}</Text>

          <Section n="1." title="Agreement to Terms">
            By using the app (“Service”), you agree to these Terms. If you do not agree, do not use the Service.
          </Section>

          <Section n="2." title="License">
            We grant you a limited, non-transferable license to use the Service for personal, non-commercial purposes.
          </Section>

          <Section n="3." title="No Professional Advice (Important)">
            The suspension “tunes” and setup suggestions are informational only and are not professional advice.
            Vehicle adjustments can affect handling and safety. You are solely responsible for verifying settings
            against your owner’s manual and testing in a safe environment.
          </Section>

          <Section n="4." title="Acceptable Use">
            Do not misuse the Service (e.g., reverse engineer, scrape, harm, or break laws).
          </Section>

          <Section n="5." title="Subscriptions & Billing">
            If you subscribe, fees are billed via the App Store/Play Store. Cancel anytime in your store account
            settings. {COMPANY} does not handle billing directly.
          </Section>

          <Section n="6." title="Disclaimers">
            THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE,” WITHOUT WARRANTIES OF ANY KIND.
          </Section>

          <Section n="7." title="Limitation of Liability">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, {COMPANY} IS NOT LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
            CONSEQUENTIAL, OR PUNITIVE DAMAGES.
          </Section>

          <Section n="8." title="Termination">
            We may suspend or end access for breaches of these Terms.
          </Section>

          <Section n="9." title="Governing Law & Venue">
            These Terms are governed by the laws of the State of {STATE}, U.S.A., without regard to conflict-of-law rules.
            You and {COMPANY} agree to the exclusive jurisdiction and venue of the state courts located in {COUNTY}, {STATE},
            or the {FEDERAL_COURT}, and each party waives any objection to such courts.
          </Section>

          <Section n="10." title="Contact">
            Questions? Email <Text style={styles.link}>atlassystems30@gmail.com</Text>.
          </Section>

          <Pressable onPress={goBack} style={[styles.closeBtn, { marginTop: 16 }]} accessibilityRole="button">
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.h2}>{n} {title}</Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

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
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 8 },
  backText: { color: COLORS.TEXT, fontWeight: "800" },
  headerTitle: { color: COLORS.TEXT, fontWeight: "900", fontSize: 16 },

  card: {
    backgroundColor: COLORS.CARD,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 14,
    padding: 16,
  },
  h2: { color: COLORS.TEXT, fontWeight: "900", marginTop: 6 },
  body: { color: COLORS.TEXT, marginTop: 6, lineHeight: 20 },
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
