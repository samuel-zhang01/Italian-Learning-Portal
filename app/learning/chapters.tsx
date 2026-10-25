import { useEffect, useRef } from "react";
import curriculumData from "./curriculum.json";
import grammarData from "./grammar.json";
import enrichmentData from "./enrichment.json";
import sceneData from "./arcade-scenes.json";
import {
  BOOK_PROGRAMME_ID,
  buildChapterCatalogue,
  chapterEvidence,
  nextChapterAction,
  type BookChapter,
  type ChapterScene,
} from "./chapter-dashboard";
import { localPdfPageHref } from "./local-pdfs";
import { catalogueParams, focusStudyHeading } from "./navigation";
import type { GrammarUnit, Mission, Pair, Programme, Progress, Source, VocabularyBank } from "./types";
import "./chapters.css";

type Props = {
  p: Progress;
  t: (en: string, it: string) => string;
  text: (pair: Pair) => string;
  go: (route: string) => void;
  today: string;
  chapterId?: string;
  pdfs?: Record<string, string>;
  pdfPageOffsets?: Record<string, number>;
};

// The root loads this component lazily. Keep the full catalogues within it.
const units = grammarData.units as GrammarUnit[];
const programme = (grammarData.programmes as Programme[]).find((item) => item.id === BOOK_PROGRAMME_ID)!;
const chapters = buildChapterCatalogue({
  missions: curriculumData.missions as Mission[], banks: enrichmentData.banks as VocabularyBank[], units,
  programmes: grammarData.programmes as Programme[], scenes: sceneData.scenes as ChapterScene[],
  sources: curriculumData.sources as Source[],
});

