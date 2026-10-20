import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  emptyProgress,
  dailyMinutes,
  parseProgress,
  schedule,
  isCorrect,
} from "../app/learning/engine.ts";
import {
  emptySession,
  sessionActivities,
  sessionLayout,
  dailyRecipe,
  sessionDone,
  sessionMission,
  learningRewards,
} from "../app/learning/study.ts";
import {
  emptyAcademy,
  getGrammarDraft,
  updateGrammarDraft,
  checkGrammarAnswer,
  completeGrammarUnit,
  grammarScore,
  grammarReviewQueue,
  academyXP,
  updateCompanionDraft,
  completeCompanion,
  selectProgramme,
  programmeDayReady,
  completeProgrammeDay,
  startAssessment,
  assessmentItems,
  assessmentKey,
  answerAssessment,
  saveWord,
  reviewWord,
  wordKey,
} from "../app/learning/academy-engine.ts";
const read = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../app/learning/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
const { units, programmes } = read("grammar");
const { sources, pages } = read("companion");
const { missions } = read("curriculum");
const ids = missions.map((m) => m.id),
  today = "2026-10-20";
const unit = units[0],
  exercise = unit.exercises[0];
const pair = (p) =>
  assert.ok(
    typeof p?.en === "string" &&
      p.en.trim() &&
      typeof p?.it === "string" &&
      p.it.trim(),
  );
const valid = (p) => parseProgress(JSON.stringify(p), ids);

test("grammar provides 28 substantial bilingual units, six exercise formats and bounded source references", () => {
  assert.equal(units.length, 28);
  assert.equal(new Set(units.map((u) => u.id)).size, units.length);
  const allIds = new Set(),
    kinds = new Set();
  for (const u of units) {
    assert.ok(["A1", "A1-plus"].includes(u.level));
    [
      u.title,
      u.summary,
      u.production.prompt,
      u.production.frame,
      u.production.model,
      ...u.teaching,
      ...u.examples,
      ...u.words,
      ...u.production.rubric,
    ].forEach(pair);
    assert.ok(
      u.teaching.length >= 4 &&
        u.examples.length >= 3 &&
        u.exercises.length >= 8 &&
        u.words.length >= 4,
    );
    assert.ok(
      u.prerequisites.every(
        (id) => id !== u.id && units.some((x) => x.id === id),
      ),
    );
    assert.ok(u.missionIds.every((id) => ids.includes(id)));
    for (const ref of u.sources) {
      const source = sources.find((s) => s.id === ref.id);
      assert.ok(source, `${u.id}: missing source ${ref.id}`);
      assert.ok(
        ref.pages.length &&
          ref.pages.every(
            (n) => Number.isInteger(n) && n > 0 && n <= source.pages,
          ),
      );
    }
    for (const e of u.exercises) {
      assert.ok(!allIds.has(e.id), e.id);
      allIds.add(e.id);
      kinds.add(e.kind);
      [e.prompt, e.hint, e.explanation].forEach(pair);
      assert.ok(
        e.answers.length > 0 &&
          e.answers.every((a) => a.trim() && a.length <= 500),
      );
      assert.equal(e.focus, u.id);
      assert.ok(e.answers.every((a) => isCorrect(a, e.answers)));
      if (e.kind === "choice")
        assert.ok(
          e.options.length >= 2 && e.answers.some((a) => e.options.includes(a)),
        );
      if (e.kind === "reorder") {
        assert.ok(e.tokens.length >= 2);
        const tokens = (s) =>
          s
            .toLocaleLowerCase()
            .replace(/[.!?,;:]/g, "")
            .split(/\s+/)
            .sort()
            .join("|");
        assert.ok(
          e.answers.some((a) => tokens(a) === tokens(e.tokens.join(" "))),
          e.id,
        );
      }
    }
  }
  assert.deepEqual(
    [...kinds].sort(),
    ["choice", "gap", "reorder", "correct", "transform", "tense"].sort(),
  );
  // Prerequisites must form an acyclic graph so the suggested progression is achievable.
  const visit = (id, path = []) => {
    assert.ok(!path.includes(id), `Cycle ${[...path, id]}`);
    units
      .find((u) => u.id === id)
      .prerequisites.forEach((p) => visit(p, [...path, id]));
  };
  units.forEach((u) => visit(u.id));
});

