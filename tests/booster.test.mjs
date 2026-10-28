import test from "node:test";
import assert from "node:assert/strict";
import curriculum from "../app/learning/curriculum.json" with { type: "json" };
import { emptyProgress, parseProgress } from "../app/learning/engine.ts";
import { answerArcade, emptyArcade, hintArcade, nextArcadeItem, startArcadeRound, updateArcadeDraft, validateArcade } from "../app/learning/arcade-engine.ts";
import { arcadeItemById, arcadeItems, arcadePool } from "../app/learning/arcade-catalogue.ts";
import { boosterItems, boosterNouns, boosterVerbs, pastVerbAnswers } from "../app/learning/booster-catalogue.ts";
import { planningReviewCatalogue } from "../app/learning/planning-data.ts";
import { selectReviewQueue } from "../app/learning/review-queue.ts";
import { isCorrect, normalise } from "../app/learning/learning-utils.ts";

const today = "2026-10-28", tomorrow = "2026-10-29";
const ids = curriculum.missions.map((mission) => mission.id);
const initial = (settings = {}) => ({ ...emptyProgress(), arcade: { ...emptyArcade(), settings: { ...emptyArcade().settings, mode: "verbs", ...settings } } });
const round = (progress, seed = "booster-test") => startArcadeRound(progress, arcadePool(progress.arcade.settings), today, seed);
const verb = (id) => boosterVerbs.find((item) => item.id === `verb:${id}`);

test("booster has bounded, unique six-person verb questions and curated noun article/plural tasks", () => {
  assert.equal(boosterVerbs.length, 50);
  assert.equal(boosterNouns.length, 32);
  assert.equal(boosterItems.length, 664);
  assert.equal(new Set(boosterItems.map((item) => item.id)).size, boosterItems.length);
  for (const item of boosterItems) {
    for (const pair of [item.title, item.prompt, item.instruction, item.hint, item.explanation])
      assert.ok(pair.en.trim() && pair.it.trim(), item.id);
    assert.ok(item.answers.every((answer) => answer.length > 0 && answer.length < 500));
    assert.ok(item.sourceRefs.length > 0);
    if (item.options) {
      assert.ok(item.options.length >= 2 && item.options.length <= 4);
      assert.equal(new Set(item.options.map(normalise)).size, item.options.length);
      assert.equal(item.options.filter((option) => isCorrect(option, item.answers)).length, 1, item.id);
    }
  }
});

test("past verb answers accept authored gender and participle variants without weakening grammar", () => {
  assert.deepEqual(pastVerbAnswers(verb("andare"), 0), ["sono andato", "sono andata"]);
  assert.deepEqual(pastVerbAnswers(verb("andare"), 3), ["siamo andati", "siamo andate"]);
  assert.deepEqual(pastVerbAnswers(verb("svegliarsi"), 1), ["ti sei svegliato", "ti sei svegliata"]);
  assert.deepEqual(pastVerbAnswers(verb("alzarsi"), 5), ["si sono alzati", "si sono alzate"]);
  assert.ok(isCorrect("Ho veduto.", pastVerbAnswers(verb("vedere"), 0)));
  assert.ok(!isCorrect("ho andato", pastVerbAnswers(verb("andare"), 0)));
  assert.ok(!isCorrect("sono andati", pastVerbAnswers(verb("andare"), 0)));
  assert.ok(!isCorrect("e andata", pastVerbAnswers(verb("andare"), 2)));
  assert.ok(!isCorrect("hai svegliato", pastVerbAnswers(verb("svegliarsi"), 1)));
  assert.ok(!isCorrect("ho mangiata", pastVerbAnswers(verb("mangiare"), 0)));
  assert.ok(arcadeItemById.get("verb:finire:past:0").instruction.en.includes(verb("finire").pastContext.en));
});

