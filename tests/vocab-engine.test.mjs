import test from "node:test";
import assert from "node:assert/strict";
import curriculum from "../app/learning/curriculum.json" with { type: "json" };
import { emptyProgress, parseProgress } from "../app/learning/engine.ts";
import { emptyArcade, startArcadeRound, updateArcadeDraft } from "../app/learning/arcade-engine.ts";
import {
  emptyVocabPractice, startVocabRound, updateVocabDraft, hintVocab,
  answerVocab, nextVocabItem, finishVocabRound, validateVocabPractice,
} from "../app/learning/vocab-engine.ts";
import { backupCounts, mergeProgressBackups } from "../app/learning/backup-merge.ts";
import { hasStudyRecords, mergeProfileProgress } from "../app/learning/profile-merge.ts";
import { learningRewards } from "../app/learning/study.ts";
import { selectReviewQueue } from "../app/learning/review-queue.ts";

const day = "2026-10-28", tomorrow = "2026-10-29", ids = curriculum.missions.map(m => m.id);
const pair = value => ({ en: value, it: value });
const words = Array.from({ length: 12 }, (_, i) => ({
  id: `boost-word:fixture:${i}`, mode: "words", title: pair("Everyday words"),
  prompt: { en: `Type word ${i}`, it: `Scrivi la parola ${i}` }, answers: [`parola ${i}`],
  hint: pair("A small clue"), explanation: pair("An original example"),
}));
const current = p => words.find(item => item.id === p.vocabPractice.active.itemIds[p.vocabPractice.active.index]);
const valid = p => parseProgress(JSON.stringify(p), ids);
const memory = (date, due, correct = false, assisted = false) => ({
  first: { answer: "initial", correct: false, assisted: false },
  last: { answer: "latest", correct, assisted }, date, due, successes: correct && !assisted ? 1 : 0,
});

test("typed vocabulary keeps its round, settings and draft independent from a paused game", () => {
  let p = startArcadeRound({ ...emptyProgress(), arcade: emptyArcade() }, words, day, "game-one");
  p = updateArcadeDraft(p, "my game draft");
  const game = structuredClone(p.arcade);
  p = startVocabRound(p, words, day, "vocab-one");
  p = updateVocabDraft(p, "my vocabulary draft");
  assert.deepEqual(p.arcade, game);
  assert.equal(p.vocabPractice.active.support, "recall");
  assert.equal(p.vocabPractice.active.mode, "words");
  assert.equal(p.vocabPractice.active.itemIds.length, 5);
  assert.equal(p.vocabPractice.active.draft, "my vocabulary draft");
  assert.deepEqual(valid(p), p);
  assert.equal(startVocabRound(p, words, day, "replacement"), p);
  assert.equal(hasStudyRecords(p), true);
});

test("typed first mistakes and hints survive correction and reload without earning false independent credit", () => {
  let p = startVocabRound(emptyProgress(), [words[0]], day, "first");
  p = answerVocab(p, words[0], "wrong", day);
  assert.equal(answerVocab(p, words[0], words[0].answers[0], day), p);
  p = finishVocabRound(p);
  p = startVocabRound(valid(p), [words[0]], day, "retry", true);
  p = hintVocab(p);
  p = valid(p);
  p = answerVocab(p, words[0], words[0].answers[0], day);
  p = finishVocabRound(p);
  assert.equal(p.vocabPractice.records[words[0].id].first.correct, false);
  assert.equal(p.vocabPractice.records[words[0].id].last.assisted, true);
  assert.equal(p.vocabPractice.records[words[0].id].due, tomorrow);
  assert.deepEqual(p.vocabPractice.history.map(r => [r.independent, r.supported]), [[0, 0], [0, 1]]);
  assert.equal(p.arcade, undefined);
});

test("typed answer variants remain explicit and meaningful accents are required", () => {
  const item = { ...words[0], answers: ["è", "sono"] };
  let p = startVocabRound(emptyProgress(), [item], day, "accent");
  p = answerVocab(p, item, "e", day);
  assert.equal(p.vocabPractice.records[item.id].last.correct, false);
  p = finishVocabRound(p); p = startVocabRound(p, [item], tomorrow, "variant");
  p = answerVocab(p, item, "SONO!", tomorrow);
  assert.equal(p.vocabPractice.records[item.id].last.correct, true);
  assert.equal(p.vocabPractice.records[item.id].first.correct, false);
});

