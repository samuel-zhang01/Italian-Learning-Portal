import {
  answerArcade, emptyArcade, finishArcadeRound, hintArcade,
  nextArcadeItem, shuffled, startArcadeRound, updateArcadeDraft, validateArcade,
} from "./arcade-engine.ts";
import type { ArcadeItem, ArcadeProgress, Progress } from "./types.ts";

export function emptyVocabPractice(): ArcadeProgress {
  const value = emptyArcade();
  return { ...value, settings: { ...value.settings, mode: "words", support: "recall", bank: "all", size: 5 } };
}

// Vocabulary has its own paused round and memory records. The established
// scoring/scheduling engine runs against that record without changing Games.
function adapt(p: Progress, update: (value: Progress) => Progress): Progress {
  const local = { ...p, arcade: p.vocabPractice ?? emptyVocabPractice() };
  const result = update(local);
  if (result === local) return p;
  const { arcade: vocabulary, ...rest } = result;
  return { ...rest, ...(p.arcade ? { arcade: p.arcade } : {}), vocabPractice: vocabulary };
}

export function startVocabRound(p: Progress, items: ArcadeItem[], today: string, id: string, review = false): Progress {
  if (items.some(item => item.mode !== "words")) return p;
  return adapt(p, state => {
    const current = state.arcade!;
    if (current.active) return state;
    const settings = { ...current.settings, mode: "words" as const, support: "recall" as const, size: current.settings.size === 10 ? 10 as const : 5 as const };
    const priority = (item: ArcadeItem) => {
      const record = current.records[item.id];
      if (record && record.due <= today && record.date < today) return !record.last.correct || record.last.assisted ? 0 : 1;
      return record ? 3 : 2;
    };
    const selected = review ? items : [0, 1, 2, 3].flatMap(rank => shuffled(items.filter(item => priority(item) === rank), `${id}:${rank}`)).slice(0, settings.size);
    const prepared = { ...state, arcade: { ...current, settings } };
    const next = startArcadeRound(prepared, selected, today, id, review);
    return next === prepared ? state : next;
  });
}
export const updateVocabDraft = (p: Progress, draft: string) => adapt(p, state => updateArcadeDraft(state, draft));
export const hintVocab = (p: Progress) => adapt(p, hintArcade);
export const answerVocab = (p: Progress, item: ArcadeItem, answer: string, today: string) =>
  item.mode === "words" ? adapt(p, state => answerArcade(state, item, answer, today)) : p;
export const nextVocabItem = (p: Progress) => adapt(p, nextArcadeItem);
export const finishVocabRound = (p: Progress) => adapt(p, finishArcadeRound);

export function validateVocabPractice(value: unknown): asserts value is ArcadeProgress {
  validateArcade(value);
  if (value.settings.mode !== "words" || value.settings.support !== "recall" || ![5, 10].includes(value.settings.size)
    || value.history.some(round => !["words", "review"].includes(round.mode) || round.total > 10)
    || (value.active && (value.active.support !== "recall" || !["words", "review"].includes(value.active.mode)
      || value.active.itemIds.length > 10 || value.active.tokens.length))) throw new Error("vocab-practice");
}
