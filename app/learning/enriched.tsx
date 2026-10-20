import { useState, type ComponentType } from "react";
import data from "./enrichment.json";
import grammar from "./grammar.json";
import companion from "./companion.json";
import { dueReviews, isCorrect } from "./engine";
import {
  emptySession,
  dailyRecipe,
  dailyStudyPlan,
  learningRewards,
  sessionLayout,
  sessionActivities,
  sessionDone,
  sessionMission,
} from "./study";
import type {
  Enrichment,
  GrammarUnit,
  PageCompanion,
  Mission,
  OnlineResource,
  Pair,
  Progress,
  Programme,
  SessionActivity,
  StudySession,
  VocabularyBank,
} from "./types";

type Translate = (en: string, it: string) => string;
type Props = {
  p: Progress;
  t: Translate;
  text: (p: Pair) => string;
  today: string;
  save: (fn: (p: Progress) => Progress) => void;
  go: (route: string) => void;
};
type Audio = ComponentType<{ phrase: string; t: Translate }>;
const banks = data.banks as VocabularyBank[];
const lessons = data.lessons as Enrichment[];
const resources = data.resources as OnlineResource[];
const programmeDay = (p: Progress) =>
  (grammar.programmes as Programme[]).find(
    (x) => x.id === p.academy?.programme?.id,
  )?.days[p.academy?.programme?.day ?? 0];
const labels = (t: Translate): Record<SessionActivity, string> => ({
  warmup: t("Wake up your memory", "Risveglia la memoria"),
  core: t("Learn one useful idea", "Impara un’idea utile"),
  vocab: t("Vocabulary quest", "Missione lessico"),
  input: t("Listen, read, notice", "Ascolta, leggi, osserva"),
  speak: t("Your little conversation", "La tua piccola conversazione"),
  exit: t("Leave a memory trail", "Lascia una traccia"),
});

export function SessionPreview({
  p,
  t,
  text,
  today,
  save,
  go,
  missions,
}: Props & { missions: Mission[] }) {
  const plan = dailyStudyPlan(p, missions, grammar.units as GrammarUnit[],
    grammar.programmes as Programme[], companion.pages as PageCompanion[], today);
  const readyToFinish = plan.dayReady;
  const next = readyToFinish ? undefined : plan.next;
  const count = plan.blocks.filter((block) => block.completed).length;
  return (
    <section className="session-preview" aria-label={t("Today’s next step", "Il prossimo passo di oggi")}>
      <div>
        <p className="eyebrow">
          {plan.programme
            ? `${text(plan.programme.title)} · ${t("Day", "Giorno")} ${Math.min((p.academy?.programme?.day ?? 0) + 1, plan.programme.days.length)}`
            : t("YOUR DAILY PRACTICE", "LA TUA PRATICA QUOTIDIANA")}
        </p>
        <h2>{next ? text(next.detail) : readyToFinish ? t("Your study day is ready to finish", "Il giorno di studio è pronto da completare") : t("Today’s practice is complete", "La pratica di oggi è completata")}</h2>
        <p>
          {next
            ? `${text(next.title)} · ${t(`about ${next.minutes} minutes`, `circa ${next.minutes} minuti`)}. ${t("Your work saves as you go.", "Il lavoro si salva mentre procedi.")}`
            : readyToFinish
              ? t("The required lessons and grammar are complete. Save this programme day; any remaining practice is optional.", "Le lezioni e la grammatica richieste sono completate. Salva questo giorno del percorso; la pratica rimanente è facoltativa.")
              : t("You can stop here. Come back for your next session.", "Puoi fermarti qui. Torna per la prossima sessione.")}
        </p>
        {(next || readyToFinish) && (
          <button className="button primary today-primary-action" onClick={() => {
            if (next?.route === "session") save((state) => ({
              ...state, sessions: { ...state.sessions,
                [today]: state.sessions?.[today] ?? emptySession(plan.mission.id, plan.duration),
              },
            }));
            go(next?.route ?? "programmes");
          }}>
            {next ? t("Continue today", "Continua oggi") : t("Finish this study day", "Completa questo giorno")} →
          </button>
        )}
        <div className="session-meta">
          <span>{count}/{plan.blocks.length} {t("blocks complete", "attività completate")}</span>
          <button className="text-button" onClick={() => go("plan")}>
            {p.plan.minutes} {t("min today · change", "min oggi · modifica")}
          </button>
        </div>
        {!plan.programme && (
          <button className="text-button programme-suggestion" onClick={() => go("programmes")}>
            {t("Want a steady route? Try supported A1", "Vuoi un percorso regolare? Prova A1 guidato")} →
          </button>
        )}
      </div>
      <div className="paper-collage" aria-hidden="true">
        <span className="collage-sun" />
        <div className="collage-note">
          <span>un po’ ogni giorno</span>
          <strong>
            ciao<span>!</span>
          </strong>
          <i />
          <small>little by little.</small>
        </div>
        <svg className="collage-book" viewBox="0 0 260 200" fill="none">
          <defs>
            <filter
              id="collage-painted-stock"
              x="0"
              y="0"
              width="100%"
              height="100%"
              colorInterpolationFilters="sRGB"
            >
              <feImage
                href={new URL("./painted-cardboard.webp", import.meta.url).href}
                x="0"
                y="0"
                width="260"
                height="200"
                preserveAspectRatio="xMidYMid slice"
                result="grain"
              />
              <feBlend
                in="grain"
                in2="SourceGraphic"
                mode="soft-light"
                result="paint"
              />
              <feComposite in="paint" in2="SourceGraphic" operator="in" />
            </filter>
          </defs>
          <g filter="url(#collage-painted-stock)">
            <path d="M20 58 113 82 137 181 7 147Z" fill="var(--orange)" />
            <path d="m137 181 108-33-3-97-104 32Z" fill="var(--green)" />
            <path
              d="M27 48c46-11 80 4 110 35l-9 90c-34-24-67-37-111-35Z"
              fill="var(--green)"
            />
            <path
              d="M137 83c31-33 61-46 101-46l7 101c-44-1-82 11-117 35Z"
              fill="var(--paper)"
            />
            <path
              d="M137 83c37-21 64-30 94-31M136 98c36-22 65-31 97-32M134 113c37-22 66-31 100-32M132 128c37-22 68-32 103-32M131 143c39-22 69-32 106-32M129 158c39-22 71-32 110-32"
              stroke="var(--ochre)"
              strokeWidth=".8"
            />
            <path d="m137 83-9 90" stroke="var(--ochre)" />
          </g>
        </svg>
        <span className="collage-caption">PARLIAMO · OGNI GIORNO</span>
      </div>
    </section>
  );
}

