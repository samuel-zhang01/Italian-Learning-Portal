import type {
  AcademyProgress,
  CompanionDraft,
  GrammarDraft,
  GrammarExercise,
  GrammarUnit,
  Pair,
  Programme,
  Progress,
  ReadinessRun,
} from "./types.ts";
import { addDays, isCorrect, normalise, validDate } from "./learning-utils.ts";
import grammar from "./grammar.json" with { type: "json" };

const knownAssessmentIds = new Set(
  grammar.units.flatMap((unit) => unit.exercises.map((exercise) => exercise.id)),
);

export const emptyAcademy = (): AcademyProgress => ({
  grammar: {},
  companion: {},
  programme: null,
  assessments: {},
  words: {},
});
export const getGrammarDraft = (p: Progress, id: string): GrammarDraft =>
  p.academy?.grammar[id] ?? {
    exerciseIndex: 0,
    answers: {},
    attempts: {},
    hints: [],
    output: "",
    rubric: [],
    modelSeen: false,
  };
export function updateGrammarDraft(
  p: Progress,
  id: string,
  patch: Partial<GrammarDraft>,
): Progress {
  const a = p.academy ?? emptyAcademy();
  return {
    ...p,
    academy: {
      ...a,
      grammar: { ...a.grammar, [id]: { ...getGrammarDraft(p, id), ...patch } },
    },
  };
}
export function checkGrammarAnswer(
  p: Progress,
  unit: GrammarUnit,
  exerciseId: string,
  answer: string,
  options: { hintUsed: boolean; today: string; independentRecall?: boolean },
): Progress {
  const exercise = unit.exercises.find((e) => e.id === exerciseId);
  if (
    !exercise ||
    !answer.trim() ||
    answer.length > 500 ||
    !validDate(options.today)
  )
    return p;
  const draft = getGrammarDraft(p, unit.id);
  const history = draft.attempts[exerciseId] ?? [];
  const correct = isCorrect(answer, exercise.answers);
  const freshRecall =
    options.independentRecall &&
    !!history.length &&
    history.at(-1)!.date < options.today;
  const assisted =
    options.hintUsed ||
    draft.hintDates?.[exerciseId] === options.today ||
    (!freshRecall &&
      (draft.hints.includes(exerciseId) || history.some((a) => !a.correct)));
  // Preserve the first attempt forever and avoid duplicate credit for repeated clicks.
  if (
    history.at(-1)?.date === options.today &&
    history.at(-1)?.answer === answer &&
    history.at(-1)?.assisted === assisted
  )
    return p;
  const next = [...history, { answer, correct, assisted, date: options.today }];
  const bounded = next.length > 12 ? [next[0], ...next.slice(-11)] : next;
  return updateGrammarDraft(p, unit.id, {
    answers: { ...draft.answers, [exerciseId]: answer },
    attempts: { ...draft.attempts, [exerciseId]: bounded },
    hints: assisted
      ? Array.from(new Set([...draft.hints, exerciseId]))
      : draft.hints,
  });
}
export function grammarScore(p: Progress, unit: GrammarUnit) {
  const d = getGrammarDraft(p, unit.id);
  const attempts = unit.exercises.map((e) => d.attempts[e.id] ?? []);
  return {
    total: unit.exercises.length,
    attempted: attempts.filter((a) => a.length).length,
    solved: attempts.filter((a) => a.some((x) => x.correct)).length,
    firstCorrect: attempts.filter((a) => a[0]?.correct && !a[0]?.assisted)
      .length,
    assisted: attempts.filter((a) => a[0]?.assisted).length,
    completed: !!d.completed,
  };
}
export function completeGrammarUnit(
  p: Progress,
  unit: GrammarUnit,
  today: string,
): Progress {
  const d = getGrammarDraft(p, unit.id);
  if (
    d.completed ||
    grammarScore(p, unit).solved !== unit.exercises.length ||
    d.output.trim().split(/\s+/).length < 3 ||
    !unit.production.rubric.every((_, i) => d.rubric.includes(i)) ||
    !validDate(today)
  )
    return p;
  return updateGrammarDraft(p, unit.id, { completed: today });
}
export const getCompanionDraft = (p: Progress, id: string): CompanionDraft =>
  p.academy?.companion[id] ?? {
    answer: "",
    selfChecked: false,
    modelSeen: false,
  };
