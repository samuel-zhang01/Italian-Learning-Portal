import { addDays, normalise, validDate } from "./learning-utils.ts";
import { selectReviewQueue, type ReviewCatalogue } from "./review-queue.ts";
import { diagnosticCatchUp, type A2DiagnosticChapter, type A2DiagnosticState, type CatchUpUnit } from "./a2-diagnostic-model.ts";
import { oralPracticeIdentities, oralRunKey } from "./oral-practice-model.ts";
import type { Pair, Progress } from "./types.ts";

export type WeeklyNextStep = { id: string; title: Pair; detail: Pair; route: string };
export type WeeklyLearningEvidence = {
  from: string; to: string; activeDays: string[];
  core: { completed: number; recallChecks: number; recallCorrect: number; laterDayCorrect: number };
  grammar: { exerciseDays: number; independentFirstCorrect: number; supportedFirst: number; sameDayRepairs: number; laterDayCorrect: number; completed: number };
  personalWords: { latestReviews: number };
  arcade: { latestItems: number; independentLatestCorrect: number; supportedLatest: number; ambiguousLatest: number };
  selfAssessed: { grammarProductions: number; programmeCheckpoints: number; companionPages: number };
  diagnostics: { checked: number; independentCorrect: number; supported: number; chapters: number };
  oralPractice: { completedRuns: number; gistFirstChecks: number; detailFirstChecks: number; correctWithoutTextSupport: number; supportedFirstChecks: number; laterDayTransfers: number };
  nextSteps: WeeklyNextStep[]; nextWeekPlan: { date: string; step: WeeklyNextStep }[]; hasEvidence: boolean;
};
export type WeeklyReportCatalogue = {
  programmes: readonly { id: string; days: readonly { practice?: unknown }[] }[];
  companionIds: readonly string[];
};

