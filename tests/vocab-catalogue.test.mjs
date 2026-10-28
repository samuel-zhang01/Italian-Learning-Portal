import test from "node:test";
import assert from "node:assert/strict";
import enrichment from "../app/learning/enrichment.json" with { type: "json" };
import grammar from "../app/learning/grammar.json" with { type: "json" };
import booster from "../app/learning/booster-content.json" with { type: "json" };
import { vocabItems, vocabItemById, vocabBanks, vocabPool, vocabPracticeItems, supplementalGrammarVocabItems, supplementalNounVocabItems } from "../app/learning/vocab-catalogue.ts";
import { emptyProgress, parseProgress } from "../app/learning/engine.ts";
import { saveWord, wordKey } from "../app/learning/academy-engine.ts";
import { isCorrect } from "../app/learning/learning-utils.ts";
import { planningMissions, planningReviewCatalogue } from "../app/learning/planning-data.ts";
import { grammarVocabularyAnswers } from "../app/learning/vocab-grammar.ts";
import { answerVocab, finishVocabRound, startVocabRound, updateVocabDraft } from "../app/learning/vocab-engine.ts";
import { selectReviewQueue } from "../app/learning/review-queue.ts";
import { mergeProfileProgress } from "../app/learning/profile-merge.ts";

test("typed vocabulary retains every previous word identity and gives all 728 entries a typed answer contract", () => {
  assert.equal(vocabItems.length, 728);
  assert.equal(new Set(vocabItems.map(item => item.id)).size, 728);
  for (const word of enrichment.banks.flatMap(bank => bank.words)) assert.ok(vocabItemById.has(word.id));
  for (const item of vocabItems) {
    assert.equal(item.mode, "words"); assert.equal(item.options, undefined);
    assert.ok(item.answers.length > 0 && item.answers.every(answer => answer.trim() && !answer.includes("/")));
    assert.ok(vocabBanks.some(bank => bank.id === item.bankId));
  }
});
test("paired legacy cards accept one complete form without accepting missing auxiliaries or lost accents", () => {
  const past = vocabItemById.get("word:past:4");
  assert.ok(isCorrect("sono andata", past.answers));
  assert.ok(isCorrect("Sono andato.", past.answers));
  assert.equal(isCorrect("andata", past.answers), false);
  assert.ok(isCorrect("italiana", vocabItemById.get("word:identity:4").answers));
  assert.ok(isCorrect("le mani", vocabItemById.get("word:body:0").answers));
  const monday = vocabItems.find(item => item.answers.includes("lunedì"));
  assert.ok(monday); assert.equal(isCorrect("lunedi", monday.answers), false);
});
test("noun spelling hints reveal a useful beginning after the article", () => {
  const phone = vocabItems.find(item => item.answers[0] === "il telefono");
  assert.ok(phone.hint.en.includes("il te"));
  assert.ok(!phone.hint.en.includes("il telefono"));
});
test("saved-word practice selects only starred catalogue entries and preserves the main course/game state", () => {
  const original = emptyProgress();
  const word = vocabItems[0].word;
  const saved = saveWord(original, word.term, word.example);
  assert.deepEqual(vocabPool(original, "saved"), []);
  assert.deepEqual(vocabPool(saved, "saved").map(item => item.id), [word.id]);
  assert.deepEqual(saved.completed, original.completed);
  assert.equal(saved.arcade, original.arcade);
  assert.equal(vocabPool(saved, "all").length, 728);
});

test("every existing grammar and booster-noun word can be typed after saving without expanding the visible 728-entry library", () => {
  const available = new Set(vocabPracticeItems.map(item => wordKey(item.word.term)));
  const terms = [...grammar.units.flatMap(unit => unit.words), ...booster.nouns.map(noun => noun.term)];
  for (const term of terms) {
    assert.ok(available.has(wordKey(term)), term.it);
    const saved = saveWord(emptyProgress(), term);
    assert.ok(vocabPool(saved, "saved").some(item => wordKey(item.word.term) === wordKey(term)), term.it);
  }
  assert.equal(supplementalGrammarVocabItems.length, 245);
  assert.equal(supplementalNounVocabItems.length, 3);
  assert.equal(vocabItems.length, 728); assert.equal(vocabBanks.length, 61);
  assert.equal(vocabPool(emptyProgress(), "all").length, 728);
  assert.equal(vocabItemById.size, vocabPracticeItems.length);
});

