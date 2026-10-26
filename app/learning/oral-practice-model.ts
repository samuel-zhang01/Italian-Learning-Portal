import { addDays, validDate } from "./learning-utils.ts";
import type { Pair } from "./types.ts";

export type OralCheckKind = "gist" | "detail";
export type OralPracticeStage = OralCheckKind | "retell" | "complete";
export type OralPracticeChoice = { id: OralCheckKind; prompt: Pair; options: readonly { id: string; label: Pair }[]; correctOptionId: string; explanation: Pair };
export type OralPracticeProduction = { prompt: Pair; frame: Pair; model: Pair; rubric: readonly [Pair, Pair] };
export type OralPracticeScene = {
  id: string; level: "A1" | "A2"; title: Pair; context: Pair;
  lines: readonly { speaker: "A" | "B"; text: Pair }[];
  gist: OralPracticeChoice; detail: OralPracticeChoice;
  retell: OralPracticeProduction; transfer: OralPracticeProduction;
};
export type OralFirstCheck = { choiceId: string; correct: boolean; supported: boolean; date: string };
export type OralChoiceState = { selection: string; first?: OralFirstCheck };
export type OralTransfer = { started: string; draft: string; checks: [boolean, boolean]; modelSeen: boolean; completed?: string };
export type OralPracticeRun = {
  date: string; sceneId: string; budget: 5 | 10; stage: OralPracticeStage;
  prediction: string; gist: OralChoiceState; detail: OralChoiceState;
  transcriptSeen: boolean; modelSeen: boolean; retellDraft: string; retellChecks: [boolean, boolean];
  completed?: string; due?: string; transfer?: OralTransfer;
};
export type OralPracticeState = { version: 1; runs: Record<string, OralPracticeRun> };
export const MAX_ORAL_RUNS = 200;

// Only stable identities and scoring keys enter the initial validation bundle.
// Full original scenes are imported by the dedicated lazy practice view.
export const oralPracticeIdentities: Readonly<Record<string, Record<OralCheckKind, string>>> = {
  "oral-market": { gist: "gist-b", detail: "detail-a" },
  "oral-invitation": { gist: "gist-c", detail: "detail-b" },
  "oral-delay": { gist: "gist-a", detail: "detail-c" },
};
export const oralChoiceIds = (kind: OralCheckKind) => ["a", "b", "c"].map((suffix) => `${kind}-${suffix}`);
export const oralRunKey = (date: string, sceneId: string) => `${date}:${sceneId}`;
export const emptyOralPractice = (): OralPracticeState => ({ version: 1, runs: {} });
export const oralPracticeAtCapacity = (state: OralPracticeState) => Object.keys(state.runs).length >= MAX_ORAL_RUNS;
const has = (value: object, key: PropertyKey) => Object.hasOwn(value, key);
const knownScene = (id: string) => has(oralPracticeIdentities, id);
const bounded = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const pairOfChecks = (value: unknown): value is [boolean, boolean] => Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === "boolean");
const nonempty = (value: string) => Boolean(value.trim());
const exact = (value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && required.every((key) => has(value, key))
  && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));

