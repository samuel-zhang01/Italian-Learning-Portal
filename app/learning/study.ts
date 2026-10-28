import type {
  Pair,
  Progress,
  SessionActivity,
  StudySession,
} from "./types.ts";
import type { PlanningMission, PlanningPage, PlanningProgramme, PlanningUnit } from "./planning-types.ts";

import {
  academyXP,
  getGrammarDraft,
  getProgrammePracticeDraft,
  grammarReviewQueue,
  programmeDayReady,
} from "./academy-engine.ts";
import { chapterContext, chapterConversationComplete } from "./chapter-context.ts";

export const SESSION_MINUTES: Record<SessionActivity, number> = {
  warmup: 5,
  core: 5,
  vocab: 6,
  input: 6,
  speak: 6,
  exit: 2,
};
export const SESSION_ORDER: SessionActivity[] = [
  "warmup",
  "core",
  "vocab",
  "input",
  "speak",
  "exit",
];
export function sessionLayout(minutes = 30): Record<SessionActivity, number> {
  const values =
    minutes <= 5
      ? [0, 5, 0, 0, 0, 0]
      : minutes <= 10
        ? [2, 5, 3, 0, 0, 0]
        : minutes <= 15
          ? [2, 5, 3, 3, 1, 1]
          : minutes <= 20
            ? [3, 5, 4, 4, 3, 1]
            : [5, 5, 6, 6, 6, 2];
  return Object.fromEntries(
    SESSION_ORDER.map((key, i) => [key, values[i]]),
  ) as Record<SessionActivity, number>;
}
export const sessionActivities = (minutes = 30) =>
  SESSION_ORDER.filter((key) => sessionLayout(minutes)[key] > 0);
// A saved duration must name an actual activity layout. Reserving transfer
// time can leave 25 minutes, which has no separate layout or backup value.
export function sessionDuration(minutes: number) {
  return [30, 20, 15, 10, 5].find((duration) => duration <= minutes) ?? 5;
}
export function dailyRecipe(minutes: number, unitCount = 0) {
  const grammarMinutes =
    unitCount > 0 && minutes >= 10
      ? minutes >= 60
        ? Math.min(unitCount, 3) * 15
        : minutes >= 45
          ? Math.min(unitCount, 2) * 15
          : minutes >= 30
            ? 15
            : minutes >= 15
              ? 10
              : 5
      : minutes >= 45
        ? 15
        : 0;
  const workshopCount = unitCount
    ? Math.min(unitCount, Math.max(1, Math.floor(grammarMinutes / 15)))
    : 1;
  const session = sessionDuration(minutes - grammarMinutes);
  const extra = minutes - session - grammarMinutes;
  return {
    session,
    workshops: grammarMinutes
      ? Array.from(
          { length: workshopCount },
          () => grammarMinutes / workshopCount,
        )
      : [],
    tense: Math.min(10, extra),
    companion: Math.max(0, extra - 10),
  };
}
export const emptySession = (
  missionId: string,
  minutes = 30,
  bankId = chapterContext(missionId)?.bankId,
): StudySession => ({
  duration: sessionDuration(minutes),
  missionId,
  ...(bankId ? { bankId } : {}),
  done: [],
  warmup: "",
  recalled: [],
  inputAnswer: "",
  speaking: "",
  exit: "",
});
export function sessionMission<Mission extends Pick<PlanningMission, "id" | "course">>(
  p: Progress,
  missions: Mission[],
  date: string,
  preferredIds: string[] = [],
) {
  const saved = missions.find((m) => m.id === p.sessions?.[date]?.missionId);
  const course = missions.filter((m) => m.course === p.plan.course);
  const lastPractised = (id: string) =>
    [
      p.completed[id]?.date ?? "",
      ...Object.entries(p.sessions ?? {})
        .filter(([d, s]) => d < date && s.missionId === id)
        .map(([d]) => d),
    ]
      .sort()
      .at(-1) ?? "";
  const practiceCount = (id: string) =>
    Object.entries(p.sessions ?? {}).filter(
      ([d, s]) => d < date && s.missionId === id && s.done.length > 0,
    ).length;
  const revisit = [...course].sort(
    (a, b) =>
      lastPractised(a.id).localeCompare(lastPractised(b.id)) ||
      practiceCount(a.id) - practiceCount(b.id),
  )[0];
  return (
    saved ??
    missions.find((m) => preferredIds.includes(m.id) && !p.completed[m.id]) ??
    missions.find((m) => preferredIds.includes(m.id)) ??
    course.find((m) => !p.completed[m.id]) ??
    revisit ??
    missions[0]
  );
}
export function sessionDone(p: Progress, date: string): SessionActivity[] {
  const s = p.sessions?.[date];
  if (!s) return [];
  return sessionActivities(s.duration ?? 30).filter(
    (a) =>
      s.done.includes(a) ||
      (a === "core" && p.completed[s.missionId]?.date === date),
  );
}
export function sessionCredit(p: Progress, date: string) {
  const s = p.sessions?.[date];
  if (!s) return 0;
  const reviewMinutes = p.reviewLog.filter((r) => r.date === date).length * 2;
  return s.done.reduce((sum, a) => {
    // Reviews form part of the five-minute warm-up; new-lesson credit already exists.
    if (a === "warmup")
      return sum + Math.max(0, sessionLayout(s.duration)[a] - reviewMinutes);
    if (a === "core" && p.completed[s.missionId]?.date === date) return sum;
    return sum + sessionLayout(s.duration)[a];
  }, 0);
}
export function learningRewards(p: Progress) {
  const completeDays = Object.keys(p.sessions ?? {}).filter(
    (d) =>
      sessionDone(p, d).length ===
      sessionActivities(p.sessions?.[d]?.duration ?? 30).length,
  );
  const activities = Object.keys(p.sessions ?? {}).reduce(
    (sum, d) => sum + sessionDone(p, d).filter((a) => a !== "core").length,
    0,
  );
  // Correctness never removes points. Core lessons and dated activities count once.
  const xp =
    Object.keys(p.completed).length * 10 +
    p.reviewLog.length * 3 +
    activities * 5 +
    academyXP(p) + new Set([...Object.keys(p.arcade?.records ?? {}), ...Object.keys(p.vocabPractice?.records ?? {})]).size * 2;
  return {
    xp,
    level: Math.floor(xp / 100) + 1,
    completeDays: completeDays.length,
    badges: [
      Object.keys(p.completed).length >= 1,
      p.reviewLog.some((r) => r.correct),
      completeDays.length >= 1,
      completeDays.length >= 7,
    ],
  };
}

