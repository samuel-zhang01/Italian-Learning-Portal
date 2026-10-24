export { ArcadeEntry } from "./daily-overview";
import { useEffect, useRef, useState } from "react";
import {
  arcadeBanks,
  arcadeItemById,
  arcadeItems,
  arcadePool,
  arcadeScenes,
  arcadeUnits,
} from "./arcade-catalogue";
import {
  answerArcade,
  arcadeDue,
  arcadeMistakes,
  arcadeRoundScore,
  emptyArcade,
  finishArcadeRound,
  hintArcade,
  nextArcadeItem,
  shuffled,
  startArcadeRound,
  updateArcadeDraft,
} from "./arcade-engine";
import { saveWord, wordKey } from "./academy-engine";
import { modelAnswerMismatch } from "./learning-utils";
import { catalogueParams } from "./navigation";
import type {
  ArcadeItem,
  ArcadeMode,
  ArcadeRound,
  ArcadeSettings,
  Pair,
  Progress,
} from "./types";
import "./arcade.css";

type Props = {
  p: Progress;
  today: string;
  t: (en: string, it: string) => string;
  text: (pair: Pair) => string;
  save: (update: (p: Progress) => Progress) => void;
  go: (route: string) => void;
  sceneId?: string;
};
const modes: {
  id: ArcadeMode;
  title: Pair;
  description: Pair;
  number: string;
}[] = [
  {
    id: "words",
    number: "01",
    title: { en: "Word hunt", it: "Caccia alle parole" },
    description: {
      en: "Find a useful Italian word or phrase.",
      it: "Trova una parola o una frase utile.",
    },
  },
  {
    id: "builder",
    number: "02",
    title: { en: "Sentence builder", it: "Costruisci la frase" },
    description: {
      en: "Put the words in order, one tap at a time.",
      it: "Metti le parole in ordine, un tocco alla volta.",
    },
  },
  {
    id: "detective",
    number: "03",
    title: { en: "Grammar detective", it: "Detective grammaticale" },
    description: {
      en: "Choose a form or repair a small mistake.",
      it: "Scegli una forma o correggi un piccolo errore.",
    },
  },
  {
    id: "conversation",
    number: "04",
    title: { en: "Conversation trail", it: "Piccole conversazioni" },
    description: {
      en: "Try three replies in an everyday situation.",
      it: "Prova tre risposte in una situazione quotidiana.",
    },
  },
];

