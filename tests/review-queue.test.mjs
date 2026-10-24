import test from "node:test";
import assert from "node:assert/strict";
import { selectReviewQueue } from "../app/learning/review-queue.ts";

const today = "2026-10-24";
const pair = (value) => ({ en: value, it: value });
const catalogue = {
  missions: [{ id: "core", title: pair("A short lesson") }],
  grammar: [{ id: "unit", title: pair("A grammar topic"), exercises: [{ id: "ex1" }, { id: "ex2" }, { id: "ex3" }] }],
  words: [{ key: "la sciarpa", term: { en: "the scarf", it: "la sciarpa" } }, { key: "il cappello", term: { en: "the hat", it: "il cappello" } }],
  arcade: [
    { id: "grammar:ex1", title: pair("Grammar game"), unitId: "unit", grammarExerciseId: "ex1" },
    { id: "word-scarf", title: pair("Word game"), wordKey: "la sciarpa" },
    { id: "scene:cafe:one", title: pair("A cafe scene") },
  ],
};
const progress = () => ({
  version: 1, language: "en", translations: true,
  plan: { minutes: 30, days: [1, 2, 3], start: "2026-10-01", course: 1 },
  completed: {}, drafts: {}, reviews: {}, reviewLog: [], notes: "", updatedAt: "",
  academy: { grammar: {}, companion: {}, programme: null, assessments: {}, words: {} },
  arcade: { settings: { mode: "words", size: 5, support: "recall", topic: "all", bank: "all", scene: "cafe" }, active: null, history: [], records: {} },
});
const attempt = (date, correct = false, assisted = false) => ({ date, correct, assisted, answer: correct ? "a later response" : "an earlier response" });
const grammarDraft = (attempts) => ({ exerciseIndex: 2, answers: {}, attempts, hints: [], output: "My personal draft remains here.", rubric: [0], modelSeen: false });
const memory = (date = "2026-10-21", due = "2026-10-22", correct = false, assisted = false) => ({ first: { answer: "original", correct: false, assisted: true }, last: { answer: "latest", correct, assisted }, date, due, successes: correct ? 1 : 0 });
const word = (term, fields = {}) => ({ term, starred: true, successes: 1, lapses: 0, due: "2026-10-22", lastDate: "2026-10-21", ...fields });
const core = (p) => {
  p.completed.core = { date: "2026-10-18", firstCorrect: 0, total: 2, output: "My original output.", supported: true, confidence: 2 };
  p.reviews.core = { due: "2026-10-19", interval: 1, attempts: 0, correct: 0, lastDate: "" };
};
const all = (p) => selectReviewQueue(p, catalogue, today, 10);

test("mixed saved evidence produces one deterministic, capped review plan", () => {
  const p = progress(); core(p);
  p.academy.grammar.unit = grammarDraft({ ex1: [attempt("2026-10-20")] });
  p.academy.words["la sciarpa"] = word(catalogue.words[0].term);
  p.arcade.records["scene:cafe:one"] = memory();
  const queue = all(p);
  assert.equal(queue.totalDue, 4);
  assert.deepEqual(queue.counts, { lesson: 1, grammar: 1, word: 1, arcade: 1 });
  assert.equal(queue.items[0].kind, "lesson");
  assert.deepEqual(queue.items.map((item) => item.route), ["review/core", "grammar/unit?exercise=ex1&review=1", "games?review=scene%3Acafe%3Aone", "words?word=la%20sciarpa"]);
  assert.equal(queue.estimatedSeconds, 270);
  assert.deepEqual(queue, all(p));
  assert.deepEqual(queue.groups.flatMap((group) => group.items).map((item) => item.id).sort(), queue.items.map((item) => item.id).sort());
});

test("only existing due core reviews are offered and latest review outcome supersedes initial errors", () => {
  const p = progress(); core(p);
  p.reviews.core.due = "2026-10-25";
  assert.equal(all(p).totalDue, 0);
  p.reviews.core = { due: "2026-10-23", interval: 3, attempts: 1, correct: 1, lastDate: "2026-10-20" };
  p.reviewLog.push({ id: "core", date: "2026-10-20", correct: true });
  assert.equal(all(p).items[0].reason, "scheduled");
  p.reviewLog.push({ id: "core", date: today, correct: false });
  assert.equal(all(p).totalDue, 0);
});

test("grammar uses latest attempt intervals and records current hint support without inventing a new attempt", () => {
  const p = progress();
  p.academy.grammar.unit = grammarDraft({
    ex1: [attempt("2026-10-19"), attempt("2026-10-22", true)],
    ex2: [attempt("2026-10-23", true, true)],
    ex3: [attempt("2026-10-20", true)],
  });
  p.academy.grammar.unit.hintDates = { ex3: today };
  const queue = all(p);
  assert.equal(queue.totalDue, 2);
  assert.ok(!queue.items.some((item) => item.canonicalId === "grammar:ex1"));
  assert.equal(queue.items.find((item) => item.canonicalId === "grammar:ex2").due, today);
  assert.equal(queue.items.find((item) => item.canonicalId === "grammar:ex3").supportUsed, true);
  assert.equal(queue.items.find((item) => item.canonicalId === "grammar:ex3").reason, "supported");
});

