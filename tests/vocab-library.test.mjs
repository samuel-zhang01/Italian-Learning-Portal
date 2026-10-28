import assert from "node:assert/strict";
import test from "node:test";
import library from "../app/learning/vocab-library.json" with { type: "json" };
import enrichment from "../app/learning/enrichment.json" with { type: "json" };
import grammar from "../app/learning/grammar.json" with { type: "json" };
import curriculum from "../app/learning/curriculum.json" with { type: "json" };
import { isCorrect, normalise } from "../app/learning/learning-utils.ts";

const words = library.banks.flatMap(bank => bank.words);
const byTerm = new Map(words.map(word => [word.term.it, word]));

test("the typed library adds 400 distinct original targets across 20 useful themes", () => {
  assert.equal(library.banks.length, 20);
  assert.equal(words.length, 400);
  assert.equal(new Set(words.map(word => word.id)).size, words.length);
  assert.equal(new Set(words.map(word => normalise(word.term.it))).size, words.length);
  const originalTargets = new Set(enrichment.banks.flatMap(bank => bank.words.flatMap(word => [word.term.it, ...word.term.it.split("/")].map(normalise))));
  assert.deepEqual(words.filter(word => originalTargets.has(normalise(word.term.it))).map(word => word.id), []);
  for (const bank of library.banks) {
    assert.equal(bank.words.length, 20);
    assert.match(bank.id, /^boost-[a-z-]+$/);
    assert.ok(["A1", "A2"].includes(bank.level));
  }
});

test("every card has a bounded bilingual cue, a translated original example and accepted typed answers", () => {
  for (const word of words) {
    for (const pair of [word.term, word.example]) {
      assert.deepEqual(Object.keys(pair).sort(), ["en", "it"]);
      for (const value of Object.values(pair)) {
        assert.ok(value.trim() && value === value.trim(), word.id);
        assert.ok(value.length <= 180, word.id);
      }
    }
    assert.ok(!word.term.it.includes("/"), word.id);
    assert.ok(word.answers.includes(word.term.it), word.id);
    assert.equal(new Set(word.answers.map(normalise)).size, word.answers.length, word.id);
    assert.ok(word.answers.every(answer => isCorrect(answer, word.answers)), word.id);
    assert.ok(["noun", "verb", "adjective", "adverb", "phrase", "other"].includes(word.partOfSpeech));
  }
});

test("theme links lead to existing relevant grammar and class lessons", () => {
  const units = new Set(grammar.units.map(unit => unit.id));
  const missions = new Set(curriculum.missions.map(mission => mission.id));
  for (const bank of library.banks) {
    assert.ok(bank.title.en && bank.title.it && bank.description.en && bank.description.it);
    assert.ok(bank.relatedGrammarIds.length && bank.relatedGrammarIds.every(id => units.has(id)), bank.id);
    assert.ok(bank.relatedMissionIds.length && bank.relatedMissionIds.every(id => missions.has(id)), bank.id);
  }
});

test("noun cards state article requirements while calendar dictionary forms remain bare", () => {
  const article = /^(il |lo |la |l[’']|i |gli |le )/;
  const nouns = words.filter(word => word.partOfSpeech === "noun");
  assert.equal(nouns.length, 300);
  for (const bank of library.banks) for (const word of bank.words.filter(word => word.partOfSpeech === "noun")) {
    assert.ok(["m", "f", "both"].includes(word.gender), word.id);
    if (article.test(word.term.it)) assert.match(word.term.en, /^the /, word.id);
    else assert.equal(bank.id, "boost-calendar", word.id);
    if (word.plural) {
      assert.match(word.plural.it, /^(i |gli |le )/, word.id);
      assert.ok(word.plural.en.startsWith("the "), word.id);
    }
  }
  assert.equal(nouns.filter(word => word.plural).length, 258);
  assert.equal(byTerm.get("l’uovo").plural.it, "le uova");
  assert.equal(byTerm.get("il braccio").plural.it, "le braccia");
  assert.equal(byTerm.get("il dito").plural.it, "le dita");
  assert.equal(byTerm.get("l’arancia").plural.it, "le arance");
  assert.equal(byTerm.get("la camicia").plural.it, "le camicie");
});

test("common equivalents and unspecified singular gender variants are accepted without erasing meaningful accents", () => {
  for (const [term, accepted] of [
    ["il frigorifero", "il frigo"], ["il televisore", "la TV"], ["il lavandino", "il lavello"],
    ["la scodella", "la ciotola"], ["il divano", "il sofà"], ["la macchina", "l'auto"],
    ["l’albergo", "l'hotel"], ["la bicicletta", "la bici"], ["felice", "contenta"],
    ["tranquillo", "calma"], ["nuovo", "nuova"], ["arancione", "arancio"],
  ]) assert.ok(isCorrect(accepted, byTerm.get(term).answers), `${term}: ${accepted}`);
  for (const [term, wrong] of [["il tè", "il te"], ["lunedì", "lunedi"], ["lì", "li"]]) {
    assert.equal(isCorrect(wrong, byTerm.get(term).answers), false, `${term}: accent must remain meaningful`);
  }
  assert.equal(isCorrect("sofá", byTerm.get("il divano").answers), false);
  assert.equal(isCorrect("nuovi", byTerm.get("nuovo").answers), false);
});
