import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDiscoveryIndex, grammarSearchText, normaliseSearch, preferredGrammarUnitId, searchDiscovery } from "../app/learning/discovery-index.ts";
import { catalogueParams, catalogueRoute } from "../app/learning/navigation.ts";
const read = (name) => JSON.parse(readFileSync(new URL(`../app/learning/${name}.json`, import.meta.url), "utf8"));
const grammar = read("grammar"), curriculum = read("curriculum"), companion = read("companion"), enrichment = read("enrichment");
const data = { ...grammar, missions: curriculum.missions, ...companion, banks: enrichment.banks,
  bankMissions: Object.fromEntries(enrichment.banks.map((bank) => [bank.id, enrichment.lessons.filter((lesson) => lesson.bank === bank.id).map((lesson) => lesson.missionId)])) };
const index = buildDiscoveryIndex(data);

test("discovery finds formal Italian and English grammar topics across material types", () => {
  for (const query of ["imperfetto", "imperfect"]) {
    const matches = searchDiscovery(index, query);
    assert.ok(matches.some((entry) => entry.kind === "grammar" && entry.id === "a2-imperfetto"));
    assert.ok(matches.some((entry) => entry.kind === "lesson" && entry.id === "espresso2-u02-remember-a-place"));
  }
  assert.ok(grammarSearchText(grammar.units.find((unit) => unit.id === "a2-imperfetto")).includes("imperfetto"));
});

test("physical page queries find the actual Plus1 page, with bounded verified citations", () => {
  for (const query of ["Plus1 135", "Plus 1 135"]) {
    const matches = searchDiscovery(index, query);
    assert.equal(matches[0].id, "src-1647be2784c9-p135");
    assert.equal(matches[0].route, "companion/src-1647be2784c9-p135");
  }
  const sourceById = new Map(companion.sources.map((source) => [source.id, source]));
  for (const entry of index) for (const ref of entry.sources) {
    assert.ok(sourceById.has(ref.id));
    assert.ok(ref.pages.every((page) => Number.isInteger(page) && page > 0 && page <= sourceById.get(ref.id).pages));
  }
});

test("vocabulary words find their bank in both languages without exposing practice answers", () => {
  for (const query of ["sciarpa", "scarf"]) {
    assert.ok(searchDiscovery(index, query, "vocabulary").some((entry) => entry.id === "espresso2-u01"));
  }
  for (const id of ["a2-subjunctive-forms", "a2-subjunctive-opinions"]) {
    const unit = grammar.units.find((unit) => unit.id === id);
    assert.ok(unit, "Aliases must refer to actual authored units");
    assert.ok(grammarSearchText(unit).includes("subjunctive"));
    assert.ok(grammarSearchText(unit).includes("congiuntivo"));
  }
});

test("discovery filters material and level while retaining reference-page classification", () => {
  assert.ok(searchDiscovery(index, "imperfetto", "grammar", "A2").every((entry) => entry.kind === "grammar" && entry.level === "A2"));
  assert.ok(!searchDiscovery(index, "imperfetto", "grammar", "A1").some((entry) => entry.id === "a2-imperfetto"));
  const reference = companion.pages.find((page) => page.kind === "reference");
  assert.equal(index.find((entry) => entry.kind === "page" && entry.id === reference.id).pageKind, "reference");
  assert.ok(searchDiscovery(index, "", "vocabulary").every((entry) => entry.route.startsWith("vocabulary/")));
  assert.ok(searchDiscovery(index, "", "programme").every((entry) => entry.route === "programmes"));
  assert.ok(searchDiscovery(index, "Plus 2", "source", "A2").some((entry) => entry.id === "src-580f7558db56"));
});

test("discovery result projection omits source tasks, answer keys and production models", () => {
  const unit = structuredClone(grammar.units[0]);
  unit.exercises[0].answers = ["HIDDEN_EXERCISE_ANSWER_19835"];
  unit.production.model = { en: "HIDDEN_PRODUCTION_MODEL_19835", it: "HIDDEN_PRODUCTION_MODEL_19835" };
  const page = structuredClone(companion.pages[0]);
  page.model = { en: "HIDDEN_COMPANION_MODEL_19835", it: "HIDDEN_COMPANION_MODEL_19835" };
  page.task = { en: "HIDDEN_COMPANION_TASK_19835", it: "HIDDEN_COMPANION_TASK_19835" };
  const projected = JSON.stringify(buildDiscoveryIndex({ ...data, units: [unit], pages: [page] }));
  assert.doesNotMatch(projected, /HIDDEN_|hidden_/);
  assert.ok(index.every((entry) => !Object.hasOwn(entry, "answers") && !Object.hasOwn(entry, "model")));
});

test("catalogue URLs round-trip search and filters without changing IDs or grading", () => {
  const target = catalogueRoute("grammar/a2-imperfetto", { q: "città & passato", filter: "due" });
  const params = catalogueParams(`#${target}`);
  assert.equal(params.get("q"), "città & passato");
  assert.equal(params.get("filter"), "due");
  assert.equal(catalogueRoute("grammar", { q: "", filter: "all" }), "grammar");
  assert.equal(catalogueParams("#companion/src-1647be2784c9-p135?q=135").get("q"), "135");
  assert.equal(normaliseSearch("CITTÀ"), normaliseSearch("citta"));
  assert.equal(catalogueParams(`#${catalogueRoute("discover", { q: "x".repeat(400) })}`).get("q").length, 200);
});

test("grammar continuation prefers eligible active-programme units and preserves fallback", () => {
  const unit = (id, prerequisites = []) => ({ id, prerequisites });
  const units = [unit("global"), unit("needed"), unit("programme", ["needed"]), unit("later")];
  const programmes = [{ id: "selected", days: [{ unitIds: ["programme"] }, { unitIds: ["later"] }] }];
  const p = { academy: { grammar: { needed: { completed: "2026-10-24" } }, programme: { id: "selected", day: 0 } } };
  assert.equal(preferredGrammarUnitId(p, units, programmes), "programme");
  assert.equal(preferredGrammarUnitId({ academy: { ...p.academy, grammar: {} } }, units, programmes), "later");
  const blocked = [{ id: "selected", days: [{ unitIds: ["programme"] }] }];
  assert.equal(preferredGrammarUnitId({ academy: { ...p.academy, grammar: {} } }, units, blocked), "global");
  assert.equal(preferredGrammarUnitId({}, units, programmes), "global");
  assert.equal(preferredGrammarUnitId({}, [], []), undefined);
});
