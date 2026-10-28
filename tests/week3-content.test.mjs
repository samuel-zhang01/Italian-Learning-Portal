import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { completeMission, emptyDraft, emptyProgress, isCorrect, parseProgress } from "../app/learning/engine.ts";

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const curriculum = read("../app/learning/curriculum.json");
const enrichment = read("../app/learning/enrichment.json");
const grammar = read("../app/learning/grammar.json");
const companion = read("../app/learning/companion.json");
const booster = read("../app/learning/booster-content.json");
const review = read("../docs/week3-content-review-2026-10-28.json");
const sourceId = "src-f293d35b1616";
const sources = new Map(curriculum.sources.map((source) => [source.id, source]));
const reviewedSources = new Map(review.verifiedSources.map((source) => [source.sourceId, source]));
const unitIds = new Set(grammar.units.map((unit) => unit.id));
const missions = review.missionSourceMap.map((entry) => curriculum.missions.find((mission) => mission.id === entry.missionId));
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const pair = (value, label) => assert.ok(typeof value?.en === "string" && value.en.trim() && typeof value?.it === "string" && value.it.trim(), label);

function checkRefs(refs, label) {
  assert.ok(refs.length, label);
  for (const ref of refs) {
    const source = sources.get(ref.id);
    const reviewed = reviewedSources.get(ref.id);
    assert.ok(source && reviewed, `${label}: reviewed source ${ref.id}`);
    assert.equal(source.sha256, reviewed.sha256, `${label}: source fingerprint`);
    for (const page of ref.pages) {
      assert.ok(Number.isInteger(page) && page >= 1 && page <= source.pages, `${label}: physical page ${page}`);
      assert.ok(reviewed.selectivelyReadPhysicalPages.includes(page), `${label}: actually reviewed page ${page}`);
    }
  }
}

test("Week 3 preserves all prior content and saved IDs apart from three explicit additive grammar links", () => {
  const documents = { curriculum, enrichment, grammar, companion };
  const additions = review.baselinePreservation.allowedAdditionsToExistingObjects["grammar.units"];
  for (const [path, baseline] of Object.entries(review.baselinePreservation.arrays)) {
    const [name, key] = path.split(".");
    const previous = structuredClone(documents[name][key].slice(0, baseline.count));
    if (path === "grammar.units") for (const unit of previous) {
      if (additions[unit.id]) unit.missionIds = unit.missionIds.filter((id) => !additions[unit.id].includes(id));
    }
    assert.equal(digest(previous), baseline.sha256, path);
  }
  assert.equal(review.baselinePreservation.arrays["curriculum.missions"].count, 67);
  assert.equal(review.baselinePreservation.arrays["companion.pages"].count, 1609);
});