export function updateCompanionDraft(
  p: Progress,
  id: string,
  patch: Partial<CompanionDraft>,
): Progress {
  const a = p.academy ?? emptyAcademy();
  return {
    ...p,
    academy: {
      ...a,
      companion: {
        ...a.companion,
        [id]: { ...getCompanionDraft(p, id), ...patch },
      },
    },
  };
}
export function completeCompanion(
  p: Progress,
  pageId: string,
  today: string,
): Progress {
  const d = getCompanionDraft(p, pageId);
  if (
    d.completed ||
    !d.selfChecked ||
    d.answer.trim().split(/\s+/).length < 3 ||
    !validDate(today)
  )
    return p;
  return updateCompanionDraft(p, pageId, { completed: today });
}
export function selectProgramme(
  p: Progress,
  id: string,
  today: string,
): Progress {
  const a = p.academy ?? emptyAcademy();
  if (a.programme?.id === id) return p;
  return {
    ...p,
    academy: { ...a, programme: { id, started: today, day: 0, completed: {} } },
  };
}
export function programmeDayReady(
  p: Progress,
  programme: Programme,
  index: number,
) {
  const day = programme.days[index];
  return (
    !!day &&
    day.unitIds.every((id) => p.academy?.grammar[id]?.completed) &&
    day.missionIds.every((id) => p.completed[id])
  );
}
export function completeProgrammeDay(
  p: Progress,
  programme: Programme,
  index: number,
  today: string,
): Progress {
  const a = p.academy ?? emptyAcademy();
  if (
    !validDate(today) ||
    a.programme?.id !== programme.id ||
    index !== a.programme.day ||
    !programmeDayReady(p, programme, index)
  )
    return p;
  return {
    ...p,
    academy: {
      ...a,
      programme: {
        ...a.programme,
        day: Math.min(index + 1, programme.days.length),
        completed: { ...a.programme.completed, [index]: today },
      },
    },
  };
}
export function academyMinutes(p: Progress, date: string) {
  const a = p.academy;
  if (!a) return 0;
  const attempted = Object.values(a.grammar).reduce(
    (sum, d) =>
      sum +
      Object.values(d.attempts).filter((rows) =>
        rows.some((r) => r.date === date),
      ).length,
    0,
  );
  const units = Object.values(a.grammar).filter(
    (d) => d.completed === date,
  ).length;
  const pages = Object.values(a.companion).filter(
    (d) => d.completed === date,
  ).length;
  const checks = Object.values(a.assessments).reduce(
    (sum, run) =>
      sum +
      Object.values(run.answers).filter(
        (answer) => (answer.date ?? run.date) === date,
      ).length,
    0,
  );
  // Eight controlled questions plus reading and personal production form a 15-minute workshop.
  return attempted + units * 7 + pages * 5 + checks;
}
export function academyXP(p: Progress) {
  const a = p.academy;
  if (!a) return 0;
  return (
    Object.values(a.grammar).reduce(
      (sum, d) =>
        sum +
        Object.values(d.attempts).filter((r) => r.length).length * 2 +
        (d.completed ? 15 : 0),
      0,
    ) +
    Object.values(a.companion).filter((d) => d.completed).length * 5
  );
}
export function grammarReviewQueue(
  p: Progress,
  units: GrammarUnit[],
  today: string,
) {
  return units.flatMap((unit) =>
    unit.exercises
      .filter((e) => {
        const history = getGrammarDraft(p, unit.id).attempts[e.id] ?? [];
        const last = history.at(-1);
        if (!last) return false;
        const gap = last.correct && !last.assisted ? 3 : 1;
        return addDays(last.date, gap) <= today;
      })
      .map((exercise) => ({ unit, exercise })),
  );
}
// A bounded mixed check is a diagnostic snapshot, not an A2 certificate.
export function assessmentItems(
  units: GrammarUnit[],
  date: string,
  mode: "readiness" | "tense" = "readiness",
) {
  const seed = Number(date.replaceAll("-", ""));
  const eligible = units.filter((u) => u.level === "A1");
  if (mode === "tense") {
    const pool = eligible.flatMap((u) =>
      u.exercises
        .filter((e) => e.kind === "tense")
        .map((e) => ({ unit: u, exercise: e })),
    );
    const offset = pool.length ? seed % pool.length : 0;
    return [...pool.slice(offset), ...pool.slice(0, offset)].slice(0, 12);
  }
  // Sample across curriculum domains rather than taking only the first few units.
  const domains = [
    ["noun-gender", "noun-plurals"],
    ["definite-articles", "indefinite-articles"],
    ["adjective-agreement", "demonstratives"],
    ["essere", "avere"],
    ["questions-negation", "there-is"],
    ["present-are", "present-ere", "present-ire"],
    ["irregular-present", "modal-verbs"],
    ["reflexive-routine", "piacere"],
    ["simple-prepositions", "articulated-prepositions"],
    ["possessives-family", "quantity-partitives"],
    ["past-avere", "past-essere"],
    ["past-irregular", "present-past-choice"],
  ];
  return domains.flatMap((ids, i) => {
    const options = eligible.filter((u) => ids.includes(u.id));
    const unit = options[(seed + i) % options.length];
    if (!unit) return [];
    const productive = unit.exercises.filter(
      (e) => e.kind !== "choice" && e.kind !== "reorder",
    );
    const pool = productive.length ? productive : unit.exercises;
    return [{ unit, exercise: pool[(seed + i) % pool.length] }];
  });
}
export function startAssessment(
  p: Progress,
  units: GrammarUnit[],
  today: string,
  mode: "readiness" | "tense",
): Progress {
  const a = p.academy ?? emptyAcademy(),
    key = `${today}:${mode}`;
  if (
    a.assessments[key] ||
    !validDate(today) ||
    !assessmentItems(units, today, mode).length
  )
    return p;
  const run: ReadinessRun = {
    date: today,
    exerciseIds: assessmentItems(units, today, mode).map((x) => x.exercise.id),
    answers: {},
    completed: false,
  };
  return {
    ...p,
    academy: { ...a, assessments: { ...a.assessments, [key]: run } },
  };
}
// Keep an unfinished check reachable after midnight, without replacing its questions.
export function assessmentKey(
  p: Progress,
  today: string,
  mode: "readiness" | "tense",
) {
  return (
    Object.entries(p.academy?.assessments ?? {})
      .filter(
        ([key, run]) =>
          key.endsWith(`:${mode}`) && !run.completed && run.date <= today,
      )
      .sort(([a], [b]) => b.localeCompare(a))[0]?.[0] ?? `${today}:${mode}`
  );
}
export function answerAssessment(
  p: Progress,
  key: string,
  exercise: GrammarExercise,
  answer: string,
  answeredOn?: string,
): Progress {
  const a = p.academy,
    run = a?.assessments[key];
  const date = answeredOn ?? run?.date;
  if (
    !a ||
    !run ||
    run.completed ||
    run.answers[exercise.id] ||
    !run.exerciseIds.includes(exercise.id) ||
    !answer.trim() ||
    answer.length > 500 ||
    !validDate(date) ||
    date < run.date
  )
    return p;
  const answers = {
    ...run.answers,
    [exercise.id]: { answer, correct: isCorrect(answer, exercise.answers), date },
  };
  return {
    ...p,
    academy: {
      ...a,
      assessments: {
        ...a.assessments,
        [key]: {
          ...run,
          answers,
          completed: Object.keys(answers).length === run.exerciseIds.length,
        },
      },
    },
  };
}
export const wordKey = (term: Pair) => normalise(term.it);
export function saveWord(p: Progress, term: Pair, example?: Pair): Progress {
  const a = p.academy ?? emptyAcademy(),
    key = wordKey(term),
    old = a.words[key];
  return {
    ...p,
    academy: {
      ...a,
      words: {
        ...a.words,
        [key]: old
          ? { ...old, starred: !old.starred }
          : {
              term,
              ...(example ? { example } : {}),
              starred: true,
              successes: 0,
              lapses: 0,
              due: "",
              lastDate: "",
            },
      },
    },
  };
}
export function reviewWord(
  p: Progress,
  key: string,
  remembered: boolean,
  today: string,
): Progress {
  const a = p.academy,
    word = a?.words[key];
  if (
    !a ||
    !word ||
    word.lastDate === today ||
    word.due > today ||
    !validDate(today)
  )
    return p;
  const successes = word.successes + Number(remembered);
  const interval = remembered ? (successes < 2 ? 1 : successes < 4 ? 3 : 7) : 1;
  return {
    ...p,
    academy: {
      ...a,
      words: {
        ...a.words,
        [key]: {
          ...word,
          successes,
          lapses: word.lapses + Number(!remembered),
          due: addDays(today, interval),
          lastDate: today,
        },
      },
    },
  };
}

