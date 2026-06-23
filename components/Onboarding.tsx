import React, { useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Line, Path, Polygon, Rect } from "react-native-svg";

type OnboardingProps = {
  onFinish: () => void;
};

// ─── SVG Icons ────────────────────────────────────────────────────────────────

const XIcon = () => (
  <Svg width={14} height={14} viewBox="0 0 12 12" fill="none">
    <Line x1={2} y1={2} x2={10} y2={10} stroke="#E24B4A" strokeWidth={1.8} strokeLinecap="round" />
    <Line x1={10} y1={2} x2={2} y2={10} stroke="#E24B4A" strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);

const CheckIcon = () => (
  <Svg width={14} height={14} viewBox="0 0 12 12" fill="none">
    <Path d="M2 6.5L4.5 9L10 3" stroke="#1D9BF0" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const StarIcon = () => (
  <Svg width={9} height={9} viewBox="0 0 9 9" fill="#1D9BF0">
    <Polygon points="4.5,0.5 5.5,3.3 8.5,3.3 6.2,5.1 7.1,8 4.5,6.3 1.9,8 2.8,5.1 0.5,3.3 3.5,3.3" />
  </Svg>
);

const LockIcon = () => (
  <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
    <Rect x={2} y={6} width={10} height={7} rx={2} stroke="#1D9BF0" strokeWidth={1.4} />
    <Path d="M4.5 6V4.5a2.5 2.5 0 015 0V6" stroke="#1D9BF0" strokeWidth={1.4} strokeLinecap="round" />
    <Line x1={7} y1={8} x2={7} y2={10} stroke="#1D9BF0" strokeWidth={1.4} strokeLinecap="round" />
  </Svg>
);

const LinesIcon = () => (
  <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
    <Line x1={2} y1={4} x2={12} y2={4} stroke="#1D9BF0" strokeWidth={1.4} strokeLinecap="round" />
    <Line x1={2} y1={7} x2={9} y2={7} stroke="#1D9BF0" strokeWidth={1.4} strokeLinecap="round" />
    <Line x1={2} y1={10} x2={11} y2={10} stroke="#1D9BF0" strokeWidth={1.4} strokeLinecap="round" />
  </Svg>
);

const ClockIcon = () => (
  <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
    <Path d="M7 1.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z" stroke="#1D9BF0" strokeWidth={1.4} />
    <Line x1={7} y1={4} x2={7} y2={7} stroke="#1D9BF0" strokeWidth={1.4} strokeLinecap="round" />
    <Line x1={7} y1={7} x2={9.5} y2={9} stroke="#1D9BF0" strokeWidth={1.4} strokeLinecap="round" />
  </Svg>
);

// Small SVG icons for the clicker preview card
const SettingsIcon = () => (
  <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
    <Path d="M6 8a2 2 0 100-4 2 2 0 000 4z" stroke="#1D9BF0" strokeWidth={1.2} />
    <Path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.5 2.5l.7.7M8.8 8.8l.7.7M9.5 2.5l-.7.7M3.2 8.8l-.7.7" stroke="#1D9BF0" strokeWidth={1.2} strokeLinecap="round" />
  </Svg>
);

const RotateIcon = () => (
  <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
    <Path d="M1.5 6a4.5 4.5 0 018.3-2.4M10.5 6a4.5 4.5 0 01-8.3 2.4" stroke="#1D9BF0" strokeWidth={1.2} strokeLinecap="round" />
    <Path d="M9.8 1.5v2.1H7.7M2.2 10.5V8.4h2.1" stroke="#1D9BF0" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const DropletIcon = () => (
  <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
    <Path d="M6 1.5S3 5.5 3 7.5a3 3 0 006 0C9 5.5 6 1.5 6 1.5z" stroke="#1D9BF0" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// ─── Shared UI Components ──────────────────────────────────────────────────────

const TagPill = ({ label, green }: { label: string; green?: boolean }) => (
  <View style={[s.tagPill, green && s.tagPillGreen]}>
    <View style={[s.tagDot, green && s.tagDotGreen]} />
    <Text style={[s.tagText, green && s.tagTextGreen]}>{label}</Text>
  </View>
);

const NavDots = ({ total, active }: { total: number; active: number }) => (
  <View style={s.dotsRow}>
    {Array.from({ length: total }).map((_, i) => (
      <View key={i} style={[s.dot, i === active ? s.dotActive : s.dotInactive]} />
    ))}
  </View>
);

const Chip = ({ label, lit }: { label: string; lit?: boolean }) => (
  <View style={lit ? s.chipLit : s.chip}>
    <Text style={lit ? s.chipLitText : s.chipText}>{label}</Text>
  </View>
);

const Stars = () => (
  <View style={{ flexDirection: "row", gap: 2 }}>
    {[0, 1, 2, 3, 4].map((i) => (
      <StarIcon key={i} />
    ))}
  </View>
);

// ─── Clicker Preview (Slide 2, Step 3) ───────────────────────────────────────

const ClickerRow = ({
  icon,
  label,
  sub,
  value,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  value: string;
  unit: string;
}) => (
  <View style={s.clickerRow}>
    <View style={s.clickerIcon}>{icon}</View>
    <View style={{ flex: 1 }}>
      <Text style={s.clickerLabel}>{label}</Text>
      <Text style={s.clickerSub}>{sub}</Text>
    </View>
    <View style={{ alignItems: "flex-end" }}>
      <Text style={s.clickerValue}>{value}</Text>
      <Text style={s.clickerUnit}>{unit}</Text>
    </View>
  </View>
);

// ─── Slide 1 ──────────────────────────────────────────────────────────────────

const Slide1Content = () => (
  <>
    {/* Logo row */}
    <View style={s.logoRow}>
      <Image
        source={require("../assets/images/icon.png")}
        style={s.logoImg}
      />
      <Text style={s.wordmark}>
        Dialed <Text style={s.accent}>Offroad</Text>
      </Text>
    </View>

    {/* Badge */}
    <View style={{ marginBottom: 22 }}>
      <TagPill label="AI SUSPENSION TUNING" />
    </View>

    {/* Headline */}
    <Text style={s.h1}>
      {"Stop guessing\nyour "}
      <Text style={s.accent}>{"suspension."}</Text>
    </Text>

    {/* Body */}
    <Text style={s.body}>
      Factory settings weren't built for your weight, your terrain, or the way you ride.
    </Text>

    {/* Comparison card — large, fills available space */}
    <View style={s.s1CardWrap}>
      <View style={s.s1Card}>
        <View style={s.s1IconRow}>
          <View style={s.xBox}><XIcon /></View>
          <Text style={s.s1RowTextMuted}>Random YouTube settings</Text>
        </View>
        <View style={s.s1IconRow}>
          <View style={s.xBox}><XIcon /></View>
          <Text style={s.s1RowTextMuted}>Generic suspension charts</Text>
        </View>
        <View style={s.s1IconRow}>
          <View style={s.xBox}><XIcon /></View>
          <Text style={s.s1RowTextMuted}>Asking your buddy who rides different</Text>
        </View>
        <View style={s.divider} />
        <View style={s.s1IconRow}>
          <View style={s.checkBox}><CheckIcon /></View>
          <Text style={s.s1CheckText}>AI tuned to your bike, body, and terrain</Text>
        </View>
      </View>
    </View>
  </>
);

// ─── Slide 2 ──────────────────────────────────────────────────────────────────

const Slide2Content = () => (
  <>
    <View style={{ marginBottom: 14 }}>
      <TagPill label="HOW IT WORKS" />
    </View>

    <Text style={s.h1}>
      {"Three steps.\nOne perfect "}
      <Text style={s.accent}>{"baseline."}</Text>
    </Text>

    <View style={s.stepsWrap}>
      {/* Step 1 */}
      <View style={s.stepRow}>
        <View style={s.stepLeft}>
          <View style={s.numBox}><Text style={s.numText}>1</Text></View>
          <View style={s.connector} />
        </View>
        <View style={s.stepRight}>
          <Text style={s.stepTitle}>Add your bike + conditions</Text>
          <Text style={s.stepDesc}>Make, model, year, terrain, temp, and elevation.</Text>
          <View style={s.chipsRow}>
            <Chip label="KTM 250 SX-F" lit />
            <Chip label="Hardpack" lit />
            <Chip label="85°F" />
            <Chip label="3,200 ft" />
          </View>
        </View>
      </View>

      {/* Step 2 */}
      <View style={s.stepRow}>
        <View style={s.stepLeft}>
          <View style={s.numBox}><Text style={s.numText}>2</Text></View>
          <View style={s.connector} />
        </View>
        <View style={s.stepRight}>
          <Text style={s.stepTitle}>Tell us about you</Text>
          <Text style={s.stepDesc}>Weight, skill, ride style, goals, and what's bothering you.</Text>
          <View style={s.chipsRow}>
            <Chip label="185 lbs" />
            <Chip label="Stability" lit />
            <Chip label="Grip" lit />
          </View>
        </View>
      </View>

      {/* Step 3 */}
      <View style={[s.stepRow, { marginBottom: 0 }]}>
        <View style={s.stepLeft}>
          <View style={s.numBox}><Text style={s.numText}>3</Text></View>
        </View>
        <View style={s.stepRight}>
          <Text style={s.stepTitle}>Get exact clicker settings</Text>
          <Text style={[s.stepDesc, { marginBottom: 0 }]}>Fork comp, rebound, shock LSC, HSC, sag — all zero-referenced.</Text>
        </View>
      </View>
    </View>

    {/* Premium clicker preview — full-width, outside the timeline indent */}
    <View style={s.clickerCard}>
      <ClickerRow
        icon={<SettingsIcon />}
        label="Fork compression"
        sub="Clicks out from zero"
        value="16"
        unit="clicks"
      />
      <View style={s.clickerDivider} />
      <ClickerRow
        icon={<RotateIcon />}
        label="Shock rebound"
        sub="Clicks out from zero"
        value="12"
        unit="clicks"
      />
      <View style={s.clickerDivider} />
      <ClickerRow
        icon={<DropletIcon />}
        label="Air / AER pressure"
        sub="Spring pressure"
        value="10.6"
        unit="bar"
      />
    </View>
  </>
);

// ─── Slide 3 ──────────────────────────────────────────────────────────────────

const ReviewCard = ({
  initials,
  name,
  review,
}: {
  initials: string;
  name: string;
  review: string;
}) => (
  <View style={s.reviewCard}>
    <View style={s.reviewTop}>
      <View style={s.avatar}>
        <Text style={s.avatarText}>{initials}</Text>
      </View>
      <Text style={s.reviewName}>{name}</Text>
      <Stars />
    </View>
    <Text style={s.reviewText}>{review}</Text>
  </View>
);

const Slide3Content = () => (
  <View style={s.centeredSlide}>
    <View>
      <View style={{ marginBottom: 14 }}>
        <TagPill label="TRUSTED BY RIDERS" />
      </View>

      <Text style={s.h1}>
        {"Riders who know\nthe "}
        <Text style={s.accent}>{"difference."}</Text>
      </Text>

      {/* Stats */}
      <View style={s.statsGrid}>
        <View style={s.statCard}>
          <Text style={s.statNum}>
            19K<Text style={s.accent}>+</Text>
          </Text>
          <Text style={s.statLabel}>riders on the platform</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statNum}>
            5K<Text style={s.accent}>+</Text>
          </Text>
          <Text style={s.statLabel}>tunes generated</Text>
        </View>
      </View>

      {/* Reviews */}
      <View style={{ gap: 8 }}>
        <ReviewCard
          initials="MK"
          name="MotoKyle_88"
          review="Finally stopped guessing. My bike feels completely different — in a good way."
        />
        <ReviewCard
          initials="TR"
          name="TrailRipper_CO"
          review="Worth every penny. Used to spend hours tweaking — now it takes minutes."
        />
      </View>
    </View>
  </View>
);

// ─── Slide 4 ──────────────────────────────────────────────────────────────────

const PerkRow = ({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) => (
  <View style={s.perkRow}>
    <View style={s.perkIconBox}>{icon}</View>
    <View style={{ flex: 1 }}>
      <Text style={s.perkTitle}>{title}</Text>
      <Text style={s.perkDesc}>{desc}</Text>
    </View>
  </View>
);

const Slide4Content = () => (
  <View style={s.centeredSlide}>
    <View>
      <View style={{ marginBottom: 14 }}>
        <TagPill label="FREE TRIAL" green />
      </View>

      <Text style={[s.h1, s.h1Big]}>
        {"Your first\n7 days are\n"}
        <Text style={s.accent}>{"on us."}</Text>
      </Text>

      <Text style={s.body}>
        Add your bike, generate your tune, and feel the difference before you pay anything.
      </Text>

      <View style={s.perksWrap}>
        <PerkRow
          icon={<LockIcon />}
          title="Full tune unlocked"
          desc="Every clicker setting, sag target, and personalized test plan."
        />
        <PerkRow
          icon={<LinesIcon />}
          title="Save sessions"
          desc="Log every setup you've ridden. Track what worked at each track."
        />
        <PerkRow
          icon={<ClockIcon />}
          title="Ride and refine"
          desc="Rate your ride, get a second AI pass with targeted adjustments."
        />
      </View>

      <View style={s.priceRow}>
        <View>
          <Text style={s.priceLabel}>After your trial</Text>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
            <Text style={s.priceMain}>$7.99</Text>
            <Text style={s.priceSub}>/ month</Text>
          </View>
        </View>
        <View style={s.priceBadge}>
          <Text style={s.priceBadgeTop}>SAVE 37%</Text>
          <Text style={s.priceBadgeBottom}>$59.99 / yr</Text>
        </View>
      </View>
    </View>
  </View>
);

// ─── Root Component ────────────────────────────────────────────────────────────

const TOTAL = 4;

const Onboarding: React.FC<OnboardingProps> = ({ onFinish }) => {
  const [index, setIndex] = useState(0);

  const goTo = (i: number) => setIndex(Math.max(0, Math.min(TOTAL - 1, i)));

  const handleLeft = () => {
    if (index === 0) goTo(3); // Skip → slide 4
    else goTo(index - 1);
  };

  const handleRight = () => {
    if (index === TOTAL - 1) onFinish();
    else goTo(index + 1);
  };

  const leftLabel = index === 0 ? "Skip" : "Back";
  const rightLabel = index === TOTAL - 1 ? "Get Started" : "Next";

  return (
    <View style={s.root}>
      {/* Slide content */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {index === 0 && <Slide1Content />}
        {index === 1 && <Slide2Content />}
        {index === 2 && <Slide3Content />}
        {index === 3 && <Slide4Content />}
      </ScrollView>

      {/* Navigation — guaranteed spacing from content */}
      <NavDots total={TOTAL} active={index} />
      <View style={s.btnRow}>
        <Pressable style={s.btnSecondary} onPress={handleLeft}>
          <Text style={s.btnSecondaryText}>{leftLabel}</Text>
        </Pressable>
        <Pressable style={s.btnPrimary} onPress={handleRight}>
          <Text style={s.btnPrimaryText}>{rightLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
};

export default Onboarding;

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Root
  root: {
    flex: 1,
    backgroundColor: "#0B0C10",
    paddingHorizontal: 28,
    paddingTop: 52,
    paddingBottom: 44,
    overflow: "hidden",
  },

  // Scroll area
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 8,
  },

  // Vertically centered slide wrapper (slides 3 & 4)
  centeredSlide: {
    flex: 1,
    justifyContent: "center",
  },

  // Logo row (slide 1)
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 28,
  },
  logoImg: {
    width: 32,
    height: 32,
    borderRadius: 9,
  },
  wordmark: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // Tag pill (blue default, green variant for slide 4)
  tagPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(29,155,240,0.12)",
    borderWidth: 1,
    borderColor: "rgba(29,155,240,0.25)",
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  tagPillGreen: {
    backgroundColor: "rgba(48,209,88,0.14)",
    borderColor: "rgba(48,209,88,0.25)",
  },
  tagDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#1D9BF0",
  },
  tagDotGreen: {
    backgroundColor: "#30D158",
  },
  tagText: {
    color: "#5BC0F8",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.66,
  },
  tagTextGreen: {
    color: "#5FE085",
  },

  // Headlines
  h1: {
    fontSize: 36,
    fontWeight: "800",
    lineHeight: 39,
    letterSpacing: -0.8,
    color: "#FFFFFF",
    marginBottom: 14,
  },
  h1Big: {
    fontSize: 40,
    lineHeight: 43,
    letterSpacing: -1.0,
  },
  accent: {
    color: "#1D9BF0",
  },

  // Body
  body: {
    fontSize: 15,
    color: "rgba(255,255,255,0.6)",
    lineHeight: 24,
  },

  // Nav dots — marginTop guarantees content never collides
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 5,
    marginTop: 20,
    marginBottom: 14,
  },
  dot: {
    height: 5,
    borderRadius: 3,
  },
  dotActive: {
    width: 20,
    backgroundColor: "#1D9BF0",
  },
  dotInactive: {
    width: 6,
    backgroundColor: "#1E1E1E",
  },

  // Nav buttons
  btnRow: {
    flexDirection: "row",
    gap: 10,
  },
  btnSecondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#1E1E1E",
    borderRadius: 100,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "transparent",
  },
  btnSecondaryText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 15,
    fontWeight: "500",
  },
  btnPrimary: {
    flex: 2,
    backgroundColor: "#1D9BF0",
    borderRadius: 100,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnPrimaryText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },

  // ── Shared ──────────────────────────────────────────────────────────────────
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.07)",
  },

  // ── Slide 1 ────────────────────────────────────────────────────────────────

  s1CardWrap: {
    flex: 1,
    justifyContent: "center",
    marginTop: 24,
  },
  s1Card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    borderRadius: 16,
    padding: 22,
    gap: 16,
  },
  s1IconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  xBox: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: "rgba(226,75,74,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkBox: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: "rgba(29,155,240,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  s1RowTextMuted: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 15,
    flex: 1,
  },
  s1CheckText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "500",
    flex: 1,
  },

  // ── Slide 2 ────────────────────────────────────────────────────────────────

  stepsWrap: {
    marginTop: 8,
  },
  stepRow: {
    flexDirection: "row",
    gap: 14,
    marginBottom: 4,
  },
  stepLeft: {
    alignItems: "center",
    width: 34,
  },
  numBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(29,155,240,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  numText: {
    color: "#1D9BF0",
    fontSize: 14,
    fontWeight: "700",
  },
  connector: {
    width: 1,
    flex: 1,
    minHeight: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginVertical: 4,
  },
  stepRight: {
    flex: 1,
    paddingBottom: 14,
  },
  stepTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 6,
    marginBottom: 3,
  },
  stepDesc: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginBottom: 4,
  },
  chip: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 100,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  chipText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
  },
  chipLit: {
    borderWidth: 1,
    borderColor: "rgba(29,155,240,0.3)",
    backgroundColor: "rgba(29,155,240,0.07)",
    borderRadius: 100,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  chipLitText: {
    color: "#5BC0F8",
    fontSize: 11,
  },

  // Premium clicker preview card (slide 2, full-width)
  clickerCard: {
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  clickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  clickerIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "rgba(29,155,240,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  clickerLabel: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "500",
  },
  clickerSub: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 10,
    marginTop: 1,
  },
  clickerValue: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "700",
  },
  clickerUnit: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 10,
    marginTop: 1,
  },
  clickerDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginVertical: 8,
  },

  // ── Slide 3 ────────────────────────────────────────────────────────────────

  statsGrid: {
    flexDirection: "row",
    gap: 10,
    marginVertical: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    borderRadius: 14,
    padding: 14,
  },
  statNum: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "700",
    marginBottom: 4,
  },
  statLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
  },
  reviewCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  reviewTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#1D9BF0",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "700",
  },
  reviewName: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  reviewText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    lineHeight: 17,
  },

  // ── Slide 4 ────────────────────────────────────────────────────────────────

  perksWrap: {
    gap: 10,
    marginVertical: 16,
  },
  perkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  perkIconBox: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: "rgba(29,155,240,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  perkTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  perkDesc: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    lineHeight: 17,
  },
  priceRow: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  priceLabel: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    marginBottom: 3,
  },
  priceMain: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
  },
  priceSub: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    fontWeight: "400",
  },
  priceBadge: {
    backgroundColor: "rgba(29,155,240,0.1)",
    borderWidth: 1,
    borderColor: "rgba(29,155,240,0.2)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: "center",
  },
  priceBadgeTop: {
    color: "#5BC0F8",
    fontSize: 9,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 1,
  },
  priceBadgeBottom: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
});
