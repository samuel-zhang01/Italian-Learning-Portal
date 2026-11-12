import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import curriculum from "../app/learning/curriculum.json" with { type: "json" };
import enrichment from "../app/learning/enrichment.json" with { type: "json" };
import grammar from "../app/learning/grammar.json" with { type: "json" };
import companion from "../app/learning/companion.json" with { type: "json" };
import { addDays, completeMission, emptyDraft, emptyProgress, isCorrect, parseProgress, recordReview } from "../app/learning/engine.ts";
import { completeProgrammeDay, completeProgrammePractice, getGrammarDraft, programmeDayReady, selectProgramme, updateProgrammePracticeDraft } from "../app/learning/academy-engine.ts";
import { dailyStudyPlan, emptySession, sessionMission } from "../app/learning/study.ts";
import { planningMissions, planningPages, planningProgrammes, planningUnits } from "../app/learning/planning-data.ts";
import { vocabItemById } from "../app/learning/vocab-catalogue.ts";
import { buildDiscoveryIndex, searchDiscovery } from "../app/learning/discovery-index.ts";
import { sourcePageLabel } from "../app/learning/source-references.ts";
import { vocabPracticeItems } from "../app/learning/vocab-catalogue.ts";

const review = JSON.parse(readFileSync(new URL("../docs/week5-content-review.json", import.meta.url), "utf8"));
const sourceId = "src-d7cf3d20c90d", today = "2026-11-08";
const missions = curriculum.missions.filter(mission => review.missionIds.includes(mission.id));
const programme = grammar.programmes.find(item => item.id === review.programmeId);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const pair = value => assert.ok(value?.en?.trim() && value?.it?.trim());
const plan = p => dailyStudyPlan(p, planningMissions, planningUnits, planningProgrammes, planningPages, today);

test("Week 5 is additive: every earlier content object, programme and progress identity stays intact", () => {
  for (const [path, baseline] of Object.entries(review.baseline)) {
    const [name, key] = path.split(".");
    assert.equal(digest({ curriculum, enrichment, grammar, companion }[name][key].slice(0, baseline.count)), baseline.sha256, path);
  }
  const previous = JSON.parse(readFileSync(new URL("../docs/week4-vocabulary-review.json", import.meta.url), "utf8"));
  assert.ok(previous.previousPracticeIds.every(id => vocabItemById.has(id)));
  assert.equal(grammar.units.length, 65, "Reuse existing workshops instead of duplicating grammar units");
});

