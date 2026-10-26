import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { completeMission, emptyDraft, emptyProgress, isCorrect, parseProgress } from "../app/learning/engine.ts";
import { checkGrammarAnswer, getGrammarDraft, grammarScore, selectProgramme } from "../app/learning/academy-engine.ts";
import { arcadeItemById } from "../app/learning/arcade-catalogue.ts";

const read = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const curriculum = read("../app/learning/curriculum.json");
const grammar = read("../app/learning/grammar.json");
const enrichment = read("../app/learning/enrichment.json");
const companion = read("../app/learning/companion.json");
const review = read("../docs/book-gap-content-review.json");
const unitIds = review.unitSourceMap.map((item) => item.unitId);
const missionIds = review.missionChapterMap.map((item) => item.missionId);
const units = unitIds.map((id) => grammar.units.find((unit) => unit.id === id));
const missions = missionIds.map((id) => curriculum.missions.find((mission) => mission.id === id));
const allMissionIds = curriculum.missions.map((mission) => mission.id);
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const pair = (value, label) => assert.ok(typeof value?.en === "string" && value.en.trim() && typeof value?.it === "string" && value.it.trim(), label);
const lexical = (value) => value.normalize("NFC").toLocaleLowerCase("it").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const today = "2026-10-25";

test("gap supplements preserve prior content apart from the reviewed additive answer correction", () => {
  const documents = { curriculum, grammar, enrichment };
  for (const [path, baseline] of Object.entries(review.baselinePreservation.arrays)) {
    const [name, key] = path.split(".");
    const previous = structuredClone(documents[name][key].slice(0, baseline.count));
    if (path === "grammar.units") {
      // The 2026-10-26 learner audit added one valid adjective-position variant.
      // Keep the historical preservation check strict for every other field.
      const corrected = previous.find((unit) => unit.id === "a2-better-best")
        .exercises.find((exercise) => exercise.id === "a2-better-best-4");
      corrected.answers = corrected.answers.filter((answer) => answer !== "Questa è una soluzione ottima.");
    }
    assert.equal(digest(previous), baseline.sha256, path);
  }
  assert.equal(review.baselinePreservation.arrays["grammar.units"].count, 55);
  assert.equal(review.baselinePreservation.arrays["curriculum.missions"].count, 56);
  assert.equal(review.baselinePreservation.arrays["enrichment.lessons"].count, 56);
});

test("ten bounded supplements provide80 original checks and eleven full bilingual missions", () => {
  assert.equal(units.length, 10); assert.ok(units.every(Boolean));
  assert.equal(missions.length, 11); assert.ok(missions.every(Boolean));
  assert.equal(units.flatMap((unit) => unit.exercises).length, 80);
  assert.equal(units.filter((unit) => unit.level === "A1").length, 1);
  assert.equal(units.filter((unit) => unit.level === "A2").length, 9);
  for (const unit of units) {
    [unit.title, unit.summary, ...unit.teaching, ...unit.examples, ...unit.words, unit.production.prompt,
      unit.production.frame, unit.production.model, ...unit.production.rubric].forEach((value) => pair(value, unit.id));
    assert.ok(unit.teaching.length >= 4 && unit.examples.length >= 3 && unit.words.length >= 4);
    assert.equal(unit.exercises.length, 8); assert.equal(unit.production.rubric.length, 2);
    assert.ok(unit.prerequisites.every((id) => grammar.units.some((item) => item.id === id)));
    assert.ok(unit.missionIds.every((id) => allMissionIds.includes(id)));
    for (const exercise of unit.exercises) {
      [exercise.prompt, exercise.hint, exercise.explanation].forEach((value) => pair(value, exercise.id));
      assert.equal(exercise.focus, unit.id);
      assert.ok(exercise.answers.length && exercise.answers.every((answer) => isCorrect(answer, exercise.answers)));
    }
  }
  for (const mission of missions) {
    [mission.title, mission.goal, mission.rule, ...mission.examples, ...mission.words,
      mission.output, mission.model, ...mission.rubric].forEach((value) => pair(value, mission.id));
    assert.equal(mission.checks.length, 2); assert.equal(mission.rubric.length, 2);
    assert.equal(new Set([...mission.checks, mission.review].map((check) => check.prompt.it)).size, 3);
  }
});

