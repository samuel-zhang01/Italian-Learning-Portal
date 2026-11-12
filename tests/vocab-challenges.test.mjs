import test from "node:test";
import assert from "node:assert/strict";
import { emptyProgress, parseProgress } from "../app/learning/engine.ts";
import { emptyVocabPractice, startVocabRound, answerVocab, hintVocab, finishVocabRound, nextVocabItem, updateVocabDraft, validateVocabPractice } from "../app/learning/vocab-engine.ts";
import { emptyArcade, MAX_ARCADE_RECORDS, validateArcade } from "../app/learning/arcade-engine.ts";
import { mergeProgressBackups } from "../app/learning/backup-merge.ts";
import { learningRewards } from "../app/learning/study.ts";
import { vocabularyJourney, vocabularyRoundSummary } from "../app/learning/vocab-challenges.ts";

const today = "2026-11-01", tomorrow = "2026-11-02";
const pair = value => ({ en: value, it: value });
const items = Array.from({ length: 12 }, (_, index) => ({
  id: `course-fixture:${index}`, bankId: `topic-${index % 3}`, mode: "words",
  title: pair("Fixture"), prompt: pair(`word ${index}`), answers: [`parola ${index}`],
  hint: pair("A clue"), explanation: pair("Example"),
}));
const memory = (date = today, correct = true, assisted = false) => ({
  first: { answer: "parola", correct, assisted }, last: { answer: "parola", correct, assisted },
  date, due: tomorrow, successes: correct && !assisted ? 1 : 0,
});
const summary = p => vocabularyJourney(p, today, items);
const finishOne = (p, item, correct = true, hinted = false, id = item.id) => {
  p = startVocabRound(p, [item], today, id, true);
  if (hinted) p = hintVocab(p);
  return finishVocabRound(answerVocab(p, item, correct ? item.answers[0] : "wrong", today));
};

test("journey starts at zero without adding progress fields or mutating an original backup", () => {
  const p = emptyProgress(), before = JSON.stringify(p);
  Object.freeze(p);
  const j = summary(p);
  assert.equal(j.dailyGoal, 10); assert.equal(j.dailyProgress, 0); assert.equal(j.dailyPercent, 0);
  assert.deepEqual([j.practised, j.recalled, j.learning, j.todayAnswered, j.xp], [0, 0, 0, 0, 0]);
  assert.equal(j.unseen, items.length); assert.equal(j.practiceDays, 0); assert.equal(j.practiceRun, 0);
  assert.ok(j.badges.every(badge => !badge.earned)); assert.ok(j.quests.every(quest => !quest.earned));
  assert.equal(j.nextBadge.id, "first-round");
  assert.equal(JSON.stringify(p), before);
  assert.deepEqual(parseProgress(before, []), p);
});

test("submitted mistakes earn effort only; hints never count as independent recall or a memory badge", () => {
  let p = finishOne(emptyProgress(), items[0], false);
  p = finishOne(p, items[1], true, true);
  p = finishOne(p, items[2]);
  const j = summary(p);
  assert.deepEqual([j.todayAnswered, j.todayIndependent, j.practised, j.recalled, j.learning], [3, 1, 3, 1, 2]);
  assert.equal(j.xp, 6); assert.equal(j.dailyProgress, 0.3); assert.equal(j.dailyPercent, 30);
  assert.equal(j.badges.find(b => b.id === "first-round").earned, true);
  assert.equal(j.badges.find(b => b.id === "from-memory").earned, false);
  assert.equal(j.quests.find(q => q.id === "daily-recall").progress, 1);
});

test("replays, saved cards and Games overlap cannot inflate unique-word XP or the daily target", () => {
  let p = finishOne(emptyProgress(), items[0]);
  p = finishOne(p, items[0], true, false, "replay");
  p.arcade = emptyArcade(); p.arcade.records[items[0].id] = memory();
  p.arcade.records["non-word-verb"] = memory();
  const j = summary(p);
  assert.equal(j.todayAnswered, 1); assert.equal(j.xp, 2);
  // The unrelated verb is still worth2 globally, but is outside the vocabulary collection.
  assert.equal(learningRewards(p).xp, 4);
  assert.equal(j.roundsCompleted, 2);
  p.arcade.records[items[1].id] = memory();
  assert.equal(summary(p).xp, 4); assert.equal(summary(p).todayAnswered, 1);
});

test("daily quests and collection achievements follow distinct answered words and actual topics", () => {
  const p = emptyProgress(); p.vocabPractice = emptyVocabPractice();
  for (const item of items) p.vocabPractice.records[item.id] = memory();
  const j = summary(p);
  assert.equal(j.todayAnswered, 12); assert.equal(j.dailyProgress, 1); assert.equal(j.dailyPercent, 100);
  assert.equal(j.topicsExplored, 3); assert.equal(j.unseen, 0);
  assert.ok(j.quests.every(q => q.earned));
  assert.equal(j.badges.find(b => b.id === "ten-words").earned, true);
  assert.equal(j.badges.find(b => b.id === "from-memory").earned, true);
  assert.equal(j.badges.find(b => b.id === "topic-traveller").earned, true);
  assert.ok(j.badges.every(b => b.title.en && b.title.it && b.description.en && b.description.it));
});

