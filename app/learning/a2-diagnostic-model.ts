import { isCorrect, validDate } from "./learning-utils.ts";
import type { Pair, Progress } from "./types.ts";

export const a2DiagnosticChapterCounts: Readonly<Record<string, number>> = {
  "espresso2-u01": 2, "espresso2-u02": 3, "espresso2-u03": 3, "espresso2-u04": 4,
  "espresso2-u05": 2, "espresso2-u06": 3, "espresso2-u07": 4, "espresso2-u08": 3,
  "espresso2-u09": 2, "espresso2-u10": 3,
};
export const diagnosticItemIds = (chapterId: string): string[] => Array.from({ length: a2DiagnosticChapterCounts[chapterId] ?? 0 }, (_, index) => `a2-check-${chapterId.slice(-3)}-${index + 1}`);
export type A2DiagnosticAnswer = { answer: string; correct: boolean; assisted: boolean; date: string };
export type A2DiagnosticRun = {
  date: string; chapterId: string; itemIds: string[];
  answers: Record<string, A2DiagnosticAnswer>; drafts: Record<string, string>;
  hints: string[]; feedbackId?: string;
};
export type A2DiagnosticState = { version: 1; runs: Record<string, A2DiagnosticRun> };
export type A2DiagnosticItem = { id: string; unitId: string; prompt: Pair; answers: string[]; hint: Pair; explanation: Pair };
export type A2DiagnosticChapter = { id: string; title: Pair; missionId: string; items: A2DiagnosticItem[] };
export const emptyA2Diagnostics = (): A2DiagnosticState => ({ version: 1, runs: {} });
export const diagnosticRunKey = (date: string, chapterId: string) => `${date}:${chapterId}`;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const bounded = (value: unknown): value is string => typeof value === "string" && value.length <= 500;

/** Lightweight backup validation: stable diagnostic IDs, bounded text and exact run identity. */
export function validateA2Diagnostics(value: unknown): asserts value is A2DiagnosticState {
  if (!object(value) || value.version !== 1 || !object(value.runs) || Object.keys(value.runs).length > 400) throw new Error("a2-diagnostics");
  for (const [key, run] of Object.entries(value.runs)) {
    if (!object(run) || typeof run.date !== "string" || !validDate(run.date) || typeof run.chapterId !== "string"
      || !Object.hasOwn(a2DiagnosticChapterCounts, run.chapterId) || key !== diagnosticRunKey(run.date, run.chapterId)
      || !Array.isArray(run.itemIds) || JSON.stringify(run.itemIds) !== JSON.stringify(diagnosticItemIds(run.chapterId))
      || !object(run.answers) || !object(run.drafts) || !Array.isArray(run.hints)
      || run.hints.length > run.itemIds.length || new Set(run.hints).size !== run.hints.length
      || !run.hints.every((id) => typeof id === "string" && (run.itemIds as unknown[]).includes(id))) throw new Error("a2-diagnostic-run");
    const itemIds = run.itemIds as string[], answers = run.answers;
    const answered = Object.keys(answers);
    if (answered.length > itemIds.length || itemIds.slice(0, answered.length).some((id) => !Object.hasOwn(answers, id))) throw new Error("a2-diagnostic-order");
    for (const [id, answer] of Object.entries(answers)) {
      if (!itemIds.includes(id) || !object(answer) || !bounded(answer.answer) || !answer.answer.trim()
        || typeof answer.correct !== "boolean" || typeof answer.assisted !== "boolean"
        || typeof answer.date !== "string" || !validDate(answer.date) || answer.date < run.date) throw new Error("a2-diagnostic-answer");
    }
    const current = itemIds[answered.length];
    if (Object.entries(run.drafts).some(([id, answer]) => id !== current || !bounded(answer))) throw new Error("a2-diagnostic-draft");
    if (run.feedbackId !== undefined && (typeof run.feedbackId !== "string" || !Object.hasOwn(answers, run.feedbackId))) throw new Error("a2-diagnostic-feedback");
  }
}

export function startA2Diagnostic(state: A2DiagnosticState, chapterId: string, date: string): A2DiagnosticState {
  const itemIds = diagnosticItemIds(chapterId), key = diagnosticRunKey(date, chapterId);
  if (!validDate(date) || !itemIds.length || state.runs[key] || Object.keys(state.runs).length >= 400) return state;
  return { ...state, runs: { ...state.runs, [key]: { date, chapterId, itemIds, answers: {}, drafts: {}, hints: [] } } };
}
const currentItem = (run: A2DiagnosticRun) => run.itemIds.find((id) => !run.answers[id]);
export function saveA2DiagnosticDraft(state: A2DiagnosticState, key: string, id: string, answer: string): A2DiagnosticState {
  const run = state.runs[key];
  if (!run || currentItem(run) !== id || !bounded(answer) || run.drafts[id] === answer) return state;
  return { ...state, runs: { ...state.runs, [key]: { ...run, drafts: { [id]: answer } } } };
}
export function hintA2Diagnostic(state: A2DiagnosticState, key: string, id: string): A2DiagnosticState {
  const run = state.runs[key];
  if (!run || currentItem(run) !== id || run.hints.includes(id)) return state;
  return { ...state, runs: { ...state.runs, [key]: { ...run, hints: [...run.hints, id] } } };
}
export function answerA2Diagnostic(state: A2DiagnosticState, key: string, item: A2DiagnosticItem, answer: string, date: string): A2DiagnosticState {
  const run = state.runs[key];
  if (!run || currentItem(run) !== item.id || !validDate(date) || date < run.date || !bounded(answer) || !answer.trim()) return state;
  const first: A2DiagnosticAnswer = { answer, correct: isCorrect(answer, item.answers), assisted: run.hints.includes(item.id), date };
  return { ...state, runs: { ...state.runs, [key]: { ...run, answers: { ...run.answers, [item.id]: first }, drafts: {}, feedbackId: item.id } } };
}
export function continueA2Diagnostic(state: A2DiagnosticState, key: string): A2DiagnosticState {
  const run = state.runs[key];
  if (!run?.feedbackId) return state;
  return { ...state, runs: { ...state.runs, [key]: { ...run, feedbackId: undefined } } };
}

export type CatchUpUnit = { id: string; title: Pair; prerequisites: string[]; missionIds: string[] };
export type CatchUpStep = { kind: "prepare" | "practise" | "transfer"; route: string; title: Pair };
export function diagnosticCatchUp(p: Progress, item: A2DiagnosticItem, units: readonly CatchUpUnit[], chapter: A2DiagnosticChapter): CatchUpStep[] {
  const byId = new Map(units.map((unit) => [unit.id, unit])), target = byId.get(item.unitId);
  if (!target) return [];
  const seen = new Set<string>();
  const missing: CatchUpUnit[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return; seen.add(id);
    const unit = byId.get(id); if (!unit) return;
    for (const parent of unit.prerequisites) visit(parent);
    if (id !== target.id && !p.academy?.grammar[id]?.completed) missing.push(unit);
  };
  visit(target.id);
  return [
    ...missing.slice(0, 1).map((unit): CatchUpStep => ({ kind: "prepare", route: `grammar/${unit.id}`, title: unit.title })),
    { kind: "practise", route: `grammar/${target.id}`, title: target.title },
    { kind: "transfer", route: `lesson/${chapter.missionId}`, title: chapter.title },
  ];
}
