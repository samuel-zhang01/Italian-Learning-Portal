import { useState } from "react";
import grammar from "./grammar.json";
import enrichment from "./enrichment.json";
import companion from "./companion.json";
import {
  answerAssessment,
  assessmentItems,
  assessmentKey,
  reviewWord,
  saveWord,
  startAssessment,
  wordKey,
} from "./academy-engine";
import { exercisePrompt, modelAnswerMismatch } from "./learning-utils";
import { dailyStudyPlan } from "./study";
import curriculum from "./curriculum.json";
import { dailyMinutes } from "./engine";
import type {
  GrammarUnit,
  Mission,
  PageCompanion,
  Pair,
  Programme,
  Progress,
  VocabularyBank,
} from "./types";
import "./practice-tools.css";

type Props = {
  p: Progress;
  t: (en: string, it: string) => string;
  text: (pair: Pair) => string;
  save: (fn: (p: Progress) => Progress) => void;
  go: (route: string) => void;
  today: string;
};
const units = grammar.units as GrammarUnit[];
const programmes = grammar.programmes as Programme[];
const banks = enrichment.banks as VocabularyBank[];

export function DailyItinerary({ p, t, text, go, today }: Props) {
  const plan = dailyStudyPlan(p, curriculum.missions as Mission[], units, programmes,
    companion.pages as PageCompanion[], today);
  return (
    <section className="study-itinerary">
      <p className="hint">
        {t("Follow the blocks in order. Pause whenever you need; unfinished work stays saved.",
          "Segui le attività in ordine. Fermati quando serve; il lavoro incompleto resta salvato.")}
      </p>
      <ol className="itinerary-blocks">
        {plan.blocks.map((block, index) => (
          <li key={block.route}>
            <span className="itinerary-number">{block.completed ? "✓" : index + 1}</span>
            <div>
              <strong>{text(block.title)} · {block.minutes} min</strong>
              <p>{text(block.detail)}</p>
              <button className="text-button" onClick={() => go(block.route)}>
                {block.completed ? t("Revisit", "Rivedi") : t("Open this block", "Apri questa attività")} →
              </button>
            </div>
          </li>
        ))}
      </ol>
      <p className="hint">
        {Math.max(0, p.plan.minutes - dailyMinutes(p, today))}{" "}
        {t("estimated minutes remaining. Times are a guide, not a stopwatch.",
          "minuti stimati rimasti. I tempi sono indicativi, non un cronometro.")}
      </p>
      {plan.programme && (
        <button className="text-button" onClick={() => go("programmes")}>
          {t("See my programme day", "Vedi il giorno del percorso")} →
        </button>
      )}
    </section>
  );
}