test("due vocabulary recall advances spacing while early optional practice does not postpone it", () => {
  let p = startVocabRound(emptyProgress(), [words[0]], day, "one");
  p = finishVocabRound(answerVocab(p, words[0], words[0].answers[0], day));
  assert.equal(p.vocabPractice.records[words[0].id].due, tomorrow);
  p = startVocabRound(p, [words[0]], day, "early", true);
  p = finishVocabRound(answerVocab(p, words[0], words[0].answers[0], day));
  assert.equal(p.vocabPractice.records[words[0].id].due, tomorrow);
  p = startVocabRound(p, [words[0]], tomorrow, "due", true);
  p = finishVocabRound(answerVocab(p, words[0], words[0].answers[0], tomorrow));
  assert.equal(p.vocabPractice.records[words[0].id].due, "2026-11-01");
});

test("normal vocabulary rounds prioritize due repairs and unseen words before already-seen practice", () => {
  const p = emptyProgress(); p.vocabPractice = emptyVocabPractice();
  for (const item of words.slice(0, 8)) p.vocabPractice.records[item.id] = memory("2026-10-27", "2026-10-30", true);
  p.vocabPractice.records[words[0].id] = memory("2026-10-25", day, false);
  p.vocabPractice.records[words[1].id] = memory("2026-10-25", day, true, true);
  const started = startVocabRound(p, words, day, "priority");
  assert.equal(started.vocabPractice.active.itemIds.length, 5);
  assert.ok(started.vocabPractice.active.itemIds.includes(words[0].id));
  assert.ok(started.vocabPractice.active.itemIds.includes(words[1].id));
  assert.equal(started.vocabPractice.active.itemIds.filter(id => words.slice(8).some(item => item.id === id)).length, 3);
  assert.ok(started.vocabPractice.active.itemIds.every(id => !words.slice(2, 8).some(item => item.id === id)));
  const explicit = startVocabRound(p, [words[7]], day, "explicit", true);
  assert.deepEqual(explicit.vocabPractice.active.itemIds, [words[7].id]);
});

test("normal vocabulary rounds include correct due recall before unseen words without rewriting evidence or schedules", () => {
  const p = emptyProgress(); p.vocabPractice = emptyVocabPractice();
  p.vocabPractice.records[words[0].id] = memory("2026-10-25", day, false);
  p.vocabPractice.records[words[1].id] = memory("2026-10-25", day, true, true);
  p.vocabPractice.records[words[2].id] = memory("2026-10-25", day, true);
  p.vocabPractice.records[words[3].id] = memory("2026-10-24", "2026-10-27", true);
  // A retained due date on work already answered today must not crowd out new words.
  p.vocabPractice.records[words[4].id] = memory(day, day, true);
  const before = structuredClone(p);
  const started = startVocabRound(p, words, day, "due-and-new");
  assert.equal(started.vocabPractice.active.itemIds.length, 5);
  for (const item of words.slice(0, 4)) assert.ok(started.vocabPractice.active.itemIds.includes(item.id));
  assert.ok(!started.vocabPractice.active.itemIds.includes(words[4].id));
  assert.equal(started.vocabPractice.active.itemIds.filter(id => words.slice(5).some(item => item.id === id)).length, 1);
  assert.deepEqual(started.vocabPractice.records, before.vocabPractice.records);
  assert.deepEqual(p, before);
});

test("a complete typed round advances one submitted answer at a time and records one honest summary", () => {
  let p = startVocabRound(emptyProgress(), words.slice(0, 3), day, "complete");
  assert.equal(nextVocabItem(p), p);
  assert.equal(finishVocabRound(p), p);
  for (let index = 0; index < 3; index++) {
    const item = current(p);
    p = answerVocab(p, item, item.answers[0], day);
    if (index < 2) p = nextVocabItem(p);
  }
  p = finishVocabRound(p);
  assert.equal(p.vocabPractice.active, null);
  assert.equal(p.vocabPractice.history.length, 1);
  assert.equal(p.vocabPractice.history[0].independent, 3);
  assert.equal(backupCounts(p).typedWords, 3);
  assert.equal(finishVocabRound(p), p);
});

test("typed backups reject choice mode, oversized rounds and malformed state while original backups remain valid", () => {
  assert.deepEqual(valid(emptyProgress()), emptyProgress());
  const p = startVocabRound(emptyProgress(), words, day, "valid");
  for (const mutate of [
    value => { value.settings.support = "guided"; },
    value => { value.settings.mode = "verbs"; },
    value => { value.settings.size = 15; },
    value => { value.active.support = "guided"; },
    value => { value.active.tokens = [0]; },
    value => { value.active.itemIds.push(value.active.itemIds[0]); },
  ]) {
    const bad = structuredClone(p.vocabPractice); mutate(bad);
    assert.throws(() => validateVocabPractice(bad));
    assert.throws(() => valid({ ...p, vocabPractice: bad }));
  }
  assert.equal(startVocabRound(emptyProgress(), [], day, "empty").vocabPractice, undefined);
  assert.equal(startVocabRound(emptyProgress(), [{ ...words[0], mode: "verbs" }], day, "wrong-mode").vocabPractice, undefined);
});

