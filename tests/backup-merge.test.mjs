import test from "node:test";
import assert from "node:assert/strict";
import { emptyDraft, emptyProgress, parseProgress } from "../app/learning/engine.ts";
import { backupMergeBase, mergeProgressBackups } from "../app/learning/backup-merge.ts";
import { emptyAcademy, getGrammarDraft, selectProgramme } from "../app/learning/academy-engine.ts";
import { emptyArcade } from "../app/learning/arcade-engine.ts";
import { emptySession } from "../app/learning/study.ts";
import { diagnosticItemIds, emptyA2Diagnostics, startA2Diagnostic } from "../app/learning/a2-diagnostic-model.ts";
import { planningMissions, planningUnits } from "../app/learning/planning-data.ts";

const ids = planningMissions.map((m) => m.id), [first, second, third, fourth] = ids;
const day = "2026-10-25", old = "2026-10-20", stamp = "2026-10-25T12:00:00.000Z";
const completion = (correct = 0) => ({ date: old, firstCorrect: correct, total: 2, output: "Una risposta personale.", supported: false, confidence: 2 });
const review = (due = day) => ({ due, interval: 1, attempts: 1, correct: 0, lastDate: old });
const attempt = (answer, correct = false) => ({ answer, correct, assisted: false, date: old });
const merge = (a, b) => mergeProgressBackups(a, b, ids, stamp);
const valid = (p) => parseProgress(JSON.stringify(p), ids);
const a2 = () => startA2Diagnostic(emptyA2Diagnostics(), "espresso2-u01", day);

test("merge adds missing work while preserving local first attempts, drafts, settings and schedules without mutating either source", () => {
  const a = emptyProgress(), b = emptyProgress();
  a.language = "it"; a.notes = "My current note.";
  a.completed[first] = completion(0); a.reviews[first] = review();
  a.drafts[third] = { ...emptyDraft(), first: [false], output: "La mia bozza corrente." };
  a.sessions = { [day]: { ...emptySession(first, 15), warmup: "Keep this draft." } };
  b.completed[first] = completion(2); b.completed[second] = completion(1); b.completed[third] = completion(2);
  b.reviews[first] = { ...review("2026-11-01"), interval: 7 }; b.reviews[second] = review();
  b.drafts[third] = { ...emptyDraft(), first: [true], output: "A different draft." }; b.drafts[fourth] = emptyDraft();
  b.sessions = { [day]: { ...emptySession(first, 30), warmup: "Different." }, [old]: emptySession(second, 10) };
  b.notes = "Other device note.";
  const aBefore = structuredClone(a), bBefore = structuredClone(b), result = merge(a, b), out = result.progress;
  assert.deepEqual(a, aBefore); assert.deepEqual(b, bBefore);
  assert.deepEqual(out.completed[first], a.completed[first]);
  assert.deepEqual(out.completed[second], b.completed[second]);
  assert.equal(out.completed[third], undefined, "an incoming completion must not hide the local unfinished response");
  assert.deepEqual(out.drafts[third], a.drafts[third]); assert.deepEqual(out.drafts[fourth], b.drafts[fourth]);
  assert.deepEqual(out.reviews[first], a.reviews[first]); assert.deepEqual(out.reviews[second], b.reviews[second]);
  assert.deepEqual(out.sessions[day], a.sessions[day]); assert.deepEqual(out.sessions[old], b.sessions[old]);
  assert.equal(out.language, "it"); assert.deepEqual(out.plan, a.plan); assert.equal(out.notes, a.notes);
  assert.ok(result.additions >= 4 && result.conflicts >= 4); valid(out);
});

