// app/quiz/skill.tsx — Q3, skill. Never the word "Beginner".
// Four levels map onto the engine's three (rider.skill) plus derived goals —
// see engineSkillForQuizSkill / engineGoalsFor in lib/quizOnboarding.ts. The
// raw 4-level answer is kept in the quiz store and the event meta.
import { useRouter } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { QuizChoiceCard } from "../../components/quiz/QuizChoiceCard";
import { QuizShell } from "../../components/quiz/QuizShell";
import { useAnswerRhythm } from "../../components/quiz/useAnswerRhythm";
import { useQuiz, useQuizStepView } from "../../lib/quizContext";
import {
  brandColor,
  engineSkillForQuizSkill,
  logQuizEvent,
  SKILL_OPTIONS,
  skillEcho,
  type QuizSkillId,
} from "../../lib/quizOnboarding";

export default function QuizSkillScreen() {
  const router = useRouter();
  const { answers, setAnswers } = useQuiz();
  useQuizStepView("skill");

  const { selected, answering, choose, isDimmed } = useAnswerRhythm<QuizSkillId>({
    initial: answers.skill ?? null,
    onCommit: async (id) => {
      await setAnswers({ skill: id });
      await logQuizEvent("quiz_step_answered", {
        step: "skill",
        answer: id,
        engine_skill: engineSkillForQuizSkill(id),
      });
    },
    onAdvance: () => router.push("/quiz/terrain" as never),
  });

  const title = answers.model ? (
    <>
      How hard do you push that{" "}
      <Text style={{ color: brandColor(answers.make) }}>{answers.model}</Text>?
    </>
  ) : (
    "How hard do you push?"
  );

  return (
    <QuizShell
      step="skill"
      title={title}
      subtitle="Honest answer, right tune. Suspension set for faster riders beats you up."
      echo={answering && selected ? skillEcho(selected) : null}
      ghostNext={answering}
      showBack
    >
      <View style={styles.cards}>
        {SKILL_OPTIONS.map((opt) => (
          <QuizChoiceCard
            key={opt.id}
            label={opt.label}
            subtitle={opt.subtitle}
            selected={selected === opt.id}
            dimmed={isDimmed(opt.id)}
            onPress={() => choose(opt.id)}
            testID={`quiz-skill-${opt.id}`}
          />
        ))}
      </View>
    </QuizShell>
  );
}

const styles = StyleSheet.create({
  cards: { gap: 12 },
});