test("supplement references use actually reviewed bounded native pages and retain reference-only companion classification", () => {
  assert.deepEqual(review.verifiedSources.map((source) => source.sourceId), ["src-1647be2784c9", "src-580f7558db56"]);
  assert.equal(review.verifiedSources.reduce((sum, source) => sum + source.selectivelyReadPhysicalPages.length, 0), 14);
  for (const item of [...units, ...missions]) for (const ref of item.sources) {
    const source = curriculum.sources.find((source) => source.id === ref.id);
    const verified = review.verifiedSources.find((entry) => entry.sourceId === ref.id);
    assert.ok(source && verified, item.id);
    assert.equal(source.sha256, verified.sha256);
    for (const page of ref.pages) {
      assert.ok(page >= 1 && page <= source.pages && verified.selectivelyReadPhysicalPages.includes(page), `${item.id}/${page}`);
      const pointer = companion.pages.find((entry) => entry.sourceId === ref.id && entry.page === page);
      assert.equal(pointer?.kind, "reference");
      assert.equal(pointer.checks.length, 0);
      if (unitIds.includes(item.id)) assert.ok(pointer.unitIds.includes(item.id), `${item.id}: reference topic link`);
    }
  }
  assert.equal(companion.pages.filter((page) => page.kind === "practice").length, 730);
  assert.ok(!companion.pages.some((page) => page.sourceId === "src-580f7558db56" && page.page === 264));
});

test("bounded answer models distinguish spelling, selected body variants, ci/ne and auxiliary constructions", () => {
  const cases = [
    ["a1-plural-spelling-05", "amici", "amichi"],
    ["a1-plural-spelling-06", "valigie e spiagge", "valige e spiaggie"],
    ["a2-irregular-body-nouns-03", "ginocchia", "ginocchi"],
    ["a2-nonlocative-ci-06", "Devo pensarci.", "Devo pensareci."],
    ["a2-noun-alterations-04", "gattona", "gattone"],
    ["a2-auxiliary-alternation-02", "è", "ha"],
    ["a2-auxiliary-alternation-08", "Ho già finito.", "Sono già finito."],
    ["a2-ne-perfect-agreement-03", "Ne ho stampata una.", "Ne ho stampato una."],
    ["a2-bello-forms-08", "belle finestre; i quadri sono belli", "begli finestre; i quadri sono bei"],
    ["a2-bisogna-causal-03", "perché", "perche"],
  ];
  const exercises = new Map(units.flatMap((unit) => unit.exercises).map((exercise) => [exercise.id, exercise]));
  for (const [id, good, wrong] of cases) {
    assert.ok(isCorrect(good, exercises.get(id).answers), id);
    assert.ok(!isCorrect(wrong, exercises.get(id).answers), id);
  }
  assert.match(exercises.get("a2-irregular-body-nouns-03").prompt.en, /feminine model after le/);
});

test("commands accept both declared negative-voi positions and preserve the non-doubling gli exception", () => {
  const plural = units.find((unit) => unit.id === "a2-plural-imperative");
  const negative = plural.exercises.find((exercise) => exercise.id.endsWith("-06"));
  assert.ok(isCorrect("Non sedetevi qui.", negative.answers));
  assert.ok(isCorrect("Non vi sedete qui.", negative.answers));
  const short = units.find((unit) => unit.id === "a2-short-command-pronouns");
  assert.ok(isCorrect("digli", short.exercises[5].answers));
  assert.ok(!isCorrect("diggli", short.exercises[5].answers));
  assert.ok(isCorrect("dagli", short.exercises[6].answers));
  assert.ok(!isCorrect("daggli", short.exercises[6].answers));
  assert.ok(isCorrect("Fagli vedere il percorso.", short.exercises[7].answers));
  for (const unit of units) for (const exercise of unit.exercises.filter((item) => item.kind === "reorder")) {
    const arcade = arcadeItemById.get(`grammar:${exercise.id}`);
    assert.ok(arcade, exercise.id);
    assert.ok(arcade.tokens.every((token) => !/[.!?,;:]$/u.test(token)), `${exercise.id}: playable sentence-builder tokens`);
    assert.ok(isCorrect(arcade.tokens.join(" "), arcade.answers));
  }
});

