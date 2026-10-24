import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyProgress, parseProgress, dailyMinutes } from "../app/learning/engine.ts";
import {
  selectProgramme,
  programmeDayReady,
  completeProgrammeDay,
  getGrammarDraft,
  getProgrammePracticeDraft,
  updateProgrammePracticeDraft,
  completeProgrammePractice,
} from "../app/learning/academy-engine.ts";
import { dailyStudyPlan, emptySession, sessionLayout } from "../app/learning/study.ts";

const read = (name) => JSON.parse(readFileSync(new URL(`../app/learning/${name}.json`, import.meta.url), "utf8"));
const { missions } = read("curriculum");
const { units, programmes } = read("grammar");
const ids = missions.map((mission) => mission.id);
const today = "2026-10-24", yesterday = "2026-10-23", tomorrow = "2026-10-25";
const pair = (en, it = en) => ({ en, it });
const programme = {
  id: "distinct-daily-practice-test",
  title: pair("Two study days", "Due giorni di studio"),
  summary: pair("Reuse a skill with new details", "Riutilizza una struttura con nuovi dettagli"),
  days: ["A trip", "A new meeting"].map((title, index) => ({
    title: pair(title), unitIds: [units[0].id], missionIds: [missions[0].id],
    outcome: pair("Use familiar grammar independently", "Usa autonomamente la grammatica conosciuta"),
    practice: {
      prompt: pair(`Write about situation ${index + 1}.`, `Scrivi della situazione ${index + 1}.`),
      model: pair("I am from Rome and I study Italian.", "Sono di Roma e studio italiano."),
      rubric: [pair("I used my own details.", "Ho usato i miei dettagli."), pair("I checked the verb.", "Ho controllato il verbo.")],
    },
  })),
};
const completion = (date = yesterday) => ({
  date, firstCorrect: 2, total: 2, output: "Sono una persona curiosa.", supported: false, confidence: 2,
});
function prepared(route = programme) {
  const p = selectProgramme(emptyProgress(), route.id, today);
  for (const day of route.days) {
    for (const id of day.unitIds) p.academy.grammar[id] = { ...getGrammarDraft(p, id), completed: yesterday };
    for (const id of day.missionIds) p.completed[id] = completion();
  }
  return p;
}
const restore = (p) => parseProgress(JSON.stringify(p), ids);
test("every programme day starts a valid session with the displayed time and unchanged remaining blocks", () => {
  const supportedDurations = [5, 10, 15, 20, 30];
  for (const route of programmes) for (let dayIndex = 0; dayIndex < route.days.length; dayIndex++) {
    for (const minutes of [5, 10, 15, 20, 30, 45, 60]) {
      const p = selectProgramme(emptyProgress(), route.id, today);
      p.academy.programme.day = dayIndex; p.plan.minutes = minutes;
      const before = dailyStudyPlan(p, missions, units, programmes, [], today);
      const label = `${route.id}/${dayIndex + 1}/${minutes}`;
      assert.ok(supportedDurations.includes(before.duration), `${label}: valid saved duration`);
      assert.equal(Object.values(sessionLayout(before.duration)).reduce((a, b) => a + b, 0), before.duration, `${label}: actual activities fit displayed time`);
      p.sessions = { [today]: emptySession(before.mission.id, before.duration) };
      const after = dailyStudyPlan(restore(p), missions, units, programmes, [], today);
      assert.equal(after.duration, before.duration, `${label}: duration survives validated reload`);
      assert.deepEqual(after.blocks, before.blocks, `${label}: starting must not change other planned blocks`);
      assert.ok(after.blocks.reduce((sum, block) => sum + block.minutes, 0) <= minutes, `${label}: daily budget`);
    }
  }
});
const plan = (p, date = today) => dailyStudyPlan(p, missions, units, [programme], [], date);
function write(p, index = p.academy.programme.day) {
  return updateProgrammePracticeDraft(p, programme, index, {
    output: index === 0 ? "Sono italiana e studio a Roma." : "Mi chiamo Anna e lavoro a Torino.",
    rubric: [0, 1], modelSeen: index > 0,
  });
}

