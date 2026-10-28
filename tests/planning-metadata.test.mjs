import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { generatedPlanningJSON } from "../scripts/generate_planning_metadata.mjs";
import {
  planningAssessmentIds, planningBanks, planningMissions, planningPages,
  planningProgrammes, planningReviewCatalogue, planningScenes, planningSources, planningUnits,
} from "../app/learning/planning-data.ts";
import { dailyStudyPlan } from "../app/learning/study.ts";
import { emptyProgress, parseProgress } from "../app/learning/engine.ts";
import { emptyAcademy, getGrammarDraft, grammarReviewQueue, selectProgramme, wordKey } from "../app/learning/academy-engine.ts";
import { arcadeItems } from "../app/learning/arcade-catalogue.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (name) => JSON.parse(readFileSync(path.join(root, "app/learning", `${name}.json`), "utf8"));
const curriculum = read("curriculum"), grammar = read("grammar"), companion = read("companion"), enrichment = read("enrichment");
const today = "2026-10-24", prior = "2026-10-20";
const budgets = [5, 10, 15, 20, 30, 45, 60];
const plan = (p, compact = false) => dailyStudyPlan(p,
  compact ? planningMissions : curriculum.missions,
  compact ? planningUnits : grammar.units,
  compact ? planningProgrammes : grammar.programmes,
  compact ? planningPages : companion.pages, today);
const snapshot = (value) => ({
  programme: value.programme && { id: value.programme.id, title: value.programme.title },
  day: value.day && { title: value.day.title, outcome: value.day.outcome,
    unitIds: value.day.unitIds, missionIds: value.day.missionIds, practice: Boolean(value.day.practice) },
  mission: { id: value.mission.id, title: value.mission.title, goal: value.mission.goal },
  duration: value.duration, blocks: value.blocks, next: value.next, dayReady: value.dayReady,
});

test("generated planning metadata exactly matches its reproducible authored-only projection", () => {
  const actual = readFileSync(path.join(root, "app/learning/planning-metadata.json"), "utf8");
  assert.equal(actual, generatedPlanningJSON(), "run node scripts/generate_planning_metadata.mjs after changing authored catalogue identity");
  const sourceBytes = ["curriculum", "grammar", "companion", "enrichment", "arcade-scenes"]
    .reduce((sum, name) => sum + Buffer.byteLength(readFileSync(path.join(root, "app/learning", `${name}.json`))), 0);
  assert.ok(Buffer.byteLength(actual) < sourceBytes / 10, "planning must stay below one tenth of full authored catalogue bytes");
});

test("metadata preserves catalogue ordering and identity while omitting exercise and lesson bodies", () => {
  assert.deepEqual(planningAssessmentIds, grammar.units.flatMap((unit) => unit.exercises.map((exercise) => exercise.id)));
  assert.deepEqual(planningMissions.map((mission) => mission.id), curriculum.missions.map((mission) => mission.id));
  assert.deepEqual(planningUnits.map((unit) => unit.id), grammar.units.map((unit) => unit.id));
  assert.deepEqual(planningSources, [...new Map([...curriculum.sources, ...companion.sources].map((source) => [source.id, source])).values()]);
  assert.equal(planningBanks.length, enrichment.banks.length);
  assert.equal(planningScenes.length, read("arcade-scenes").scenes.length);
  for (const unit of planningUnits) {
    assert.deepEqual(Object.keys(unit).sort(), ["exercises", "id", "level", "missionIds", "prerequisites", "sources", "title"]);
    for (const exercise of unit.exercises) assert.deepEqual(Object.keys(exercise).sort(), ["id", "kind"]);
  }
  for (const programme of planningProgrammes) for (const day of programme.days) {
    assert.ok(day.practice === undefined || day.practice === true);
    assert.ok(!("model" in day) && !("prompt" in day));
  }
  for (const page of planningPages) assert.deepEqual(Object.keys(page).sort(), ["focus", "id", "kind", "page", "sourceId", "unitIds"]);
});

test("the small companion subset preserves the first practice page for every grammar unit", () => {
  assert.ok(planningPages.length < companion.pages.length / 10);
  for (const unit of grammar.units) {
    const full = companion.pages.find((page) => page.kind === "practice" && page.unitIds.includes(unit.id));
    const compact = planningPages.find((page) => page.kind === "practice" && page.unitIds.includes(unit.id));
    assert.equal(compact?.id, full?.id, unit.id);
  }
});

test("full and compact catalogues produce identical plans for all programmes, budgets and completion states", () => {
  let cases = 0;
  for (const programme of grammar.programmes) for (let dayIndex = 0; dayIndex < programme.days.length; dayIndex += 1) {
    const day = programme.days[dayIndex];
    for (const minutes of budgets) for (const state of ["new", "attempted", "linked-complete", "ready"]) {
      const p = selectProgramme(emptyProgress(), programme.id, prior);
      p.plan.minutes = minutes;
      p.academy.programme.day = dayIndex;
      if (state === "attempted") {
        const unit = grammar.units.find((unit) => unit.id === day.unitIds[0]);
        if (unit) p.academy.grammar[unit.id] = { ...getGrammarDraft(p, unit.id), attempts: {
          [unit.exercises[0].id]: [{ answer: "synthetic", correct: false, assisted: false, date: prior }],
        } };
      }
      if (state === "linked-complete" || state === "ready") {
        for (const id of day.unitIds) p.academy.grammar[id] = { ...getGrammarDraft(p, id), completed: prior };
        for (const id of day.missionIds) p.completed[id] = { date: prior, firstCorrect: 2, total: 2, output: "Tre parole di prova.", supported: false, confidence: 2 };
      }
      if (state === "ready" && day.practice) p.academy.programme.practice = {
        [dayIndex]: { output: "Tre parole di prova.", rubric: [0, 1], modelSeen: false, completed: today },
      };
      assert.deepEqual(snapshot(plan(p, true)), snapshot(plan(p)), `${programme.id}:${dayIndex}:${minutes}:${state}`);
      cases += 1;
    }
  }
  assert.equal(cases, 3696);
});

