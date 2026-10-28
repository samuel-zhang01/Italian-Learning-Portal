import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  answerA2Diagnostic, continueA2Diagnostic, diagnosticCatchUp, diagnosticItemIds,
  diagnosticRunKey, emptyA2Diagnostics, hintA2Diagnostic, saveA2DiagnosticDraft,
  startA2Diagnostic, validateA2Diagnostics,
} from "../app/learning/a2-diagnostic-model.ts";
import { a2DiagnosticChapters } from "../app/learning/a2-diagnostic-data.ts";
import { deriveWeeklyLearningReport } from "../app/learning/weekly-learning-model.ts";
import { emptyProgress, parseProgress } from "../app/learning/engine.ts";
import { emptyAcademy, getGrammarDraft } from "../app/learning/academy-engine.ts";
import { planningSources } from "../app/learning/planning-data.ts";
import { isCorrect } from "../app/learning/learning-utils.ts";
import {
  advanceOralPractice, checkOralChoice, completeOralPractice, completeOralTransfer,
  emptyOralPractice, oralPracticeIdentities, oralRunKey, saveOralChoice,
  saveOralRetell, saveOralTransfer, seeOralTranscript, setOralRetellCheck,
  setOralTransferCheck, startOralPractice,
} from "../app/learning/oral-practice-model.ts";

const today = "2026-10-25", chapter = a2DiagnosticChapters[0], item = chapter.items[0];
const key = diagnosticRunKey(today, chapter.id), begin = () => startA2Diagnostic(emptyA2Diagnostics(), chapter.id, today);
const clone = (value) => JSON.parse(JSON.stringify(value));
const pair = (value) => ({ en: value, it: value });
const freeze = (value) => { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === "object" && !Object.isFrozen(child)) freeze(child); return value; };

test("ten original chapter samples have stable IDs,29 bounded bilingual prompts and accepted answer variants", () => {
  assert.equal(a2DiagnosticChapters.length, 10);
  const all = a2DiagnosticChapters.flatMap((topic) => topic.items);
  assert.equal(all.length, 29); assert.equal(new Set(all.map((question) => question.id)).size, 29);
  assert.equal(new Set(all.map((question) => question.unitId)).size, 29);
  for (const topic of a2DiagnosticChapters) {
    assert.deepEqual(topic.items.map((question) => question.id), diagnosticItemIds(topic.id));
    for (const question of topic.items) {
      for (const field of [question.prompt, question.hint, question.explanation]) for (const language of ["en", "it"]) assert.ok(field[language].trim().length > 10);
      assert.ok(question.answers.length > 0 && question.answers.every((answer) => answer.trim().length > 0));
      assert.equal(isCorrect(` ${question.answers[0].toLocaleUpperCase()}. `, question.answers), true);
    }
  }
  const auxiliary = all.find((question) => question.unitId === "a2-auxiliary-alternation");
  assert.equal(isCorrect("e", auxiliary.answers), false, "An unaccented conjunction must not match è.");
});

test("diagnostic starts are bounded, idempotent and leave older first answers immutable", () => {
  const state = freeze(begin()); validateA2Diagnostics(state);
  assert.equal(startA2Diagnostic(state, chapter.id, today), state);
  assert.equal(startA2Diagnostic(state, "unknown", today), state);
  assert.equal(startA2Diagnostic(state, chapter.id, "2026-02-30"), state);
  const first = answerA2Diagnostic(state, key, item, "wrong", today);
  assert.equal(answerA2Diagnostic(first, key, item, item.answers[0], today), first);
  assert.equal(first.runs[key].answers[item.id].correct, false);
  const tomorrow = startA2Diagnostic(first, chapter.id, "2026-10-26");
  assert.deepEqual(tomorrow.runs[key], first.runs[key]);
  assert.equal(Object.keys(tomorrow.runs).length, 2);
});

