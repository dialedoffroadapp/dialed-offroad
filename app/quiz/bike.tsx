// app/quiz/bike.tsx — Q2, bike. Two sub-steps that read as one question:
//   2a brand grid (7 tiles + More/search)  →  2b model list with inline year
//   chips. Year never becomes its own screen.
// The year tap is the answer: it writes the bike into the SAME guest store the
// garage sheet uses (lib/guestGarage.ts), then runs the exact state-machine
// transition the garage's Continue ran (setGuestBikeId → setStep("tune")).
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn, FadeOut, SlideInRight } from "react-native-reanimated";
import { QuizChip } from "../../components/quiz/QuizChip";
import { QuizChoiceCard } from "../../components/quiz/QuizChoiceCard";
import { QuizShell } from "../../components/quiz/QuizShell";
import { displayFont, Q } from "../../components/quiz/quizTheme";
import { useAnswerRhythm } from "../../components/quiz/useAnswerRhythm";
import { catalogHasModel, normalizeBikeStrings } from "../../lib/bikes";
import { upsertQuizBike } from "../../lib/guestGarage";
import { useOnboarding } from "../../lib/onboarding";
import { useQuiz, useQuizStepView } from "../../lib/quizContext";
import {
  brandColor,
  crossBrandModelHits,
  filterModels,
  groupModelsForDiscipline,
  logQuizEvent,
  modelListSubline,
  QUIZ_MORE_BRANDS,
  QUIZ_OLDER_YEARS,
  QUIZ_PRIMARY_BRANDS,
  QUIZ_YEAR_CHIPS,
  searchBrands,
  searchCatalog,
} from "../../lib/quizOnboarding";
import { getOrCreateFunnelId, logEvent } from "../../lib/usage";

type Phase = "brand" | "model";

const yearAnswerId = (model: string, year: number) => `${model}::${year}`;
const splitYearAnswer = (id: string): { model: string; year: number } => {
  const i = id.lastIndexOf("::");
  return { model: id.slice(0, i), year: Number(id.slice(i + 2)) };
};

