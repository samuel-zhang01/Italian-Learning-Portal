import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ORAL_RUNS, emptyOralPractice, oralRunKey, oralPracticeAtCapacity, oralPracticeIdentities, oralChoiceIds,
  startOralPractice, saveOralPrediction, saveOralChoice, checkOralChoice, advanceOralPractice,
  seeOralTranscript, seeOralModel, saveOralRetell, setOralRetellCheck, completeOralPractice,
  saveOralTransfer, setOralTransferCheck, seeOralTransferModel, completeOralTransfer, oralDueRuns, validateOralPractice,
} from "../app/learning/oral-practice-model.ts";
import { addDays, dailyMinutes, emptyProgress, parseProgress } from "../app/learning/engine.ts";
import { backupCounts, mergeProgressBackups } from "../app/learning/backup-merge.ts";
import { dailyStudyPlan, learningRewards } from "../app/learning/study.ts";
import { planningMissions, planningUnits, planningProgrammes, planningPages } from "../app/learning/planning-data.ts";

const day = "2026-10-20", tomorrow = "2026-10-21", scene = "oral-delay", key = oralRunKey(day, scene);
const ids = planningMissions.map((mission) => mission.id);
const roundtrip = (state) => { validateOralPractice(state); const p = emptyProgress(); p.oralPractice = state; return parseProgress(JSON.stringify(p), ids).oralPractice; };
const start = (budget = 5, date = day, id = scene) => startOralPractice(emptyOralPractice(), id, budget, date);
function retellReady(budget = 5) {
  let s = start(budget);
  s = saveOralChoice(s, key, "gist", "gist-b"); // A wrong first attempt must still allow progress.
  s = checkOralChoice(s, key, "gist", day); s = advanceOralPractice(s, key);
  if (budget === 10) { s = saveOralChoice(s, key, "detail", "detail-c"); s = checkOralChoice(s, key, "detail", day); s = advanceOralPractice(s, key); }
  return s;
}
function completed(budget = 5) {
  let s = saveOralRetell(retellReady(budget), key, "Ho preso l’autobus con mia sorella.");
  s = setOralRetellCheck(s, key, 0, true); s = setOralRetellCheck(s, key, 1, true);
  return completeOralPractice(s, key, day);
}

test("five-minute runs pin their budget, require an attempted gist check and skip the detail stage", () => {
  let s = start(); const initial = structuredClone(s);
  assert.equal(startOralPractice(s, scene, 10, day), s);
  assert.equal(advanceOralPractice(s, key), s); assert.equal(checkOralChoice(s, key, "gist", day), s);
  s = saveOralPrediction(s, key, "Forse qualcuno arriva in ritardo.");
  s = saveOralChoice(s, key, "gist", "gist-b"); s = checkOralChoice(s, key, "gist", day);
  assert.equal(s.runs[key].gist.first.correct, false);
  s = advanceOralPractice(s, key); assert.equal(s.runs[key].stage, "retell");
  assert.equal(saveOralChoice(s, key, "detail", "detail-c"), s);
  assert.deepEqual(initial, start()); roundtrip(s);
});

test("a saved pending choice and support exposure survive reload; wrong first evidence cannot be replaced", () => {
  let s = saveOralChoice(start(), key, "gist", "gist-c");
  s = seeOralTranscript(s, key); s = roundtrip(s);
  assert.equal(s.runs[key].gist.selection, "gist-c"); assert.equal(s.runs[key].gist.first, undefined);
  s = checkOralChoice(s, key, "gist", day);
  const first = structuredClone(s.runs[key].gist.first);
  assert.deepEqual(first, { choiceId: "gist-c", correct: false, supported: true, date: day });
  assert.equal(saveOralChoice(s, key, "gist", "gist-a"), s);
  assert.equal(checkOralChoice(s, key, "gist", tomorrow), s);
  assert.deepEqual(roundtrip(s).runs[key].gist.first, first);
});

test("ten-minute runs require their detail check; transcript or model exposure supports later checks without rewriting earlier ones", () => {
  let s = saveOralChoice(start(10), key, "gist", "gist-a"); s = checkOralChoice(s, key, "gist", day);
  assert.equal(s.runs[key].gist.first.supported, false);
  s = advanceOralPractice(s, key); assert.equal(s.runs[key].stage, "detail");
  assert.equal(advanceOralPractice(s, key), s); assert.equal(saveOralRetell(s, key, "Premature"), s);
  s = seeOralModel(s, key); s = saveOralChoice(s, key, "detail", "detail-a");
  assert.equal(checkOralChoice(s, key, "detail", "2026-10-19"), s);
  s = checkOralChoice(s, key, "detail", day);
  assert.equal(s.runs[key].detail.first.supported, true); assert.equal(s.runs[key].detail.first.correct, false);
  assert.equal(s.runs[key].gist.first.supported, false);
  s = advanceOralPractice(s, key); assert.equal(s.runs[key].stage, "retell"); roundtrip(s);
});