export function ChapterDashboard({ p, t, text, go, today, chapterId, pdfs = {}, pdfPageOffsets = {} }: Props) {
  const bookParam = catalogueParams().get("book");
  const book = bookParam === "1" || bookParam === "2" ? bookParam : "all";
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => focusStudyHeading(heading.current), [chapterId, book]);
  const selected = chapters.find((chapter) => chapter.id === chapterId);
  const bookLabel = (chapter: BookChapter) => `Nuovo Espresso Plus ${chapter.book} · ${chapter.level}`;
  const chapterLabel = (chapter: BookChapter) => t(`Chapter ${chapter.chapter}`, `Capitolo ${chapter.chapter}`);
  const openOverview = (value: string = book) => {
    go(`chapters${value !== "all" ? `?book=${value}` : ""}`);
  };

  const recordedEvidence = (chapter: BookChapter) => {
    const evidence = chapterEvidence(p, chapter, today);
    return <dl className="chapter-recorded-evidence">
      <div><dt>{t("Core lesson", "Lezione base")}</dt><dd>{evidence.coreCompleted ? t("Completion saved", "Completamento salvato") : t("Not completed", "Da completare")}</dd></div>
      <div><dt>{t("Linked grammar", "Grammatica collegata")}</dt><dd>{evidence.grammarCompleted}/{evidence.grammarTotal} {t("units completed", "unità completate")}</dd></div>
      <div><dt>{t("Route checkpoints", "Checkpoint del percorso")}</dt><dd>{evidence.routeSelected
        ? `${evidence.checkpointsCompleted}/${evidence.checkpointsTotal} ${t("saved", "salvati")}`
        : t("Book route not selected", "Percorso dei libri non selezionato")}</dd></div>
    </dl>;
  };

  if (chapterId && !selected) return <div className="workspace chapter-dashboard">
    <p className="eyebrow">{t("BOOK CHAPTERS", "CAPITOLI DEI LIBRI")}</p>
    <h1 ref={heading} tabIndex={-1}>{t("Choose a book chapter.", "Scegli un capitolo del libro.")}</h1>
    <p>{t("That chapter link is unavailable. Your saved work is still in place.", "Il collegamento al capitolo non è disponibile. Il lavoro salvato è ancora presente.")}</p>
    <button className="button primary" onClick={() => openOverview("all")}>{t("Browse all chapters", "Esplora tutti i capitoli")} →</button>
  </div>;

  if (selected) {
    const evidence = chapterEvidence(p, selected, today);
    const next = nextChapterAction(p, selected, units, today);
    const chapterUnits = selected.unitIds.map((id) => units.find((unit) => unit.id === id)!);
    return <div className="workspace chapter-dashboard" data-chapter-id={selected.id}>
      <button className="text-button chapter-back" onClick={() => openOverview(String(selected.book))}>← {t("All chapters in this book", "Tutti i capitoli di questo libro")}</button>
      <p className="eyebrow">{bookLabel(selected)} · {chapterLabel(selected)}</p>
      <h1 ref={heading} tabIndex={-1}>{text(selected.title)}</h1>
      <p className="chapter-goal">{text(selected.goal)}</p>

      <section className="panel chapter-next" aria-labelledby="chapter-next-heading">
        <p className="eyebrow">{t("A USEFUL NEXT STEP", "UN PROSSIMO PASSO UTILE")}</p>
        <h2 id="chapter-next-heading">{text(next.title)}</h2>
        <p>{text(next.detail)}</p>
        <button className="button primary" onClick={() => go(next.route)}>{t("Open this step", "Apri questo passo")} →</button>
        <p className="hint">{t("Opening a chapter keeps your programme and saved day in place.", "Aprire un capitolo mantiene il percorso e il giorno salvato.")}</p>
      </section>

      <section aria-labelledby="chapter-recorded-heading">
        <h2 id="chapter-recorded-heading">{t("Recorded learning", "Apprendimento registrato")}</h2>
        {recordedEvidence(selected)}
        <p className="hint">{t("These are saved lesson, grammar and checkpoint completions. They describe practice completed, not a language-level assessment.", "Sono completamenti salvati di lezioni, grammatica e checkpoint. Descrivono la pratica completata, non una valutazione del livello linguistico.")}</p>
      </section>

      <section className="chapter-practice" aria-labelledby="chapter-practice-heading">
        <h2 id="chapter-practice-heading">{t("Practise this chapter", "Esercitati su questo capitolo")}</h2>
        <div className="chapter-practice-links">
          {selected.book === 2 && <article className="panel">
            <h3>{t("Chapter memory check", "Controllo di memoria del capitolo")}</h3>
            <p>{t("Try a few original questions and find specific topics to revisit.", "Prova alcune domande originali e trova gli argomenti da ripassare.")}</p>
            <button className="button secondary" onClick={() => go(`diagnostics?chapter=${selected.id}`)}>{t("Check this A2 chapter", "Controlla questo capitolo A2")} →</button>
          </article>}
          <article className="panel">
            <h3>{t("Core lesson", "Lezione base")}</h3>
            <p>{t("Two examples, bounded checks and a short piece of your own Italian.", "Due esempi, domande mirate e una breve produzione in italiano.")}</p>
            <button className="button secondary" onClick={() => go(`lesson/${selected.missionId}`)}>{t("Open the chapter lesson", "Apri la lezione del capitolo")} →</button>
          </article>
          <article className="panel">
            <h3>{t("Chapter vocabulary", "Lessico del capitolo")}</h3>
            <p>{t(`${selected.wordIds.length} original words and useful chunks with examples.`, `${selected.wordIds.length} parole ed espressioni originali con esempi.`)}</p>
            <button className="button secondary" onClick={() => go(`vocabulary/${selected.bankId}`)}>{t("Open chapter cards", "Apri le carte del capitolo")} →</button>
          </article>
          {selected.sceneId && <article className="panel">
            <h3>{t("A2 conversation", "Conversazione A2")}</h3>
            <p>{t("Three replies in a new situation, with optional hints and mistake repair.", "Tre risposte in una nuova situazione, con indizi facoltativi e correzione degli errori.")}</p>
            <button className="button secondary" onClick={() => go(`games/${selected.sceneId}`)}>{t("Try the three-turn scene", "Prova la scena in tre battute")} →</button>
          </article>}
        </div>
        <details className="chapter-practice-evidence">
          <summary>{t("Vocabulary reports and optional practice evidence", "Autoverifiche lessicali e tracce della pratica facoltativa")}</summary>
          <dl>
            <div><dt>{t("Cards marked remembered in saved sessions", "Carte indicate come ricordate nelle sessioni salvate")}</dt><dd>{evidence.vocabularySelfReports}/{evidence.vocabularyTotal}</dd></div>
            <div><dt>{t("Latest correct vocabulary game answers", "Ultime risposte corrette nel gioco lessicale")}</dt><dd>{evidence.vocabularyLatestCorrect}/{evidence.vocabularyTotal}</dd></div>
            <div><dt>{t("Gist draft", "Bozza sulla situazione")}</dt><dd>{evidence.gistDraftSaved ? t("Saved", "Salvata") : t("No draft saved", "Nessuna bozza salvata")}</dd></div>
            <div><dt>{t("Changed-story draft", "Bozza della storia cambiata")}</dt><dd>{evidence.retellDraftSaved ? t("Saved", "Salvata") : t("No draft saved", "Nessuna bozza salvata")}</dd></div>
            {selected.sceneId && <div><dt>{t("Latest correct A2 scene replies", "Ultime risposte corrette nella scena A2")}</dt><dd>{evidence.conversationLatestCorrect}/{evidence.conversationTotal}</dd></div>}
          </dl>
          <p className="hint">{t("A remembered card is your self-report. Game replies may use hints. Drafts and these counts do not complete a core lesson, grammar unit or route checkpoint.", "Una carta ricordata è una tua autoverifica. Le risposte nei giochi possono usare indizi. Le bozze e questi conteggi non completano lezioni base, unità di grammatica o checkpoint del percorso.")}</p>
        </details>
      </section>

      <section aria-labelledby="chapter-grammar-heading">
        <h2 id="chapter-grammar-heading">{t("Linked grammar", "Grammatica collegata")}</h2>
        <p>{t("Open a topic to see its prerequisites. The recommended step above starts with any preparation still needed.", "Apri un tema per vedere la preparazione richiesta. Il passo consigliato sopra parte dalla preparazione ancora necessaria.")}</p>
        <ul className="chapter-grammar-list">
          {chapterUnits.map((unit) => <li key={unit.id}>
            <button className="text-button" onClick={() => go(`grammar/${unit.id}`)}>{text(unit.title)} →</button>
            <span>{unit.level} · {p.academy?.grammar[unit.id]?.completed ? t("Completion saved", "Completamento salvato") : t("To practise", "Da esercitare")}</span>
          </li>)}
        </ul>
        {selected.id === "espresso2-u10" && <p className="hint">{t("Present subjunctive work is introductory. The A1 diagnostic does not assess these A2 topics.", "Il lavoro sul congiuntivo presente è introduttivo. La verifica A1 non valuta questi temi A2.")}</p>}
      </section>

      <section aria-labelledby="chapter-checkpoints-heading">
        <h2 id="chapter-checkpoints-heading">{t("Four study checkpoints", "Quattro checkpoint di studio")}</h2>
        <p>{t("Each checkpoint asks for a fresh, self-assessed response. Split the work across sittings whenever you need.", "Ogni checkpoint richiede una nuova risposta con autoverifica. Dividi il lavoro in più sessioni quando serve.")}</p>
        <ol className="chapter-checkpoints">
          {selected.dayIndices.map((index) => {
            const saved = evidence.routeSelected && p.academy?.programme?.completed[String(index)];
            return <li key={index}>
              <span className="eyebrow">{t(`STUDY DAY ${index + 1}`, `GIORNO DI STUDIO ${index + 1}`)}</span>
              <strong>{text(programme.days[index].title).split(" · ").at(-1)}</strong>
              <span>{saved ? t(`Saved · ${saved}`, `Salvato · ${saved}`) : t("No checkpoint completion saved", "Nessun completamento del checkpoint salvato")}</span>
            </li>;
          })}
        </ol>
        <button className="button secondary" onClick={() => go("programmes")}>{t("Open my saved programme", "Apri il mio percorso salvato")} →</button>
        {!evidence.routeSelected && <p className="hint">{t("The 80-day book route is available on the programme page. Viewing it does not select it.", "Il percorso dei libri in 80 giorni di studio è nella pagina dei percorsi. Consultarlo non lo seleziona.")}</p>}
      </section>

      <section className="chapter-sources" aria-labelledby="chapter-sources-heading">
        <h2 id="chapter-sources-heading">{t("Sources for this chapter practice", "Fonti per la pratica del capitolo")}</h2>
        <p>{t("References use physical PDF pages, including covers. Connect your local PDF in Materials to open the cited page; a combined export is opened at its matching page offset.", "I riferimenti usano le pagine fisiche del PDF, comprese le copertine. Collega il PDF locale in Materiali per aprire la pagina citata; un’esportazione combinata si apre con lo scarto di pagina corrispondente.")}</p>
        {selected.sources.map(({ source, pages, kind }) => <article className="panel" key={source.id}>
          <p className="eyebrow">{kind === "reader" ? t("READER PDF", "PDF DEL LETTORE")
            : kind === "teacher-support" ? t("TEACHER SUPPORT", "SUPPORTO PER DOCENTI")
              : kind === "contents" ? t("CONTENTS INDEX", "INDICE DEI CONTENUTI") : t("CLASS SOURCE", "FONTE DEL CORSO")}</p>
          <h3>{source.title}</h3>
          {kind === "teacher-support" && <p className="hint">{t("These pages support topic and teaching context; they are separate from the student reader.", "Queste pagine documentano temi e contesto didattico; sono separate dal libro dello studente.")}</p>}
          {kind === "contents" && <p className="hint">{t("The index confirms topic order; it is not the full lesson text.", "L’indice conferma l’ordine dei temi; non è il testo completo della lezione.")}</p>}
          <p>{t(`Cited physical pages · ${source.pages} pages in this source`, `Pagine fisiche citate · ${source.pages} pagine nella fonte`)}</p>
          <div className="chapter-source-pages">
            {pages.map((page) => pdfs[source.id]
              ? <a className="button secondary" key={page} href={localPdfPageHref(pdfs[source.id], page, pdfPageOffsets[source.id] ?? 0)} target="_blank" rel="noreferrer">{t(`Page ${page}`, `Pagina ${page}`)}</a>
              : <span key={page}>{t(`Page ${page}`, `Pagina ${page}`)}</span>)}
          </div>
          {pdfs[source.id] && (pdfPageOffsets[source.id] ?? 0) > 0 && <p className="hint">{t("Pages in the connected export", "Pagine nell’esportazione collegata")}: {pages.map((page) => page + pdfPageOffsets[source.id]).join(", ")}</p>}
          {!pdfs[source.id] && <button className="text-button" onClick={() => go("materials")}>{t("Connect a local PDF", "Collega un PDF locale")} →</button>}
        </article>)}
      </section>
    </div>;
  }

  const shown = chapters.filter((chapter) => book === "all" || String(chapter.book) === book);
  const completed = chapters.filter((chapter) => p.completed[chapter.missionId]).length;
  const active = p.academy?.programme;
  const suggested = chapters.find((chapter) => active?.id === BOOK_PROGRAMME_ID && chapter.dayIndices.includes(active.day))
    ?? chapters.find((chapter) => !p.completed[chapter.missionId]) ?? chapters[0];
  return <div className="workspace chapter-dashboard">
    <p className="eyebrow">{t("TWO BOOKS · TWENTY CHAPTERS · A1–A2", "DUE LIBRI · VENTI CAPITOLI · A1–A2")}</p>
    <h1 ref={heading} tabIndex={-1}>{t("Find your chapter. Keep learning.", "Trova il capitolo. Continua a imparare.")}</h1>
    <p className="chapter-goal">{t("Keep each chapter’s lesson, words, grammar and source pages together. Follow the suggested next step or choose what you want to practise.", "Trova insieme lezione, parole, grammatica e pagine delle fonti di ogni capitolo. Segui il prossimo passo suggerito o scegli su che cosa esercitarti.")}</p>
    <section className="panel chapter-overview-summary" aria-label={t("Saved book learning", "Apprendimento dei libri salvato")}>
      <p><strong>{completed}/20</strong> {t("chapter core lessons completed", "lezioni base dei capitoli completate")}</p>
      <p>{active?.id === BOOK_PROGRAMME_ID
        ? Object.keys(active.completed).length === programme.days.length
          ? t("All eighty book-route checkpoints have a saved completion.", "Tutti gli ottanta checkpoint del percorso dei libri hanno un completamento salvato.")
          : t(`Your saved book route is at study day ${Math.min(active.day + 1, 80)} of 80.`, `Il percorso dei libri è al giorno di studio ${Math.min(active.day + 1, 80)} di 80.`)
        : t("Your current programme stays selected while you browse these chapters.", "Il percorso attuale rimane selezionato mentre esplori i capitoli.")}</p>
      <button className="button primary" onClick={() => go(`chapters/${suggested.id}`)}>{completed === chapters.length ? t("Revisit a chapter", "Riprendi un capitolo") : t("Open my next chapter", "Apri il mio prossimo capitolo")} →</button>
      <p className="hint">{t("Vocabulary self-reports and game answers are shown separately from recorded completions.", "Le autoverifiche lessicali e le risposte nei giochi sono distinte dai completamenti registrati.")}</p>
    </section>
    <div className="chapter-book-filter" role="group" aria-label={t("Choose a book", "Scegli un libro")}>
      {[["all", t("Both books", "Entrambi i libri")], ["1", "Plus 1 · A1"], ["2", "Plus 2 · A2"]].map(([value, label]) => <button className="button secondary" key={value} aria-pressed={book === value} onClick={() => openOverview(value)}>{label}</button>)}
    </div>
    {[1, 2].map((number) => {
      const bookChapters = shown.filter((chapter) => chapter.book === number);
      if (!bookChapters.length) return null;
      return <section className="chapter-book" key={number} aria-labelledby={`chapter-book-${number}`}>
        <h2 id={`chapter-book-${number}`}>Nuovo Espresso Plus {number} · {number === 1 ? "A1" : "A2"}</h2>
        <div className="chapter-cards">
          {bookChapters.map((chapter) => <article className="panel chapter-card" key={chapter.id}>
            <p className="eyebrow">{chapterLabel(chapter)} · {chapter.level}</p>
            <h3>{text(chapter.title)}</h3>
            <p>{text(chapter.goal)}</p>
            {recordedEvidence(chapter)}
            <button className="button secondary" onClick={() => go(`chapters/${chapter.id}`)}>{t("Open this chapter", "Apri questo capitolo")} →</button>
          </article>)}
        </div>
      </section>;
    })}
  </div>;
}