export default function QuizBikeScreen() {
  const router = useRouter();
  const { answers, hydrated, setAnswers } = useQuiz();
  const { onboardingActive, state, setGuestBikeId, setStep } = useOnboarding();

  const [phase, setPhase] = useState<Phase>("brand");
  const [make, setMake] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [brandQuery, setBrandQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const [olderOpen, setOlderOpen] = useState(false);
  const touchedRef = useRef(false);

  // Returning with a persisted brand lands on 2b with the model expanded.
  useEffect(() => {
    if (!hydrated || touchedRef.current) return;
    if (answers.make) {
      setMake(answers.make);
      setExpandedModel(answers.model ?? null);
      if (answers.year && !QUIZ_YEAR_CHIPS.includes(answers.year)) setOlderOpen(true);
      setPhase("model");
    }
  }, [hydrated, answers.make, answers.model, answers.year]);

  useQuizStepView(
    "bike",
    phase === "model" ? { substep: "model", make } : { substep: "brand" },
    phase
  );

  /* ------------------------------ 2a: brand ------------------------------ */
  const brand = useAnswerRhythm<string>({
    initial: make,
    onCommit: async (b) => {
      touchedRef.current = true;
      setMake(b);
      if (answers.make && answers.make !== b) {
        setExpandedModel(null);
        setOlderOpen(false);
        setModelQuery("");
        await setAnswers({ make: b, model: undefined, year: undefined });
      } else {
        await setAnswers({ make: b });
      }
    },
    onAdvance: () => setPhase("model"),
  });

  const goToModelPhase = useCallback(
    async (b: string, model?: string) => {
      touchedRef.current = true;
      void Haptics.selectionAsync().catch(() => {});
      setMake(b);
      setExpandedModel(model ?? null);
      setOlderOpen(false);
      setModelQuery("");
      await setAnswers(
        answers.make && answers.make !== b
          ? { make: b, model: undefined, year: undefined }
          : { make: b }
      );
      setPhase("model");
    },
    [answers.make, setAnswers]
  );

  const backToBrands = useCallback(() => {
    touchedRef.current = true;
    brand.reset();
    setPhase("brand");
  }, [brand]);

  /* ------------------------------ 2b: year ------------------------------- */
  const year = useAnswerRhythm<string>({
    initial:
      answers.model && answers.year ? yearAnswerId(answers.model, answers.year) : null,
    onCommit: async (id) => {
      const { model: rawModel, year: y } = splitYearAnswer(id);
      const { make: mk, model: mo } = normalizeBikeStrings(make ?? "", rawModel);
      const catalogMatch = catalogHasModel(mk, mo);
      const bikeId = await upsertQuizBike({
        make: mk,
        model: mo,
        year: y,
        previousId: answers.bikeLocalId ?? null,
      });
      await setAnswers({
        make: mk,
        model: mo,
        year: y,
        bikeLocalId: bikeId,
        catalogMatch,
      });

      // State-machine transition identical to the garage sheet's Continue.
      if (onboardingActive) {
        const wasGarageLocked = state.onboardingStep === "garage_locked";
        await setGuestBikeId(bikeId);
        if (wasGarageLocked) {
          await setStep("tune");
          const funnelId = await getOrCreateFunnelId();
          const ageMinutesSinceLastStep = Math.round(
            Math.max(0, Date.now() - Date.parse(state.lastUpdatedAt || "")) / 60000
          );
          await logEvent(
            "onboarding_bike_added",
            {
              funnel_id: funnelId,
              onboarding_step: "garage_locked",
              signed_in: false,
              bike_id: bikeId,
              pending_tune_exists: false,
              resume: ageMinutesSinceLastStep >= 5,
              age_minutes_since_last_step: ageMinutesSinceLastStep,
              source_route: "/quiz/bike",
            },
            { allowAnonymous: true, queueIfAnonymous: true }
          );
        }
      }

      await logQuizEvent("quiz_step_answered", {
        step: "bike",
        answer: { make: mk, model: mo, year: y, catalog_match: catalogMatch },
      });
    },
    onAdvance: () => router.push("/quiz/skill" as never),
  });

  /* ------------------------------- derived -------------------------------- */
  const groups = useMemo(
    () => (make ? groupModelsForDiscipline(make, answers.discipline) : []),
    [make, answers.discipline]
  );
  const allModels = useMemo(() => groups.flatMap((g) => g.models), [groups]);
  const filteredModels = useMemo(
    () => (modelQuery.trim() ? filterModels(allModels, modelQuery) : null),
    [allModels, modelQuery]
  );
  // Search always covers the full catalog: the brand's own matches list
  // first, then hits from every other brand (tapping one switches the brand).
  const otherHits = useMemo(() => crossBrandModelHits(make, modelQuery), [make, modelQuery]);
  const freeTextModel = modelQuery.trim();
  const showFreeText =
    freeTextModel.length > 0 && (filteredModels?.length ?? 0) === 0;

  const catalogHits = useMemo(
    () => (brandQuery.trim() ? searchCatalog(brandQuery) : []),
    [brandQuery]
  );
  const brandHits = useMemo(
    () => (brandQuery.trim() && catalogHits.length === 0 ? searchBrands(brandQuery) : []),
    [brandQuery, catalogHits.length]
  );

  const onModelSearchSubmit = () => {
    if (showFreeText && make) {
      void logEvent(
        "bike_search_no_result",
        { query: freeTextModel, make, source: "quiz" },
        { allowAnonymous: true, queueIfAnonymous: true }
      );
    }
  };

  const yearEcho =
    year.answering && year.selected
      ? (() => {
          const { model, year: y } = splitYearAnswer(year.selected);
          return `${y} ${model}, got it`;
        })()
      : null;

  /* -------------------------------- render -------------------------------- */
  if (phase === "brand") {
    return (
      <QuizShell
        step="bike"
        title="What's the bike?"
        subtitle="Pick your brand. Model and year come next."
        showBack
      >
        <View style={styles.grid}>
          {QUIZ_PRIMARY_BRANDS.map((b) => (
            <QuizChoiceCard
              key={b}
              tile
              label={b}
              accentColor={brandColor(b)}
              selected={brand.selected === b}
              dimmed={brand.isDimmed(b)}
              onPress={() => brand.choose(b)}
              style={styles.tileWrap}
              testID={`quiz-brand-${b}`}
            />
          ))}
          <Pressable
            onPress={() => {
              setMoreOpen((v) => !v);
              void Haptics.selectionAsync().catch(() => {});
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: moreOpen }}
            style={[styles.tileWrap, styles.moreTile, brand.answering && styles.dimmed]}
          >
            <Text style={[styles.moreLabel, displayFont("blackItalic")]}>
              {moreOpen ? "Less" : "More"}
            </Text>
            <Ionicons
              name={moreOpen ? "chevron-up" : "chevron-down"}
              size={16}
              color={Q.STEEL}
            />
          </Pressable>
        </View>

        {moreOpen ? (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={18} color={Q.STEEL} />
              <TextInput
                value={brandQuery}
                onChangeText={setBrandQuery}
                placeholder="Search any brand or model"
                placeholderTextColor={Q.STEEL}
                style={styles.searchInput}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={() => {
                  if (brandQuery.trim() && catalogHits.length === 0 && brandHits.length === 0) {
                    void logEvent(
                      "bike_search_no_result",
                      { query: brandQuery.trim(), make: null, source: "quiz" },
                      { allowAnonymous: true, queueIfAnonymous: true }
                    );
                  }
                }}
              />
            </View>

            {brandQuery.trim() ? (
              <View style={styles.hits}>
                {catalogHits.map((h) => (
                  <Pressable
                    key={`${h.make}|${h.model}`}
                    onPress={() => void goToModelPhase(h.make, h.model)}
                    style={styles.hitRow}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.hitMake, { color: brandColor(h.make) }, displayFont("bold")]}>
                      {h.make}
                    </Text>
                    <Text style={[styles.hitModel, displayFont("bold")]}>{h.model}</Text>
                    <Ionicons name="chevron-forward" size={16} color={Q.STEEL} />
                  </Pressable>
                ))}
                {catalogHits.length === 0 && brandHits.length > 0 ? (
                  <View style={styles.grid}>
                    {brandHits.map((b) => (
                      <QuizChoiceCard
                        key={b}
                        tile
                        label={b}
                        accentColor={brandColor(b)}
                        selected={brand.selected === b}
                        dimmed={brand.isDimmed(b)}
                        onPress={() => brand.choose(b)}
                        style={styles.tileWrap}
                      />
                    ))}
                  </View>
                ) : null}
                {catalogHits.length === 0 && brandHits.length === 0 ? (
                  <Pressable
                    onPress={() => void goToModelPhase(brandQuery.trim())}
                    style={styles.hitRow}
                    accessibilityRole="button"
                  >
                    <Ionicons name="add-circle-outline" size={18} color={Q.BLUE} />
                    <Text style={[styles.hitModel, displayFont("bold")]}>
                      {`Use "${brandQuery.trim()}" as the brand`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={[styles.grid, { marginTop: 14 }]}>
                {QUIZ_MORE_BRANDS.map((b) => (
                  <QuizChoiceCard
                    key={b}
                    tile
                    label={b}
                    accentColor={brandColor(b)}
                    selected={brand.selected === b}
                    dimmed={brand.isDimmed(b)}
                    onPress={() => brand.choose(b)}
                    style={styles.tileWrap}
                    testID={`quiz-brand-${b}`}
                  />
                ))}
              </View>
            )}
          </Animated.View>
        ) : null}
      </QuizShell>
    );
  }

  const mk = make ?? "";
  const color = brandColor(mk);
  const title = (
    <>
      Which <Text style={{ color }}>{mk}</Text>?
    </>
  );

  const renderModelRow = (model: string, free = false) => {
    const expanded = expandedModel === model;
    const rowDimmed = year.answering && !(year.selected ?? "").startsWith(`${model}::`);
    return (
      <View key={free ? `free:${model}` : model} style={[styles.modelRow, rowDimmed && styles.dimmed]}>
        <Pressable
          onPress={() => {
            if (year.answering) return;
            void Haptics.selectionAsync().catch(() => {});
            setExpandedModel(expanded ? null : model);
            if (!expanded) setOlderOpen(false);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          style={[styles.modelHead, expanded && styles.modelHeadExpanded]}
        >
          {free ? <Ionicons name="add-circle-outline" size={18} color={Q.BLUE} /> : null}
          <Text style={[styles.modelName, displayFont("bold")]}>
            {free ? `Use "${model}"` : model}
          </Text>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={Q.STEEL} />
        </Pressable>
        {expanded ? (
          <Animated.View entering={FadeIn.duration(140)} style={styles.years}>
            <Text style={styles.yearsLabel}>Year</Text>
            <View style={styles.chips}>
              {QUIZ_YEAR_CHIPS.map((y) => {
                const id = yearAnswerId(model, y);
                return (
                  <QuizChip
                    key={y}
                    label={String(y)}
                    selected={year.selected === id}
                    dimmed={year.isDimmed(id)}
                    onPress={() => year.choose(id)}
                  />
                );
              })}
              <QuizChip
                label="Older"
                selected={false}
                dimmed={year.answering}
                onPress={() => {
                  if (year.answering) return;
                  void Haptics.selectionAsync().catch(() => {});
                  setOlderOpen((v) => !v);
                }}
              />
            </View>
            {olderOpen ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.olderRow}
                keyboardShouldPersistTaps="handled"
              >
                {QUIZ_OLDER_YEARS.map((y) => {
                  const id = yearAnswerId(model, y);
                  return (
                    <QuizChip
                      key={y}
                      label={String(y)}
                      selected={year.selected === id}
                      dimmed={year.isDimmed(id)}
                      onPress={() => year.choose(id)}
                    />
                  );
                })}
              </ScrollView>
            ) : null}
          </Animated.View>
        ) : null}
      </View>
    );
  };

  return (
    <QuizShell
      step="bike"
      title={title}
      subtitle={modelListSubline(answers.discipline)}
      echo={yearEcho}
      ghostNext={year.answering}
      showBack
      onBack={backToBrands}
    >
      <Animated.View entering={SlideInRight.duration(220)}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={Q.STEEL} />
          <TextInput
            value={modelQuery}
            onChangeText={setModelQuery}
            placeholder={`Search ${mk} models`}
            placeholderTextColor={Q.STEEL}
            style={styles.searchInput}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={onModelSearchSubmit}
          />
        </View>

        {filteredModels ? (
          <View>
            <View style={styles.list}>
              {filteredModels.map((m) => renderModelRow(m))}
              {showFreeText ? renderModelRow(freeTextModel, true) : null}
            </View>
            {otherHits.length > 0 ? (
              <View style={styles.group}>
                <Text style={styles.groupLabel}>Other brands</Text>
                <View style={styles.list}>
                  {otherHits.map((h) => (
                    <Pressable
                      key={`${h.make}|${h.model}`}
                      onPress={() => void goToModelPhase(h.make, h.model)}
                      style={styles.hitRow}
                      accessibilityRole="button"
                      accessibilityLabel={`${h.make} ${h.model}`}
                    >
                      <Text style={[styles.hitMake, { color: brandColor(h.make) }, displayFont("bold")]}>
                        {h.make}
                      </Text>
                      <Text style={[styles.hitModel, displayFont("bold")]}>{h.model}</Text>
                      <Ionicons name="chevron-forward" size={16} color={Q.STEEL} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        ) : (
          groups.map((g) => (
            <View key={g.key} style={styles.group}>
              <Text style={styles.groupLabel}>{g.label}</Text>
              <View style={styles.list}>{g.models.map((m) => renderModelRow(m))}</View>
            </View>
          ))
        )}
        {!filteredModels && groups.length === 0 ? (
          <Text style={styles.emptyHint}>
            No {mk} models in our list yet. Type yours above.
          </Text>
        ) : null}
      </Animated.View>
    </QuizShell>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tileWrap: { width: "48%", flexGrow: 1 },
  moreTile: {
    height: 84,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Q.BORDER_STRONG,
    backgroundColor: Q.PANEL,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  moreLabel: { color: Q.STEEL, fontSize: 26, textTransform: "uppercase", letterSpacing: 0.4 },
  dimmed: { opacity: Q.DIM_OPACITY },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
    paddingHorizontal: 14,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Q.BORDER_STRONG,
    backgroundColor: Q.INK,
  },
  searchInput: { flex: 1, color: Q.TEXT, fontSize: 16, paddingVertical: 0 },
  hits: { marginTop: 10, gap: 8 },
  hitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: Q.PANEL,
    borderWidth: 1,
    borderColor: Q.BORDER,
  },
  hitMake: { fontSize: 16, textTransform: "uppercase", letterSpacing: 0.3 },
  hitModel: { flex: 1, color: Q.TEXT, fontSize: 18, letterSpacing: 0.2 },
  group: { marginTop: 18 },
  groupLabel: {
    color: Q.STEEL,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
    fontWeight: "700",
  },
  list: { gap: 8, marginTop: 4 },
  modelRow: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Q.BORDER,
    backgroundColor: Q.PANEL,
    overflow: "hidden",
  },
  modelHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 16,
    minHeight: 56,
  },
  modelHeadExpanded: { borderBottomWidth: 1, borderBottomColor: Q.BORDER },
  modelName: { flex: 1, color: Q.TEXT, fontSize: 20, letterSpacing: 0.3 },
  years: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14 },
  yearsLabel: {
    color: Q.STEEL,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
    fontWeight: "700",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  olderRow: { gap: 8, paddingTop: 10 },
  emptyHint: { color: Q.STEEL, fontSize: 14, marginTop: 16 },
});
