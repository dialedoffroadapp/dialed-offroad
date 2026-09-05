// app/quiz/terrain.tsx — Q4, terrain. Discipline-conditional; shows ONLY the
// chosen discipline's options. Multi-select: the first tap is the MAIN
// terrain (the engine's target), later taps are secondary (kept on the local
// profile until a profiles column exists). The only screen with a Continue
// button (multi-select cannot auto-advance). Tabler icons are placeholders;
// the custom terrain set is on the polish backlog.
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  IconBeach,
  IconBuildingStadium,
  IconDroplet,
  IconMountain,
  IconPlant2,
  IconRoad,
  IconSkull,
  IconSun,
  IconTractor,
  IconTrees,
  IconWind,
} from "@tabler/icons-react-native";
import { QuizShell } from "../../components/quiz/QuizShell";
import { QuizTerrainTile, type TerrainTileState } from "../../components/quiz/QuizTerrainTile";
import { displayFont, Q } from "../../components/quiz/quizTheme";
import { useQuiz, useQuizStepView } from "../../lib/quizContext";
import { logQuizEvent, TERRAIN_OPTIONS, terrainLabel, type QuizDiscipline, nextQuizRoute } from "../../lib/quizOnboarding";

const ICONS: Record<string, (color: string) => React.ReactNode> = {
  hardpack: (c) => <IconRoad size={30} color={c} strokeWidth={1.6} />,
  loam: (c) => <IconPlant2 size={30} color={c} strokeWidth={1.6} />,
  sand: (c) => <IconBeach size={30} color={c} strokeWidth={1.6} />,
  rutted_clay: (c) => <IconTractor size={30} color={c} strokeWidth={1.6} />,
  supercross: (c) => <IconBuildingStadium size={30} color={c} strokeWidth={1.6} />,
  mud: (c) => <IconDroplet size={30} color={c} strokeWidth={1.6} />,
  singletrack: (c) => <IconTrees size={30} color={c} strokeWidth={1.6} />,
  rocks_roots: (c) => <IconMountain size={30} color={c} strokeWidth={1.6} />,
  desert: (c) => <IconSun size={30} color={c} strokeWidth={1.6} />,
  dunes: (c) => <IconWind size={30} color={c} strokeWidth={1.6} />,
  hard_enduro: (c) => <IconSkull size={30} color={c} strokeWidth={1.6} />,
};

export default function QuizTerrainScreen() {
  const router = useRouter();
  const { answers, setAnswers } = useQuiz();
  const discipline: QuizDiscipline = answers.discipline ?? "mx";
  const options = TERRAIN_OPTIONS[discipline];
  useQuizStepView("terrain", { discipline });

  const [main, setMain] = useState<string | null>(answers.terrainMain ?? null);
  const [secondary, setSecondary] = useState<string[]>(answers.terrainSecondary ?? []);
  const [advancing, setAdvancing] = useState(false);

  const stateFor = (id: string): TerrainTileState =>
    main === id ? "main" : secondary.includes(id) ? "secondary" : "none";

  const tap = (id: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    let nextMain = main;
    let nextSecondary = secondary;
    if (main === id) {
      // Demoting the main promotes the earliest secondary, else clears.
      nextMain = secondary[0] ?? null;
      nextSecondary = secondary.slice(1);
    } else if (secondary.includes(id)) {
      nextSecondary = secondary.filter((s) => s !== id);
    } else if (!main) {
      nextMain = id;
    } else {
      nextSecondary = [...secondary, id];
    }
    setMain(nextMain);
    setSecondary(nextSecondary);
    void setAnswers({ terrainMain: nextMain ?? undefined, terrainSecondary: nextSecondary });
  };

  const footnote = useMemo(() => {
    if (!main) return "Pick the one you ride most first.";
    const m = terrainLabel(discipline, main).toLowerCase();
    if (secondary.length === 0) return `Tuning for ${m} first.`;
    const s = terrainLabel(discipline, secondary[0]).toLowerCase();
    const more = secondary.length > 1 ? ` (and ${secondary.length - 1} more)` : "";
    return `Tuning for ${m} first. A ${s} setup${more} can join your garage later.`;
  }, [main, secondary, discipline]);

  const onContinue = async () => {
    if (!main || advancing) return;
    setAdvancing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await logQuizEvent("quiz_step_answered", {
      step: "terrain",
      answer: { main, secondary, discipline },
    });
    router.push(nextQuizRoute("terrain", { ...answers, terrainMain: main ?? undefined, terrainSecondary: secondary }) as never);
    setTimeout(() => setAdvancing(false), 600);
  };

  return (
    <QuizShell
      step="terrain"
      title={discipline === "offroad" ? "Where do the trails take you?" : "What's your track usually like?"}
      subtitle={answers.flow === "new_setup" ? `Starts from ${answers.flowFromLabel ?? "your running setup"}. Its own history from here. First tap is what we tune for.` : "Pick all that apply. First tap is what we tune for."}
      ghostNext={!!main}
      echo={main ? `${terrainLabel(discipline, main)} first` : null}
      showBack
      footerSlot={
        <Pressable
          onPress={onContinue}
          disabled={!main}
          accessibilityRole="button"
          accessibilityState={{ disabled: !main }}
          style={[styles.cta, !main && styles.ctaDisabled]}
        >
          <Text style={[styles.ctaText, displayFont("bold")]}>Continue</Text>
        </Pressable>
      }
    >
      <View style={styles.grid}>
        {options.map((o) => (
          <QuizTerrainTile
            key={o.id}
            label={o.label}
            icon={ICONS[o.id] ?? ICONS.hardpack}
            state={stateFor(o.id)}
            onPress={() => tap(o.id)}
            style={styles.tileWrap}
            testID={`quiz-terrain-${o.id}`}
          />
        ))}
      </View>
      <View style={styles.footnote}>
        <Text style={styles.footnoteText}>{footnote}</Text>
      </View>
    </QuizShell>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tileWrap: { width: "47%", flexGrow: 1 },
  footnote: {
    marginTop: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Q.BORDER,
    backgroundColor: Q.PANEL,
  },
  footnoteText: { color: Q.STEEL, fontSize: 14, lineHeight: 19 },
  cta: {
    height: 56,
    borderRadius: 16,
    backgroundColor: Q.BLUE,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  ctaDisabled: { opacity: 0.35 },
  ctaText: { color: Q.INK, fontSize: 19, letterSpacing: 0.4, textTransform: "uppercase" },
});