test("every source page has one explicit companion classification; original practice has support and valid grammar links", () => {
  assert.equal(sources.length, 48);
  assert.equal(
    pages.length,
    sources.reduce((n, s) => n + s.pages, 0),
  );
  assert.equal(pages.length, 936);
  assert.equal(new Set(pages.map((p) => p.id)).size, pages.length);
  for (const source of sources) {
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(
      pages
        .filter((p) => p.sourceId === source.id)
        .map((p) => p.page)
        .sort((a, b) => a - b),
      Array.from({ length: source.pages }, (_, i) => i + 1),
    );
  }
  for (const page of pages) {
    assert.ok(["practice", "reference", "needs-review"].includes(page.kind));
    [page.focus, page.task, page.model, ...page.checks].forEach(pair);
    assert.ok(
      page.unitIds.every((id) => units.some((u) => u.id === id)),
      page.id,
    );
    if (page.kind === "practice")
      assert.ok(page.checks.length >= 2 && page.unitIds.length);
  }
});

test("intensive, supported and repair programmes reference real lessons and cover prerequisites progressively", () => {
  assert.deepEqual(
    programmes.map((p) => p.days.length),
    [14, 28, 10],
  );
  for (const programme of programmes) {
    [programme.title, programme.summary].forEach(pair);
    for (const day of programme.days) {
      [day.title, day.outcome].forEach(pair);
      assert.ok(day.unitIds.length);
      assert.ok(day.unitIds.every((id) => units.some((u) => u.id === id)));
      assert.ok(day.missionIds.every((id) => ids.includes(id)));
    }
  }
  const intensive = new Set(
    programmes
      .find((p) => p.id === "intensive-a1")
      .days.flatMap((d) => d.unitIds),
  );
  assert.ok(
    units.filter((u) => u.level === "A1").every((u) => intensive.has(u.id)),
  );
});

test("grammar mistakes preserve first-try evidence, assistance and bounded attempt history without extra XP", () => {
  let p = emptyProgress();
  assert.strictEqual(
    checkGrammarAnswer(p, unit, exercise.id, "", { hintUsed: false, today }),
    p,
  );
  p = checkGrammarAnswer(p, unit, exercise.id, "wrong", {
    hintUsed: false,
    today,
  });
  const xp = academyXP(p);
  p = checkGrammarAnswer(p, unit, exercise.id, exercise.answers[0], {
    hintUsed: false,
    today,
  });
  assert.equal(grammarScore(p, unit).firstCorrect, 0);
  assert.equal(grammarScore(p, unit).solved, 1);
  assert.equal(
    getGrammarDraft(p, unit.id).attempts[exercise.id].at(-1).assisted,
    true,
  );
  assert.equal(academyXP(p), xp);
  assert.strictEqual(
    checkGrammarAnswer(p, unit, exercise.id, exercise.answers[0], {
      hintUsed: false,
      today,
    }),
    p,
  );
  for (let i = 0; i < 20; i++)
    p = checkGrammarAnswer(p, unit, exercise.id, `wrong ${i}`, {
      hintUsed: true,
      today,
    });
  assert.equal(getGrammarDraft(p, unit.id).attempts[exercise.id].length, 12);
  assert.equal(
    getGrammarDraft(p, unit.id).attempts[exercise.id][0].answer,
    "wrong",
  );
  assert.equal(dailyMinutes(p, today), 1);
  assert.deepEqual(valid(p), p);
});

test("a fresh blind recall can succeed independently after an earlier error and receives the longer interval", () => {
  let p = checkGrammarAnswer(emptyProgress(), unit, exercise.id, "wrong", {
    hintUsed: false,
    today,
  });
  assert.equal(grammarReviewQueue(p, units, today).length, 0);
  assert.equal(grammarReviewQueue(p, units, "2026-10-21").length, 1);
  p = checkGrammarAnswer(p, unit, exercise.id, exercise.answers[0], {
    hintUsed: false,
    today: "2026-10-21",
    independentRecall: true,
  });
  assert.equal(
    getGrammarDraft(p, unit.id).attempts[exercise.id].at(-1).assisted,
    false,
  );
  assert.equal(grammarReviewQueue(p, units, "2026-10-22").length, 0);
  assert.equal(grammarReviewQueue(p, units, "2026-10-24").length, 1);
  assert.equal(grammarScore(p, unit).firstCorrect, 0);
  p = checkGrammarAnswer(p, unit, exercise.id, "wrong again", {
    hintUsed: false,
    today: "2026-10-24",
    independentRecall: true,
  });
  p = checkGrammarAnswer(p, unit, exercise.id, exercise.answers[0], {
    hintUsed: false,
    today: "2026-10-24",
    independentRecall: true,
  });
  assert.equal(
    getGrammarDraft(p, unit.id).attempts[exercise.id].at(-1).assisted,
    true,
  );
});