test("reused grammar and missions cannot complete a future day without its distinct personal checkpoint", () => {
  let p = prepared();
  const oldLessons = structuredClone(p.completed), oldGrammar = structuredClone(p.academy.grammar);
  assert.equal(programmeDayReady(p, programme, 0), false);
  assert.strictEqual(completeProgrammeDay(p, programme, 0, today), p);
  assert.strictEqual(updateProgrammePracticeDraft(p, programme, 1, { output: "Una risposta troppo presto." }), p);
  p = completeProgrammePractice(write(p), programme, 0, today);
  assert.equal(programmeDayReady(p, programme, 0), true);
  p = completeProgrammeDay(p, programme, 0, today);
  assert.equal(p.academy.programme.day, 1);
  assert.equal(programmeDayReady(p, programme, 1), false);
  assert.deepEqual(getProgrammePracticeDraft(p, programme, 1), { output: "", rubric: [], modelSeen: false });
  assert.equal(plan(p, tomorrow).next.route, "programmes");
  assert.equal(plan(p, tomorrow).dayReady, false);
  assert.equal(getProgrammePracticeDraft(p, programme, 0).completed, today);
  p = completeProgrammePractice(write(p), programme, 1, tomorrow);
  p = completeProgrammeDay(p, programme, 1, tomorrow);
  assert.equal(p.academy.programme.day, 2);
  assert.equal(p.academy.programme.practice["1"].completed, tomorrow);
  assert.deepEqual(p.completed, oldLessons);
  assert.deepEqual(p.academy.grammar, oldGrammar);
});

test("self-assessed completion requires a draft, all criteria and the active study day", () => {
  let p = prepared();
  assert.strictEqual(completeProgrammePractice(p, programme, 0, today), p);
  p = updateProgrammePracticeDraft(p, programme, 0, { output: "Ciao", rubric: [0, 1] });
  assert.strictEqual(completeProgrammePractice(p, programme, 0, today), p);
  p = updateProgrammePracticeDraft(p, programme, 0, { output: "Io studio italiano.", rubric: [0] });
  assert.strictEqual(completeProgrammePractice(p, programme, 0, today), p);
  p = updateProgrammePracticeDraft(p, programme, 0, { rubric: [0, 1] });
  assert.strictEqual(completeProgrammePractice(p, programme, 0, "2026-02-30"), p);
  assert.strictEqual(completeProgrammePractice(p, programme, 1, today), p);
  assert.strictEqual(completeProgrammePractice(p, { ...programme, id: "another-route" }, 0, today), p);
  assert.strictEqual(updateProgrammePracticeDraft(p, programme, 0, { output: "x".repeat(2001) }), p);
  assert.strictEqual(updateProgrammePracticeDraft(p, programme, 0, { rubric: [0, 0] }), p);
  assert.strictEqual(updateProgrammePracticeDraft(p, programme, 0, { rubric: [0, 2] }), p);
  const untrustedPatch = updateProgrammePracticeDraft(p, programme, 0, { completed: today });
  assert.equal(getProgrammePracticeDraft(untrustedPatch, programme, 0).completed, undefined);
  assert.equal(programmeDayReady(untrustedPatch, programme, 0), false);
});

test("drafts, model support and each completed day survive reload and version-one backup restoration", () => {
  const original = emptyProgress();
  assert.deepEqual(restore(original), original, "a backup without academy data stays unchanged");
  let p = updateProgrammePracticeDraft(prepared(), programme, 0, {
    output: "Sono francese e abito a Bari.", rubric: [0], modelSeen: true,
  });
  p = restore(p);
  assert.deepEqual(getProgrammePracticeDraft(p, programme, 0), {
    output: "Sono francese e abito a Bari.", rubric: [0], modelSeen: true,
  });
  p = updateProgrammePracticeDraft(p, programme, 0, { rubric: [0, 1] });
  p = completeProgrammePractice(p, programme, 0, today);
  assert.deepEqual(restore(p), p);
  p = completeProgrammeDay(restore(p), programme, 0, today);
  assert.equal(restore(p).academy.programme.practice["0"].output, "Sono francese e abito a Bari.");
});

test("legacy programmes without personal checkpoints retain their original completion rules", () => {
  for (const route of programmes.filter((item) => !item.days.some((day) => day.practice))) {
    let p = prepared(route);
    assert.equal(p.academy.programme.practice, undefined);
    assert.equal(programmeDayReady(p, route, 0), true);
    p = completeProgrammeDay(p, route, 0, today);
    assert.equal(p.academy.programme.day, 1);
    assert.deepEqual(restore(p), p);
  }
});

