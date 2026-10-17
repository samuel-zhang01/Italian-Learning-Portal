import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("ships a database-backed A1 curriculum", async () => {
  const [seedText, schema, contentRoute, page, plan, types] = await Promise.all([
    read("db/content-seed.json"), read("db/schema.ts"), read("app/api/content/route.ts"), read("app/page.tsx"), read("app/study-plan.ts"), read("app/portal-types.ts"),
  ]);
  const seed = JSON.parse(seedText);
  const kinds = new Set(seed.map(row => row.kind));
  assert.equal(seed.filter(row => row.kind === "lesson").length, 28);
  assert.ok(seed.filter(row => row.kind === "exercise").length >= 210);
  assert.ok(seed.filter(row => row.kind === "vocab").length >= 350);
  assert.ok(seed.filter(row => row.kind === "reading").length >= 20);
  assert.ok(seed.filter(row => row.kind === "preposition").length >= 40);
  assert.ok(seed.filter(row => row.kind === "verb").length >= 30);
  assert.ok(seed.filter(row => row.kind === "vocab").every(row => row.payload.exampleEn));
  assert.ok(seed.filter(row => row.kind === "preposition").every(row => row.payload.fullEn && row.payload.hintEn));
  assert.ok(seed.filter(row => row.kind === "lesson").every(row => row.payload.canDoIt));
  assert.ok(seed.filter(row => row.kind === "lesson").every(row => row.payload.summaryIt && row.payload.summaryEn));
  assert.ok(seed.filter(row => row.kind === "lesson").every(row => row.payload.grammarRuleIds.length >= 2 && row.payload.remember.length >= 2 && row.payload.writeDown.length === 3 && row.payload.mistakes.length === 2));
  assert.ok(seed.filter(row => row.kind === "grammar_rule").length >= 24);
  assert.ok(seed.filter(row => row.kind === "verb").length >= 15);
  assert.ok(seed.filter(row => row.kind === "roadmap").every(row => row.payload.titleIt && row.payload.goalIt));
  assert.ok(seed.filter(row => row.kind === "skill").every(row => row.payload.targetIt));
  for (const kind of ["lesson","reading","grammar","grammar_rule","exercise","roadmap","skill","vocab","preposition","verb"]) assert.ok(kinds.has(kind));
  assert.match(schema, /content_items/);
  assert.match(schema, /practice_events/);
  assert.match(schema, /submissions/);
  assert.match(contentRoute, /from\(contentItems\)/);
  assert.match(page, /fetch\("\/api\/content"\)/);
  assert.equal(plan.match(/\bd\(\{ title:/g)?.length, 56);
  assert.match(plan, /Nuovo Espresso 1/);
  assert.match(plan, /Test 4 pp\. 204–205/);
  assert.match(types, /planDays:Record<string,PlanDayProgress>/);
  assert.match(types, /cefrEvidence:Record<string,CefrEvidence>/);
  assert.doesNotMatch(page, /from "\.\/lesson-data"|from "\.\/practice-data"|from "\.\/curriculum-data"/);
});

test("includes adaptive practice, durable analytics and open-text evaluation", async () => {
  const [page, evaluate, progress, migration] = await Promise.all([
    read("app/page.tsx"), read("app/api/evaluate/route.ts"), read("app/api/progress/route.ts"), read("drizzle/0000_unknown_jack_flag.sql"),
  ]);
  assert.match(page, /function PracticeLab/);
  assert.match(page, /function SpeakingBox/);
  assert.match(page, /MediaRecorder/);
  assert.match(page, /speechSynthesis/);
  assert.match(page, /function Analytics/);
  assert.match(page, /function CefrTracker/);
  assert.match(page, /GIORNO \{current\.day\} DI 56/);
  assert.match(page, /Da misurare/);
  assert.match(page, /function GamesHub/);
  assert.match(page, /function MatchGame/);
  assert.match(page, /function VerbGame/);
  assert.match(page, /function IntruderGame/);
  assert.match(page, /function CurriculumCoverage/);
  assert.match(page, /Choose the most natural and grammatically correct option/);
  assert.match(page, /Translations are visible/);
  assert.match(evaluate, /responses/);
  assert.match(evaluate, /gpt-5\.6-luna/);
  assert.match(evaluate, /rubric/);
  assert.match(progress, /practiceEvents/);
  assert.match(migration, /INSERT OR REPLACE INTO content_items/);
});

test("keeps local study free by default and ships the bilingual guided tour", async () => {
  const [page, evaluate, progress, plan, types, launcher, pkg, styles] = await Promise.all([
    read("app/page.tsx"), read("app/api/evaluate/route.ts"), read("app/api/progress/route.ts"), read("app/study-plan.ts"), read("app/portal-types.ts"), read("start.sh"), read("package.json"), read("app/globals.css"),
  ]);
  assert.match(page, /function GuidedTour/);
  assert.match(page, /data-tour="plan"/);
  assert.match(page, /data-tour="progress"/);
  assert.match(page, /PARLIAMO|Local review/);
  assert.match(evaluate, /paidAiEnabled && apiKey/);
  assert.match(progress, /revision_conflict/);
  assert.match(progress, /learner_state\.revision = \?/);
  assert.match(page, /persistQueue/);
  assert.match(page, /parliamo-offline-dirty/);
  assert.match(page, /workedOn/);
  assert.equal(plan.match(/scored:true/g)?.length, 4);
  assert.match(types, /workedOn\?:string/);
  assert.match(launcher, /unset OPENAI_API_KEY/);
  assert.match(launcher, /PARLIAMO_ENABLE_PAID_AI=false/);
  assert.match(launcher, /\.backup/);
  assert.match(launcher, /integrity_check/);
  assert.match(launcher, /metadata\.sqlite/);
  assert.match(pkg, /"local"/);
  assert.match(styles, /\.tour-card/);
  assert.match(styles, /@media\(max-width:620px\)/);
  assert.match(styles, /\.app-shell>footer/);
});