test("pending drafts and recorded hints survive JSON reload; answers are first-only and cannot be submitted out of order", () => {
  let state = begin();
  state = saveA2DiagnosticDraft(state, key, item.id, "A pending response");
  state = hintA2Diagnostic(state, key, item.id);
  const loaded = clone(state); validateA2Diagnostics(loaded);
  assert.equal(loaded.runs[key].drafts[item.id], "A pending response");
  assert.equal(answerA2Diagnostic(loaded, key, chapter.items[1], "meno", today), loaded);
  const checked = answerA2Diagnostic(loaded, key, item, item.answers[0], "2026-10-26");
  assert.deepEqual(checked.runs[key].drafts, {});
  assert.equal(checked.runs[key].answers[item.id].assisted, true);
  assert.equal(checked.runs[key].answers[item.id].date, "2026-10-26");
  assert.equal(checked.runs[key].feedbackId, item.id);
  validateA2Diagnostics(clone(checked));
  assert.equal(continueA2Diagnostic(checked, key).runs[key].feedbackId, undefined);
  assert.equal(saveA2DiagnosticDraft(checked, key, item.id, "replacement"), checked);
  assert.equal(saveA2DiagnosticDraft(loaded, key, item.id, "x".repeat(501)), loaded);
});

test("validator rejects stale IDs, run mismatch, overlong text, impossible order, invalid dates and feedback injection", () => {
  for (const mutate of [
    (state) => { state.version = 2; },
    (state) => { state.runs[key].chapterId = "unknown"; },
    (state) => { state.runs[key].date = "2026-02-30"; },
    (state) => { state.runs[key].itemIds[0] = "unknown"; },
    (state) => { state.runs[key].drafts[item.id] = "x".repeat(501); },
    (state) => { state.runs[key].drafts[chapter.items[1].id] = "out of order"; },
    (state) => { state.runs[key].answers[chapter.items[1].id] = { answer: "meno", correct: true, assisted: false, date: today }; },
    (state) => { state.runs[key].feedbackId = "unknown"; },
    (state) => { state.runs[key].hints = [item.id, item.id]; },
  ]) { const state = clone(begin()); mutate(state); assert.throws(() => validateA2Diagnostics(state)); }
  const bad = answerA2Diagnostic(begin(), key, item, "Le", today); bad.runs[key].answers[item.id].date = "2026-10-24";
  assert.throws(() => validateA2Diagnostics(bad));
});

test("400-run retention cap never deletes archived first evidence or prevents an existing draft from continuing", () => {
  let state = emptyA2Diagnostics();
  for (let day = 1; day <= 40; day++) for (const topic of a2DiagnosticChapters) {
    const date = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
    state = startA2Diagnostic(state, topic.id, date);
  }
  assert.equal(Object.keys(state.runs).length, 400); validateA2Diagnostics(state);
  assert.equal(startA2Diagnostic(state, chapter.id, today), state);
  const oldKey = Object.keys(state.runs)[0], oldRun = state.runs[oldKey];
  const updated = answerA2Diagnostic(state, oldKey, item, "Le", today);
  assert.equal(updated.runs[oldKey].answers[item.id].correct, true); assert.equal(oldRun.answers[item.id], undefined);
  validateA2Diagnostics(updated);
});

test("catch-up points to the earliest unfinished prerequisite, sampled topic and actual transfer mission", () => {
  const p = emptyProgress(); p.academy = emptyAcademy();
  const units = [{ id: "base", title: pair("base"), prerequisites: [], missionIds: [] }, { id: item.unitId, title: pair("topic"), prerequisites: ["base"], missionIds: [chapter.missionId] }];
  const before = JSON.stringify(p); freeze(p);
  assert.deepEqual(diagnosticCatchUp(p, item, units, chapter).map((step) => step.route), ["grammar/base", `grammar/${item.unitId}?practice=1`, `lesson/${chapter.missionId}`]);
  assert.equal(JSON.stringify(p), before);
  assert.deepEqual(diagnosticCatchUp(p, { ...item, unitId: "stale" }, units, chapter), []);
  const completed = emptyProgress(); completed.academy = emptyAcademy();
  completed.academy.grammar.base = { ...getGrammarDraft(completed, "base"), completed: "2026-10-22" };
  completed.academy.grammar[item.unitId] = { ...getGrammarDraft(completed, item.unitId),
    exerciseIndex: 5, output: "Una produzione precedente da conservare.", rubric: [0], completed: "2026-10-23" };
  const completedBefore = JSON.stringify(completed); freeze(completed);
  const catchUp = diagnosticCatchUp(completed, item, units, chapter);
  assert.equal(catchUp[0].kind, "practise");
  assert.equal(catchUp[0].route, `grammar/${item.unitId}?practice=1`);
  assert.equal(JSON.stringify(completed), completedBefore, "Selecting a practice destination does not replace the existing production, position or completion.");
});

