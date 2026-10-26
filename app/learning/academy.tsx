import { useEffect, useRef, useState, type FormEvent } from "react";
import grammarData from "./grammar.json";
import companionData from "./companion.json";
import { exercisePrompt, modelAnswerMismatch } from "./learning-utils";
import { localPdfPageHref } from "./local-pdfs";
import { grammarSearchText, normaliseSearch, preferredGrammarUnitId } from "./discovery-index";
import { catalogueParams, catalogueRoute, focusStudyHeading, replaceCatalogueParams } from "./navigation";
import {
  checkGrammarAnswer,
  completeCompanion,
  completeGrammarUnit,
  completeProgrammeDay,
  completeProgrammePractice,
  getCompanionDraft,
  getGrammarDraft,
  getGrammarRecallDraft,
  getProgrammePracticeDraft,
  grammarScore,
  grammarReviewQueue,
  programmeDayReady,
  selectProgramme,
  saveWord,
  wordKey,
  updateCompanionDraft,
  updateGrammarDraft,
  updateGrammarRecallDraft,
  updateProgrammePracticeDraft,
} from "./academy-engine";
import type {
  PageCompanion,
  GrammarExercise,
  GrammarUnit,
  Pair,
  Programme,
  Progress,
  Source,
} from "./types";
import "./academy.css";

type Translate = (en: string, it: string) => string;
type Shared = {
  p: Progress;
  t: Translate;
  text: (pair: Pair) => string;
  save: (update: (state: Progress) => Progress) => void;
  go: (route: string) => void;
  today: string;
  pdfs?: Record<string, string>;
  pdfPageOffsets?: Record<string, number>;
};
const units = grammarData.units as GrammarUnit[];
const programmes = grammarData.programmes as Programme[];
const pages = companionData.pages as PageCompanion[];
const sources = companionData.sources as Source[];
type PracticeFilter = "all" | "repair" | "tense" | "due";
const unitById = (id: string) => units.find((unit) => unit.id === id);
const exerciseLabel = (kind: GrammarExercise["kind"], t: Translate) =>
  ({
    choice: t("Choose the form", "Scegli la forma"),
    gap: t("Fill the gap", "Completa"),
    reorder: t("Build a sentence", "Costruisci una frase"),
    correct: t("Find and repair", "Trova e correggi"),
    transform: t("Change the sentence", "Trasforma la frase"),
    tense: t("Check the time & tense", "Controlla tempo e verbo"),
  })[kind];

function Meter({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label: string;
}) {
  return (
    <div className="academy-meter">
      <div>
        <span>{label}</span>
        <strong>
          {value}/{max}
        </strong>
      </div>
      <progress max={Math.max(1, max)} value={value} aria-label={label} />
    </div>
  );
}

function ItalianExample({
  pair,
  showEnglish,
}: {
  pair: Pair;
  showEnglish: boolean;
}) {
  return (
    <div className="academy-example">
      <p lang="it">{pair.it}</p>
      {showEnglish && <p lang="en">{pair.en}</p>}
    </div>
  );
}