/** Saved dates are evidence of the listed events, not time spent or proficiency. */
export function deriveWeeklyLearningReport(
  p: Progress, catalogue: ReviewCatalogue, today: string,
  diagnostics: A2DiagnosticState, chapters: readonly A2DiagnosticChapter[], units: readonly CatchUpUnit[],
  reportCatalogue: WeeklyReportCatalogue = { programmes: [], companionIds: [] },
): WeeklyLearningEvidence {
  const from = validDate(today) ? addDays(today, -6) : "";
  const result: WeeklyLearningEvidence = {
    from, to: today, activeDays: [],
    core: { completed: 0, recallChecks: 0, recallCorrect: 0, laterDayCorrect: 0 },
    grammar: { exerciseDays: 0, independentFirstCorrect: 0, supportedFirst: 0, sameDayRepairs: 0, laterDayCorrect: 0, completed: 0 },
    personalWords: { latestReviews: 0 }, arcade: { latestItems: 0, independentLatestCorrect: 0, supportedLatest: 0, ambiguousLatest: 0 },
    selfAssessed: { grammarProductions: 0, programmeCheckpoints: 0, companionPages: 0 },
    diagnostics: { checked: 0, independentCorrect: 0, supported: 0, chapters: 0 },
    oralPractice: { completedRuns: 0, gistFirstChecks: 0, detailFirstChecks: 0, correctWithoutTextSupport: 0, supportedFirstChecks: 0, laterDayTransfers: 0 },
    nextSteps: [], nextWeekPlan: [], hasEvidence: false,
  };
  if (!from) return result;
  const inWeek = (date: string | undefined): date is string => !!date && validDate(date) && date >= from && date <= today;
  const past = (date: string) => validDate(date) && date <= today;
  const days = new Set<string>(), missionIds = new Set(catalogue.missions.map((mission) => mission.id));
  for (const [id, completed] of Object.entries(p.completed)) if (missionIds.has(id) && inWeek(completed.date)) { result.core.completed++; days.add(completed.date); }
  const seenCore = new Set<string>();
  for (const review of p.reviewLog) {
    const completion = p.completed[review.id];
    if (!missionIds.has(review.id) || !completion || !inWeek(review.date) || seenCore.has(`${review.date}:${review.id}`)) continue;
    seenCore.add(`${review.date}:${review.id}`); days.add(review.date);
    result.core.recallChecks++; result.core.recallCorrect += Number(review.correct);
    result.core.laterDayCorrect += Number(review.correct && past(completion.date) && completion.date < review.date);
  }
  for (const unit of catalogue.grammar) {
    const draft = p.academy?.grammar[unit.id]; if (!draft) continue;
    if (inWeek(draft.completed)) {
      result.grammar.completed++; days.add(draft.completed);
      // The ordinary grammar completion gate includes an output and self-checks.
      if (draft.output.trim()) result.selfAssessed.grammarProductions++;
    }
    for (const exercise of unit.exercises) {
      const attempts = (draft.attempts[exercise.id] ?? []).filter((attempt) => past(attempt.date));
      const recordedDays = [...new Set(attempts.filter((attempt) => inWeek(attempt.date)).map((attempt) => attempt.date))];
      for (const date of recordedDays) {
        const onDate = attempts.filter((attempt) => attempt.date === date), first = onDate[0];
        days.add(date); result.grammar.exerciseDays++;
        result.grammar.independentFirstCorrect += Number(first.correct && !first.assisted);
        result.grammar.supportedFirst += Number(first.assisted);
        result.grammar.sameDayRepairs += Number(!first.correct && onDate.some((attempt) => attempt.correct));
        result.grammar.laterDayCorrect += Number(first.correct && !first.assisted && attempts.some((attempt) => attempt.date < date));
      }
    }
  }
  const words = new Set(catalogue.words.map((word) => word.key));
  for (const [key, word] of Object.entries(p.academy?.words ?? {})) if (words.has(key) && normalise(word.term.it) === key && inWeek(word.lastDate)) {
    days.add(word.lastDate); result.personalWords.latestReviews++;
  }
  // A typed word and its Games counterpart retain separate attempts, but share
  // an identity here. Date-only records cannot order conflicting same-day work.
  const latestPractice = new Map<string, { date: string; correct: boolean; assisted: boolean; ambiguous: boolean }>();
  for (const source of [
    { ids: new Set(catalogue.arcade.map(item => item.id)), records: p.arcade?.records },
    { ids: new Set((catalogue.vocab ?? []).map(item => item.id)), records: p.vocabPractice?.records },
  ]) for (const [id, record] of Object.entries(source.records ?? {})) {
    if (!source.ids.has(id) || !past(record.date)) continue;
    if (inWeek(record.date)) days.add(record.date);
    const previous = latestPractice.get(id);
    if (!previous || record.date > previous.date) latestPractice.set(id, { date: record.date, correct: record.last.correct, assisted: record.last.assisted, ambiguous: false });
    else if (record.date === previous.date && (record.last.correct !== previous.correct || record.last.assisted !== previous.assisted)) latestPractice.set(id, { ...previous, ambiguous: true });
  }
  for (const record of latestPractice.values()) if (inWeek(record.date)) {
    result.arcade.latestItems++;
    if (record.ambiguous) { result.arcade.ambiguousLatest++; continue; }
    result.arcade.independentLatestCorrect += Number(record.correct && !record.assisted);
    result.arcade.supportedLatest += Number(record.assisted);
  }
  const active = p.academy?.programme, knownProgramme = reportCatalogue.programmes.find((programme) => programme.id === active?.id);
  if (active && knownProgramme) for (const [index, draft] of Object.entries(active.practice ?? {})) {
    if (!/^(0|[1-9]\d*)$/.test(index) || !knownProgramme.days[Number(index)]?.practice || !inWeek(draft.completed)) continue;
    result.selfAssessed.programmeCheckpoints++; days.add(draft.completed);
  }
  const companionIds = new Set(reportCatalogue.companionIds);
  for (const [id, page] of Object.entries(p.academy?.companion ?? {})) if (companionIds.has(id) && page.selfChecked && inWeek(page.completed)) { result.selfAssessed.companionPages++; days.add(page.completed); }
  const knownItems = new Map(chapters.flatMap((chapter) => chapter.items.map((item) => [item.id, { chapter, item }] as const)));
  const latestDiagnostics = new Map<string, { date: string; correct: boolean; assisted: boolean; ambiguous?: boolean }>();
  const checkedChapters = new Set<string>();
  for (const run of Object.values(diagnostics.runs)) for (const [id, answer] of Object.entries(run.answers)) {
    const known = knownItems.get(id); if (!known || run.chapterId !== known.chapter.id || !past(answer.date)) continue;
    const previous = latestDiagnostics.get(id);
    if (!previous || answer.date > previous.date) latestDiagnostics.set(id, answer);
    else if (answer.date === previous.date && (answer.correct !== previous.correct || answer.assisted !== previous.assisted)) latestDiagnostics.set(id, { ...previous, ambiguous: true });
    if (inWeek(answer.date)) {
      days.add(answer.date); checkedChapters.add(run.chapterId); result.diagnostics.checked++;
      result.diagnostics.independentCorrect += Number(answer.correct && !answer.assisted); result.diagnostics.supported += Number(answer.assisted);
    }
  }
  result.diagnostics.chapters = checkedChapters.size;
  for (const [key, run] of Object.entries(p.oralPractice?.runs ?? {})) {
    if (!Object.hasOwn(oralPracticeIdentities, run.sceneId) || key !== oralRunKey(run.date, run.sceneId)) continue;
    for (const kind of ["gist", "detail"] as const) {
      const first = run[kind].first;
      if (!first || !inWeek(first.date)) continue;
      days.add(first.date);
      if (kind === "gist") result.oralPractice.gistFirstChecks++;
      else result.oralPractice.detailFirstChecks++;
      result.oralPractice.correctWithoutTextSupport += Number(first.correct && !first.supported);
      result.oralPractice.supportedFirstChecks += Number(first.supported);
    }
    if (run.stage === "complete" && inWeek(run.completed)) {
      result.oralPractice.completedRuns++; days.add(run.completed);
    }
    const transfer = run.transfer;
    if (run.stage === "complete" && run.completed && past(run.completed) && transfer?.draft.trim()
      && transfer.checks.every(Boolean) && inWeek(transfer.completed) && transfer.completed > run.completed) {
      result.oralPractice.laterDayTransfers++; days.add(transfer.completed);
    }
  }
  const queue = selectReviewQueue(p, catalogue, today, 5);
  result.nextSteps = queue.items.slice(0, 2).map((item) => ({
    id: item.canonicalId, title: item.title, route: item.route,
    detail: { en: "An existing saved review date is due. Open its specific recall practice.", it: "Una data di ripasso salvata è arrivata. Apri il relativo esercizio di richiamo." },
  }));
  const nextDiagnostic = [...latestDiagnostics.entries()].filter(([, answer]) => !answer.ambiguous && (!answer.correct || answer.assisted)).sort((a, b) => b[1].date.localeCompare(a[1].date) || a[0].localeCompare(b[0]))
    .map(([id]) => knownItems.get(id)!).find(({ item, chapter }) => diagnosticCatchUp(p, item, units, chapter).length);
  if (nextDiagnostic && result.nextSteps.length < 3) {
    const step = diagnosticCatchUp(p, nextDiagnostic.item, units, nextDiagnostic.chapter)[0];
    if (!result.nextSteps.some((item) => item.route === step.route)) result.nextSteps.push({ id: `diagnostic:${nextDiagnostic.item.id}`, title: step.title, route: step.route,
      detail: { en: "A recent saved topic check was incorrect or supported. Begin with its specific preparation or practice.", it: "L’ultimo controllo salvato su questo tema era errato o aiutato. Parti dalla relativa preparazione o pratica." } });
  }
  result.activeDays = [...days].sort(); result.hasEvidence = result.activeDays.length > 0;
  if (!result.nextSteps.length) result.nextSteps.push({ id: "continue-today", title: { en: "Continue today", it: "Continua oggi" }, route: "today",
    detail: { en: "Follow the next step in your saved study plan. You can pause whenever you need.", it: "Segui il prossimo passo del tuo piano di studio salvato. Puoi fermarti quando serve." } });
  const plannedDays = new Set(p.plan.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  const dates = Array.from({ length: 7 }, (_, index) => addDays(today, index + 1)).filter((date) => (!validDate(p.plan.start) || date >= p.plan.start) && plannedDays.has(new Date(`${date}T12:00:00Z`).getUTCDay()));
  result.nextWeekPlan = result.nextSteps.slice(0, Math.min(3, dates.length)).map((step, index) => ({ date: dates[index], step }));
  return result;
}
