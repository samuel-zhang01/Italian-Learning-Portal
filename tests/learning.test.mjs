import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addDays,
  completeMission,
  dailyMinutes,
  dueReviews,
  emptyDraft,
  emptyProgress,
  isCorrect,
  nextMission,
  parseProgress,
  recordReview,
  schedule,
} from "../app/learning/engine.ts";
const { missions, sources } = JSON.parse(
  readFileSync(
    new URL("../app/learning/curriculum.json", import.meta.url),
    "utf8",
  ),
);
const ids = missions.map((m) => m.id);
const today = "2026-10-18";
const doneDraft = () => ({
  ...emptyDraft(),
  step: 3,
  answers: ["chiamo", "ti"],
  checked: [true, true],
  first: [false, true],
  output: "Mi chiamo Ada. Sono studentessa.",
  rubric: [true, true],
  modelSeen: false,
});
test("all lessons have bilingual teaching, distinct retrieval and exact source pages", () => {
  assert.equal(new Set(ids).size, missions.length);
  assert.equal(missions.length, 36);
  const bilingual = (x) => {
    if (Array.isArray(x)) x.forEach(bilingual);
    else if (x && typeof x === "object") {
      if ("en" in x || "it" in x) {
        assert.equal(typeof x.en, "string");
        assert.equal(typeof x.it, "string");
        assert.ok(x.en.trim() && x.it.trim());
      }
      Object.values(x).forEach(bilingual);
    }
  };
  bilingual(missions);
  for (const m of missions) {
    assert.equal(m.checks.length, 2);
    assert.equal(m.rubric.length, 2);
    assert.ok(m.examples.length >= 2);
    assert.ok(m.sources.length);
    for (const ref of m.sources) {
      const s = sources.find((s) => s.id === ref.id);
      assert.ok(s);
      assert.ok(
        ref.pages.every((p) => Number.isInteger(p) && p > 0 && p <= s.pages),
      );
    }
    for (const q of [...m.checks, m.review]) {
      assert.ok(q.answers.length);
      assert.ok(q.answers.every((a) => isCorrect(a, q.answers)));
    }
  }
});
test("Italian answer matching tolerates punctuation and curly apostrophes but preserves accents", () => {
  assert.ok(isCorrect("  C’È.  ", ["c'è"]));
  assert.ok(isCorrect("LE   CASE!", ["le case"]));
  assert.ok(!isCorrect("e", ["è"]));
  assert.ok(!isCorrect("perche", ["perché"]));
  assert.ok(isCorrect("perche\u0301", ["perché"]));
});
test("completion requires recall and self-checked production, keeps first-attempt evidence and prevents farming", () => {
  let p = emptyProgress();
  const m = missions[0];
  assert.deepEqual(completeMission(p, m, emptyDraft(), 2, today), p);
  p = completeMission(p, m, doneDraft(), 2, today);
  assert.equal(p.completed[m.id].firstCorrect, 1);
  assert.equal(p.completed[m.id].total, 2);
  assert.equal(dailyMinutes(p, today), 5);
  assert.equal(p.reviews[m.id].due, "2026-10-19");
  assert.deepEqual(
    completeMission(p, m, { ...doneDraft(), first: [true, true] }, 3, today),
    p,
  );
  assert.equal(nextMission(p, missions).id, missions[1].id);
});
test("reviews space successful recall, bring errors back tomorrow and award credit once per date", () => {
  let p = completeMission(emptyProgress(), missions[0], doneDraft(), 2, today);
  assert.equal(dueReviews(p, today).length, 0);
  assert.equal(dueReviews(p, "2026-10-19").length, 1);
  p = recordReview(p, ids[0], true, "2026-10-19");
  assert.equal(p.reviews[ids[0]].due, "2026-10-22");
  assert.equal(dailyMinutes(p, "2026-10-19"), 2);
  assert.deepEqual(recordReview(p, ids[0], false, "2026-10-19"), p);
  p = recordReview(p, ids[0], true, "2026-10-22");
  assert.equal(p.reviews[ids[0]].interval, 7);
  p = recordReview(p, ids[0], false, "2026-10-29");
  assert.equal(p.reviews[ids[0]].due, "2026-10-30");
  assert.equal(p.reviews[ids[0]].interval, 1);
});
test("planning respects chosen days, start date, completed lessons and review allowance", () => {
  let p = emptyProgress();
  p.plan = { minutes: 10, days: [1, 3, 5], start: "2026-10-19", course: 1 };
  const dates = schedule(p, missions, 7, today);
  assert.equal(dates[0].active, false);
  assert.equal(dates[1].items.length, 2);
  assert.equal(dates[2].items.length, 0);
  assert.equal(new Set(dates.flatMap((d) => d.items.map((m) => m.id))).size, 6);
  p = completeMission(p, missions[0], doneDraft(), 2, today);
  const plan = schedule(p, missions, 2, today);
  assert.equal(plan[1].items.length, 1);
  assert.equal(plan[1].items[0].id, missions[1].id);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
});
test("backup validation protects current progress from malformed data", () => {
  const p = completeMission(
    emptyProgress(),
    missions[0],
    doneDraft(),
    2,
    today,
  );
  p.drafts[ids[0]] = doneDraft();
  assert.deepEqual(parseProgress(JSON.stringify(p), ids), p);
  for (const bad of [
    { ...p, version: 2 },
    { ...p, plan: { ...p.plan, days: [] } },
    { ...p, plan: { ...p.plan, minutes: "10" } },
    { ...p, plan: { ...p.plan, start: "2026-02-31" } },
    { ...p, drafts: { [ids[0]]: { ...doneDraft(), checked: [] } } },
    { ...p, reviews: { [ids[0]]: { due: "tomorrow" } } },
  ])
    assert.throws(() => parseProgress(JSON.stringify(bad), ids));
  assert.throws(() => parseProgress("not json", ids));
  assert.throws(() => parseProgress("x".repeat(2_000_001), ids));
});

test("overdue reviews roll past rest days and used minutes are removed from today’s plan", () => {
  let p = completeMission(
    emptyProgress(),
    missions[0],
    doneDraft(),
    2,
    "2026-10-16",
  );
  p.plan = { minutes: 10, days: [1, 3, 5], start: "2026-10-01", course: 1 };
  const days = schedule(p, missions, 4, "2026-10-18");
  assert.deepEqual(days[0].due, []);
  assert.deepEqual(days[1].due, [ids[0]]);
  assert.deepEqual(days[2].due, []);
  assert.deepEqual(days[3].due, []);
  p = completeMission(p, missions[1], doneDraft(), 2, "2026-10-19");
  const remaining = schedule(p, missions, 1, "2026-10-19")[0];
  assert.equal(remaining.due.length, 1);
  assert.equal(remaining.items.length, 0);
  assert.ok(remaining.due.length * 2 + remaining.items.length * 5 <= 5);
});
