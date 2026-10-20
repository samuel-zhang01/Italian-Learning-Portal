import type {
  ArcadeItem,
  ArcadeProgress,
  ArcadeRound,
  ArcadeSettings,
  Progress,
} from "./types.ts";
import { addDays, isCorrect, validDate } from "./learning-utils.ts";

export const defaultArcadeSettings: ArcadeSettings = {
  mode: "words",
  size: 5,
  support: "guided",
  topic: "foundations",
  bank: "survival",
  scene: "cafe-stop",
};
export const emptyArcade = (): ArcadeProgress => ({
  settings: { ...defaultArcadeSettings },
  active: null,
  history: [],
  records: {},
});
export function shuffled<T>(values: T[], seed: string): T[] {
  let state = 2166136261;
  for (const char of seed)
    state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export const arcadeDue = (p: Progress, items: ArcadeItem[], today: string) =>
  items.filter(
    (item) =>
      p.arcade?.records[item.id] && p.arcade.records[item.id].due <= today,
  );
export const arcadeMistakes = (p: Progress, items: ArcadeItem[]) =>
  items.filter((item) => {
    const r = p.arcade?.records[item.id];
    return r && (!r.last.correct || r.last.assisted);
  });

export function startArcadeRound(
  p: Progress,
  pool: ArcadeItem[],
  today: string,
  id: string,
  review = false,
): Progress {
  const a = p.arcade ?? emptyArcade();
  if (a.active || !validDate(today) || !pool.length || !id || id.length > 100)
    return p;
  const ordered =
    a.settings.mode === "conversation" && !review ? pool : shuffled(pool, id);
  const itemIds = [...new Set(ordered.map((item) => item.id))].slice(
    0,
    a.settings.mode === "conversation" && !review ? 3 : a.settings.size,
  );
  return {
    ...p,
    arcade: {
      ...a,
      active: {
        id,
        date: today,
        mode: review ? "review" : a.settings.mode,
        support: a.settings.support,
        itemIds,
        index: 0,
        answers: {},
        hints: [],
        draft: "",
        tokens: [],
      },
    },
  };
}
export function updateArcadeDraft(
  p: Progress,
  draft: string,
  tokens: number[] = [],
): Progress {
  const a = p.arcade,
    r = a?.active;
  if (!a || !r || r.answers[r.itemIds[r.index]]) return p;
  return {
    ...p,
    arcade: { ...a, active: { ...r, draft: draft.slice(0, 500), tokens } },
  };
}
export function hintArcade(p: Progress): Progress {
  const a = p.arcade,
    r = a?.active;
  if (!a || !r || r.answers[r.itemIds[r.index]]) return p;
  return {
    ...p,
    arcade: {
      ...a,
      active: { ...r, hints: [...new Set([...r.hints, r.itemIds[r.index]])] },
    },
  };
}
export function answerArcade(
  p: Progress,
  item: ArcadeItem,
  answer: string,
  today: string,
): Progress {
  const a = p.arcade,
    r = a?.active;
  if (
    !a ||
    !r ||
    r.itemIds[r.index] !== item.id ||
    r.answers[item.id] ||
    !answer.trim() ||
    answer.length > 500 ||
    !validDate(today)
  )
    return p;
  const result = {
    answer,
    correct: isCorrect(answer, item.answers),
    assisted: r.hints.includes(item.id),
  };
  const old = a.records[item.id];
  // Replays before the due date can repair a mistake without extending the interval.
  const independent = result.correct && !result.assisted;
  const earlyReplay = !!old && (old.date === today || today < old.due);
  const successes = independent
    ? earlyReplay
      ? old.successes
      : Math.min(3, (old?.successes ?? 0) + 1)
    : 0;
  const due =
    independent && earlyReplay
      ? old.due
      : addDays(today, [1, 1, 3, 7][successes]);
  return {
    ...p,
    arcade: {
      ...a,
      active: {
        ...r,
        answers: { ...r.answers, [item.id]: result },
        draft: answer,
      },
      records: {
        ...a.records,
        [item.id]: {
          first: old?.first ?? result,
          last: result,
          date: today,
          due,
          successes,
        },
      },
    },
  };
}
export function nextArcadeItem(p: Progress): Progress {
  const a = p.arcade,
    r = a?.active;
  if (
    !a ||
    !r ||
    !r.answers[r.itemIds[r.index]] ||
    r.index >= r.itemIds.length - 1
  )
    return p;
  return {
    ...p,
    arcade: {
      ...a,
      active: { ...r, index: r.index + 1, draft: "", tokens: [] },
    },
  };
}
export const arcadeRoundScore = (r: ArcadeRound) => ({
  total: r.itemIds.length,
  independent: Object.values(r.answers).filter((x) => x.correct && !x.assisted)
    .length,
  supported: Object.values(r.answers).filter((x) => x.correct && x.assisted)
    .length,
});
export function finishArcadeRound(p: Progress): Progress {
  const a = p.arcade,
    r = a?.active;
  if (!a || !r || !r.itemIds.every((id) => r.answers[id])) return p;
  const summary = {
    id: r.id,
    date: r.date,
    mode: r.mode,
    ...arcadeRoundScore(r),
  };
  return {
    ...p,
    arcade: {
      ...a,
      active: null,
      history: [...a.history.filter((x) => x.id !== r.id), summary].slice(-30),
    },
  };
}

// This boundary extends version-1 backups without changing their existing fields.
export function validateArcade(
  value: unknown,
): asserts value is ArcadeProgress {
  const object = (x: unknown): x is Record<string, unknown> =>
    !!x && typeof x === "object" && !Array.isArray(x);
  const str = (x: unknown, max = 100): x is string =>
    typeof x === "string" && x.length > 0 && x.length <= max;
  const int = (x: unknown, max: number) =>
    Number.isInteger(x) && Number(x) >= 0 && Number(x) <= max;
  const mode = (x: unknown, review = false) =>
    [
      "words",
      "builder",
      "detective",
      "conversation",
      ...(review ? ["review"] : []),
    ].includes(String(x));
  const answer = (x: unknown) =>
    object(x) &&
    str(x.answer, 500) &&
    typeof x.correct === "boolean" &&
    typeof x.assisted === "boolean";
  const fail = () => {
    throw new Error("arcade");
  };
  if (
    !object(value) ||
    !object(value.settings) ||
    !object(value.records) ||
    !Array.isArray(value.history)
  )
    return fail();
  const s = value.settings;
  if (
    !mode(s.mode) ||
    ![5, 10, 15].includes(Number(s.size)) ||
    typeof s.size !== "number" ||
    !["guided", "recall"].includes(String(s.support)) ||
    ![s.topic, s.bank, s.scene].every((x) => str(x))
  )
    fail();
  if (Object.keys(value.records).length > 1000 || value.history.length > 30)
    fail();
  for (const [id, r] of Object.entries(value.records)) {
    if (
      !str(id, 200) ||
      !object(r) ||
      !answer(r.first) ||
      !answer(r.last) ||
      !validDate(r.date) ||
      !validDate(r.due) ||
      !int(r.successes, 3)
    )
      fail();
  }
  for (const h of value.history) {
    if (
      !object(h) ||
      !str(h.id) ||
      !validDate(h.date) ||
      !mode(h.mode, true) ||
      !int(h.total, 15) ||
      Number(h.total) < 1 ||
      !int(h.independent, Number(h.total)) ||
      !int(h.supported, Number(h.total) - Number(h.independent))
    )
      fail();
  }
  if (value.active === null) return;
  const r = value.active;
  if (
    !object(r) ||
    !str(r.id) ||
    !validDate(r.date) ||
    !mode(r.mode, true) ||
    !["guided", "recall"].includes(String(r.support)) ||
    !Array.isArray(r.itemIds) ||
    !r.itemIds.length ||
    r.itemIds.length > 15 ||
    !r.itemIds.every((id) => str(id, 200)) ||
    new Set(r.itemIds).size !== r.itemIds.length ||
    !int(r.index, r.itemIds.length - 1) ||
    !object(r.answers) ||
    !Array.isArray(r.hints) ||
    new Set(r.hints).size !== r.hints.length ||
    typeof r.draft !== "string" ||
    r.draft.length > 500 ||
    !Array.isArray(r.tokens) ||
    r.tokens.length > 40 ||
    !r.tokens.every((i) => int(i, 39)) ||
    new Set(r.tokens).size !== r.tokens.length
  )
    return fail();
  const itemIds = r.itemIds as string[],
    answers = r.answers as Record<string, unknown>;
  if (
    !r.hints.every((id) => itemIds.includes(String(id))) ||
    !Object.entries(answers).every(
      ([id, result]) => itemIds.includes(id) && answer(result),
    ) ||
    itemIds.slice(0, Number(r.index)).some((id) => !answers[id]) ||
    itemIds.slice(Number(r.index) + 1).some((id) => answers[id])
  )
    fail();
}