test("production is explicitly self-checked, edits reset its checks and completed original evidence is locked", () => {
  let s = retellReady(); assert.equal(completeOralPractice(s, key, day), s);
  s = saveOralRetell(s, key, "Unchanged initial draft."); s = setOralRetellCheck(s, key, 0, true);
  assert.equal(completeOralPractice(s, key, day), s);
  s = saveOralRetell(s, key, "Un cambiamento personale."); assert.deepEqual(s.runs[key].retellChecks, [false, false]);
  s = setOralRetellCheck(s, key, 0, true); s = setOralRetellCheck(s, key, 1, true);
  s = completeOralPractice(s, key, day);
  assert.equal(s.runs[key].stage, "complete"); assert.equal(s.runs[key].due, tomorrow);
  for (const candidate of [saveOralPrediction(s, key, "Rewrite"), saveOralRetell(s, key, "Rewrite"), setOralRetellCheck(s, key, 1, false), seeOralModel(s, key), seeOralTranscript(s, key), completeOralPractice(s, key, tomorrow)]) assert.equal(candidate, s);
  roundtrip(s);
});

test("next-day fresh transfer keeps its own draft, model and self-checks separate from all original evidence", () => {
  let s = completed(10), before = structuredClone(s.runs[key]);
  assert.deepEqual(oralDueRuns(s, day), []); assert.equal(oralDueRuns(s, tomorrow)[0].sceneId, scene);
  for (const candidate of [saveOralTransfer(s, key, "Too soon", day), seeOralTransferModel(s, key, day), setOralTransferCheck(s, key, 0, true, day), completeOralTransfer(s, key, day)]) assert.equal(candidate, s);
  s = saveOralTransfer(s, key, "Ora il viaggio è diverso.", tomorrow); s = seeOralTransferModel(s, key, tomorrow);
  s = setOralTransferCheck(s, key, 0, true, tomorrow);
  s = saveOralTransfer(s, key, "Ho scelto un altro mezzo.", tomorrow); assert.deepEqual(s.runs[key].transfer.checks, [false, false]);
  s = setOralTransferCheck(s, key, 0, true, tomorrow); s = setOralTransferCheck(s, key, 1, true, tomorrow);
  s = completeOralTransfer(s, key, tomorrow);
  assert.deepEqual({ ...s.runs[key], transfer: undefined }, { ...before, transfer: undefined });
  assert.equal(s.runs[key].transfer.modelSeen, true); assert.equal(s.runs[key].modelSeen, false);
  assert.deepEqual(oralDueRuns(s, tomorrow), []);
  assert.equal(saveOralTransfer(s, key, "Rewrite completed transfer", tomorrow), s);
  assert.equal(setOralTransferCheck(s, key, 0, false, tomorrow), s); assert.equal(completeOralTransfer(s, key, "2026-10-22"), s);
  roundtrip(s);
});

test("valid future calendars remain import-compatible but never surface as a transfer due before their exact next day", () => {
  const future = structuredClone(completed());
  const run = future.runs[key]; delete future.runs[key]; run.date = "2099-01-01"; run.gist.first.date = run.date; run.completed = run.date; run.due = "2099-01-02";
  future.runs[oralRunKey(run.date, scene)] = run;
  roundtrip(future); assert.deepEqual(oralDueRuns(future, day), []); assert.equal(oralDueRuns(future, run.due).length, 1);
});

test("exact oral schema rejects unknown/private fields at every evidence level", () => {
  const variants = [
    (s) => { s.recording = "synthetic"; },
    (s) => { s.runs[key].audioUrl = "blob:synthetic"; },
    (s) => { s.runs[key].transcript = "Pasted private text"; },
    (s) => { s.runs[key].gist.rawAnswer = "extra"; },
    (s) => { s.runs[key].gist.first.headers = {}; },
    (s) => { s.runs[key].transfer = { started: tomorrow, draft: "", checks: [false, false], modelSeen: false, recording: "extra" }; },
  ];
  for (const change of variants) { const s = completed(); change(s); assert.throws(() => validateOralPractice(s), /oral-practice/); }
});