export function GrammarLab(props: Shared & { unitId?: string }) {
  const { p, t, text, go, unitId, today } = props;
  const params = catalogueParams();
  const [query, setQuery] = useState(() => (params.get("q") ?? "").slice(0, 200));
  const [filter, setFilter] = useState<PracticeFilter>(["repair", "tense", "due"].includes(params.get("filter") ?? "") ? params.get("filter") as PracticeFilter : "all");
  const catalogueHeading = useRef<HTMLHeadingElement>(null);
  const reviewQueue = grammarReviewQueue(p, units, today);
  const selected = unitById(unitId ?? "");
  useEffect(() => selected ? undefined : focusStudyHeading(catalogueHeading.current), [selected]);
  const openUnit = (id: string) => go(catalogueRoute(`grammar/${id}`, { q: query, filter }));
  const changeSearch = (nextQuery: string, nextFilter = filter) => {
    setQuery(nextQuery.slice(0, 200)); setFilter(nextFilter);
    replaceCatalogueParams({ q: nextQuery, filter: nextFilter });
  };
  if (selected && params.get("review") === "1")
    return <GrammarReview key={`${selected.id}:${params.get("exercise")}`} {...props} unit={selected} exerciseId={params.get("exercise") ?? ""} />;
  if (selected)
    return <UnitLesson key={`${selected.id}:${params.get("practice") === "1"}`} {...props} unit={selected} practice={params.get("practice") === "1"} />;
  const matches = (unit: GrammarUnit) => {
    const needle = normaliseSearch(query);
    const draft = getGrammarDraft(p, unit.id);
    return (
      (!needle || grammarSearchText(unit).includes(needle)) &&
      (filter === "all" ||
        (filter === "due" &&
          reviewQueue.some((item) => item.unit.id === unit.id)) ||
        (filter === "tense" &&
          unit.exercises.some((exercise) => exercise.kind === "tense")) ||
        (filter === "repair" &&
          Object.values(draft.attempts).some((attempts) =>
            attempts.some((attempt) => !attempt.correct || attempt.assisted),
          )))
    );
  };
  const shown = units.filter(matches);
  const mastered = units.filter(
    (unit) => grammarScore(p, unit).completed,
  ).length;
  const attempted = units.reduce(
    (sum, unit) => sum + grammarScore(p, unit).attempted,
    0,
  );
  const repaired = units.reduce((sum, unit) => {
    const draft = getGrammarDraft(p, unit.id);
    return (
      sum +
      Object.values(draft.attempts).filter(
        (attempts) =>
          attempts.some((attempt) => !attempt.correct) &&
          attempts.at(-1)?.correct,
      ).length
    );
  }, 0);
  return (
    <div className="workspace academy">
      <div className="academy-intro">
        <div>
          <p className="eyebrow">
            {t(
              "YOUR GRAMMAR WORKSHOP",
              "IL TUO LABORATORIO DI GRAMMATICA",
            )}
          </p>
          <h1 ref={catalogueHeading} tabIndex={-1} className="study-focus-heading">{t("Make the sentence yours.", "Fai tua la frase.")}</h1>
          <p>
            {t(
              "Understand the pattern, practise with support, then use it in your own life. Start with one topic; every draft stays here for your next visit.",
              "Capisci la regola, esercitati con un aiuto, poi usala nella tua vita. Inizia con un argomento: ogni bozza resta qui per la prossima visita.",
            )}
          </p>
          <div className="button-row">
            <button
              className="button primary"
              onClick={() =>
                openUnit(preferredGrammarUnitId(p, units, programmes) ?? units[0]?.id)
              }
            >
              {t(
                "Continue my grammar journey",
                "Continua il mio percorso di grammatica",
              )}{" "}
              →
            </button>
            <button className="text-button" onClick={() => go("programmes")}>
              {t("Choose a study programme", "Scegli un percorso")}
            </button>
          </div>
        </div>
        <div className="academy-notebook-mark" aria-hidden="true">
          <span>io parlo</span>
          <span>tu parli</span>
          <span>
            noi <b>parliamo.</b>
          </span>
          <small>piccoli passi, ogni giorno</small>
        </div>
      </div>
      <div
        className="academy-stat-strip"
        aria-label={t("Your grammar practice", "La tua pratica di grammatica")}
      >
        <div>
          <strong>
            {mastered}
            <small>/{units.length}</small>
          </strong>
          <span>{t("units completed", "unità completate")}</span>
        </div>
        <div>
          <strong>{attempted}</strong>
          <span>{t("questions tried", "domande provate")}</span>
        </div>
        <div>
          <strong>{repaired}</strong>
          <span>{t("mistakes repaired", "errori corretti")}</span>
        </div>
        <p>
          {t(
            "A correction is progress. Hints are welcome; first tries and supported practice stay distinct.",
            "Una correzione è un progresso. Usa gli aiuti: i primi tentativi e la pratica guidata restano distinti.",
          )}
        </p>
      </div>
      <div className="academy-toolbar">
        <label className="field">
          {t("Find a grammar topic or word", "Cerca un argomento o una parola")}
          <input
            type="search"
            value={query}
            maxLength={200}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder={t(
              "Try articles, past, essere…",
              "Prova articoli, passato, essere…",
            )}
          />
        </label>
        <div
          className="academy-filters"
          aria-label={t(
            "Filter grammar units",
            "Filtra le unità di grammatica",
          )}
        >
          {(
            [
              ["all", t("All topics", "Tutti gli argomenti")],
              ["repair", t("My corrections", "Le mie correzioni")],
              ["due", t("Due for recall", "Da ripassare")],
              ["tense", t("Tense checks", "Controllo dei tempi")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              onClick={() => changeSearch(query, id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {filter === "due" && (
        <p className="academy-guidance">
          {t(
            "Revisit these questions after a gap: try them before reading the explanation. In a unit, select “Practise” → “Due for recall”.",
            "Rivedi queste domande dopo una pausa: provale prima di rileggere la spiegazione. Nell’unità, seleziona «Esercitati» → «Da ripassare».",
          )}
        </p>
      )}
      {filter === "repair" && (
        <p className="academy-guidance">
          {t(
            "These units contain an error or an assisted answer. Open a unit and choose “Practise” → “Corrections” to revisit the exact questions. Your original first attempt stays in your record.",
            "Queste unità contengono un errore o una risposta aiutata. Apri un’unità e scegli «Esercitati» → «Correzioni» per riprovare le domande. Il primo tentativo originale resta nel tuo registro.",
          )}
        </p>
      )}
      {filter === "tense" && (
        <p className="academy-guidance">
          {t(
            "Notice the time clue before choosing a verb. Each unit’s “Tense checks” filter takes you straight to those questions.",
            "Osserva l’indicazione temporale prima di scegliere il verbo. Il filtro «Controllo dei tempi» in ogni unità ti porta direttamente a quelle domande.",
          )}
        </p>
      )}
      <p className="academy-result-count" role="status">
        {shown.length} {t("topics shown", "argomenti visualizzati")}
      </p>
      <div className="academy-unit-grid">
        {shown.map((unit) => {
          const score = grammarScore(p, unit);
          const prerequisites = unit.prerequisites
            .map(unitById)
            .filter((item): item is GrammarUnit => Boolean(item));
          return (
            <article className="academy-unit-card" key={unit.id}>
              <div className="academy-card-top">
                <span className="tag">
                  {unit.level === "A1-plus"
                    ? t("A1 → A2 bridge", "Ponte A1 → A2")
                    : unit.level}
                </span>
                <span className="academy-status">
                  {score.completed
                    ? t("✓ Completed", "✓ Completata")
                    : score.attempted
                      ? t("In progress", "In corso")
                      : t("Ready to explore", "Da scoprire")}
                </span>
              </div>
              <h2>
                <button onClick={() => openUnit(unit.id)}>
                  {text(unit.title)} <span aria-hidden="true">↗</span>
                </button>
              </h2>
              <p>{text(unit.summary)}</p>
              {prerequisites.length > 0 && (
                <div className="academy-prerequisite">
                  <span>{t("Helpful first:", "Prima può aiutarti:")}</span>{" "}
                  {prerequisites.map((item, index) => (
                    <span key={item.id}>
                      {index > 0 && " · "}
                      <button
                        className="text-button"
                        onClick={() => openUnit(item.id)}
                      >
                        {text(item.title)}
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="academy-card-bottom">
                <Meter
                  value={score.solved}
                  max={score.total}
                  label={t("Questions solved", "Domande risolte")}
                />
                <span>
                  {unit.exercises.length}{" "}
                  {t(
                    "exercises + your own writing",
                    "esercizi + la tua scrittura",
                  )}
                </span>
              </div>
            </article>
          );
        })}
      </div>
      {shown.length === 0 && (
        <div className="academy-empty">
          <h2>{t("A fresh page.", "Una pagina nuova.")}</h2>
          <p>
            {filter === "repair"
              ? t(
                  "No corrections yet. Try a unit: this notebook will collect the questions that need a second look.",
                  "Nessuna correzione per ora. Prova un’unità: il quaderno raccoglierà le domande da rivedere.",
                )
              : t(
                  "No matching topics. Try a shorter search or choose all topics.",
                  "Nessun argomento trovato. Prova una ricerca più breve o scegli tutti gli argomenti.",
                )}
          </p>
        </div>
      )}
      <div className="academy-bottom-links">
        <button className="button secondary" onClick={() => go("vocabulary")}>
          {t("Open my word banks", "Apri le mie raccolte di parole")} →
        </button>
        <button className="button secondary" onClick={() => go("companion")}>
          {t(
            "Practise beside my class material",
            "Esercitati con il materiale del corso",
          )}{" "}
          →
        </button>
      </div>
    </div>
  );
}

function GrammarReview(props: Shared & { unit: GrammarUnit; exerciseId: string }) {
  const { p, t, text, go, today, unit, exerciseId } = props;
  const exercise = unit.exercises.find((item) => item.id === exerciseId);
  // Eligibility is captured on entry so checking an answer keeps its feedback
  // visible. Opening a review never changes the ordinary lesson draft position.
  const [eligible] = useState(() => grammarReviewQueue(p, [unit], today).some((item) => item.exercise.id === exerciseId));
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => eligible ? undefined : focusStudyHeading(heading.current), [eligible]);
  const checkedToday = getGrammarDraft(p, unit.id).attempts[exerciseId]?.some((attempt) => attempt.date === today);
  return <div className="workspace academy">
    <button className="text-button" onClick={() => go("reviews")}>← {t("Back to review queue", "Torna al ripasso del giorno")}</button>
    <p className="eyebrow">{t("ONE SCHEDULED RECALL", "UN RIPASSO PROGRAMMATO")}</p>
    <h1 ref={heading} tabIndex={-1}>{text(unit.title)}</h1>
    {exercise && eligible ? <ExerciseCard {...props} exercise={exercise} recall /> : <section className="panel" role="status">
      <h2>{checkedToday ? t("Already checked today", "Già controllato oggi") : t("This exercise is not due now", "Questo esercizio non è da ripassare ora")}</h2>
      <p>{t("Return to your queue for the next scheduled item, or open the lesson for extra practice.", "Torna all’elenco per il prossimo ripasso programmato oppure apri la lezione per altra pratica.")}</p>
    </section>}
    <div className="button-row">
      <button className="button primary" onClick={() => go("reviews")}>{t("Return to my review queue", "Torna al mio ripasso")}</button>
      <button className="button secondary" onClick={() => go(`grammar/${unit.id}`)}>{t("Open the full lesson", "Apri la lezione completa")}</button>
    </div>
  </div>;
}

function UnitLesson({
  p,
  t,
  text,
  save,
  go,
  today,
  unit,
  practice = false,
  pdfs,
  pdfPageOffsets,
}: Shared & { unit: GrammarUnit; practice?: boolean }) {
  const draft = getGrammarDraft(p, unit.id);
  const score = grammarScore(p, unit);
  const [stage, setStage] = useState<"learn" | "practise" | "produce">(
    practice ? "practise" : draft.output ? "produce" : score.attempted ? "practise" : "learn",
  );
  const [mode, setMode] = useState<PracticeFilter>(() => practice && grammarReviewQueue(p, [unit], today).length ? "due" : "all");
  const [notice, setNotice] = useState("");
  const unitHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => focusStudyHeading(unitHeading.current), [unit.id]);
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const changeStage = (next: typeof stage) => {
    setStage(next);
    setNotice("");
    window.setTimeout(() => stageHeading.current?.focus(), 0);
  };
  const patch = (update: Parameters<typeof updateGrammarDraft>[2]) =>
    save((state) => updateGrammarDraft(state, unit.id, update));
  const [dueIds, setDueIds] = useState(
    () =>
      new Set(
        grammarReviewQueue(p, [unit], today).map((item) => item.exercise.id),
      ),
  );
  const selectedQuestions = unit.exercises.filter(
    (exercise) =>
      mode === "all" ||
      (mode === "due" && dueIds.has(exercise.id)) ||
      (mode === "tense" && exercise.kind === "tense") ||
      (mode === "repair" &&
        draft.attempts[exercise.id]?.some(
          (attempt) => !attempt.correct || attempt.assisted,
        )),
  );
  const current =
    selectedQuestions.find(
      (exercise) => unit.exercises.indexOf(exercise) === draft.exerciseIndex,
    ) ?? selectedQuestions[0];
  const questionIndex = current ? selectedQuestions.indexOf(current) : 0;
  const prerequisites = unit.prerequisites
    .map(unitById)
    .filter((item): item is GrammarUnit => Boolean(item));
  const fullRubric =
    draft.output.trim().split(/\s+/).filter(Boolean).length >= 3 &&
    unit.production.rubric.every((_, index) => draft.rubric.includes(index));
  const ready = score.solved === score.total && fullRubric;
  return (
    <div className="workspace academy">
      <button
        className="text-button academy-back"
        onClick={() => {
          const params = catalogueParams();
          go(catalogueRoute("grammar", { q: params.get("q") ?? "", filter: params.get("filter") ?? "all" }));
        }}
      >
        ← {t("All grammar topics", "Tutti gli argomenti di grammatica")}
      </button>
      <div className="academy-unit-heading">
        <div>
          <p className="eyebrow">
            {unit.level === "A1-plus"
              ? t("A1 → A2 BRIDGE", "PONTE A1 → A2")
              : t(
                  `${unit.level} · GUIDED GRAMMAR`,
                  `${unit.level} · GRAMMATICA GUIDATA`,
                )}
          </p>
          <h1 ref={unitHeading} tabIndex={-1} className="study-focus-heading">{text(unit.title)}</h1>
          <p>{text(unit.summary)}</p>
        </div>
        <div className="academy-unit-progress">
          <Meter
            value={score.solved}
            max={score.total}
            label={t("Questions solved", "Domande risolte")}
          />
          <span>
            {t("First try, without hints", "Primo tentativo, senza aiuti")}:{" "}
            {score.firstCorrect}/{score.attempted || 0}
          </span>
          {score.completed && (
            <b>{t("✓ Unit completed", "✓ Unità completata")}</b>
          )}
        </div>
      </div>
      <nav
        className="academy-steps"
        aria-label={t(
          "Steps in this grammar unit",
          "Fasi dell’unità di grammatica",
        )}
      >
        {(
          [
            ["learn", t("Learn", "Capisci")],
            ["practise", t("Practise", "Esercitati")],
            ["produce", t("Use it", "Usala")],
          ] as const
        ).map(([id, label], index) => (
          <button
            key={id}
            aria-current={stage === id ? "step" : undefined}
            onClick={() => changeStage(id)}
          >
            <span>{index + 1}</span>
            {label}
          </button>
        ))}
      </nav>
      {stage === "learn" && (
        <div className="academy-lesson-layout">
          <section className="academy-sheet">
            <h2 ref={stageHeading} tabIndex={-1}>
              {t(
                "A small rule. A useful sentence.",
                "Una piccola regola. Una frase utile.",
              )}
            </h2>
            <ol className="academy-teaching">
              {unit.teaching.map((point, index) => (
                <li key={index}>
                  <span>{index + 1}</span>
                  <p>{text(point)}</p>
                </li>
              ))}
            </ol>
            <h3>
              {t(
                "Notice it in real sentences",
                "Osserva la regola nelle frasi",
              )}
            </h3>
            <div className="academy-examples">
              {unit.examples.map((example, index) => (
                <ItalianExample
                  key={index}
                  pair={example}
                  showEnglish={p.translations}
                />
              ))}
            </div>
            <div className="button-row">
              <button
                className="button primary"
                onClick={() => changeStage("practise")}
              >
                {t("Try it step by step", "Prova passo dopo passo")} →
              </button>
            </div>
          </section>
          <aside className="academy-side-notes">
            <section>
              <p className="eyebrow">
                {t("WORDS AT HAND", "PAROLE A PORTATA DI MANO")}
              </p>
              <dl className="academy-word-list">
                {unit.words.map((word, index) => (
                  <div key={index}>
                    <dt lang="it">{word.it}</dt>
                    <dd lang="en">{word.en}</dd>
                    <button
                      className="academy-save-word"
                      aria-label={`${p.academy?.words[wordKey(word)]?.starred ? t("Remove saved word", "Rimuovi parola salvata") : t("Save word", "Salva parola")}: ${word.it}`}
                      aria-pressed={Boolean(
                        p.academy?.words[wordKey(word)]?.starred,
                      )}
                      onClick={() => save((state) => saveWord(state, word))}
                    >
                      {p.academy?.words[wordKey(word)]?.starred ? "★" : "☆"}
                    </button>
                  </div>
                ))}
              </dl>
              <button className="text-button" onClick={() => go("words")}>
                {t("Review my saved words", "Ripassa le parole salvate")} →
              </button>
              <br />
              <button className="text-button" onClick={() => go("vocabulary")}>
                {t("More words & examples", "Altre parole ed esempi")} →
              </button>
            </section>
            {prerequisites.length > 0 && (
              <section>
                <h3>
                  {t("Need a smaller step?", "Ti serve un passo più piccolo?")}
                </h3>
                <p>
                  {t(
                    "Revisit these first if the explanation feels new.",
                    "Rivedi prima questi argomenti se la spiegazione è nuova.",
                  )}
                </p>
                {prerequisites.map((item) => (
                  <button
                    className="academy-side-link"
                    key={item.id}
                    onClick={() => go(`grammar/${item.id}`)}
                  >
                    {text(item.title)} →
                  </button>
                ))}
              </section>
            )}
            <UnitSources unit={unit} t={t} go={go} pdfs={pdfs} pdfPageOffsets={pdfPageOffsets} />
          </aside>
        </div>
      )}
      {stage === "practise" && (
        <section className="academy-practice">
          <div className="academy-practice-heading">
            <h2 ref={stageHeading} tabIndex={-1}>
              {t(
                "One good attempt at a time.",
                "Un buon tentativo alla volta.",
              )}
            </h2>
            <div
              className="academy-filters"
              aria-label={t(
                "Choose practice mode",
                "Scegli la modalità di pratica",
              )}
            >
              {(
                [
                  ["all", t("All exercises", "Tutti gli esercizi")],
                  ["repair", t("Corrections", "Correzioni")],
                  ["due", t("Due for recall", "Da ripassare")],
                  ["tense", t("Tense checks", "Controllo dei tempi")],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={mode === id}
                  onClick={() => {
                    setMode(id);
                    if (id === "due")
                      setDueIds(
                        new Set(
                          grammarReviewQueue(p, [unit], today).map(
                            (item) => item.exercise.id,
                          ),
                        ),
                      );
                    setNotice("");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {mode === "due" && (
            <p className="academy-guidance">
              {t(
                "Recall before rereading. Your old feedback is hidden until you check this new attempt.",
                "Ricorda prima di rileggere. Il feedback precedente è nascosto fino al nuovo controllo.",
              )}
            </p>
          )}
          {mode === "repair" && (
            <p className="academy-guidance">
              {t(
                "Try a previous difficulty without looking back. “Try again from memory” clears the answer field while preserving your first attempt.",
                "Riprova una difficoltà senza guardare indietro. «Riprova a memoria» svuota la risposta conservando il primo tentativo.",
              )}
            </p>
          )}
          {current ? (
            <>
              <div className="academy-question-layout">
                <ExerciseCard
                  key={`${current.id}:${mode}`}
                  {...{ p, t, text, save, today, go, unit, exercise: current }}
                  recall={mode === "due"}
                />
                <aside className="academy-question-map">
                  <h3>
                    {t("Your practice trail", "Il tuo percorso di pratica")}
                  </h3>
                  <p>
                    {t(
                      "Move freely. Answers save as you type.",
                      "Muoviti liberamente. Le risposte si salvano mentre scrivi.",
                    )}
                  </p>
                  <div className="academy-question-dots">
                    {selectedQuestions.map((exercise, index) => {
                      const attempts = draft.attempts[exercise.id] ?? [];
                      const solved = attempts.some(
                        (attempt) => attempt.correct,
                      );
                      return (
                        <button
                          key={exercise.id}
                          aria-current={
                            exercise.id === current.id ? "step" : undefined
                          }
                          className={
                            solved
                              ? "solved"
                              : attempts.length
                                ? "attempted"
                                : ""
                          }
                          aria-label={`${t("Exercise", "Esercizio")} ${index + 1}: ${solved ? t("solved", "risolto") : attempts.length ? t("needs another try", "da riprovare") : t("not tried", "da provare")}`}
                          onClick={() =>
                            patch({
                              exerciseIndex: unit.exercises.indexOf(exercise),
                            })
                          }
                        >
                          {solved ? "✓" : index + 1}
                        </button>
                      );
                    })}
                  </div>
                  <div className="academy-score-note">
                    <b>
                      {score.firstCorrect}/{score.attempted}
                    </b>
                    <span>
                      {t(
                        "correct on the first try without hints",
                        "corrette al primo tentativo senza aiuti",
                      )}
                    </span>
                    <p>
                      {t(
                        "Corrections improve your practice result. They do not rewrite your first try.",
                        "Le correzioni migliorano il risultato della pratica. Non cambiano il primo tentativo.",
                      )}
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => changeStage("learn")}
                  >
                    ← {t("Revisit the explanation", "Rileggi la spiegazione")}
                  </button>
                </aside>
              </div>
              <div className="academy-exercise-nav">
                <button
                  className="button secondary"
                  disabled={questionIndex === 0}
                  onClick={() =>
                    patch({
                      exerciseIndex: unit.exercises.indexOf(
                        selectedQuestions[questionIndex - 1],
                      ),
                    })
                  }
                >
                  ← {t("Previous", "Precedente")}
                </button>
                <span>
                  {questionIndex + 1} / {selectedQuestions.length}
                </span>
                {questionIndex < selectedQuestions.length - 1 ? (
                  <button
                    className="button primary"
                    onClick={() =>
                      patch({
                        exerciseIndex: unit.exercises.indexOf(
                          selectedQuestions[questionIndex + 1],
                        ),
                      })
                    }
                  >
                    {t("Next exercise", "Prossimo esercizio")} →
                  </button>
                ) : (
                  <button
                    className="button primary"
                    onClick={() => changeStage("produce")}
                  >
                    {t("Use it in my life", "Usala nella mia vita")} →
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="academy-empty">
              <h3>
                {t(
                  "Nothing in this practice view yet.",
                  "Nessun esercizio in questa vista per ora.",
                )}
              </h3>
              <p>
                {mode === "repair"
                  ? t(
                      "Your corrections will appear after an error or an assisted answer. All exercises are available now.",
                      "Le correzioni appariranno dopo un errore o una risposta aiutata. Tutti gli esercizi sono già disponibili.",
                    )
                  : mode === "due"
                    ? t(
                        "No questions are due yet. Come back after a day for supported answers or three days for independent answers.",
                        "Nessuna domanda è ancora da ripassare. Torna dopo un giorno per le risposte guidate o tre giorni per quelle autonome.",
                      )
                    : t(
                        "This unit has no separate tense checks. Choose all exercises or explore another grammar topic.",
                        "Questa unità non ha controlli separati dei tempi. Scegli tutti gli esercizi o esplora un altro argomento.",
                      )}
              </p>
              <button
                className="button secondary"
                onClick={() => setMode("all")}
              >
                {t("Show all exercises", "Mostra tutti gli esercizi")}
              </button>
            </div>
          )}
        </section>
      )}
      {stage === "produce" && (
        <div className="academy-lesson-layout">
          <section className="academy-sheet">
            <p className="eyebrow">
              {t(
                "YOUR WORDS · SELF-CHECKED",
                "LE TUE PAROLE · AUTOVALUTAZIONE",
              )}
            </p>
            <h2 ref={stageHeading} tabIndex={-1}>
              {t("A little Italian about you.", "Un po’ d’italiano su di te.")}
            </h2>
            <p className="academy-task">{text(unit.production.prompt)}</p>
            <div className="academy-frame">
              <strong>
                {t(
                  "Start here if you need a hand",
                  "Inizia qui se ti serve una mano",
                )}
              </strong>
              <p lang="it">{unit.production.frame.it}</p>
              {p.translations && <p lang="en">{unit.production.frame.en}</p>}
            </div>
            <label className="field">
              {t("My Italian response", "La mia risposta in italiano")}
              <textarea
                rows={6}
                lang="it"
                maxLength={2000}
                aria-label={t(
                  "My Italian response",
                  "La mia risposta in italiano",
                )}
                value={draft.output}
                onChange={(event) =>
                  patch({ output: event.target.value, rubric: [] })
                }
                placeholder={t(
                  "Use your own details. Short sentences are enough.",
                  "Usa i tuoi dettagli. Bastano frasi brevi.",
                )}
              />
            </label>
            <p className="academy-save-note">
              {t(
                "Draft saved in this browser. Read it aloud once, then check each point.",
                "Bozza salvata in questo browser. Leggila una volta ad alta voce, poi controlla ogni punto.",
              )}
            </p>
            <fieldset className="academy-checklist">
              <legend>
                {t("I checked my own writing", "Ho controllato il mio testo")}
              </legend>
              {unit.production.rubric.map((criterion, index) => (
                <label key={index}>
                  <input
                    type="checkbox"
                    checked={draft.rubric.includes(index)}
                    onChange={(event) =>
                      patch({
                        rubric: event.target.checked
                          ? [...draft.rubric, index]
                          : draft.rubric.filter((item) => item !== index),
                      })
                    }
                  />
                  <span>{text(criterion)}</span>
                </label>
              ))}
            </fieldset>
            <button
              className="text-button"
              aria-expanded={draft.modelSeen}
              onClick={() => patch({ modelSeen: !draft.modelSeen })}
            >
              {draft.modelSeen
                ? t(
                    "Hide the sample response",
                    "Nascondi la risposta di esempio",
                  )
                : t(
                    "Show a sample after my attempt",
                    "Mostra un esempio dopo il mio tentativo",
                  )}{" "}
              {draft.modelSeen ? "−" : "+"}
            </button>
            {draft.modelSeen && (
              <div className="academy-model">
                <p className="eyebrow">
                  {t("ONE POSSIBLE RESPONSE", "UNA RISPOSTA POSSIBILE")}
                </p>
                <ItalianExample
                  pair={unit.production.model}
                  showEnglish={p.translations}
                />
                <p>
                  {t(
                    "Your personal response can be different. Compare the grammar pattern, then make your own version.",
                    "La tua risposta personale può essere diversa. Confronta la struttura grammaticale, poi crea la tua versione.",
                  )}
                </p>
              </div>
            )}
            <div className="academy-finish">
              <h3>
                {score.completed
                  ? t(
                      "✓ You completed this unit.",
                      "✓ Hai completato questa unità.",
                    )
                  : t("Bring the three steps together.", "Unisci i tre passi.")}
              </h3>
              <p>
                {t(
                  "Finish when every exercise is solved and you have checked your own writing. Writing and pronunciation are not automatically graded.",
                  "Termina quando tutti gli esercizi sono risolti e hai controllato il tuo testo. Scrittura e pronuncia non ricevono una valutazione automatica.",
                )}
              </p>
              {!ready && (
                <p className="academy-remaining">
                  {score.solved < score.total
                    ? `${score.total - score.solved} ${t("exercise(s) still to solve.", "esercizi ancora da risolvere.")} `
                    : ""}
                  {!fullRubric
                    ? t(
                        "Write at least three words and tick each self-check.",
                        "Scrivi almeno tre parole e spunta ogni controllo.",
                      )
                    : ""}
                </p>
              )}
              <div className="button-row">
                <button
                  className="button primary"
                  disabled={!ready}
                  onClick={() => {
                    save((state) => completeGrammarUnit(state, unit, today));
                    setNotice(
                      t(
                        "Unit saved as completed. Your first-try record and writing are kept.",
                        "Unità salvata come completata. I primi tentativi e il tuo testo sono conservati.",
                      ),
                    );
                  }}
                >
                  {score.completed
                    ? t("Save my practice", "Salva la mia pratica")
                    : t("Complete this unit", "Completa questa unità")}{" "}
                  ✓
                </button>
                <button
                  className="button secondary"
                  onClick={() => changeStage("practise")}
                >
                  {t("Back to exercises", "Torna agli esercizi")}
                </button>
              </div>
              <p role="status">{notice}</p>
            </div>
          </section>
          <aside className="academy-side-notes">
            <section>
              <h3>{t("Say it, then vary it.", "Dillo, poi cambialo.")}</h3>
              <ol>
                <li>
                  {t(
                    "Read your answer aloud slowly.",
                    "Leggi la risposta lentamente ad alta voce.",
                  )}
                </li>
                <li>
                  {t(
                    "Cover it and say one sentence again.",
                    "Coprila e ripeti una frase.",
                  )}
                </li>
                <li>
                  {t(
                    "Change the person, place or time.",
                    "Cambia la persona, il luogo o il tempo.",
                  )}
                </li>
                <li>
                  {t(
                    "Come back tomorrow and try without help.",
                    "Torna domani e prova senza aiuti.",
                  )}
                </li>
              </ol>
            </section>
            <UnitSources unit={unit} t={t} go={go} pdfs={pdfs} pdfPageOffsets={pdfPageOffsets} />
            <section>
              <button
                className="academy-side-link"
                onClick={() => go("programmes")}
              >
                {t("Return to my programme", "Torna al mio percorso")} →
              </button>
              <button
                className="academy-side-link"
                onClick={() => go("readiness")}
              >
                {t(
                  "Check my A1 foundations",
                  "Verifica le mie basi A1",
                )}{" "}
                →
              </button>
              <p className="hint">
                {t(
                  "This diagnostic covers A1 foundations. A2 topics are practised in their own lessons.",
                  "Questa verifica riguarda le basi A1. Gli argomenti A2 si esercitano nelle rispettive lezioni.",
                )}
              </p>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

function UnitSources({
  unit,
  t,
  go,
  pdfs,
  pdfPageOffsets = {},
}: {
  unit: GrammarUnit;
  t: Translate;
  go: Shared["go"];
  pdfs?: Record<string, string>;
  pdfPageOffsets?: Record<string, number>;
}) {
  return (
    <section>
      <h3>
        {t("Alongside your class material", "Insieme al materiale del corso")}
      </h3>
      <p>
        {t(
          "These are original practice tasks linked to the source pages.",
          "Questi sono esercizi originali collegati alle pagine delle fonti.",
        )}
      </p>
      <ul className="academy-source-list">
        {unit.sources.map((ref) => {
          const source = sources.find((item) => item.id === ref.id);
          const page = pages.find(
            (item) => item.sourceId === ref.id && ref.pages.includes(item.page),
          );
          return (
            <li key={ref.id}>
              <span>{source?.title ?? ref.id}</span>
              <small>
                {t("Pages / slides", "Pagine / diapositive")}:{" "}
                {ref.pages.join(", ")}
              </small>
              {pdfs?.[ref.id] && (
                <a className="text-button" href={localPdfPageHref(pdfs[ref.id], ref.pages[0], pdfPageOffsets[ref.id])} target="_blank" rel="noreferrer">
                  {t("Open connected PDF", "Apri il PDF collegato")} ↗
                </a>
              )}
              {page && (
                <button
                  className="text-button"
                  onClick={() => go(`companion/${page.id}`)}
                >
                  {t("Open page companion", "Apri il compagno della pagina")} →
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ExerciseCard({
  p,
  t,
  text,
  save,
  today,
  unit,
  exercise,
  recall = false,
}: Shared & {
  unit: GrammarUnit;
  exercise: GrammarExercise;
  recall?: boolean;
}) {
  const draft = getGrammarDraft(p, unit.id);
  const pendingRecall = getGrammarRecallDraft(p, unit.id, exercise.id, today);
  const [recallAnswer, setRecallAnswer] = useState<string | undefined>(
    recall ? pendingRecall?.answer ?? "" : undefined,
  );
  const answer = recallAnswer ?? draft.answers[exercise.id] ?? "";
  const attempts = draft.attempts[exercise.id] ?? [];
  const last = attempts.at(-1);
  const [recallHintUsed, setRecallHintUsed] = useState(recall && !!pendingRecall?.hintUsed);
  const hintUsed = recall
    ? recallHintUsed || draft.hintDates?.[exercise.id] === today
    : draft.hints.includes(exercise.id);
  const [showHint, setShowHint] = useState(false);
  const [freshAttempt, setFreshAttempt] = useState(recall);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    questionHeading.current?.focus({ preventScroll: true });
  }, []);
  const answerInput = useRef<HTMLInputElement>(null);
  const updateAnswer = (value: string) => {
    const bounded = value.slice(0, 500);
    if (recall) setRecallAnswer(bounded);
    save((state) =>
      recall ? updateGrammarRecallDraft(state, unit.id, exercise.id, bounded, today, hintUsed) : updateGrammarDraft(state, unit.id, {
        answers: {
          ...getGrammarDraft(state, unit.id).answers,
          [exercise.id]: bounded,
        },
      }),
    );
  };
  const feedbackVisible = Boolean(last && !freshAttempt);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!answer.trim()) return;
    save((state) =>
      checkGrammarAnswer(state, unit, exercise.id, answer, {
        hintUsed,
        today,
        independentRecall:
          recall && !attempts.some((attempt) => attempt.date === today),
      }),
    );
    setFreshAttempt(false);
  };
  return (
    <form className="academy-exercise-card" onSubmit={submit}>
      <div className="academy-card-top">
        <p className="eyebrow">{exerciseLabel(exercise.kind, t)}</p>
        <span className="tag">
          {t("Exercise", "Esercizio")} {unit.exercises.indexOf(exercise) + 1}
        </span>
      </div>
      <h3 ref={questionHeading} tabIndex={-1}>
        {text(exercisePrompt(exercise))}
      </h3>
      {exercise.kind === "reorder" && (
        <div className="academy-reorder">
          <p>
            {t(
              "Tap words in order, or type your sentence below. You can edit the sentence at any time.",
              "Tocca le parole in ordine oppure scrivi la frase qui sotto. Puoi modificarla in qualsiasi momento.",
            )}
          </p>
          <div
            className="academy-tokens"
            aria-label={t(
              "Sentence building blocks",
              "Parole per costruire la frase",
            )}
          >
            {exercise.tokens?.map((token, index) => (
              <button
                type="button"
                key={`${index}:${token}`}
                lang="it"
                onClick={() => updateAnswer(`${answer.trim()} ${token}`.trim())}
                aria-label={`${t("Add", "Aggiungi")} ${token}`}
              >
                {token} <span aria-hidden="true">+</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {exercise.options?.length ? (
        <fieldset className="academy-options">
          <legend>
            {t(
              "Choose one answer in Italian",
              "Scegli una risposta in italiano",
            )}
          </legend>
          {exercise.options.map((option, index) => (
            <label
              key={`${index}:${option}`}
              className={answer === option ? "selected" : ""}
            >
              <input
                type="radio"
                name={exercise.id}
                value={option}
                checked={answer === option}
                onChange={() => updateAnswer(option)}
              />
              <span lang="it">{option}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <label className="field">
          {exercise.kind === "gap"
            ? t(
                "Missing word(s) in Italian",
                "Parola o parole mancanti in italiano",
              )
            : t("Your answer in Italian", "La tua risposta in italiano")}
          <input
            ref={answerInput}
            lang="it"
            maxLength={500}
            aria-label={
              exercise.kind === "gap"
                ? t(
                    "Missing word(s) in Italian",
                    "Parola o parole mancanti in italiano",
                  )
                : t("Your answer in Italian", "La tua risposta in italiano")
            }
            value={answer}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => updateAnswer(event.target.value)}
            aria-describedby={`answer-note-${exercise.id}`}
          />
          <span
            className="academy-answer-note"
            id={`answer-note-${exercise.id}`}
          >
            {t(
              "Keep accents: e means “and”; è means “is”. Capitalisation and final punctuation are flexible.",
              "Mantieni gli accenti: e significa «and»; è significa «is». Maiuscole e punteggiatura finale sono flessibili.",
            )}
          </span>
        </label>
      )}
      <div className="academy-answer-tools">
        <button
          type="button"
          className="text-button"
          aria-expanded={showHint}
          aria-controls={`hint-${exercise.id}`}
          onClick={() => {
            setShowHint(!showHint);
            if (!showHint && recall) setRecallHintUsed(true);
            if (!showHint)
              save((state) => {
                const updated = updateGrammarDraft(state, unit.id, {
                  hints: Array.from(
                    new Set([
                      ...getGrammarDraft(state, unit.id).hints,
                      exercise.id,
                    ]),
                  ),
                  hintDates: {
                    ...getGrammarDraft(state, unit.id).hintDates,
                    [exercise.id]: today,
                  },
                });
                return recall ? updateGrammarRecallDraft(updated, unit.id, exercise.id, answer, today, true) : updated;
              });
          }}
        >
          {showHint
            ? t("Hide hint", "Nascondi aiuto")
            : t("Give me a small hint", "Dammi un piccolo aiuto")}
        </button>
        {answer && !exercise.options?.length && (
          <button
            className="text-button"
            type="button"
            onClick={() => {
              updateAnswer("");
              answerInput.current?.focus();
            }}
          >
            {t("Clear answer", "Svuota la risposta")}
          </button>
        )}
      </div>
      {showHint && (
        <div id={`hint-${exercise.id}`} className="academy-hint">
          <strong>{t("A small clue", "Un piccolo indizio")}</strong>
          <p>{text(exercise.hint)}</p>
          <small>
            {t(
              "This exercise is now marked as supported practice. You still earn practice credit.",
              "Questo esercizio è ora segnato come pratica guidata. La pratica conta comunque.",
            )}
          </small>
        </div>
      )}
      <div className="button-row">
        <button
          className="button primary"
          type="submit"
          disabled={!answer.trim()}
        >
          {attempts.length
            ? t("Check this attempt", "Controlla questo tentativo")
            : t("Check my answer", "Controlla la risposta")}
        </button>
        <span className="academy-save-note">
          {t("Answer saved as you type", "Risposta salvata mentre scrivi")}
        </span>
      </div>
      <div aria-live="polite" aria-atomic="true">
        {feedbackVisible && last && (
          <div
            className={`academy-feedback ${last.correct ? "correct" : "retry"}`}
          >
            <strong>
              {last.correct
                ? last.assisted
                  ? t("✓ Correct with support.", "✓ Corretto con un aiuto.")
                  : t("✓ This answer works.", "✓ Questa risposta va bene.")
                : exercise.options?.length
                  ? t("↺ Let’s repair this together.", "↺ Correggiamo insieme.")
                  : text(modelAnswerMismatch)}
            </strong>
            <p className="academy-submitted">
              {t("You checked:", "Hai controllato:")}{" "}
              <span lang="it">{last.answer}</span>
            </p>
            <p>{text(exercise.explanation)}</p>
            {!last.correct && (
              <p>
                <b>{t("A possible answer:", "Una risposta possibile:")}</b>{" "}
                <span lang="it">{exercise.answers[0]}</span>
              </p>
            )}
            <small>
              {attempts.length === 1
                ? last.assisted
                  ? t(
                      "First try recorded as supported.",
                      "Primo tentativo registrato con aiuto.",
                    )
                  : t(
                      "First try saved. Later corrections keep this record intact.",
                      "Primo tentativo salvato. Le correzioni successive conservano questo risultato.",
                    )
                : t(
                    "Your correction is saved; your original first try is unchanged.",
                    "La correzione è salvata; il primo tentativo originale è conservato.",
                  )}
            </small>
          </div>
        )}
      </div>
      {last && (
        <button
          className="button secondary academy-retry-button"
          type="button"
          onClick={() => {
            updateAnswer("");
            setFreshAttempt(true);
            setShowHint(false);
            answerInput.current?.focus();
          }}
        >
          {t("Try again from memory", "Riprova a memoria")}
        </button>
      )}
      {freshAttempt && (
        <p className="academy-save-note" role="status">
          {t(
            "Previous feedback is covered. Recall the pattern and try once more.",
            "Il feedback precedente è coperto. Ricorda la struttura e riprova.",
          )}
        </p>
      )}
    </form>
  );
}

function ProgrammePractice({
  p, t, text, save, today, programme, index,
}: Shared & { programme: Programme; index: number }) {
  const practice = programme.days[index]?.practice;
  const draft = getProgrammePracticeDraft(p, programme, index);
  const [modelOpen, setModelOpen] = useState(draft.modelSeen);
  if (!practice) return null;
  const editable = p.academy?.programme?.id === programme.id
    && p.academy.programme.day === index && !draft.completed;
  const ready = draft.output.trim().split(/\s+/).length >= 3
    && practice.rubric.every((_, criterion) => draft.rubric.includes(criterion));
  const patch = (value: Parameters<typeof updateProgrammePracticeDraft>[3]) =>
    save((state) => updateProgrammePracticeDraft(state, programme, index, value));
  return (
    <section className="academy-sheet" aria-label={t("Daily personal practice", "Pratica personale del giorno")}>
      <p className="eyebrow">{t("YOUR WORDS · SELF-ASSESSED", "LE TUE PAROLE · AUTOVALUTAZIONE")}</p>
      <h4>{t("Use it in a new situation · about 5 minutes", "Usalo in una nuova situazione · circa 5 minuti")}</h4>
      <p className="academy-task">{text(practice.prompt)}</p>
      <label className="field">
        {t("My response for this study day", "La mia risposta per questo giorno di studio")}
        <textarea
          rows={5}
          lang="it"
          maxLength={2000}
          readOnly={!editable}
          value={draft.output}
          onChange={(event) => patch({ output: event.target.value, rubric: [] })}
          placeholder={t("Write in Italian using your own details.", "Scrivi in italiano usando i tuoi dettagli.")}
        />
      </label>
      <p className="academy-save-note">
        {editable
          ? t("Your draft saves in this browser. Write at least three words, then check each point yourself.", "La bozza si salva in questo browser. Scrivi almeno tre parole, poi controlla ogni punto.")
          : !draft.completed
            ? t("Select this programme and finish earlier study days to save your response here.", "Scegli questo percorso e completa i giorni precedenti per salvare qui la tua risposta.")
            : t("Your completed response is saved for this study day.", "La risposta completata è salvata per questo giorno di studio.")}
      </p>
      <fieldset className="academy-checklist" disabled={!editable}>
        <legend>{t("I checked my own writing", "Ho controllato il mio testo")}</legend>
        {practice.rubric.map((criterion, criterionIndex) => (
          <label key={criterionIndex}>
            <input
              type="checkbox"
              checked={draft.rubric.includes(criterionIndex)}
              onChange={(event) => patch({
                rubric: event.target.checked
                  ? [...draft.rubric, criterionIndex]
                  : draft.rubric.filter((item) => item !== criterionIndex),
              })}
            />
            <span>{text(criterion)}</span>
          </label>
        ))}
      </fieldset>
      <button
        className="text-button"
        aria-expanded={modelOpen}
        onClick={() => {
          setModelOpen(!modelOpen);
          if (!modelOpen && editable) patch({ modelSeen: true });
        }}
      >
        {modelOpen ? t("Hide a possible response", "Nascondi una risposta possibile")
          : t("Show a possible response", "Mostra una risposta possibile")}
      </button>
      {modelOpen && (
        <div className="academy-model">
          <ItalianExample pair={practice.model} showEnglish={p.translations} />
          <p>{t("Compare the pattern, then use your own details.", "Confronta la struttura, poi usa i tuoi dettagli.")}</p>
        </div>
      )}
      <p role="status">
        {draft.completed
          ? t("✓ Saved as self-assessed. Writing is not automatically graded.", "✓ Salvato come autovalutazione. Il testo non riceve una valutazione automatica.")
          : t("You assess this response yourself. Writing is not automatically graded.", "Valuti tu questa risposta. Il testo non riceve una valutazione automatica.")}
      </p>
      <button
        className="button secondary"
        disabled={!editable || !ready}
        onClick={() => save((state) => completeProgrammePractice(state, programme, index, today))}
      >
        {draft.completed ? t("✓ Personal practice saved", "✓ Pratica personale salvata")
          : t("Save my self-assessed practice", "Salva la mia pratica autovalutata")}
      </button>
    </section>
  );
}

export function ProgrammeView({ p, t, text, save, go, today }: Shared) {
  const [viewedId, setViewedId] = useState(
    p.academy?.programme?.id ?? "supported-a1",
  );
  const [notice, setNotice] = useState("");
  const [viewedDay, setViewedDay] = useState<number | null>(null);
  const programme =
    programmes.find((item) => item.id === viewedId) ?? programmes[0];
  const active = p.academy?.programme;
  if (!programme) return null;
  const selected = active?.id === programme.id;
  const done = selected ? Object.keys(active.completed).length : 0;
  const currentDay = Math.min(viewedDay ?? (selected ? active.day : 0), programme.days.length - 1);
  const jumpToDay = (index: number) => {
    setViewedDay(index);
    requestAnimationFrame(() => document.getElementById("current-programme-day")?.focus());
  };
  return (
    <div className="workspace academy programme-workspace">
      <div className="academy-intro">
        <div>
          <p className="eyebrow">
            {t("A CLEAR STUDY ROUTE", "UN PERCORSO DI STUDIO CHIARO")}
          </p>
          <h1>
            {t("Your study programme.", "Il tuo percorso di studio.")}
          </h1>
          <p>
            {t(
              "One study day at a time. Repeat or split it whenever you need.",
              "Un giorno di studio alla volta. Ripetilo o dividilo quando serve.",
            )}
          </p>
        </div>
        <div className="academy-pace">
          <span>{t("Your daily time", "Il tuo tempo al giorno")}</span>
          <strong>
            {p.plan.minutes} <small>min</small>
          </strong>
          <button className="text-button" onClick={() => go("plan")}>
            {t("Adjust my time", "Modifica il tempo")} →
          </button>
        </div>
      </div>
      <section className="academy-programme-banner">
        <div>
          <p className="eyebrow">
            {selected ? t("MY PROGRAMME", "IL MIO PERCORSO") : programme.id === "supported-a1" ? t("RECOMMENDED FOR MID-A1", "CONSIGLIATO PER A1 INTERMEDIO") : t("PROGRAMME PREVIEW", "ANTEPRIMA DEL PERCORSO")}
          </p>
          <h2>{text(programme.title)}</h2>
          <p>{text(programme.summary)}</p>

        </div>
        <div>
          {selected ? (
            <>
              <Meter
                value={done}
                max={programme.days.length}
                label={t("Study days completed", "Giorni di studio completati")}
              />
              {active.day < programme.days.length && (
                <button
                  className="button primary"
                  onClick={() => go("today")}
                >
                  {t(
                    `Continue today · day ${active.day + 1}`,
                    `Continua oggi · giorno ${active.day + 1}`,
                  )}{" "}
                  →
                </button>
              )}
            </>
          ) : (
            <button
              className="button primary"
              onClick={() => {
                save((state) => selectProgramme(state, programme.id, today));
                setViewedDay(null);
                setNotice(
                  t(
                    "Programme selected. Continue today when you are ready.",
                    "Percorso selezionato. Continua oggi quando vuoi.",
                  ),
                );
              }}
            >
              {t("Make this my programme", "Scegli questo percorso")} →
            </button>
          )}

        </div>
      </section>
      <details className="programme-options">
        <summary>{t(`Compare the ${programmes.length} programmes`, `Confronta i ${programmes.length} percorsi`)}</summary>
        <p className="hint">{t("Changing programme starts a new day checklist. Completed lessons and grammar stay saved.", "Cambiare percorso avvia un nuovo elenco di giorni. Le lezioni e la grammatica completate restano salvate.")}</p>
      <div
        className="academy-programme-choices"
        aria-label={t("Available study programmes", "Percorsi disponibili")}
      >
        {[...programmes].sort((a, b) => Number(b.id === "supported-a1") - Number(a.id === "supported-a1")).map((item) => (
          <button
            key={item.id}
            aria-pressed={item.id === programme.id}
            onClick={() => {
              setViewedId(item.id);
              setNotice("");
              setViewedDay(null);
            }}
          >
            <span className="eyebrow">
              {item.days.length} {t("STUDY DAYS", "GIORNI DI STUDIO")}
            </span>
            <strong>{text(item.title)}</strong>
            {item.id === "supported-a1" && <b>{t("Recommended for mid-A1", "Consigliato per A1 intermedio")}</b>}
            <span>{text(item.summary)}</span>
            {active?.id === item.id && (
              <b>{t("✓ My current programme", "✓ Il mio percorso attuale")}</b>
            )}
          </button>
        ))}
      </div>
      </details>
      <p role="status">{notice}</p>
      <h2 id="current-programme-day" tabIndex={-1}>
        {t(`Study day ${currentDay + 1} of ${programme.days.length}`, `Giorno di studio ${currentDay + 1} di ${programme.days.length}`)}
      </h2>
      <ol className="academy-programme-days">
        {[programme.days[currentDay]].map((day) => {
          const index = currentDay;
          const dayUnits = day.unitIds
            .map(unitById)
            .filter((item): item is GrammarUnit => Boolean(item));
          const finished = selected && Boolean(active.completed[String(index)]);
          const allUnits = dayUnits.every(
            (unit) => grammarScore(p, unit).completed,
          );
          const allMissions = day.missionIds.every((id) =>
            Boolean(p.completed[id]),
          );
          const ready = programmeDayReady(p, programme, index);
          return (
            <li
              key={`${programme.id}:${index}`}
              id={`programme-day-${programme.id}-${index}`}
              className={finished ? "completed" : ""}
            >
              <div className="academy-day-number">
                <span>{t("DAY", "GIORNO")}</span>
                <b>{String(index + 1).padStart(2, "0")}</b>
              </div>
              <div className="academy-day-content">
                <div className="academy-card-top">
                  <h3 tabIndex={-1}>
                    {text(day.title).replace(/^\d+\s*[·.:-]\s*/, "")}
                  </h3>
                  {finished && (
                    <span className="academy-status">
                      {t("✓ Completed", "✓ Completato")}
                    </span>
                  )}
                </div>
                <p>{text(day.outcome)}</p>
                <div className="academy-day-tasks">
                  {dayUnits.map((unit) => (
                    <button
                      key={unit.id}
                      onClick={() => go(`grammar/${unit.id}`)}
                    >
                      <span aria-hidden="true">
                        {grammarScore(p, unit).completed ? "✓" : "○"}
                      </span>
                      {text(unit.title)} <span aria-hidden="true">→</span>
                    </button>
                  ))}
                  {day.missionIds.map((id, missionIndex) => (
                    <button key={id} onClick={() => go(`lesson/${id}`)}>
                      <span aria-hidden="true">
                        {p.completed[id] ? "✓" : "○"}
                      </span>
                      {t("Daily application", "Applicazione quotidiana")}{" "}
                      {day.missionIds.length > 1 ? missionIndex + 1 : ""}{" "}
                      <span aria-hidden="true">→</span>
                    </button>
                  ))}
                </div>
                {day.practice && (
                  <ProgrammePractice
                    key={`${programme.id}:${index}`}
                    {...{ p, t, text, save, go, today, programme, index }}
                  />
                )}
                <div className="academy-day-action">
                  <button
                    className="button secondary"
                    disabled={
                      !selected ||
                      active?.day !== index ||
                      !ready ||
                      Boolean(finished)
                    }
                    onClick={() => {
                      save((state) =>
                        completeProgrammeDay(state, programme, index, today),
                      );
                      setViewedDay(null);
                      setNotice(
                        t(
                          `Day ${index + 1} saved as complete.`,
                          `Giorno ${index + 1} salvato come completato.`,
                        ),
                      );
                    }}
                  >
                    {finished
                      ? t("✓ Day completed", "✓ Giorno completato")
                      : t(
                          "Mark this day complete",
                          "Segna il giorno come completato",
                        )}
                  </button>
                  <small>
                    {!selected
                      ? t(
                          "Select this programme to save day progress.",
                          "Scegli questo percorso per salvare i giorni.",
                        )
                      : selected && active.day < index
                        ? t(
                            "Finish the earlier study days first.",
                            "Completa prima i giorni precedenti.",
                          )
                        : !allUnits || !allMissions
                          ? t(
                              "Complete the linked grammar units and daily applications first.",
                              "Completa prima le unità di grammatica e le applicazioni collegate.",
                            )
                          : !ready
                            ? t(
                                "Complete this day's personal practice and self-check first.",
                                "Completa prima la pratica personale e l'autovalutazione di questo giorno.",
                              )
                          : finished
                            ? t(
                                "Return to any activity whenever you like.",
                                "Torna a ogni attività quando vuoi.",
                              )
                            : t(
                                "All linked work is complete.",
                                "Tutto il lavoro collegato è completato.",
                              )}
                  </small>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <details className="programme-options">
        <summary>{t(`See all ${programme.days.length} study days`, `Vedi tutti i ${programme.days.length} giorni`)}</summary>
        <ol className="programme-syllabus">
          {programme.days.map((day, index) => (
            <li key={index}>
              <button className="text-button" onClick={() => jumpToDay(index)}>
                {selected && active.completed[String(index)] ? "✓ " : ""}{text(day.title)} →
              </button>
            </li>
          ))}
        </ol>
      </details>
      <button className="text-button" onClick={() => go("readiness")}>
        {t("Optional: check my A1 foundations", "Facoltativo: verifica le mie basi A1")} →
      </button>
      <p className="hint">
        {t(
          "This diagnostic covers A1 foundations. A2 topics are practised in their own lessons.",
          "Questa verifica riguarda le basi A1. Gli argomenti A2 si esercitano nelle rispettive lezioni.",
        )}
      </p>
    </div>
  );
}

export function CompanionView(props: Shared & { pageId?: string }) {
  const { p, t, text, save, go, today, pageId, pdfs, pdfPageOffsets = {} } = props;
  const routePage = pages.find((page) => page.id === pageId);
  const [sourceId, setSourceId] = useState(
    routePage?.sourceId ?? sources[0]?.id ?? "",
  );
  const [selectedPageId, setSelectedPageId] = useState(
    routePage?.id ?? pages.find((page) => page.sourceId === sourceId)?.id ?? "",
  );
  const [query, setQuery] = useState(() => (catalogueParams().get("q") ?? "").slice(0, 200));
  const [notice, setNotice] = useState("");
  const catalogueHeading = useRef<HTMLHeadingElement>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const page = routePage ?? pages.find((item) => item.id === selectedPageId);
  useEffect(() => focusStudyHeading(pageId ? pageHeading.current : catalogueHeading.current), [pageId, page?.id]);
  const selectedSource = sources.find(
    (source) => source.id === (page?.sourceId ?? sourceId),
  );
  const sourcePages = pages.filter(
    (item) => item.sourceId === (page?.sourceId ?? sourceId),
  );
  const needle = query.trim().toLocaleLowerCase();
  const shown = sourcePages.filter(
    (item) =>
      !needle ||
      `${item.page} ${item.focus.en} ${item.focus.it}`
        .toLocaleLowerCase()
        .includes(needle),
  );
  const sourceChange = (id: string) => {
    setSourceId(id);
    setQuery("");
    const first = pages.find((item) => item.sourceId === id);
    if (first) {
      setSelectedPageId(first.id);
      go(catalogueRoute(`companion/${first.id}`, {}));
    }
    setNotice("");
  };
  const choosePage = (id: string) => {
    setSelectedPageId(id);
    setNotice("");
    go(catalogueRoute(`companion/${id}`, { q: query }));
  };
  const draft = page ? getCompanionDraft(p, page.id) : null;
  const index = page ? sourcePages.indexOf(page) : -1;
  const completeCount = sourcePages.filter(
    (item) =>
      item.kind === "practice" && p.academy?.companion[item.id]?.completed,
  ).length;
  return (
    <div className="workspace academy">
      <div className="academy-intro">
        <div>
          <p className="eyebrow">
            {t(
              "CLASS MATERIAL → PERSONAL PRACTICE",
              "MATERIALE DEL CORSO → PRATICA PERSONALE",
            )}
          </p>
          <h1 ref={catalogueHeading} tabIndex={-1} className="study-focus-heading">
            {t("A companion for every page.", "Un compagno per ogni pagina.")}
          </h1>
          <p>
            {t(
              "Keep your own class file beside you. Pick its page or slide, try a new task, then compare your response with a model. The exercises use new examples and help you apply what the page teaches.",
              "Tieni accanto il tuo file del corso. Scegli la pagina o diapositiva, prova un nuovo esercizio, poi confronta la risposta con un modello. Gli esercizi usano esempi nuovi e aiutano ad applicare ciò che la pagina insegna.",
            )}
          </p>
        </div>
        <div className="academy-pace">
          <strong>{pages.length}</strong>
          <span>{t("page companions", "schede per le pagine")}</span>
        </div>
      </div>
      <div className="academy-companion-controls">
        <label className="field">
          {t("My source file", "Il mio file del corso")}
          <select
            value={selectedSource?.id ?? sourceId}
            onChange={(event) => sourceChange(event.target.value)}
          >
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t(
            "Find a page or topic in this file",
            "Cerca una pagina o un argomento nel file",
          )}
          <input
            type="search"
            value={query}
            maxLength={200}
            onChange={(event) => {
              setQuery(event.target.value);
              replaceCatalogueParams({ q: event.target.value });
            }}
            placeholder={t(
              "Page number or topic…",
              "Numero di pagina o argomento…",
            )}
          />
        </label>
      </div>
      {selectedSource && (
        <div className="academy-source-meta">
          <span>
            {selectedSource.pages}{" "}
            {t("source pages / slides", "pagine / diapositive nella fonte")}
          </span>
          <span>
            {completeCount}/
            {sourcePages.filter((item) => item.kind === "practice").length}{" "}
            {t("practice pages completed", "pagine di pratica completate")}
          </span>
        </div>
      )}
      <div className="academy-companion-layout">
        <aside className="academy-page-browser">
          <h2>{t("Choose a page", "Scegli una pagina")}</h2>
          <div className="academy-page-list">
            {shown.map((item) => (
              <button
                key={item.id}
                aria-current={item.id === page?.id ? "page" : undefined}
                onClick={() => choosePage(item.id)}
              >
                <b>{item.page}</b>
                <span>
                  {text(item.focus)}
                  <small>
                    {p.academy?.companion[item.id]?.completed
                      ? t("✓ Completed", "✓ Completata")
                      : item.kind === "needs-review"
                        ? t(
                            "Source check pending",
                            "Verifica della fonte in attesa",
                          )
                        : item.kind === "reference"
                          ? t(
                              "Reference & reflection",
                              "Riferimento e riflessione",
                            )
                          : t("Original practice", "Pratica originale")}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {!shown.length && (
            <p role="status">
              {t(
                "No pages match your search.",
                "Nessuna pagina corrisponde alla ricerca.",
              )}
            </p>
          )}
        </aside>
        {page && draft ? (
          <section
            className="academy-sheet academy-companion-sheet"
            key={page.id}
          >
            <div className="academy-card-top">
              <p className="eyebrow">
                {t("PAGE / SLIDE", "PAGINA / DIAPOSITIVA")} {page.page}
              </p>
              <span className="tag">
                {page.kind === "reference"
                  ? t("Reference", "Riferimento")
                  : page.kind === "needs-review"
                    ? t("To verify", "Da verificare")
                    : t("Original practice", "Pratica originale")}
              </span>
            </div>
            <h2 ref={pageHeading} tabIndex={-1} className="study-focus-heading">{text(page.focus)}</h2>
            {pdfs?.[page.sourceId] && (
              <a className="text-button" href={localPdfPageHref(pdfs[page.sourceId], page.page, pdfPageOffsets[page.sourceId])} target="_blank" rel="noreferrer">
                {t("Open connected PDF at this page", "Apri il PDF collegato a questa pagina")} ↗
              </a>
            )}
            <p className="academy-task">{text(page.task)}</p>
            {page.kind === "needs-review" ? (
              <div className="academy-hint">
                <strong>
                  {t(
                    "This source page still needs a closer check.",
                    "Questa pagina richiede ancora una verifica.",
                  )}
                </strong>
                <p>
                  {t(
                    "Use the verified grammar lessons below while this page is reviewed. This page does not award completion credit.",
                    "Usa le lezioni di grammatica verificate qui sotto mentre la pagina viene controllata. Questa pagina non assegna il completamento.",
                  )}
                </p>
              </div>
            ) : page.kind === "reference" ? (
              <div className="academy-reference-note">
                <p className="academy-guidance">
                  {t(
                    "This is a reference or planning page. Use the guidance, then continue to a practice page. It does not count as a completed exercise.",
                    "Questa è una pagina di riferimento o pianificazione. Usa le indicazioni, poi passa a una pagina di pratica. Non conta come esercizio completato.",
                  )}
                </p>
                <ItalianExample
                  pair={page.model}
                  showEnglish={p.translations}
                />
                <label className="field">
                  {t("Optional note to myself", "Nota personale facoltativa")}
                  <textarea
                    rows={3}
                    maxLength={2000}
                    aria-label={t(
                      "Optional note to myself",
                      "Nota personale facoltativa",
                    )}
                    value={draft.answer}
                    onChange={(event) =>
                      save((state) =>
                        updateCompanionDraft(state, page.id, {
                          answer: event.target.value,
                        }),
                      )
                    }
                  />
                </label>
                <p className="academy-save-note">
                  {t(
                    "Your note saves as you type.",
                    "La nota si salva mentre scrivi.",
                  )}
                </p>
              </div>
            ) : (
              <>
                <label className="field">
                  {t("My own response", "La mia risposta")}
                  <textarea
                    rows={6}
                    lang="it"
                    maxLength={2000}
                    aria-label={t("My own response", "La mia risposta")}
                    value={draft.answer}
                    onChange={(event) => {
                      save((state) =>
                        updateCompanionDraft(state, page.id, {
                          answer: event.target.value,
                          selfChecked: false,
                        }),
                      );
                      setNotice("");
                    }}
                    placeholder={t(
                      "Try at least three words before opening the model.",
                      "Prova almeno tre parole prima di aprire il modello.",
                    )}
                  />
                </label>
                <p className="academy-save-note">
                  {t(
                    "Saved in this browser. This is original self-assessed practice.",
                    "Salvato in questo browser. Questa è pratica originale con autovalutazione.",
                  )}
                </p>
                <button
                  className="text-button"
                  aria-expanded={draft.modelSeen}
                  onClick={() =>
                    save((state) =>
                      updateCompanionDraft(state, page.id, {
                        modelSeen: !draft.modelSeen,
                      }),
                    )
                  }
                >
                  {draft.modelSeen
                    ? t("Hide the model", "Nascondi il modello")
                    : t(
                        "Compare with a model",
                        "Confronta con un modello",
                      )}{" "}
                  {draft.modelSeen ? "−" : "+"}
                </button>
                {draft.modelSeen && (
                  <div className="academy-model">
                    <ItalianExample
                      pair={page.model}
                      showEnglish={p.translations}
                    />
                    <p>
                      {t(
                        "A model is one possible response. Personal details and other correct sentences may differ.",
                        "Il modello è una risposta possibile. I dettagli personali e altre frasi corrette possono essere diversi.",
                      )}
                    </p>
                  </div>
                )}
                <div className="academy-companion-checks">
                  <h3>{t("Before you call it done", "Prima di terminare")}</h3>
                  <ul>
                    {page.checks.map((check, checkIndex) => (
                      <li key={checkIndex}>{text(check)}</li>
                    ))}
                  </ul>
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.selfChecked}
                      onChange={(event) =>
                        save((state) =>
                          updateCompanionDraft(state, page.id, {
                            selfChecked: event.target.checked,
                          }),
                        )
                      }
                    />
                    <span>
                      {t(
                        "I read each checkpoint and checked my response.",
                        "Ho letto ogni punto e controllato la mia risposta.",
                      )}
                    </span>
                  </label>
                </div>
                <div className="button-row">
                  <button
                    className="button primary"
                    disabled={
                      draft.answer.trim().split(/\s+/).filter(Boolean).length <
                        3 || !draft.selfChecked
                    }
                    onClick={() => {
                      save((state) => completeCompanion(state, page.id, today));
                      setNotice(
                        t(
                          "Your page practice and self-check are saved.",
                          "La pratica della pagina e l’autovalutazione sono salvate.",
                        ),
                      );
                    }}
                  >
                    {draft.completed
                      ? t(
                          "✓ Save updated practice",
                          "✓ Salva la pratica aggiornata",
                        )
                      : t(
                          "Save completed page practice",
                          "Salva la pratica completata",
                        )}{" "}
                    ✓
                  </button>
                </div>
                <p role="status">{notice}</p>
                {draft.completed && (
                  <p className="academy-save-note">
                    {t("Completed on", "Completata il")} {draft.completed} ·{" "}
                    {t("self-assessed", "autovalutazione")}
                  </p>
                )}
              </>
            )}
            {page.unitIds.length > 0 && (
              <section className="academy-related">
                <h3>
                  {t(
                    "Practise the grammar in more depth",
                    "Approfondisci la grammatica",
                  )}
                </h3>
                <div className="academy-related-links">
                  {page.unitIds.map((id) => {
                    const unit = unitById(id);
                    return unit ? (
                      <button
                        className="button secondary"
                        key={id}
                        onClick={() => go(`grammar/${id}`)}
                      >
                        {text(unit.title)} →
                      </button>
                    ) : null;
                  })}
                </div>
              </section>
            )}
            <nav
              className="academy-exercise-nav"
              aria-label={t(
                "Browse source pages",
                "Sfoglia le pagine della fonte",
              )}
            >
              <button
                className="button secondary"
                disabled={index <= 0}
                onClick={() => choosePage(sourcePages[index - 1].id)}
              >
                ← {t("Previous page", "Pagina precedente")}
              </button>
              <button
                className="button secondary"
                disabled={index === sourcePages.length - 1}
                onClick={() => choosePage(sourcePages[index + 1].id)}
              >
                {t("Next page", "Pagina successiva")} →
              </button>
            </nav>
          </section>
        ) : (
          <div className="academy-empty">
            <p>
              {t(
                "Choose a source and page to begin.",
                "Scegli una fonte e una pagina per iniziare.",
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