const catalogue = {
  missions: [{ id: "core", title: pair("Core") }],
  grammar: [{ id: "unit", title: pair("Unit"), exercises: [{ id: "ex1" }, { id: "ex2" }] }],
  words: [{ key: "il libro", term: { en: "the book", it: "il libro" } }],
  arcade: [{ id: "scene", title: pair("Scene") }],
};
const context = { programmes: [{ id: "known", days: [{}, { practice: true }] }], companionIds: ["known-page"] };
const progress = () => { const p = emptyProgress(); p.academy = emptyAcademy(); return p; };
const report = (p, diagnostics = emptyA2Diagnostics()) => deriveWeeklyLearningReport(p, catalogue, today, diagnostics, a2DiagnosticChapters, [], context);

test("weekly evidence separates same-day repair from genuine later-calendar-day recall", () => {
  const p = progress();
  p.academy.grammar.unit = { ...getGrammarDraft(p, "unit"), attempts: {
    ex1: [{ answer: "wrong", correct: false, assisted: false, date: "2026-10-22" }, { answer: "repair", correct: true, assisted: false, date: "2026-10-22" }, { answer: "returned", correct: true, assisted: false, date: today }],
    ex2: [{ answer: "with support", correct: true, assisted: true, date: today }],
  } };
  const r = report(p);
  assert.deepEqual(r.grammar, { exerciseDays: 3, independentFirstCorrect: 1, supportedFirst: 1, sameDayRepairs: 1, laterDayCorrect: 1, completed: 0 });
  assert.deepEqual(r.activeDays, ["2026-10-22", today]);
  p.academy.grammar.unit.attempts.ex1.pop();
  assert.equal(report(p).grammar.laterDayCorrect, 0, "A same-day correction is not delayed recall.");
});

test("weekly report excludes future/stale identities and counts actual known practice completions rather than legacy completed days", () => {
  const p = progress();
  p.academy.programme = { id: "known", started: today, day: 0, completed: { "0": today, "1": today, "400": today }, practice: {
    "0": { output: "legacy day", rubric: [], modelSeen: false, completed: today },
    "1": { output: "real checkpoint", rubric: [0], modelSeen: true, completed: today },
    "2": { output: "out of range", rubric: [], modelSeen: false, completed: today },
  } };
  p.academy.companion = { "known-page": { answer: "own response", selfChecked: true, modelSeen: false, completed: today }, "stale-page": { answer: "unknown", selfChecked: true, modelSeen: true, completed: today } };
  p.completed.unknown = { date: today, output: "stale", firstCorrect: 2, total: 2, confidence: 2, supported: false };
  p.academy.grammar.unknown = { ...getGrammarDraft(p, "unknown"), completed: today };
  p.academy.words.stale = { term: pair("stale"), starred: true, due: today, lastDate: today, successes: 3, lapses: 1 };
  p.academy.words["il libro"] = { term: { en: "the book", it: "il libro" }, starred: true, due: "2026-10-27", lastDate: "2026-10-26", successes: 3, lapses: 1 };
  const r = report(p);
  assert.equal(r.selfAssessed.programmeCheckpoints, 1); assert.equal(r.selfAssessed.companionPages, 1);
  assert.equal(r.core.completed, 0); assert.equal(r.grammar.completed, 0); assert.equal(r.personalWords.latestReviews, 0);
  p.academy.programme.id = "unknown"; assert.equal(report(p).selfAssessed.programmeCheckpoints, 0);
});

test("weekly core and latest-only word/game metrics do not invent full event counts or replace first attempts", () => {
  const p = progress();
  p.completed.core = { date: "2026-10-01", output: "original", firstCorrect: 0, total: 2, confidence: 2, supported: true };
  p.reviewLog = [{ id: "core", date: "2026-10-23", correct: false }, { id: "core", date: today, correct: true }, { id: "core", date: today, correct: true }];
  p.academy.words["il libro"] = { term: { en: "the book", it: "il libro" }, starred: true, due: "2026-10-28", lastDate: today, successes: 10, lapses: 8 };
  p.arcade = { records: { scene: { first: { answer: "old", correct: false, assisted: true }, last: { answer: "latest", correct: true, assisted: false }, date: today, due: "2026-10-28", successes: 10 } } };
  const before = JSON.stringify(p); freeze(p); const r = report(p);
  assert.deepEqual(r.core, { completed: 0, recallChecks: 2, recallCorrect: 1, laterDayCorrect: 1 });
  assert.equal(r.personalWords.latestReviews, 1); assert.equal(r.arcade.latestItems, 1);
  assert.equal(r.arcade.independentLatestCorrect, 1); assert.equal(JSON.stringify(p), before);
});