test("validation rejects unknown identities, impossible evidence order, invalid dates, malformed scoring and oversized writing", () => {
  const variants = [
    (s) => { s.runs[key].sceneId = "unknown"; }, (s) => { s.runs[key].budget = 15; },
    (s) => { s.runs[key].gist.first.choiceId = "gist-z"; }, (s) => { s.runs[key].gist.first.correct = true; },
    (s) => { s.runs[key].gist.first.supported = true; }, (s) => { s.runs[key].gist.first.date = "2026-02-30"; },
    (s) => { s.runs[key].gist.first.date = "2026-10-19"; }, (s) => { s.runs[key].prediction = "x".repeat(501); },
    (s) => { s.runs[key].retellDraft = "x".repeat(2001); }, (s) => { s.runs[key].retellChecks = [true]; },
    (s) => { s.runs[key].due = "2026-10-25"; }, (s) => { s.runs[key].detail.selection = "detail-a"; },
    (s) => { s.runs[key].transfer = { started: day, draft: "draft", checks: [true, true], modelSeen: false, completed: tomorrow }; },
  ];
  for (const change of variants) { const s = completed(); change(s); assert.throws(() => validateOralPractice(s), /oral-practice/); }
  const premature = start(10); premature.runs[key].stage = "retell";
  assert.throws(() => validateOralPractice(premature), /oral-practice-order/);
});

test("sparse version-one backups roundtrip; merging keeps an entire overlapping local draft and first check while adding new runs", () => {
  const local = emptyProgress(), incoming = emptyProgress(); assert.equal(parseProgress(JSON.stringify(local), ids).oralPractice, undefined);
  local.oralPractice = saveOralPrediction(start(), key, "My local prediction."); incoming.oralPractice = completed();
  incoming.oralPractice = startOralPractice(incoming.oralPractice, "oral-market", 10, tomorrow);
  const localBefore = structuredClone(local), incomingBefore = structuredClone(incoming);
  const merged = mergeProgressBackups(local, incoming, ids, "2026-10-21T12:00:00Z");
  assert.deepEqual(local, localBefore); assert.deepEqual(incoming, incomingBefore);
  assert.deepEqual(merged.progress.oralPractice.runs[key], local.oralPractice.runs[key]);
  assert.equal(Object.keys(merged.progress.oralPractice.runs).length, 2); assert.equal(merged.additions, 1); assert.equal(merged.conflicts, 1);
  assert.equal(backupCounts(merged.progress).oralPractice, 2);
  assert.deepEqual(parseProgress(JSON.stringify(incoming), ids).oralPractice, incoming.oralPractice, "explicit replacement can still restore the complete selected backup");
});

test("the 200-run cap pauses starts without deleting evidence; an overflowing merge fails atomically", () => {
  let full = emptyOralPractice();
  for (let i = 0; i < MAX_ORAL_RUNS; i += 1) full = startOralPractice(full, scene, 5, addDays("2025-01-01", i));
  assert.equal(oralPracticeAtCapacity(full), true); assert.equal(Object.keys(full.runs).length, 200);
  assert.equal(startOralPractice(full, "oral-market", 10, tomorrow), full);
  const firstKey = Object.keys(full.runs)[0], edited = saveOralPrediction(full, firstKey, "Paused existing work remains editable.");
  assert.equal(edited.runs[firstKey].prediction, "Paused existing work remains editable.");
  const local = emptyProgress(), incoming = emptyProgress(); local.oralPractice = full; incoming.oralPractice = start();
  const before = structuredClone(local);
  assert.throws(() => mergeProgressBackups(local, incoming, ids), /oral-practice-merge-capacity/); assert.deepEqual(local, before);
  const malformed = structuredClone(full); malformed.runs[key] = start().runs[key];
  assert.throws(() => validateOralPractice(malformed), /oral-practice/); roundtrip(full);
});

test("oral completion and transfer do not award XP or alter the core ten-minute plan", () => {
  const before = emptyProgress(); before.plan.minutes = 10; before.plan.course = 2;
  const after = structuredClone(before); after.oralPractice = completed();
  const plan = (p) => dailyStudyPlan(p, planningMissions, planningUnits, planningProgrammes, planningPages, day);
  assert.deepEqual(learningRewards(after), learningRewards(before)); assert.equal(dailyMinutes(after, day), dailyMinutes(before, day));
  assert.deepEqual(plan(after), plan(before)); assert.deepEqual(after.plan, before.plan);
});

test("the authored scene choices exactly match the compact scoring identities without importing full scenes into progress validation", async () => {
  const { oralPracticeScenes } = await import("../app/learning/oral-practice-data.ts");
  assert.deepEqual(oralPracticeScenes.map((item) => item.id).sort(), Object.keys(oralPracticeIdentities).sort());
  for (const item of oralPracticeScenes) for (const kind of ["gist", "detail"]) {
    assert.deepEqual(item[kind].options.map((option) => option.id), oralChoiceIds(kind));
    assert.equal(item[kind].correctOptionId, oralPracticeIdentities[item.id][kind]);
    assert.equal(item.retell.rubric.length, 2); assert.equal(item.transfer.rubric.length, 2);
  }
});
