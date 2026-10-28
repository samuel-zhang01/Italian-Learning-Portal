import type { A2DiagnosticState } from "./a2-diagnostic-model.ts";
import type { OralPracticeState } from "./oral-practice-model.ts";

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
  // Optional so version-1 backups from the original daily portal remain valid.
  sessions?: Record<string, StudySession>;
  academy?: AcademyProgress;
  arcade?: ArcadeProgress;
  vocabPractice?: ArcadeProgress;
  diagnostics?: A2DiagnosticState;
  oralPractice?: OralPracticeState;
};
export type ArcadeMode = "words" | "verbs" | "builder" | "detective" | "conversation";
export type ArcadeSettings = {
  mode: ArcadeMode;
  size: 5 | 10 | 15;
  support: "guided" | "recall";
  topic: string;
  bank: string;
  scene: string;
  wordFocus?: "meaning" | "articles";
  verbLevel?: "present" | "past" | "mixed";
  verbScope?: "essentials" | "all";
};
export type ArcadeItem = {
  id: string;
  mode: ArcadeMode;
  title: Pair;
  prompt: Pair;
  instruction?: Pair;
  answers: string[];
  hint: Pair;
  explanation: Pair;
  options?: string[];
  tokens?: string[];
  unitId?: string;
  bankId?: string;
  sceneId?: string;
  word?: { term: Pair; example: Pair };
  wordFocus?: "meaning" | "articles";
  verbId?: string;
  tense?: "present" | "past";
  level?: "A1" | "A2";
  sourceRefs?: { id: string; pages: number[] }[];
};
export type ArcadeAnswer = {
  answer: string;
  correct: boolean;
  assisted: boolean;
};
export type ArcadeRound = {
  id: string;
  date: string;
  mode: ArcadeMode | "review";
  support: "guided" | "recall";
  itemIds: string[];
  index: number;
  answers: Record<string, ArcadeAnswer>;
  hints: string[];
  draft: string;
  tokens: number[];
};
export type ArcadeMemory = {
  first: ArcadeAnswer;
  last: ArcadeAnswer;
  date: string;
  due: string;
  successes: number;
};
export type ArcadeProgress = {
  settings: ArcadeSettings;
  active: ArcadeRound | null;
  history: {
    id: string;
    date: string;
    mode: ArcadeRound["mode"];
    total: number;
    independent: number;
    supported: number;
  }[];
  records: Record<string, ArcadeMemory>;
};
export type SessionActivity =
  | "warmup"
  | "vocab"
  | "input"
  | "speak"
  | "exit"
  | "core";
export type StudySession = {
  missionId: string;
  bankId?: string;
  duration?: number;
  done: SessionActivity[];
  warmup: string;
  recalled: string[];
  inputAnswer: string;
  speaking: string;
  exit: string;
  gistAnswer?: string;
  retell?: string;
  retellChecks?: boolean[];
};
export type VocabularyBank = {
  id: string;
  title: Pair;
  level?: "A1" | "A2";
  missionId?: string;
  bookId?: string;
  chapter?: number;
  sourceRefs?: { id: string; pages: number[] }[];
  // Existing values retain their original arcade IDs; never renumber on reorder.
  words: { id: string; term: Pair; example: Pair }[];
};
export type Enrichment = {
  missionId: string;
  bank: string;
  notes: Pair[];
  dialogue: Pair[];
  question: Check;
  frame: Pair;
  speaking: Pair;
  resource: string;
  skills?: {
    gist: Check;
    retell: { prompt: Pair; frame: Pair; model: Pair; rubric: Pair[] };
  };
};
export type OnlineResource = {
  id: string;
  title: string;
  url: string;
  level: Pair;
  kind: Pair;
  task: Pair;
  access: Pair;
};
export type GrammarExercise = {
  id: string;
  kind: "choice" | "gap" | "reorder" | "correct" | "transform" | "tense";
  prompt: Pair;
  options?: string[];
  tokens?: string[];
  answers: string[];
  hint: Pair;
  explanation: Pair;
  focus: string;
};
export type GrammarUnit = {
  id: string;
  title: Pair;
  level: "A1" | "A1-plus" | "A2";
  summary: Pair;
  prerequisites: string[];
  missionIds: string[];
  teaching: Pair[];
  examples: Pair[];
  words: Pair[];
  exercises: GrammarExercise[];
  production: { prompt: Pair; frame: Pair; model: Pair; rubric: Pair[] };
  sources: { id: string; pages: number[] }[];
};
export type Programme = {
  id: string;
  title: Pair;
  summary: Pair;
  days: {
    title: Pair;
    unitIds: string[];
    missionIds: string[];
    outcome: Pair;
    practice?: { prompt: Pair; model: Pair; rubric: Pair[] };
  }[];
};
export type PageCompanion = {
  id: string;
  sourceId: string;
  page: number;
  kind: "practice" | "reference" | "needs-review";
  focus: Pair;
  unitIds: string[];
  task: Pair;
  model: Pair;
  checks: Pair[];
};
export type GrammarAttempt = {
  answer: string;
  correct: boolean;
  assisted: boolean;
  date: string;
};
export type GrammarDraft = {
  exerciseIndex: number;
  answers: Record<string, string>;
  attempts: Record<string, GrammarAttempt[]>;
  hints: string[];
  hintDates?: Record<string, string>;
  recallDrafts?: Record<string, { date: string; answer: string; hintUsed: boolean }>;
  output: string;
  rubric: number[];
  modelSeen: boolean;
  completed?: string;
};
export type CompanionDraft = {
  answer: string;
  selfChecked: boolean;
  modelSeen: boolean;
  completed?: string;
};
export type ReadinessRun = {
  date: string;
  exerciseIds: string[];
  answers: Record<string, { answer: string; correct: boolean; date?: string }>;
  completed: boolean;
};
export type WordMemory = {
  term: Pair;
  example?: Pair;
  starred: boolean;
  successes: number;
  lapses: number;
  due: string;
  lastDate: string;
};
export type ProgrammePracticeDraft = {
  output: string;
  rubric: number[];
  modelSeen: boolean;
  completed?: string;
};
export type AcademyProgress = {
  grammar: Record<string, GrammarDraft>;
  companion: Record<string, CompanionDraft>;
  programme: {
    id: string;
    started: string;
    day: number;
    completed: Record<string, string>;
    practice?: Record<string, ProgrammePracticeDraft>;
  } | null;
  assessments: Record<string, ReadinessRun>;
  words: Record<string, WordMemory>;
};