export type DailyStudyBlock = {
  route: string;
  title: Pair;
  detail: Pair;
  minutes: number;
  completed: boolean;
};

// Today and its checklist use the same selection and completion rules.
export function dailyStudyPlan<
  Mission extends PlanningMission,
  GrammarUnit extends PlanningUnit,
  Programme extends PlanningProgramme,
  PageCompanion extends PlanningPage,
>(
  p: Progress,
  missions: Mission[],
  units: GrammarUnit[],
  programmes: Programme[],
  pages: PageCompanion[],
  date: string,
) {
  const programme = programmes.find((item) => item.id === p.academy?.programme?.id);
  const dayIndex = p.academy?.programme?.day ?? 0;
  const day = programme?.days[dayIndex];
  const practice = programme ? getProgrammePracticeDraft(p, programme, dayIndex) : undefined;
  const linkedWorkDone = Boolean(day && day.unitIds.every((id) => p.academy?.grammar[id]?.completed)
    && day.missionIds.every((id) => p.completed[id]));
  const linkedWorkDoneToday = Boolean(day && (day.unitIds.some((id) => p.academy?.grammar[id]?.completed === date)
    || day.missionIds.some((id) => p.completed[id]?.date === date)));
  const practiceDoneToday = Object.values(p.academy?.programme?.practice ?? {})
    .some((draft) => draft.completed === date);
  // At five minutes, transfer waits for the next sitting if today's required
  // work already used the block. Longer sittings reserve its own five minutes.
  const includePractice = Boolean(day?.practice && (practice?.completed === date
    || (!practice?.completed && (p.plan.minutes > 5
      || (linkedWorkDone && !linkedWorkDoneToday && !practiceDoneToday && !p.sessions?.[date])))));
  const practiceBlock: DailyStudyBlock | undefined = includePractice ? {
    route: "programmes",
    title: { en: "Daily personal practice", it: "Pratica personale del giorno" },
    detail: day!.title,
    minutes: 5,
    completed: Boolean(practice?.completed),
  } : undefined;
  const mission = sessionMission(p, missions, date, day?.missionIds);
  const chapter = chapterContext(mission.id);
  const mainBudget = p.plan.minutes - (practiceBlock?.minutes ?? 0);
  const recipe = dailyRecipe(Math.max(5, mainBudget), day?.unitIds.length ?? 0);
  const duration = p.sessions?.[date] ? (p.sessions[date].duration ?? 30) : recipe.session;
  const programmeUnits = (day?.unitIds ?? [])
    .map((id) => units.find((unit) => unit.id === id))
    .filter((unit): unit is GrammarUnit => Boolean(unit));
  const unit = programmeUnits.find((item) => !getGrammarDraft(p, item.id).completed)
    ?? units.find((item) => item.missionIds.includes(mission.id))
    ?? grammarReviewQueue(p, units, date)[0]?.unit
    ?? units.find((item) => !getGrammarDraft(p, item.id).completed)
    ?? units[0];
  const page = pages.find((item) => item.kind === "practice" && item.unitIds.includes(unit.id));
  const workshopUnits = [
    ...programmeUnits.filter((item) => !getGrammarDraft(p, item.id).completed),
    ...programmeUnits.filter((item) => getGrammarDraft(p, item.id).completed),
  ];
  // At five minutes, alternate required work across sittings rather than
  // repeating an already completed application forever. A saved session stays
  // pinned, and work completed today consumes this sitting's single block.
  const shortProgramme = p.plan.minutes === 5 && day && !p.sessions?.[date]
    && day.missionIds.every((id) => p.completed[id]);
  const applicationDoneToday = shortProgramme
    ? day.missionIds.find((id) => p.completed[id]?.date === date)
    : undefined;
  const shortWorkshop = shortProgramme && !applicationDoneToday
    ? programmeUnits.find((item) => getGrammarDraft(p, item.id).completed === date)
      ?? workshopUnits[0]
    : undefined;
  const firstBlock: DailyStudyBlock = shortWorkshop
    ? {
        route: `grammar/${shortWorkshop.id}`,
        title: { en: "Grammar practice", it: "Pratica di grammatica" },
        detail: shortWorkshop.title, minutes: 5,
        completed: Boolean(getGrammarDraft(p, shortWorkshop.id).completed),
      }
    : applicationDoneToday
      ? {
          route: `lesson/${applicationDoneToday}`,
          title: { en: "Daily application", it: "Applicazione quotidiana" },
          detail: missions.find((item) => item.id === applicationDoneToday)!.title,
          minutes: 5, completed: true,
        }
      : {
          route: "session", title: { en: "Guided session", it: "Sessione guidata" },
          detail: mission.title, minutes: duration,
          completed: sessionDone(p, date).length === sessionActivities(duration).length,
        };
  const planned: DailyStudyBlock[] = [
    firstBlock,
    ...recipe.workshops.map((minutes, index) => {
      const workshop = workshopUnits[index] ?? unit;
      return {
        route: `grammar/${workshop.id}`,
        title: { en: "Grammar practice", it: "Pratica di grammatica" },
        detail: workshop.title, minutes,
        completed: Boolean(getGrammarDraft(p, workshop.id).completed),
      };
    }),
    ...(recipe.tense && chapter?.sceneId ? [{
      route: `games/${chapter.sceneId}`,
      title: { en: "Chapter conversation", it: "Conversazione del capitolo" },
      detail: mission.title, minutes: recipe.tense,
      completed: chapterConversationComplete(p, chapter.sceneId, date),
    }] : recipe.tense ? [{
      route: "tense", title: { en: "Tense check", it: "Controllo dei tempi" },
      detail: { en: "Present or past?", it: "Presente o passato?" }, minutes: recipe.tense,
      completed: Object.entries(p.academy?.assessments ?? {}).some(([key, run]) =>
        key.endsWith(":tense") && run.completed && run.exerciseIds.length > 0
        && (run.date === date || Object.values(run.answers).some((answer) => answer.date === date))),
    }] : []),
    ...(recipe.companion && page ? [{
      route: `companion/${page.id}`, title: { en: "Page companion", it: "Compagno della pagina" },
      detail: page.focus, minutes: recipe.companion,
      completed: Boolean(p.academy?.companion[page.id]?.completed),
    }] : []),
  ];
  let remaining = mainBudget;
  const mainBlocks = planned.flatMap((block) => {
    const minutes = Math.min(block.minutes, remaining);
    remaining -= minutes;
    return minutes > 0 ? [{ ...block, minutes }] : [];
  });
  const blocks = practiceBlock
    ? linkedWorkDone ? [practiceBlock, ...mainBlocks] : [...mainBlocks, practiceBlock]
    : mainBlocks;
  const next = blocks.find((block) => !block.completed);
  const dayReady = Boolean(programme && programmeDayReady(p, programme, dayIndex));
  return { programme, day, mission, duration, blocks, next, dayReady };
}
