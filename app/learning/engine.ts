import type { Draft, Mission, Progress } from "./types.ts";
export const STORAGE_KEY = "parliamo-daily-v1";
export const dayKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dayKey(d);
}
export const emptyProgress = (): Progress => ({
  version: 1,
  language: "en",
  translations: true,
  plan: { minutes: 10, days: [1, 2, 3, 4, 5], start: dayKey(), course: 1 },
  completed: {},
  drafts: {},
  reviews: {},
  reviewLog: [],
  notes: "",
  updatedAt: "",
});
export const emptyDraft = (): Draft => ({
  step: 0,
  answers: ["", ""],
  checked: [false, false],
  first: [],
  output: "",
  rubric: [false, false],
  modelSeen: false,
});
// Keep Italian accents meaningful: e (and) and è (is) are different words.
export const normalise = (s: string) =>
  s
    .trim()
    .normalize("NFC")
    .toLocaleLowerCase("it")
    .replace(/[’‘]/g, "'")
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
export const isCorrect = (input: string, answers: string[]) =>
  answers.some((a) => normalise(a) === normalise(input));
export function dueReviews(p: Progress, today = dayKey()) {
  return Object.entries(p.reviews)
    .filter(([id, r]) => p.completed[id] && r.due <= today)
    .sort((a, b) => a[1].due.localeCompare(b[1].due))
    .map(([id]) => id);
}
export function recordReview(
  p: Progress,
  id: string,
  correct: boolean,
  today = dayKey(),
): Progress {
  const r = p.reviews[id];
  if (!r || r.lastDate === today || r.due > today) return p;
  const interval = correct ? (r.interval < 3 ? 3 : r.interval < 7 ? 7 : 14) : 1;
  return {
    ...p,
    reviews: {
      ...p.reviews,
      [id]: {
        due: addDays(today, interval),
        interval,
        attempts: r.attempts + 1,
        correct: r.correct + Number(correct),
        lastDate: today,
      },
    },
    reviewLog: [...p.reviewLog, { id, date: today, correct }].slice(-2000),
  };
}
export function completeMission(
  p: Progress,
  m: Mission,
  d: Draft,
  confidence: number,
  today = dayKey(),
): Progress {
  if (
    p.completed[m.id] ||
    !d.checked.every(Boolean) ||
    !d.rubric.every(Boolean) ||
    d.output.trim().split(/\s+/).length < 3
  )
    return p;
  return {
    ...p,
    completed: {
      ...p.completed,
      [m.id]: {
        date: today,
        firstCorrect: d.first.filter(Boolean).length,
        total: m.checks.length,
        output: d.output,
        supported: d.modelSeen,
        confidence,
      },
    },
    reviews: {
      ...p.reviews,
      [m.id]: {
        due: addDays(today, 1),
        interval: 1,
        attempts: 0,
        correct: 0,
        lastDate: "",
      },
    },
  };
}
export function nextMission(p: Progress, missions: Mission[]) {
  return (
    missions.find((m) => m.course === p.plan.course && !p.completed[m.id]) ??
    missions.find((m) => !p.completed[m.id])
  );
}
export function dailyMinutes(p: Progress, today = dayKey()) {
  return (
    Object.values(p.completed).filter((c) => c.date === today).length * 5 +
    p.reviewLog.filter((r) => r.date === today).length * 2
  );
}
export function schedule(
  p: Progress,
  missions: Mission[],
  count = 7,
  today = dayKey(),
) {
  const pending = missions.filter(
    (m) => m.course === p.plan.course && !p.completed[m.id],
  );
  let index = 0;
  const plannedReviews = new Set<string>();
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(today, i);
    const active =
      date >= p.plan.start &&
      p.plan.days.includes(new Date(`${date}T12:00:00`).getDay());
    const budget = active
      ? Math.max(0, p.plan.minutes - (i === 0 ? dailyMinutes(p, today) : 0))
      : 0;
    const due = Object.entries(p.reviews)
      .filter(
        ([id, r]) =>
          p.completed[id] && r.due <= date && !plannedReviews.has(id),
      )
      .sort((a, b) => a[1].due.localeCompare(b[1].due))
      .slice(0, Math.floor(budget / 2))
      .map(([id]) => id);
    due.forEach((id) => plannedReviews.add(id));
    const slots = Math.floor((budget - due.length * 2) / 5);
    const items = pending.slice(index, index + slots);
    index += items.length;
    return { date, active, items, due };
  });
}
const validDate = (s: unknown): s is string =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  dayKey(new Date(`${s}T12:00:00`)) === s;
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
// A strict import boundary prevents a malformed backup from breaking the learning journey.
export function parseProgress(raw: string, ids: string[]): Progress {
  if (raw.length > 2_000_000) throw new Error("size");
  const x = JSON.parse(raw);
  const allowed = new Set(ids);
  const integer = (n: unknown, min: number, max: number) =>
    Number.isInteger(n) && Number(n) >= min && Number(n) <= max;
  if (
    !object(x) ||
    x.version !== 1 ||
    !["en", "it"].includes(String(x.language)) ||
    typeof x.translations !== "boolean" ||
    !object(x.plan) ||
    !(
      typeof x.plan.minutes === "number" && [5, 10, 15].includes(x.plan.minutes)
    ) ||
    !(typeof x.plan.course === "number" && [1, 2, 3].includes(x.plan.course)) ||
    !validDate(x.plan.start) ||
    !Array.isArray(x.plan.days) ||
    !x.plan.days.length ||
    !x.plan.days.every((d) => integer(d, 0, 6)) ||
    !object(x.completed) ||
    !object(x.drafts) ||
    !object(x.reviews) ||
    !Array.isArray(x.reviewLog) ||
    typeof x.notes !== "string" ||
    x.notes.length > 5000 ||
    typeof x.updatedAt !== "string"
  )
    throw new Error("format");
  for (const [id, c] of Object.entries(x.completed))
    if (
      !allowed.has(id) ||
      !object(c) ||
      !validDate(c.date) ||
      !integer(c.firstCorrect, 0, 2) ||
      c.total !== 2 ||
      typeof c.output !== "string" ||
      c.output.length > 2000 ||
      typeof c.supported !== "boolean" ||
      !integer(c.confidence, 1, 3)
    )
      throw new Error("completion");
  for (const [id, d] of Object.entries(x.drafts))
    if (
      !allowed.has(id) ||
      !object(d) ||
      !integer(d.step, 0, 3) ||
      !Array.isArray(d.answers) ||
      d.answers.length !== 2 ||
      !d.answers.every((a) => typeof a === "string" && a.length <= 200) ||
      !Array.isArray(d.checked) ||
      d.checked.length !== 2 ||
      !d.checked.every((b) => typeof b === "boolean") ||
      !Array.isArray(d.first) ||
      d.first.length > 2 ||
      !d.first.every((b) => typeof b === "boolean") ||
      typeof d.output !== "string" ||
      d.output.length > 2000 ||
      !Array.isArray(d.rubric) ||
      d.rubric.length !== 2 ||
      !d.rubric.every((b) => typeof b === "boolean") ||
      typeof d.modelSeen !== "boolean"
    )
      throw new Error("draft");
  for (const [id, r] of Object.entries(x.reviews))
    if (
      !allowed.has(id) ||
      !object(r) ||
      !validDate(r.due) ||
      !(typeof r.interval === "number" && [1, 3, 7, 14].includes(r.interval)) ||
      !integer(r.attempts, 0, 100000) ||
      !integer(r.correct, 0, Number(r.attempts)) ||
      (r.lastDate !== "" && !validDate(r.lastDate))
    )
      throw new Error("review");
  if (
    x.reviewLog.length > 2000 ||
    !x.reviewLog.every(
      (r) =>
        object(r) &&
        allowed.has(String(r.id)) &&
        validDate(r.date) &&
        typeof r.correct === "boolean",
    )
  )
    throw new Error("log");
  return x as unknown as Progress;
}
