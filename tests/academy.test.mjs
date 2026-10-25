import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
  getGrammarRecallDraft,
  updateGrammarRecallDraft,
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
  updateProgrammePracticeDraft,
  completeProgrammePractice,
  getProgrammePracticeDraft,
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

test("grammar provides 65 substantial bilingual A1/A2 units, six exercise formats and bounded source references", () => {
  assert.equal(units.length, 65);
  assert.equal(new Set(units.map((u) => u.id)).size, units.length);
  const allIds = new Set(),
    kinds = new Set();
  for (const u of units) {
    assert.ok(["A1", "A1-plus", "A2"].includes(u.level));
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
  assert.equal(sources.length, 53);
  assert.equal(
    pages.length,
    sources.reduce((n, s) => n + s.pages, 0),
  );
  assert.equal(pages.length, 1609);
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

test("the original programmes and the chapter journey reference real lessons", () => {
  assert.deepEqual(
    programmes.map((p) => p.days.length),
    [14, 28, 10, 80],
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
    units.slice(0, 28).filter((u) => u.level === "A1").every((u) => intensive.has(u.id)),
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

const bookReview = JSON.parse(
  readFileSync(new URL("../docs/book-course-review.json", import.meta.url), "utf8"),
);
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
};

test("book integration preserves every earlier content object and programme day in its original order", () => {
  const documents = Object.fromEntries(
    ["curriculum", "grammar", "enrichment", "companion"].map((name) => [name, read(name)]),
  );
  for (const [path, baseline] of Object.entries(bookReview.baselinePreservation.arrays)) {
    const [document, key] = path.split(".");
    const preserved = documents[document][key].slice(0, baseline.count);
    const hash = createHash("sha256").update(JSON.stringify(canonical(preserved))).digest("hex");
    assert.equal(hash, baseline.sha256, path);
  }
  assert.deepEqual(programmes.slice(0, 3).map((route) => route.id), ["intensive-a1", "supported-a1", "grammar-repair"]);
});

test("new book sources expose bounded metadata and reference pointers while the 730 practice companions stay unchanged", () => {
  const expected = [
    ["src-8fa57188c2eb", 2, "materials/books/nuovo-espresso-plus-1/originals/publisher/NEPLUS1_indice.pdf"],
    ["src-c3791736675a", 2, "materials/books/nuovo-espresso-plus-2/originals/publisher/NESP2_indice.pdf"],
    ["src-070c40bad24b", 166, "materials/books/nuovo-espresso-plus-2/originals/publisher/NEPLUS2_guida-totaleDEF.pdf"],
    ...bookReview.nativeReaderCapture.books.map((book) => [book.sourceId, book.capturedPages, book.path]),
  ];
  assert.equal(expected.length, 5);
  const curriculum = read("curriculum");
  assert.equal(curriculum.sources.length, 53);
  assert.deepEqual(new Set(curriculum.sources.map((source) => source.id)), new Set(sources.map((source) => source.id)));
  for (const [id, count, path] of expected) {
    const source = sources.find((item) => item.id === id);
    assert.equal(source.pages, count);
    assert.equal(source.path, path);
    assert.equal(source.id, `src-${source.sha256.slice(0, 12)}`);
    assert.deepEqual(curriculum.sources.find((item) => item.id === id), source);
    const entries = pages.filter((page) => page.sourceId === id);
    assert.equal(entries.length, count);
    assert.ok(entries.every((page) => page.kind === "reference" && page.checks.length === 0));
  }
  assert.equal(pages.filter((page) => page.kind === "practice").length, 730);
  for (const unit of units.filter((item) => item.level === "A2")) {
    for (const ref of unit.sources) {
      for (const page of ref.pages)
        assert.ok(pages.find((entry) => entry.id === `${ref.id}-p${page}`)?.unitIds.includes(unit.id), `${unit.id}: ${ref.id} p${page}`);
    }
  }
});

test("A2 units link their verified chapters while foundation diagnostics retain their A1 scope", () => {
  const added = units.slice(0, 55).filter((unit) => unit.level === "A2");
  assert.equal(added.length, 20);
  assert.equal(added.flatMap((unit) => unit.exercises).length, 160);
  for (const mapping of bookReview.unitSourceMapping.filter((mapping) => mapping.id.startsWith("a2-"))) {
    const unit = added.find((item) => item.id === mapping.id);
    assert.ok(unit, mapping.id);
    const chapterMissions = mapping.chapterLinks.map((chapter) => {
      const prefix = `espresso2-u${String(chapter).padStart(2, "0")}-`;
      return missions.find((mission) => mission.id.startsWith(prefix))?.id;
    });
    assert.deepEqual(unit.missionIds, chapterMissions);
    assert.ok(unit.sources.some((ref) => ref.id === "src-070c40bad24b"));
  }
  for (const date of ["2026-10-24", "2026-11-15", "2027-01-09"]) {
    for (const mode of ["readiness", "tense"]) {
      const items = assessmentItems(units, date, mode);
      assert.ok(items.length);
      assert.ok(items.every(({ unit }) => unit.level === "A1"));
      if (mode === "readiness")
        assert.ok(items.every(({ unit }) => units.slice(0, 28).some((original) => original.id === unit.id)), "readiness retains its twelve existing foundation domains");
    }
  }
});

test("seven native-book A1 gap units use exact references and remain separate from the original foundation diagnostic domains", () => {
  const added = units.slice(0, 55).filter((unit) => unit.id.startsWith("a1-"));
  assert.equal(added.length, 7);
  assert.equal(added.flatMap((unit) => unit.exercises).length, 56);
  assert.equal(units.filter((unit) => unit.level === "A1").length, 33);
  assert.equal(units.filter((unit) => unit.level === "A1-plus").length, 3);
  assert.equal(units.flatMap((unit) => unit.exercises).length, 520);
  for (const unit of added) {
    assert.equal(unit.level, "A1");
    assert.ok(unit.missionIds.length);
    assert.notEqual(unit.production.frame.en, unit.production.frame.it);
    for (const reference of unit.sources) {
      assert.equal(reference.id, "src-1647be2784c9");
      for (const page of reference.pages)
        assert.ok(pages.find((entry) => entry.id === `${reference.id}-p${page}`)?.unitIds.includes(unit.id));
    }
  }
  assert.ok(units.slice(28, 35).every((unit) => unit.id.startsWith("a1-")));
  assert.ok(units.slice(35, 55).every((unit) => unit.level === "A2"));
});

test("native reader sources distinguish captured sections, selectively reviewed pages and the unresolved publisher extent", () => {
  const capture = bookReview.nativeReaderCapture;
  assert.equal(capture.reviewAndCaptureAreDistinct, true);
  assert.equal(capture.capturedMainBookPages, 503);
  assert.deepEqual(capture.books.map((book) => book.capturedPages), [240, 263]);
  for (const book of capture.books) {
    const source = sources.find((item) => item.id === book.sourceId);
    assert.ok(source.title.includes("reader XPS"));
    assert.equal(source.pages, book.capturedPages);
    assert.equal(source.sha256, book.sha256);
    assert.equal(book.availableMainBookSections, 26);
    assert.ok(book.selectivelyReviewedPhysicalPages.length > 0 && book.selectivelyReviewedPhysicalPages.length < book.capturedPages);
    assert.ok(book.selectivelyReviewedPhysicalPages.every((page) => page > 0 && page <= book.capturedPages));
    assert.deepEqual(
      book.sections.flatMap((section) => Array.from({ length: section.pages }, (_, index) => section.start_page + index)),
      Array.from({ length: book.capturedPages }, (_, index) => index + 1),
    );
    assert.ok(pages.filter((page) => page.sourceId === source.id).every((page) => page.kind === "reference" && page.checks.length === 0));
  }
  assert.equal(capture.publisherExtentDiscrepancy.publisherPages, 264);
  assert.equal(capture.publisherExtentDiscrepancy.accessibleReaderPages, 263);
  assert.equal(capture.publisherExtentDiscrepancy.paddedPages, 0);
  assert.ok(!pages.some((page) => page.sourceId === "src-580f7558db56" && page.page === 264));
});

test("the unchanged 80 chapter checkpoints introduce prerequisites before use and cover their original 55 units", () => {
  const route = programmes.find((programme) => programme.id === "espresso-plus-a1-a2");
  assert.equal(route.days.length, 80);
  const introduced = new Set();
  for (const [index, day] of route.days.entries()) {
    const newlyIntroduced = day.unitIds.filter((id) => !introduced.has(id));
    assert.ok(newlyIntroduced.length <= 2, `day ${index + 1}`);
    for (const id of day.unitIds) {
      const unit = units.find((item) => item.id === id);
      assert.ok(unit.prerequisites.every((prerequisite) => introduced.has(prerequisite)), `day ${index + 1}: ${id}`);
      introduced.add(id);
    }
    assert.deepEqual(Object.keys(day.practice).sort(), ["model", "prompt", "rubric"]);
    [day.practice.prompt, day.practice.model, ...day.practice.rubric].forEach(pair);
    assert.equal(day.practice.rubric.length, 2);
    if (index === 39) assert.ok(units.slice(0, 55).filter((unit) => unit.level !== "A2").every((unit) => introduced.has(unit.id)));
  }
  assert.deepEqual(introduced, new Set(units.slice(0, 55).map((unit) => unit.id)));
  for (const language of ["en", "it"]) {
    assert.equal(new Set(route.days.map((day) => day.practice.prompt[language])).size, 80);
    assert.equal(new Set(route.days.map((day) => day.practice.model[language])).size, 80);
  }
  for (let chapter = 0; chapter < 20; chapter++) {
    const book = chapter < 10 ? 1 : 2, number = chapter % 10 + 1;
    const expected = missions.find((mission) => mission.id.startsWith(`espresso${book}-u${String(number).padStart(2, "0")}-`)).id;
    assert.deepEqual(route.days[chapter * 4 + 2].missionIds, [expected]);
    assert.deepEqual(route.days[chapter * 4 + 3].missionIds, [expected]);
  }
});

test("historical lesson completion cannot bypass the actual book journey's next personal checkpoint", () => {
  const route = programmes.find((programme) => programme.id === "espresso-plus-a1-a2");
  let p = selectProgramme(emptyProgress(), route.id, today);
  for (const unit of units) p.academy.grammar[unit.id] = { ...getGrammarDraft(p, unit.id), completed: today };
  for (const mission of missions) p.completed[mission.id] = {
    date: today, firstCorrect: 2, total: 2, output: "Una risposta già salvata.", supported: false, confidence: 2,
  };
  const savedLessons = structuredClone(p.completed), savedGrammar = structuredClone(p.academy.grammar);
  assert.equal(programmeDayReady(p, route, 0), false);
  p = updateProgrammePracticeDraft(p, route, 0, {
    output: "Buongiorno, mi chiamo Tessa. Come, scusi?", rubric: [0, 1], modelSeen: false,
  });
  p = completeProgrammePractice(p, route, 0, today);
  p = completeProgrammeDay(p, route, 0, today);
  p = valid(p);
  assert.equal(p.academy.programme.day, 1);
  assert.equal(programmeDayReady(p, route, 1), false);
  assert.equal(getProgrammePracticeDraft(p, route, 0).completed, today);
  assert.equal(getProgrammePracticeDraft(p, route, 1).output, "");
  assert.deepEqual(p.completed, savedLessons);
  assert.deepEqual(p.academy.grammar, savedGrammar);
});

test("unfinished grammar recall survives backup and midnight separately from checked answers", () => {
  const earlier = "2026-10-15";
  let p = checkGrammarAnswer(emptyProgress(), unit, exercise.id, "an earlier wrong answer", { today: earlier, hintUsed: false });
  p = updateGrammarDraft(p, unit.id, { exerciseIndex: 3, output: "La mia bozza personale.", rubric: [0] });
  const prior = structuredClone(getGrammarDraft(p, unit.id));
  const xp = academyXP(p);
  p = updateGrammarRecallDraft(p, unit.id, exercise.id, "Una risposta da finire", today);
  const restored = parseProgress(JSON.stringify(p), ids);
  assert.equal(getGrammarRecallDraft(restored, unit.id, exercise.id, today).answer, "Una risposta da finire");
  assert.equal(getGrammarRecallDraft(restored, unit.id, exercise.id, "2026-10-21").answer, "Una risposta da finire");
  assert.equal(getGrammarRecallDraft(restored, unit.id, exercise.id, earlier), undefined);
  assert.deepEqual(getGrammarDraft(restored, unit.id).answers, prior.answers);
  assert.deepEqual(getGrammarDraft(restored, unit.id).attempts, prior.attempts);
  assert.equal(getGrammarDraft(restored, unit.id).exerciseIndex, 3);
  assert.equal(getGrammarDraft(restored, unit.id).output, prior.output);
  assert.equal(academyXP(restored), xp);
  assert.deepEqual(restored.reviews, p.reviews);
  p = checkGrammarAnswer(restored, unit, exercise.id, exercise.answers[0], { today: "2026-10-21", hintUsed: false, independentRecall: true });
  assert.equal(getGrammarDraft(p, unit.id).recallDrafts[exercise.id], undefined);
  assert.equal(getGrammarRecallDraft(p, unit.id, exercise.id, "2026-10-24"), undefined);
  assert.deepEqual(getGrammarDraft(p, unit.id).attempts[exercise.id][0], prior.attempts[exercise.id][0]);
  assert.equal(getGrammarDraft(p, unit.id).attempts[exercise.id].at(-1).assisted, false);
  assert.equal(academyXP(p), xp);
});

test("a pending recall keeps hint evidence over reload and midnight until it is checked", () => {
  let p = checkGrammarAnswer(emptyProgress(), unit, exercise.id, exercise.answers[0], { today: "2026-10-15", hintUsed: false });
  p = updateGrammarRecallDraft(p, unit.id, exercise.id, "", today, true);
  p = parseProgress(JSON.stringify(p), ids);
  p = updateGrammarRecallDraft(p, unit.id, exercise.id, exercise.answers[0], "2026-10-21");
  assert.equal(getGrammarRecallDraft(p, unit.id, exercise.id, "2026-10-21").hintUsed, true);
  p = checkGrammarAnswer(p, unit, exercise.id, exercise.answers[0], { today: "2026-10-21", hintUsed: false, independentRecall: true });
  assert.equal(getGrammarDraft(p, unit.id).attempts[exercise.id].at(-1).assisted, true);
  assert.equal(getGrammarDraft(p, unit.id).recallDrafts[exercise.id], undefined);
  assert.ok(grammarReviewQueue(p, [unit], "2026-10-22").some((item) => item.exercise.id === exercise.id));
});

test("pending recall imports reject malformed records while old version-one backups remain valid", () => {
  const base = updateGrammarRecallDraft(emptyProgress(), unit.id, exercise.id, "La bozza", today);
  for (const pending of [null, [], { date: "yesterday", answer: "x", hintUsed: false }, { date: today, answer: "x".repeat(501), hintUsed: false }, { date: today, answer: "x", hintUsed: "yes" }]) {
    const p = structuredClone(base);
    p.academy.grammar[unit.id].recallDrafts[exercise.id] = pending;
    assert.throws(() => parseProgress(JSON.stringify(p), ids));
  }
  const unknown = structuredClone(base);
  unknown.academy.grammar[unit.id].recallDrafts.unknown = { date: today, answer: "x", hintUsed: false };
  assert.throws(() => parseProgress(JSON.stringify(unknown), ids));
  const old = structuredClone(base);
  delete old.academy.grammar[unit.id].recallDrafts;
  assert.equal(parseProgress(JSON.stringify(old), ids).version, 1);
});
