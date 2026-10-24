import type { Draft, Mission, Progress } from "./types.ts";
import {
  SESSION_ORDER,
  sessionActivities,
  sessionLayout,
  sessionCredit,
  sessionDone,
} from "./study.ts";
import { addDays, dayKey, validDate } from "./learning-utils.ts";
import { academyMinutes, validateAcademy } from "./academy-engine.ts";
import { validateArcade } from "./arcade-engine.ts";
export { addDays, dayKey, normalise, isCorrect } from "./learning-utils.ts";
export const STORAGE_KEY = "parliamo-daily-v1";
export const emptyProgress = (): Progress => ({
  version: 1,
  language: "en",
  translations: true,
  plan: { minutes: 30, days: [1, 2, 3, 4, 5], start: dayKey(), course: 1 },
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
    p.reviewLog.filter((r) => r.date === today).length * 2 +
    sessionCredit(p, today) +
    academyMinutes(p, today)
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
      .slice(
        0,
        p.plan.minutes >= 20
          ? Math.min(
              Math.floor(sessionLayout(p.plan.minutes).warmup / 2),
              Math.floor(budget / 2),
            )
          : Math.floor(budget / 2),
      )
      .map(([id]) => id);
    due.forEach((id) => plannedReviews.add(id));
    const slots =
      p.plan.minutes >= 20
        ? Math.min(1, Math.floor((budget - due.length * 2) / 5))
        : Math.floor((budget - due.length * 2) / 5);
    const pinned =
      i === 0 &&
      p.plan.minutes >= 20 &&
      budget > 0 &&
      sessionDone(p, today).length <
        sessionActivities(
          p.sessions?.[today]?.duration ?? Math.min(30, p.plan.minutes),
        ).length
        ? missions.find((m) => m.id === p.sessions?.[today]?.missionId)
        : undefined;
    const items = pinned ? [pinned] : pending.slice(index, index + slots);
    index += items.filter((m) => !p.completed[m.id]).length;
    return {
      date,
      active,
      items,
      due,
      guided: p.plan.minutes >= 20 && active && budget > 0,
      budget,
    };
  });
}
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
// A strict import boundary prevents a malformed backup from breaking the learning journey.
export function parseProgress(raw: string, ids: string[]): Progress {
  if (raw.length > 8_000_000) throw new Error("size");
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
      typeof x.plan.minutes === "number" &&
      [5, 10, 15, 20, 30, 45, 60].includes(x.plan.minutes)
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
  if (x.sessions !== undefined) {
    if (!object(x.sessions)) throw new Error("sessions");
    for (const [date, s] of Object.entries(x.sessions)) {
      if (
        !validDate(date) ||
        !object(s) ||
        !allowed.has(String(s.missionId)) ||
        (s.bankId !== undefined && (typeof s.bankId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.bankId) || s.bankId.length > 100)) ||
        [s.gistAnswer, s.retell].some((value) => value !== undefined && (typeof value !== "string" || value.length > 2000)) ||
        (s.retellChecks !== undefined && (!Array.isArray(s.retellChecks) || s.retellChecks.length > 5 || !s.retellChecks.every((value) => typeof value === "boolean"))) ||
        (s.duration !== undefined &&
          (typeof s.duration !== "number" ||
            ![5, 10, 15, 20, 30].includes(s.duration))) ||
        !Array.isArray(s.done) ||
        s.done.length > 6 ||
        new Set(s.done).size !== s.done.length ||
        !s.done.every((a) => SESSION_ORDER.includes(a)) ||
        ![s.warmup, s.inputAnswer, s.speaking, s.exit].every(
          (v) => typeof v === "string" && v.length <= 2000,
        ) ||
        !Array.isArray(s.recalled) ||
        s.recalled.length > 20 ||
        new Set(s.recalled).size !== s.recalled.length ||
        !s.recalled.every((v) => typeof v === "string" && v.length <= 200)
      )
        throw new Error("session");
    }
  }
  if (x.academy !== undefined) validateAcademy(x.academy);
  if (x.arcade !== undefined) validateArcade(x.arcade);
  return x as unknown as Progress;
}