test("difficulty and vocabulary selectors isolate their stated material and mixed rounds contain both tenses", () => {
  for (const level of ["present", "past"]) {
    const pool = arcadePool(initial({ verbLevel: level }).arcade.settings);
    assert.ok(pool.length >= 100);
    assert.ok(pool.every((item) => item.tense === level && item.level === "A1"));
  }
  assert.ok(arcadePool(initial({ verbScope: "all" }).arcade.settings).some((item) => item.level === "A2"));
  for (let seed = 0; seed < 20; seed++) {
    const p = round(initial({ verbLevel: "mixed" }), String(seed));
    assert.equal(p.arcade.active.itemIds.length, 5);
    assert.deepEqual(new Set(p.arcade.active.itemIds.map((id) => arcadeItemById.get(id).tense)), new Set(["present", "past"]));
  }
  const nouns = arcadePool(initial({ mode: "words", wordFocus: "articles" }).arcade.settings);
  assert.equal(nouns.length, 64);
  assert.ok(nouns.every((item) => item.wordFocus === "articles"));
  const meanings = arcadePool(initial({ mode: "words", wordFocus: "meaning", bank: "all" }).arcade.settings);
  assert.ok(meanings.length >= 304);
  assert.ok(meanings.every((item) => item.word && !item.id.startsWith("noun:")));
  assert.ok(isCorrect("lo", arcadeItemById.get("noun:zaino:article").answers));
  assert.ok(isCorrect("gli zaini", arcadeItemById.get("noun:zaino:plural").answers));
  assert.ok(!isCorrect("i zaini", arcadeItemById.get("noun:zaino:plural").answers));
  assert.ok(isCorrect("le colleghe", arcadeItemById.get("noun:collega-f:plural").answers));
});

test("new settings and active verb answers survive backups while old arcade settings still load", () => {
  const old = initial();
  old.arcade.settings.mode = "words";
  delete old.arcade.settings.wordFocus;
  delete old.arcade.settings.verbLevel;
  delete old.arcade.settings.verbScope;
  assert.deepEqual(parseProgress(JSON.stringify(old), ids), old);
  let p = round(initial({ verbLevel: "past", support: "recall", size: 10, verbScope: "all" }));
  p = updateArcadeDraft(p, "mi sono");
  p = hintArcade(p);
  const selected = arcadeItemById.get(p.arcade.active.itemIds[0]);
  p = answerArcade(p, selected, selected.answers.at(-1), today);
  assert.equal(p.arcade.records[selected.id].first.correct, true);
  assert.equal(p.arcade.records[selected.id].first.assisted, true);
  const restored = parseProgress(JSON.stringify(p), ids);
  assert.deepEqual(restored, p);
  assert.equal(restored.arcade.active.draft, selected.answers.at(-1));
  assert.equal(nextArcadeItem(restored).arcade.active.index, 1);
  for (const patch of [{ verbLevel: "future" }, { wordFocus: "everything" }, { verbScope: "unknown" }]) {
    const broken = structuredClone(p); Object.assign(broken.arcade.settings, patch);
    assert.throws(() => parseProgress(JSON.stringify(broken), ids));
  }
});

test("booster mistakes and supported answers enter the existing due-review route with stable first attempts", () => {
  const item = arcadeItemById.get("verb:andare:past:0");
  let p = startArcadeRound(initial({ verbLevel: "past" }), [item], today, "first");
  p = answerArcade(p, item, "ho andato", today);
  const first = p.arcade.records[item.id].first;
  assert.equal(p.arcade.records[item.id].due, tomorrow);
  p.arcade.active = null;
  p = startArcadeRound(p, [item], today, "retry", true);
  p = answerArcade(p, item, "sono andata", today);
  assert.deepEqual(p.arcade.records[item.id].first, first);
  assert.equal(p.arcade.records[item.id].last.correct, true);
  assert.equal(p.arcade.records[item.id].due, tomorrow);
  const due = selectReviewQueue(p, planningReviewCatalogue, tomorrow, 5);
  assert.ok(due.items.some((entry) => entry.route === `games?review=${encodeURIComponent(item.id)}`));
});

test("every published game can retain a record inside the enlarged bounded backup capacity", () => {
  assert.ok(arcadeItems.length > 1000 && arcadeItems.length < 2000);
  const p = initial();
  for (const item of arcadeItems) p.arcade.records[item.id] = {
    first: { answer: item.answers[0], correct: true, assisted: false },
    last: { answer: item.answers[0], correct: true, assisted: false },
    date: today, due: tomorrow, successes: 1,
  };
  assert.equal(Object.keys(parseProgress(JSON.stringify(p), ids).arcade.records).length, arcadeItems.length);
  const record = p.arcade.records[arcadeItems[0].id];
  p.arcade.records = Object.fromEntries(Array.from({ length: 2001 }, (_, index) => [`synthetic:${index}`, record]));
  assert.throws(() => validateArcade(p.arcade));
});