function WordCards({
  bank,
  t,
  Audio,
  attempted = [],
  onAttempt,
}: {
  bank: VocabularyBank;
  t: Translate;
  Audio: Audio;
  attempted?: string[];
  onAttempt?: (key: string) => void;
}) {
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      bank.words.findIndex((_, i) => !attempted.includes(`${bank.id}:${i}`)),
    ),
  );
  const [revealed, setRevealed] = useState(false);
  const word = bank.words[index];
  const show = (i: number) => {
    setIndex(i);
    setRevealed(false);
  };
  return (
    <div className="word-practice">
      <p className="hint">
        {t(
          "Read the English cue. Try the Italian aloud before revealing it. Then repeat the example. Both buttons record practice, not a test score.",
          "Leggi lo spunto inglese. Prova a dire l’italiano prima di scoprirlo. Poi ripeti l’esempio. Entrambi i pulsanti registrano la pratica, non un voto.",
        )}
      </p>
      <div className="flashcard" aria-live="polite">
        <p className="eyebrow">
          {index + 1} / {bank.words.length}
        </p>
        <h3 lang="en">{word.term.en}</h3>
        {!revealed ? (
          <button
            className="button secondary"
            onClick={() => setRevealed(true)}
          >
            {t("Reveal the Italian", "Mostra l’italiano")}
          </button>
        ) : (
          <>
            <p className="word-answer" lang="it">
              {word.term.it} <Audio phrase={word.term.it} t={t} />
            </p>
            <p lang="it">{word.example.it}</p>
            <p lang="en" className="hint">
              {word.example.en}
            </p>
            <div className="button-row">
              {[
                t("I remembered it", "L’ho ricordato"),
                t("I needed help — repeat it", "Mi serviva aiuto · ripeto"),
              ].map((label) => (
                <button
                  className="button secondary"
                  key={label}
                  onClick={() => {
                    onAttempt?.(`${bank.id}:${index}`);
                    show((index + 1) % bank.words.length);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div
        className="word-dots"
        aria-label={t("Choose a vocabulary card", "Scegli una carta lessico")}
      >
        {bank.words.map((_, i) => (
          <button
            key={i}
            aria-label={`${t("Card", "Carta")} ${i + 1}`}
            aria-pressed={index === i}
            onClick={() => show(i)}
          >
            {attempted.includes(`${bank.id}:${i}`) ? "✓" : i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DailySession({
  p,
  t,
  text,
  today,
  save,
  go,
  missions,
  Audio,
}: Props & { missions: Mission[]; Audio: Audio }) {
  const day = programmeDay(p);
  const plannedDuration = dailyRecipe(
    p.plan.minutes,
    day?.unitIds.length ?? 0,
  ).session;
  const m = sessionMission(p, missions, today, day?.missionIds);
  const extra = lessons.find((x) => x.missionId === m.id)!;
  const bank = banks.find((b) => b.id === extra.bank)!;
  const session = p.sessions?.[today] ?? emptySession(m.id, plannedDuration);
  const done = sessionDone(p, today);
  const duration = session.duration ?? 30;
  const stages = sessionActivities(duration);
  const minutes = sessionLayout(duration);
  const wordTarget = Math.min(
    bank.words.length,
    minutes.vocab <= 3 ? 4 : minutes.vocab === 4 ? 6 : 8,
  );
  const [active, setActive] = useState<SessionActivity>(
    () => stages.find((a) => !done.includes(a)) ?? stages.at(-1)!,
  );
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [selfChecked, setSelfChecked] = useState(false);
  const titles = labels(t);
  const due = dueReviews(p, today);
  const update = (fn: (s: StudySession) => StudySession) =>
    save((state) => ({
      ...state,
      sessions: {
        ...state.sessions,
        [today]: fn(
          state.sessions?.[today] ?? emptySession(m.id, plannedDuration),
        ),
      },
    }));
  const finish = (activity: SessionActivity) => {
    update((s) => ({ ...s, done: Array.from(new Set([...s.done, activity])) }));
    const remaining = stages.find((a) => a !== activity && !done.includes(a));
    if (remaining) setActive(remaining);
  };
  const attempted = bank.words.filter((_, i) =>
    session.recalled.includes(`${bank.id}:${i}`),
  ).length;
  const resource = resources.find((r) => r.id === extra.resource)!;
  const previous = Object.entries(p.sessions ?? {})
    .filter(([d, s]) => d < today && s.exit.trim())
    .sort(([a], [b]) => b.localeCompare(a))[0];
  return (
    <div className="workspace session-page">
      <button className="text-button" onClick={() => go("today")}>
        ← {t("Back to today", "Torna a oggi")}
      </button>
      <p className="eyebrow">
        {t(
          `MID-A1 · ABOUT ${duration} MINUTES · YOUR PACE`,
          `A1 INTERMEDIO · CIRCA ${duration} MINUTI · AL TUO RITMO`,
        )}
      </p>
      <h1>{text(m.title)}</h1>
      <p>
        {text(m.goal)}{" "}
        {t(
          "The times are suggestions. Pause whenever you need; your drafts save as you go.",
          "I tempi sono indicativi. Fermati quando serve; le bozze si salvano mentre lavori.",
        )}
      </p>
      <progress
        max={stages.length}
        value={done.length}
        aria-label={t(
          "Daily quests completed",
          "Missioni quotidiane completate",
        )}
      />
      <p className="hint" role="status">
        {done.length}/{stages.length}{" "}
        {t("quests completed", "missioni completate")} · {learningRewards(p).xp}{" "}
        XP
      </p>
      <div className="session-layout">
        <nav
          className="session-stages"
          aria-label={t("Daily quests", "Missioni quotidiane")}
        >
          {stages.map((a, i) => (
            <button
              key={a}
              aria-pressed={active === a}
              onClick={() => {
                setActive(a);
                setFeedback(null);
              }}
            >
              <span>
                {done.includes(a) ? "✓" : String(i + 1).padStart(2, "0")}
              </span>
              <strong>{titles[a]}</strong>
              <small>{minutes[a]} min</small>
            </button>
          ))}
        </nav>
        <section className="panel session-activity" aria-label={titles[active]}>
          <p className="eyebrow">
            {minutes[active]} MIN · {t("QUEST", "MISSIONE")}{" "}
            {stages.indexOf(active) + 1}
          </p>
          <h2>{titles[active]}</h2>
          {active === "warmup" && (
            <>
              <p>
                {t(
                  "Before looking at notes, try one phrase from your last session. On your first day, try a greeting or your name. Two or three words are enough.",
                  "Prima di guardare gli appunti, prova una frase dell’ultima sessione. Il primo giorno, prova un saluto o il tuo nome. Bastano due o tre parole.",
                )}
              </p>
              {previous && (
                <details>
                  <summary>
                    {t(
                      "Yesterday’s memory trail · reveal after trying",
                      "Ultima traccia · apri dopo aver provato",
                    )}
                  </summary>
                  <p lang="it">{previous[1].exit}</p>
                </details>
              )}
              {due.length > 0 && (
                <div className="support-box">
                  <p>
                    {t(
                      "Use part of this warm-up for one due review, then come back here.",
                      "Dedica parte del riscaldamento a un ripasso in scadenza, poi torna qui.",
                    )}
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      update((s) => s);
                      go(`review/${due[0]}`);
                    }}
                  >
                    {t("Open a due review", "Apri un ripasso")}
                  </button>
                </div>
              )}
              <label className="field">
                {t("A phrase I can remember", "Una frase che ricordo")}
                <textarea
                  aria-label={t(
                    "A phrase I can remember",
                    "Una frase che ricordo",
                  )}
                  lang="it"
                  maxLength={2000}
                  value={session.warmup}
                  onChange={(e) =>
                    update((s) => ({ ...s, warmup: e.target.value }))
                  }
                />
              </label>
              <details>
                <summary>
                  {t("A tiny starting point", "Un piccolo punto di partenza")}
                </summary>
                <p lang="it">
                  Ciao, mi chiamo ___. / Abito a ___. / Vorrei un caffè.
                </p>
                <p>
                  {t(
                    "Change one detail. Say it, cover it, then say it again. Spend any remaining time recalling three familiar words.",
                    "Cambia un dettaglio. Dillo, coprilo e ripetilo. Nel tempo rimasto prova a ricordare tre parole note.",
                  )}
                </p>
              </details>
              <button
                className="button primary"
                disabled={session.warmup.trim().length < 3}
                onClick={() => finish("warmup")}
              >
                {t("Save my warm-up", "Salva il riscaldamento")}
              </button>
            </>
          )}
          {active === "core" && (
            <>
              {extra.notes.map((note, i) => (
                <div className="support-box" key={i}>
                  <h3>{t("Let’s make it simple", "Facciamola semplice")}</h3>
                  <p>{text(note)}</p>
                </div>
              ))}
              <p>{text(m.rule)}</p>
              <p>
                {t(
                  "Open the core lesson for two examples, two checks, and a short piece of your own Italian. Then return to this session.",
                  "Apri la lezione base per due esempi, due prove e una breve produzione tua. Poi torna alla sessione.",
                )}
              </p>
              <button
                className="button primary"
                onClick={() => {
                  update((s) => s);
                  go(`lesson/${m.id}`);
                }}
              >
                {p.completed[m.id]
                  ? t("Revisit the core lesson", "Rivedi la lezione base")
                  : t("Open my core lesson", "Apri la lezione base")}
              </button>
              {p.completed[m.id] && p.completed[m.id].date !== today && (
                <>
                  <p className="hint">
                    {t(
                      "Already completed earlier? Rehearse the examples and recall questions aloud. Mark this only after practising them again.",
                      "Già completata in passato? Ripeti ad alta voce gli esempi e le domande di memoria. Segna questa attività dopo averli riprovati.",
                    )}
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => finish("core")}
                  >
                    {t(
                      "I rehearsed the core lesson",
                      "Ho riprovato la lezione base",
                    )}
                  </button>
                </>
              )}
              {done.includes("core") && (
                <button
                  className="button secondary"
                  onClick={() => setActive("vocab")}
                >
                  {t("Continue to vocabulary", "Continua con il lessico")} →
                </button>
              )}
            </>
          )}
          {active === "vocab" && (
            <>
              <p>
                {text(bank.title)} · {Math.min(attempted, wordTarget)}/
                {wordTarget} {t("cards practised", "carte provate")}
              </p>
              <WordCards
                bank={bank}
                t={t}
                Audio={Audio}
                attempted={session.recalled}
                onAttempt={(key) =>
                  update((s) => ({
                    ...s,
                    recalled: Array.from(new Set([...s.recalled, key])),
                  }))
                }
              />
              <p className="hint">
                {t(
                  "Eight cards feeling like a lot? Spend the first pass just listening and repeating. On the second pass, cover the Italian. Revisit any card using its number.",
                  "Otto carte sembrano tante? Al primo giro ascolta e ripeti soltanto. Al secondo copri l’italiano. Riprendi ogni carta con il suo numero.",
                )}
              </p>
              <button
                className="button primary"
                disabled={attempted < wordTarget}
                onClick={() => finish("vocab")}
              >
                {t(
                  "Vocabulary practice complete",
                  "Pratica lessico completata",
                )}
              </button>
            </>
          )}
          {active === "input" && (
            <>
              <p>
                {t(
                  "Listen once with the text covered. Catch the situation, not every word. Open the scene, read line by line, then listen again. No audio? Read both parts aloud.",
                  "Ascolta una volta con il testo coperto. Cerca la situazione, non ogni parola. Apri la scena, leggi una riga alla volta, poi riascolta. Niente audio? Leggi entrambe le parti ad alta voce.",
                )}
              </p>
              <p>
                {t("Listen to the whole scene", "Ascolta tutta la scena")}{" "}
                <Audio
                  phrase={extra.dialogue
                    .map((x) => x.it.replace(/^[A-C]: /, ""))
                    .join(" ")}
                  t={t}
                />
              </p>
              <details className="scene">
                <summary>
                  {t(
                    "Open the scene and translations",
                    "Apri la scena e le traduzioni",
                  )}
                </summary>
                {extra.dialogue.map((line, i) => (
                  <div key={i}>
                    <p lang="it">
                      {line.it}{" "}
                      <Audio phrase={line.it.replace(/^[A-C]: /, "")} t={t} />
                    </p>
                    {p.translations && (
                      <p lang="en" className="hint">
                        {line.en}
                      </p>
                    )}
                  </div>
                ))}
              </details>
              <label className="field">
                {text(extra.question.prompt)}
                <input
                  lang="it"
                  maxLength={200}
                  value={session.inputAnswer}
                  onChange={(e) => {
                    setFeedback(null);
                    update((s) => ({ ...s, inputAnswer: e.target.value }));
                  }}
                />
              </label>
              <button
                className="button secondary"
                disabled={!session.inputAnswer.trim()}
                onClick={() =>
                  setFeedback(
                    isCorrect(session.inputAnswer, extra.question.answers)
                      ? "correct"
                      : "wrong",
                  )
                }
              >
                {t(
                  "Check the scene answer",
                  "Controlla la risposta sulla scena",
                )}
              </button>
              {feedback && (
                <p
                  className={`feedback ${feedback === "correct" ? "correct" : "incorrect"}`}
                  role="status"
                >
                  {feedback === "correct"
                    ? t(
                        "Yes — you found the detail.",
                        "Sì, hai trovato il dettaglio.",
                      )
                    : t(
                        "Try again. Open the scene and look for the detail; using support is welcome.",
                        "Riprova. Apri la scena e cerca il dettaglio; puoi usare gli aiuti.",
                      )}
                </p>
              )}
              {(feedback === "correct" || done.includes("input")) && (
                <button
                  className="button primary"
                  onClick={() => finish("input")}
                >
                  {t("Save my scene practice", "Salva la pratica sulla scena")}
                </button>
              )}
              <details className="online-extension">
                <summary>
                  {t(
                    "Optional online practice · if time remains",
                    "Pratica online facoltativa · se resta tempo",
                  )}
                </summary>
                <ResourceCard resource={resource} text={text} t={t} />
                <p className="hint">
                  {t(
                    "Try just a short excerpt after the scene, or save the link for another day. The original scene works without an external site.",
                    "Prova solo un breve estratto dopo la scena, oppure conserva il link per un altro giorno. La scena originale funziona senza un sito esterno.",
                  )}
                </p>
              </details>
            </>
          )}
          {active === "speak" && (
            <>
              <p>{text(extra.speaking)}</p>
              <div className="support-box">
                <h3>
                  {t(
                    "Build it one line at a time",
                    "Costruisci una frase alla volta",
                  )}
                </h3>
                <p lang="it">{extra.frame.it}</p>
                {p.translations && (
                  <p lang="en" className="hint">
                    {extra.frame.en}
                  </p>
                )}
                <p>
                  {t(
                    "1. Fill one gap. 2. Read it aloud. 3. Change one detail. 4. Cover the frame and try again. Working alone? Play both voices. Aim for two short lines.",
                    "1. Riempi uno spazio. 2. Leggi ad alta voce. 3. Cambia un dettaglio. 4. Copri il modello e riprova. Sei da solo? Interpreta le due voci. Punta a due righe brevi.",
                  )}
                </p>
              </div>
              <label className="field">
                {t("My conversation notes", "Appunti della mia conversazione")}
                <textarea
                  aria-label={t(
                    "My conversation notes",
                    "Appunti della mia conversazione",
                  )}
                  lang="it"
                  maxLength={2000}
                  value={session.speaking}
                  onChange={(e) => {
                    setSelfChecked(false);
                    update((s) => ({ ...s, speaking: e.target.value }));
                  }}
                />
              </label>
              <label className="self-check">
                <input
                  type="checkbox"
                  checked={selfChecked}
                  onChange={(e) => setSelfChecked(e.target.checked)}
                />
                {t(
                  "I said it aloud and compared one phrase with the frame. This is my self-check.",
                  "L’ho detto ad alta voce e ho confrontato una frase con il modello. È la mia autoverifica.",
                )}
              </label>
              <button
                className="button primary"
                disabled={
                  session.speaking.trim().split(/\s+/).length < 3 ||
                  !selfChecked
                }
                onClick={() => finish("speak")}
              >
                {t("Save my speaking practice", "Salva la pratica orale")}
              </button>
              <p className="hint">
                {t(
                  "Saved as practice, with no automatic grammar or pronunciation grade.",
                  "Salvata come pratica, senza voto automatico di grammatica o pronuncia.",
                )}
              </p>
            </>
          )}
          {active === "exit" && (
            <>
              <p>
                {t(
                  "Cover the lesson. Write one Italian phrase you want to remember. Then compare it with the scene or frame and correct it. It will become a warm-up cue next time.",
                  "Copri la lezione. Scrivi una frase italiana che vuoi ricordare. Poi confrontala con la scena o il modello e correggila. Diventerà uno spunto per il prossimo riscaldamento.",
                )}
              </p>
              <label className="field">
                {t(
                  "My phrase for next time",
                  "La mia frase per la prossima volta",
                )}
                <textarea
                  aria-label={t(
                    "My phrase for next time",
                    "La mia frase per la prossima volta",
                  )}
                  lang="it"
                  maxLength={2000}
                  value={session.exit}
                  onChange={(e) =>
                    update((s) => ({ ...s, exit: e.target.value }))
                  }
                />
              </label>
              <button
                className="button primary"
                disabled={session.exit.trim().split(/\s+/).length < 3}
                onClick={() => finish("exit")}
              >
                {t("Save my memory trail", "Salva la mia traccia")}
              </button>
              {done.length === stages.length ? (
                <div className="session-celebration" role="status">
                  <strong>
                    ✦{" "}
                    {t(
                      "Daily explorer badge earned",
                      "Distintivo esploratore conquistato",
                    )}
                  </strong>
                  <p>
                    {t(
                      "Your session is complete. Your next topic will be ready tomorrow. If you chose a longer day, continue with the blocks on Today.",
                      "Sessione completata. Il prossimo tema ti aspetta domani. Se hai scelto un giorno più lungo, continua con le attività su Oggi.",
                    )}
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => go("today")}
                  >
                    {t("Back to today", "Torna a oggi")}
                  </button>
                </div>
              ) : (
                <p className="hint">
                  {t(
                    "Finish the other quests to earn today’s explorer badge. You can leave and resume at any point.",
                    "Completa le altre missioni per il distintivo esploratore di oggi. Puoi uscire e riprendere quando vuoi.",
                  )}
                </p>
              )}
            </>
          )}
        </section>
      </div>
      {!stages.includes("exit") && done.length === stages.length && (
        <div className="session-celebration" role="status">
          <strong>
            {t(
              "Session complete · well practised!",
              "Sessione completata · buona pratica!",
            )}
          </strong>
          <button className="button secondary" onClick={() => go("today")}>
            {t("Back to today", "Torna a oggi")}
          </button>
        </div>
      )}
      <Rewards p={p} t={t} />
    </div>
  );
}

export function VocabularyView({
  p,
  t,
  text,
  go,
  Audio,
}: Props & { Audio: Audio }) {
  const [selected, setSelected] = useState(banks[0].id);
  const [query, setQuery] = useState("");
  const bank = banks.find((b) => b.id === selected)!;
  const needle = query.trim().toLocaleLowerCase();
  const shown = banks.filter(
    (b) =>
      !needle ||
      text(b.title).toLocaleLowerCase().includes(needle) ||
      b.words.some((w) =>
        `${w.term.en} ${w.term.it}`.toLocaleLowerCase().includes(needle),
      ),
  );
  return (
    <div className="workspace">
      <p className="eyebrow">
        {t(
          "144 WORDS & USEFUL CHUNKS · A1 SUPPORT",
          "144 PAROLE ED ESPRESSIONI UTILI · AIUTO A1",
        )}
      </p>
      <h1>{t("Words you can use today.", "Parole da usare oggi.")}</h1>
      <p>
        {t(
          "Learn the article with the noun. Read the example, then change one detail. Choose one bank per day; the daily session saves which cards you practise.",
          "Impara l’articolo con il nome. Leggi l’esempio, poi cambia un dettaglio. Scegli un gruppo al giorno; la sessione quotidiana salva le carte che provi.",
        )}
      </p>
      <button className="text-button" onClick={() => go("session")}>
        {t(
          "Practise in my daily session",
          "Esercitati nella sessione quotidiana",
        )}{" "}
        →
      </button>
      <label className="field">
        {t(
          "Find an English or Italian word",
          "Cerca una parola inglese o italiana",
        )}
        <input
          type="search"
          value={query}
          onChange={(e) => {
            const value = e.target.value.toLocaleLowerCase();
            setQuery(e.target.value);
            const match = banks.find(
              (b) =>
                text(b.title).toLocaleLowerCase().includes(value) ||
                b.words.some((w) =>
                  `${w.term.en} ${w.term.it}`
                    .toLocaleLowerCase()
                    .includes(value),
                ),
            );
            if (match) setSelected(match.id);
          }}
        />
      </label>
      <div className="bank-choices">
        {shown.map((b) => (
          <button
            className="button secondary"
            aria-pressed={b.id === selected}
            key={b.id}
            onClick={() => setSelected(b.id)}
          >
            {text(b.title)}
          </button>
        ))}
      </div>
      {!shown.length && (
        <p role="status">
          {t(
            "No matching bank. Try another word.",
            "Nessun gruppo trovato. Prova un’altra parola.",
          )}
        </p>
      )}
      <div className="support-box">
        <button className="button primary" onClick={() => go("words")}>
          {t(
            "Save words in my personal bank",
            "Salva parole nel mio lessico personale",
          )}{" "}
          →
        </button>
        <p>
          {t(
            "Choose your own words and get spaced memory reviews.",
            "Scegli le tue parole e ripassale a intervalli.",
          )}
        </p>
      </div>
      <h2>{text(bank.title)}</h2>
      <WordCards key={bank.id} bank={bank} t={t} Audio={Audio} />
      <details>
        <summary>
          {t(
            "Open the full bank with examples",
            "Apri il gruppo completo con esempi",
          )}
        </summary>
        <div className="vocabulary-grid">
          {bank.words.map((w) => (
            <article className="panel" key={w.term.it}>
              <h3 lang="it">
                {w.term.it} <Audio phrase={w.term.it} t={t} />
              </h3>
              <p lang="en">{w.term.en}</p>
              <p lang="it">{w.example.it}</p>
              {p.translations && (
                <p className="hint" lang="en">
                  {w.example.en}
                </p>
              )}
            </article>
          ))}
        </div>
      </details>
    </div>
  );
}

function ResourceCard({
  resource: r,
  t,
  text,
}: {
  resource: OnlineResource;
  t: Translate;
  text: (p: Pair) => string;
}) {
  return (
    <article className="resource-card">
      <p className="eyebrow">
        {text(r.level)} · {text(r.kind)}
      </p>
      <h3>
        <a href={r.url} target="_blank" rel="noreferrer">
          {r.title} ↗
        </a>
      </h3>
      <p>{text(r.task)}</p>
      <small>
        {text(r.access)}{" "}
        {t("Opens in a new tab.", "Si apre in una nuova scheda.")}
      </small>
    </article>
  );
}
export function ResourceLibrary({ t, text }: Pick<Props, "t" | "text">) {
  return (
    <section className="resource-library">
      <p className="eyebrow">
        {t("CURATED FOR MID-A1", "SCELTE PER UN LIVELLO A1 INTERMEDIO")}
      </p>
      <h2>
        {t(
          "Good links. A small task for each.",
          "Link utili. Un piccolo compito per ciascuno.",
        )}
      </h2>
      <p>
        {t(
          "Choose one resource for a session, for about six minutes. Repeat a short section and use the transcript or subtitles when available. The original portal scenes are your fallback if a player is unavailable.",
          "Scegli una risorsa per sessione, per circa sei minuti. Ripeti una parte breve e usa trascrizioni o sottotitoli quando disponibili. Se un lettore non funziona, usa le scene originali del portale.",
        )}
      </p>
      <div className="resource-grid">
        {resources.map((r) => (
          <ResourceCard key={r.id} resource={r} t={t} text={text} />
        ))}
      </div>
      <details className="learning-method">
        <summary>
          {t(
            "Why this routine? Research and sources",
            "Perché questa routine? Ricerca e fonti",
          )}
        </summary>
        <p>
          {t(
            "Recall before revealing, compare with an example, and come back on another day. Spacing and retrieval are supported learning strategies. Short, supported exchanges fit A1 goals. This 30-minute mix and its points are our design choices, not a scientifically proven optimal schedule or CEFR assessment.",
            "Ricorda prima di scoprire, confronta con un esempio e torna un altro giorno. La pratica distribuita e il recupero dalla memoria sono strategie sostenute dalla ricerca. Scambi brevi e guidati sono adatti agli obiettivi A1. Questa combinazione di 30 minuti e i punti sono scelte del portale, non un programma ottimale dimostrato né una valutazione QCER.",
          )}
        </p>
        {data.research.map((r) => (
          <p key={r.url}>
            <a href={r.url} target="_blank" rel="noreferrer">
              {r.title} ↗
            </a>
          </p>
        ))}
        <p className="hint">
          {t("Links reviewed", "Link controllati")} {data.reviewedOn}
        </p>
      </details>
    </section>
  );
}
export function Rewards({ p, t }: Pick<Props, "p" | "t">) {
  const r = learningRewards(p);
  const titles = [
    t("First words", "Prime parole"),
    t("Memory comeback", "Ritorno della memoria"),
    t("Daily explorer", "Esploratore del giorno"),
    t("Seven adventures", "Sette avventure"),
  ];
  return (
    <section className="rewards">
      <h2>{t("Your practice passport", "Il tuo passaporto di pratica")}</h2>
      <p>
        {r.xp} XP · {t("Level", "Livello")} {r.level} · {r.completeDays}{" "}
        {t("full sessions", "sessioni complete")}
      </p>
      <div className="badge-row">
        {titles.map((title, i) => (
          <span className={r.badges[i] ? "earned" : ""} key={title}>
            {r.badges[i] ? "✦" : "◇"} {title} ·{" "}
            {r.badges[i]
              ? t("earned", "ottenuto")
              : t("to discover", "da scoprire")}
          </span>
        ))}
      </div>
      <p className="hint">
        {t(
          "10 XP per new core lesson · 3 per scheduled review · 5 per daily quest · 2 per new grammar exercise · 15 per completed grammar unit · 5 per companion page. Repeating a completed quest adds no extra points. Levels celebrate practice; they do not measure language level. No streak to lose.",
          "10 XP per nuova lezione base · 3 per ripasso programmato · 5 per missione quotidiana · 2 per nuovo esercizio di grammatica · 15 per unità di grammatica completata · 5 per pagina del compagno. Ripetere una missione completata non aggiunge punti. I livelli celebrano la pratica; non misurano il livello linguistico. Nessuna serie da perdere.",
        )}
      </p>
    </section>
  );
}

export function SessionNotebook({
  p,
  t,
  text,
  missions,
}: Pick<Props, "p" | "t" | "text"> & { missions: Mission[] }) {
  const entries = Object.entries(p.sessions ?? {}).sort(([a], [b]) =>
    b.localeCompare(a),
  );
  if (!entries.length) return null;
  return (
    <section className="session-notebook">
      <h2>{t("My daily conversations", "Le mie conversazioni quotidiane")}</h2>
      <p className="hint">
        {t(
          "Your latest 30 sessions. All sessions are included in your progress backup. Writing and speaking are self-checked.",
          "Le ultime 30 sessioni. Tutte le sessioni sono incluse nel backup dei progressi. Scrittura e conversazione sono autoverificate.",
        )}
      </p>
      {entries.slice(0, 30).map(([date, s]) => {
        const m = missions.find((m) => m.id === s.missionId);
        return (
          <details key={date}>
            <summary>
              {date} · {m ? text(m.title) : s.missionId} ·{" "}
              {sessionDone(p, date).length}/
              {sessionActivities(s.duration ?? 30).length}
            </summary>
            {[
              [t("My warm-up", "Il mio riscaldamento"), s.warmup],
              [t("My conversation", "La mia conversazione"), s.speaking],
              [t("My memory trail", "La mia traccia"), s.exit],
            ].map(
              ([label, value]) =>
                value.trim() && (
                  <div key={label}>
                    <h3>{label}</h3>
                    <blockquote lang="it">{value}</blockquote>
                  </div>
                ),
            )}
          </details>
        );
      })}
    </section>
  );
}
