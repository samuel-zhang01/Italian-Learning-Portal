import data from "./booster-content.json" with { type: "json" };
import type { ArcadeItem, Pair } from "./types.ts";
import { normalise } from "./learning-utils.ts";
import { shuffled } from "./arcade-engine.ts";

type SourceRef = { id: string; pages: number[] };
export type BoosterVerb = {
  id: string;
  infinitive: string;
  meaning: Pair;
  level: "A1" | "A2";
  group: string;
  present: string[];
  pastParticiple: string;
  pastParticiples?: string[];
  auxiliary: "avere" | "essere";
  reflexive: boolean;
  examples: { present: Pair; past: Pair };
  pastContext: Pair;
  note: Pair;
  sourceRefs: SourceRef[];
  unitId: string;
};
export type BoosterNoun = {
  id: string;
  term: Pair;
  gender: "m" | "f";
  plural: string;
  example: Pair;
  sourceRefs: SourceRef[];
};

export const boosterVerbs = data.verbs as BoosterVerb[];
export const boosterNouns = data.nouns as BoosterNoun[];
export const verbPeople = ["io", "tu", "lui / lei", "noi", "voi", "loro"];
const auxiliaryForms = {
  avere: ["ho", "hai", "ha", "abbiamo", "avete", "hanno"],
  essere: ["sono", "sei", "è", "siamo", "siete", "sono"],
};
const reflexives = ["mi", "ti", "si", "ci", "vi", "si"];
const unique = (values: string[]) => [...new Map(values.map((value) => [normalise(value), value])).values()];

export function pastVerbAnswers(verb: BoosterVerb, person: number): string[] {
  const participles = unique([verb.pastParticiple, ...(verb.pastParticiples ?? [])]);
  const forms = verb.auxiliary === "essere"
    ? participles.flatMap((participle) => {
      const stem = participle.slice(0, -1);
      return person < 3 ? [stem + "o", stem + "a"] : [stem + "i", stem + "e"];
    }) : participles;
  const prefix = `${verb.reflexive ? reflexives[person] + " " : ""}${auxiliaryForms[verb.auxiliary][person]}`;
  return unique(forms.map((form) => `${prefix} ${form}`));
}

export function verbBoosterItems(verb: BoosterVerb): ArcadeItem[] {
  return (["present", "past"] as const).flatMap((tense) => verbPeople.map((person, index) => {
    const answers = tense === "present" ? [verb.present[index]] : pastVerbAnswers(verb, index);
    const correct = new Set(answers.map(normalise));
    const wrong = unique(tense === "present" ? verb.present : verbPeople.flatMap((_, i) => pastVerbAnswers(verb, i)))
      .filter((value) => !correct.has(normalise(value)));
    const id = `${verb.id}:${tense}:${index}`;
    const example = verb.examples[tense];
    return {
      id, mode: "verbs", verbId: verb.id, tense, level: verb.level,
      unitId: verb.unitId, sourceRefs: verb.sourceRefs,
      title: { en: `${verb.infinitive} · ${verb.meaning.en}`, it: `${verb.infinitive} · ${tense === "present" ? "presente" : "passato prossimo"}` },
      prompt: {
        en: `${tense === "present" ? "Present" : "Passato prossimo"}: ${person} + ${verb.infinitive}`,
        it: `${tense === "present" ? "Presente" : "Passato prossimo"}: ${person} + ${verb.infinitive}`,
      },
      instruction: {
        en: `${tense === "past" ? `Context: ${verb.pastContext.en}. ` : ""}Answer with the verb${verb.reflexive ? ", including its reflexive pronoun" : tense === "past" ? " (auxiliary + participle)" : ""}; leave out the subject.`,
        it: `${tense === "past" ? `Contesto: ${verb.pastContext.it}. ` : ""}Rispondi con il verbo${verb.reflexive ? ", compreso il pronome riflessivo" : tense === "past" ? " (ausiliare + participio)" : ""}; ometti il soggetto.`,
      },
      answers,
      options: [answers[0], ...shuffled(wrong, id).slice(0, 3)],
      hint: tense === "present" ? {
        en: `Start with “${answers[0].slice(0, 2)}”. ${verb.reflexive ? `Keep the pronoun ${reflexives[index]}.` : `Match the ending to ${person}.`}`,
        it: `Inizia con «${answers[0].slice(0, 2)}». ${verb.reflexive ? `Mantieni il pronome ${reflexives[index]}.` : `Abbina la desinenza a ${person}.`}`,
      } : {
        en: `Use ${verb.auxiliary}: ${auxiliaryForms[verb.auxiliary][index]}. The participle starts “${verb.pastParticiple.slice(0, 3)}…”.${verb.auxiliary === "essere" ? " Match its ending to the person or people." : ""}`,
        it: `Usa ${verb.auxiliary}: ${auxiliaryForms[verb.auxiliary][index]}. Il participio inizia con «${verb.pastParticiple.slice(0, 3)}…».${verb.auxiliary === "essere" ? " Concorda la desinenza con la persona o le persone." : ""}`,
      },
      explanation: {
        en: `${tense === "past" ? `${verb.note.en} ` : ""}${example.it} — ${example.en}${tense === "past" && verb.reflexive ? " Masculine and feminine endings are accepted." : ""}`,
        it: `${tense === "past" ? `${verb.note.it} ` : ""}${example.it}${tense === "past" && verb.reflexive ? " Sono accettate le desinenze maschili e femminili." : ""}`,
      },
    } satisfies ArcadeItem;
  }));
}

