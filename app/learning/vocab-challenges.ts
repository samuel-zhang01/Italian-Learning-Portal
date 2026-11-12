import type { ArcadeMemory, ArcadeRound, Pair, Progress } from "./types.ts";
import { addDays, validDate } from "./learning-utils.ts";

export const VOCAB_DAILY_GOAL = 10;
export type VocabularyJourneyItem = { id: string; bankId: string };
export type VocabularyAchievement = {
  id: string;
  title: Pair;
  description: Pair;
  progress: number;
  target: number;
  earned: boolean;
};

const independent = (record: ArcadeMemory) => record.last.correct && !record.last.assisted;
function achievement(id: string, title: Pair, description: Pair, value: number, target: number): VocabularyAchievement {
  return { id, title, description, progress: Math.min(value, target), target, earned: value >= target };
}

/** Derive rewards from retained answers. Browsing and repeat rounds add no word XP. */
export function vocabularyJourney(p: Progress, today: string, items: readonly VocabularyJourneyItem[]) {
  const hasToday = validDate(today);
  const itemById = new Map(items.map(item => [item.id, item]));
  const records = Object.entries(p.vocabPractice?.records ?? {}).filter(([id]) => itemById.has(id));
  const todayRecords = records.filter(([, record]) => hasToday && record.date === today);
  const recalled = records.filter(([, record]) => independent(record)).length;
  const due = records.filter(([, record]) => hasToday && record.date < today && record.due <= today).length;
  const topics = new Set(records.map(([id]) => itemById.get(id)!.bankId));
  const topicsToday = new Set(todayRecords.map(([id]) => itemById.get(id)!.bankId));
  // Games and typed vocabulary share stable word IDs in learningRewards.
  // The union represents the vocabulary part of those same practice points.
  const rewardedIds = new Set([
    ...records.map(([id]) => id),
    ...Object.keys(p.arcade?.records ?? {}).filter(id => itemById.has(id)),
  ]);
  const history = [...new Map((p.vocabPractice?.history ?? [])
    .filter(round => hasToday && validDate(round.date) && round.date <= today)
    .map(round => [round.id, round])).values()];
  // A round's history date is its start date, so it cannot prove an answer on
  // that day. Latest answer dates are retained evidence, not a lifetime ledger.
  const dates = new Set(records.map(([, record]) => record.date)
    .filter(date => hasToday && validDate(date) && date <= today));
  let practiceRun = 0;
  if (hasToday) {
    let cursor = dates.has(today) ? today : addDays(today, -1);
    while (dates.has(cursor)) { practiceRun += 1; cursor = addDays(cursor, -1); }
  }
  const todayAnswered = todayRecords.length;
  const todayIndependent = todayRecords.filter(([, record]) => independent(record)).length;
  const badges = [
    achievement("first-round", { en: "Off you go!", it: "Si parte!" },
      { en: "Finish your first vocabulary round.", it: "Completa il primo giro di vocabolario." }, history.length, 1),
    achievement("ten-words", { en: "Word collector", it: "Colleziona parole" },
      { en: "Try 10 different words.", it: "Prova 10 parole diverse." }, records.length, 10),
    achievement("from-memory", { en: "From memory", it: "A memoria" },
      { en: "Recall 10 different words without a hint.", it: "Ricorda 10 parole diverse senza indizi." }, recalled, 10),
    achievement("topic-traveller", { en: "Topic traveller", it: "Viaggia tra i temi" },
      { en: "Practise words from 3 topics.", it: "Esercitati con parole di 3 temi." }, topics.size, 3),
    achievement("practice-days", { en: "Keep coming back", it: "Continua a tornare" },
      { en: "Record vocabulary practice on 5 different days.", it: "Registra pratica lessicale in 5 giorni diversi." }, dates.size, 5),
  ];
  const quests = [
    achievement("daily-words", { en: "Give 10 words a go", it: "Prova 10 parole" },
      { en: "Answer 10 different words today.", it: "Rispondi a 10 parole diverse oggi." }, todayAnswered, VOCAB_DAILY_GOAL),
    achievement("daily-recall", { en: "Five from memory", it: "Cinque a memoria" },
      { en: "Recall 5 words today without hints.", it: "Ricorda 5 parole oggi senza indizi." }, todayIndependent, 5),
    achievement("daily-topics", { en: "Change the scenery", it: "Cambia scenario" },
      { en: "Try words from 2 topics today.", it: "Prova parole di 2 temi oggi." }, topicsToday.size, 2),
  ];
  return {
    dailyGoal: VOCAB_DAILY_GOAL,
    todayAnswered, todayIndependent,
    dailyProgress: Math.min(1, todayAnswered / VOCAB_DAILY_GOAL),
    dailyPercent: Math.min(100, todayAnswered / VOCAB_DAILY_GOAL * 100),
    practised: records.length, recalled, learning: records.length - recalled,
    unseen: Math.max(0, itemById.size - records.length), due,
    topicsExplored: topics.size, topicsToday: topicsToday.size,
    practiceDays: dates.size, practiceRun, roundsCompleted: history.length,
    xp: rewardedIds.size * 2,
    badges, nextBadge: badges.find(badge => !badge.earned) ?? null, quests,
  };
}

/** An honest live combo: hints and incorrect answers break independent recall. */
export function vocabularyRoundSummary(round: ArcadeRound | null | undefined) {
  const ids = [...new Set(round?.itemIds ?? [])];
  let submitted = 0, recalled = 0, supported = 0, bestCombo = 0, currentCombo = 0;
  for (const id of ids) {
    const answer = round?.answers[id];
    if (!answer) break;
    submitted += 1;
    if (answer.correct && !answer.assisted) {
      recalled += 1; currentCombo += 1; bestCombo = Math.max(bestCombo, currentCombo);
    } else {
      currentCombo = 0;
      if (answer.correct) supported += 1;
    }
  }
  const complete = ids.length > 0 && submitted === ids.length;
  return {
    total: ids.length, submitted, independent: recalled, supported,
    mistakes: submitted - recalled - supported, bestCombo, currentCombo,
    accuracy: submitted ? Math.round((recalled + supported) / submitted * 100) : 0,
    independentAccuracy: submitted ? Math.round(recalled / submitted * 100) : 0,
    complete, perfect: complete && recalled === ids.length,
  };
}