test("grammar completion requires every exercise, personal production and every rubric check; repeated completion is idempotent", () => {
  let p = emptyProgress();
  assert.strictEqual(completeGrammarUnit(p, unit, today), p);
  for (const e of unit.exercises)
    p = checkGrammarAnswer(p, unit, e.id, e.answers[0], {
      hintUsed: false,
      today,
    });
  assert.strictEqual(completeGrammarUnit(p, unit, today), p);
  p = updateGrammarDraft(p, unit.id, {
    output: "Una frase personale.",
    rubric: unit.production.rubric.map((_, i) => i),
  });
  p = completeGrammarUnit(p, unit, today);
  assert.equal(getGrammarDraft(p, unit.id).completed, today);
  assert.strictEqual(completeGrammarUnit(p, unit, today), p);
  assert.equal(academyXP(p), unit.exercises.length * 2 + 15);
  assert.equal(dailyMinutes(p, today), 15);
  assert.deepEqual(valid(p), p);
});

test("companion notes and programme progression require real completion and survive backups", () => {
  const page = pages.find((p) => p.kind === "practice"),
    programme = programmes[0];
  let p = updateCompanionDraft(emptyProgress(), page.id, {
    answer: "Una frase originale.",
    selfChecked: false,
  });
  assert.strictEqual(completeCompanion(p, page.id, today), p);
  p = updateCompanionDraft(p, page.id, { selfChecked: true });
  p = completeCompanion(p, page.id, today);
  assert.equal(p.academy.companion[page.id].completed, today);
  assert.strictEqual(completeCompanion(p, page.id, today), p);
  p = selectProgramme(p, programme.id, today);
  assert.ok(!programmeDayReady(p, programme, 0));
  assert.strictEqual(completeProgrammeDay(p, programme, 0, today), p);
  for (const id of programme.days[0].unitIds)
    p = updateGrammarDraft(p, id, { completed: today });
  for (const id of programme.days[0].missionIds)
    p.completed[id] = {
      date: today,
      firstCorrect: 2,
      total: 2,
      output: "Una frase nuova.",
      supported: false,
      confidence: 2,
    };
  assert.ok(programmeDayReady(p, programme, 0));
  assert.strictEqual(completeProgrammeDay(p, programme, 1, today), p);
  p = completeProgrammeDay(p, programme, 0, today);
  assert.equal(p.academy.programme.day, 1);
  assert.strictEqual(completeProgrammeDay(p, programme, 0, today), p);
  assert.deepEqual(valid(p), p);
});

test("both diagnostics span real questions and retain immutable first answers over reload or repeat starts", () => {
  for (const mode of ["readiness", "tense"]) {
    const items = assessmentItems(units, today, mode);
    assert.equal(items.length, 12, mode);
    assert.equal(new Set(items.map((x) => x.exercise.id)).size, 12);
    if (mode === "readiness")
      assert.equal(new Set(items.map((x) => x.unit.id)).size, 12);
    let p = startAssessment(emptyProgress(), units, today, mode),
      key = `${today}:${mode}`;
    assert.strictEqual(startAssessment(p, units, today, mode), p);
    for (let i = 0; i < items.length; i++) {
      const e = items[i].exercise;
      p = answerAssessment(p, key, e, i === 0 ? "wrong" : e.answers[0]);
      assert.strictEqual(answerAssessment(p, key, e, e.answers[0]), p);
      p = valid(p);
    }
    assert.ok(p.academy.assessments[key].completed);
    assert.equal(
      Object.values(p.academy.assessments[key].answers).filter((a) => a.correct)
        .length,
      11,
    );
    assert.equal(dailyMinutes(p, today), 12);
    assert.equal(academyXP(p), 0);
  }
});

