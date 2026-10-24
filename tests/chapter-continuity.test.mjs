import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chapterContext, legacyChapterBanks, sessionVocabularyBank, chapterConversationComplete } from "../app/learning/chapter-context.ts";
import { dailyStudyPlan, emptySession, learningRewards } from "../app/learning/study.ts";
import { emptyProgress, parseProgress, dailyMinutes } from "../app/learning/engine.ts";
import { emptyArcade } from "../app/learning/arcade-engine.ts";
import { selectProgramme } from "../app/learning/academy-engine.ts";
const read = (name) => JSON.parse(readFileSync(new URL(`../app/learning/${name}.json`, import.meta.url), "utf8"));
const { missions } = read("curriculum"), { units } = read("grammar");
const ids = missions.map((mission) => mission.id), today = "2026-10-24";
const a1 = missions.find((mission) => mission.id.startsWith("espresso1-u01-"));
const a2 = missions.find((mission) => mission.id.startsWith("espresso2-u01-"));

test("chapter context identifies the two editions and rejects out-of-range chapter IDs", () => {
  assert.deepEqual(chapterContext(a2.id), { bankId: "espresso2-u01", book: 2, chapter: 1, level: "A2", sceneId: "espresso2-u01" });
  assert.equal(chapterContext(a1.id).level, "A1");
  for (const id of ["espresso2-u11-example", "espresso3-u01-example", "espresso1-u00-example", missions[0].id]) assert.equal(chapterContext(id), undefined);
});

test("new sessions pin chapter cards while old started sessions retain all20 original bank mappings", () => {
  assert.equal(emptySession(a2.id).bankId, "espresso2-u01");
  const bankIds = new Set(read("enrichment").banks.map((bank) => bank.id));
  assert.equal(Object.keys(legacyChapterBanks).length, 20);
  for (const [missionId, legacy] of Object.entries(legacyChapterBanks)) {
    const old = { ...emptySession(missionId), recalled: [`${legacy}:0`, `${legacy}:2`] };
    delete old.bankId;
    const before = structuredClone(old);
    assert.ok(bankIds.has(legacy));
    assert.equal(sessionVocabularyBank(old, missionId, chapterContext(missionId).bankId), legacy);
    assert.deepEqual(old, before);
    assert.equal(sessionVocabularyBank(undefined, missionId, chapterContext(missionId).bankId), chapterContext(missionId).bankId);
    assert.equal(sessionVocabularyBank({ ...old, bankId: legacy }, missionId, "different-bank"), legacy);
  }
});

test("optional chapter drafts and self-checks survive backups without creating extra credit", () => {
  const p = emptyProgress();
  p.sessions = { [today]: { ...emptySession(a2.id), warmup: "Ricordo un negozio.", done: ["warmup"] } };
  const minutes = dailyMinutes(p, today), xp = learningRewards(p).xp;
  Object.assign(p.sessions[today], { gistAnswer: "un regalo", retell: "Per mia sorella sceglierei una sciarpa diversa.", retellChecks: [true, false] });
  const restored = parseProgress(JSON.stringify(p), ids);
  assert.deepEqual(restored.sessions[today], p.sessions[today]);
  assert.equal(dailyMinutes(restored, today), minutes);
  assert.equal(learningRewards(restored).xp, xp);
});

test("backup boundary rejects malformed or unbounded optional chapter state", () => {
  for (const patch of [{ bankId: "https://example.test/file" }, { bankId: "x".repeat(101) }, { gistAnswer: "x".repeat(2001) }, { retell: 42 }, { retellChecks: [true, "yes"] }, { retellChecks: Array(6).fill(true) }]) {
    const p = emptyProgress(); p.sessions = { [today]: { ...emptySession(a2.id), ...patch } };
    assert.throws(() => parseProgress(JSON.stringify(p), ids), /session/);
  }
});

test("all seven time budgets stay bounded; A2 extension uses its chapter conversation", () => {
  for (const mission of [a1, a2]) {
    const programme = { id: "chapter-routing-fixture", title: mission.title, summary: mission.goal, days: [{ title: mission.title, unitIds: [], missionIds: [mission.id], outcome: mission.goal }] };
    for (const minutes of [5, 10, 15, 20, 30, 45, 60]) {
      const p = selectProgramme(emptyProgress(), programme.id, today); p.plan.minutes = minutes;
      const plan = dailyStudyPlan(p, missions, units, [programme], [], today);
      assert.equal(plan.mission.id, mission.id);
      assert.ok(plan.blocks.reduce((sum, block) => sum + block.minutes, 0) <= minutes);
      if (minutes === 60) assert.ok(plan.blocks.some((block) => block.route === (mission === a2 ? "games/espresso2-u01" : "tense")));
    }
  }
});

test("a chapter conversation needs all three actual turns today; unrelated records cannot finish it", () => {
  const scene = read("arcade-scenes").scenes.find((item) => item.id === "espresso2-u01");
  assert.ok(scene, "the new chapter conversation is present");
  const p = emptyProgress(); p.arcade = emptyArcade();
  const answer = { answer: "example", correct: true, assisted: false };
  const memory = { first: answer, last: answer, date: today, due: "2026-10-25", successes: 1 };
  for (const id of ["invented1", "invented2", "invented3"]) p.arcade.records[`scene:${scene.id}:${id}`] = memory;
  assert.equal(chapterConversationComplete(p, scene.id, today), false);
  for (const turn of scene.turns.slice(0, 2)) p.arcade.records[`scene:${scene.id}:${turn.id}`] = memory;
  assert.equal(chapterConversationComplete(p, scene.id, today), false);
  p.arcade.records[`scene:${scene.id}:${scene.turns[2].id}`] = { ...memory, date: "2026-10-23" };
  assert.equal(chapterConversationComplete(p, scene.id, today), false);
  p.arcade.records[`scene:${scene.id}:${scene.turns[2].id}`] = memory;
  assert.equal(chapterConversationComplete(p, scene.id, today), true);
});