test("all 20 new physical pages are covered without treating independent homework as completed practice", () => {
  const source = sources.get(sourceId);
  assert.equal(source.pages, 20);
  assert.equal(source.sha256, "f293d35b1616561dc25feb0a062f6d7c14b91f511bce5a254efd4e066b936538");
  assert.deepEqual(companion.sources.find((entry) => entry.id === sourceId), source);
  const pages = companion.pages.filter((page) => page.sourceId === sourceId);
  assert.deepEqual(pages.map((page) => page.page), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(new Set(pages.map((page) => page.id)).size, 20);
  assert.deepEqual(pages.filter((page) => page.kind === "practice").map((page) => page.page), review.companionCoverage.practicePages);
  assert.deepEqual(pages.filter((page) => page.kind === "reference").map((page) => page.page), [1, 2, 3, 11, 19, 20]);
  assert.deepEqual(review.visualReview.physicalPages, [7, 8, 19]);
  for (const page of pages) {
    [page.focus, page.task, page.model, ...page.checks].forEach((value) => pair(value, page.id));
    assert.ok(page.unitIds.every((id) => unitIds.has(id)), page.id);
    assert.equal(page.checks.length, page.kind === "practice" ? 2 : 0, page.id);
  }
  for (const pageNumber of [3, 20]) {
    const page = pages.find((page) => page.page === pageNumber);
    assert.equal(page.kind, "reference");
    assert.match(page.task.en, /homework|independently/u);
  }
  assert.match(pages.find((page) => page.page === 8).checks[1].en, /not all intransitive verbs use essere/u);
});

test("three bounded missions provide bilingual examples, distinct retrieval and complete guided scenes", () => {
  assert.equal(missions.length, 3);
  for (const mission of missions) {
    assert.ok(mission);
    assert.equal(mission.course, 3);
    [mission.title, mission.goal, mission.rule, ...mission.examples, ...mission.words, mission.output, mission.model, ...mission.rubric].forEach((value) => pair(value, mission.id));
    assert.ok(mission.examples.length >= 3 && mission.words.length >= 4);
    assert.equal(mission.checks.length, 2);
    assert.equal(mission.rubric.length, 2);
    assert.equal(new Set([...mission.checks, mission.review].map((check) => check.prompt.it)).size, 3);
    for (const check of [...mission.checks, mission.review]) {
      pair(check.prompt, mission.id); pair(check.explanation, mission.id);
      assert.ok(check.answers.length && check.answers.every((answer) => isCorrect(answer, check.answers)));
    }
    checkRefs(mission.sources, mission.id);
    const scene = enrichment.lessons.find((lesson) => lesson.missionId === mission.id);
    assert.ok(scene, mission.id);
    assert.ok(scene.dialogue.length >= 6 && scene.notes.length >= 3);
    [scene.frame, scene.speaking, scene.question.prompt, scene.question.explanation, ...scene.notes, ...scene.dialogue].forEach((value) => pair(value, mission.id));
    assert.ok(enrichment.resources.some((resource) => resource.id === scene.resource));
    const bank = enrichment.banks.find((bank) => bank.id === scene.bank);
    assert.equal(bank.words.length, 8);
    assert.equal(bank.missionId, mission.id);
    checkRefs(bank.sourceRefs, bank.id);
    for (const word of bank.words) { pair(word.term, word.id); pair(word.example, word.id); }
    assert.ok(grammar.units.some((unit) => unit.missionIds.includes(mission.id)), `${mission.id}: existing grammar route`);
  }
  assert.equal(enrichment.banks.flatMap((bank) => bank.words).length, 328);
});

test("auxiliary and reflexive retrieval accepts justified gender variants without accepting missing or wrong words", () => {
  const journey = missions.find((mission) => mission.id === "week3-journey-auxiliaries");
  assert.ok(isCorrect("ha", journey.checks[0].answers));
  assert.ok(!isCorrect("è", journey.checks[0].answers));
  assert.ok(isCorrect("arrivata", journey.checks[1].answers));
  assert.ok(!isCorrect("arrivato", journey.checks[1].answers));
  const reflexive = missions.find((mission) => mission.id === "week3-reflexive-morning");
  assert.ok(isCorrect("si è svegliata", reflexive.checks[0].answers));
  assert.ok(!isCorrect("si e svegliata", reflexive.checks[0].answers));
  assert.ok(!isCorrect("è svegliata", reflexive.checks[0].answers));
  assert.ok(isCorrect("mi sono alzato", reflexive.checks[1].answers));
  assert.ok(isCorrect("mi sono alzata", reflexive.checks[1].answers));
  assert.ok(!isCorrect("mi ho alzato", reflexive.checks[1].answers));
  assert.ok(isCorrect("si è vestito", reflexive.review.answers));
  assert.ok(!isCorrect("si è vestita", reflexive.review.answers));
});

test("the verb catalogue has reviewed present forms, contextual auxiliaries, irregulars and reflexive pronouns", () => {
  assert.equal(booster.verbs.length, 50);
  assert.equal(new Set(booster.verbs.map((verb) => verb.id)).size, 50);
  const verbs = new Map(booster.verbs.map((verb) => [verb.infinitive, verb]));
  for (const verb of booster.verbs) {
    assert.equal(verb.present.length, 6, verb.id);
    assert.ok(verb.present.every((form) => typeof form === "string" && form.trim()), verb.id);
    assert.ok(["avere", "essere"].includes(verb.auxiliary), verb.id);
    assert.ok(["A1", "A2"].includes(verb.level), verb.id);
    assert.ok(unitIds.has(verb.unitId), verb.id);
    [verb.meaning, verb.pastContext, verb.note, verb.examples.present, verb.examples.past].forEach((value) => pair(value, verb.id));
    checkRefs(verb.sourceRefs, verb.id);
    if (verb.reflexive) {
      assert.equal(verb.auxiliary, "essere", verb.id);
      assert.deepEqual(verb.present.map((form) => form.split(" ")[0]), ["mi", "ti", "si", "ci", "vi", "si"]);
    }
  }
  assert.deepEqual(verbs.get("essere").present, ["sono", "sei", "è", "siamo", "siete", "sono"]);
  assert.deepEqual(verbs.get("dire").present, ["dico", "dici", "dice", "diciamo", "dite", "dicono"]);
  assert.deepEqual(verbs.get("capire").present, ["capisco", "capisci", "capisce", "capiamo", "capite", "capiscono"]);
  assert.deepEqual(verbs.get("scegliere").present, ["scelgo", "scegli", "sceglie", "scegliamo", "scegliete", "scelgono"]);
  assert.equal(verbs.get("rimanere").pastParticiple, "rimasto");
  assert.equal(verbs.get("dire").pastParticiple, "detto");
  assert.equal(verbs.get("bere").pastParticiple, "bevuto");
  for (const infinitive of ["camminare", "nuotare", "viaggiare", "dormire"]) assert.equal(verbs.get(infinitive).auxiliary, "avere");
  for (const infinitive of ["andare", "rimanere", "tornare", "lavarsi"]) assert.equal(verbs.get(infinitive).auxiliary, "essere");
  assert.equal(verbs.get("finire").auxiliary, "avere");
  assert.equal(verbs.get("finire").pastContext.it, "il lavoro");
  assert.deepEqual(verbs.get("vedere").pastParticiples, ["visto", "veduto"]);
});

test("curated nouns supply explicit gender and plurals, including spelling changes and ambiguous person nouns", () => {
  assert.equal(booster.nouns.length, 32);
  assert.equal(new Set(booster.nouns.map((noun) => noun.id)).size, 32);
  const nouns = new Map(booster.nouns.map((noun) => [noun.id, noun]));
  const wordIds = new Set(enrichment.banks.flatMap((bank) => bank.words.map((word) => word.id)));
  for (const noun of booster.nouns) {
    pair(noun.term, noun.id); pair(noun.example, noun.id);
    assert.ok(["m", "f"].includes(noun.gender));
    assert.match(noun.term.it, /^(?:il |lo |la |l[’'])/u);
    assert.match(noun.plural, noun.gender === "f" ? /^le /u : /^(?:i |gli )/u);
    if (noun.vocabularyWordId) assert.ok(wordIds.has(noun.vocabularyWordId), noun.id);
    checkRefs(noun.sourceRefs, noun.id);
  }
  assert.equal(nouns.get("noun:collega-f").plural, "le colleghe");
  assert.equal(nouns.get("noun:collega-m").plural, "i colleghi");
  assert.equal(nouns.get("noun:estetista-f").gender, "f");
  assert.equal(nouns.get("noun:valigia").plural, "le valigie");
  assert.equal(nouns.get("noun:camicia").plural, "le camicie");
  assert.equal(nouns.get("noun:giacca").plural, "le giacche");
  assert.equal(nouns.get("noun:zaino").plural, "gli zaini");
});

test("new mission work survives a progress round trip alongside earlier notes and still needs learner self-checks", () => {
  const allIds = curriculum.missions.map((mission) => mission.id);
  const priorId = curriculum.missions[0].id;
  let progress = emptyProgress();
  progress.drafts[priorId] = { ...emptyDraft(), output: "Un appunto precedente da conservare." };
  for (const mission of missions) {
    const draft = { ...emptyDraft(), step: 3, checked: [true, true], first: [true, true], output: mission.model.it, rubric: [false, false] };
    assert.equal(completeMission(progress, mission, draft, 2, "2026-10-28"), progress);
    progress = completeMission(progress, mission, { ...draft, rubric: [true, true] }, 2, "2026-10-28");
    assert.equal(progress.completed[mission.id].output, mission.model.it);
    assert.equal(progress.reviews[mission.id].due, "2026-10-29");
  }
  const restored = parseProgress(JSON.stringify(progress), allIds);
  assert.equal(restored.drafts[priorId].output, "Un appunto precedente da conservare.");
  for (const mission of missions) assert.equal(restored.completed[mission.id].output, mission.model.it);
});