/** Exact bounded evidence boundary; recordings, pasted transcripts and URLs have no fields here. */
export function validateOralPractice(value: unknown): asserts value is OralPracticeState {
  if (!exact(value, ["version", "runs"]) || value.version !== 1 || !exact(value.runs, [], Object.keys(value.runs ?? {}))
    || Object.keys(value.runs).length > MAX_ORAL_RUNS) throw new Error("oral-practice");
  for (const [key, run] of Object.entries(value.runs)) {
    if (!exact(run, ["date", "sceneId", "budget", "stage", "prediction", "gist", "detail", "transcriptSeen", "modelSeen", "retellDraft", "retellChecks"], ["completed", "due", "transfer"])
      || !validDate(run.date) || typeof run.sceneId !== "string" || !knownScene(run.sceneId) || key !== oralRunKey(run.date, run.sceneId)
      || (run.budget !== 5 && run.budget !== 10) || !["gist", "detail", "retell", "complete"].includes(String(run.stage))
      || !bounded(run.prediction, 500) || typeof run.transcriptSeen !== "boolean" || typeof run.modelSeen !== "boolean"
      || !bounded(run.retellDraft, 2000) || !pairOfChecks(run.retellChecks)
      || (!nonempty(run.retellDraft) && run.retellChecks.some(Boolean))) throw new Error("oral-practice-run");
    for (const kind of ["gist", "detail"] as const) {
      const check = run[kind];
      if (!exact(check, ["selection"], ["first"]) || typeof check.selection !== "string"
        || (check.selection !== "" && !oralChoiceIds(kind).includes(check.selection))) throw new Error("oral-practice-selection");
      if (check.first !== undefined) {
        const first = check.first;
        if (!exact(first, ["choiceId", "correct", "supported", "date"]) || !oralChoiceIds(kind).includes(String(first.choiceId))
          || check.selection !== first.choiceId || typeof first.correct !== "boolean" || first.correct !== (first.choiceId === oralPracticeIdentities[run.sceneId][kind])
          || typeof first.supported !== "boolean" || (first.supported && !run.transcriptSeen && !run.modelSeen)
          || !validDate(first.date) || first.date < run.date) throw new Error("oral-practice-first");
      }
    }
    const r = run as unknown as OralPracticeRun;
    if ((r.budget === 5 && (r.detail.selection !== "" || r.detail.first || r.stage === "detail"))
      || (r.detail.first && (!r.gist.first || r.detail.first.date < r.gist.first.date))
      || (r.stage !== "gist" && !r.gist.first)
      || ((r.stage === "retell" || r.stage === "complete") && r.budget === 10 && !r.detail.first)
      || ((r.stage === "gist" || r.stage === "detail") && (r.retellDraft !== "" || r.retellChecks.some(Boolean)))
      || (r.stage === "gist" && (r.detail.selection !== "" || r.detail.first))) throw new Error("oral-practice-order");
    if (r.stage === "complete") {
      if (!validDate(r.completed) || r.completed < (r.detail.first?.date ?? r.gist.first!.date)
        || r.due !== addDays(r.completed, 1) || !nonempty(r.retellDraft) || !r.retellChecks.every(Boolean)) throw new Error("oral-practice-completion");
    } else if (r.completed !== undefined || r.due !== undefined || r.transfer !== undefined) throw new Error("oral-practice-completion");
    if (r.transfer !== undefined) {
      const transfer = r.transfer;
      if (!exact(transfer, ["started", "draft", "checks", "modelSeen"], ["completed"])
        || !validDate(transfer.started) || transfer.started < r.due!
        || !bounded(transfer.draft, 2000) || !pairOfChecks(transfer.checks) || typeof transfer.modelSeen !== "boolean"
        || (!nonempty(transfer.draft) && transfer.checks.some(Boolean))
        || (transfer.completed !== undefined && (!validDate(transfer.completed) || transfer.completed < transfer.started
          || !nonempty(transfer.draft) || !transfer.checks.every(Boolean)))) throw new Error("oral-practice-transfer");
    }
  }
}