test("weekly evidence includes known typed vocabulary while excluding unknown and future records", () => {
  const p = progress();
  const memory = (date, correct = false, assisted = false) => ({ first: { answer: "first", correct: false, assisted: false }, last: { answer: "latest", correct, assisted }, date, due: "2026-10-26", successes: 0 });
  p.vocabPractice = { records: { typed: memory(today, true), supported: memory("2026-10-24", true, true), future: memory("2026-10-26", true), stale: memory(today, true) } };
  const typedCatalogue = { ...catalogue, vocab: ["typed", "supported", "future"].map(id => ({ id, title: pair(id), wordKey: "il libro" })) };
  const before = JSON.stringify(p); freeze(p);
  const r = deriveWeeklyLearningReport(p, typedCatalogue, today, emptyA2Diagnostics(), [], [], context);
  assert.deepEqual(r.arcade, { latestItems: 2, independentLatestCorrect: 1, supportedLatest: 1, ambiguousLatest: 0 });
  assert.deepEqual(r.activeDays, ["2026-10-24", today]);
  assert.equal(r.hasEvidence, true);
  assert.equal(JSON.stringify(p), before);
});

test("weekly typed and game evidence for the same word counts once using the newest date without changing either first attempt", () => {
  const p = progress();
  const first = { answer: "first mistake", correct: false, assisted: false };
  p.arcade = { records: { scene: { first, last: { answer: "older correct", correct: true, assisted: false }, date: "2026-10-23", due: today, successes: 1 } } };
  p.vocabPractice = { records: { scene: { first, last: { answer: "newer wrong", correct: false, assisted: false }, date: today, due: "2026-10-26", successes: 0 } } };
  const typedCatalogue = { ...catalogue, vocab: [{ id: "scene", title: pair("A typed word"), wordKey: "il libro" }] };
  const before = JSON.stringify(p); freeze(p);
  const r = deriveWeeklyLearningReport(p, typedCatalogue, today, emptyA2Diagnostics(), [], [], context);
  assert.deepEqual(r.arcade, { latestItems: 1, independentLatestCorrect: 0, supportedLatest: 0, ambiguousLatest: 0 });
  assert.deepEqual(r.activeDays, ["2026-10-23", today], "Both retained dates establish activity, not two latest-item counts.");
  assert.equal(JSON.stringify(p), before);
});

test("weekly same-day conflicting vocabulary/game outcomes are not guessed or counted as correct", () => {
  const p = progress();
  const first = { answer: "first", correct: false, assisted: false };
  p.arcade = { records: { scene: { first, last: { answer: "correct", correct: true, assisted: false }, date: today, due: "2026-10-26", successes: 1 } } };
  p.vocabPractice = { records: { scene: { first, last: { answer: "hinted", correct: true, assisted: true }, date: today, due: "2026-10-26", successes: 0 } } };
  const typedCatalogue = { ...catalogue, vocab: [{ id: "scene", title: pair("A typed word"), wordKey: "il libro" }] };
  const r = deriveWeeklyLearningReport(p, typedCatalogue, today, emptyA2Diagnostics(), [], [], context);
  assert.deepEqual(r.arcade, { latestItems: 1, independentLatestCorrect: 0, supportedLatest: 0, ambiguousLatest: 1 });
  p.vocabPractice.records.scene.last = { answer: "a different accepted variant", correct: true, assisted: false };
  const sameOutcome = deriveWeeklyLearningReport(p, typedCatalogue, today, emptyA2Diagnostics(), [], [], context);
  assert.deepEqual(sameOutcome.arcade, { latestItems: 1, independentLatestCorrect: 1, supportedLatest: 0, ambiguousLatest: 0 });
});

