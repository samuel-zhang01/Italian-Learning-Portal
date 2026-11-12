import { planningVocabularyCollectionCount } from "./planning-data";
import type { Progress } from "./types";
type Props = { p: Progress; today: string; t: (en: string, it: string) => string; go: (route: string) => void };
export function PracticeHub({ p, today, t, go }: Props) {
  const wordCount = planningVocabularyCollectionCount;
  const due = Object.values(p.vocabPractice?.records ?? {}).filter(record => record.due <= today && record.date !== today).length;
  return <div className="workspace practice-hub">
    <h1>{t("What shall we practise?", "Che cosa alleniamo?")}</h1>
    <p>{t("One small round. Pick the skill you need today.", "Un piccolo giro. Scegli cosa allenare oggi.")}</p>
    <div className="practice-hub-grid">
      <section className="panel practice-hub-card vocabulary-hub-card">
        <span className="eyebrow">{t("PLAY, COLLECT & REMEMBER", "GIOCA, COLLEZIONA E RICORDA")}</span>
        <h2>{t("Word Quest · vocabulary", "Avventura lessicale · vocabolario")}</h2>
        <p>{t(`Explore ${wordCount} words and phrases. Try short challenges, earn practice badges and build your word collection.`, `Esplora ${wordCount} parole ed espressioni. Prova brevi sfide, ottieni medaglie di pratica e crea la tua collezione di parole.`)}</p>
        <div className="practice-hub-actions">
        <button className="button primary" onClick={() => go("vocab-boost")}>{p.vocabPractice?.active ? t("Continue my challenge", "Continua la mia sfida") : t(`Type ${p.vocabPractice?.settings.size ?? 5} words`, `Scrivi ${p.vocabPractice?.settings.size ?? 5} parole`)} →</button>
        <button className="text-button" onClick={() => go("vocab-boost?view=library")}>{t("Explore every word", "Esplora tutte le parole")} →</button>
        </div>
        {due > 0 && <span className="hint">{t(`${due} words ready for review`, `${due} parole da ripassare`)}</span>}
      </section>
      <section className="panel practice-hub-card">
        <span className="eyebrow">{t("PRESENT & PAST", "PRESENTE E PASSATO")}</span>
        <h2>{t("Verb practice", "Pratica dei verbi")}</h2>
        <p>{t("Practise one person at a time. Start with the present, then try passato prossimo.", "Allena una persona alla volta. Inizia dal presente, poi prova il passato prossimo.")}</p>
        <div className="practice-hub-actions">
        <button className="button secondary" onClick={() => go("games?mode=verbs")}>{t("Practise verbs", "Allena i verbi")} →</button>
        </div>
      </section>
      <section className="panel practice-hub-card">
        <span className="eyebrow">{t("UNDERSTAND & USE", "CAPISCI E USA")}</span>
        <h2>{t("Grammar lab", "Laboratorio di grammatica")}</h2>
        <p>{t("Short explanations, worked examples and supported exercises from A1 to A2.", "Brevi spiegazioni, esempi svolti ed esercizi guidati da A1 ad A2.")}</p>
        <div className="practice-hub-actions">
        <button className="button secondary" onClick={() => go("grammar")}>{t("Open grammar", "Apri grammatica")} →</button>
        </div>
      </section>
    </div>
    <nav className="practice-related" aria-label={t("Continue your practice", "Continua la pratica")}>
      <button className="text-button" onClick={() => go("words")}>{t("My saved words", "Le mie parole salvate")}</button>
      <button className="text-button" onClick={() => go("reviews")}>{t("Due reviews", "Ripassi del giorno")}</button>
      <button className="text-button" onClick={() => go("games")}>{t("Other games", "Altri giochi")}</button>
      <button className="text-button" onClick={() => go("today")}>{t("Back to today’s lesson", "Torna alla lezione di oggi")}</button>
    </nav>
  </div>;
}
