import type { GrammarUnit, Mission, Pair, Programme, Progress, Source, VocabularyBank } from "./types.ts";

export const BOOK_PROGRAMME_ID = "espresso-plus-a1-a2";
export type ChapterScene = { id: string; missionId?: string; turns: { id: string }[] };
export type ChapterSource = {
  source: Source;
  pages: number[];
  kind: "reader" | "contents" | "teacher-support" | "class";
};
export type BookChapter = {
  id: string;
  book: 1 | 2;
  bookId: string;
  chapter: number;
  level: "A1" | "A2";
  title: Pair;
  goal: Pair;
  missionId: string;
  bankId: string;
  wordIds: string[];
  sceneId?: string;
  turnIds: string[];
  unitIds: string[];
  dayIndices: number[];
  sources: ChapterSource[];
};
export type ChapterCatalogues = {
  missions: Mission[];
  banks: VocabularyBank[];
  units: GrammarUnit[];
  programmes: Programme[];
  scenes: ChapterScene[];
  sources: Source[];
};

/** Metadata is supplied by the lazy dashboard; this model imports no catalogues. */
export function buildChapterCatalogue(data: ChapterCatalogues): BookChapter[] {
  const programme = data.programmes.find((item) => item.id === BOOK_PROGRAMME_ID);
  if (!programme || programme.days.length !== 80) throw new Error("The book route requires its existing eighty checkpoints.");
  const banks = data.banks.filter((bank) => /^espresso[12]-u(?:0[1-9]|10)$/.test(bank.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (banks.length !== 20) throw new Error("The dashboard requires twenty chapter banks.");
  return banks.map((bank, index) => {
    const book = index < 10 ? 1 : 2;
    const chapter = index % 10 + 1;
    const id = `espresso${book}-u${String(chapter).padStart(2, "0")}`;
    const mission = data.missions.find((item) => item.id === bank.missionId);
    if (bank.id !== id || bank.bookId !== `nuovo-espresso-plus-${book}` || bank.chapter !== chapter
      || bank.level !== (book === 1 ? "A1" : "A2") || !mission) {
      throw new Error(`Inconsistent chapter metadata: ${id}`);
    }
    const dayIndices = [0, 1, 2, 3].map((offset) => index * 4 + offset);
    const days = dayIndices.map((day) => programme.days[day]);
    if (!days[2].missionIds.includes(mission.id) || !days[3].missionIds.includes(mission.id)) {
      throw new Error(`The application and recall checkpoints must link ${mission.id}.`);
    }
    const unitIds = Array.from(new Set([
      ...days.flatMap((day) => day.unitIds),
      ...data.units.filter((unit) => unit.missionIds.includes(mission.id)).map((unit) => unit.id),
    ]));
    if (!unitIds.length || unitIds.some((unitId) => !data.units.some((unit) => unit.id === unitId))) {
      throw new Error(`Unknown chapter grammar: ${id}`);
    }
    const scene = data.scenes.find((item) => item.id === id && item.missionId === mission.id);
    if (book === 2 && (!scene || scene.turns.length !== 3)) throw new Error(`Missing chapter conversation: ${id}`);
    const sources = mission.sources.map((ref): ChapterSource => {
      const source = data.sources.find((item) => item.id === ref.id);
      if (!source || !ref.pages.length || ref.pages.some((page) => !Number.isSafeInteger(page) || page < 1 || page > source.pages)) {
        throw new Error(`Unbounded source reference: ${id}/${ref.id}`);
      }
      const kind = source.path.includes("/reader-native-pdf/") ? "reader"
        : /indice/i.test(source.title) ? "contents"
          : /guida/i.test(source.title) ? "teacher-support" : "class";
      return { source, pages: [...new Set(ref.pages)].sort((a, b) => a - b), kind };
    }).sort((a, b) => Number(b.kind === "reader") - Number(a.kind === "reader"));
    return {
      id, book, bookId: bank.bookId, chapter, level: bank.level, title: mission.title, goal: mission.goal,
      missionId: mission.id, bankId: bank.id, wordIds: bank.words.map((word) => word.id),
      sceneId: scene?.id, turnIds: scene?.turns.map((turn) => turn.id) ?? [], unitIds, dayIndices, sources,
    };
  });
}

/** Include every prerequisite, even when a later unit already has a completion. */
export function chapterGrammarOrder(chapter: BookChapter, units: GrammarUnit[]): GrammarUnit[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const ordered: GrammarUnit[] = [];
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    const unit = byId.get(id);
    if (!unit || visiting.has(id)) throw new Error(`Invalid grammar prerequisite: ${id}`);
    visiting.add(id);
    unit.prerequisites.forEach(visit);
    visiting.delete(id);
    visited.add(id);
    ordered.push(unit);
  };
  chapter.unitIds.forEach(visit);
  return ordered;
}

export function chapterEvidence(p: Progress, chapter: BookChapter, today: string) {
  const active = p.academy?.programme;
  const routeSelected = active?.id === BOOK_PROGRAMME_ID;
  const recalled = new Set(Object.values(p.sessions ?? {}).flatMap((session) => session.recalled));
  const vocabularySelfReports = chapter.wordIds.filter((id) => recalled.has(id.replace(/^word:/, ""))).length;
  const wordRecords = chapter.wordIds.map((id) => p.arcade?.records[id]);
  const conversationRecords = chapter.turnIds.map((id) => p.arcade?.records[`scene:${chapter.sceneId}:${id}`]);
  const drafts = Object.values(p.sessions ?? {}).filter((session) => session.missionId === chapter.missionId);
  return {
    coreCompleted: Boolean(p.completed[chapter.missionId]),
    coreCompletedOn: p.completed[chapter.missionId]?.date,
    grammarCompleted: chapter.unitIds.filter((id) => p.academy?.grammar[id]?.completed).length,
    grammarTotal: chapter.unitIds.length,
    routeSelected,
    checkpointsCompleted: routeSelected ? chapter.dayIndices.filter((index) => active.completed[String(index)]).length : 0,
    checkpointsTotal: chapter.dayIndices.length,
    vocabularySelfReports,
    vocabularyTotal: chapter.wordIds.length,
    vocabularyLatestCorrect: wordRecords.filter((record) => record?.last.correct).length,
    vocabularyAttempted: wordRecords.filter(Boolean).length,
    gistDraftSaved: drafts.some((session) => Boolean(session.gistAnswer?.trim())),
    retellDraftSaved: drafts.some((session) => Boolean(session.retell?.trim())),
    conversationAttempted: conversationRecords.filter(Boolean).length,
    conversationLatestCorrect: conversationRecords.filter((record) => record?.last.correct).length,
    conversationCorrectToday: conversationRecords.filter((record) => record?.date === today && record.last.correct).length,
    conversationTotal: chapter.turnIds.length,
  };
}

export type ChapterAction = {
  kind: "prerequisite" | "grammar" | "lesson" | "checkpoint" | "programme" | "conversation" | "vocabulary";
  route: string;
  title: Pair;
  detail: Pair;
  unitId?: string;
};

export function nextChapterAction(p: Progress, chapter: BookChapter, units: GrammarUnit[], today: string): ChapterAction {
  const nextUnit = chapterGrammarOrder(chapter, units).find((unit) => !p.academy?.grammar[unit.id]?.completed);
  if (nextUnit) {
    const prerequisite = !chapter.unitIds.includes(nextUnit.id);
    return {
      kind: prerequisite ? "prerequisite" : "grammar", route: `grammar/${nextUnit.id}`, unitId: nextUnit.id,
      title: prerequisite ? { en: "Build the prerequisite first", it: "Parti dalla preparazione necessaria" }
        : { en: "Practise the next grammar topic", it: "Esercitati sul prossimo tema di grammatica" },
      detail: nextUnit.title,
    };
  }
  if (!p.completed[chapter.missionId]) return {
    kind: "lesson", route: `lesson/${chapter.missionId}`,
    title: { en: "Use it in the chapter lesson", it: "Usalo nella lezione del capitolo" }, detail: chapter.goal,
  };
  const evidence = chapterEvidence(p, chapter, today);
  if (!evidence.routeSelected || evidence.checkpointsCompleted < evidence.checkpointsTotal) {
    const current = p.academy?.programme?.day;
    const isCurrentChapter = evidence.routeSelected && current !== undefined && chapter.dayIndices.includes(current);
    return {
      kind: isCurrentChapter ? "checkpoint" : "programme", route: "programmes",
      title: isCurrentChapter ? { en: "Continue your saved chapter checkpoint", it: "Continua il checkpoint salvato del capitolo" }
        : { en: "View the study route", it: "Consulta il percorso di studio" },
      detail: isCurrentChapter
        ? { en: "Each checkpoint needs its own fresh, self-assessed output.", it: "Ogni checkpoint richiede una nuova produzione con autoverifica." }
        : { en: "The route opens at your saved day. Choose a programme there if you want to change it.", it: "Il percorso si apre al giorno salvato. Se vuoi cambiarlo, scegli un percorso da quella pagina." },
    };
  }
  if (chapter.sceneId && evidence.conversationCorrectToday < chapter.turnIds.length) return {
    kind: "conversation", route: `games/${chapter.sceneId}`,
    title: { en: "Try today’s three-turn conversation", it: "Prova la conversazione di oggi in tre battute" },
    detail: { en: "Practise a new situation and revisit replies that needed support.", it: "Prova una nuova situazione e riprendi le risposte che richiedevano aiuto." },
  };
  return {
    kind: "vocabulary", route: `vocabulary/${chapter.bankId}`,
    title: { en: "Revisit the chapter vocabulary", it: "Riprendi il lessico del capitolo" },
    detail: { en: "Cover an example and make your own sentence with one changed detail.", it: "Copri un esempio e crea una frase tua cambiando un dettaglio." },
  };
}
