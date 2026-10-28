import { useEffect, useRef, useState } from "react";
import { planningReviewCatalogue } from "./planning-data";
import { catalogueParams, focusStudyHeading, replaceCatalogueParams } from "./navigation";
import { reviewBudget, selectReviewQueue, type ReviewKind, type ReviewReason } from "./review-queue";
import type { Pair, Progress } from "./types";
import "./review-hub.css";

type Props = {
  p: Progress;
  t: (en: string, it: string) => string;
  text: (pair: Pair) => string;
  go: (route: string) => void;
  today: string;
};
const names: Record<ReviewKind, Pair> = {
  lesson: { en: "Short lessons", it: "Lezioni brevi" },
  grammar: { en: "Grammar recall", it: "Richiamo di grammatica" },
  word: { en: "Personal word memory", it: "Memoria del lessico personale" },
  arcade: { en: "Game practice", it: "Pratica con i giochi" },
  vocab: { en: "Typed vocabulary", it: "Lessico scritto" },
};
const reasons: Record<ReviewReason, Pair> = {
  mistake: { en: "An earlier attempt needed repair", it: "Un tentativo precedente richiedeva una correzione" },
  supported: { en: "Recall after using support", it: "Richiamo dopo aver usato un aiuto" },
  scheduled: { en: "Scheduled recall", it: "Ripasso programmato" },
  saved: { en: "First personal recall of a saved word", it: "Primo richiamo personale di una parola salvata" },
};

export function ReviewHub({ p, t, text, go, today }: Props) {
  const [minutes, setMinutes] = useState(() => reviewBudget(Number(catalogueParams().get("minutes") ?? 5)));
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => focusStudyHeading(heading.current), []);
  const queue = selectReviewQueue(p, planningReviewCatalogue, today, minutes);
  const first = queue.items[0];
  return (
    <div className="workspace review-hub">
      <div className="review-hub-intro">
        <p className="eyebrow">{t("A SMALL RETURN TO WHAT YOU HAVE PRACTISED", "UN PICCOLO RITORNO A CIÒ CHE HAI ESERCITATO")}</p>
        <h1 ref={heading} tabIndex={-1}>{t("Your next recall.", "Il tuo prossimo ripasso.")}</h1>
        <p>{t("A short plan from your saved attempts and due dates. Earlier mistakes come first. Each item opens its own practice; choosing a plan does not change your answers, points or review dates.", "Un breve piano dai tentativi salvati e dalle date di ripasso. Gli errori precedenti hanno la precedenza. Ogni voce apre la propria pratica: scegliere un piano non cambia risposte, punti o date di ripasso.")}</p>
      </div>
      <div className="review-hub-controls">
        <fieldset>
          <legend>{t("How much time do you have?", "Quanto tempo hai?")}</legend>
          <div className="review-budget-options">
            {([2, 5, 10] as const).map((value) => <button key={value} type="button" className="button secondary" aria-pressed={minutes === value} onClick={() => {
              setMinutes(value); replaceCatalogueParams({ minutes: String(value) });
            }}>{value} min</button>)}
          </div>
        </fieldset>
        <p className="review-queue-status" role="status">{queue.totalDue} {(queue.totalDue === 1 ? t("due item", "voce da ripassare") : t("due items", "voci da ripassare"))} · {queue.items.length} {t("in this plan", "in questo piano")}</p>
      </div>
      {first ? <>
        <section className="review-next" aria-label={t("Start your next recall", "Inizia il prossimo ripasso")}>
          <div>
            <p className="eyebrow">{t("START HERE", "INIZIA QUI")}</p>
            <h2 lang={first.cueLanguage}>{text(first.title)}</h2>
            <p>{text(reasons[first.reason])}</p>
          </div>
          <button className="button primary" onClick={() => go(first.route)}>{t("Start this review", "Inizia questo ripasso")} →</button>
        </section>
        <p className="review-estimate">{t(`Up to ${minutes} minutes of suggested practice. Time is an estimate; pause whenever you need.`, `Fino a ${minutes} minuti di pratica suggerita. Il tempo è una stima: fermati quando serve.`)} {queue.remainingCount > 0 && t(`${queue.remainingCount} more due items can wait for another sitting.`, `Altre ${queue.remainingCount} voci possono aspettare un altro momento.`)}</p>
        {queue.groups.map((group) => <section className="review-group" key={group.kind}>
          <h2>{text(names[group.kind])} <small>{group.items.length}</small></h2>
          <ol>
            {group.items.map((item) => <li key={item.id} className="review-item">
              <div>
                {item.cueLanguage === "en" && <p className="review-cue-label">{t("English cue · recall the Italian", "Spunto inglese · ricorda l’italiano")}</p>}
                <h3 lang={item.cueLanguage}>{text(item.title)}</h3>
                <p>{text(reasons[item.reason])}</p>
                <div className="review-item-meta">
                  <span>{item.overdueDays > 0 ? t(`${item.overdueDays} days overdue`, `In ritardo di ${item.overdueDays} giorni`) : t("Due today", "Da ripassare oggi")}</span>
                  {item.evidenceDate && <span>{t("Evidence from", "Tentativo del")} {item.evidenceDate}</span>}
                  {item.supportUsed && <span>{t("Support recorded", "Aiuto registrato")}</span>}
                </div>
                {item.kind === "arcade" && p.arcade?.active && <p className="review-active-note">{t("Your unfinished game stays saved. This review will be ready after that round.", "Il gioco incompleto resta salvato. Questo ripasso sarà disponibile dopo quel giro.")}</p>}
                {item.kind === "vocab" && p.vocabPractice?.active && <p className="review-active-note">{t("Your vocabulary round stays saved. Finish it before this scheduled word.", "Il giro di lessico resta salvato. Completalo prima di questa parola programmata.")}</p>}
              </div>
              <button className="button secondary" onClick={() => go(item.route)}>{t("Open practice", "Apri la pratica")} →</button>
            </li>)}
          </ol>
        </section>)}
      </> : <section className="review-empty">
        <h2>{t("Nothing is due from your saved practice.", "Nessun ripasso in scadenza dalla pratica salvata.")}</h2>
        <p>{t("Practise a topic or save a word you want to remember. Its recorded attempts and review dates can bring it here later. An empty queue does not assess your language level.", "Esercita un argomento o salva una parola che vuoi ricordare. I tentativi e le date di ripasso potranno riportarli qui. Una coda vuota non valuta il tuo livello linguistico.")}</p>
        <button className="button primary" onClick={() => go("discover")}>{t("Find a topic to practise", "Trova un argomento da esercitare")} →</button>
      </section>}
      <p className="review-hub-note">{t("Personal word recall is self-assessed. Corrections and supported answers keep their original first-attempt evidence. Use your browser’s Back button to return to this time choice.", "Il richiamo del lessico personale è autovalutato. Correzioni e risposte aiutate conservano la prova del primo tentativo. Usa Indietro nel browser per tornare a questa scelta di tempo.")}</p>
    </div>
  );
}
