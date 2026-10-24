import data from "./planning-metadata.json" with { type: "json" };
import { normalise } from "./learning-utils.ts";
import type { PlanningMission, PlanningPage, PlanningProgramme, PlanningUnit } from "./planning-types.ts";
import type { Source } from "./types.ts";

export const planningMissions = data.missions as PlanningMission[];
export const planningUnits = data.units as PlanningUnit[];
export const planningProgrammes = data.programmes as PlanningProgramme[];
export const planningPages = data.pages as PlanningPage[];
export const planningSources = data.sources as Source[];
export const planningScenes = data.scenes;
export const planningBanks = data.banks;
export const planningAssessmentIds = planningUnits.flatMap((unit) => unit.exercises.map((exercise) => exercise.id));

// Review identities reuse the same IDs and normalized word keys as the full
// activity catalogue, with no prompts, answers, examples or task models.
export const planningReviewCatalogue = {
  missions: planningMissions,
  grammar: planningUnits,
  words: [...new Map([
    ...data.grammarWords,
    ...planningBanks.flatMap((bank) => bank.words.map((word) => word.term)),
  ].map((term) => [normalise(term.it), { key: normalise(term.it), term }])).values()],
  arcade: [
    ...planningBanks.flatMap((bank) => bank.words.map((word) => ({
      id: word.id, title: bank.title, wordKey: normalise(word.term.it),
    }))),
    ...planningUnits.flatMap((unit) => unit.exercises
      .filter((exercise) => ["reorder", "correct", "choice", "tense"].includes(exercise.kind))
      .map((exercise) => ({
        id: `grammar:${exercise.id}`, title: unit.title, unitId: unit.id, grammarExerciseId: exercise.id,
      }))),
    ...planningScenes.flatMap((scene) => scene.turns.map((turn) => ({
      id: `scene:${scene.id}:${turn.id}`, title: scene.title, unitId: turn.unitId,
    }))),
  ],
};
