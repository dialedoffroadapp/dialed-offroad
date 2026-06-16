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
  <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
    <Line x1={2} y1={2} x2={10} y2={10} stroke="#E24B4A" strokeWidth={1.8} strokeLinecap="round" />
    <Line x1={10} y1={2} x2={2} y2={10} stroke="#E24B4A" strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);

const CheckIcon = () => (
  <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
    <Path d="M2 6.5L4.5 9L10 3" stroke="#1A6BFF" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const StarIcon = () => (
  <Svg width={9} height={9} viewBox="0 0 9 9" fill="#1A6BFF">
    <Polygon points="4.5,0.5 5.5,3.3 8.5,3.3 6.2,5.1 7.1,8 4.5,6.3 1.9,8 2.8,5.1 0.5,3.3 3.5,3.3" />
  </Svg>
);

const LockIcon = () => (
  <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
    <Rect x={2} y={6} width={10} height={7} rx={2} stroke="#1A6BFF" strokeWidth={1.4} />
    <Path d="M4.5 6V4.5a2.5 2.5 0 015 0V6" stroke="#1A6BFF" strokeWidth={1.4} strokeLinecap="round" />
    <Line x1={7} y1={8} x2={7} y2={10} stroke="#1A6BFF" strokeWidth={1.4} strokeLinecap="round" />
  </Svg>
);

const LinesIcon = () => (
  <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
    <Line x1={2} y1={4} x2={12} y2={4} stroke="#1A6BFF" strokeWidth={1.4} strokeLinecap="round" />
    <Line x1={2} y1={7} x2={9} y2={7} stroke="#1A6BFF" strokeWidth={1.4} strokeLinecap="round" />
    <Line x1={2} y1={10} x2={11} y2={10} stroke="#1A6BFF" strokeWidth={1.4} strokeLinecap="round" />
  </Svg>
);

const ClockIcon = () => (
  <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
    <Path d="M7 1.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z" stroke="#1A6BFF" strokeWidth={1.4} />
    <Line x1={7} y1={4} x2={7} y2={7} stroke="#1A6BFF" strokeWidth={1.4} strokeLinecap="round" />
    <Line x1={7} y1={7} x2={9.5} y2={9} stroke="#1A6BFF" strokeWidth={1.4} strokeLinecap="round" />
  </Svg>
);

// ─── Background Decorations ────────────────────────────────────────────────────

const LogoWatermarks = () => (
  <>
    <Image
      source={require("../assets/images/icon.png")}
      style={s.watermarkTR}
      pointerEvents="none"
    />
    <Image
      source={require("../assets/images/icon.png")}
      style={s.watermarkBL}
      pointerEvents="none"
    />
  </>
);

const CheckeredFlag = () => (
  <View style={s.flagWrap} pointerEvents="none">
    <Svg width={110} height={85}>
      <Line x1={8} y1={0} x2={8} y2={85} stroke="#1A6BFF" strokeWidth={2} />
      {/* Row 1 — y=0 */}
      <Rect x={8}   y={0}  width={14} height={14} fill="#1A6BFF" />
      <Rect x={36}  y={0}  width={14} height={14} fill="#1A6BFF" />
      <Rect x={64}  y={0}  width={14} height={14} fill="#1A6BFF" />
      <Rect x={92}  y={0}  width={14} height={14} fill="#1A6BFF" />
      {/* Row 2 — y=14 */}
      <Rect x={22}  y={14} width={14} height={14} fill="#1A6BFF" />
      <Rect x={50}  y={14} width={14} height={14} fill="#1A6BFF" />
      <Rect x={78}  y={14} width={14} height={14} fill="#1A6BFF" />
      <Rect x={106} y={14} width={14} height={14} fill="#1A6BFF" />
      {/* Row 3 — y=28 */}
      <Rect x={8}   y={28} width={14} height={14} fill="#1A6BFF" />
      <Rect x={36}  y={28} width={14} height={14} fill="#1A6BFF" />
      <Rect x={64}  y={28} width={14} height={14} fill="#1A6BFF" />
      <Rect x={92}  y={28} width={14} height={14} fill="#1A6BFF" />
      {/* Row 4 — y=42 */}
      <Rect x={22}  y={42} width={14} height={14} fill="#1A6BFF" />
      <Rect x={50}  y={42} width={14} height={14} fill="#1A6BFF" />
      <Rect x={78}  y={42} width={14} height={14} fill="#1A6BFF" />
      <Rect x={106} y={42} width={14} height={14} fill="#1A6BFF" />
      {/* Row 5 — y=56 */}
      <Rect x={8}   y={56} width={14} height={14} fill="#1A6BFF" />
      <Rect x={36}  y={56} width={14} height={14} fill="#1A6BFF" />
      <Rect x={64}  y={56} width={14} height={14} fill="#1A6BFF" />
      <Rect x={92}  y={56} width={14} height={14} fill="#1A6BFF" />
    </Svg>
  </View>
);

// ─── Shared UI Components ──────────────────────────────────────────────────────

const TagPill = ({ label }: { label: string }) => (
  <View style={s.tagPill}>
    <View style={s.tagDot} />
    <Text style={s.tagText}>{label}</Text>
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

const ProgressBar = ({ pct }: { pct: number }) => (
  <View style={s.pbTrack}>
    <View style={[s.pbFill, { width: `${pct}%` as any }]} />
  </View>
);

const Stars = () => (
  <View style={{ flexDirection: "row", gap: 2 }}>
    {[0, 1, 2, 3, 4].map((i) => (
      <StarIcon key={i} />
    ))}
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

    {/* Tag pill */}
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

    {/* Middle card */}
    <View style={s.s1CardWrap}>
      <View style={s.s1Card}>
        <View style={s.iconRow}>
          <View style={s.xBox}><XIcon /></View>
          <Text style={s.rowText}>Random YouTube settings</Text>
        </View>
        <View style={s.iconRow}>
          <View style={s.xBox}><XIcon /></View>
          <Text style={s.rowText}>Generic suspension charts</Text>
        </View>
        <View style={s.iconRow}>
          <View style={s.xBox}><XIcon /></View>
          <Text style={s.rowText}>Asking your buddy who rides different</Text>
        </View>
        <View style={s.divider} />
        <View style={s.iconRow}>
          <View style={s.checkBox}><CheckIcon /></View>
          <Text style={s.checkText}>AI tuned to your bike, body, and terrain</Text>
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

    <Text style={s.h1Sm}>
      {"Three steps.\n"}
      <Text style={s.accent}>{"One perfect\nbaseline."}</Text>
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
          <Text style={s.stepDesc}>Fork comp, rebound, shock LSC, HSC, sag — all zero-referenced.</Text>
          <View style={s.miniCard}>
            <View style={s.miniRow}>
              <Text style={s.miniLabel}>Fork compression</Text>
              <ProgressBar pct={53} />
              <Text style={s.miniValue}>16 clicks</Text>
            </View>
            <View style={s.miniRow}>
              <Text style={s.miniLabel}>Shock rebound</Text>
              <ProgressBar pct={40} />
              <Text style={s.miniValue}>12 clicks</Text>
            </View>
          </View>
        </View>
      </View>
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
  <>
    {/* Number plate */}
    <View style={s.numberPlate}>
      <Text style={s.plateNum}>19K</Text>
      <Text style={s.plateLabel}>{"riders\ndialed"}</Text>
    </View>

    <Text style={s.h1Sm}>
      {"Riders who\nknow the\n"}
      <Text style={s.accent}>{"difference."}</Text>
    </Text>

    {/* Stats */}
    <View style={s.statsGrid}>
      <View style={s.statCard}>
        <Text style={s.statNum}>
          19,000<Text style={s.accent}>+</Text>
        </Text>
        <Text style={s.statLabel}>riders on the platform</Text>
      </View>
      <View style={s.statCard}>
        <Text style={s.statNum}>
          5,000<Text style={s.accent}>+</Text>
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
  </>
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
  <>
    <View style={{ marginBottom: 14 }}>
      <TagPill label="FREE TRIAL" />
    </View>

    <Text style={[s.h1, { fontSize: 40, lineHeight: 41, letterSpacing: -1.2, marginBottom: 10 }]}>
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
  </>
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
      {/* Background decorations — rendered first so they sit behind content */}
      <LogoWatermarks />
      {index === 3 && <CheckeredFlag />}

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

      {/* Navigation */}
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
  // Root (= slide container)
  root: {
    flex: 1,
    backgroundColor: "#080808",
    paddingHorizontal: 28,
    paddingTop: 52,
    paddingBottom: 44,
    overflow: "hidden",
  },

  // Logo watermarks
  watermarkTR: {
    position: "absolute",
    top: -60,
    right: -60,
    width: 280,
    height: 280,
    opacity: 0.04,
  },
  watermarkBL: {
    position: "absolute",
    bottom: 60,
    left: -80,
    width: 200,
    height: 200,
    opacity: 0.03,
  },

  // Checkered flag
  flagWrap: {
    position: "absolute",
    bottom: 80,
    right: -10,
    opacity: 0.05,
  },

  // Scroll area
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 16,
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

  // Tag pill
  tagPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(26,107,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(26,107,255,0.25)",
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  tagDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#1A6BFF",
  },
  tagText: {
    color: "#5B9BFF",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.66,
  },

  // Headlines
  h1: {
    fontSize: 44,
    fontWeight: "800",
    lineHeight: 45,
    letterSpacing: -1.32,
    color: "#FFFFFF",
    marginBottom: 14,
  },
  h1Sm: {
    fontSize: 38,
    fontWeight: "800",
    lineHeight: 39,
    letterSpacing: -1.14,
    color: "#FFFFFF",
    marginBottom: 0,
  },
  accent: {
    color: "#1A6BFF",
  },

  // Body
  body: {
    fontSize: 15,
    color: "#555",
    lineHeight: 24,
  },

  // Nav dots
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 5,
    marginBottom: 14,
  },
  dot: {
    height: 5,
    borderRadius: 3,
  },
  dotActive: {
    width: 20,
    backgroundColor: "#1A6BFF",
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
    color: "#555",
    fontSize: 15,
    fontWeight: "500",
  },
  btnPrimary: {
    flex: 2,
    backgroundColor: "#1A6BFF",
    borderRadius: 100,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnPrimaryText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },

  // ── Slide 1 ────────────────────────────────────────────────────────────────

  s1CardWrap: {
    flex: 1,
    justifyContent: "center",
    marginVertical: 24,
  },
  s1Card: {
    backgroundColor: "#0F0F0F",
    borderWidth: 1,
    borderColor: "#1A1A1A",
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  iconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  xBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(226,75,74,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(26,107,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    color: "#555",
    fontSize: 13,
    flex: 1,
  },
  checkText: {
    color: "#5B9BFF",
    fontSize: 13,
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: "#1A1A1A",
  },

  // ── Slide 2 ────────────────────────────────────────────────────────────────

  stepsWrap: {
    flex: 1,
    marginVertical: 20,
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
    backgroundColor: "#0F0F0F",
    borderWidth: 1,
    borderColor: "#1E1E1E",
    alignItems: "center",
    justifyContent: "center",
  },
  numText: {
    color: "#1A6BFF",
    fontSize: 14,
    fontWeight: "700",
  },
  connector: {
    width: 1,
    flex: 1,
    minHeight: 24,
    backgroundColor: "#1A1A1A",
    marginVertical: 4,
  },
  stepRight: {
    flex: 1,
    paddingBottom: 16,
  },
  stepTitle: {
    color: "#CCCCCC",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 6,
    marginBottom: 3,
  },
  stepDesc: {
    color: "#444",
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
    borderColor: "#1E1E1E",
    backgroundColor: "#0F0F0F",
    borderRadius: 100,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  chipText: {
    color: "#444",
    fontSize: 11,
  },
  chipLit: {
    borderWidth: 1,
    borderColor: "rgba(26,107,255,0.3)",
    backgroundColor: "rgba(26,107,255,0.07)",
    borderRadius: 100,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  chipLitText: {
    color: "#5B9BFF",
    fontSize: 11,
  },
  miniCard: {
    backgroundColor: "#0A0A0A",
    borderWidth: 1,
    borderColor: "#181818",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  miniRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  miniLabel: {
    color: "#3A3A3A",
    fontSize: 11,
    width: 100,
  },
  pbTrack: {
    flex: 1,
    height: 3,
    backgroundColor: "#181818",
    borderRadius: 2,
    overflow: "hidden",
  },
  pbFill: {
    height: 3,
    backgroundColor: "#1A6BFF",
    borderRadius: 2,
  },
  miniValue: {
    color: "#EEEEEE",
    fontSize: 12,
    fontWeight: "700",
    width: 52,
    textAlign: "right",
  },

  // ── Slide 3 ────────────────────────────────────────────────────────────────

  numberPlate: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#0A0A0A",
    borderWidth: 2,
    borderColor: "#1A6BFF",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 8,
    marginBottom: 18,
  },
  plateNum: {
    color: "#1A6BFF",
    fontSize: 22,
    fontWeight: "900",
  },
  plateLabel: {
    color: "#333",
    fontSize: 9,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.72,
    lineHeight: 12,
  },
  statsGrid: {
    flexDirection: "row",
    gap: 10,
    marginVertical: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#0F0F0F",
    borderWidth: 1,
    borderColor: "#1A1A1A",
    borderRadius: 14,
    padding: 14,
  },
  statNum: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 4,
  },
  statLabel: {
    color: "#3A3A3A",
    fontSize: 11,
  },
  reviewCard: {
    backgroundColor: "#0F0F0F",
    borderWidth: 1,
    borderColor: "#1A1A1A",
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
    backgroundColor: "#0D2A5E",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#5B9BFF",
    fontSize: 8,
    fontWeight: "700",
  },
  reviewName: {
    color: "#666",
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
  },
  reviewText: {
    color: "#444",
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
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "rgba(26,107,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  perkTitle: {
    color: "#CCCCCC",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  perkDesc: {
    color: "#444",
    fontSize: 12,
    lineHeight: 17,
  },
  priceRow: {
    backgroundColor: "#0F0F0F",
    borderWidth: 1,
    borderColor: "#1A1A1A",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  priceLabel: {
    color: "#3A3A3A",
    fontSize: 11,
    marginBottom: 3,
  },
  priceMain: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
  },
  priceSub: {
    color: "#3A3A3A",
    fontSize: 12,
    fontWeight: "400",
  },
  priceBadge: {
    backgroundColor: "rgba(26,107,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(26,107,255,0.2)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: "center",
  },
  priceBadgeTop: {
    color: "#5B9BFF",
    fontSize: 9,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 1,
  },
  priceBadgeBottom: {
    color: "#5B9BFF",
    fontSize: 11,
    fontWeight: "700",
  },
});