test("grammar merge adds separate questions but never overwrites local first history or a pending response", () => {
  const a = emptyProgress(), b = emptyProgress(), unit = planningUnits[0];
  const [x, y, z] = unit.exercises.map((e) => e.id);
  a.academy = emptyAcademy(); b.academy = emptyAcademy();
  a.academy.grammar[unit.id] = { ...getGrammarDraft(a, unit.id), answers: { [x]: "local", [y]: "pending" }, attempts: { [x]: [attempt("local", false)] }, output: "My unfinished own writing.", recallDrafts: { [x]: { date: day, answer: "Recall draft", hintUsed: true } } };
  b.academy.grammar[unit.id] = { ...getGrammarDraft(b, unit.id), answers: { [x]: "remote", [y]: "submitted elsewhere", [z]: "new" }, attempts: { [x]: [attempt("remote", true)], [y]: [attempt("submitted elsewhere", true)], [z]: [attempt("new", true)] }, output: "Other writing.", completed: old };
  const out = merge(a, b).progress.academy.grammar[unit.id];
  assert.deepEqual(out.attempts[x], a.academy.grammar[unit.id].attempts[x]);
  assert.equal(out.attempts[y], undefined); assert.equal(out.answers[y], "pending");
  assert.deepEqual(out.attempts[z], b.academy.grammar[unit.id].attempts[z]);
  assert.deepEqual(out.recallDrafts, a.academy.grammar[unit.id].recallDrafts);
  assert.equal(out.output, "My unfinished own writing."); assert.equal(out.completed, undefined);
});

test("assessment first answers remain fixed while missing answers from an identical question set can finish the run", () => {
  const a = emptyProgress(), b = emptyProgress(), [x, y] = planningUnits[0].exercises.map((e) => e.id), key = `${day}:readiness`;
  a.academy = emptyAcademy(); b.academy = emptyAcademy();
  a.academy.assessments[key] = { date: day, exerciseIds: [x, y], answers: { [x]: { answer: "local first", correct: false } }, completed: false };
  b.academy.assessments[key] = { date: day, exerciseIds: [x, y], answers: { [x]: { answer: "better later", correct: true }, [y]: { answer: "new answer", correct: true } }, completed: true };
  const out = merge(a, b).progress.academy.assessments[key];
  assert.deepEqual(out.answers[x], a.academy.assessments[key].answers[x]); assert.equal(out.answers[y].answer, "new answer"); assert.equal(out.completed, true);
  b.academy.assessments[key].exerciseIds.reverse();
  assert.deepEqual(merge(a, b).progress.academy.assessments[key], a.academy.assessments[key]);
});

test("programme merge cannot mark the still-active local day finished and strand its advance button", () => {
  const a = selectProgramme(emptyProgress(), "espresso-plus-a1-a2", old), b = structuredClone(a);
  a.academy.programme.practice = { "0": { output: "My current pending response.", rubric: [], modelSeen: false } };
  b.academy.programme.day = 1; b.academy.programme.completed["0"] = day;
  b.academy.programme.practice = { "0": { output: "Other completed response.", rubric: [0, 1], modelSeen: true, completed: day }, "1": { output: "Later day response.", rubric: [0, 1], modelSeen: false, completed: day } };
  const out = merge(a, b).progress.academy.programme;
  assert.equal(out.day, 0); assert.equal(out.completed["0"], undefined);
  assert.deepEqual(out.practice["0"], a.academy.programme.practice["0"]); assert.equal(out.practice["1"], undefined);
});

test("arcade merge preserves first evidence, due dates and paused drafts without importing a completed duplicate of the active round", () => {
  const a = emptyProgress(), b = emptyProgress(); a.arcade = emptyArcade(); b.arcade = emptyArcade();
  const answer = { answer: "local", correct: false, assisted: false };
  a.arcade.records.word1 = { first: answer, last: answer, date: old, due: day, successes: 0 };
  b.arcade.records.word1 = { first: { ...answer, correct: true }, last: { ...answer, correct: true }, date: day, due: "2026-11-01", successes: 3 };
  a.arcade.active = { id: "local-round", date: day, mode: "words", support: "recall", itemIds: ["word1"], index: 0, answers: {}, hints: [], draft: "Unfinished", tokens: [] };
  b.arcade.history = [{ id: "local-round", date: day, mode: "words", total: 1, independent: 1, supported: 0 }];
  const out = merge(a, b).progress.arcade;
  assert.deepEqual(out.records.word1, a.arcade.records.word1); assert.deepEqual(out.active, a.arcade.active); assert.deepEqual(out.history, []);
});