export function PracticeArcade(props: Props) {
  const { p, t, text, save, go, today } = props;
  const a = p.arcade ?? emptyArcade();
  const requestedReviewId = catalogueParams().get("review");
  const requestedReview = requestedReviewId ? arcadeItemById.get(requestedReviewId) : undefined;
  const reviewRecord = requestedReview ? a.records[requestedReview.id] : undefined;
  const reviewDue = !!(reviewRecord && reviewRecord.due <= today && reviewRecord.date !== today);
  const requestedScene = arcadeScenes.find((scene) => scene.id === props.sceneId);
  const settings: ArcadeSettings = requestedScene ? { ...a.settings, mode: "conversation", scene: requestedScene.id } : a.settings;
  const pool = arcadePool(settings),
    due = arcadeDue(p, arcadeItems, today),
    mistakes = arcadeMistakes(p, arcadeItems);
  const roundSize = settings.mode === "conversation" ? 3 : Math.min(settings.size, pool.length);
  const set = (patch: Partial<ArcadeSettings>) => {
    if (requestedScene) go("games");
    save((p) => ({
      ...p,
      arcade: {
        ...(p.arcade ?? emptyArcade()),
        settings: { ...settings, ...patch },
      },
    }));
  };
  const start = (items: ArcadeItem[], review = false) =>
    save((s) => startArcadeRound({ ...s, arcade: { ...(s.arcade ?? emptyArcade()), settings } }, items, today, crypto.randomUUID(), review));
  if (a.active) {
    const item = arcadeItemById.get(a.active.itemIds[a.active.index]);
    if (!item)
      return (
        <div className="workspace arcade">
          <h1>
            {t(
              "This round needs a fresh start",
              "Questo giro deve ricominciare",
            )}
          </h1>
          <p>
            {t(
              "A saved question is no longer available. Your other progress is safe.",
              "Una domanda salvata non è più disponibile. Gli altri progressi sono conservati.",
            )}
          </p>
          <button
            className="button primary"
            onClick={() =>
              save((s) => ({ ...s, arcade: { ...s.arcade!, active: null } }))
            }
          >
            {t("Choose a game", "Scegli un gioco")}
          </button>
        </div>
      );
    return (
      <>
      {requestedReviewId && !a.active.itemIds.includes(requestedReviewId) && <p className="workspace hint">{t("Finish your saved round first. Your requested review will be ready afterwards.", "Termina prima il giro salvato. Il ripasso richiesto sarà disponibile dopo.")}</p>}
      {requestedScene && !a.active.itemIds.every((id) => id.startsWith(`scene:${requestedScene.id}:`)) && <p className="workspace hint">{t("You have an unfinished round. Your saved answers stay here; the chapter conversation will be ready after you finish.", "Hai un giro incompleto. Le risposte salvate restano qui; la conversazione del capitolo sarà pronta quando avrai finito.")}</p>}
      <ArcadeQuestion
        key={`${a.active.id}:${a.active.index}`}
        {...props}
        round={a.active}
        item={item}
      />
      </>
    );
  }
  if (requestedReviewId !== null) return <div className="workspace arcade">
    <button className="text-button" onClick={() => go("reviews")}>← {t("Back to review queue", "Torna al ripasso del giorno")}</button>
    <p className="eyebrow">{t("ONE SCHEDULED RECALL", "UN RIPASSO PROGRAMMATO")}</p>
    <h1>{requestedReview ? text(requestedReview.title) : t("Review item unavailable", "Ripasso non disponibile")}</h1>
    <section className="panel">
      {requestedReview && reviewDue ? <>
        <p>{t("Try this question again from memory. Your earlier answer stays in your history.", "Riprova questa domanda a memoria. La risposta precedente resta nella cronologia.")}</p>
        <button className="button primary" onClick={() => save((state) => startArcadeRound(state, [requestedReview], today, crypto.randomUUID(), true))}>{t("Start this review", "Inizia questo ripasso")}</button>
      </> : <p role="status">{reviewRecord?.date === today
        ? t("This item has been reviewed today. Return to your queue for another item.", "Hai ripassato questa domanda oggi. Torna all’elenco per un altro ripasso.")
        : t("This item is not due now. Return to your queue for scheduled practice.", "Questa domanda non è da ripassare ora. Torna all’elenco dei ripassi programmati.")}</p>}
    </section>
    <button className="button secondary" onClick={() => go("reviews")}>{t("Return to my review queue", "Torna al mio ripasso")}</button>
  </div>;
  const last = a.history.at(-1);
  return (
    <div className="workspace arcade">
      <header className="arcade-intro">
        <p className="eyebrow">
          {t("SMALL ROUNDS, USEFUL ITALIAN", "PICCOLI GIRI, ITALIANO UTILE")}
        </p>
        <h1>
          {t(
            "A little play. A little practice.",
            "Un po’ di gioco. Un po’ di pratica.",
          )}
        </h1>
        <p>
          {t(
            "Choose one game. Take your time, use a hint, and learn from each answer.",
            "Scegli un gioco. Prenditi il tuo tempo, usa un indizio e impara da ogni risposta.",
          )}
        </p>
      </header>
      <div
        className="arcade-modes"
        role="group"
        aria-label={t("Choose a game", "Scegli un gioco")}
      >
        {modes.map((mode) => (
          <button
            key={mode.id}
            className="arcade-mode"
            aria-pressed={settings.mode === mode.id}
            onClick={() => set({ mode: mode.id })}
          >
            <span className="arcade-number" aria-hidden="true">
              {mode.number}
            </span>
            <span>
              <strong>{text(mode.title)}</strong>
              <span>{text(mode.description)}</span>
            </span>
            <span aria-hidden="true">
              {settings.mode === mode.id ? "●" : "○"}
            </span>
          </button>
        ))}
      </div>
      <section
        className="arcade-setup"
        aria-label={t("Round settings", "Impostazioni del giro")}
      >
        <div className="arcade-start">
          <div>
            <strong>
              {roundSize}{" "}
              {roundSize === 1
                ? t("question · no timer", "domanda · senza cronometro")
                : t("questions · no timer", "domande · senza cronometro")}
            </strong>
            <p>
              {settings.mode === "words"
                ? text(
                    arcadeBanks.find((b) => b.id === settings.bank)?.title ?? {
                      en: "All word banks",
                      it: "Tutti i lessici",
                    },
                  )
                : settings.mode === "conversation"
                  ? text(
                      arcadeScenes.find((s) => s.id === settings.scene)
                        ?.title ?? {
                        en: "Choose a scene below",
                        it: "Scegli una scena qui sotto",
                      },
                    )
                  : settings.topic === "foundations"
                    ? t("Gentle foundations", "Fondamenti guidati")
                    : settings.topic === "a1"
                      ? t("All A1 topics", "Tutti gli argomenti A1")
                      : text(
                          arcadeUnits.find((u) => u.id === settings.topic)
                            ?.title ?? {
                            en: "Choose a topic",
                            it: "Scegli un argomento",
                          },
                        )}
            </p>
          </div>
          <button
            className="button primary"
            disabled={!pool.length}
            onClick={() => start(pool)}
          >
            {t("Let’s play", "Giochiamo")} →
          </button>
        </div>
        {settings.mode === "conversation" && (
          <p className="arcade-scene-intro">
            {text(
              arcadeScenes.find((s) => s.id === settings.scene)?.intro ?? {
                en: "Choose a situation below.",
                it: "Scegli una situazione qui sotto.",
              },
            )}
          </p>
        )}
        <details className="arcade-customise">
          <summary>
            {t("Customise this round", "Personalizza questo giro")}
          </summary>
          <div className="arcade-fields">
            {settings.mode !== "conversation" && (
              <label>
                {t("Round length", "Lunghezza del giro")}
                <select
                  value={settings.size}
                  onChange={(e) =>
                    set({
                      size: Number(e.target.value) as ArcadeSettings["size"],
                    })
                  }
                >
                  {[5, 10, 15].map((n) => (
                    <option key={n} value={n}>
                      {n} {t("questions", "domande")}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {settings.mode === "words" && (
              <label>
                {t("Word bank", "Lessico")}
                <select
                  value={settings.bank}
                  onChange={(e) => set({ bank: e.target.value })}
                >
                  <option value="all">
                    {t("All word banks", "Tutti i lessici")}
                  </option>
                  {arcadeBanks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.level ?? "A1"} · {text(b.title)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {["builder", "detective"].includes(settings.mode) && (
              <label>
                {t("Grammar topic", "Argomento di grammatica")}
                <select
                  value={settings.topic}
                  onChange={(e) => set({ topic: e.target.value })}
                >
                  <option value="foundations">
                    {t(
                      "Gentle foundations · start here",
                      "Fondamenti guidati · inizia qui",
                    )}
                  </option>
                  <option value="a1">
                    {t(
                      "All A1 · includes past tense",
                      "Tutto A1 · include il passato",
                    )}
                  </option>
                  {arcadeUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {text(u.title)}
                      {u.level === "A1-plus" ? " · A1+" : u.level === "A2" ? " · A2" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {settings.mode === "conversation" && (
              <label>
                {t("Your situation", "La tua situazione")}
                <select
                  value={settings.scene}
                  onChange={(e) => set({ scene: e.target.value })}
                >
                  {arcadeScenes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id.startsWith("espresso2-") ? "A2" : "A1"} · {text(s.title)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {settings.mode !== "conversation" && (
              <label>
                {t("Answer support", "Aiuto per rispondere")}
                <select
                  value={settings.support}
                  onChange={(e) =>
                    set({
                      support: e.target.value as ArcadeSettings["support"],
                    })
                  }
                >
                  <option value="guided">
                    {t(
                      "Guided · choices and word tiles",
                      "Guidato · scelte e tessere",
                    )}
                  </option>
                  <option value="recall">
                    {t(
                      "Recall · type words and sentences",
                      "Memoria · scrivi parole e frasi",
                    )}
                  </option>
                </select>
              </label>
            )}
          </div>
          <p>
            {t(
              "Small topic banks may have fewer questions. Hints are always available. Choice questions keep their options; repairs use typing. Settings apply to the next round.",
              "I piccoli gruppi possono avere meno domande. Gli indizi sono sempre disponibili. Le domande a scelta mantengono le opzioni; le correzioni si scrivono. Le impostazioni valgono per il prossimo giro.",
            )}
          </p>
        </details>
      </section>
      {last && (
        <section
          className="arcade-last"
          aria-label={t("Last round", "Ultimo giro")}
        >
          <h2>{t("Your last round", "Il tuo ultimo giro")}</h2>
          <p>
            {last.independent}/{last.total}{" "}
            {t("correct without hints", "corrette senza indizi")} ·{" "}
            {last.supported} {t("correct with support", "corrette con aiuto")}.
          </p>
          <p>
            {t(
              "Scores from your last 30 rounds are saved. Replays are practice, not a level test.",
              "I punteggi degli ultimi 30 giri sono salvati. I nuovi tentativi sono pratica, non un test di livello.",
            )}
          </p>
        </section>
      )}
      <details className="arcade-review">
        <summary>
          {t("My practice trail", "Il mio percorso di pratica")} ·{" "}
          {Object.keys(a.records).length}{" "}
          {t("questions explored", "domande esplorate")}
        </summary>
        <p>
          {t(
            "Each new question earns 2 practice XP once, including mistakes. These games do not complete grammar lessons or certify A1. Game time is extra to your planned lesson minutes.",
            "Ogni nuova domanda vale 2 punti pratica una sola volta, anche con errori. I giochi non completano le lezioni di grammatica e non certificano A1. Il tempo di gioco si aggiunge ai minuti delle lezioni pianificate.",
          )}
        </p>
        <div className="button-row">
          <button
            className="button secondary"
            disabled={!due.length}
            onClick={() => start(due, true)}
          >
            {t("Recall due", "Ripasso in scadenza")} ({due.length})
          </button>
          <button
            className="button secondary"
            disabled={!mistakes.length}
            onClick={() => start(mistakes, true)}
          >
            {t("Replay mistakes & hints", "Riprova errori e indizi")} (
            {mistakes.length})
          </button>
          <button className="text-button" onClick={() => go("progress")}>
            {t("Back up my progress", "Salva i miei progressi")}
          </button>
        </div>
        <p>
          {t(
            "Return tomorrow for fresh recall. Independent answers on later days move reviews to three, then seven days.",
            "Torna domani per un nuovo richiamo. Le risposte autonome nei giorni successivi spostano il ripasso a tre, poi a sette giorni.",
          )}
        </p>
      </details>
    </div>
  );
}

function ArcadeQuestion({
  p,
  today,
  t,
  text,
  save,
  go,
  round,
  item,
}: Props & { round: ArcadeRound; item: ArcadeItem }) {
  const result = round.answers[item.id],
    hinted = round.hints.includes(item.id);
  const input = useRef<HTMLInputElement>(null),
    feedback = useRef<HTMLDivElement>(null),
    question = useRef<HTMLHeadingElement>(null);
  const [leaving, setLeaving] = useState(false),
    [speechError, setSpeechError] = useState(false);
  const options = shuffled(item.options ?? [], round.id + item.id);
  const tokens = shuffled(item.tokens ?? [], round.id + item.id);
  const tiles = !!item.tokens && round.support === "guided";
  const choices =
    !!item.options &&
    (round.support === "guided" ||
      item.mode !== "words" ||
      item.answers[0].includes("/"));
  const finished = round.itemIds.every((id) => round.answers[id]);
  const score = arcadeRoundScore(round);
  useEffect(() => {
    question.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (result) feedback.current?.focus();
  }, [result]);
  useEffect(
    () => () => {
      window.speechSynthesis?.cancel();
    },
    [],
  );
  const speak = () => {
    if (!("speechSynthesis" in window)) {
      setSpeechError(true);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(item.answers[0]);
    utterance.lang = "it-IT";
    utterance.rate = 0.8;
    utterance.onerror = (event) => {
      if (!["interrupted", "canceled"].includes(event.error))
        setSpeechError(true);
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };
  const updateTiles = (indexes: number[]) =>
    save((s) =>
      updateArcadeDraft(s, indexes.map((i) => tokens[i]).join(" "), indexes),
    );
  return (
    <div className="workspace arcade arcade-playing">
      <div className="arcade-roundbar">
        <button className="text-button" onClick={() => go("today")}>
          ← {t("Pause & save", "Pausa e salva")}
        </button>
        <span>
          {round.index + 1} / {round.itemIds.length}
        </span>
      </div>
      <progress
        value={Object.keys(round.answers).length}
        max={round.itemIds.length}
        aria-label={t("Round progress", "Progressi del giro")}
      />
      <section className="arcade-question">
        <p className="eyebrow">{text(item.title)}</p>
        <h1 ref={question} tabIndex={-1}>
          {text(item.prompt)}
        </h1>
        {!result && (
          <>
            {choices ? (
              <div className="arcade-options">
                {options.map((option) => (
                  <button
                    className="arcade-option"
                    lang="it"
                    key={option}
                    onClick={() =>
                      save((s) => answerArcade(s, item, option, today))
                    }
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  save((s) => answerArcade(s, item, round.draft, today));
                }}
              >
                {tiles ? (
                  <>
                    <p>
                      {t(
                        "Tap words to build your sentence. Tap a chosen word to remove it.",
                        "Tocca le parole per costruire la frase. Tocca una parola scelta per toglierla.",
                      )}
                    </p>
                    <div
                      className="arcade-built"
                      aria-label={t("Your sentence", "La tua frase")}
                    >
                      <span className="sr-only" aria-live="polite">
                        {round.draft}
                      </span>
                      {!round.tokens.length && (
                        <span>
                          {t(
                            "Your sentence goes here…",
                            "La tua frase va qui…",
                          )}
                        </span>
                      )}
                      {round.tokens.map((index, i) => (
                        <button
                          lang="it"
                          type="button"
                          key={index}
                          onClick={() =>
                            updateTiles(round.tokens.filter((_, n) => n !== i))
                          }
                          aria-label={`${t("Remove", "Togli")} ${tokens[index]}`}
                        >
                          {tokens[index]}
                        </button>
                      ))}
                    </div>
                    <div className="arcade-tiles">
                      {tokens.map((token, i) => (
                        <button
                          lang="it"
                          type="button"
                          key={i}
                          disabled={round.tokens.includes(i)}
                          onClick={() => updateTiles([...round.tokens, i])}
                        >
                          {token}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    {item.tokens && (
                      <div className="arcade-word-cues">
                        <strong>
                          {t(
                            "Use all these words:",
                            "Usa tutte queste parole:",
                          )}
                        </strong>
                        <p lang="it">{tokens.join(" · ")}</p>
                      </div>
                    )}
                    <label
                      className="arcade-input-label"
                      htmlFor="arcade-answer"
                    >
                      {t("Your Italian answer", "La tua risposta in italiano")}
                    </label>
                    <input
                      id="arcade-answer"
                      ref={input}
                      value={round.draft}
                      maxLength={500}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) =>
                        save((s) => updateArcadeDraft(s, e.target.value))
                      }
                    />
                    <div
                      className="arcade-accents"
                      aria-label={t("Italian accents", "Accenti italiani")}
                    >
                      {["à", "è", "é", "ì", "ò", "ù", "’"].map((char) => (
                        <button
                          type="button"
                          key={char}
                          aria-label={`${t("Insert", "Inserisci")} ${char}`}
                          onClick={() => {
                            const at =
                                input.current?.selectionStart ??
                                round.draft.length,
                              end = input.current?.selectionEnd ?? at;
                            save((s) =>
                              updateArcadeDraft(
                                s,
                                round.draft.slice(0, at) +
                                  char +
                                  round.draft.slice(end),
                              ),
                            );
                            input.current?.focus();
                            requestAnimationFrame(() =>
                              input.current?.setSelectionRange(at + 1, at + 1),
                            );
                          }}
                        >
                          {char}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <button
                  className="button primary"
                  disabled={
                    !round.draft.trim() ||
                    (tiles && round.tokens.length !== tokens.length)
                  }
                >
                  {t("Check answer", "Controlla la risposta")}
                </button>
              </form>
            )}
            <div className="arcade-help">
              <button
                className="text-button"
                disabled={hinted}
                onClick={() => save(hintArcade)}
              >
                {t("Show a hint", "Mostra un indizio")}
              </button>
              {hinted && <p role="status">{text(item.hint)}</p>}
            </div>
          </>
        )}
        {result && (
          <div
            ref={feedback}
            tabIndex={-1}
            className="arcade-feedback"
            aria-label={t("Answer feedback", "Feedback sulla risposta")}
          >
            <h2>
              {result.correct
                ? result.assisted
                  ? t(
                      "You got it with support.",
                      "Ci sei arrivato con un aiuto.",
                    )
                  : t("You got it.", "Esatto.")
                : !choices
                  ? text(modelAnswerMismatch)
                  : t(
                      "A useful one to practise.",
                      "Una risposta utile da ripassare.",
                    )}
            </h2>
            {!result.correct && (
              <p>
                {t("Your answer:", "La tua risposta:")}{" "}
                <span lang="it">{result.answer}</span>
              </p>
            )}
            <p className="arcade-answer" lang="it">
              {item.answers[0]}
            </p>
            <p>{text(item.explanation)}</p>
            {item.word && p.language === "en" && (
              <p lang="it">{item.word.example.it}</p>
            )}
            <div className="button-row">
              <button className="text-button" onClick={speak}>
                {t("Hear the answer", "Ascolta la risposta")}
              </button>
              {item.word && (
                <button
                  className="text-button"
                  disabled={p.academy?.words[wordKey(item.word.term)]?.starred}
                  onClick={() =>
                    save((s) =>
                      s.academy?.words[wordKey(item.word!.term)]?.starred
                        ? s
                        : saveWord(s, item.word!.term, item.word!.example),
                    )
                  }
                >
                  {p.academy?.words[wordKey(item.word.term)]?.starred
                    ? t("Saved to word bank", "Salvata nel lessico")
                    : t("Save this word", "Salva questa parola")}
                </button>
              )}
            </div>
            {speechError && (
              <p role="status">
                {t(
                  "Audio is unavailable on this device. Read the answer aloud instead.",
                  "L’audio non è disponibile su questo dispositivo. Leggi la risposta ad alta voce.",
                )}
              </p>
            )}
            <small>
              {t(
                "Device pronunciation; try saying it once yourself.",
                "Pronuncia del dispositivo; prova a dirlo una volta.",
              )}
            </small>
            {finished ? (
              <div className="arcade-finish">
                <p>
                  <strong>
                    {score.independent}/{score.total}
                  </strong>{" "}
                  {t("correct without hints", "corrette senza indizi")} ·{" "}
                  {score.supported} {t("with support", "con aiuto")}
                </p>
                <p>
                  {t(
                    "Round complete. Come back tomorrow and see what you remember.",
                    "Giro completato. Torna domani e scopri cosa ricordi.",
                  )}
                </p>
                <button
                  className="button primary"
                  onClick={() => save(finishArcadeRound)}
                >
                  {t("Finish round", "Concludi il giro")}
                </button>
              </div>
            ) : (
              <button
                className="button primary arcade-next"
                onClick={() => save(nextArcadeItem)}
              >
                {t("Next question", "Prossima domanda")} →
              </button>
            )}
          </div>
        )}
      </section>
      <details className="arcade-round-help">
        <summary>
          {t("Need a different activity?", "Vuoi cambiare attività?")}
        </summary>
        <p>
          {t(
            "Pausing keeps this exact question. You can also end this round and choose another game; submitted answers stay in your practice trail.",
            "La pausa conserva questa domanda. Puoi anche terminare il giro e scegliere un altro gioco; le risposte inviate restano nel percorso di pratica.",
          )}
        </p>
        {item.unitId && (
          <button
            className="text-button"
            onClick={() => {
              if (!result) save(hintArcade);
              go(`grammar/${item.unitId}`);
            }}
          >
            {t("Open the related lesson", "Apri la lezione collegata")}
          </button>
        )}
        {!leaving ? (
          <button className="text-button" onClick={() => setLeaving(true)}>
            {t("End this round early", "Termina questo giro prima")}
          </button>
        ) : (
          <div className="button-row">
            <button
              className="button secondary"
              onClick={() =>
                save((s) => ({ ...s, arcade: { ...s.arcade!, active: null } }))
              }
            >
              {t("End round and choose again", "Termina e scegli di nuovo")}
            </button>
            <button className="text-button" onClick={() => setLeaving(false)}>
              {t("Keep playing", "Continua a giocare")}
            </button>
          </div>
        )}
      </details>
    </div>
  );
}
