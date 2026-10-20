import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyProgress, parseProgress } from "../app/learning/engine.ts";
import { learningRewards } from "../app/learning/study.ts";
import {
  answerArcade,
  arcadeDue,
  arcadeMistakes,
  emptyArcade,
  finishArcadeRound,
  hintArcade,
  nextArcadeItem,
  shuffled,
  startArcadeRound,
  updateArcadeDraft,
  validateArcade,
} from "../app/learning/arcade-engine.ts";
import {
  arcadeItemById,
  arcadeItems,
  arcadePool,
  arcadeScenes,
  arcadeUnits,
} from "../app/learning/arcade-catalogue.ts";
const today = "2026-10-20";
const ids = JSON.parse(
  readFileSync(new URL("../app/learning/curriculum.json", import.meta.url)),
).missions.map((m) => m.id);
const initial = () => ({ ...emptyProgress(), arcade: emptyArcade() });
const start = (p = initial(), date = today) =>
  startArcadeRound(p, arcadePool(p.arcade.settings), date, "test-round");
const item = (p) =>
  arcadeItemById.get(p.arcade.active.itemIds[p.arcade.active.index]);
const valid = (p) => parseProgress(JSON.stringify(p), ids);
const pair = (x) => assert.ok(x?.en?.trim() && x?.it?.trim());

test("arcade catalogue has unique bilingual items, bounded grammar links and 24 original conversation turns", () => {
  assert.equal(new Set(arcadeItems.map((x) => x.id)).size, arcadeItems.length);
  for (const x of arcadeItems) {
    [x.title, x.prompt, x.hint, x.explanation].forEach(pair);
    assert.ok(x.answers.length);
    if (x.options) {
      assert.equal(new Set(x.options).size, x.options.length);
      assert.ok(x.options.includes(x.answers[0]));
    }
    if (x.unitId) assert.ok(arcadeUnits.some((u) => u.id === x.unitId));
    if (x.tokens) {
      assert.equal(
        x.tokens.length,
        x.answers[0].replace(/[.!?]$/g, "").split(/\s+/).length,
      );
      assert.deepEqual(
        [...x.tokens].sort(),
        x.answers[0]
          .replace(/[.!?]$/g, "")
          .split(/\s+/)
          .sort(),
        `${x.id}: tiles must form the model with correct casing`,
      );
    }
  }
  assert.equal(arcadeScenes.length, 8);
  assert.equal(arcadeItems.filter((x) => x.mode === "conversation").length, 24);
  for (const scene of arcadeScenes) {
    pair(scene.intro);
    assert.equal(scene.turns.length, 3);
  }
});
test("all four default pools are playable and grammar defaults exclude past and stretch topics", () => {
  for (const mode of ["words", "builder", "detective", "conversation"]) {
    const settings = { ...emptyArcade().settings, mode };
    assert.ok(arcadePool(settings).length >= (mode === "conversation" ? 3 : 5));
    if (["builder", "detective"].includes(mode))
      assert.ok(
        arcadePool(settings).every((x) =>
          arcadeUnits.slice(0, 10).some((u) => u.id === x.unitId),
        ),
      );
  }
});
test("round sizes are capped by unique available items; conversations preserve turn order", () => {
  for (const size of [5, 10, 15]) {
    let p = initial();
    p.arcade.settings.size = size;
    p = start(p);
    assert.equal(p.arcade.active.itemIds.length, Math.min(8, size));
    valid(p);
  }
  const p = initial();
  p.arcade.settings.mode = "conversation";
  const pool = arcadePool(p.arcade.settings);
  assert.deepEqual(
    start(p).arcade.active.itemIds,
    pool.map((x) => x.id),
  );
  assert.deepEqual(
    shuffled([1, 2, 3, 4], "seed"),
    shuffled([1, 2, 3, 4], "seed"),
  );
});
test("wrong first answers remain immutable, survive reload and do not allow skipping", () => {
  let p = start();
  const q = item(p);
  assert.equal(nextArcadeItem(p), p);
  p = answerArcade(p, q, "wrong", today);
  const checked = p;
  assert.equal(answerArcade(p, q, q.answers[0], today), checked);
  assert.equal(updateArcadeDraft(p, "changed"), checked);
  assert.equal(valid(p).arcade.active.answers[q.id].correct, false);
  assert.equal(finishArcadeRound(p), p);
  assert.equal(nextArcadeItem(p).arcade.active.index, 1);
});
test("hints persist, mark supported answers, and keep the next recall tomorrow", () => {
  let p = start();
  const q = item(p);
  p = hintArcade(p);
  p = valid(p);
  p = answerArcade(p, q, q.answers[0], today);
  assert.equal(p.arcade.records[q.id].last.assisted, true);
  assert.equal(p.arcade.records[q.id].successes, 0);
  assert.equal(p.arcade.records[q.id].due, "2026-10-21");
  assert.equal(arcadeMistakes(p, arcadeItems).length, 1);
});
test("same-day replay repairs practice without farming XP or advancing the review interval", () => {
  let p = start();
  const q = item(p);
  p = answerArcade(p, q, "wrong", today);
  const xp = learningRewards(p).xp;
  p.arcade.active = null;
  p = startArcadeRound(p, [q], today, "replay", true);
  p = answerArcade(p, q, q.answers[0], today);
  assert.equal(p.arcade.records[q.id].first.correct, false);
  assert.equal(p.arcade.records[q.id].last.correct, true);
  assert.equal(p.arcade.records[q.id].successes, 0);
  assert.equal(p.arcade.records[q.id].due, "2026-10-21");
  assert.equal(learningRewards(p).xp, xp);
  assert.equal(arcadeMistakes(p, arcadeItems).length, 0);
  assert.equal(arcadeDue(p, arcadeItems, "2026-10-21").length, 1);
});
test("successful recall on separate days spaces reviews at one, three and seven days; errors reset", () => {
  let p = initial();
  const q = arcadePool(p.arcade.settings)[0];
  for (const [date, due] of [
    [today, "2026-10-21"],
    ["2026-10-21", "2026-10-24"],
    ["2026-10-24", "2026-10-31"],
  ]) {
    p = startArcadeRound(p, [q], date, date, true);
    p = answerArcade(p, q, q.answers[0], date);
    assert.equal(p.arcade.records[q.id].due, due);
    p = finishArcadeRound(p);
  }
  p = startArcadeRound(p, [q], "2026-10-31", "error", true);
  p = answerArcade(p, q, "wrong", "2026-10-31");
  assert.equal(p.arcade.records[q.id].due, "2026-11-01");
  assert.equal(p.arcade.records[q.id].successes, 0);
});
test("early practice does not postpone a scheduled recall", () => {
  let p = initial();
  const q = arcadePool(p.arcade.settings)[0];
  for (const date of [today, "2026-10-21"]) {
    p = startArcadeRound(p, [q], date, date, true);
    p = finishArcadeRound(answerArcade(p, q, q.answers[0], date));
  }
  assert.equal(p.arcade.records[q.id].due, "2026-10-24");
  p = startArcadeRound(p, [q], "2026-10-22", "early", true);
  p = answerArcade(p, q, q.answers[0], "2026-10-22");
  assert.equal(p.arcade.records[q.id].due, "2026-10-24");
  assert.equal(p.arcade.records[q.id].successes, 2);
});