test("practice dates cross month boundaries, ignore future dates and never credit an unanswered start date", () => {
  const p = emptyProgress(); p.vocabPractice = emptyVocabPractice();
  p.vocabPractice.records[items[0].id] = memory("2026-10-30");
  p.vocabPractice.records[items[1].id] = memory("2026-10-31");
  p.vocabPractice.records[items[2].id] = memory(today);
  p.vocabPractice.records[items[3].id] = memory(tomorrow);
  p.vocabPractice.history = [{ id: "overnight", date: "2026-10-29", mode: "words", total: 1, independent: 1, supported: 0 }];
  let j = summary(p);
  assert.equal(j.practiceDays, 3); assert.equal(j.practiceRun, 3); assert.equal(j.todayAnswered, 1);
  delete p.vocabPractice.records[items[2].id];
  j = summary(p); assert.equal(j.practiceRun, 2); assert.equal(j.todayAnswered, 0);
  assert.equal(vocabularyJourney(p, "2026-11-03", items).practiceRun, 1);
  const leap = emptyProgress(); leap.vocabPractice = emptyVocabPractice();
  leap.vocabPractice.records[items[0].id] = memory("2028-02-29");
  leap.vocabPractice.records[items[1].id] = memory("2028-03-01");
  assert.equal(vocabularyJourney(leap, "2028-03-01", items).practiceRun, 2);
  const invalid = vocabularyJourney(leap, "2028-02-30", items);
  assert.deepEqual([invalid.todayAnswered, invalid.practiceDays, invalid.practiceRun, invalid.due], [0, 0, 0, 0]);
});

test("round combo and recall rate use ordered real answers, with hints and mistakes breaking the chain", () => {
  let p = startVocabRound(emptyProgress(), items.slice(0, 5), today, "combo", true);
  const order = p.vocabPractice.active.itemIds;
  for (let index = 0; index < order.length; index++) {
    const item = items.find(item => item.id === order[index]);
    if (index === 2) p = hintVocab(p);
    p = answerVocab(p, item, index === 4 ? "wrong" : item.answers[0], today);
    if (index === 0) assert.equal(vocabularyRoundSummary(p.vocabPractice.active).currentCombo, 1);
    if (index < order.length - 1) p = nextVocabItem(p);
  }
  const r = vocabularyRoundSummary(p.vocabPractice.active);
  assert.deepEqual([r.submitted, r.independent, r.supported, r.mistakes], [5, 3, 1, 1]);
  assert.equal(r.bestCombo, 2); assert.equal(r.currentCombo, 0);
  assert.equal(r.accuracy, 80); assert.equal(r.independentAccuracy, 60);
  assert.equal(r.complete, true); assert.equal(r.perfect, false);
  assert.equal(vocabularyRoundSummary(null).complete, false);
  const corrupt = structuredClone(p.vocabPractice.active); delete corrupt.answers[order[0]];
  assert.equal(vocabularyRoundSummary(corrupt).submitted, 0, "A gap cannot produce a fabricated streak.");
});

test("a full-course memory collection above2000 entries round-trips through original version1 backups", () => {
  const p = emptyProgress(); p.vocabPractice = emptyVocabPractice();
  for (let i = 0; i < 3100; i++) p.vocabPractice.records[`course-word:${i}`] = memory();
  const raw = JSON.stringify(p);
  assert.ok(Buffer.byteLength(raw) < 8_000_000);
  assert.deepEqual(parseProgress(raw, []), p);
  validateVocabPractice(p.vocabPractice);
  p.vocabPractice.records["malformed"] = { ...memory(), due: "2026-02-30" };
  assert.throws(() => validateVocabPractice(p.vocabPractice));
  const oversized = emptyArcade();
  for (let i = 0; i <= MAX_ARCADE_RECORDS; i++) oversized.records[`word:${i}`] = memory();
  assert.throws(() => validateArcade(oversized));
});

test("large backup merges retain all distinct words plus local first evidence and paused drafts", () => {
  let local = emptyProgress(); local.vocabPractice = emptyVocabPractice();
  const remote = emptyProgress(); remote.vocabPractice = emptyVocabPractice();
  for (let i = 0; i < 1700; i++) local.vocabPractice.records[`course-word:${i}`] = memory(today, false);
  for (let i = 1600; i < 3300; i++) remote.vocabPractice.records[`course-word:${i}`] = memory();
  local = updateVocabDraft(startVocabRound(local, [items[0]], today, "keep-round"), "keep my Italian draft");
  const result = mergeProgressBackups(local, remote, []);
  assert.equal(Object.keys(result.progress.vocabPractice.records).length, 3300);
  assert.equal(result.progress.vocabPractice.records["course-word:1650"].first.correct, false);
  assert.equal(result.progress.vocabPractice.active.draft, "keep my Italian draft");
  assert.equal(result.progress.vocabPractice.active.id, "keep-round");
  assert.ok(!result.details.some(detail => detail.area.endsWith("-capacity")));
  assert.deepEqual(parseProgress(JSON.stringify(result.progress), []), result.progress);
});