test("an A2 local current draft blocks all later imported answers, retaining a valid contiguous run", () => {
  const a = emptyProgress(), b = emptyProgress(); a.diagnostics = a2(); b.diagnostics = a2();
  const key = `${day}:espresso2-u01`, [x, y] = diagnosticItemIds("espresso2-u01");
  a.diagnostics.runs[key].drafts[x] = "My unsubmitted first answer.";
  b.diagnostics.runs[key].answers = { [x]: { answer: "Remote one", correct: true, assisted: false, date: day }, [y]: { answer: "Remote two", correct: true, assisted: false, date: day } };
  b.diagnostics.runs[key].feedbackId = y;
  const result = merge(a, b), out = result.progress.diagnostics.runs[key];
  assert.deepEqual(out.answers, {}); assert.deepEqual(out.drafts, a.diagnostics.runs[key].drafts); assert.equal(out.feedbackId, undefined);
  assert.ok(result.conflicts > 0); valid(result.progress);
});

test("A2 merge preserves local first answers and feedback while extending only a valid missing prefix", () => {
  const a = emptyProgress(), b = emptyProgress(); a.diagnostics = a2(); b.diagnostics = a2();
  const key = `${day}:espresso2-u01`, [x, y] = diagnosticItemIds("espresso2-u01");
  a.diagnostics.runs[key].answers[x] = { answer: "Local first", correct: false, assisted: true, date: day };
  a.diagnostics.runs[key].feedbackId = x;
  b.diagnostics.runs[key].answers = { [x]: { answer: "Remote correction", correct: true, assisted: false, date: day }, [y]: { answer: "Remote next", correct: true, assisted: false, date: day } };
  const out = merge(a, b).progress.diagnostics.runs[key];
  assert.deepEqual(out.answers[x], a.diagnostics.runs[key].answers[x]); assert.equal(out.answers[y].answer, "Remote next"); assert.equal(out.feedbackId, x);
});

test("legacy version-one backups still load and optional A2 fields are validated through the same boundary", () => {
  const oldBackup = emptyProgress(); assert.equal(valid(oldBackup).diagnostics, undefined);
  oldBackup.diagnostics = a2(); assert.deepEqual(valid(oldBackup).diagnostics, oldBackup.diagnostics);
  oldBackup.diagnostics.runs[`${day}:espresso2-u01`].itemIds = ["invented"];
  assert.throws(() => valid(oldBackup), /a2-diagnostic/);
});

test("merging personal-word keys cannot modify object prototypes", () => {
  const a = emptyProgress(), b = emptyProgress(); a.academy = emptyAcademy(); b.academy = emptyAcademy();
  b.academy.words = JSON.parse('{"__proto__":{"term":{"en":"hello","it":"ciao"},"starred":true,"successes":0,"lapses":0,"due":"","lastDate":""}}');
  const out = merge(a, b).progress;
  assert.equal(Object.getPrototypeOf(out.academy.words), Object.prototype); assert.equal(Object.hasOwn(out.academy.words, "__proto__"), true); assert.equal({}.starred, undefined);
});

test("a cleared saved record refreshes the merge base while never-saved tab work stays available", () => {
  const current = emptyProgress(); current.notes = "Current saved note."; current.updatedAt = stamp;
  const cleared = backupMergeBase(current, null, ids, true);
  assert.equal(cleared.changed, true); assert.equal(cleared.progress.notes, ""); assert.equal(cleared.previouslySaved, false);
  const unsaved = backupMergeBase(current, null, ids, false);
  assert.equal(unsaved.changed, false); assert.equal(unsaved.progress.notes, current.notes);
  const other = emptyProgress(); other.notes = "Newer tab work.";
  const fresh = backupMergeBase(current, JSON.stringify(other), ids, true);
  assert.equal(fresh.changed, true); assert.equal(fresh.progress.notes, other.notes);
});

test("a merge with no missing evidence is idempotent and cannot mutate its inputs", () => {
  const p = emptyProgress(); p.completed[first] = completion(); p.reviews[first] = review();
  const before = structuredClone(p), result = mergeProgressBackups(p, p, ids, p.updatedAt);
  assert.deepEqual(result.progress, before); assert.equal(result.additions, 0); assert.equal(result.conflicts, 0); assert.deepEqual(p, before);
});