test("all 16 physical pages have truthful classifications and bounded original practice", () => {
  const source = curriculum.sources.find(item => item.id === sourceId);
  assert.deepEqual(source, review.source);
  assert.equal(source.sha256, "d7cf3d20c90da8cff714a1408a25f82387cb815fd3c92bbf7df990f52c8c0ae7");
  assert.deepEqual(companion.sources.find(item => item.id === sourceId), source);
  const pages = companion.pages.filter(page => page.sourceId === sourceId);
  assert.deepEqual(pages.map(page => page.page), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.deepEqual(pages.filter(page => page.kind === "reference").map(page => page.page), review.referencePages);
  for (const page of pages) {
    [page.focus, page.task, page.model, ...page.checks].forEach(pair);
    assert.equal(page.checks.length, page.kind === "practice" ? 2 : 0);
    assert.ok(page.unitIds.every(id => grammar.units.some(unit => unit.id === id)));
  }
  for (const n of [3, 15, 16]) assert.match(pages[n - 1].task.en, /homework independently/);
  assert.ok(review.sourceIssues.some(issue => issue.page === 8));
});

test("four distinct missions teach usable outcomes with original scenes, delayed recall and exact source pages", () => {
  assert.equal(missions.length, 4);
  for (const mission of missions) {
    [mission.title, mission.goal, mission.rule, mission.output, mission.model, ...mission.examples, ...mission.words, ...mission.rubric].forEach(pair);
    assert.equal(mission.checks.length, 2); assert.equal(mission.rubric.length, 2);
    assert.ok(mission.examples.length >= 2);
    assert.equal(new Set([...mission.checks, mission.review].map(check => check.prompt.it)).size, 3);
    for (const check of [...mission.checks, mission.review]) {
      pair(check.prompt); pair(check.explanation);
      assert.ok(check.answers.length && check.answers.every(answer => isCorrect(answer, check.answers)));
    }
    for (const ref of mission.sources) {
      assert.equal(ref.id, sourceId);
      assert.ok(ref.pages.every(page => review.physicalPagesRead.includes(page)));
      assert.ok(!ref.pages.some(page => [3, 15, 16].includes(page)), "Homework stays separate");
    }
    assert.ok(mission.relatedGrammarIds.every(id => grammar.units.some(unit => unit.id === id)));
    const lesson = enrichment.lessons.find(lesson => lesson.missionId === mission.id);
    assert.ok(lesson.dialogue.length >= 4); assert.ok(lesson.notes.length >= 3);
    [...lesson.dialogue, ...lesson.notes, lesson.frame, lesson.speaking, lesson.question.prompt, lesson.question.explanation].forEach(pair);
    const bank = enrichment.banks.find(bank => bank.id === lesson.bank);
    assert.equal(bank.words.length, 8);
    for (const word of bank.words) {
      pair(word.term); pair(word.example);
      assert.ok(["lesson", "extension"].includes(word.provenance));
      assert.ok(vocabItemById.has(word.id));
      assert.ok(word.sourceRefs.every(ref => ref.id === sourceId && ref.pages.every(page => review.physicalPagesRead.includes(page))));
    }
  }
});

test("imperative checks distinguish addressees, negatives and valid short/full irregular variants", () => {
  const regular = missions[0], irregular = missions[1], negative = missions[2], polite = missions[3];
  assert.ok(isCorrect("posa", regular.checks[0].answers));
  assert.equal(isCorrect("posi", regular.checks[0].answers), false);
  for (const answer of ["fa’", "fa'", "fai"]) assert.ok(isCorrect(answer, irregular.checks[1].answers));
  assert.equal(isCorrect("faccia", irregular.checks[1].answers), false);
  assert.ok(isCorrect("spostare", negative.checks[0].answers));
  assert.equal(isCorrect("spostate", negative.checks[0].answers), false);
  assert.ok(isCorrect("spostate", negative.checks[1].answers));
  assert.equal(isCorrect("spostare", negative.checks[1].answers), false);
  assert.ok(isCorrect("lasci", polite.checks[0].answers));
  assert.equal(isCorrect("lascia", polite.checks[0].answers), false);
  assert.equal(isCorrect("entrare", polite.checks[1].answers), false);
  assert.equal(isCorrect("e", ["è"]), false);
});

test("the class route drives Today, preserves a paused session and still requires fresh personal practice", () => {
  assert.equal(programme.days.length, 4);
  for (let index = 0; index < 4; index++) {
    let p = selectProgramme(emptyProgress(), programme.id, today);
    p.academy.programme.day = index;
    assert.equal(plan(p).mission.id, missions[index].id);
    p.completed[missions[index].id] = { date: addDays(today, -1), firstCorrect: 2, total: 2, output: "Pratica personale salvata.", supported: false, confidence: 2 };
    for (const id of programme.days[index].unitIds) p.academy.grammar[id] = { ...getGrammarDraft(p, id), completed: addDays(today, -1) };
    assert.equal(programmeDayReady(p, programme, index), false);
    p = updateProgrammePracticeDraft(p, programme, index, { output: "Nuova risposta per il giardino.", rubric: [0, 1], modelSeen: false });
    p = completeProgrammePractice(p, programme, index, today);
    assert.ok(programmeDayReady(p, programme, index));
    p = completeProgrammeDay(p, programme, index, today);
    assert.equal(p.academy.programme.day, index + 1);
  }
  const p = emptyProgress();
  p.sessions = { [today]: { ...emptySession("say-hello", 10), warmup: "Keep my draft" } };
  const switched = selectProgramme(p, programme.id, today);
  assert.equal(plan(switched).mission.id, "say-hello");
  assert.equal(switched.sessions[today].warmup, "Keep my draft");
  assert.equal(sessionMission(switched, curriculum.missions, addDays(today, 1), programme.days[0].missionIds).id, missions[0].id);
  const noProgramme = emptyProgress(); noProgramme.plan.course = 3; noProgramme.plan.minutes = 45;
  for (const mission of curriculum.missions.slice(0, 74)) noProgramme.completed[mission.id] = { date: addDays(today, -1) };
  assert.equal(plan(noProgramme).mission.id, missions[0].id);
  assert.ok(plan(noProgramme).blocks.some(block => block.route === "grammar/a2-informal-imperative"));
});

test("new lesson work, notebook evidence and next-day review round-trip with version-1 progress", () => {
  const mission = missions[0];
  let p = emptyProgress(); p.notes = "Keep earlier notes.";
  const draft = { ...emptyDraft(), step: 3, answers: mission.checks.map(check => check.answers[0]), checked: [true, true], first: [false, true], output: mission.model.it, rubric: [true, true], modelSeen: false };
  p = completeMission(p, mission, draft, 2, today);
  assert.equal(p.completed[mission.id].firstCorrect, 1);
  const restored = parseProgress(JSON.stringify(p), curriculum.missions.map(mission => mission.id));
  assert.equal(restored.notes, p.notes);
  assert.equal(restored.completed[mission.id].output, draft.output);
  assert.equal(restored.reviews[mission.id].due, addDays(today, 1));
  const reviewed = recordReview(restored, mission.id, true, addDays(today, 1));
  assert.equal(reviewed.reviews[mission.id].due, addDays(today, 4));
});

test("search opens the exact class programme and includes new source pages and linked grammar", () => {
  const index = buildDiscoveryIndex({ ...grammar, missions: curriculum.missions, ...companion, banks: enrichment.banks });
  const result = searchDiscovery(index, "Week 5", "programme").find(entry => entry.id === programme.id);
  assert.equal(result.route, "programmes?programme=course3-week5");
  assert.ok(result.sources.some(ref => ref.id === sourceId));
  assert.equal(index.find(entry => entry.id === missions[0].id).level, "A2");
  assert.ok(index.some(entry => entry.id === `${sourceId}-p12`));
});

const escapeReview = JSON.parse(readFileSync(new URL("../docs/escape-room-content-review-2026-11-12.json", import.meta.url), "utf8"));
const escapeSource = curriculum.sources.find(source => source.id === escapeReview.source.id);
const escapeMissions = curriculum.missions.filter(mission => escapeReview.missionIds.includes(mission.id));
const escapeProgramme = grammar.programmes.find(programme => programme.id === escapeReview.programmeId);

test("the escape-room refresh preserves every prior content object and typed-practice identity", () => {
  for (const [path, baseline] of Object.entries(escapeReview.baseline)) {
    const [name, key] = path.split(".");
    assert.equal(digest({ curriculum, enrichment, grammar, companion }[name][key].slice(0, baseline.count)), baseline.sha256, path);
  }
  const priorIds = vocabPracticeItems.filter(item => !item.bankId.startsWith("reviewlab-") && !item.id.startsWith("course-word:")).map(item => item.id).sort();
  assert.equal(priorIds.length, escapeReview.previousVocabularyPracticeIds.count);
  assert.equal(digest(priorIds), escapeReview.previousVocabularyPracticeIds.sha256);
  assert.equal(escapeReview.week5Recheck.sha256, "d7cf3d20c90da8cff714a1408a25f82387cb815fd3c92bbf7df990f52c8c0ae7");
  assert.equal(escapeReview.week5Recheck.changed, false);
});

test("Word source citations identify the reviewed render and keep the completed puzzle reference-only", () => {
  assert.deepEqual(escapeSource, escapeReview.source);
  assert.equal(escapeSource.sha256, "6c05684ab06ad0ed49c17df39eeae066b856d2c18ab0820085adab5310fbccd3");
  assert.equal(escapeSource.pages, 3);
  assert.equal(escapeSource.pagination.basis, "rendered-document");
  assert.match(escapeSource.pagination.pdfSha256, /^[a-f0-9]{64}$/);
  assert.match(sourcePageLabel(escapeSource).en, /Rendered document/);
  assert.match(escapeSource.pagination.note.en, /Word pagination may differ/);
  assert.deepEqual(companion.sources.find(source => source.id === escapeSource.id), escapeSource);
  const pages = companion.pages.filter(page => page.sourceId === escapeSource.id);
  assert.deepEqual(pages.map(page => page.page), [1, 2, 3]);
  for (const page of pages) {
    assert.equal(page.kind, "reference"); assert.deepEqual(page.checks, []);
    [page.focus, page.task, page.model].forEach(pair);
    assert.match(page.task.en, /private answer-key/);
  }
  assert.ok(escapeReview.sourceIssues.some(issue => issue.case === "CASE 04"));
});

test("the two new outcomes include complete bilingual retrieval, original scenes and original vocabulary", () => {
  assert.equal(escapeMissions.length, 2);
  for (const mission of escapeMissions) {
    [mission.title, mission.goal, mission.rule, ...mission.examples, ...mission.words, mission.output, mission.model, ...mission.rubric].forEach(pair);
    assert.equal(mission.checks.length, 2); assert.equal(mission.rubric.length, 2);
    assert.equal(new Set([...mission.checks, mission.review].map(question => question.prompt.it)).size, 3);
    for (const question of [...mission.checks, mission.review]) {
      pair(question.prompt); pair(question.explanation);
      assert.ok(question.answers.length && question.answers.every(answer => isCorrect(answer, question.answers)));
    }
    const lesson = enrichment.lessons.find(lesson => lesson.missionId === mission.id);
    assert.ok(lesson.dialogue.length >= 4); assert.ok(lesson.notes.length >= 3);
    [...lesson.dialogue, ...lesson.notes, lesson.frame, lesson.speaking, lesson.question.prompt, lesson.question.explanation].forEach(pair);
    const bank = enrichment.banks.find(bank => bank.id === lesson.bank);
    assert.equal(bank.words.length, 8);
    for (const word of bank.words) {
      pair(word.term); pair(word.example); assert.equal(word.provenance, "extension");
      assert.ok(vocabItemById.has(word.id));
    }
    for (const ref of mission.sources) {
      assert.equal(ref.id, escapeSource.id);
      assert.ok(ref.pages.every(page => escapeReview.physicalPagesRead.includes(page)));
    }
  }
});

test("quantity and personal-message checks preserve the intended comparison, subject and recipient", () => {
  const [quantities, messages] = escapeMissions;
  assert.ok(isCorrect("che", quantities.checks[0].answers));
  assert.equal(isCorrect("di", quantities.checks[0].answers), false);
  assert.ok(isCorrect("di", quantities.checks[1].answers));
  assert.equal(isCorrect("che", quantities.checks[1].answers), false);
  assert.ok(isCorrect("mancano", messages.checks[0].answers));
  assert.equal(isCorrect("manca", messages.checks[0].answers), false);
  assert.ok(isCorrect("sembrano", messages.checks[1].answers));
  assert.equal(isCorrect("sembra", messages.checks[1].answers), false);
  assert.ok(isCorrect("le", messages.review.answers));
  assert.equal(isCorrect("gli", messages.review.answers), false);
});

test("five original revision checkpoints reuse existing learning and require fresh self-assessed production", () => {
  assert.equal(escapeProgramme.days.length, 5);
  assert.ok(escapeProgramme.days.every(day => day.practice && day.unitIds.every(id => grammar.units.some(unit => unit.id === id))));
  let p = selectProgramme(emptyProgress(), escapeProgramme.id, today);
  p.notes = "Preserve my notebook.";
  assert.equal(plan(p).mission.id, escapeMissions[0].id);
  for (let index = 0; index < escapeProgramme.days.length; index++) {
    p.academy.programme.day = index;
    for (const id of escapeProgramme.days[index].missionIds) p.completed[id] = { date: addDays(today, -1), firstCorrect: 1, total: 2, output: "Una risposta precedente.", supported: false, confidence: 2 };
    for (const id of escapeProgramme.days[index].unitIds) p.academy.grammar[id] = { ...getGrammarDraft(p, id), completed: addDays(today, -1) };
    assert.equal(programmeDayReady(p, escapeProgramme, index), false);
    p = updateProgrammePracticeDraft(p, escapeProgramme, index, { output: "Una nuova risposta originale.", rubric: [0, 1], modelSeen: false });
    p = completeProgrammePractice(p, escapeProgramme, index, today);
    assert.ok(programmeDayReady(p, escapeProgramme, index));
    p = completeProgrammeDay(p, escapeProgramme, index, today);
    assert.equal(p.academy.programme.day, index + 1);
  }
  const restored = parseProgress(JSON.stringify(p), curriculum.missions.map(mission => mission.id));
  assert.equal(restored.version, 1); assert.equal(restored.notes, p.notes);
  assert.equal(restored.academy.programme.day, 5);
  assert.equal(Object.keys(restored.academy.programme.practice).length, 5);
});

test("discovery labels the reviewed document render and opens its specific revision programme", () => {
  const index = buildDiscoveryIndex({ ...grammar, missions: curriculum.missions, ...companion, banks: enrichment.banks });
  assert.match(index.find(entry => entry.id === escapeSource.id).summary.en, /Word pagination may differ/);
  assert.match(index.find(entry => entry.id === `${escapeSource.id}-p2`).summary.en, /reviewed render page 2/);
  assert.equal(index.find(entry => entry.id === escapeProgramme.id).route, "programmes?programme=course3-integrated-recall");
});