test("saved session pinning and grammar recall fallback remain identical with compact data", () => {
  for (const minutes of budgets) {
    const p = emptyProgress(); p.plan.minutes = minutes; p.academy = emptyAcademy();
    const mission = curriculum.missions.at(-1);
    p.sessions = { [today]: { missionId: mission.id, duration: 30, bankId: "home", done: ["warmup"], warmup: "Saved draft", recalled: ["home:0"], inputAnswer: "", speaking: "", exit: "" } };
    assert.deepEqual(snapshot(plan(p, true)), snapshot(plan(p)));
  }
  const p = emptyProgress(); p.academy = emptyAcademy();
  for (const [index, unit] of grammar.units.entries()) {
    p.academy.grammar[unit.id] = { ...getGrammarDraft(p, unit.id), attempts: {
      [unit.exercises[0].id]: [{ answer: "synthetic", correct: index % 2 === 0, assisted: index % 3 === 0, date: prior }],
    } };
  }
  const ids = (rows) => rows.map(({ unit, exercise }) => [unit.id, exercise.id]);
  assert.deepEqual(ids(grammarReviewQueue(p, planningUnits, today)), ids(grammarReviewQueue(p, grammar.units, today)));
});

test("synchronous backup hydration still accepts known diagnostic IDs and rejects invented IDs", () => {
  const p = emptyProgress(); p.academy = emptyAcademy();
  p.academy.assessments[`${prior}:readiness`] = {
    date: prior, exerciseIds: [planningAssessmentIds.at(-1)], answers: {}, completed: false,
  };
  const missionIds = planningMissions.map((mission) => mission.id);
  assert.deepEqual(parseProgress(JSON.stringify(p), missionIds), p);
  p.academy.assessments[`${prior}:readiness`].exerciseIds = ["invented-exercise"];
  assert.throws(() => parseProgress(JSON.stringify(p), missionIds), /assessment/);
});

test("light review metadata exactly matches full activity IDs, titles and duplicate-evidence keys", () => {
  const expected = arcadeItems.map((item) => ({
    id: item.id, title: item.title,
    ...(item.unitId ? { unitId: item.unitId } : {}),
    ...(item.id.startsWith("grammar:") ? { grammarExerciseId: item.id.slice("grammar:".length) } : {}),
    ...(item.word ? { wordKey: wordKey(item.word.term) } : {}),
  }));
  assert.deepEqual(planningReviewCatalogue.arcade, expected);
  const terms = [...grammar.units.flatMap((unit) => unit.words), ...enrichment.banks.flatMap((bank) => bank.words.map((word) => word.term)), ...read("booster-content").nouns.map((noun) => noun.term), ...read("vocab-library").banks.flatMap(bank => bank.words.map(word => word.term))];
  assert.deepEqual(planningReviewCatalogue.words, [...new Map(terms.map((term) => [wordKey(term), { key: wordKey(term), term }])).values()]);
  const vocabulary = [...enrichment.banks, ...read("vocab-library").banks].flatMap(bank => bank.words.map(word => ({
    id: word.id, title: { en: word.term.en, it: word.term.en }, wordKey: wordKey(word.term),
  })));
  const vocabularyKeys = new Set(vocabulary.map(item => item.wordKey));
  for (const unit of grammar.units) unit.words.forEach((term, index) => {
    const key = wordKey(term);
    if (vocabularyKeys.has(key)) return;
    vocabularyKeys.add(key);
    vocabulary.push({ id: `grammar-word:${unit.id}:${index}`, title: { en: term.en, it: term.en }, wordKey: key });
  });
  for (const noun of read("booster-content").nouns) {
    const key = wordKey(noun.term);
    if (vocabularyKeys.has(key)) continue;
    vocabularyKeys.add(key);
    vocabulary.push({ id: `noun-vocab:${noun.id}`, title: { en: noun.term.en, it: noun.term.en }, wordKey: key });
  }
  assert.deepEqual(planningReviewCatalogue.vocab, vocabulary);
});

test("the initial progress engine dependency graph contains compact metadata without full teaching catalogues", () => {
  const visited = new Set();
  const visit = (filename) => {
    if (visited.has(filename)) return;
    visited.add(filename);
    if (filename.endsWith(".json")) return;
    const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const specifier = node.moduleSpecifier.text;
      if (!specifier.startsWith(".")) continue;
      const target = path.resolve(path.dirname(filename), specifier);
      visit(path.extname(target) ? target : `${target}.ts`);
    }
  };
  visit(path.join(root, "app/learning/engine.ts"));
  const names = [...visited].map((file) => path.basename(file));
  assert.ok(names.includes("planning-metadata.json"));
  for (const full of ["curriculum.json", "grammar.json", "companion.json", "enrichment.json", "arcade-scenes.json", "booster-content.json", "vocab-library.json"]) {
    assert.ok(!names.includes(full), `${full} must load with its study route, not synchronous progress hydration`);
  }
});
