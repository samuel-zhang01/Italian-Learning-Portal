import grammar from "./grammar.json" with { type: "json" };
import enrichment from "./enrichment.json" with { type: "json" };
import scenesData from "./arcade-scenes.json" with { type: "json" };
import type {
  ArcadeItem,
  ArcadeSettings,
  GrammarUnit,
  VocabularyBank,
} from "./types.ts";
import { exercisePrompt, normalise } from "./learning-utils.ts";
import { shuffled } from "./arcade-engine.ts";

export const arcadeUnits = grammar.units as GrammarUnit[];
export const arcadeBanks = enrichment.banks as VocabularyBank[];
export const arcadeScenes = scenesData.scenes;
export function wordArcadeItems(bank: VocabularyBank): ArcadeItem[] {
  return bank.words.map(
    (word): ArcadeItem => ({
      id: word.id,
      mode: "words",
      bankId: bank.id,
      title: bank.title,
      prompt: {
        en: `Find the matching Italian ${word.term.it.includes("/") ? "entry (both forms)" : "word or phrase"}: ${word.term.en}`,
        it: `Trova ${word.term.it.includes("/") ? "la voce italiana (entrambe le forme)" : "l’italiano"} per: ${word.term.en}`,
      },
      answers: [word.term.it],
      hint: {
        en: `It begins with “${word.term.it.slice(0, 2)}”. Include the article if the word bank uses one.`,
        it: `Inizia con “${word.term.it.slice(0, 2)}”. Includi l’articolo se è presente nel lessico.`,
      },
      explanation: word.example,
      options: [
        word.term.it,
        ...shuffled(
          bank.words.filter(
            (other) =>
              normalise(other.term.it) !== normalise(word.term.it) &&
              other.term.en !== word.term.en,
          ),
          `options:${word.id}`,
        )
          .slice(0, 3)
          .map((other) => other.term.it),
      ],
      word,
    }),
  );
}
export const arcadeItems: ArcadeItem[] = [
  ...arcadeBanks.flatMap(wordArcadeItems),
  ...arcadeUnits.flatMap((unit) =>
    unit.exercises
      .filter((ex) =>
        ["reorder", "correct", "choice", "tense"].includes(ex.kind),
      )
      .map(
        (ex): ArcadeItem => ({
          id: `grammar:${ex.id}`,
          mode: ex.kind === "reorder" ? "builder" : "detective",
          title: unit.title,
          unitId: unit.id,
          prompt: exercisePrompt(ex),
          answers: ex.answers,
          hint: ex.hint,
          explanation: ex.explanation,
          ...(ex.options ? { options: ex.options } : {}),
          ...(ex.tokens ? { tokens: ex.tokens } : {}),
        }),
      ),
  ),
  ...arcadeScenes.flatMap((scene) =>
    scene.turns.map(
      (turn): ArcadeItem => ({
        id: `scene:${scene.id}:${turn.id}`,
        mode: "conversation",
        sceneId: scene.id,
        unitId: turn.unitId,
        title: scene.title,
        prompt: turn.prompt,
        answers: [turn.answer],
        options: turn.options,
        hint: turn.hint,
        explanation: turn.explanation,
      }),
    ),
  ),
];
export const arcadeItemById = new Map(
  arcadeItems.map((item) => [item.id, item]),
);
export function arcadePool(settings: ArcadeSettings) {
  return arcadeItems.filter((item) => {
    if (item.mode !== settings.mode) return false;
    if (item.mode === "words")
      return settings.bank === "all" || item.bankId === settings.bank;
    if (item.mode === "conversation") return item.sceneId === settings.scene;
    const unit = arcadeUnits.find((u) => u.id === item.unitId);
    if (settings.topic === "foundations")
      return arcadeUnits.slice(0, 10).some((u) => u.id === item.unitId);
    if (settings.topic === "a1") return unit?.level === "A1";
    return item.unitId === settings.topic;
  });
}
