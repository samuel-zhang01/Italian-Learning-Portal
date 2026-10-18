export type Pair = { en: string; it: string };
export type Language = keyof Pair;
export type Source = {
  id: string;
  path: string;
  title: string;
  course: number;
  pages: number;
  sha256: string;
};
export type Check = { prompt: Pair; answers: string[]; explanation: Pair };
export type Mission = {
  id: string;
  course: number;
  title: Pair;
  goal: Pair;
  rule: Pair;
  examples: Pair[];
  words: Pair[];
  checks: Check[];
  review: Check;
  output: Pair;
  model: Pair;
  rubric: Pair[];
  sources: { id: string; pages: number[] }[];
};
export type Draft = {
  step: number;
  answers: string[];
  checked: boolean[];
  first: boolean[];
  output: string;
  rubric: boolean[];
  modelSeen: boolean;
};
export type Completion = {
  date: string;
  firstCorrect: number;
  total: number;
  output: string;
  supported: boolean;
  confidence: number;
};
export type ReviewState = {
  due: string;
  interval: number;
  attempts: number;
  correct: number;
  lastDate: string;
};
export type Progress = {
  version: 1;
  language: Language;
  translations: boolean;
  plan: { minutes: number; days: number[]; start: string; course: number };
  completed: Record<string, Completion>;
  drafts: Record<string, Draft>;
  reviews: Record<string, ReviewState>;
  reviewLog: { id: string; date: string; correct: boolean }[];
  notes: string;
  updatedAt: string;
};
