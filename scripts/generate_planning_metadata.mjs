/** Reproducible public catalogue projection. Reads authored app JSON only. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pick = (item, keys) => Object.fromEntries(keys.map((key) => [key, item[key]]));

export function generatePlanningMetadata({ curriculum, grammar, companion, enrichment, scenes, booster = { verbs: [], nouns: [] } }) {
  const firstPractice = new Set();
  const coveredUnits = new Set();
  for (const page of companion.pages) {
    if (page.kind !== "practice") continue;
    for (const id of page.unitIds) {
      if (!coveredUnits.has(id)) {
        coveredUnits.add(id);
        firstPractice.add(page.id);
      }
    }
  }
  return {
    schemaVersion: 1,
    sources: [...new Map([...curriculum.sources, ...companion.sources].map((source) => [source.id, source])).values()],
    missions: curriculum.missions.map((mission) => pick(mission, ["id", "course", "title", "goal"])),
    units: grammar.units.map((unit) => ({
      ...pick(unit, ["id", "title", "level", "missionIds", "prerequisites", "sources"]),
      exercises: unit.exercises.map((exercise) => pick(exercise, ["id", "kind"])),
    })),
    programmes: grammar.programmes.map((programme) => ({
      ...pick(programme, ["id", "title", "summary"]),
      days: programme.days.map((day) => ({
        ...pick(day, ["title", "outcome", "unitIds", "missionIds"]),
        ...(day.practice ? { practice: true } : {}),
      })),
    })),
    pages: companion.pages.filter((page) => firstPractice.has(page.id))
      .map((page) => pick(page, ["id", "sourceId", "page", "kind", "unitIds", "focus"])),
    scenes: scenes.scenes.map((scene) => ({
      ...pick(scene, ["id", "title"]),
      turns: scene.turns.map((turn) => pick(turn, ["id", "unitId"])),
    })),
    banks: enrichment.banks.map((bank) => ({
      ...pick(bank, ["id", "title"]),
      words: bank.words.map((word) => pick(word, ["id", "term"])),
    })),
    grammarWords: grammar.units.flatMap((unit) => unit.words),
    booster: {
      verbs: booster.verbs.map((verb) => pick(verb, ["id", "infinitive", "meaning", "unitId"])),
      nouns: booster.nouns.map((noun) => pick(noun, ["id", "term"])),
    },
  };
}

export function generatedPlanningJSON() {
  const read = (name) => JSON.parse(readFileSync(path.join(root, "app", "learning", `${name}.json`), "utf8"));
  return `${JSON.stringify(generatePlanningMetadata({
    curriculum: read("curriculum"), grammar: read("grammar"), companion: read("companion"),
    enrichment: read("enrichment"), scenes: read("arcade-scenes"), booster: read("booster-content"),
  }))}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = path.join(root, "app", "learning", "planning-metadata.json");
  const expected = generatedPlanningJSON();
  if (process.argv.includes("--check")) {
    if (readFileSync(destination, "utf8") !== expected) {
      throw new Error("Planning metadata is stale. Run node scripts/generate_planning_metadata.mjs.");
    }
    process.stdout.write("Planning metadata matches the authored catalogues.\n");
  } else {
    writeFileSync(destination, expected);
    process.stdout.write(`Generated planning metadata (${Buffer.byteLength(expected)} bytes).\n`);
  }
}
