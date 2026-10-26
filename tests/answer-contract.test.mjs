import test from "node:test";
import assert from "node:assert/strict";
import grammar from "../app/learning/grammar.json" with { type: "json" };
import legacyWordIds from "./fixtures/arcade-word-ids.json" with { type: "json" };
import { emptyProgress } from "../app/learning/engine.ts";
import { checkGrammarAnswer } from "../app/learning/academy-engine.ts";
import {
  answerArcade,
  emptyArcade,
  startArcadeRound,
} from "../app/learning/arcade-engine.ts";
import {
  arcadeBanks,
  arcadeItemById,
  wordArcadeItems,
} from "../app/learning/arcade-catalogue.ts";
import {
  exercisePrompt,
  isCorrect,
  normalise,
} from "../app/learning/learning-utils.ts";

const today = "2026-10-20";
const exercise = (id) =>
  grammar.units.flatMap((unit) => unit.exercises).find((item) => item.id === id);

test("correction tasks state the full-sentence contract in both languages and in games", () => {
  for (const item of grammar.units.flatMap((unit) => unit.exercises)) {
    const prompt = exercisePrompt(item);
    if (item.kind !== "correct") {
      assert.deepEqual(prompt, item.prompt);
      continue;
    }
    assert.match(prompt.en, /Write the whole corrected sentence\./);
    assert.match(prompt.it, /Scrivi tutta la frase corretta\./);
    assert.deepEqual(arcadeItemById.get(`grammar:${item.id}`).prompt, prompt);
  }
  const repair = exercise("present-are-5");
  assert.ok(isCorrect("Voi cucinate a casa.", repair.answers));
  assert.ok(isCorrect("Cucinate a casa.", repair.answers));
  // A verb fragment is now explicitly outside the requested format.
  assert.ok(!isCorrect("cucinate", repair.answers));
  assert.ok(!isCorrect("Voi cucina a casa.", repair.answers));
});

test("authored word-order alternatives earn first-attempt credit in grammar and games", () => {
  const unit = grammar.units.find((item) => item.id === "simple-prepositions");
  const item = exercise("simple-prepositions-4");
  const answer = "A piedi vado da Ada.";
  const progress = checkGrammarAnswer(emptyProgress(), unit, item.id, answer, {
    today,
    hintUsed: false,
  });
  const first = progress.academy.grammar[unit.id].attempts[item.id][0];
  assert.equal(first.correct, true);
  assert.equal(first.assisted, false);

  const arcadeItem = arcadeItemById.get(`grammar:${item.id}`);
  let game = startArcadeRound(
    { ...emptyProgress(), arcade: emptyArcade() },
    [arcadeItem],
    today,
    "answer-contract",
  );
  game = answerArcade(game, arcadeItem, answer, today);
  assert.equal(game.arcade.active.answers[arcadeItem.id].correct, true);
  assert.equal(game.arcade.records[arcadeItem.id].first.correct, true);

  assert.ok(isCorrect("Vado a piedi da Ada.", item.answers));
  assert.ok(isCorrect("Da Ada vado a piedi.", item.answers));
  assert.ok(!isCorrect("Vado da Ada in piedi.", item.answers));
  assert.ok(!isCorrect("Vado piedi Ada da a.", item.answers));
  assert.ok(
    isCorrect("Ho studiato ieri.", exercise("present-past-choice-5").answers),
  );
  assert.ok(
    !isCorrect("Ho studiare ieri.", exercise("present-past-choice-5").answers),
  );
  assert.ok(isCorrect("La compro.", exercise("direct-pronouns-5").answers));
  assert.ok(!isCorrect("Lo compro.", exercise("direct-pronouns-5").answers));
});

test("ottimo before or after the noun satisfies the stated transformation without accepting an agreement error", () => {
  const unit = grammar.units.find((item) => item.id === "a2-better-best");
  const item = exercise("a2-better-best-4");
  for (const answer of ["Questa è un’ottima soluzione.", "Questa è una soluzione ottima."]) {
    const p = checkGrammarAnswer(emptyProgress(), unit, item.id, answer, { today, hintUsed: false });
    assert.equal(p.academy.grammar[unit.id].attempts[item.id][0].correct, true);
    assert.equal(p.academy.grammar[unit.id].attempts[item.id][0].assisted, false);
  }
  assert.equal(isCorrect("Questa è una soluzione ottimo.", item.answers), false);
  assert.equal(isCorrect("Questa è una soluzione ottime.", item.answers), false);
});

test("every accepted reorder answer retains all supplied words and meaningful accents", () => {
  const tokens = (sentence) => normalise(sentence).split(/\s+/).sort();
  for (const item of grammar.units.flatMap((unit) => unit.exercises)) {
    if (item.kind !== "reorder") continue;
    for (const answer of item.answers)
      assert.deepEqual(tokens(answer), tokens(item.tokens.join(" ")), item.id);
  }
  assert.ok(!isCorrect("La chiave e qui.", exercise("noun-gender-4").answers));
});

test("word IDs preserve every deployed association after reorder and insertion", () => {
  assert.equal(Object.keys(legacyWordIds).length, 144);
  const current = new Map(
    arcadeBanks
      .flatMap(wordArcadeItems)
      .map((item) => [item.id, item.answers[0]]),
  );
  assert.equal(
    current.size,
    arcadeBanks.reduce((sum, bank) => sum + bank.words.length, 0),
  );
  for (const [id, answer] of Object.entries(legacyWordIds))
    assert.equal(current.get(id), answer, `saved progress for ${id}`);

  for (const bank of arcadeBanks) {
    const reordered = wordArcadeItems({
      ...bank,
      words: [
        {
          id: `word:${bank.id}:new-example`,
          term: { en: "test entry", it: "voce di prova" },
          example: { en: "An example.", it: "Un esempio." },
        },
        ...bank.words.toReversed(),
      ],
    });
    for (const item of reordered.slice(1))
      assert.equal(item.answers[0], current.get(item.id));
  }
});
