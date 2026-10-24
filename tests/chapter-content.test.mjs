import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyProgress, parseProgress } from "../app/learning/engine.ts";
import { answerArcade, emptyArcade, startArcadeRound } from "../app/learning/arcade-engine.ts";
import { arcadePool, wordArcadeItems } from "../app/learning/arcade-catalogue.ts";

const read = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const enrichment = read("../app/learning/enrichment.json");
const curriculum = read("../app/learning/curriculum.json");
const grammar = read("../app/learning/grammar.json");
const scenes = read("../app/learning/arcade-scenes.json").scenes;
const review = read("../docs/chapter-content-review.json");
const banks = enrichment.banks.filter((bank) => bank.missionId?.startsWith("espresso"));
const lessons = enrichment.lessons.filter((lesson) => lesson.missionId.startsWith("espresso"));
const chapterScenes = scenes.filter((scene) => scene.id.startsWith("espresso2-"));
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const lexical = (value) => value.normalize("NFC").toLocaleLowerCase("it").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const bilingual = (value, label) => {
  assert.ok(value?.en?.trim() && value?.it?.trim(), `${label}: complete EN/IT pair`);
  assert.notEqual(value.en, value.it, `${label}: English must be translated`);
};
const boundedSources = (refs, label) => {
  assert.ok(refs.length > 0, `${label}: source references`);
  for (const reference of refs) {
    const source = curriculum.sources.find((item) => item.id === reference.id);
    assert.ok(source, `${label}: known source ${reference.id}`);
    assert.ok(reference.pages.length);
    assert.equal(new Set(reference.pages).size, reference.pages.length);
    assert.ok(reference.pages.every((page) => Number.isInteger(page) && page >= 1 && page <= source.pages));
  }
};

test("chapter additions preserve every deployed bank, core enrichment and original conversation object", () => {
  const baseline = review.baselinePreservation;
  assert.equal(digest(enrichment.banks.slice(0, 18)), baseline.originalBanksSHA256);
  assert.equal(digest(enrichment.lessons.filter((lesson) => !lesson.missionId.startsWith("espresso"))), baseline.originalCoreEnrichmentsSHA256);
  assert.equal(digest(scenes.slice(0, 8)), baseline.originalScenesSHA256);
  const chapterTeaching = lessons.map((lesson) => Object.fromEntries(Object.entries(lesson)
    .filter(([key]) => !["bank", "skills"].includes(key))));
  assert.equal(digest(chapterTeaching), baseline.existingChapterTeachingSHA256);
  assert.equal(enrichment.banks.slice(0, 18).flatMap((bank) => bank.words).length, 144);
});

