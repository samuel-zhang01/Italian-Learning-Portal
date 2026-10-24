import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyProgress } from "../app/learning/engine.ts";
import { emptyAcademy } from "../app/learning/academy-engine.ts";
import { emptyArcade } from "../app/learning/arcade-engine.ts";
import { localPdfPageHref } from "../app/learning/local-pdfs.ts";
import {
  BOOK_PROGRAMME_ID,
  buildChapterCatalogue,
  chapterEvidence,
  chapterGrammarOrder,
  nextChapterAction,
} from "../app/learning/chapter-dashboard.ts";

const read = (name) => JSON.parse(readFileSync(new URL(`../app/learning/${name}.json`, import.meta.url)));
const curriculum = read("curriculum"), grammar = read("grammar"), enrichment = read("enrichment"), scenes = read("arcade-scenes");
const data = {
  missions: curriculum.missions, units: grammar.units, programmes: grammar.programmes,
  banks: enrichment.banks, scenes: scenes.scenes, sources: curriculum.sources,
};
const chapters = buildChapterCatalogue(data);
const today = "2026-10-24";
const chapter = chapters.find((item) => item.id === "espresso2-u01");
const completion = { date: today, firstCorrect: 2, total: 2, output: "Scrivo una frase originale.", supported: false, confidence: 3 };
const answer = { answer: "risposta", correct: true, assisted: true };
const memory = { first: answer, last: answer, date: today, due: "2026-10-25", successes: 1 };
const withGrammar = (selected = chapter) => {
  const p = emptyProgress();
  p.academy = emptyAcademy();
  for (const unit of chapterGrammarOrder(selected, grammar.units)) {
    p.academy.grammar[unit.id] = { exerciseIndex: 0, answers: {}, attempts: {}, hints: [], output: "Frase originale di prova.", rubric: [0, 1], modelSeen: false, completed: today };
  }
  return p;
};
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
};

test("twenty chapter mappings preserve existing destinations and partition all eighty route checkpoints", () => {
  assert.equal(chapters.length, 20);
  assert.deepEqual(chapters.map((item) => item.id), [1, 2].flatMap((book) => Array.from({ length: 10 }, (_, index) => `espresso${book}-u${String(index + 1).padStart(2, "0")}`)));
  assert.deepEqual(chapters.flatMap((item) => item.dayIndices), Array.from({ length: 80 }, (_, index) => index));
  for (const item of chapters) {
    assert.ok(curriculum.missions.some((mission) => mission.id === item.missionId));
    assert.ok(enrichment.banks.some((bank) => bank.id === item.bankId && bank.missionId === item.missionId));
    assert.equal(item.wordIds.length, 8);
    assert.ok(item.unitIds.every((id) => grammar.units.some((unit) => unit.id === id)));
    assert.equal(item.level, item.book === 1 ? "A1" : "A2");
    if (item.book === 2) {
      assert.equal(item.sceneId, item.id);
      assert.equal(item.turnIds.length, 3);
      assert.ok(scenes.scenes.some((scene) => scene.id === item.sceneId && scene.missionId === item.missionId));
    } else assert.equal(item.sceneId, undefined);
  }
});

test("chapter source links keep verified physical pages and add combined-export offsets only when opening", () => {
  for (const item of chapters) {
    const original = curriculum.missions.find((mission) => mission.id === item.missionId);
    assert.deepEqual(item.sources.map((ref) => ref.source.id).sort(), original.sources.map((ref) => ref.id).sort());
    assert.equal(item.sources[0].kind, "reader");
    for (const ref of item.sources) {
      assert.deepEqual(ref.pages, [...new Set(original.sources.find((source) => source.id === ref.source.id).pages)].sort((a, b) => a - b));
      for (const page of ref.pages) {
        assert.ok(page >= 1 && page <= ref.source.pages);
        assert.equal(localPdfPageHref("blob:chapter-test#page=1", page, 240), `blob:chapter-test#page=${page + 240}`);
      }
    }
  }
  assert.equal(chapter.sources.find((ref) => /guida/i.test(ref.source.title)).kind, "teacher-support");
  assert.ok(chapters.some((item) => item.sources.some((ref) => ref.kind === "contents")));
});

test("vocabulary self-reports, drafts and supported game replies never become recorded chapter completion", () => {
  const p = emptyProgress();
  p.sessions = { [today]: {
    missionId: chapter.missionId, bankId: chapter.bankId, duration: 30, done: [], warmup: "",
    recalled: [...chapter.wordIds.map((id) => id.replace(/^word:/, "")), "clothes:0"], inputAnswer: "", speaking: "", exit: "",
    gistAnswer: "Irene", retell: "Il regalo è per Paolo.", retellChecks: [true, true],
  } };
  p.arcade = emptyArcade();
  for (const id of chapter.wordIds) p.arcade.records[id] = structuredClone(memory);
  for (const id of chapter.turnIds) p.arcade.records[`scene:${chapter.sceneId}:${id}`] = structuredClone(memory);
  const evidence = chapterEvidence(p, chapter, today);
  assert.equal(evidence.vocabularySelfReports, 8);
  assert.equal(evidence.vocabularyLatestCorrect, 8);
  assert.equal(evidence.conversationLatestCorrect, 3);
  assert.equal(evidence.gistDraftSaved, true);
  assert.equal(evidence.retellDraftSaved, true);
  assert.equal(evidence.coreCompleted, false);
  assert.equal(evidence.grammarCompleted, 0);
  assert.equal(evidence.checkpointsCompleted, 0);
  assert.notEqual(nextChapterAction(p, chapter, grammar.units, today).kind, "vocabulary");
});

