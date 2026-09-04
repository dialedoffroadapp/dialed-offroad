// app/quiz/index.tsx — Q1, discipline.
// Runs under onboarding step "garage_locked" (the step the garage sheet used
// to own). The answer maps to rider.style (MX = short_motos, off-road =
// long_enduro) and drives Q4's option set, 2b's ordering, and later chip
// localization. No "Both": a second discipline is a second garage setup.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { QuizChoiceCard } from "../../components/quiz/QuizChoiceCard";
import { QuizShell } from "../../components/quiz/QuizShell";
import { Q } from "../../components/quiz/quizTheme";
import { useAnswerRhythm } from "../../components/quiz/useAnswerRhythm";
import { useQuiz, useQuizStepView } from "../../lib/quizContext";
import {
  DISCIPLINE_OPTIONS,
  disciplineEcho,
  logQuizEvent,
  type QuizDiscipline,
} from "../../lib/quizOnboarding";

export default function QuizDisciplineScreen() {
  const router = useRouter();
  const { answers, setAnswers } = useQuiz();
  useQuizStepView("discipline");

  const { selected, answering, choose, isDimmed } = useAnswerRhythm<QuizDiscipline>({
    initial: answers.discipline ?? null,
    onCommit: async (id) => {
      // Changing discipline invalidates terrain (Q4 is discipline-conditional).
      const patch =
        answers.discipline && answers.discipline !== id
          ? { discipline: id, terrainMain: undefined, terrainSecondary: undefined }
          : { discipline: id };
      await setAnswers(patch);
      await logQuizEvent("quiz_step_answered", { step: "discipline", answer: id });
    },
    onAdvance: () => router.push("/quiz/bike" as never),
  });

  return (
    <QuizShell
      step="discipline"
      title="What are we tuning first?"
      subtitle="Pick where you ride most. Your bike can hold a setup for each later."
      hint="Tap one to continue"
      echo={answering && selected ? disciplineEcho(selected) : null}
      ghostNext={answering}
    >
      <View style={styles.cards}>
        {DISCIPLINE_OPTIONS.map((opt) => (
          <QuizChoiceCard
            key={opt.id}
            label={opt.label}
            subtitle={opt.subtitle}
            selected={selected === opt.id}
            dimmed={isDimmed(opt.id)}
            onPress={() => choose(opt.id)}
            testID={`quiz-discipline-${opt.id}`}
          />
        ))}
      </View>

      <View style={styles.footnote} accessibilityRole="text">
        <Ionicons name="swap-horizontal-outline" size={18} color={Q.STEEL} />
        <Text style={styles.footnoteText}>
          Ride both? Add a woods setup and a track setup to your garage later.
        </Text>
      </View>
    </QuizShell>
  );
}

const styles = StyleSheet.create({
  cards: { gap: 12 },
  footnote: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Q.BORDER,
    backgroundColor: Q.PANEL,
  },
  footnoteText: { flex: 1, color: Q.STEEL, fontSize: 14, lineHeight: 19 },
});