test("unfinished diagnostics resume across midnight, retain their question set and credit the day answered", () => {
  const yesterday = "2026-10-19";
  for (const mode of ["readiness", "tense"]) {
    const key = `${yesterday}:${mode}`;
    const items = assessmentItems(units, yesterday, mode);
    let p = startAssessment(emptyProgress(), units, yesterday, mode);
    p = answerAssessment(p, key, items[0].exercise, items[0].exercise.answers[0], yesterday);
    p = valid(p);
    assert.equal(assessmentKey(p, today, mode), key);
    const originalIds = [...p.academy.assessments[key].exerciseIds];
    p = answerAssessment(p, key, items[1].exercise, items[1].exercise.answers[0], today);
    assert.deepEqual(p.academy.assessments[key].exerciseIds, originalIds);
    assert.equal(dailyMinutes(p, yesterday), 1);
    assert.equal(dailyMinutes(p, today), 1);
    const paused = p.academy.assessments[key];
    p = startAssessment(p, units, today, mode);
    assert.equal(assessmentKey(p, today, mode), `${today}:${mode}`);
    assert.deepEqual(p.academy.assessments[key], paused);
    assert.deepEqual(valid(p), p);
  }
});

test("completed historical checks stay saved while a new date offers a fresh check", () => {
  const yesterday = "2026-10-19";
  const key = `${yesterday}:readiness`;
  let p = startAssessment(emptyProgress(), units, yesterday, "readiness");
  for (const { exercise } of assessmentItems(units, yesterday))
    p = answerAssessment(p, key, exercise, exercise.answers[0], yesterday);
  assert.equal(assessmentKey(p, today, "readiness"), `${today}:readiness`);
  assert.equal(p.academy.assessments[key].completed, true);
  const saved = structuredClone(p.academy.assessments[key]);
  p = startAssessment(p, units, today, "readiness");
  assert.deepEqual(p.academy.assessments[key], saved);
  assert.deepEqual(valid(p), p);
});

test("diagnostic imports reject empty, unknown and duplicate item sets while preserving historical answers", () => {
  const key = `${today}:readiness`;
  let p = startAssessment(emptyProgress(), units, today, "readiness");
  const first = assessmentItems(units, today)[0].exercise;
  p = answerAssessment(p, key, first, first.answers[0], today);
  // Version-one backups did not date each answer; they keep their original day credit.
  delete p.academy.assessments[key].answers[first.id].date;
  assert.deepEqual(valid(p), p);
  assert.equal(dailyMinutes(p, today), 1);
  const malformed = [
    { exerciseIds: [], answers: {}, completed: true },
    { exerciseIds: [], answers: {}, completed: false },
    { exerciseIds: ["unknown-exercise"], answers: {}, completed: false },
    { exerciseIds: [first.id, first.id], answers: {}, completed: false },
    { answers: { [first.id]: { answer: first.answers[0], correct: true, date: "invalid" } } },
    { answers: { [first.id]: { answer: first.answers[0], correct: true, date: "2026-10-19" } } },
  ];
  for (const patch of malformed) {
    const bad = structuredClone(p);
    Object.assign(bad.academy.assessments[key], patch);
    assert.throws(() => valid(bad));
  }
});

test("word memory schedules successful recall, retries tomorrow and cannot be farmed before it is due", () => {
  const term = { it: "il caffè", en: "the coffee" };
  let p = saveWord(emptyProgress(), term),
    key = wordKey(term);
  assert.ok(p.academy.words[key].starred);
  p = reviewWord(p, key, true, today);
  assert.equal(p.academy.words[key].due, "2026-10-21");
  assert.strictEqual(reviewWord(p, key, false, today), p);
  p = reviewWord(p, key, true, "2026-10-21");
  assert.equal(p.academy.words[key].due, "2026-10-24");
  assert.strictEqual(reviewWord(p, key, false, "2026-10-22"), p);
  p = reviewWord(p, key, false, "2026-10-24");
  assert.equal(p.academy.words[key].due, "2026-10-25");
  assert.equal(p.academy.words[key].lapses, 1);
  p = saveWord(p, term);
  assert.equal(p.academy.words[key].starred, false);
  assert.equal(p.academy.words[key].successes, 2);
  assert.deepEqual(valid(p), p);
});

