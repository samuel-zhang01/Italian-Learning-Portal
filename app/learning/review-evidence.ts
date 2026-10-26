import type { Progress } from "./types.ts";

export type LocalRecallAttempt = { date: string; correct: boolean };

/** Keep the first recorded outcome authoritative after reload or correction. */
export function firstCoreRecallToday(p: Pick<Progress, "reviewLog">, id: string, today: string): boolean | null {
  return p.reviewLog.find((attempt) => attempt.id === id && attempt.date === today)?.correct ?? null;
}

export function coreRecallFeedback(
  p: Pick<Progress, "reviewLog">, id: string, today: string,
  localFirst: LocalRecallAttempt | null, scheduledOn: string | null,
): "independent" | "supported" | "extra" {
  const first = firstCoreRecallToday(p, id, today) ?? (localFirst?.date === today ? localFirst.correct : null);
  if (first === false) return "supported";
  if (first === true && scheduledOn === today) return "independent";
  return "extra";
}