test("exact cross-tool duplicates merge, newer evidence wins, and same-day ties use the shorter existing interval", () => {
  const p = progress();
  p.academy.grammar.unit = grammarDraft({ ex1: [attempt("2026-10-20")] });
  p.arcade.records["grammar:ex1"] = memory("2026-10-22", "2026-10-25", true);
  assert.equal(all(p).totalDue, 0, "A newer independently recalled duplicate is not due yet.");
  p.arcade.records["grammar:ex1"].due = today;
  assert.equal(all(p).items[0].kind, "arcade");
  assert.equal(all(p).items[0].reason, "scheduled");
  p.arcade.records["grammar:ex1"] = memory("2026-10-20", "2026-10-23", true);
  assert.equal(all(p).items[0].kind, "grammar");
  assert.equal(all(p).totalDue, 1);
  p.academy.words["la sciarpa"] = word(catalogue.words[0].term);
  p.arcade.records["word-scarf"] = memory("2026-10-22", "2026-10-23");
  assert.equal(all(p).items.filter((item) => item.canonicalId === "word:la sciarpa").length, 1);
});

test("today's attempt, review or completion suppresses its exact aliases across tools", () => {
  const p = progress(); core(p);
  p.reviews.core.lastDate = today;
  p.academy.grammar.unit = grammarDraft({ ex1: [attempt("2026-10-20"), attempt(today, true)] });
  p.arcade.records["grammar:ex1"] = memory();
  p.academy.words["la sciarpa"] = word(catalogue.words[0].term);
  p.arcade.records["word-scarf"] = memory(today, "2026-10-20");
  assert.equal(all(p).totalDue, 0);
  p.academy.grammar.unit = { ...grammarDraft({ ex1: [attempt("2026-10-20")] }), completed: today };
  assert.equal(all(p).totalDue, 0);
});

test("word recall uses saved known terms and never calls cumulative lapses a latest error", () => {
  const p = progress();
  p.academy.words["la sciarpa"] = word(catalogue.words[0].term, { lapses: 8 });
  p.academy.words["il cappello"] = word(catalogue.words[1].term, { due: "", lastDate: "", successes: 0 });
  let queue = all(p);
  assert.equal(queue.items.find((item) => item.canonicalId === "word:la sciarpa").reason, "scheduled");
  assert.equal(queue.items.find((item) => item.canonicalId === "word:il cappello").reason, "saved");
  assert.equal(queue.items[0].title.it, "the scarf", "Queue uses an English cue rather than revealing the Italian recall target.");
  p.academy.words["la sciarpa"].starred = false;
  p.academy.words["il cappello"].lastDate = today;
  queue = all(p);
  assert.equal(queue.totalDue, 0);
});

test("unknown, stale and invalid-date evidence is excluded without changing an active game", () => {
  const p = progress();
  p.completed.removed = { date: "2026-10-20" };
  p.reviews.removed = { due: "2026-10-21" };
  p.academy.grammar.removed = grammarDraft({ ex1: [attempt("2026-10-20")] });
  p.academy.grammar.unit = grammarDraft({ removed: [attempt("2026-10-20")], ex2: [attempt("not-a-date")] });
  p.academy.words.unknown = word(pair("unknown"));
  p.arcade.records.removed = memory();
  p.arcade.records["scene:cafe:one"] = memory();
  p.arcade.active = { id: "unfinished", date: today, mode: "words", support: "recall", itemIds: ["word-scarf"], index: 0, answers: {}, hints: [], draft: "Keep my draft", tokens: [] };
  const before = JSON.stringify(p.arcade.active);
  const queue = all(p);
  assert.equal(queue.totalDue, 1);
  assert.equal(queue.items[0].route, "games?review=scene%3Acafe%3Aone");
  assert.equal(JSON.stringify(p.arcade.active), before);
  assert.equal(selectReviewQueue(p, catalogue, "invalid", 2).totalDue, 0);
});

test("2/5/10-minute choices cap estimated work and selecting a queue mutates no first attempt or credit evidence", () => {
  const p = progress(); core(p);
  p.academy.grammar.unit = grammarDraft({ ex1: [attempt("2026-10-20")], ex2: [attempt("2026-10-21")] });
  p.academy.words["la sciarpa"] = word(catalogue.words[0].term);
  p.arcade.records["scene:cafe:one"] = memory();
  const before = JSON.stringify(p);
  const freeze = (value) => { if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); } };
  freeze(p);
  for (const minutes of [2, 5, 10]) {
    const queue = selectReviewQueue(p, catalogue, today, minutes);
    assert.ok(queue.estimatedSeconds <= minutes * 60);
    assert.equal(queue.remainingCount, queue.totalDue - queue.items.length);
    assert.equal(new Set(queue.items.map((item) => item.canonicalId)).size, queue.items.length);
  }
  assert.equal(selectReviewQueue(p, catalogue, today, 999).budgetMinutes, 5);
  assert.equal(JSON.stringify(p), before);
});