test("all twenty chapters have eight contextual cards with stable IDs and verified topic references", () => {
  assert.equal(banks.length, 20);
  assert.equal(enrichment.banks.length, 38);
  assert.equal(enrichment.banks.flatMap((bank) => bank.words).length, 304);
  assert.equal(new Set(enrichment.banks.flatMap((bank) => bank.words.map((word) => word.id))).size, 304);
  for (const bank of banks) {
    const book = bank.level === "A1" ? 1 : 2;
    assert.ok(Number.isInteger(bank.chapter) && bank.chapter >= 1 && bank.chapter <= 10);
    assert.equal(bank.id, `espresso${book}-u${String(bank.chapter).padStart(2, "0")}`);
    assert.equal(bank.bookId, `nuovo-espresso-plus-${book}`);
    const mission = curriculum.missions.find((item) => item.id === bank.missionId);
    assert.ok(mission && bank.missionId.startsWith(bank.id));
    assert.equal(lessons.find((lesson) => lesson.missionId === mission.id).bank, bank.id);
    assert.deepEqual(bank.sourceRefs, mission.sources);
    boundedSources(bank.sourceRefs, bank.id);
    bilingual(bank.title, bank.id);
    assert.equal(bank.words.length, 8);
    assert.equal(new Set(bank.words.map((word) => lexical(word.term.it))).size, 8);
    for (const [index, word] of bank.words.entries()) {
      assert.equal(word.id, `word:${bank.id}:${index}`);
      bilingual(word.term, word.id);
      bilingual(word.example, word.id);
      if (word.term.en.startsWith("the ")) {
        assert.match(word.term.it, /^(?:il |lo |la |l[’']|i |gli |le )/u, `${word.id}: learn nouns with an article`);
      }
    }
  }
});

test("chapter vocabulary becomes playable Arcade practice without changing its word IDs", () => {
  for (const bank of banks) {
    const items = wordArcadeItems(bank);
    assert.equal(items.length, 8);
    assert.deepEqual(items.map((item) => item.id), bank.words.map((word) => word.id));
    for (const item of items) {
      assert.equal(item.options.length, 4);
      assert.equal(new Set(item.options.map(lexical)).size, 4);
      assert.equal(item.options.filter((option) => option === item.answers[0]).length, 1);
    }
  }
});

test("every optional gist answer is witnessed by its existing dialogue and differs from the detail answer", () => {
  assert.equal(lessons.length, 20);
  for (const lesson of lessons) {
    assert.equal(lesson.dialogue.length, 4, `${lesson.missionId}: existing scene retained`);
    const question = lesson.skills.gist;
    bilingual(question.prompt, lesson.missionId);
    bilingual(question.explanation, lesson.missionId);
    assert.notEqual(question.prompt.it, lesson.question.prompt.it);
    const dialogue = ` ${lexical(lesson.dialogue.map((line) => line.it).join(" "))} `;
    assert.ok(question.answers.length > 0);
    for (const answer of question.answers) {
      assert.ok(dialogue.includes(` ${lexical(answer)} `), `${lesson.missionId}: gist must be answerable from supplied scene`);
      assert.ok(!lesson.question.answers.some((detail) => lexical(detail) === lexical(answer)), `${lesson.missionId}: gist adds a different target`);
    }
  }
});

test("chapter retelling models satisfy changed-detail constraints and provide two bilingual self-checks", () => {
  const changes = [
    ["Neri", "N-E-R-I"], ["Sara", "Svizzera", "tedesco"], ["tre", "venerdì", "otto", "Olmi"],
    ["ballare", "nuotare", "venerdì", "sei"], ["due", "quattro", "giugno", "ascensore"],
    ["sabato", "cinque", "tre"], ["farmacia", "chiusa", "cinema", "sei"], ["mercoledì", "cinema", "niente"],
    ["ne compro sei", "ne prendo un chilo"], ["sorella", "otto", "fratelli", "fiori"],
    ["Paolo", "gli piace", "verde", "meno cara"], ["cortile", "albero", "pomeriggio"],
    ["bozza", "domani", "nove"], ["museo", "le ho già prenotate", "otto"], ["tram", "ombrello", "dieci"],
    ["spegni il telefono", "lascialo", "non portare il quaderno"], ["Serra", "undici", "sinistra"],
    ["dicembre", "fotografia", "se ho tempo", "candidatura"], ["inviare", "computer", "spento", "ho dovuto telefonare"],
    ["studio", "sia luminoso", "abbia una finestra", "secondo me è"],
  ];
  for (const [index, lesson] of lessons.entries()) {
    const task = lesson.skills.retell;
    [task.prompt, task.frame, task.model, ...task.rubric].forEach((value) => bilingual(value, lesson.missionId));
    assert.equal(task.rubric.length, 2);
    assert.notEqual(task.rubric[0].it, task.rubric[1].it);
    for (const witness of changes[index]) {
      assert.ok(lexical(task.model.it).includes(lexical(witness)), `${lesson.missionId}: model must honour ${witness}`);
    }
  }
});

test("ten new A2 scenes use chapter-appropriate grammar and bounded, unambiguous authored choices", () => {
  assert.equal(scenes.length, 18);
  assert.equal(scenes.flatMap((scene) => scene.turns).length, 54);
  assert.equal(chapterScenes.length, 10);
  assert.equal(new Set(scenes.flatMap((scene) => scene.turns.map((turn) => turn.id))).size, 54);
  for (const scene of chapterScenes) {
    assert.equal(scene.id, `espresso2-u${String(scene.chapter).padStart(2, "0")}`);
    assert.equal(scene.level, "A2");
    assert.equal(scene.bookId, "nuovo-espresso-plus-2");
    bilingual(scene.title, scene.id);
    bilingual(scene.intro, scene.id);
    boundedSources(scene.sourceRefs, scene.id);
    assert.equal(scene.turns.length, 3);
    for (const turn of scene.turns) {
      const unit = grammar.units.find((item) => item.id === turn.unitId);
      assert.ok(unit && unit.level === "A2", `${turn.id}: actual A2 unit`);
      assert.ok(scene.unitIds.includes(unit.id));
      assert.ok(unit.missionIds.includes(scene.missionId), `${turn.id}: grammar belongs to this book chapter`);
      [turn.prompt, turn.hint, turn.explanation].forEach((value) => bilingual(value, turn.id));
      assert.equal(turn.options.length, 3);
      assert.equal(new Set(turn.options.map(lexical)).size, 3);
      assert.equal(turn.options.filter((option) => option === turn.answer).length, 1);
    }
  }
});

test("A2 chapter conversation rounds retain authored order and first answers through version-one backups", () => {
  for (const scene of chapterScenes) {
    const arcade = emptyArcade();
    arcade.settings = { ...arcade.settings, mode: "conversation", scene: scene.id };
    const pool = arcadePool(arcade.settings);
    assert.equal(pool.length, 3);
    let progress = startArcadeRound({ ...emptyProgress(), arcade }, pool, "2026-10-24", `chapter-${scene.id}`);
    assert.deepEqual(progress.arcade.active.itemIds, scene.turns.map((turn) => `scene:${scene.id}:${turn.id}`));
    progress = answerArcade(progress, pool[0], pool[0].answers[0], "2026-10-24");
    const restored = parseProgress(JSON.stringify(progress), curriculum.missions.map((mission) => mission.id));
    assert.deepEqual(restored.arcade.active, progress.arcade.active);
    assert.equal(restored.arcade.records[pool[0].id].first.correct, true);
  }
});