test("all seven time budgets use coherent session recipes, preserve snapshots and fit remaining planned time", () => {
  for (const minutes of [5, 10, 15, 20, 30, 45, 60]) {
    for (const count of [0, 1, 2, 3]) {
      const recipe = dailyRecipe(minutes, count);
      assert.equal(
        recipe.session +
          recipe.workshops.reduce((a, b) => a + b, 0) +
          recipe.tense +
          recipe.companion,
        minutes,
      );
      assert.ok([5, 10, 15, 20, 30].includes(recipe.session));
    }
    let p = emptyProgress();
    p.plan = { ...p.plan, minutes, days: [0, 1, 2, 3, 4, 5, 6], start: today };
    const session = emptySession(ids[0], minutes),
      activities = sessionActivities(session.duration);
    assert.equal(
      Object.values(sessionLayout(session.duration)).reduce((a, b) => a + b, 0),
      Math.min(minutes, 30),
    );
    p.sessions = { [today]: { ...session, done: activities } };
    assert.equal(sessionDone(p, today).length, activities.length);
    assert.equal(dailyMinutes(p, today), Math.min(minutes, 30));
    assert.equal(learningRewards(p).completeDays, 1);
    assert.deepEqual(valid(p), p);
    const plan = schedule(p, missions, 1, today)[0];
    assert.equal(plan.budget, Math.max(0, minutes - 30));
    assert.ok(plan.items.length * 5 + plan.due.length * 2 <= plan.budget);
  }
  const old = emptyProgress();
  assert.deepEqual(valid(old), old);
});

test("an active programme supplies the daily core topic while existing sessions remain pinned", () => {
  const p = emptyProgress(),
    target = programmes[0].days[0].missionIds;
  assert.equal(target.length, 1);
  assert.equal(sessionMission(p, missions, today, target).id, target[0]);
  p.sessions = { [today]: emptySession(ids[0], 15) };
  assert.equal(sessionMission(p, missions, today, target).id, ids[0]);
  assert.deepEqual(dailyRecipe(30, 1), {
    session: 15,
    workshops: [15],
    tense: 0,
    companion: 0,
  });
  assert.deepEqual(dailyRecipe(60, 2), {
    session: 30,
    workshops: [15, 15],
    tense: 0,
    companion: 0,
  });
  assert.deepEqual(dailyRecipe(60, 3), {
    session: 15,
    workshops: [15, 15, 15],
    tense: 0,
    companion: 0,
  });
});

test("academy imports reject malformed nested state and preserve earlier version-one backups", () => {
  const base = { ...emptyProgress(), academy: emptyAcademy() };
  const malformed = [
    { ...base, academy: { ...base.academy, grammar: [] } },
    {
      ...base,
      academy: {
        ...base.academy,
        grammar: { bad: { ...getGrammarDraft(base, "bad"), output: 5 } },
      },
    },
    {
      ...base,
      academy: {
        ...base.academy,
        words: { bad: { term: { it: "a" }, starred: true } },
      },
    },
    {
      ...base,
      academy: {
        ...base.academy,
        programme: { id: "a", day: -1, started: today, completed: {} },
      },
    },
    {
      ...base,
      academy: {
        ...base.academy,
        assessments: {
          [`${today}:tense`]: {
            date: today,
            exerciseIds: ["e"],
            answers: {},
            completed: true,
          },
        },
      },
    },
    {
      ...base,
      sessions: { [today]: { ...emptySession(ids[0]), duration: "30" } },
    },
  ];
  malformed.forEach((bad) => assert.throws(() => valid(bad)));
  assert.deepEqual(valid(base), base);
  assert.deepEqual(valid(emptyProgress()), emptyProgress());
});

test("a complete course notebook larger than the old two-megabyte limit can still be restored", () => {
  const p = { ...emptyProgress(), academy: emptyAcademy() };
  for (const page of pages.filter((x) => x.kind === "practice")) {
    p.academy.companion[page.id] = {
      answer: "Una frase personale. ".repeat(90),
      selfChecked: true,
      modelSeen: true,
      completed: today,
    };
  }
  for (const u of units) {
    p.academy.grammar[u.id] = {
      ...getGrammarDraft(p, u.id),
      attempts: Object.fromEntries(
        u.exercises.map((e) => [
          e.id,
          Array.from({ length: 12 }, () => ({
            answer: "Una frase da correggere. ".repeat(20),
            correct: false,
            assisted: true,
            date: today,
          })),
        ]),
      ),
    };
  }
  const raw = JSON.stringify(p);
  assert.ok(raw.length > 2_000_000);
  assert.deepEqual(parseProgress(raw, ids), p);
});