const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const integer = (x: unknown, min: number, max: number) =>
  Number.isInteger(x) && Number(x) >= min && Number(x) <= max;
const string = (x: unknown, max = 2000): x is string =>
  typeof x === "string" && x.length <= max;
const id = (x: string) => /^[a-zA-Z0-9][a-zA-Z0-9_:.\/-]{0,159}$/.test(x);
const dateOrEmpty = (x: unknown) => x === "" || validDate(x);
const pair = (x: unknown) =>
  object(x) && string(x.en, 500) && string(x.it, 500);
export function validateAcademy(
  value: unknown,
): asserts value is AcademyProgress {
  if (
    !object(value) ||
    !object(value.grammar) ||
    !object(value.companion) ||
    !object(value.assessments) ||
    !object(value.words) ||
    !(value.programme === null || object(value.programme))
  )
    throw new Error("academy");
  for (const [key, d] of Object.entries(value.grammar)) {
    if (
      !id(key) ||
      !object(d) ||
      !integer(d.exerciseIndex, 0, 200) ||
      !object(d.answers) ||
      !object(d.attempts) ||
      !Array.isArray(d.hints) ||
      d.hints.length > 200 ||
      !d.hints.every((x) => string(x, 160) && id(x)) ||
      !string(d.output) ||
      !Array.isArray(d.rubric) ||
      d.rubric.length > 10 ||
      !d.rubric.every((x) => integer(x, 0, 9)) ||
      typeof d.modelSeen !== "boolean" ||
      (d.completed !== undefined && !validDate(d.completed))
    )
      throw new Error("grammar");
    if (
      d.hintDates !== undefined &&
      (!object(d.hintDates) ||
        !Object.entries(d.hintDates).every(
          ([eid, date]) => id(eid) && validDate(date),
        ))
    )
      throw new Error("grammar-hint-date");
    for (const [eid, answer] of Object.entries(d.answers))
      if (!id(eid) || !string(answer, 500)) throw new Error("grammar-answer");
    for (const [eid, rows] of Object.entries(d.attempts))
      if (
        !id(eid) ||
        !Array.isArray(rows) ||
        rows.length > 12 ||
        !rows.every(
          (r) =>
            object(r) &&
            string(r.answer, 500) &&
            typeof r.correct === "boolean" &&
            typeof r.assisted === "boolean" &&
            validDate(r.date),
        )
      )
        throw new Error("grammar-attempt");
  }
  for (const [key, d] of Object.entries(value.companion))
    if (
      !id(key) ||
      !object(d) ||
      !string(d.answer) ||
      typeof d.selfChecked !== "boolean" ||
      typeof d.modelSeen !== "boolean" ||
      (d.completed !== undefined && !validDate(d.completed))
    )
      throw new Error("companion");
  const programme = value.programme;
  if (
    programme !== null &&
    (!object(programme) ||
      !string(programme.id, 160) ||
      !id(programme.id) ||
      !validDate(programme.started) ||
      !integer(programme.day, 0, 366) ||
      !object(programme.completed) ||
      !Object.entries(programme.completed).every(
        ([k, v]) => /^\d{1,3}$/.test(k) && validDate(v),
      ))
  )
    throw new Error("programme");
  for (const [key, r] of Object.entries(value.assessments)) {
    if (
      !/^\d{4}-\d{2}-\d{2}:(readiness|tense)$/.test(key) ||
      !object(r) ||
      !validDate(r.date) ||
      !key.startsWith(r.date + ":") ||
      !Array.isArray(r.exerciseIds) ||
      r.exerciseIds.length === 0 ||
      r.exerciseIds.length > 30 ||
      new Set(r.exerciseIds).size !== r.exerciseIds.length ||
      !r.exerciseIds.every(
        (x) => string(x, 160) && id(x) && knownAssessmentIds.has(x),
      ) ||
      !object(r.answers) ||
      typeof r.completed !== "boolean"
    )
      throw new Error("assessment");
    for (const [eid, a] of Object.entries(r.answers))
      if (
        !r.exerciseIds.includes(eid) ||
        !object(a) ||
        !string(a.answer, 500) ||
        typeof a.correct !== "boolean" ||
        (a.date !== undefined && (!validDate(a.date) || a.date < r.date))
      )
        throw new Error("assessment-answer");
    if (
      r.completed !==
      (Object.keys(r.answers).length === r.exerciseIds.length)
    )
      throw new Error("assessment-completion");
  }
  for (const [key, w] of Object.entries(value.words))
    if (
      !string(key, 200) ||
      !object(w) ||
      !pair(w.term) ||
      (w.example !== undefined && !pair(w.example)) ||
      typeof w.starred !== "boolean" ||
      !integer(w.successes, 0, 100000) ||
      !integer(w.lapses, 0, 100000) ||
      !dateOrEmpty(w.due) ||
      !dateOrEmpty(w.lastDate)
    )
      throw new Error("word");
}
