import type { Progress, StudySession } from "./types.ts";
import { planningScenes } from "./planning-data.ts";

// These banks were used by started book sessions before chapter banks existed.
// Keep the mapping so an older draft retains its practised-card identifiers.
export const legacyChapterBanks: Record<string, string> = {
  "espresso1-u01-confirm-contact": "survival",
  "espresso1-u02-introduce-colleague": "work",
  "espresso1-u03-book-a-table": "cafe",
  "espresso1-u04-find-common-ground": "habits",
  "espresso1-u05-choose-a-stay": "hotel",
  "espresso1-u06-plan-a-celebration": "routine",
  "espresso1-u07-find-an-open-place": "town",
  "espresso1-u08-change-the-itinerary": "past",
  "espresso1-u09-plan-the-ingredients": "food",
  "espresso1-u10-recount-a-celebration": "family",
  "espresso2-u01-choose-a-gift": "clothes",
  "espresso2-u02-remember-a-place": "home",
  "espresso2-u03-ask-for-a-favour": "work",
  "espresso2-u04-coordinate-an-outing": "plans",
  "espresso2-u05-explain-a-delay": "past",
  "espresso2-u06-suggest-a-break": "routine",
  "espresso2-u07-navigate-an-appointment": "body",
  "espresso2-u08-plan-a-next-step": "work",
  "espresso2-u09-tell-an-interruption": "past",
  "espresso2-u10-discuss-a-home": "home",
};

export function chapterContext(missionId: string) {
  const match = /^espresso([12])-u(0[1-9]|10)-/.exec(missionId);
  if (!match) return undefined;
  return {
    bankId: `espresso${match[1]}-u${match[2]}`,
    book: Number(match[1]),
    chapter: Number(match[2]),
    level: match[1] === "2" ? "A2" as const : "A1" as const,
    sceneId: match[1] === "2" ? `espresso2-u${match[2]}` : undefined,
  };
}

export function sessionVocabularyBank(
  saved: StudySession | undefined,
  missionId: string,
  currentBank: string,
) {
  if (saved?.bankId) return saved.bankId;
  if (saved) return legacyChapterBanks[missionId] ?? currentBank;
  return currentBank;
}

export function chapterConversationComplete(p: Progress, sceneId: string, date: string) {
  const scene = planningScenes.find((item) => item.id === sceneId);
  return Boolean(scene && scene.turns.length === 3 && scene.turns.every((turn) => {
    const record = p.arcade?.records[`scene:${sceneId}:${turn.id}`];
    return record?.date === date && record.last.correct;
  }));
}