test("empty or invalid-date weekly reports infer no weakness and return to the saved plan", () => {
  const p = progress(); const r = report(freeze(p));
  assert.equal(r.hasEvidence, false); assert.equal(r.activeDays.length, 0);
  assert.equal(r.nextSteps[0].id, "continue-today");
  assert.equal(r.nextSteps[0].route, "today");
  assert.deepEqual(r.nextSteps[0].title, { en: "Continue today", it: "Continua oggi" });
  assert.deepEqual(deriveWeeklyLearningReport(p, catalogue, "bad-date", emptyA2Diagnostics(), [], []).activeDays, []);
});

test("no-due weekly suggestions preserve A1/A2 plans and saved drafts without choosing a new diagnostic level", () => {
  for (const course of [1, 3]) {
    const p = progress(); p.plan.course = course;
    p.academy.programme = { id: "known", started: "2026-10-01", day: 1, completed: { "0": "2026-10-01" } };
    p.drafts.core = { step: 1, answers: ["bozza salvata", ""], checked: [false, false], first: [], output: "", rubric: [false, false], modelSeen: false };
    const before = JSON.stringify(p); freeze(p);
    const r = report(p);
    assert.equal(r.hasEvidence, false);
    assert.deepEqual(r.nextSteps.map((step) => step.route), ["today"]);
    assert.ok(r.nextWeekPlan.every(({ step }) => step.route === "today"));
    assert.equal(JSON.stringify(p), before, `Course ${course}: no changes to the plan, day or draft.`);
  }
});

test("an actual due review remains ahead of the neutral weekly fallback", () => {
  const p = progress();
  p.completed.core = { date: "2026-10-20", firstCorrect: 1, total: 2, output: "Una frase originale.", supported: false, confidence: 2 };
  p.reviews.core = { due: "2026-10-24", interval: 3, attempts: 1, correct: 1, lastDate: "2026-10-21" };
  const before = JSON.stringify(p); freeze(p);
  assert.equal(report(p).nextSteps[0].route, "review/core");
  assert.equal(JSON.stringify(p), before);
});

test("normal version1 progress round-trips diagnostics while old backups remain valid", () => {
  const p = progress(); p.diagnostics = answerA2Diagnostic(begin(), key, item, "wrong", today);
  const loaded = parseProgress(JSON.stringify(p), []); assert.deepEqual(loaded.diagnostics, p.diagnostics);
  assert.equal(parseProgress(JSON.stringify(progress()), []).diagnostics, undefined);
});

test("lightweight source page identities exactly match all companion records", () => {
  const companion = JSON.parse(fs.readFileSync(new URL("../app/learning/companion.json", import.meta.url), "utf8"));
  const generated = planningSources.flatMap((source) => Array.from({ length: source.pages }, (_, index) => `${source.id}-p${index + 1}`));
  assert.deepEqual([...new Set(generated)].sort(), companion.pages.map((page) => page.id).sort());
});

test("all diagnostic topics and catch-up transfers resolve to maintained A2 lessons and missions", () => {
  const grammar = JSON.parse(fs.readFileSync(new URL("../app/learning/grammar.json", import.meta.url), "utf8"));
  const curriculum = JSON.parse(fs.readFileSync(new URL("../app/learning/curriculum.json", import.meta.url), "utf8"));
  for (const topic of a2DiagnosticChapters) {
    assert.ok(curriculum.missions.some((mission) => mission.id === topic.missionId));
    for (const question of topic.items) assert.ok(grammar.units.some((unit) => unit.id === question.unitId && unit.level === "A2"), question.unitId);
  }
});

test("next-week suggestions follow planned dates and never mutate the schedule or invent extra tasks", () => {
  const p = progress(); p.plan = { ...p.plan, start: "2026-10-01", days: [1, 3, 5] };
  const before = JSON.stringify(p); freeze(p);
  const r = report(p); assert.equal(r.nextWeekPlan.length, 1);
  assert.equal(r.nextWeekPlan[0].date, "2026-10-26"); assert.equal(r.nextWeekPlan[0].step.route, "today");
  assert.equal(JSON.stringify(p), before);
  const none = clone(p); none.plan.days = []; assert.deepEqual(report(none).nextWeekPlan, []);
  none.plan.days = [1, 2, 3]; none.plan.start = "2027-01-01"; assert.deepEqual(report(none).nextWeekPlan, []);
});

