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
  assert.equal(missions.length, 67);
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
test("the two verified book sequences add ten original transfer missions each without inventing reader-page coverage", () => {
  const added = missions.filter((mission) => /^espresso[12]-u\d{2}-/.test(mission.id));
  assert.equal(added.length, 20);
  for (const book of [1, 2]) {
    const chapters = added.filter((mission) => mission.id.startsWith(`espresso${book}-`));
    assert.deepEqual(
      chapters.map((mission) => Number(mission.id.match(/-u(\d{2})-/)[1])),
      Array.from({ length: 10 }, (_, index) => index + 1),
    );
    for (const mission of chapters) {
      assert.equal(mission.course, book === 1 ? 1 : 3);
      assert.equal(new Set([...mission.checks, mission.review].map((check) => check.prompt.it)).size, 3);
      assert.equal(mission.words.length, 4);
      if (book === 1) {
        const chapter = Number(mission.id.match(/-u(\d{2})-/)[1]);
        assert.deepEqual(mission.sources.find((source) => source.id === "src-8fa57188c2eb"), { id: "src-8fa57188c2eb", pages: [chapter <= 5 ? 1 : 2] });
        assert.ok(mission.sources.some((source) => source.id === "src-1647be2784c9"));
      } else {
        assert.ok(mission.sources.some((source) => source.id === "src-070c40bad24b"));
        assert.ok(mission.sources.some((source) => source.id === "src-580f7558db56"));
      }
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

const enrichment = JSON.parse(
  readFileSync(
    new URL("../app/learning/enrichment.json", import.meta.url),
    "utf8",
  ),
);
const { emptySession, sessionMission, sessionDone, learningRewards } =
  await import("../app/learning/study.ts");
test("every stable mission has original guided material and a valid vocabulary bank and online task", () => {
  assert.equal(enrichment.lessons.length, missions.length);
  assert.deepEqual(
    enrichment.lessons.map((l) => l.missionId).sort(),
    [...ids].sort(),
  );
  assert.equal(enrichment.banks.length, 38);
  assert.equal(enrichment.banks.flatMap((b) => b.words).length, 304);
  const bilingual = (pair) => {
    assert.ok(pair.en.trim());
    assert.ok(pair.it.trim());
  };
  for (const b of enrichment.banks) {
    bilingual(b.title);
    assert.equal(b.words.length, 8);
    assert.equal(new Set(b.words.map((w) => w.term.it)).size, 8);
    b.words.forEach((w) => {
      bilingual(w.term);
      bilingual(w.example);
    });
  }
  for (const l of enrichment.lessons) {
    assert.ok(enrichment.banks.some((b) => b.id === l.bank));
    assert.ok(enrichment.resources.some((r) => r.id === l.resource));
    assert.ok(l.notes.length);
    assert.ok(l.dialogue.length >= 4);
    [
      ...l.notes,
      ...l.dialogue,
      l.frame,
      l.speaking,
      l.question.prompt,
      l.question.explanation,
    ].forEach(bilingual);
    assert.ok(l.question.answers.length);
    for (const a of l.question.answers)
      assert.ok(isCorrect(a, l.question.answers));
  }
  for (const r of enrichment.resources) {
    assert.equal(new URL(r.url).protocol, "https:");
    [r.level, r.kind, r.task, r.access].forEach(bilingual);
  }
});
test("30-minute sessions pin a topic across core completion, credit it once and retain notes in backups", () => {
  let p = emptyProgress();
  p.sessions = {
    [today]: {
      ...emptySession(ids[0]),
      warmup: "Ciao sono Ada",
      speaking: "Mi chiamo Ada. E tu?",
      exit: "Mi chiamo Ada.",
      recalled: ["survival:0"],
      done: ["warmup", "vocab", "input", "speak", "exit"],
    },
  };
  assert.equal(dailyMinutes(p, today), 25);
  p = completeMission(p, missions[0], doneDraft(), 2, today);
  assert.equal(dailyMinutes(p, today), 30);
  assert.equal(sessionMission(p, missions, today).id, ids[0]);
  assert.equal(sessionDone(p, today).length, 6);
  assert.equal(learningRewards(p).xp, 35);
  assert.equal(learningRewards(p).completeDays, 1);
  // An explicit core marker cannot double-count a newly completed lesson.
  p.sessions[today].done.push("core");
  assert.equal(dailyMinutes(p, today), 30);
  assert.equal(learningRewards(p).xp, 35);
  assert.deepEqual(parseProgress(JSON.stringify(p), ids), p);
  assert.equal(sessionMission(p, missions, "2026-10-19").id, ids[1]);
});
test("scheduled reviews fit inside the guided warm-up; core rehearsal works after all topics are completed", () => {
  let p = completeMission(
    emptyProgress(),
    missions[0],
    doneDraft(),
    2,
    "2026-10-17",
  );
  p = recordReview(p, ids[0], true, today);
  p.sessions = {
    [today]: {
      ...emptySession(ids[0]),
      done: ["warmup", "core", "vocab", "input", "speak", "exit"],
    },
  };
  assert.equal(dailyMinutes(p, today), 30);
  assert.equal(sessionDone(p, today).length, 6);
  assert.equal(learningRewards(p).xp, 38);
  p.completed = Object.fromEntries(
    missions.map((m) => [m.id, p.completed[ids[0]]]),
  );
  assert.ok(sessionMission(p, missions, "2026-10-19"));
});
test("30-minute planning proposes one new topic per day and at most two warm-up reviews", () => {
  const p = emptyProgress();
  p.plan = {
    minutes: 30,
    days: [1, 2, 3, 4, 5],
    start: "2026-10-19",
    course: 1,
  };
  const plan = schedule(p, missions, 7, "2026-10-19");
  assert.ok(
    plan
      .slice(0, 5)
      .every((d) => d.guided && d.items.length === 1 && d.budget === 30),
  );
  assert.equal(new Set(plan.flatMap((d) => d.items.map((m) => m.id))).size, 5);
  assert.ok(plan.slice(5).every((d) => !d.guided && !d.items.length));
  for (const m of missions.slice(0, 5)) {
    p.completed[m.id] = {
      date: today,
      firstCorrect: 2,
      total: 2,
      output: "Mi chiamo Ada",
      supported: true,
      confidence: 2,
    };
    p.reviews[m.id] = {
      due: today,
      interval: 1,
      attempts: 0,
      correct: 0,
      lastDate: "",
    };
  }
  assert.equal(schedule(p, missions, 1, "2026-10-19")[0].due.length, 2);
});
test("old version-1 backups load unchanged and malformed session records are rejected", () => {
  const old = {
    ...emptyProgress(),
    plan: { ...emptyProgress().plan, minutes: 10 },
  };
  assert.ok(!("sessions" in old));
  assert.deepEqual(parseProgress(JSON.stringify(old), ids), old);
  const session = emptySession(ids[0]);
  for (const sessions of [
    [],
    { tomorrow: session },
    { [today]: { ...session, missionId: "unknown" } },
    { [today]: { ...session, done: ["vocab", "vocab"] } },
    { [today]: { ...session, done: ["invented"] } },
    { [today]: { ...session, recalled: [false] } },
    { [today]: { ...session, speaking: "x".repeat(2001) } },
  ])
    assert.throws(() =>
      parseProgress(JSON.stringify({ ...old, sessions }), ids),
    );
});

test("the guided calendar retains the active topic and finished courses rotate rehearsals", () => {
  let p = completeMission(emptyProgress(), missions[0], doneDraft(), 2, today);
  p.plan.days = [0, 1, 2, 3, 4, 5, 6];
  p.plan.start = today;
  p.sessions = { [today]: { ...emptySession(ids[0]), done: ["warmup"] } };
  const days = schedule(p, missions, 2, today);
  assert.equal(days[0].items[0].id, ids[0]);
  assert.equal(days[1].items[0].id, ids[1]);
  const completion = p.completed[ids[0]];
  p.completed = Object.fromEntries(
    missions.filter((m) => m.course === 1).map((m) => [m.id, completion]),
  );
  p.sessions[today].done = [
    "warmup",
    "core",
    "vocab",
    "input",
    "speak",
    "exit",
  ];
  assert.equal(sessionMission(p, missions, "2026-10-19").id, ids[1]);
  assert.equal(learningRewards(p).completeDays, 1);
});

const { dailyStudyPlan, sessionActivities } = await import("../app/learning/study.ts");
const academyContent = JSON.parse(readFileSync(new URL("../app/learning/grammar.json", import.meta.url), "utf8"));
const companions = JSON.parse(readFileSync(new URL("../app/learning/companion.json", import.meta.url), "utf8"));
const { selectProgramme, getGrammarDraft, completeProgrammeDay } = await import("../app/learning/academy-engine.ts");
const dailyPlan = (p, date = today) => dailyStudyPlan(p, missions, academyContent.units, academyContent.programmes, companions.pages, date);

test("Today and its checklist follow the programme, advance to grammar and continue its next day", () => {
  let p = selectProgramme(emptyProgress(today), "supported-a1", today);
  const programme = academyContent.programmes.find((item) => item.id === "supported-a1");
  let plan = dailyPlan(p);
  assert.equal(plan.mission.id, programme.days[0].missionIds[0]);
  assert.equal(plan.next.route, "session");
  assert.deepEqual(plan.next.detail, plan.mission.title);
  p.sessions = { [today]: { ...emptySession(plan.mission.id, plan.duration), done: sessionActivities(plan.duration) } };
  p.completed[plan.mission.id] = { date: today, firstCorrect: 2, output: "Una frase di pratica." };
  plan = dailyPlan(p);
  assert.equal(plan.next.route, `grammar/${programme.days[0].unitIds[0]}`);
  for (const id of programme.days[0].unitIds) p.academy.grammar[id] = { ...getGrammarDraft(p, id), completed: today };
  plan = dailyPlan(p);
  assert.equal(plan.next, undefined);
  assert.equal(plan.dayReady, true);
  p = completeProgrammeDay(p, programme, 0, today);
  plan = dailyPlan(p, addDays(today, 1));
  assert.equal(plan.day, programme.days[1]);
  assert.equal(plan.mission.id, programme.days[1].missionIds[0]);
  assert.equal(plan.next.route, "session");
});

test("daily workshop routes remain unique when some intensive units are complete", () => {
  const p = selectProgramme(emptyProgress(today), "intensive-a1", today);
  p.plan.minutes = 60;
  const firstDay = academyContent.programmes.find((item) => item.id === "intensive-a1").days[0];
  const first = firstDay.unitIds[0];
  p.academy.grammar[first] = { ...getGrammarDraft(p, first), completed: today };
  const blocks = dailyPlan(p).blocks;
  assert.equal(new Set(blocks.map((block) => block.route)).size, blocks.length);
  assert.equal(blocks.filter((block) => block.route.startsWith("grammar/")).length, firstDay.unitIds.length);
});

test("saved session duration and completed resumed tense checks remain consistent in Today", () => {
  const p = emptyProgress(today);
  p.plan.minutes = 60;
  p.sessions = { [today]: { ...emptySession(ids[0]), duration: undefined } };
  assert.equal(dailyPlan(p).duration, 30);
  p.plan.minutes = 10;
  assert.equal(dailyPlan(p).duration, 30);
  assert.equal(dailyPlan(p).blocks[0].minutes, 10);
  p.plan.minutes = 60;
  p.academy = selectProgramme(emptyProgress(today), "supported-a1", today).academy;
  p.academy.programme = null;
  p.academy.assessments[`${addDays(today, -1)}:tense`] = {
    date: addDays(today, -1), completed: true, exerciseIds: ["sample"],
    answers: { sample: { answer: "sono", correct: true, date: today } },
  };
  assert.equal(dailyPlan(p).blocks.find((block) => block.route === "tense").completed, true);
});

test("five-minute programme sittings progress from application to grammar to finishing the day", () => {
  let p = selectProgramme(emptyProgress(today), "supported-a1", today);
  p.plan.minutes = 5;
  const programme = academyContent.programmes.find((item) => item.id === "supported-a1");
  const application = programme.days[0].missionIds[0];
  const unit = programme.days[0].unitIds[0];
  assert.equal(dailyPlan(p).next.route, "session");
  p.completed[application] = { date: today, firstCorrect: 2, output: "Una frase di pratica." };
  p.sessions = { [today]: { ...emptySession(application, 5), done: ["core"] } };
  assert.equal(dailyPlan(p).next, undefined, "the completed five-minute sitting stops for today");
  assert.equal(dailyPlan(p).dayReady, false);
  const tomorrow = addDays(today, 1);
  let plan = dailyPlan(p, tomorrow);
  assert.equal(plan.next.route, `grammar/${unit}`);
  assert.equal(plan.blocks.length, 1);
  assert.equal(plan.next.minutes, 5);
  p.academy.grammar[unit] = { ...getGrammarDraft(p, unit), completed: tomorrow };
  plan = dailyPlan(p, tomorrow);
  assert.equal(plan.next, undefined);
  assert.equal(plan.blocks[0].route, `grammar/${unit}`);
  assert.equal(plan.dayReady, true, "the completed required work unlocks Finish this study day");
  p = completeProgrammeDay(p, programme, 0, tomorrow);
  assert.equal(p.academy.programme.day, 1);
});

test("five-minute progression preserves paused sessions and stops after today's required work", () => {
  const p = selectProgramme(emptyProgress(today), "intensive-a1", today);
  p.plan.minutes = 5;
  const day = academyContent.programmes.find((item) => item.id === "intensive-a1").days[0];
  const application = day.missionIds[0];
  p.completed[application] = { date: addDays(today, -1), firstCorrect: 2, output: "Una frase di pratica." };
  p.sessions = { [today]: { ...emptySession(application, 5), done: [] } };
  assert.equal(dailyPlan(p).next.route, "session", "an unfinished saved session remains resumable");
  delete p.sessions[today];
  assert.equal(dailyPlan(p).next.route, `grammar/${day.unitIds[0]}`);
  p.academy.grammar[day.unitIds[0]] = { ...getGrammarDraft(p, day.unitIds[0]), completed: today };
  assert.equal(dailyPlan(p).next, undefined, "completing a grammar unit does not add another block today");
  assert.equal(dailyPlan(p, addDays(today, 1)).next.route, `grammar/${day.unitIds[1]}`);
  p.completed[application].date = today;
  assert.equal(dailyPlan(p).next, undefined, "a direct five-minute application also uses today's sitting");
});