test("each new guided scene is answerable from its own original dialogue and uses an existing bank/resource", () => {
  for (const mission of missions) {
    const scene = enrichment.lessons.find((lesson) => lesson.missionId === mission.id);
    assert.ok(scene, mission.id);
    assert.equal(scene.dialogue.length, 4);
    assert.ok(enrichment.banks.some((bank) => bank.id === scene.bank));
    assert.ok(enrichment.resources.some((resource) => resource.id === scene.resource));
    const dialogue = ` ${lexical(scene.dialogue.map((line) => line.it).join(" "))} `;
    for (const answer of scene.question.answers) assert.ok(dialogue.includes(` ${lexical(answer)} `), mission.id);
    [scene.frame, scene.speaking, scene.question.prompt, scene.question.explanation, ...scene.dialogue, ...scene.notes]
      .forEach((value) => pair(value, mission.id));
  }
});

test("new controlled attempts retain first-error evidence and new mission production still requires self-checks", () => {
  let p = selectProgramme(emptyProgress(), "supported-a1", today);
  const originalProgramme = structuredClone(p.academy.programme);
  const priorMission = curriculum.missions[0];
  p.drafts[priorMission.id] = { ...emptyDraft(), output: "Un vecchio appunto personale." };
  for (const unit of units) {
    const exercise = unit.exercises[0];
    p = checkGrammarAnswer(p, unit, exercise.id, "risposta errata di prova", { hintUsed: false, today });
    p = checkGrammarAnswer(p, unit, exercise.id, exercise.answers[0], { hintUsed: false, today });
    assert.equal(getGrammarDraft(p, unit.id).attempts[exercise.id][0].correct, false);
    assert.equal(grammarScore(p, unit).firstCorrect, 0);
    assert.equal(grammarScore(p, unit).solved, 1);
  }
  for (const mission of missions) {
    const draft = { ...emptyDraft(), step: 3, checked: [true, true], first: [true, true], output: mission.model.it, rubric: [false, false] };
    assert.equal(completeMission(p, mission, draft, 2, today), p);
    p = completeMission(p, mission, { ...draft, rubric: [true, true] }, 2, today);
    assert.equal(p.completed[mission.id].output, mission.model.it);
    assert.equal(p.reviews[mission.id].due, "2026-10-26");
  }
  const restored = parseProgress(JSON.stringify(p), allMissionIds);
  assert.deepEqual(restored.academy.programme, originalProgramme);
  assert.equal(restored.drafts[priorMission.id].output, "Un vecchio appunto personale.");
  assert.equal(missions.filter((mission) => restored.completed[mission.id]).length, 11);
});

test("formal enquiry teaches a bounded coherent register rather than claiming automated writing assessment", () => {
  const mission = missions.find((item) => item.id === "book2-formal-enquiry");
  assert.match(mission.model.it, /^Oggetto:/u);
  assert.match(mission.model.it, /Gentile Dott\.ssa Neri,/u);
  assert.match(mission.model.it, /Le scrivo/u);
  assert.match(mission.model.it, /Potrebbe dirmi/u);
  assert.match(mission.model.it, /La ringrazio/u);
  assert.match(mission.model.it, /Cordiali saluti/u);
  assert.ok(isCorrect("Le", mission.checks[0].answers));
  assert.ok(!isCorrect("La", mission.checks[0].answers));
  assert.ok(isCorrect("La", mission.checks[1].answers));
  assert.equal(mission.rubric.length, 2);
  assert.ok(review.scopeLimits.some((limit) => limit.includes("not a complete employment-letter or CV-writing course")));
});
