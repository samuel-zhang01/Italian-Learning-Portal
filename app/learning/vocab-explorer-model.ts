import { wordKey } from "./academy-engine.ts";
import { vocabSearch, type VocabItem } from "./vocab-catalogue.ts";
import type { ArcadeMemory, Progress } from "./types.ts";

export type WordStatus = "new" | "learning" | "recalled";
export function wordStatus(record?: ArcadeMemory): WordStatus {
  if (!record) return "new";
  return record.last.correct && !record.last.assisted ? "recalled" : "learning";
}
export const wordDue = (record: ArcadeMemory | undefined, today: string) => Boolean(record && record.due <= today && record.date < today);
export type WordFilters = { query: string; bank: string; level: string; status: string; source: string };
export function filterVocabulary(items: VocabItem[], p: Progress, today: string, filters: WordFilters) {
  const needle = vocabSearch(filters.query);
  return items.filter(item => {
    const record = p.vocabPractice?.records[item.id];
    if (filters.bank !== "all" && item.bankId !== filters.bank) return false;
    if (filters.level !== "all" && item.level !== filters.level) return false;
    if (filters.source !== "all" && !item.sourceRefs?.some(ref => ref.id === filters.source)) return false;
    if (filters.status === "saved" && !p.academy?.words[wordKey(item.word.term)]?.starred) return false;
    if (filters.status === "due" && !wordDue(record, today)) return false;
    if (["new", "learning", "recalled"].includes(filters.status) && wordStatus(record) !== filters.status) return false;
    return !needle || vocabSearch([item.word.term.it, item.word.term.en, item.title.it, item.title.en, ...item.answers].join(" ")).includes(needle);
  });
}
export function vocabularySummary(items: VocabItem[], p: Progress, today: string) {
  return items.reduce((summary, item) => {
    const record = p.vocabPractice?.records[item.id];
    summary[wordStatus(record)]++;
    if (wordDue(record, today)) summary.due++;
    if (p.academy?.words[wordKey(item.word.term)]?.starred) summary.saved++;
    return summary;
  }, { new: 0, learning: 0, recalled: 0, due: 0, saved: 0 });
}