test("grammar arrow reminders ask for the form named by the English cue instead of requiring source notation", () => {
  for (const [id, answer] of [["grammar-word:past-essere:0", "arrivare"], ["grammar-word:past-essere:5", "alzarsi"], ["grammar-word:present-ire:0", "dormire"], ["grammar-word:past-irregular:0", "fatto"], ["grammar-word:past-irregular:1", "letto"]]) {
    const item = vocabItemById.get(id);
    assert.ok(item, id);
    assert.deepEqual(item.answers, [answer]);
    assert.equal(item.word.exampleKind, "translation");
    assert.deepEqual(item.word.example, item.word.term, "No example sentence is invented from a grammar word pair.");
    assert.ok(item.unitId && item.sourceRefs.length);
  }
  for (const item of supplementalGrammarVocabItems) assert.ok(item.answers.every(answer => answer && !/[→/]/.test(answer)), item.id);
});

test("saved grammar slash pairs accept one complete meaningful form and retain the raw canonical saved-word key", () => {
  const hunger = vocabItemById.get("grammar-word:avere:0"), like = vocabItemById.get("grammar-word:piacere:0");
  assert.deepEqual(hunger.answers, ["fame", "avere fame"]);
  assert.deepEqual(like.answers, ["mi piace", "mi piacciono"]);
  assert.ok(isCorrect("avere fame", hunger.answers));
  assert.equal(isCorrect("avere", hunger.answers), false);
  assert.ok(isCorrect("mi piacciono", like.answers));
  assert.equal(isCorrect("piacciono", like.answers), false);
  assert.deepEqual(grammarVocabularyAnswers({ en: "to arrive", it: "arrivare → è arrivato/arrivata" }), ["arrivare"]);
  assert.equal(wordKey(hunger.word.term), "fame / avere fame");
});

test("supplemental noun words reuse their authored examples and existing saved-word keys", () => {
  for (const item of supplementalNounVocabItems) {
    const noun = booster.nouns.find(noun => item.id === `noun-vocab:${noun.id}`);
    assert.ok(noun);
    assert.deepEqual(item.word.example, noun.example);
    assert.deepEqual(item.sourceRefs, noun.sourceRefs);
    assert.equal(item.word.exampleKind, undefined);
    assert.ok(isCorrect(noun.term.it, item.answers));
  }
});

test("a saved grammar typed draft survives reload and profile merging, and its dated recall returns through the shared queue", () => {
  const ids = planningMissions.map(mission => mission.id), item = vocabItemById.get("grammar-word:avere:0");
  const initial = saveWord(emptyProgress(), item.word.term);
  const started = startVocabRound(initial, vocabPool(initial, "saved"), "2026-10-28", "grammar-saved-word");
  const local = updateVocabDraft(started, "avere fa"), remote = { ...started, notes: "A note from another device." };
  const merged = mergeProfileProgress(started, local, remote, ids);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.progress.notes, remote.notes);
  const loaded = parseProgress(JSON.stringify(merged.progress), ids);
  assert.equal(loaded.vocabPractice.active.draft, "avere fa");
  assert.equal(vocabItemById.get(loaded.vocabPractice.active.itemIds[0]).id, item.id);
  const finished = finishVocabRound(answerVocab(loaded, item, "avere fame", "2026-10-28"));
  const reloaded = parseProgress(JSON.stringify(finished), ids);
  assert.equal(reloaded.vocabPractice.records[item.id].first.correct, true);
  const queue = selectReviewQueue(reloaded, planningReviewCatalogue, "2026-10-29");
  const due = queue.items.find(row => row.id === `vocab:${item.id}`);
  assert.ok(due); assert.equal(due.canonicalId, `word:${wordKey(item.word.term)}`);
  assert.equal(due.route, `vocab-boost?review=${encodeURIComponent(item.id)}`);
});