function updateRun(state: OralPracticeState, key: string, change: (run: OralPracticeRun) => OralPracticeRun): OralPracticeState {
  if (!has(state.runs, key)) return state;
  const run = state.runs[key], next = change(run);
  return next === run ? state : { ...state, runs: { ...state.runs, [key]: next } };
}
export function startOralPractice(state: OralPracticeState, sceneId: string, budget: 5 | 10, date: string): OralPracticeState {
  const key = oralRunKey(date, sceneId);
  if (!validDate(date) || !knownScene(sceneId) || (budget !== 5 && budget !== 10) || has(state.runs, key) || oralPracticeAtCapacity(state)) return state;
  return { ...state, runs: { ...state.runs, [key]: { date, sceneId, budget, stage: "gist", prediction: "", gist: { selection: "" }, detail: { selection: "" }, transcriptSeen: false, modelSeen: false, retellDraft: "", retellChecks: [false, false] } } };
}
export function saveOralPrediction(state: OralPracticeState, key: string, prediction: string): OralPracticeState {
  return updateRun(state, key, (run) => run.stage !== "gist" || !bounded(prediction, 500) || run.prediction === prediction ? run : { ...run, prediction });
}
export function saveOralChoice(state: OralPracticeState, key: string, kind: OralCheckKind, selection: string): OralPracticeState {
  if (kind !== "gist" && kind !== "detail") return state;
  return updateRun(state, key, (run) => run.stage !== kind || run[kind].first || !oralChoiceIds(kind).includes(selection) || run[kind].selection === selection ? run : { ...run, [kind]: { selection } });
}
export function checkOralChoice(state: OralPracticeState, key: string, kind: OralCheckKind, date: string): OralPracticeState {
  if (kind !== "gist" && kind !== "detail") return state;
  return updateRun(state, key, (run) => {
    const check = run[kind];
    if (run.stage !== kind || check.first || !oralChoiceIds(kind).includes(check.selection) || !validDate(date)
      || date < (kind === "detail" ? run.gist.first?.date ?? run.date : run.date)) return run;
    const first: OralFirstCheck = { choiceId: check.selection, correct: check.selection === oralPracticeIdentities[run.sceneId][kind], supported: run.transcriptSeen || run.modelSeen, date };
    return { ...run, [kind]: { ...check, first } };
  });
}
export function advanceOralPractice(state: OralPracticeState, key: string): OralPracticeState {
  return updateRun(state, key, (run) => run.stage === "gist" && run.gist.first ? { ...run, stage: run.budget === 5 ? "retell" : "detail" }
    : run.stage === "detail" && run.detail.first ? { ...run, stage: "retell" } : run);
}
export function seeOralTranscript(state: OralPracticeState, key: string): OralPracticeState {
  return updateRun(state, key, (run) => run.completed || run.transcriptSeen ? run : { ...run, transcriptSeen: true });
}
export function seeOralModel(state: OralPracticeState, key: string): OralPracticeState {
  return updateRun(state, key, (run) => run.completed || run.modelSeen ? run : { ...run, modelSeen: true });
}
export function saveOralRetell(state: OralPracticeState, key: string, draft: string): OralPracticeState {
  return updateRun(state, key, (run) => run.stage !== "retell" || !bounded(draft, 2000) || run.retellDraft === draft ? run : { ...run, retellDraft: draft, retellChecks: [false, false] });
}
export function setOralRetellCheck(state: OralPracticeState, key: string, index: number, checked: boolean): OralPracticeState {
  return updateRun(state, key, (run) => run.stage !== "retell" || !nonempty(run.retellDraft) || ![0, 1].includes(index)
    || typeof checked !== "boolean" || run.retellChecks[index] === checked ? run
    : { ...run, retellChecks: run.retellChecks.map((value, i) => i === index ? checked : value) as [boolean, boolean] });
}
export function completeOralPractice(state: OralPracticeState, key: string, date: string): OralPracticeState {
  return updateRun(state, key, (run) => run.stage !== "retell" || !nonempty(run.retellDraft) || !run.retellChecks.every(Boolean)
    || !validDate(date) || date < (run.detail.first?.date ?? run.gist.first?.date ?? run.date) ? run
    : { ...run, stage: "complete", completed: date, due: addDays(date, 1) });
}
function updateTransfer(state: OralPracticeState, key: string, date: string, change: (transfer: OralTransfer) => OralTransfer): OralPracticeState {
  return updateRun(state, key, (run) => {
    if (!run.completed || !run.due || !validDate(date) || date < run.due || run.transfer?.completed || (run.transfer && date < run.transfer.started)) return run;
    const transfer = run.transfer ?? { started: date, draft: "", checks: [false, false] as [boolean, boolean], modelSeen: false };
    const next = change(transfer);
    return next === transfer ? run : { ...run, transfer: next };
  });
}
export function saveOralTransfer(state: OralPracticeState, key: string, draft: string, date: string): OralPracticeState {
  if (!bounded(draft, 2000)) return state;
  return updateTransfer(state, key, date, (transfer) => draft === transfer.draft ? transfer : { ...transfer, draft, checks: [false, false] });
}
export function setOralTransferCheck(state: OralPracticeState, key: string, index: number, checked: boolean, date: string): OralPracticeState {
  if (![0, 1].includes(index) || typeof checked !== "boolean") return state;
  return updateTransfer(state, key, date, (transfer) => !nonempty(transfer.draft) || transfer.checks[index] === checked ? transfer
    : { ...transfer, checks: transfer.checks.map((value, i) => i === index ? checked : value) as [boolean, boolean] });
}
export function seeOralTransferModel(state: OralPracticeState, key: string, date: string): OralPracticeState {
  return updateTransfer(state, key, date, (transfer) => transfer.modelSeen ? transfer : { ...transfer, modelSeen: true });
}
export function completeOralTransfer(state: OralPracticeState, key: string, date: string): OralPracticeState {
  return updateTransfer(state, key, date, (transfer) => !nonempty(transfer.draft) || !transfer.checks.every(Boolean) ? transfer : { ...transfer, completed: date });
}
export function oralDueRuns(state: OralPracticeState, date: string): OralPracticeRun[] {
  if (!validDate(date)) return [];
  return Object.values(state.runs).filter((run) => run.completed && run.due && run.due <= date && !run.transfer?.completed)
    .sort((a, b) => a.due!.localeCompare(b.due!) || a.date.localeCompare(b.date) || a.sceneId.localeCompare(b.sceneId));
}