const completedOral = (sceneId, budget, date, support = "none") => {
  let state = startOralPractice(emptyOralPractice(), sceneId, budget, date);
  const key = oralRunKey(date, sceneId);
  if (support === "gist") state = seeOralTranscript(state, key);
  state = saveOralChoice(state, key, "gist", oralPracticeIdentities[sceneId].gist);
  state = checkOralChoice(state, key, "gist", date); state = advanceOralPractice(state, key);
  if (budget === 10) {
    if (support === "detail") state = seeOralTranscript(state, key);
    state = saveOralChoice(state, key, "detail", oralPracticeIdentities[sceneId].detail);
    state = checkOralChoice(state, key, "detail", date); state = advanceOralPractice(state, key);
  }
  state = saveOralRetell(state, key, "Una risposta originale con un dettaglio cambiato.");
  state = setOralRetellCheck(state, key, 0, true); state = setOralRetellCheck(state, key, 1, true);
  state = completeOralPractice(state, key, date);
  return { state, key };
};

test("weekly oral evidence separates first comprehension support, completed self-checked retells and later-day transfer", () => {
  const p = progress(), short = completedOral("oral-market", 5, "2026-10-20", "gist"), longer = completedOral("oral-invitation", 10, "2026-10-22", "detail");
  let state = short.state;
  state = saveOralTransfer(state, short.key, "Oggi propongo un altro dettaglio.", today);
  state = setOralTransferCheck(state, short.key, 0, true, today); state = setOralTransferCheck(state, short.key, 1, true, today);
  state = completeOralTransfer(state, short.key, today);
  p.oralPractice = { version: 1, runs: { ...state.runs, ...longer.state.runs } };
  const before = JSON.stringify(p); freeze(p); const r = report(p);
  assert.deepEqual(r.oralPractice, { completedRuns: 2, gistFirstChecks: 2, detailFirstChecks: 1, correctWithoutTextSupport: 1, supportedFirstChecks: 2, laterDayTransfers: 1 });
  assert.deepEqual(r.activeDays, ["2026-10-20", "2026-10-22", today]);
  assert.equal(r.nextSteps[0].route, "today", "Optional oral practice does not alter the existing recommendation fallback.");
  assert.equal(JSON.stringify(p), before, "The report never changes core progress, plans or oral evidence.");
});

test("oral drafts, current support views, unknown identities and future events do not become weekly completions", () => {
  const p = progress(), run = completedOral("oral-market", 5, today);
  let pending = startOralPractice(emptyOralPractice(), "oral-delay", 10, today);
  pending = seeOralTranscript(pending, oralRunKey(today, "oral-delay"));
  p.oralPractice = pending;
  assert.deepEqual(report(p).oralPractice, { completedRuns: 0, gistFirstChecks: 0, detailFirstChecks: 0, correctWithoutTextSupport: 0, supportedFirstChecks: 0, laterDayTransfers: 0 });
  assert.equal(report(p).hasEvidence, false, "Starting a draft or viewing support is not a completed or checked event.");
  const stale = clone(run.state.runs[run.key]); stale.sceneId = "unknown-scene";
  const future = completedOral("oral-invitation", 10, "2026-10-26");
  p.oralPractice = { version: 1, runs: { ...pending.runs, "2026-10-25:unknown-scene": stale, ...future.state.runs } };
  assert.equal(report(p).oralPractice.completedRuns, 0); assert.equal(report(p).oralPractice.gistFirstChecks, 0);
});

test("oral report uses actual completion dates and requires a later day for fresh self-checked transfer", () => {
  const p = progress(), old = completedOral("oral-market", 5, "2026-10-18");
  let state = saveOralTransfer(old.state, old.key, "Una nuova risposta con un cambio.", "2026-10-22");
  state = setOralTransferCheck(state, old.key, 0, true, "2026-10-22"); state = setOralTransferCheck(state, old.key, 1, true, "2026-10-22");
  state = completeOralTransfer(state, old.key, "2026-10-22"); p.oralPractice = state;
  assert.equal(report(p).oralPractice.completedRuns, 0, "An old run is not a completion in this window.");
  assert.equal(report(p).oralPractice.laterDayTransfers, 1); assert.deepEqual(report(p).activeDays, ["2026-10-22"]);
  const invalidSameDay = clone(state); invalidSameDay.runs[old.key].transfer.completed = "2026-10-18";
  p.oralPractice = invalidSameDay; assert.equal(report(p).oralPractice.laterDayTransfers, 0);
  assert.equal(report(progress()).oralPractice.completedRuns, 0, "Sparse old backups have no inferred oral evidence.");
});