test("the recommended unfinished grammar has all prerequisites completed even when later work is already saved", () => {
  const selected = chapters.find((item) => item.id === "espresso2-u10");
  const order = chapterGrammarOrder(selected, grammar.units);
  const positions = new Map(order.map((unit, index) => [unit.id, index]));
  for (const [index, unit] of order.entries()) {
    assert.ok(unit.prerequisites.every((id) => positions.get(id) < index));
  }
  const p = withGrammar(selected);
  const missing = order.find((unit) => !selected.unitIds.includes(unit.id));
  delete p.academy.grammar[missing.id];
  const next = nextChapterAction(p, selected, grammar.units, today);
  assert.equal(next.kind, "prerequisite");
  assert.equal(next.unitId, missing.id);
  assert.equal(next.route, `grammar/${missing.id}`);
  assert.ok(missing.prerequisites.every((id) => p.academy.grammar[id].completed));
});

test("remaining actions move from grammar to core and current checkpoint without switching programmes", () => {
  const p = withGrammar();
  assert.equal(nextChapterAction(p, chapter, grammar.units, today).route, `lesson/${chapter.missionId}`);
  p.completed[chapter.missionId] = structuredClone(completion);
  p.academy.programme = { id: BOOK_PROGRAMME_ID, started: today, day: chapter.dayIndices[1], completed: { [chapter.dayIndices[0]]: today } };
  assert.equal(nextChapterAction(p, chapter, grammar.units, today).kind, "checkpoint");
  assert.equal(chapterEvidence(p, chapter, today).checkpointsCompleted, 1);
  const snapshot = JSON.stringify(p);
  freeze(p);
  for (const item of chapters) {
    chapterEvidence(p, item, today);
    nextChapterAction(p, item, grammar.units, today);
  }
  assert.equal(JSON.stringify(p), snapshot);
  assert.equal(p.academy.programme.day, chapter.dayIndices[1]);
});

test("completed lessons and self-assessed checkpoint drafts do not imply a saved route-day completion", () => {
  const p = withGrammar();
  p.completed[chapter.missionId] = structuredClone(completion);
  p.academy.programme = {
    id: BOOK_PROGRAMME_ID, started: today, day: chapter.dayIndices[0], completed: {},
    practice: Object.fromEntries(chapter.dayIndices.map((index) => [index, { output: "Una nuova risposta personale.", rubric: [0, 1], modelSeen: false, completed: today }])),
  };
  assert.equal(chapterEvidence(p, chapter, today).checkpointsCompleted, 0);
  p.academy.programme.completed[chapter.dayIndices[0]] = today;
  assert.equal(chapterEvidence(p, chapter, today).checkpointsCompleted, 1);
  p.academy.programme.id = "supported-a1";
  const snapshot = JSON.stringify(p);
  assert.equal(chapterEvidence(p, chapter, today).routeSelected, false);
  assert.equal(chapterEvidence(p, chapter, today).checkpointsCompleted, 0);
  assert.equal(nextChapterAction(p, chapter, grammar.units, today).kind, "programme");
  assert.equal(JSON.stringify(p), snapshot);
});

test("after four saved checkpoints optional conversation evidence and retrieval remain distinct", () => {
  const p = withGrammar();
  p.completed[chapter.missionId] = structuredClone(completion);
  p.academy.programme = { id: BOOK_PROGRAMME_ID, started: today, day: chapter.dayIndices.at(-1) + 1, completed: Object.fromEntries(chapter.dayIndices.map((index) => [index, today])) };
  assert.equal(nextChapterAction(p, chapter, grammar.units, today).route, `games/${chapter.sceneId}`);
  p.arcade = emptyArcade();
  for (const id of chapter.turnIds) p.arcade.records[`scene:${chapter.sceneId}:${id}`] = structuredClone(memory);
  assert.equal(nextChapterAction(p, chapter, grammar.units, today).route, `vocabulary/${chapter.bankId}`);
  assert.equal(nextChapterAction(p, chapter, grammar.units, "2026-10-25").kind, "conversation");
  assert.equal(chapterEvidence(p, chapter, today).checkpointsCompleted, 4);
});

test("invalid chapter source bounds and prerequisite cycles fail rather than producing broken recommendations", () => {
  const invalid = structuredClone(data);
  invalid.missions.find((mission) => mission.id === chapter.missionId).sources[0].pages = [99999];
  assert.throws(() => buildChapterCatalogue(invalid), /Unbounded source reference/);
  const units = structuredClone(grammar.units);
  units.find((unit) => unit.id === chapter.unitIds[0]).prerequisites.push(chapter.unitIds[0]);
  assert.throws(() => chapterGrammarOrder(chapter, units), /Invalid grammar prerequisite/);
});
