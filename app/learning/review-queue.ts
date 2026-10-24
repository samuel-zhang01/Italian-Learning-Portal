import { addDays, normalise, validDate } from "./learning-utils.ts";
import type { Pair, Progress } from "./types.ts";

export type ReviewKind = "lesson" | "grammar" | "word" | "arcade";
export type ReviewBudget = 2 | 5 | 10;
export type ReviewReason = "mistake" | "supported" | "scheduled" | "saved";
export type ReviewCatalogue = {
  missions: readonly { id: string; title: Pair }[];
  grammar: readonly { id: string; title: Pair; exercises: readonly { id: string; kind?: string }[] }[];
  words: readonly { key: string; term: Pair }[];
  arcade: readonly { id: string; title: Pair; unitId?: string; grammarExerciseId?: string; wordKey?: string }[];
};
export type ReviewItem = {
  id: string;
  canonicalId: string;
  kind: ReviewKind;
  title: Pair;
  route: string;
  due: string;
  evidenceDate: string;
  reason: ReviewReason;
  supportUsed: boolean;
  estimatedSeconds: number;
  overdueDays: number;
  cueLanguage?: "en";
};
export type ReviewQueue = {
  budgetMinutes: ReviewBudget;
  items: ReviewItem[];
  groups: { kind: ReviewKind; items: ReviewItem[] }[];
  counts: Record<ReviewKind, number>;
  totalDue: number;
  remainingCount: number;
  estimatedSeconds: number;
};
type Candidate = Omit<ReviewItem, "overdueDays">;
const cost: Record<ReviewKind, number> = { lesson: 120, grammar: 60, word: 30, arcade: 60 };
const kindOrder: Record<ReviewKind, number> = { lesson: 0, grammar: 1, word: 2, arcade: 3 };
const reasonOrder: Record<ReviewReason, number> = { mistake: 0, supported: 1, scheduled: 2, saved: 3 };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const reviewBudget = (minutes: number): ReviewBudget => minutes === 2 || minutes === 10 ? minutes : 5;
const grammarKey = (id: string) => `grammar:${id}`;
const wordTarget = (key: string) => `word:${key}`;

