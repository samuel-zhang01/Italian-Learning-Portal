import type { GrammarExercise, GrammarUnit, Mission, PageCompanion, Programme } from "./types.ts";

// Planning uses catalogue identity and ordering, never exercise answers or prose.
export type PlanningMission = Pick<Mission, "id" | "course" | "title" | "goal">;
export type PlanningUnit = Pick<GrammarUnit, "id" | "title" | "level" | "missionIds" | "prerequisites" | "sources"> & {
  exercises: Pick<GrammarExercise, "id" | "kind">[];
};
export type ProgrammeRequirements = Pick<Programme, "id"> & {
  days: {
    unitIds: string[];
    missionIds: string[];
    practice?: unknown;
  }[];
};
export type PlanningProgramme = Pick<Programme, "id" | "title" | "summary"> & {
  days: (Pick<Programme["days"][number], "title" | "outcome" | "unitIds" | "missionIds"> & {
    practice?: unknown;
  })[];
};
export type PlanningPage = Pick<PageCompanion, "id" | "sourceId" | "page" | "kind" | "unitIds" | "focus">;
