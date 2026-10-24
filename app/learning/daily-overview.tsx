import { dailyStudyPlan, emptySession, learningRewards, sessionDone, sessionActivities } from "./study";
import { dailyMinutes } from "./engine";
import { planningUnits, planningProgrammes, planningPages } from "./planning-data";
import curriculum from "./curriculum.json";
import type { Mission, Pair, Progress } from "./types";
type Translate = (en: string, it: string) => string;
type Props = { p: Progress; t: Translate; text: (pair: Pair) => string; today: string; save: (fn: (p: Progress) => Progress) => void; go: (route: string) => void };

export function SessionPreview({
  p,
  t,
  text,
  today,
  save,
  go,
  missions,
}: Props & { missions: Mission[] }) {
  const plan = dailyStudyPlan(p, missions, planningUnits,
    planningProgrammes, planningPages, today);
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

export function DailyItinerary({ p, t, text, go, today }: Props) {
  const plan = dailyStudyPlan(p, curriculum.missions as Mission[], planningUnits, planningProgrammes,
    planningPages, today);
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

export function ArcadeEntry({ t, go }: Pick<Props, "t" | "go">) {
  return (
    <section className="arcade-entry">
      <div>
        <strong>{t("Fancy a little game?", "Ti va un piccolo gioco?")}</strong>
        <p>
          {t(
            "A few words, a sentence, a short conversation.",
            "Qualche parola, una frase, una breve conversazione.",
          )}
        </p>
      </div>
      <button className="button secondary" onClick={() => go("games")}>
        {t("Open games", "Apri i giochi")} →
      </button>
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
