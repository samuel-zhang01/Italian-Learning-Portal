import enrichment from "./enrichment.json" with { type: "json" };
import library from "./vocab-library.json" with { type: "json" };
import booster from "./booster-content.json" with { type: "json" };
import type { ArcadeItem, Pair, Progress, VocabularyBank } from "./types.ts";
import { wordKey } from "./academy-engine.ts";
import { planningGrammarVocabItems, planningSupplementalNounVocabItems, planningUnits } from "./planning-data.ts";
import { grammarVocabularyAnswers } from "./vocab-grammar.ts";

export type VocabWord = { id: string; term: Pair; example: Pair; exampleKind?: "translation"; answers?: string[]; partOfSpeech?: string; plural?: Pair; gender?: string };
export type VocabBank = Omit<VocabularyBank, "words"> & { words: VocabWord[]; description?: Pair; relatedGrammarIds?: string[]; relatedMissionIds?: string[]; original?: boolean };
export const vocabBanks: VocabBank[] = [
  ...(library.banks as VocabBank[]).map(bank => ({ ...bank, original: true })),
  ...(enrichment.banks as VocabBank[]).map(bank => ({ ...bank, relatedMissionIds: enrichment.lessons.filter(lesson => lesson.bank === bank.id).map(lesson => lesson.missionId) })),
];
// These eight older cards name paired forms. A typed round asks for one form,
// including the full auxiliary, rather than requiring a slash-separated list.
const pairedAnswers: Record<string, string[]> = {
  "word:identity:4": ["italiano", "italiana"],
  "word:numbers:0": ["uno", "una"],
  "word:past:4": ["sono andato", "sono andata"],
  "word:past:5": ["sono arrivato", "sono arrivata"],
  "word:clothes:4": ["rosso", "rossa"],
  "word:clothes:6": ["piccolo", "piccola"],
  "word:body:0": ["la mano", "le mani"],
  "word:body:1": ["il dente", "i denti"],
};
export type VocabItem = ArcadeItem & { bankId: string; word: VocabWord; paired: boolean };
export const vocabItems: VocabItem[] = vocabBanks.flatMap(bank => bank.words.map(word => {
  const answers = word.answers ?? pairedAnswers[word.id] ?? [word.term.it];
  const beginning = answers[0].match(/^(?:(?:il|lo|la|i|gli|le|un|uno|una)\s+|l[’']|un[’']).{1,2}/)?.[0] ?? answers[0].slice(0, 2);
  return {
    id: word.id, mode: "words", bankId: bank.id, title: bank.title,
    prompt: word.term, answers, paired: Boolean(pairedAnswers[word.id]), word,
    hint: { en: `Start with “${beginning}…”`, it: `Inizia con «${beginning}…»` },
    explanation: word.example,
  };
}));
export const supplementalGrammarVocabItems: VocabItem[] = planningGrammarVocabItems.map(entry => {
  const unit = planningUnits.find(unit => unit.id === entry.unitId)!;
  const answers = grammarVocabularyAnswers(entry.term);
  const beginning = answers[0].match(/^(?:(?:il|lo|la|i|gli|le|un|uno|una)\s+|l[’']|un[’']).{1,2}/)?.[0] ?? answers[0].slice(0, 2);
  const word: VocabWord = { id: entry.id, term: entry.term, answers, example: entry.term, exampleKind: "translation" };
  return {
    id: entry.id, mode: "words", bankId: `grammar-${entry.unitId}`, unitId: entry.unitId,
    title: unit.title, prompt: entry.term, answers, paired: answers.length > 1, word,
    hint: { en: `Start with “${beginning}…”`, it: `Inizia con «${beginning}…»` },
    explanation: entry.term, sourceRefs: unit.sources,
  };
});
export const supplementalNounVocabItems: VocabItem[] = planningSupplementalNounVocabItems.map(entry => {
  const noun = booster.nouns.find(noun => noun.id === entry.sourceNounId)!;
  const word: VocabWord = { id: entry.id, term: noun.term, answers: [noun.term.it], example: noun.example, partOfSpeech: "noun", gender: noun.gender };
  const beginning = noun.term.it.match(/^(?:(?:il|lo|la|i|gli|le|un|uno|una)\s+|l[’']|un[’']).{1,2}/)?.[0] ?? noun.term.it.slice(0, 2);
  return {
    id: entry.id, mode: "words", bankId: "saved-nouns", title: { en: "Saved noun practice", it: "Pratica dei nomi salvati" },
    prompt: noun.term, answers: [noun.term.it], paired: false, word,
    hint: { en: `Start with “${beginning}…”`, it: `Inizia con «${beginning}…»` },
    explanation: noun.example, sourceRefs: noun.sourceRefs,
  };
});
export const vocabPracticeItems: VocabItem[] = [...vocabItems, ...supplementalGrammarVocabItems, ...supplementalNounVocabItems];
export const vocabItemById = new Map(vocabPracticeItems.map(item => [item.id, item]));
export function vocabPool(p: Progress, bankId: string) {
  if (bankId === "all") return vocabItems;
  if (bankId === "saved") return vocabPracticeItems.filter(item => p.academy?.words[wordKey(item.word.term)]?.starred);
  return vocabItems.filter(item => item.bankId === bankId);
}
export const vocabSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
