import enrichment from "./enrichment.json" with { type: "json" };
import library from "./vocab-library.json" with { type: "json" };
import booster from "./booster-content.json" with { type: "json" };
import courseVocabulary from "./course-vocabulary.json" with { type: "json" };
import type { ArcadeItem, Pair, Progress, VocabularyBank } from "./types.ts";
import { wordKey } from "./academy-engine.ts";
import { planningGrammarVocabItems, planningSupplementalNounVocabItems, planningUnits } from "./planning-data.ts";
import { grammarVocabularyAnswers } from "./vocab-grammar.ts";

export type VocabCollection = "everyday" | "lesson" | "course";
export type VocabWord = { id: string; term: Pair; example: Pair; exampleKind?: "translation"; answers?: string[]; partOfSpeech?: string; plural?: Pair; gender?: string; sourceRefs?: { id: string; pages: number[] }[]; provenance?: "lesson" | "extension" | "course-list" };
export type VocabBank = Omit<VocabularyBank, "words"> & { words: VocabWord[]; description?: Pair; relatedGrammarIds?: string[]; relatedMissionIds?: string[]; original?: boolean; collection?: VocabCollection };
export const courseVocabBanks: VocabBank[] = courseVocabulary.banks.map(bank => ({
  ...bank, collection: "course", original: false,
  words: bank.words.map(word => ({ ...word, example: word.term, exampleKind: "translation", provenance: "course-list" })),
}));
export const courseVocabularySummary = {
  listRows: courseVocabulary.listRows,
  addedWords: courseVocabBanks.reduce((sum, bank) => sum + bank.words.length, 0),
  coveredRows: courseVocabulary.coverage.filter(entry => !entry.id.startsWith("course-word:")).length,
};
export const vocabBanks: VocabBank[] = [
  ...(library.banks as VocabBank[]).map(bank => ({ ...bank, original: true })),
  ...(enrichment.banks as VocabBank[]).map(bank => ({ ...bank, relatedMissionIds: enrichment.lessons.filter(lesson => lesson.bank === bank.id).map(lesson => lesson.missionId) })),
  ...courseVocabBanks,
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
export type VocabItem = ArcadeItem & { bankId: string; word: VocabWord; paired: boolean; collection: VocabCollection };
const bankItems: VocabItem[] = vocabBanks.flatMap(bank => bank.words.map(word => {
  const answers = word.answers ?? pairedAnswers[word.id] ?? [word.term.it];
  const beginning = answers[0].match(/^(?:(?:il|lo|la|i|gli|le|un|uno|una)\s+|l[’']|un[’']).{1,2}/)?.[0] ?? answers[0].slice(0, 2);
  return {
    id: word.id, mode: "words", bankId: bank.id, title: bank.title,
    prompt: word.term, answers, paired: Boolean(pairedAnswers[word.id]) || (word.provenance === "course-list" && word.term.it.includes("/")), word,
    collection: bank.collection ?? (bank.original ? "everyday" : "lesson"),
    hint: { en: `Start with “${beginning}…”`, it: `Inizia con «${beginning}…»` },
    explanation: word.example, sourceRefs: word.sourceRefs ?? bank.sourceRefs, level: bank.level,
  };
}));
export const supplementalGrammarVocabItems: VocabItem[] = planningGrammarVocabItems.map(entry => {
  const unit = planningUnits.find(unit => unit.id === entry.unitId)!;
  const answers = grammarVocabularyAnswers(entry.term);
  const beginning = answers[0].match(/^(?:(?:il|lo|la|i|gli|le|un|uno|una)\s+|l[’']|un[’']).{1,2}/)?.[0] ?? answers[0].slice(0, 2);
  const word: VocabWord = { id: entry.id, term: entry.term, answers, example: entry.term, exampleKind: "translation" };
  return {
    id: entry.id, mode: "words", bankId: `grammar-${entry.unitId}`, unitId: entry.unitId, collection: "lesson",
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
    id: entry.id, mode: "words", bankId: "saved-nouns", title: { en: "Saved noun practice", it: "Pratica dei nomi salvati" }, collection: "lesson",
    prompt: noun.term, answers: [noun.term.it], paired: false, word,
    hint: { en: `Start with “${beginning}…”`, it: `Inizia con «${beginning}…»` },
    explanation: noun.example, sourceRefs: noun.sourceRefs,
  };
});
const coveredIds = new Set(courseVocabulary.coverage.map(entry => entry.id));
const supplementalItems = [...supplementalGrammarVocabItems, ...supplementalNounVocabItems];
// Already-existing grammar words become visible when the course list includes
// them. The original items and IDs also remain in their established saved pool.
export const vocabItems: VocabItem[] = [...bankItems, ...supplementalItems.filter(item => coveredIds.has(item.id))];
// Keep the entire previous practice catalogue as a prefix, before new targets.
export const vocabPracticeItems: VocabItem[] = [...bankItems.filter(item => item.collection !== "course"), ...supplementalItems, ...bankItems.filter(item => item.collection === "course")];
export const vocabItemById = new Map(vocabPracticeItems.map(item => [item.id, item]));
export function vocabPool(p: Progress, bankId: string) {
  if (bankId === "all") return vocabItems;
  if (bankId === "saved") return vocabPracticeItems.filter(item => p.academy?.words[wordKey(item.word.term)]?.starred);
  return vocabItems.filter(item => item.bankId === bankId);
}
export const vocabSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();

const coveredTypes = new Map<string, string[]>();
for (const entry of courseVocabulary.coverage) {
  if (!("partOfSpeech" in entry) || typeof entry.partOfSpeech !== "string") continue;
  const values = coveredTypes.get(entry.id) ?? [];
  if (!values.includes(entry.partOfSpeech)) values.push(entry.partOfSpeech);
  coveredTypes.set(entry.id, values);
}
export function vocabWordType(item: VocabItem): string | undefined {
  const raw = item.word.partOfSpeech;
  const covered = coveredTypes.get(item.id) ?? [];
  const values = [...(raw && !["phrase", "expression", "other"].includes(raw) ? [raw] : []), ...covered];
  return values.length ? [...new Set(values.flatMap(value => value.split(" / ")))].join(" / ") : raw;
}
const posLabels: Record<string, Pair> = {
  noun: {en:"Noun",it:"Nome"}, "plural noun": {en:"Plural noun",it:"Nome plurale"}, "proper noun": {en:"Proper noun",it:"Nome proprio"},
  verb: {en:"Verb",it:"Verbo"}, "verb form": {en:"Verb form",it:"Forma verbale"}, "verb phrase": {en:"Verb phrase",it:"Locuzione verbale"}, "pronominal verb": {en:"Pronominal verb",it:"Verbo pronominale"},
  adjective: {en:"Adjective",it:"Aggettivo"}, adverb: {en:"Adverb",it:"Avverbio"}, pronoun: {en:"Pronoun",it:"Pronome"}, "subject pronoun": {en:"Subject pronoun",it:"Pronome soggetto"},
  preposition: {en:"Preposition",it:"Preposizione"}, conjunction: {en:"Conjunction",it:"Congiunzione"}, article: {en:"Article",it:"Articolo"}, number: {en:"Number",it:"Numero"},
  phrase: {en:"Expression",it:"Espressione"}, expression: {en:"Expression",it:"Espressione"}, idiom: {en:"Idiom",it:"Espressione idiomatica"}, interjection: {en:"Interjection",it:"Interiezione"},
  possessive: {en:"Possessive",it:"Possessivo"}, determiner: {en:"Determiner",it:"Determinante"}, "past participle": {en:"Past participle",it:"Participio passato"}, "noun phrase": {en:"Noun phrase",it:"Sintagma nominale"},
  "prepositional phrase": {en:"Prepositional phrase",it:"Locuzione prepositiva"}, abbreviation: {en:"Abbreviation",it:"Abbreviazione"}, "ordinal number": {en:"Ordinal number",it:"Numero ordinale"},
};
export function partOfSpeechLabel(value?: string): Pair {
  const parts = [...new Set((value ?? "").split(" / ").filter(Boolean))].map(part => posLabels[part] ?? {en:"Word",it:"Parola"});
  return parts.length ? {en:parts.map(part => part.en).join(" / "),it:parts.map(part => part.it).join(" / ")} : {en:"Word",it:"Parola"};
}
export const vocabPartOfSpeechOptions = ["noun","verb","adjective","adverb","pronoun","preposition","conjunction","article","number","phrase","other"].map(id => ({id,label:id === "other" ? {en:"Other words",it:"Altre parole"} : partOfSpeechLabel(id)}));
const partOfSpeechIdCache = new WeakMap<VocabItem, string[]>();
export function vocabPartOfSpeechIds(item: VocabItem): string[] {
  const cached = partOfSpeechIdCache.get(item);
  if (cached) return cached;
  const raw = vocabWordType(item) ?? "";
  const ids = vocabPartOfSpeechOptions.filter(({id}) => id === "phrase" ? /phrase|expression|idiom|interjection/.test(raw) : id !== "other" && new RegExp(`\\b${id}\\b`).test(raw)).map(({id}) => id);
  if (/participle/.test(raw) && !ids.includes("verb")) ids.push("verb");
  if (/possessive/.test(raw) && !ids.includes("adjective")) ids.push("adjective");
  if (/determiner/.test(raw) && !ids.includes("pronoun")) ids.push("pronoun");
  const result = ids.length ? ids : ["other"];
  partOfSpeechIdCache.set(item, result);
  return result;
}
export const vocabPartOfSpeech = (item: VocabItem) => vocabPartOfSpeechIds(item)[0];
