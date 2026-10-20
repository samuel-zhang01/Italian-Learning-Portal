import type { GrammarExercise, Pair } from "./types.ts";

export const dayKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dayKey(d);
}
// Accents are meaningful: e (and) and è (is) must remain distinct.
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
// Share the answer contract across lessons, diagnostics and games.
export function exercisePrompt(
  exercise: Pick<GrammarExercise, "kind" | "prompt">,
): Pair {
  return exercise.kind === "correct"
    ? {
        en: `${exercise.prompt.en} Write the whole corrected sentence.`,
        it: `${exercise.prompt.it} Scrivi tutta la frase corretta.`,
      }
    : exercise.prompt;
}
// A finite authored answer list is not a general Italian grammar checker.
export const modelAnswerMismatch: Pair = {
  en: "This doesn’t match a model answer yet.",
  it: "Non corrisponde ancora a una risposta modello.",
};
export const validDate = (s: unknown): s is string =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  dayKey(new Date(`${s}T12:00:00`)) === s;
