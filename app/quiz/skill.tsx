// app/quiz/skill.tsx — Q3, skill. Never the word "Beginner".
// Four levels map onto the engine's three (rider.skill) plus derived goals —
// see engineSkillForQuizSkill / engineGoalsFor in lib/quizOnboarding.ts. The
// raw 4-level answer is kept in the quiz store and the event meta.
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { QuizChoiceCard } from "../../components/quiz/QuizChoiceCard";
import { QuizShell } from "../../components/quiz/QuizShell";
import { displayFont, Q } from "../../components/quiz/quizTheme";
import { useAnswerRhythm } from "../../components/quiz/useAnswerRhythm";
import { answersFromProfile, canConfirmProfile, confirmLine, fetchActiveRiderProfile, type RiderProfile } from "../../lib/riderProfile";
import { useQuiz, useQuizStepView } from "../../lib/quizContext";
import {
  brandColor,
  engineSkillForQuizSkill,
  logQuizEvent,
  SKILL_OPTIONS,
  skillEcho,
  type QuizSkillId, nextQuizRoute } from "../../lib/quizOnboarding";

export default function QuizSkillScreen() {
  const router = useRouter();
  const { answers, setAnswers } = useQuiz();
  useQuizStepView("skill");

  // Rider profile (2026-09-08): with the facts known (the active profile,
  // else this device's answers on a garage flow) the step collapses to a
  // confirmation. Change shows the cards; the weight screen follows.
  const [profile, setProfile] = useState<RiderProfile | null | undefined>(undefined);
  const [changing, setChanging] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchActiveRiderProfile().then((p) => {
      if (alive) setProfile(p);
    });
    return () => {
      alive = false;
    };
  }, []);
  const known: RiderProfile | null = canConfirmProfile(profile)
    ? profile
    : answers.flow && answers.skill && typeof answers.weightLbs === "number"
      ? { id: "", user_id: "", name: "Me", weight_lbs: answers.weightLbs, unit: answers.weightUnit ?? "lbs", skill: answers.skill, class: null, discipline_default: null }
      : null;
  const confirming = profile !== undefined && !changing && known !== null;
  const confirmYes = async () => {
    if (!known) return;
    const facts = answersFromProfile(known);
    await setAnswers(facts);
    await logQuizEvent("quiz_step_answered", { step: "skill", answer: "confirmed", engine_skill: known.skill ? engineSkillForQuizSkill(known.skill) : undefined });
    router.push(nextQuizRoute("skill", { ...answers, ...facts }) as never);
  };

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
    onAdvance: () => router.push(nextQuizRoute("skill", answers) as never),
  });

  const title = answers.model ? (
    <>
      How hard do you push that{" "}
      <Text style={{ color: brandColor(answers.make) }}>{answers.model}</Text>?
    </>
  ) : (
    "How hard do you push?"
  );

  if (profile === undefined) {
    return <QuizShell step="skill" title={title} subtitle=" " showBack><View /></QuizShell>;
  }

  if (confirming && known) {
    return (
      <QuizShell step="skill" title={confirmLine(known)} subtitle="Same rider, same numbers. Change it for a different rider or a new weight." showBack>
        <View style={styles.cards}>
          <Pressable onPress={() => void confirmYes()} accessibilityRole="button" style={styles.yes} testID="quiz-skill-confirm-yes">
            <Text style={[styles.yesText, displayFont("bold")]}>Yes</Text>
          </Pressable>
          <Pressable onPress={() => setChanging(true)} accessibilityRole="button" style={styles.change} testID="quiz-skill-confirm-change">
            <Text style={styles.changeText}>Change</Text>
          </Pressable>
        </View>
      </QuizShell>
    );
  }

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
  yes: { backgroundColor: Q.BLUE, borderRadius: 14, paddingVertical: 18, alignItems: "center" },
  yesText: { color: Q.BG, fontSize: 20, letterSpacing: 0.5 },
  change: { borderWidth: 1, borderColor: Q.BORDER_STRONG, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  changeText: { color: Q.TEXT, fontSize: 16 },
});
