// app/legal/privacy.tsx
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
// ✅ Updated email to match your site
const CONTACT_EMAIL = "dialedoffroadapp@gmail.com";

export default function PrivacyScreen() {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

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
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={styles.card}>
          <Text style={styles.muted}>Last updated {today}</Text>

          {/* Overview */}
          <Section title="Overview">
            <Text style={styles.body}>
              This Privacy Policy explains how {COMPANY} (“we,” “us”) collects,
              uses, and shares information when you use the app (“Service”).
            </Text>
          </Section>

          {/* Information We Collect */}
          <Section title="Information We Collect">
            <Bullet>
              Account info you provide (e.g., email, display name).
            </Bullet>
            <Bullet>
              App content you add (e.g., bike details, sessions, notes).
            </Bullet>
            <Bullet>
              Usage data (app interactions, device type, OS version, crash
              logs).
            </Bullet>
            <Bullet>
              Transaction & subscription metadata from app stores
              (Apple/Google). We do not process card numbers in-app.
            </Bullet>
          </Section>

          {/* How We Use Information */}
          <Section title="How We Use Information">
            <Bullet>
              Provide and maintain the Service and your account.
            </Bullet>
            <Bullet>
              Generate and store your tunes/sessions at your direction.
            </Bullet>
            <Bullet>Monitor performance, fix bugs, and improve features.</Bullet>
            <Bullet>
              Prevent abuse, secure the Service, and comply with law.
            </Bullet>
            <Bullet>
              Communicate about updates, security notices, or policy changes.
            </Bullet>
          </Section>

          {/* Sharing */}
          <Section title="Sharing">
            <Text style={styles.body}>We share information with:</Text>
            <Bullet>
              Service providers (e.g., hosting, databases, analytics, error
              logging).
            </Bullet>
            <Bullet>
              App stores and payment platforms to manage subscriptions.
            </Bullet>
            <Bullet>
              Law enforcement or regulators when required by law.
            </Bullet>
            <Text style={[styles.body, { marginTop: 6 }]}>
              We do not sell your personal information.
            </Text>
          </Section>

          {/* Data Storage & Retention */}
          <Section title="Data Storage & Retention">
            <Text style={styles.body}>
              Data is stored with reputable cloud providers. We keep
              information only as long as reasonably necessary for the purposes
              above, or as required by law. You may request deletion of your
              account data (see “Your Choices”).
            </Text>
          </Section>

          {/* Your Choices & Rights */}
          <Section title="Your Choices & Rights">
            <Bullet>Access or update your profile data in the app.</Bullet>
            <Bullet>
              Export your data from the Profile page (“Export My Data”).
            </Bullet>
            <Bullet>
              Request deletion by contacting us at{" "}
              <Text style={styles.link}>{CONTACT_EMAIL}</Text>.
            </Bullet>
            <Bullet>
              Uninstall the app or stop using the Service at any time.
            </Bullet>
          </Section>

          {/* Children */}
          <Section title="Children">
            <Text style={styles.body}>
              The Service is not directed to children under 13, and we do not
              knowingly collect personal information from them.
            </Text>
          </Section>

          {/* International Users */}
          <Section title="International Users">
            <Text style={styles.body}>
              The Service may be operated and data processed in the United
              States. By using the Service, you consent to processing in the
              U.S. and anywhere we or our providers operate.
            </Text>
          </Section>

          {/* Changes */}
          <Section title="Changes to this Policy">
            <Text style={styles.body}>
              We may update this Policy from time to time. If changes are
              material, we will provide reasonable notice (e.g., in-app notice
              or email).
            </Text>
          </Section>

          {/* Contact */}
          <Section title="Contact">
            <Text style={styles.body}>
              Questions? Email{" "}
              <Text style={styles.link}>{CONTACT_EMAIL}</Text>.
            </Text>
          </Section>

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

/* sections */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.h2}>{title}</Text>
      <View style={{ marginTop: 6 }}>{children}</View>
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={[styles.body, { flex: 1 }]}>{children}</Text>
    </View>
  );
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
  h2: { color: COLORS.TEXT, fontWeight: "900" },
  body: { color: COLORS.TEXT, lineHeight: 20 },
  muted: { color: COLORS.MUTED, marginBottom: 8 },
  link: { color: COLORS.ACCENT, fontWeight: "800" },

  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 6,
  },
  bulletDot: { color: COLORS.TEXT, fontSize: 16, lineHeight: 20 },

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