test("saved drafts and tile positions survive backup; settings never replace an active round", () => {
  let p = start();
  p = updateArcadeDraft(p, "La chiave", [2, 1]);
  p = valid(p);
  assert.equal(p.arcade.active.draft, "La chiave");
  assert.deepEqual(p.arcade.active.tokens, [2, 1]);
  assert.equal(startArcadeRound(p, arcadeItems, today, "other"), p);
});
test("finished rounds retain accurate independent/support totals and cap recent history at 30", () => {
  let p = initial();
  for (let round = 0; round < 32; round++) {
    p = start(p);
    for (let n = 0; n < p.arcade.active.itemIds.length; n++) {
      const q = item(p);
      if (n === 1) p = hintArcade(p);
      p = answerArcade(p, q, n === 2 ? "wrong" : q.answers[0], today);
      if (n < p.arcade.active.itemIds.length - 1) p = nextArcadeItem(p);
    }
    p.arcade.active.id = `round-${round}`;
    p = finishArcadeRound(p);
  }
  assert.equal(p.arcade.history.length, 30);
  assert.deepEqual(
    {
      total: p.arcade.history.at(-1).total,
      independent: p.arcade.history.at(-1).independent,
      supported: p.arcade.history.at(-1).supported,
    },
    { total: 5, independent: 3, supported: 1 },
  );
  valid(p);
});
test("old backups still load; malformed arcade imports cannot replace progress", () => {
  assert.equal(valid(emptyProgress()).arcade, undefined);
  for (const alter of [
    (a) => {
      a.settings.size = "5";
    },
    (a) => {
      a.settings.mode = "unknown";
    },
    (a) => {
      a.active.index = 99;
    },
    (a) => {
      a.active.tokens = [-1];
    },
    (a) => {
      a.active.itemIds.push(a.active.itemIds[0]);
    },
    (a) => {
      a.active.hints = ["unknown"];
    },
    (a) => {
      a.active.answers[a.active.itemIds[1]] = {
        answer: "x",
        correct: true,
        assisted: false,
      };
    },
    (a) => {
      a.history = [
        {
          id: "x",
          date: today,
          mode: "words",
          total: 5,
          independent: 4,
          supported: 3,
        },
      ];
    },
  ]) {
    const p = start();
    alter(p.arcade);
    assert.throws(() => valid(p), /arcade/);
  }
  assert.throws(() => validateArcade(null));
});