/** Read-only recommendations. Existing practice engines own attempts, schedules and credit. */
export function selectReviewQueue(p: Progress, catalogue: ReviewCatalogue, today: string, minutes = 5): ReviewQueue {
  const budgetMinutes = reviewBudget(minutes);
  const empty: ReviewQueue = { budgetMinutes, items: [], groups: [], counts: { lesson: 0, grammar: 0, word: 0, arcade: 0 }, totalDue: 0, remainingCount: 0, estimatedSeconds: 0 };
  if (!validDate(today)) return empty;
  const candidates: Candidate[] = [];
  const touchedToday = new Set<string>();
  const knownExercises = new Set(catalogue.grammar.flatMap((unit) => unit.exercises.map((exercise) => exercise.id)));
  const knownUnits = new Set(catalogue.grammar.map((unit) => unit.id));
  const knownWords = new Map(catalogue.words.map((word) => [word.key, word]));
  const knownArcade = new Map(catalogue.arcade.map((item) => [item.id, item]));
  const arcadeKey = (item: ReviewCatalogue["arcade"][number]) => item.grammarExerciseId
    ? grammarKey(item.grammarExerciseId) : item.wordKey ? wordTarget(item.wordKey) : `arcade:${item.id}`;
  const add = (candidate: Omit<Candidate, "estimatedSeconds">) => candidates.push({ ...candidate, estimatedSeconds: cost[candidate.kind] });
  const recordedDate = (date: string) => validDate(date) && date <= today;

  for (const mission of catalogue.missions) {
    const completion = p.completed[mission.id], schedule = p.reviews[mission.id];
    const canonicalId = `lesson:${mission.id}`;
    const logs = p.reviewLog.filter((log) => log.id === mission.id && recordedDate(log.date));
    if (completion?.date === today || schedule?.lastDate === today || logs.some((log) => log.date === today)) touchedToday.add(canonicalId);
    if (!completion || !schedule || !recordedDate(completion.date) || !validDate(schedule.due)) continue;
    if (schedule.lastDate && !recordedDate(schedule.lastDate)) continue;
    const latestLog = logs.at(-1);
    const evidenceDate = [completion.date, schedule.lastDate, latestLog?.date ?? ""].filter(Boolean).sort(compare).at(-1) ?? completion.date;
    let reason: ReviewReason = "scheduled";
    let supportUsed = false;
    if (latestLog?.date === evidenceDate) reason = latestLog.correct ? "scheduled" : "mistake";
    else if (schedule.attempts === 0 && evidenceDate === completion.date) {
      supportUsed = completion.supported;
      reason = completion.firstCorrect < completion.total ? "mistake" : supportUsed ? "supported" : "scheduled";
    }
    add({ id: canonicalId, canonicalId, kind: "lesson", title: mission.title, route: `review/${mission.id}`, due: schedule.due, evidenceDate, reason, supportUsed });
  }

  for (const unit of catalogue.grammar) {
    const draft = p.academy?.grammar[unit.id];
    if (!draft) continue;
    for (const exercise of unit.exercises) {
      const canonicalId = grammarKey(exercise.id);
      const last = draft.attempts[exercise.id]?.at(-1);
      if (draft.completed === today || last?.date === today) touchedToday.add(canonicalId);
      if (!last || !recordedDate(last.date)) continue;
      // Match grammarReviewQueue's existing intervals, including supported success.
      const due = addDays(last.date, last.correct && !last.assisted ? 3 : 1);
      const supportUsed = last.assisted || draft.hintDates?.[exercise.id] === today;
      add({ id: `grammar:${unit.id}:${exercise.id}`, canonicalId, kind: "grammar", title: unit.title,
        route: `grammar/${unit.id}?exercise=${encodeURIComponent(exercise.id)}&review=1`,
        due, evidenceDate: last.date, reason: !last.correct ? "mistake" : supportUsed ? "supported" : "scheduled", supportUsed });
    }
  }

  for (const [key, memory] of Object.entries(p.academy?.words ?? {})) {
    const known = knownWords.get(key);
    if (!known || normalise(memory.term.it) !== key) continue;
    const canonicalId = wordTarget(key);
    if (memory.lastDate === today) touchedToday.add(canonicalId);
    if (!memory.starred || (memory.lastDate && !recordedDate(memory.lastDate)) || (memory.due && !validDate(memory.due))) continue;
    // Lapse totals do not tell us the latest self-rating; never label them as a new error.
    add({ id: canonicalId, canonicalId, kind: "word", title: { en: known.term.en, it: known.term.en }, cueLanguage: "en",
      route: `words?word=${encodeURIComponent(key)}`, due: memory.due || today, evidenceDate: memory.lastDate,
      reason: memory.lastDate ? "scheduled" : "saved", supportUsed: false });
  }

  for (const item of knownArcade.values()) {
    if ((item.unitId && !knownUnits.has(item.unitId)) || (item.grammarExerciseId && !knownExercises.has(item.grammarExerciseId)) || (item.wordKey && !knownWords.has(item.wordKey))) continue;
    const record = p.arcade?.records[item.id], canonicalId = arcadeKey(item);
    if (record?.date === today || (p.arcade?.active?.date === today && p.arcade.active.answers[item.id])) touchedToday.add(canonicalId);
    if (!record || !recordedDate(record.date) || !validDate(record.due)) continue;
    add({ id: `arcade:${item.id}`, canonicalId, kind: "arcade", title: item.title,
      route: `games?review=${encodeURIComponent(item.id)}`, due: record.due, evidenceDate: record.date,
      reason: !record.last.correct ? "mistake" : record.last.assisted ? "supported" : "scheduled", supportUsed: record.last.assisted });
  }

  // A newer recall supersedes an older exact duplicate even when its next due date
  // is still in the future. Same-day ties retain the shorter existing interval.
  const newest = new Map<string, Candidate>();
  for (const item of candidates) {
    const previous = newest.get(item.canonicalId);
    const order = previous ? compare(previous.evidenceDate, item.evidenceDate)
      || compare(item.due, previous.due)
      || reasonOrder[item.reason] - reasonOrder[previous.reason]
      || kindOrder[item.kind] - kindOrder[previous.kind]
      || compare(item.id, previous.id) : -1;
    if (!previous || order < 0) newest.set(item.canonicalId, item);
  }
  const priority = (item: ReviewItem) => reasonOrder[item.reason] * 2 + Number(!item.overdueDays);
  const due = [...newest.values()].filter((item) => !touchedToday.has(item.canonicalId) && item.due <= today)
    .map((item): ReviewItem => ({ ...item, overdueDays: Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${item.due}T12:00:00Z`)) / 86400000)) }))
    .sort((a, b) => priority(a) - priority(b) || compare(a.due, b.due) || kindOrder[a.kind] - kindOrder[b.kind] || compare(a.id, b.id));
  const items: ReviewItem[] = [];
  let estimatedSeconds = 0;
  for (const item of due) {
    empty.counts[item.kind] += 1;
    if (estimatedSeconds + item.estimatedSeconds <= budgetMinutes * 60) {
      items.push(item); estimatedSeconds += item.estimatedSeconds;
    }
  }
  return { budgetMinutes, items, groups: [...new Set(items.map((item) => item.kind))].map((kind) => ({ kind, items: items.filter((item) => item.kind === kind) })), counts: empty.counts, totalDue: due.length, remainingCount: due.length - items.length, estimatedSeconds };
}