export function nounBoosterItems(noun: BoosterNoun): ArcadeItem[] {
  const phrase = noun.term.it.replaceAll("’", "'");
  const match = /^(gli|lo|la|il|le|i)\s+(.+)$|^(l')(.+)$/.exec(phrase);
  if (!match) throw new Error(`Noun needs its singular definite article: ${noun.id}`);
  const article = match[1] || match[3], word = match[2] || match[4];
  const gender = noun.gender === "m" ? { en: "masculine", it: "maschile" } : { en: "feminine", it: "femminile" };
  const common = {
    mode: "words" as const, wordFocus: "articles" as const, sourceRefs: noun.sourceRefs,
    title: { en: "Nouns & articles", it: "Nomi e articoli" },
    word: { term: noun.term, example: noun.example },
    explanation: {
      en: `${noun.term.it} is ${gender.en}; its plural is ${noun.plural}. ${noun.example.it} — ${noun.example.en}`,
      it: `${noun.term.it} è ${gender.it}; il plurale è ${noun.plural}. ${noun.example.it}`,
    },
  };
  return [{
    ...common, id: `${noun.id}:article`,
    prompt: { en: `Choose the article: ___ ${word}`, it: `Scegli l’articolo: ___ ${word}` },
    instruction: { en: `${noun.term.en}. Answer with the singular definite article only.`, it: `${noun.term.en}. Rispondi solo con l’articolo determinativo singolare.` },
    answers: [article], options: ["il", "lo", "la", "l'"],
    hint: { en: `This noun is ${gender.en}. Listen to its first sound and choose its singular definite article.`, it: `Questo nome è ${gender.it}. Ascolta il suono iniziale e scegli l’articolo determinativo singolare.` },
  }, {
    ...common, id: `${noun.id}:plural`,
    prompt: { en: `Make this noun plural: ${noun.term.it}`, it: `Metti al plurale: ${noun.term.it}` },
    instruction: { en: `${noun.term.en}. Answer with the complete plural phrase, including its article.`, it: `${noun.term.en}. Rispondi con l’espressione plurale completa di articolo.` },
    answers: [noun.plural],
    hint: { en: `The plural begins “${noun.plural.slice(0, 3)}…”. Keep the article and check the noun ending.`, it: `Il plurale inizia con «${noun.plural.slice(0, 3)}…». Mantieni l’articolo e controlla la desinenza.` },
  }];
}

export const boosterItems = [...boosterVerbs.flatMap(verbBoosterItems), ...boosterNouns.flatMap(nounBoosterItems)];
