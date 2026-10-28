import type { Pair } from "./types.ts";

// Existing grammar cards sometimes show an infinitive with a conjugated
// reminder, or two complete alternatives. Ask for the form named by the
// English cue; never require learners to type the source's notation.
export function grammarVocabularyAnswers(term: Pair): string[] {
  const [head, reminder] = term.it.split(/\s*→\s*/);
  const target = reminder && !/^to\s/i.test(term.en.trim()) ? reminder : head;
  return [...new Set(target.split(/\s*\/\s*/).map(answer => answer.trim()).filter(Boolean))];
}