export function AssessmentView({
  p,
  t,
  text,
  save,
  go,
  today,
  mode = "readiness",
}: Props & { mode?: "readiness" | "tense" }) {
  const [answer, setAnswer] = useState("");
  const [showResult, setShowResult] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const todayKey = `${today}:${mode}`;
  const key = selectedKey ?? assessmentKey(p, today, mode);
  const run = p.academy?.assessments[key];
  const history = Object.entries(p.academy?.assessments ?? {})
    .filter(([savedKey]) => savedKey.endsWith(`:${mode}`) && savedKey !== key)
    .sort(([a], [b]) => b.localeCompare(a));
  const openCheck = (savedKey: string) => {
    setSelectedKey(savedKey);
    setAnswer("");
    setShowResult(null);
  };
  const sampled = assessmentItems(units, today, mode);
  const all = units.flatMap((unit) =>
    unit.exercises.map((exercise) => ({ unit, exercise })),
  );
  const items = run
    ? run.exerciseIds
        .map((id) => all.find((x) => x.exercise.id === id)!)
        .filter(Boolean)
    : sampled;
  const current = items.find((x) => !run?.answers[x.exercise.id]);
  const previous = items.find((x) => x.exercise.id === showResult);
  const score = Object.values(run?.answers ?? {}).filter(
    (x) => x.correct,
  ).length;
  const answered = Object.keys(run?.answers ?? {}).length;
  const validItems =
    items.length > 0 && (!run || items.length === run.exerciseIds.length);
  const weak = items.filter(
    (x) => run?.answers[x.exercise.id] && !run.answers[x.exercise.id].correct,
  );
  return (
    <div className="workspace assessment-view">
      <p className="eyebrow">
        {t(
          "A SNAPSHOT TO GUIDE PRACTICE",
          "UN’ISTANTANEA PER GUIDARE LA PRATICA",
        )}
      </p>
      <h1>
        {mode === "tense"
          ? t("Present or past?", "Presente o passato?")
          : t("Your bridge towards A2.", "Il tuo ponte verso A2.")}
      </h1>
      <p>
        {mode === "tense"
          ? t(
              "Use the time cue, choose the tense, then build the verb. Read each instruction: some answers need a whole sentence.",
              "Usa l’indicazione di tempo, scegli il tempo verbale e costruisci il verbo. Leggi ogni consegna: alcune risposte richiedono una frase intera.",
            )
          : t(
              "Try twelve short grammar questions across A1 topics. Your first answer is saved, then you get an explanation and a route to practise. This check covers grammar; it does not certify a CEFR level.",
              "Prova dodici brevi domande di grammatica sui temi A1. La prima risposta viene salvata; poi ricevi una spiegazione e un percorso di pratica. Il controllo riguarda la grammatica; non certifica un livello QCER.",
            )}
      </p>
      <p className="hint">
        {t(
          "You can pause and return another day: your check and submitted answers stay saved. One new check of each kind is available per day.",
          "Puoi fermarti e tornare un altro giorno: il controllo e le risposte inviate restano salvati. Ogni giorno è disponibile un nuovo controllo di ogni tipo.",
        )}
      </p>
      {run && key !== todayKey && (
        <p className="hint">
          {run.completed
            ? t("Saved check from", "Controllo salvato del")
            : t(
                "Continue your saved check from",
                "Continua il controllo salvato del",
              )}{" "}
          {run.date}.{" "}
          <button
            className="text-button"
            onClick={() => {
              save((s) => startAssessment(s, units, today, mode));
              openCheck(todayKey);
            }}
          >
            {p.academy?.assessments[todayKey]
              ? t("Open today’s check", "Apri il controllo di oggi")
              : t(
                  "Start a new check for today",
                  "Inizia un nuovo controllo per oggi",
                )}
          </button>
        </p>
      )}
      {!run ? (
        <section className="panel">
          <h2>
            {items.length}{" "}
            {t(
              "questions · about 10–15 minutes",
              "domande · circa 10–15 minuti",
            )}
          </h2>
          <p>
            {t(
              "Try without notes. Mistakes are useful: use the linked lessons afterwards. You can practise in the grammar lab first if you prefer.",
              "Prova senza appunti. Gli errori sono utili: dopo usa le lezioni collegate. Se preferisci, prima esercitati nel laboratorio di grammatica.",
            )}
          </p>
          <button
            className="button primary"
            onClick={() => {
              save((s) => startAssessment(s, units, today, mode));
              openCheck(todayKey);
            }}
          >
            {t("Start my check", "Inizia il controllo")}
          </button>
        </section>
      ) : !validItems ? (
        <section className="panel">
          <p>
            {t(
              "This saved check has no complete question set, so it cannot show a result. Keep your backup and use the grammar lab for practice.",
              "Questo controllo salvato non ha un gruppo completo di domande e non può mostrare un risultato. Conserva il backup ed esercitati nel laboratorio di grammatica.",
            )}
          </p>
          <button className="button secondary" onClick={() => go("grammar")}>
            {t("Open grammar lab", "Apri il laboratorio di grammatica")}
          </button>
        </section>
      ) : (
        <>
          <progress
            max={items.length}
            value={answered}
            aria-label={t("Questions answered", "Domande risposte")}
          />
          <p>
            {answered}/{items.length} {t("answered", "risposte")}
          </p>
          {previous && (
            <section
              className={`panel feedback ${run.answers[previous.exercise.id].correct ? "correct" : "incorrect"}`}
              role="status"
            >
              <h2>
                {run.answers[previous.exercise.id].correct
                  ? t("That fits.", "Va bene.")
                  : ["correct", "reorder"].includes(previous.exercise.kind)
                    ? text(modelAnswerMismatch)
                    : t(
                        "A useful clue for your next practice.",
                        "Un indizio utile per la prossima pratica.",
                      )}
              </h2>
              <p>{text(previous.exercise.explanation)}</p>
              <p lang="it">
                <strong>{previous.exercise.answers[0]}</strong>
              </p>
              <button
                className="button secondary"
                onClick={() => {
                  setShowResult(null);
                  setAnswer("");
                }}
              >
                {run.completed
                  ? t("See my results", "Vedi i risultati")
                  : t("Next question", "Prossima domanda")}
              </button>
            </section>
          )}
          {!showResult && current && (
            <form
              className="panel"
              onSubmit={(e) => {
                e.preventDefault();
                if (!answer.trim()) return;
                setSelectedKey(key);
                save((s) =>
                  answerAssessment(s, key, current.exercise, answer, today),
                );
                setShowResult(current.exercise.id);
              }}
            >
              <p className="eyebrow">
                {t("QUESTION", "DOMANDA")} {answered + 1} ·{" "}
                {text(current.unit.title)}
              </p>
              <h2>{text(exercisePrompt(current.exercise))}</h2>
              {current.exercise.options && (
                <div className="bank-choices">
                  {current.exercise.options.map((option) => (
                    <button
                      type="button"
                      key={option}
                      className="button secondary"
                      aria-pressed={answer === option}
                      onClick={() => setAnswer(option)}
                      lang="it"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
              {current.exercise.tokens && (
                <p lang="it">{current.exercise.tokens.join(" / ")}</p>
              )}
              <label className="field">
                {t("My Italian answer", "La mia risposta in italiano")}
                <input
                  aria-label={t(
                    "My Italian answer",
                    "La mia risposta in italiano",
                  )}
                  value={answer}
                  maxLength={500}
                  onChange={(e) => setAnswer(e.target.value)}
                  lang="it"
                  autoComplete="off"
                />
              </label>
              <button className="button primary" disabled={!answer.trim()}>
                {t("Save my first answer", "Salva la prima risposta")}
              </button>
            </form>
          )}
          {run.completed && !showResult && (
            <section className="panel">
              <p className="eyebrow">
                {t("YOUR NEXT STEPS", "I TUOI PROSSIMI PASSI")}
              </p>
              <h2>
                {score}/{items.length}{" "}
                {t("first answers correct", "prime risposte corrette")}
              </h2>
              <p>
                {score >= Math.ceil(items.length * 0.8)
                  ? t(
                      "A promising grammar snapshot. Repeat on another day, then try the speaking and listening tasks below before choosing your next course.",
                      "Un buon segnale sulla grammatica. Ripeti un altro giorno, poi prova le attività di ascolto e conversazione qui sotto prima di scegliere il prossimo corso.",
                    )
                  : t(
                      "Choose one or two topics below. Work through the examples, practise with hints, then return for a fresh check another day.",
                      "Scegli uno o due temi sotto. Studia gli esempi, esercitati con gli aiuti e torna un altro giorno per un nuovo controllo.",
                    )}
              </p>
              {weak.length > 0 && (
                <ul>
                  {weak.map(({ unit, exercise }) => (
                    <li key={exercise.id}>
                      <button
                        className="text-button"
                        onClick={() => go(`grammar/${unit.id}`)}
                      >
                        {text(unit.title)} →
                      </button>
                      <p>{text(exercise.explanation)}</p>
                    </li>
                  ))}
                </ul>
              )}
              <details>
                <summary>
                  {t("Review every answer", "Rivedi tutte le risposte")}
                </summary>
                {items.map(({ unit, exercise }) => (
                  <article key={exercise.id}>
                    <h3>{text(unit.title)}</h3>
                    <p>{text(exercisePrompt(exercise))}</p>
                    <p lang="it">
                      {t("You wrote", "Hai scritto")}:{" "}
                      {run.answers[exercise.id].answer}
                    </p>
                    <p lang="it">
                      {t("Example answer", "Risposta di esempio")}:{" "}
                      {exercise.answers[0]}
                    </p>
                    <p>{text(exercise.explanation)}</p>
                  </article>
                ))}
              </details>
            </section>
          )}
        </>
      )}
      {history.length > 0 && (
        <details>
          <summary>
            {t("Previous checks", "Controlli precedenti")} ({history.length})
          </summary>
          <label className="field">
            {t("Open a saved check", "Apri un controllo salvato")}
            <select
              value=""
              onChange={(event) => openCheck(event.target.value)}
            >
              <option value="" disabled>
                {t("Choose a check", "Scegli un controllo")}
              </option>
              {history.map(([savedKey, saved]) => (
                <option key={savedKey} value={savedKey}>
                  {saved.date} · {saved.completed
                    ? t("Complete", "Completato")
                    : t("Continue", "Continua")} ·{" "}
                  {Object.keys(saved.answers).length}/{saved.exerciseIds.length}
                </option>
              ))}
            </select>
          </label>
        </details>
      )}
      <section className="support-box">
        <h2>
          {t("Check more than grammar", "Controlla anche le altre abilità")}
        </h2>
        <ol>
          <li>
            {t(
              "Speak for 45 seconds: your name, home, routine and one thing you did yesterday. Use your own details. Ask a lecturer or partner which parts were clear.",
              "Parla per 45 secondi: nome, casa, routine e una cosa fatta ieri. Usa dettagli personali. Chiedi a un docente o compagno quali parti erano chiare.",
            )}
          </li>
          <li>
            {t(
              "Listen to a short beginner clip twice. Identify the situation and two details, then check the transcript. Use subtitles when needed.",
              "Ascolta due volte un breve video per principianti. Individua la situazione e due dettagli, poi controlla la trascrizione. Usa i sottotitoli se servono.",
            )}
          </li>
          <li>
            {t(
              "Write a four-line message arranging coffee: greeting, day, time and place. Check verb forms and articles against your lessons.",
              "Scrivi un messaggio di quattro righe per prendere un caffè: saluto, giorno, ora e luogo. Controlla verbi e articoli con le lezioni.",
            )}
          </li>
        </ol>
        <div className="button-row">
          <button className="button secondary" onClick={() => go("session")}>
            {t(
              "Guided speaking and listening",
              "Conversazione e ascolto guidati",
            )}
          </button>
          <button className="button secondary" onClick={() => go("materials")}>
            {t("Find a beginner clip", "Trova un video per principianti")}
          </button>
        </div>
        <p className="hint">
          {t(
            "These are self-checks. Discuss A2 placement with your teacher; grammatical accuracy is only part of language ability.",
            "Sono autoverifiche. Parla dell’inserimento in A2 con il docente; la correttezza grammaticale è solo una parte della competenza linguistica.",
          )}{" "}
          <a
            href="https://www.coe.int/en/web/common-european-framework-reference-languages/table-1-cefr-3.3-common-reference-levels-global-scale"
            target="_blank"
            rel="noreferrer"
          >
            {t("CEFR level descriptions", "Descrizioni dei livelli QCER")} ↗
          </a>
        </p>
      </section>
    </div>
  );
}

const catalogue = Array.from(
  new Map(
    [
      ...units.flatMap((u) =>
        u.words.map((term) => ({ term, example: undefined })),
      ),
      ...banks.flatMap((b) => b.words),
    ].map((w) => [wordKey(w.term), w]),
  ).values(),
);
export function PersonalWords({ p, t, save, today, go }: Props) {
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(24);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const saved = Object.entries(p.academy?.words ?? {}).filter(
    ([, w]) => w.starred,
  );
  const due = saved
    .filter(([, w]) => (!w.due || w.due <= today) && w.lastDate !== today)
    .sort(([, a], [, b]) => a.due.localeCompare(b.due));
  const card = due[0];
  const shown = catalogue.filter((w) =>
    `${w.term.it} ${w.term.en}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div className="workspace">
      <p className="eyebrow">
        {t("A PERSONAL POCKET DICTIONARY", "UN DIZIONARIO TASCABILE PERSONALE")}
      </p>
      <h1>{t("Words that stay with you.", "Parole che restano con te.")}</h1>
      <p>
        {t(
          "Save a few words or useful phrases. Recall the Italian before revealing it, then rate your memory. New words return tomorrow; successful recalls gradually space out to three and seven days. “Again” brings a word back tomorrow.",
          "Salva poche parole o espressioni utili. Ricorda l’italiano prima di scoprirlo, poi valuta la memoria. Le parole nuove tornano domani; i ricordi riusciti si distanziano fino a tre e sette giorni. «Ancora» riporta una parola domani.",
        )}
      </p>
      <p>
        {saved.length} {t("saved", "salvate")} · {due.length}{" "}
        {t("ready to review", "da ripassare")}
      </p>
      <section
        className="panel word-review"
        aria-label={t("My word review", "Il mio ripasso lessicale")}
      >
        {card ? (
          <>
            <h2 lang="en">{card[1].term.en}</h2>
            <p>
              {t(
                "Say it aloud or write it on paper. Then reveal and compare.",
                "Dillo ad alta voce o scrivilo su carta. Poi scopri e confronta.",
              )}
            </p>
            {revealed !== card[0] ? (
              <button
                className="button primary"
                onClick={() => setRevealed(card[0])}
              >
                {t("Reveal my word", "Scopri la parola")}
              </button>
            ) : (
              <>
                <h3 lang="it">{card[1].term.it}</h3>
                {card[1].example && <p lang="it">{card[1].example.it}</p>}
                <div className="button-row">
                  {[true, false].map((remembered) => (
                    <button
                      className="button secondary"
                      key={String(remembered)}
                      onClick={() => {
                        save((s) => reviewWord(s, card[0], remembered, today));
                        setRevealed(null);
                        setMessage(
                          t(
                            "Memory rating saved. Your next review date is in your word list.",
                            "Valutazione salvata. La prossima data è nell’elenco delle parole.",
                          ),
                        );
                      }}
                    >
                      {remembered
                        ? t("Remembered", "Ricordata")
                        : t("Again tomorrow", "Ancora domani")}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <h2>
              {saved.length
                ? t("Today's words are done.", "Le parole di oggi sono fatte.")
                : t(
                    "Start with three useful words.",
                    "Inizia con tre parole utili.",
                  )}
            </h2>
            <p>
              {saved.length
                ? t(
                    "Use one in a new sentence. You can browse your saved list at any time.",
                    "Usane una in una frase nuova. Puoi sfogliare l’elenco in qualsiasi momento.",
                  )
                : t(
                    "Search below and choose Save. Learn a noun together with its article.",
                    "Cerca sotto e scegli Salva. Impara un nome insieme al suo articolo.",
                  )}
            </p>
          </>
        )}
        <p role="status">{message}</p>
        <p className="hint">
          {t(
            "Memory ratings are self-reported. They do not give an accuracy grade or repeat points.",
            "Le valutazioni della memoria sono personali. Non danno un voto di correttezza né punti ripetuti.",
          )}
        </p>
      </section>
      {saved.length > 0 && (
        <details>
          <summary>
            {t(
              "My saved words and review dates",
              "Le mie parole e le date di ripasso",
            )}{" "}
            ({saved.length})
          </summary>
          <div className="vocabulary-grid">
            {saved.map(([key, w]) => (
              <article className="panel" key={key}>
                <h3 lang="it">{w.term.it}</h3>
                <p lang="en">{w.term.en}</p>
                <p>
                  {t("Next review", "Prossimo ripasso")}:{" "}
                  {w.due || t("today", "oggi")}
                </p>
                <button
                  className="text-button"
                  onClick={() => save((s) => saveWord(s, w.term, w.example))}
                >
                  {t("Remove from my list", "Rimuovi dall’elenco")}
                </button>
              </article>
            ))}
          </div>
        </details>
      )}
      <h2>
        {t("Choose from the course vocabulary", "Scegli dal lessico del corso")}
      </h2>
      <label className="field">
        {t("Find a word or phrase", "Trova una parola o frase")}
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setVisible(24);
          }}
        />
      </label>
      <p className="hint">
        {Math.min(visible, shown.length)}/{shown.length}{" "}
        {t(
          "words shown. Search to narrow the list.",
          "parole mostrate. Cerca per restringere l’elenco.",
        )}
      </p>
      <div className="vocabulary-grid">
        {shown.slice(0, visible).map((w) => (
          <article className="panel" key={wordKey(w.term)}>
            <h3 lang="it">{w.term.it}</h3>
            <p lang="en">{w.term.en}</p>
            {w.example && <p lang="it">{w.example.it}</p>}
            <button
              className="button secondary"
              aria-pressed={!!p.academy?.words[wordKey(w.term)]?.starred}
              onClick={() => save((s) => saveWord(s, w.term, w.example))}
            >
              {p.academy?.words[wordKey(w.term)]?.starred
                ? t("★ Saved", "★ Salvata")
                : t("☆ Save word", "☆ Salva parola")}
            </button>
          </article>
        ))}
      </div>
      {visible < shown.length && (
        <button
          className="button secondary"
          onClick={() => setVisible((n) => n + 24)}
        >
          {t("Show 24 more words", "Mostra altre 24 parole")}
        </button>
      )}
      <button className="text-button" onClick={() => go("vocabulary")}>
        {t(
          "Browse the themed banks with audio",
          "Sfoglia i gruppi tematici con audio",
        )}{" "}
        →
      </button>
    </div>
  );
}