test("backup merge adds independent vocabulary records while preserving overlapping first attempts and active drafts", () => {
  let local = startVocabRound(emptyProgress(), [words[0]], day, "local");
  local = answerVocab(local, words[0], "first mistake", day);
  local = finishVocabRound(local);
  local = updateVocabDraft(startVocabRound(local, [words[1]], day, "local-draft"), "keep local draft");
  let remote = startVocabRound(emptyProgress(), [words[0]], day, "remote");
  remote = finishVocabRound(answerVocab(remote, words[0], words[0].answers[0], day));
  remote = startVocabRound(remote, [words[2]], day, "remote-two");
  remote = finishVocabRound(answerVocab(remote, words[2], words[2].answers[0], day));
  const merged = mergeProgressBackups(local, remote, ids);
  assert.equal(merged.progress.vocabPractice.active.draft, "keep local draft");
  assert.equal(merged.progress.vocabPractice.records[words[0].id].first.correct, false);
  assert.equal(merged.progress.vocabPractice.records[words[2].id].first.correct, true);
  assert.ok(merged.details.some(item => item.area === "typed-word-first-attempt-and-schedule"));
  assert.deepEqual(valid(merged.progress), merged.progress);
});

test("profile merge combines separate typed records but asks before replacing a concurrently changed round", () => {
  const base = emptyProgress(); base.vocabPractice = emptyVocabPractice();
  let local = startVocabRound(structuredClone(base), [words[0]], day, "local");
  local = finishVocabRound(answerVocab(local, words[0], "wrong", day));
  let remote = startVocabRound(structuredClone(base), [words[1]], day, "remote");
  remote = finishVocabRound(answerVocab(remote, words[1], words[1].answers[0], day));
  // History is one atomic ordered record, so two independent summaries ask for a choice.
  let merged = mergeProfileProgress(base, local, remote, ids, "local");
  assert.equal(Object.keys(merged.progress.vocabPractice.records).length, 2);
  const playing = startVocabRound(merged.progress, [words[2]], day, "shared");
  local = updateVocabDraft(playing, "computer draft"); remote = updateVocabDraft(playing, "phone draft");
  merged = mergeProfileProgress(playing, local, remote, ids);
  assert.deepEqual(merged.conflicts, ["vocabPractice.active"]);
  assert.equal(merged.progress.vocabPractice.active.draft, "computer draft");
  assert.equal(mergeProfileProgress(playing, local, remote, ids, "remote").progress.vocabPractice.active.draft, "phone draft");
});

test("vocabulary and Games cannot double-award practice XP for the same stable word ID", () => {
  const p = emptyProgress(); p.arcade = emptyArcade(); p.vocabPractice = emptyVocabPractice();
  p.arcade.records[words[0].id] = memory(day, tomorrow);
  p.vocabPractice.records[words[0].id] = memory(day, tomorrow, true);
  p.vocabPractice.records[words[1].id] = memory(day, tomorrow);
  assert.equal(learningRewards(p).xp, 4);
});

test("shared reviews link to typed vocabulary, deduplicate saved words, and exclude practice completed today", () => {
  const p = emptyProgress(); p.vocabPractice = emptyVocabPractice(); p.arcade = emptyArcade();
  const item = words[0], term = { en: "the apple", it: "la mela" };
  const catalogue = { missions: [], grammar: [], words: [{ key: term.it, term }],
    arcade: [{ id: item.id, title: pair("Word hunt"), wordKey: term.it }],
    vocab: [{ id: item.id, title: { en: term.en, it: term.en }, wordKey: term.it }] };
  p.arcade.records[item.id] = memory("2026-10-20", "2026-10-21");
  p.vocabPractice.records[item.id] = memory("2026-10-26", "2026-10-27");
  let queue = selectReviewQueue(p, catalogue, day);
  assert.equal(queue.totalDue, 1);
  assert.equal(queue.items[0].kind, "vocab");
  assert.equal(queue.items[0].estimatedSeconds, 30);
  assert.equal(queue.items[0].cueLanguage, "en");
  assert.equal(queue.items[0].route, `vocab-boost?review=${encodeURIComponent(item.id)}`);
  p.vocabPractice.records[item.id] = memory(day, tomorrow, true);
  queue = selectReviewQueue(p, catalogue, day);
  assert.equal(queue.totalDue, 0);
});