test("backup validation rejects malformed or unbounded personal practice records", () => {
  const good = { output: "Io studio italiano.", rubric: [0, 1], modelSeen: false };
  const malformed = [
    null, [], { ...good, output: "x".repeat(2001) }, { ...good, output: 3 },
    { ...good, rubric: [0, 0] }, { ...good, rubric: [-1] }, { ...good, rubric: [10] },
    { ...good, rubric: [true] }, { ...good, rubric: "0,1" },
    { ...good, modelSeen: "false" }, { ...good, completed: "2026-02-30" },
    { ...good, completed: today, output: "" },
  ];
  for (const draft of malformed) {
    const p = prepared();
    p.academy.programme.practice = { "0": draft };
    assert.throws(() => restore(p), /programme-practice/);
  }
  for (const key of ["-1", "366", "01", "__proto__"]) {
    const p = prepared();
    p.academy.programme.practice = { [key]: good };
    assert.throws(() => restore(p), /programme-practice/);
  }
  for (const record of [[], null, "draft"]) {
    const p = prepared();
    p.academy.programme.practice = record;
    assert.throws(() => restore(p), /programme-practice/);
  }
});

test("personal-practice time is credited once on completion and completed evidence stays fixed", () => {
  let p = write(prepared());
  assert.equal(dailyMinutes(p, today), 0, "drafts and ticked criteria do not award time");
  p = completeProgrammePractice(p, programme, 0, today);
  assert.equal(dailyMinutes(p, today), 5);
  assert.strictEqual(completeProgrammePractice(p, programme, 0, today), p);
  assert.strictEqual(updateProgrammePracticeDraft(p, programme, 0, { output: "A changed response." }), p);
  p = completeProgrammeDay(p, programme, 0, today);
  assert.equal(dailyMinutes(p, today), 5, "saving the programme day does not duplicate practice time");
  assert.equal(dailyMinutes(restore(p), today), 5);
  assert.equal(dailyMinutes(p, tomorrow), 0);
});

test("pending personal practice has a five-minute Programme action inside every daily budget", () => {
  for (const minutes of [5, 10, 15, 20, 30, 45, 60]) {
    const p = prepared();
    p.plan.minutes = minutes;
    const itinerary = plan(p);
    assert.equal(itinerary.next.route, "programmes", `${minutes}-minute sitting`);
    assert.equal(itinerary.next.minutes, 5);
    assert.equal(itinerary.dayReady, false);
    assert.ok(itinerary.blocks.reduce((sum, block) => sum + block.minutes, 0) <= minutes);
  }
  const p = prepared();
  p.plan.minutes = 10;
  p.sessions = { [today]: { ...emptySession(missions[0].id, 30), warmup: "Keep this paused draft." } };
  const saved = structuredClone(p.sessions[today]);
  const itinerary = plan(p);
  assert.equal(itinerary.duration, 30);
  assert.equal(itinerary.blocks.reduce((sum, block) => sum + block.minutes, 0), 10);
  assert.equal(itinerary.blocks.find((block) => block.route === "programmes").minutes, 5);
  assert.deepEqual(p.sessions[today], saved);
});

test("five-minute sittings progress through application, grammar and a distinct personal checkpoint", () => {
  let p = selectProgramme(emptyProgress(), programme.id, today);
  p.plan.minutes = 5;
  assert.equal(plan(p).next.route, "session");
  p.completed[missions[0].id] = completion(today);
  p.sessions = { [today]: { ...emptySession(missions[0].id, 5), done: ["core"] } };
  assert.equal(plan(p).next, undefined);
  assert.equal(plan(p).dayReady, false);
  assert.equal(plan(p, tomorrow).next.route, `grammar/${units[0].id}`);
  p.academy.grammar[units[0].id] = { ...getGrammarDraft(p, units[0].id), completed: tomorrow };
  assert.equal(plan(p, tomorrow).next, undefined, "grammar used this sitting's five-minute block");
  assert.equal(plan(p, tomorrow).dayReady, false, "grammar does not replace personal transfer");
  const nextSitting = "2026-10-26";
  assert.equal(plan(p, nextSitting).next.route, "programmes");
  p = completeProgrammePractice(write(p), programme, 0, nextSitting);
  assert.equal(plan(p, nextSitting).next, undefined);
  assert.equal(plan(p, nextSitting).dayReady, true);
  assert.equal(plan(p, nextSitting).blocks.length, 1);
});
