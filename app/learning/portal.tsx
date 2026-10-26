"use client";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import curriculum from "./curriculum.json";
import { planningSources, planningReviewCatalogue } from "./planning-data";
import { selectReviewQueue } from "./review-queue";
import { coreRecallFeedback, firstCoreRecallToday, type LocalRecallAttempt } from "./review-evidence";
import { createLocalPdfStore, localPdfPageHref, type LocalPdfResult } from "./local-pdfs";
import { LearningRouteBoundary } from "./lazy-boundary";
import { ArcadeEntry, DailyItinerary, Rewards, SessionNotebook, SessionPreview } from "./daily-overview";
import {
  STORAGE_KEY,
  addDays,
  completeMission,
  dailyMinutes,
  dayKey,
  dueReviews,
  emptyDraft,
  emptyProgress,
  isCorrect,
  nextMission,
  parseProgress,
  recordReview,
  schedule,
} from "./engine";
import type { Draft, Mission, Pair, Progress, Source } from "./types";
import "./academy.css";
import "./arcade.css";
import "./practice-tools.css";
import "./portal.css";
import "./paper-cutout.css";
import "./responsive.css";

const DiscoveryView = lazy(() => import("./discovery").then((module) => ({ default: module.DiscoveryView })));
const GrammarLab = lazy(() => import("./academy").then((module) => ({ default: module.GrammarLab })));
const ProgrammeView = lazy(() => import("./academy").then((module) => ({ default: module.ProgrammeView })));
const CompanionView = lazy(() => import("./academy").then((module) => ({ default: module.CompanionView })));
const PracticeArcade = lazy(() => import("./arcade").then((module) => ({ default: module.PracticeArcade })));
const AssessmentView = lazy(() => import("./practice-tools").then((module) => ({ default: module.AssessmentView })));
const PersonalWords = lazy(() => import("./practice-tools").then((module) => ({ default: module.PersonalWords })));
const DailySession = lazy(() => import("./enriched").then((module) => ({ default: module.DailySession })));
const ResourceLibrary = lazy(() => import("./enriched").then((module) => ({ default: module.ResourceLibrary })));
const VocabularyView = lazy(() => import("./enriched").then((module) => ({ default: module.VocabularyView })));
const ChapterDashboard = lazy(() => import("./chapters").then((module) => ({ default: module.ChapterDashboard })));
const BackupTransfer = lazy(() => import("./backup-transfer").then(module => ({ default: module.BackupTransfer })));
const OfflineStudy = lazy(() => import("./offline").then(module => ({ default: module.OfflineStudy })));
const A2DiagnosticView = lazy(() => import("./learning-insights").then(module => ({ default: module.A2DiagnosticView })));
const WeeklyLearningReport = lazy(() => import("./learning-insights").then(module => ({ default: module.WeeklyLearningReport })));
const ListeningView = lazy(() => import("./listening").then(module => ({ default: module.ListeningView })));
const OralPracticeView = lazy(() => import("./oral-practice").then(module => ({ default: module.OralPracticeView })));
const ReviewHub = lazy(() => import("./review-hub").then((module) => ({ default: module.ReviewHub })));

const missions = curriculum.missions as Mission[];
const sources = Array.from(
  new Map(
    [
      ...(curriculum.sources as Source[]),
      ...(planningSources as Source[]),
    ].map((s) => [s.id, s]),
  ).values(),
);
const ids = missions.map((m) => m.id);
type Translate = (en: string, it: string) => string;
const courseName = (course: number, t: Translate) =>
  [
    "",
    t("Foundations", "Fondamenta"),
    t("Everyday Italian", "Italiano quotidiano"),
    t("Back to class · Level 2", "Ritorno in classe · Livello 2"),
  ][course];
const initialRoute = () =>
  typeof window === "undefined"
    ? "today"
    : window.location.hash.slice(1) || "today";
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    book: (
      <>
        <path d="M12 5v16M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M7 3v4m10-4v4M3 11h18m-14 4h2m4 0h2m-8 3h2" />
      </>
    ),
    chart: (
      <>
        <path d="M4 20V4m0 16h17M8 16v-4m5 4V8m5 8V4" />
      </>
    ),
    folder: (
      <path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    ),
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    sound: (
      <>
        <path d="m3 9 4 0 5-4v14l-5-4H3Z" />
        <path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7a9 9 0 1 0 1 8M20 2v6h-6" />
      </>
    ),
    back: <path d="M20 12H4m6-6-6 6 6 6" />,
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.book}
    </svg>
  );
}

export default function Portal() {
  const [p, setP] = useState<Progress>(emptyProgress);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [route, setRoute] = useState("today");
  const routePath = route.split("?")[0];
  const [notice, setNotice] = useState("");
  const [pdfs, setPdfs] = useState<Record<string, string>>({});
  const [pdfPageOffsets, setPdfPageOffsets] = useState<Record<string, number>>({});
  const [pdfStore] = useState(() => createLocalPdfStore(sources));
  const [pdfResults, setPdfResults] = useState<LocalPdfResult[]>([]);
  const [pdfStatus, setPdfStatus] = useState<Pair | null>(null);
  const [checkingPdfs, setCheckingPdfs] = useState(false);
  const [today, setToday] = useState(dayKey);
  const heading = useRef<HTMLElement>(null);
  const toolsMenu = useRef<HTMLDetailsElement>(null);
  const current = useRef(p);
  const pdfOperation = useRef(0);
  const t: Translate = (en, it) => (p.language === "en" ? en : it);
  const text = (x: Pair) => x[p.language];
  // Browser storage is hydrated after SSR; rendering a loading state prevents overwriting saved work.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoute(initialRoute());
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const saved = parseProgress(raw, ids);
          setP(saved);
          current.current = saved;
        } catch {
          setLoadError(true);
        }
      }
    } catch {
      setStorageError(true);
    }
    setReady(true);
    const routeChange = () => {
      setRoute(initialRoute());
      setNotice("");
    };
    const sync = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      try {
        const s = e.newValue ? parseProgress(e.newValue, ids) : emptyProgress();
        current.current = s;
        setP(s);
      } catch {
        setLoadError(true);
      }
    };
    const clock = window.setInterval(() => setToday(dayKey()), 30000);
    window.addEventListener("hashchange", routeChange);
    window.addEventListener("storage", sync);
    return () => {
      clearInterval(clock);
      window.removeEventListener("hashchange", routeChange);
      window.removeEventListener("storage", sync);
      pdfOperation.current += 1;
      pdfStore.clear();
    };
  }, [pdfStore]);
  useEffect(() => {
    document.documentElement.lang = p.language;
    document.title =
      p.language === "it"
        ? "Parliamo — Un po’ d’italiano, ogni giorno"
        : "Parliamo — A little Italian, every day";
  }, [p.language]);
  useEffect(() => {
    if (!["grammar", "companion", "discover", "chapters", "reviews"].includes(routePath.split("/")[0])) {
      heading.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    }
    if (toolsMenu.current) toolsMenu.current.open = false;
    window.speechSynthesis?.cancel();
  }, [route, routePath]);
  function save(update: (state: Progress) => Progress) {
    if (loadError) return;
    let base = current.current;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw && !storageError) {
        const stored = parseProgress(raw, ids);
        if (stored.updatedAt >= base.updatedAt) base = stored;
      }
    } catch {
      /* Keep the working session if storage is unavailable. */
    }
    const next = { ...update(base), updatedAt: new Date().toISOString() };
    current.current = next;
    setP(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
  const go = (target: string) => {
    if (target === initialRoute()) {
      heading.current?.focus();
      return;
    }
    window.location.hash = target;
  };
  const due = dueReviews(p, today);
  const reviewQueue = selectReviewQueue(p, planningReviewCatalogue, today, 5);
  const next = nextMission(p, missions);
  const completed = Object.keys(p.completed).length;
  const minutes = dailyMinutes(p, today);
  const selected = missions.find((m) => m.id === routePath.split("/")[1]);
  const nav = [
    ["today", "sun", t("Today", "Oggi")],
    ["programmes", "calendar", t("Programme", "Percorso")],
    ["grammar", "book", t("Practice", "Pratica")],
    ["discover", "search", t("Find", "Cerca")],
    ["progress", "chart", t("Progress", "Progressi")],
  ];
  function exportProgress() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(current.current, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `parliamo-${dayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(
      t("Progress backup downloaded.", "Backup dei progressi scaricato."),
    );
  }
  async function attachPdfs(files: FileList | null) {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    const operation = ++pdfOperation.current;
    setCheckingPdfs(true);
    setPdfResults([]);
    setPdfStatus(null);
    const results: LocalPdfResult[] = [];
    for (const file of selectedFiles) {
      const result = await pdfStore.connect(file);
      if (operation !== pdfOperation.current || result.status === "cancelled") return;
      results.push(result);
      setPdfs(pdfStore.snapshot());
      setPdfPageOffsets(pdfStore.offsets());
    }
    setPdfResults(results);
    setCheckingPdfs(false);
  }
  function disconnectPdf(sourceId: string) {
    pdfOperation.current += 1;
    pdfStore.disconnect(sourceId);
    setPdfs(pdfStore.snapshot());
    setPdfPageOffsets(pdfStore.offsets());
    setPdfResults([]);
    setCheckingPdfs(false);
    setPdfStatus({ en: "PDF disconnected for this tab.", it: "PDF scollegato per questa scheda." });
  }
  const shared = { p, t, text, save, go, today, pdfs, pdfPageOffsets };
  if (!ready)
    return (
      <div className="daily-app">
        <div className="loading">
          Parliamo<span>Un momento… / One moment…</span>
        </div>
      </div>
    );
  return (
    <div className="daily-app">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          heading.current?.focus();
        }}
      >
        {t("Skip to content", "Vai al contenuto")}
      </a>
      <header className="daily-header">
        <button
          className="wordmark"
          onClick={() => go("today")}
          aria-label={t("Parliamo home", "Pagina iniziale di Parliamo")}
        >
          <span className="brand-disc">p.</span>
          <span>
            parliamo<span className="brand-dot">.</span>
            <small>
              {t(
                "A LITTLE ITALIAN, EVERY DAY",
                "UN PO’ D’ITALIANO, OGNI GIORNO",
              )}
            </small>
          </span>
        </button>
        <nav aria-label={t("Main navigation", "Navigazione principale")}>
          {nav.map(([id, icon, label]) => (
            <button
              key={id}
              onClick={() => go(id)}
                aria-current={(routePath === id || (id === "today" && routePath === "session") || (id === "progress" && routePath === "weekly") || (id === "programmes" && routePath.split("/")[0] === "chapters") || (id === "grammar" && ["grammar", "games", "vocabulary", "words", "tense", "readiness", "reviews", "diagnostics", "listening", "listen-speak"].includes(routePath.split("/")[0]))) ? "page" : undefined}
            >
              <Icon name={icon} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="lang-switch" aria-label="Language / Lingua">
          <button
            lang="en"
            aria-pressed={p.language === "en"}
            onClick={() => save((s) => ({ ...s, language: "en" }))}
          >
            EN
          </button>
          <button
            lang="it"
            aria-pressed={p.language === "it"}
            onClick={() => save((s) => ({ ...s, language: "it" }))}
          >
            IT
          </button>
        </div>
      </header>
      {loadError && (
        <div className="global-warning" role="alert">
          {t(
            "Your saved progress could not be read. It has not been overwritten. Export the stored file for recovery, or restore a valid backup in Progress.",
            "Non è stato possibile leggere i progressi salvati. Non sono stati sovrascritti. Esporta il file originale per recuperarlo oppure ripristina un backup valido in Progress.",
          )}{" "}
          <button
            onClick={() => {
              try {
                const raw = localStorage.getItem(STORAGE_KEY) || "{}";
                const u = URL.createObjectURL(
                  new Blob([raw], { type: "application/json" }),
                );
                const a = document.createElement("a");
                a.href = u;
                a.download = "parliamo-recovery.json";
                a.click();
                setTimeout(() => URL.revokeObjectURL(u), 1000);
              } catch {
                setNotice(
                  t(
                    "Storage is unavailable.",
                    "L’archiviazione non è disponibile.",
                  ),
                );
              }
            }}
          >
            {t("Export stored file", "Esporta file originale")}
          </button>
          <button onClick={() => go("progress")}>
            {t("Open recovery", "Apri recupero")}
          </button>
        </div>
      )}
      {storageError && (
        <div className="global-warning" role="alert">
          {t(
            "Browser storage is unavailable. Progress is only in this open tab. Export a backup before leaving.",
            "L’archiviazione del browser non è disponibile. I progressi restano solo in questa scheda aperta. Esporta un backup prima di uscire.",
          )}{" "}
          <button onClick={exportProgress}>
            {t("Export progress", "Esporta progressi")}
          </button>
        </div>
      )}
      <main id="main-content" ref={heading} tabIndex={-1}>
        <details key="practice-tools-menu" ref={toolsMenu} className="practice-menu">
          <summary>{t("More practice & materials", "Altra pratica e materiali")}</summary>
          <nav
            className="study-tools-nav"
            aria-label={t("Study tools", "Strumenti di studio")}
          >
            {[
              ["chapters", t("Book chapters", "Capitoli dei libri")],
              ["diagnostics", t("A2 chapter checks", "Controlli dei capitoli A2")],
              ["listening", t("Private listening", "Ascolto personale")],
              ["listen-speak", t("Short listening & speaking", "Ascolto e parlato brevi")],
              ["weekly", t("Weekly learning report", "Resoconto settimanale")],
              ["offline", t("Offline study", "Studio offline")],
              ["reviews", t("Review queue", "Ripasso del giorno")],
              ["games", t("Games", "Giochi")],
              ["grammar", t("Grammar lab", "Grammatica")],
              ["vocabulary", t("Vocabulary cards", "Carte lessico")],
              ["path", t("Class lessons", "Lezioni del corso")],
              ["materials", t("Materials & links", "Materiali e link")],
              ["plan", t("Time & settings", "Tempo e impostazioni")],
              ["companion", t("Page companions", "Compagni delle pagine")],
              ["words", t("My word bank", "Il mio lessico")],
              ["readiness", t("A2 preparation", "Preparazione A2")],
              ["tense", t("Tense checks", "Controlli dei tempi")],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-current={routePath.split("/")[0] === id ? "page" : undefined}
                onClick={() => go(id)}
              >
                {label}
              </button>
            ))}
          </nav>
        </details>
        <LearningRouteBoundary key={routePath} t={t}>
        <Suspense fallback={<section className="workspace" role="status" aria-live="polite"><p>{t("Opening your practice…", "Apertura della pratica…")}</p></section>}>
        {routePath === "offline" && <OfflineStudy t={t} />}
        {routePath === "diagnostics" && <A2DiagnosticView key={route} {...shared} />}
        {routePath === "weekly" && <WeeklyLearningReport {...shared} />}
        {routePath === "listening" && <ListeningView {...shared} />}
        {routePath === "listen-speak" && <OralPracticeView key={route} {...shared} />}
        {routePath === "discover" && <DiscoveryView key={route} {...shared} />}
        {(routePath === "chapters" || routePath.startsWith("chapters/")) && <ChapterDashboard key={route} {...shared} chapterId={routePath.split("/")[1]} />}
        {routePath === "reviews" && <ReviewHub key={route} {...shared} />}
        {routePath === "today" && (
          <div className="workspace today-workspace">
            <div className="today-intro">
              <p className="eyebrow">
                {new Date(today + "T12:00:00").toLocaleDateString(
                  p.language === "it" ? "it-IT" : "en-GB",
                  { weekday: "long", day: "numeric", month: "long" },
                )}
              </p>
              <h1>{t("A little Italian, today.", "Un po’ d’italiano, oggi.")}</h1>
            </div>
            {(today < p.plan.start || !p.plan.days.includes(new Date(today + "T12:00:00").getDay())) && (
              <p className="rest-day-note">
                {t("Today is outside your planned study days. Any practice is optional.",
                  "Oggi non è un giorno di studio previsto. La pratica è facoltativa.")}
              </p>
            )}
            <SessionPreview {...shared} missions={missions} />
            <p className="today-oral-link"><button className="text-button" onClick={() => go("listen-speak?minutes=5")}>{t("Prefer a short listening & speaking session? · 5 or 10 minutes", "Preferisci una breve sessione di ascolto e parlato? · 5 o 10 minuti")} →</button></p>
            {reviewQueue.totalDue > 0 && <p className="today-review-link"><button className="text-button" onClick={() => go("reviews?minutes=5")}>{t(`${reviewQueue.totalDue} reviews ready · choose a short optional session`, `${reviewQueue.totalDue} ripassi pronti · scegli una breve sessione facoltativa`)} →</button></p>}
            <p className="today-chapter-link"><button className="text-button" onClick={() => go("chapters")}>{t("Explore the twenty book chapters", "Esplora i venti capitoli dei libri")} →</button></p>
            <details className="today-disclosure">
              <summary>{t("Today’s checklist", "Le attività di oggi")}</summary>
              <DailyItinerary {...shared} />
            </details>
            <details className="today-disclosure today-options">
              <summary>{t("Optional practice · games, reviews & short lessons", "Pratica facoltativa · giochi, ripassi e brevi lezioni")}</summary>
              <ArcadeEntry {...shared} />
              <div className="optional-practice-links">
                <button className="button secondary" onClick={() => go("reviews")}>{t("Review across my practice", "Ripassa tutte le attività")} →</button>
                <button className="button secondary" disabled={!due.length} onClick={() => go(`review/${due[0]}`)}>
                  {due.length ? t(`Review ${due.length} due lessons`, `Ripassa ${due.length} lezioni`) : t("No lesson reviews due", "Nessun ripasso in scadenza")}
                </button>
                <button className="button secondary" onClick={() => go(next ? `lesson/${next.id}` : "path")}>
                  {t("Choose a 5-minute class lesson", "Scegli una lezione di 5 minuti")}
                </button>
                <button className="text-button" onClick={() => go("vocabulary")}>
                  {t("Vocabulary cards", "Carte lessico")} →
                </button>
              </div>
            </details>
            <details className="today-disclosure">
              <summary>{t("This week & my progress", "Questa settimana e i progressi")}</summary>
              <WeekStrip {...shared} />
              <button className="text-button" onClick={() => go("weekly")}>{t("Read my weekly learning report", "Leggi il resoconto settimanale")} →</button>
              <p>{minutes}/{p.plan.minutes} {t("estimated minutes today", "minuti stimati oggi")} · {completed}/{missions.length} {t("lessons complete", "lezioni completate")}</p>
              <button className="text-button" onClick={() => go("progress")}>{t("Open my progress", "Apri i progressi")} →</button>
            </details>
          </div>
        )}
        {(routePath === "grammar" || routePath.startsWith("grammar/")) && (
          <GrammarLab key={route} {...shared} unitId={routePath.split("/")[1]} />
        )}
        {routePath === "programmes" && <ProgrammeView {...shared} />}
        {(routePath === "companion" || routePath.startsWith("companion/")) && (
          <CompanionView key={route} {...shared} pageId={routePath.split("/")[1]} />
        )}
        {routePath === "readiness" && (
          <AssessmentView key="readiness" {...shared} />
        )}
        {routePath === "tense" && (
          <AssessmentView key="tense" {...shared} mode="tense" />
        )}
        {routePath === "words" && <PersonalWords key={route} {...shared} />}
        {(routePath === "games" || routePath.startsWith("games/")) && <PracticeArcade key={route} {...shared} sceneId={routePath.split("/")[1]} />}
        {routePath === "path" && <PathView {...shared} />}
        {routePath === "session" && (
          <DailySession
            key={today}
            {...shared}
            missions={missions}
            Audio={Listen}
          />
        )}
        {(routePath === "vocabulary" || routePath.startsWith("vocabulary/")) && (
          <VocabularyView key={route} {...shared} Audio={Listen} bankId={routePath.split("/")[1]} />
        )}
        {routePath === "plan" && <PlanView {...shared} />}
        {routePath === "progress" && (
          <ProgressView
            {...shared}
            exportProgress={exportProgress}
            loadError={loadError}
            restore={(s) => {
              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
                current.current = s;
                setP(s);
                setLoadError(false);
                setStorageError(false);
                return true;
              } catch {
                return false;
              }
            }}
          />
        )}
        {routePath === "materials" && (
          <Materials {...shared} attachPdfs={attachPdfs} disconnectPdf={disconnectPdf} pdfResults={pdfResults} pdfStatus={pdfStatus} checkingPdfs={checkingPdfs} />
        )}
        {routePath.startsWith("lesson/") && selected && (
          <LessonView key={selected.id} {...shared} m={selected} />
        )}
        {routePath.startsWith("review/") && selected && (
          <ReviewView key={selected.id} {...shared} m={selected} />
        )}
        {![
          "today",
          "offline",
          "diagnostics",
          "weekly",
          "listening",
          "listen-speak",
          "discover",
          "chapters",
          "reviews",
          "session",
          "vocabulary",
          "path",
          "plan",
          "progress",
          "materials",
          "grammar",
          "programmes",
          "companion",
          "readiness",
          "tense",
          "words",
          "games",
        ].includes(routePath) &&
          !(
            (routePath.startsWith("lesson/") || routePath.startsWith("review/")) &&
            selected
          ) &&
          !routePath.startsWith("grammar/") &&
          !routePath.startsWith("companion/") &&
          !routePath.startsWith("vocabulary/") &&
          !routePath.startsWith("games/") &&
          !routePath.startsWith("chapters/") && (
            <div className="workspace">
              <h1>
                {t("Let’s find your next step", "Troviamo il prossimo passo")}
              </h1>
              <button className="button primary" onClick={() => go("today")}>
                {t("Back to today", "Torna a oggi")}
              </button>
            </div>
          )}
        </Suspense>
        </LearningRouteBoundary>
      </main>
      <div className="notice" role="status">
        {notice}
      </div>
      <footer className="daily-footer">
        <span>
          parliamo.{" "}
          <span>
            {t(
              "Little by little, it becomes yours.",
              "Poco a poco, diventa tuo.",
            )}
          </span>
        </span>
        <button onClick={() => go("progress")}>
          <span
            className={
              storageError || loadError ? "status-dot warning" : "status-dot"
            }
          />
          {storageError || loadError
            ? t("Check progress storage", "Controlla il salvataggio")
            : t(
                "Progress saved on this device",
                "Progressi salvati su questo dispositivo",
              )}
        </button>
      </footer>
    </div>
  );
}
type Shared = {
  p: Progress;
  t: Translate;
  text: (x: Pair) => string;
  save: (fn: (p: Progress) => Progress) => void;
  go: (route: string) => void;
  today: string;
};
function WeekStrip({ p, t, today }: Shared) {
  const start = new Date(today + "T12:00:00");
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return (
    <div className="week-strip">
      <div>
        <Icon name="calendar" />
        <strong>{t("This week", "Questa settimana")}</strong>
        <small>{t("Small steps count.", "Ogni piccolo passo conta.")}</small>
      </div>
      <div className="week-days">
        {Array.from({ length: 7 }, (_, i) => {
          const date = addDays(dayKey(start), i);
          const active = p.plan.days.includes(
            new Date(date + "T12:00:00").getDay(),
          );
          const done = dailyMinutes(p, date) >= p.plan.minutes;
          return (
            <div
              key={date}
              className={`${date === today ? "is-today" : ""} ${done ? "is-done" : ""}`}
              aria-label={`${date}: ${done ? t("goal complete", "obiettivo completato") : active ? t("study day", "giorno di studio") : t("rest day", "giorno di pausa")}`}
            >
              <span>
                {new Date(date + "T12:00:00").toLocaleDateString(
                  p.language === "it" ? "it-IT" : "en-GB",
                  { weekday: "short" },
                )}
              </span>
              <b>{done ? "✓" : new Date(date + "T12:00:00").getDate()}</b>
              <i>{date === today ? t("today", "oggi") : active ? "•" : "–"}</i>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function PageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-intro compact">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
function PathView({ p, t, text, go }: Shared) {
  const [filter, setFilter] = useState(p.plan.course);
  const [query, setQuery] = useState("");
  const list = missions.filter(
    (m) =>
      (!filter || m.course === filter) &&
      `${m.title.en} ${m.title.it} ${m.goal.en} ${m.goal.it}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="workspace">
      <PageIntro
        eyebrow={t("YOUR LEARNING PATH", "IL TUO PERCORSO")}
        title={t(
          "Small steps. Real conversations.",
          "Piccoli passi. Conversazioni vere.",
        )}
        description={t(
          "Start at the beginning or choose the topic you need for class. Every lesson is open.",
          "Inizia dall’inizio oppure scegli l’argomento utile per il corso. Ogni lezione è disponibile.",
        )}
      />
      <div className="path-toolbar">
        <div className="filter-tabs">
          {[1, 2, 3, 0].map((c) => (
            <button
              key={c}
              aria-pressed={filter === c}
              onClick={() => setFilter(c)}
            >
              {c ? courseName(c, t) : t("All lessons", "Tutte le lezioni")}
            </button>
          ))}
        </div>
        <label className="search-label">
          <span className="sr-only">
            {t("Search lessons", "Cerca lezioni")}
          </span>
          <input
            type="search"
            placeholder={t("Find a topic…", "Trova un argomento…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {filter === 3 && (
        <p className="info-line">
          {t(
            "Based on the two supplied Level 2 revision lessons. This is a bridge into the course, not a complete A2 syllabus.",
            "Basato sulle due lezioni di ripasso del Livello 2 disponibili. È un ponte verso il corso, non un programma A2 completo.",
          )}
        </p>
      )}
      <div className="lesson-grid">
        {list.map((m) => (
          <button
            className={`lesson-tile ${p.completed[m.id] ? "completed" : ""}`}
            key={m.id}
            onClick={() => go(`lesson/${m.id}`)}
          >
            <div className="tile-top">
              <span className="lesson-number">
                {String(missions.indexOf(m) + 1).padStart(2, "0")}
              </span>
              <span className="tag">
                {p.completed[m.id]
                  ? t("Completed", "Completata")
                  : p.drafts[m.id]
                    ? t("In progress", "In corso")
                    : "5 min"}
              </span>
            </div>
            <small>{courseName(m.course, t)}</small>
            <h2>{text(m.title)}</h2>
            <p>{text(m.goal)}</p>
            <div className="tile-bottom">
              <span>
                {p.completed[m.id]
                  ? t("Revisit lesson", "Rivedi la lezione")
                  : p.drafts[m.id]
                    ? t("Continue", "Continua")
                    : t("Start lesson", "Inizia la lezione")}
              </span>
              <Icon name={p.completed[m.id] ? "check" : "arrow"} />
            </div>
          </button>
        ))}
      </div>
      {!list.length && (
        <div className="empty-state">
          <h2>{t("No lessons found", "Nessuna lezione trovata")}</h2>
          <p>
            {t(
              "Try another topic, or show all lessons.",
              "Prova un altro argomento o mostra tutte le lezioni.",
            )}
          </p>
          <button
            className="button secondary"
            onClick={() => {
              setQuery("");
              setFilter(0);
            }}
          >
            {t("Show all lessons", "Mostra tutte le lezioni")}
          </button>
        </div>
      )}
    </div>
  );
}
function PlanView(props: Shared) {
  const { p, t, text, save, go, today } = props;
  const days = [1, 2, 3, 4, 5, 6, 0];
  const remaining = missions.filter(
    (m) => m.course === p.plan.course && !p.completed[m.id],
  ).length;
  const calendar = schedule(p, missions, 7, today);
  return (
    <div className="workspace">
      <PageIntro
        eyebrow={t("A PLAN THAT FITS YOUR LIFE", "UN PIANO CHE SI ADATTA A TE")}
        title={t(
          "Make room for a little Italian.",
          "Fai spazio a un po’ d’italiano.",
        )}
        description={t(
          "Choose your pace. Miss a day? Your next lesson will wait for you. Changes save automatically.",
          "Scegli il tuo ritmo. Salti un giorno? La prossima lezione ti aspetta. Le modifiche si salvano automaticamente.",
        )}
      />
      <div className="support-box">
        <h2>
          {t(
            "Choose a course as well as a daily rhythm",
            "Scegli un corso e un ritmo quotidiano",
          )}
        </h2>
        <p>
          {t(
            "Choose the 14-study-day A1 review, the 28-day supported route, the 10-day grammar repair course or the 80-study-day journey through both books. Study days wait for you; missed days do not erase progress.",
            "Scegli il ripasso A1 di 14 giorni di studio, il percorso guidato di 28 giorni, il ripasso grammaticale di 10 giorni o il percorso di 80 giorni attraverso entrambi i libri. I giorni di studio ti aspettano; un’assenza non cancella i progressi.",
          )}
        </p>
        <button className="button primary" onClick={() => go("programmes")}>
          {t("Choose my programme", "Scegli il mio programma")}
        </button>
      </div>
      <div className="plan-layout">
        <section className="panel plan-settings">
          <h2>{t("My study rhythm", "Il mio ritmo di studio")}</h2>
          <fieldset>
            <legend>
              {t("Time on a study day", "Tempo in un giorno di studio")}
            </legend>
            <div className="choice-row">
              {[5, 10, 15, 20, 30, 45, 60].map((n) => (
                <button
                  key={n}
                  aria-pressed={p.plan.minutes === n}
                  onClick={() =>
                    save((s) => ({ ...s, plan: { ...s.plan, minutes: n } }))
                  }
                >
                  {n}
                  <small>min</small>
                </button>
              ))}
            </div>
            <p className="hint">
              {t(
                "Choose 5–30 minutes for a guided topic. At 45 minutes add a grammar workshop; at 60 add tense practice and a page companion. Keep unfinished work for next time. All times are estimates.",
                "Scegli 5–30 minuti per un tema guidato. A 45 minuti aggiungi grammatica; a 60 aggiungi pratica dei tempi e una pagina del compagno. Conserva il lavoro incompleto per la prossima volta. Tutti i tempi sono stime.",
              )}
            </p>
          </fieldset>
          <fieldset>
            <legend>{t("My study days", "I miei giorni di studio")}</legend>
            <div className="day-choices">
              {days.map((d) => (
                <button
                  key={d}
                  aria-label={new Date(2026, 9, 18 + d).toLocaleDateString(
                    p.language === "it" ? "it-IT" : "en-GB",
                    { weekday: "long" },
                  )}
                  aria-pressed={p.plan.days.includes(d)}
                  disabled={p.plan.days.length === 1 && p.plan.days.includes(d)}
                  onClick={() =>
                    save((s) => ({
                      ...s,
                      plan: {
                        ...s.plan,
                        days: s.plan.days.includes(d)
                          ? s.plan.days.filter((x) => x !== d)
                          : [...s.plan.days, d],
                      },
                    }))
                  }
                >
                  {new Date(2026, 9, 18 + d).toLocaleDateString(
                    p.language === "it" ? "it-IT" : "en-GB",
                    { weekday: "short" },
                  )}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="field">
            {t("Start date", "Data di inizio")}
            <input
              type="date"
              value={p.plan.start}
              min="2020-01-01"
              max="2100-12-31"
              onChange={(e) => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value))
                  save((s) => ({
                    ...s,
                    plan: { ...s.plan, start: e.target.value },
                  }));
              }}
            />
          </label>
          <label className="field">
            {t("What I’m working on", "Il mio obiettivo")}
            <select
              value={p.plan.course}
              onChange={(e) =>
                save((s) => ({
                  ...s,
                  plan: { ...s.plan, course: Number(e.target.value) },
                }))
              }
            >
              {[1, 2, 3].map((c) => (
                <option value={c} key={c}>
                  {courseName(c, t)}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            {remaining}{" "}
            {t(
              "new lessons left in this path. Reviews adapt to what you remember.",
              "nuove lezioni rimaste in questo percorso. I ripassi si adattano a ciò che ricordi.",
            )}
          </p>
        </section>
        <section>
          <div className="section-heading">
            <h2>
              {t(
                "Class path · next seven days",
                "Percorso del corso · prossimi sette giorni",
              )}
            </h2>
            <span>
              {t(
                "Remaining practice · flexible",
                "Pratica rimanente · flessibile",
              )}
            </span>
          </div>
          {p.academy?.programme && (
            <p className="hint">
              {t(
                "This calendar previews your class path. Your selected programme has its own study-day checklist; Today combines its grammar topics and core lesson within your time budget.",
                "Questo calendario anticipa il percorso del corso. Il programma scelto ha una propria lista di giorni di studio; Oggi combina i suoi temi di grammatica e la lezione base nel tempo disponibile.",
              )}{" "}
              <button className="text-button" onClick={() => go("programmes")}>
                {t("Open programme days", "Apri i giorni del programma")} →
              </button>
            </p>
          )}
          <div className="calendar-list">
            {calendar.map((day) => (
              <article
                key={day.date}
                className={
                  day.date === today ? "calendar-day today" : "calendar-day"
                }
              >
                <div className="calendar-date">
                  <strong>
                    {new Date(day.date + "T12:00:00").toLocaleDateString(
                      p.language === "it" ? "it-IT" : "en-GB",
                      { weekday: "short" },
                    )}
                  </strong>
                  <span>{new Date(day.date + "T12:00:00").getDate()}</span>
                </div>
                <div>
                  <h3>
                    {!day.active
                      ? t("A little breathing room", "Un po’ di respiro")
                      : t("A small step forward", "Un piccolo passo avanti")}
                  </h3>
                  {!day.active ? (
                    <p>
                      {day.date < p.plan.start
                        ? t(
                            "Your plan has not started yet. Optional practice is always available.",
                            "Il piano non è ancora iniziato. La pratica facoltativa è sempre disponibile.",
                          )
                        : t(
                            "Rest day. Optional practice is always here if you feel like it.",
                            "Giorno di pausa. La pratica facoltativa è qui se ti va.",
                          )}
                    </p>
                  ) : (
                    <>
                      {day.guided && (
                        <p>
                          {t(
                            "One guided topic · pause and resume as needed",
                            "Un tema guidato · fermati e riprendi quando serve",
                          )}
                        </p>
                      )}
                      <div className="calendar-lessons">
                        {day.items.map((m) => (
                          <button
                            onClick={() =>
                              go(
                                day.guided && day.date === today
                                  ? "session"
                                  : `lesson/${m.id}`,
                              )
                            }
                            key={m.id}
                          >
                            {text(m.title)}{" "}
                            <span>
                              {day.guided ? Math.min(30, day.budget) : "5"} min
                              ↗
                            </span>
                          </button>
                        ))}
                      </div>
                      {day.due.length > 0 && (
                        <p>
                          {day.due.length}{" "}
                          {t(
                            "reviews due; start with the oldest.",
                            "ripassi in scadenza; inizia dal più vecchio.",
                          )}
                        </p>
                      )}
                      {!day.items.length && !day.due.length && (
                        <p>
                          {t(
                            remaining
                              ? "No more practice fits this day’s remaining budget. Your next lesson waits for another study day."
                              : "No new lessons remaining in this path. Revisit a favourite or choose another path.",
                            remaining
                              ? "Non entra altra pratica nel tempo rimasto per questo giorno. La prossima lezione ti aspetta in un altro giorno di studio."
                              : "Non restano nuove lezioni in questo percorso. Rivedi una preferita o scegli un altro percorso.",
                          )}
                        </p>
                      )}
                    </>
                  )}
                </div>
                <span className="calendar-minutes">
                  {day.active
                    ? `${day.guided ? day.budget : day.items.length * 5 + day.due.length * 2} min`
                    : "—"}
                </span>
              </article>
            ))}
          </div>
          <p className="hint">
            {t(
              "New lessons move forward as you finish them. Review dates may change after each recall check. Your daily goal includes reviews.",
              "Le nuove lezioni avanzano quando le completi. Le date dei ripassi possono cambiare dopo ogni prova di memoria. L’obiettivo giornaliero include i ripassi.",
            )}
          </p>
        </section>
      </div>
    </div>
  );
}
function SourceNote({
  m,
  t,
  pdfs,
  pdfPageOffsets = {},
}: {
  m: Mission;
  t: Translate;
  pdfs: Record<string, string>;
  pdfPageOffsets?: Record<string, number>;
}) {
  return (
    <details className="source-note">
      <summary>
        <Icon name="folder" />
        {t(
          "Connected to your class materials",
          "Collegato ai materiali del tuo corso",
        )}
      </summary>
      <p>
        {t(
          "Original practice inspired by these topics. Open your own copy at the pages below; the portal does not reproduce the worksheet.",
          "Pratica originale ispirata a questi argomenti. Apri la tua copia alle pagine indicate; il portale non riproduce la scheda.",
        )}
      </p>
      {m.sources.map((ref) => {
        const s = sources.find((s) => s.id === ref.id)!;
        return (
          <div key={s.id}>
            <strong>{s.title}</strong>
            <small>{s.path}</small>
            <p>
              {s.title.endsWith(".pptx")
                ? t("Slides", "Diapositive")
                : t("PDF pages", "Pagine PDF")}
              : {ref.pages.join(", ")}
            </p>
            {pdfs[s.id] && (
              <a
                className="text-button"
                href={localPdfPageHref(pdfs[s.id], ref.pages[0], pdfPageOffsets[s.id])}
                target="_blank"
                rel="noreferrer"
              >
                {t("Open connected PDF", "Apri il PDF collegato")} ↗
              </a>
            )}
            {pdfs[s.id] && pdfPageOffsets[s.id] > 0 && <p className="hint">{t("Pages in your connected export", "Pagine nell’esportazione collegata")}: {ref.pages.map((page) => page + pdfPageOffsets[s.id]).join(", ")}</p>}
          </div>
        );
      })}
      <p className="hint">
        {t(
          "PDF page numbers count from the first page. Connect a local PDF in Materials to open it here.",
          "Le pagine PDF si contano dalla prima pagina. Collega un PDF locale in Materiali per aprirlo qui.",
        )}
      </p>
    </details>
  );
}
function Listen({ phrase, t }: { phrase: string; t: Translate }) {
  const [status, setStatus] = useState("");
  return (
    <>
      <button
        className="listen-button"
        aria-label={t("Listen in Italian", "Ascolta in italiano")}
        onClick={() => {
          if (!("speechSynthesis" in window)) {
            setStatus(
              t(
                "Audio is unavailable. Read the Italian aloud instead.",
                "Audio non disponibile. Leggi invece l’italiano ad alta voce.",
              ),
            );
            return;
          }
          const utterance = new SpeechSynthesisUtterance(phrase);
          utterance.lang = "it-IT";
          utterance.rate = 0.85;
          const voice = window.speechSynthesis
            .getVoices()
            .find((v) => v.lang.startsWith("it"));
          if (voice) utterance.voice = voice;
          utterance.onerror = () =>
            setStatus(
              t(
                "Audio could not play. You can read the phrase aloud.",
                "L’audio non è partito. Puoi leggere la frase ad alta voce.",
              ),
            );
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
          setStatus(
            t("Device voice · Italian", "Voce del dispositivo · Italiano"),
          );
        }}
      >
        <Icon name="sound" />
      </button>
      <span className="audio-status" role="status">
        {status}
      </span>
    </>
  );
}
function LessonView({
  m,
  p,
  t,
  text,
  save,
  go,
  today,
  pdfs,
  pdfPageOffsets = {},
}: Shared & { m: Mission; pdfs: Record<string, string>; pdfPageOffsets?: Record<string, number> }) {
  const d = p.drafts[m.id] || emptyDraft();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(2);
  const [finished, setFinished] = useState(false);
  const focus = useRef<HTMLHeadingElement>(null);
  const answerRef = useRef<HTMLInputElement>(null);
  const result = p.completed[m.id];
  useEffect(() => {
    focus.current?.focus();
  }, [d.step, finished]);
  const edit = (fn: (d: Draft) => Draft) =>
    save((s) => ({
      ...s,
      drafts: { ...s.drafts, [m.id]: fn(s.drafts[m.id] || emptyDraft()) },
    }));
  const stepTo = (step: number) => {
    edit((x) => ({ ...x, step }));
    setFeedback(null);
    window.scrollTo({ top: 0 });
  };
  const step = d.step;
  const check = m.checks[step - 1];
  const allDone = finished || (!!result && step === 3);
  if (allDone)
    return (
      <div className="study-wrap">
        <div className="finish-panel">
          <span className="finish-mark">
            <Icon name="check" size={40} />
          </span>
          <p className="eyebrow">
            {t("A SMALL STEP, TAKEN", "UN PICCOLO PASSO FATTO")}
          </p>
          <h1 ref={focus} tabIndex={-1}>
            {t("That’s Italian you can use.", "È italiano che puoi usare.")}
          </h1>
          <p>{text(m.goal)}</p>
          <div className="finish-stats">
            <div>
              <strong>{result?.firstCorrect ?? 0}/2</strong>
              <span>
                {t("first-attempt recall", "ricordo al primo tentativo")}
              </span>
            </div>
            <div>
              <strong>
                {result?.supported
                  ? t("With a model", "Con un modello")
                  : t("Your own attempt", "Il tuo tentativo")}
              </strong>
              <span>
                {t("writing · self-checked", "scrittura · autoverifica")}
              </span>
            </div>
          </div>
          <p className="hint">
            {t(
              "Your writing is saved, not automatically graded. Compare it with the checklist or discuss it in class.",
              "La tua scrittura è salvata, non valutata automaticamente. Confrontala con la lista oppure discutine in classe.",
            )}
          </p>
          <blockquote lang="it">{result?.output}</blockquote>
          <p>
            {t("Next memory check:", "Prossima prova di memoria:")}{" "}
            {p.reviews[m.id]?.due}
          </p>
          {dailyMinutes(p, today) >= p.plan.minutes && (
            <div className="feedback correct">
              {t(
                "Today’s goal is complete. You can stop here and come back tomorrow.",
                "L’obiettivo di oggi è completo. Puoi fermarti qui e tornare domani.",
              )}
            </div>
          )}
          <div className="button-row">
            {p.sessions?.[today]?.missionId === m.id && (
              <button className="button primary" onClick={() => go("session")}>
                {t(
                  "Continue my daily session",
                  "Continua la sessione quotidiana",
                )}{" "}
                →
              </button>
            )}
            <button className="button primary" onClick={() => go("today")}>
              {t("Back to today", "Torna a oggi")}
              <Icon name="arrow" />
            </button>
            <button
              className="button secondary"
              onClick={() => {
                const n = nextMission(p, missions);
                go(n ? `lesson/${n.id}` : "path");
              }}
            >
              {t("Another small step", "Un altro piccolo passo")}
            </button>
          </div>
          <button
            className="text-button"
            onClick={() => {
              edit(() => emptyDraft());
              setFinished(false);
            }}
          >
            {t(
              "Revisit this lesson (no extra credit)",
              "Rivedi questa lezione (senza credito aggiuntivo)",
            )}
          </button>
        </div>
        <SourceNote m={m} t={t} pdfs={pdfs} pdfPageOffsets={pdfPageOffsets} />
      </div>
    );
  return (
    <div className="study-wrap">
      <div className="study-topline">
        <button className="text-button" onClick={() => go("today")}>
          <Icon name="back" />
          {t("Save & leave", "Salva ed esci")}
        </button>
        <span>
          <Icon name="clock" />{" "}
          {t("About 5 minutes · your pace", "Circa 5 minuti · al tuo ritmo")}
        </span>
      </div>
      <div
        className="step-track"
        aria-label={t("Lesson progress", "Progresso della lezione")}
      >
        {[
          t("Notice", "Osserva"),
          t("Recall 1", "Ricorda 1"),
          t("Recall 2", "Ricorda 2"),
          t("Use it", "Usalo"),
        ].map((label, i) => (
          <div
            key={i}
            className={i === step ? "current" : i < step ? "passed" : ""}
          >
            <span>{i < step ? "✓" : i + 1}</span>
            {label}
          </div>
        ))}
      </div>
      <article className="study-paper">
        <p className="eyebrow">
          {courseName(m.course, t)} · {t("LESSON", "LEZIONE")}{" "}
          {missions.indexOf(m) + 1}
        </p>
        <h1 ref={focus} tabIndex={-1}>
          {text(m.title)}
        </h1>
        <p className="lesson-goal">{text(m.goal)}</p>
        {step === 0 && (
          <>
            <section className="teaching">
              <h2>{t("One idea to notice", "Un’idea da osservare")}</h2>
              <p>{text(m.rule)}</p>
            </section>
            <div className="examples-heading">
              <h2>{t("Hear it. Say it.", "Ascolta. Ripeti.")}</h2>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={p.translations}
                  onChange={(e) =>
                    save((s) => ({ ...s, translations: e.target.checked }))
                  }
                />
                {t("English translations", "Traduzioni inglesi")}
              </label>
            </div>
            <div className="examples">
              {m.examples.map((example, i) => (
                <div className="example" key={i}>
                  <div>
                    <p lang="it">{example.it}</p>
                    {p.translations && <span lang="en">{example.en}</span>}
                  </div>
                  <Listen phrase={example.it} t={t} />
                </div>
              ))}
            </div>
            <div className="word-chips">
              {m.words.map((w) => (
                <span key={w.it}>
                  <b lang="it">{w.it}</b>
                  {p.translations && <span lang="en">{w.en}</span>}
                </span>
              ))}
            </div>
            <p className="hint">
              {t(
                "Listening uses your device’s voice when available. You can always read aloud.",
                "L’ascolto usa la voce del dispositivo quando disponibile. Puoi sempre leggere ad alta voce.",
              )}
            </p>
            <button className="button primary" onClick={() => stepTo(1)}>
              {t("Try it from memory", "Prova a memoria")}
              <Icon name="arrow" />
            </button>
          </>
        )}
        {(step === 1 || step === 2) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (d.checked[step - 1]) {
                stepTo(step + 1);
                return;
              }
              const correct = isCorrect(d.answers[step - 1], check.answers);
              edit((x) => {
                const first = [...x.first];
                if (first[step - 1] === undefined) first[step - 1] = correct;
                return {
                  ...x,
                  first,
                  checked: x.checked.map((v, i) =>
                    i === step - 1 ? correct : v,
                  ),
                };
              });
              setFeedback(correct ? "correct" : "retry");
            }}
          >
            <span className="tag">
              {t("RECALL", "RICORDA")} {step}/2
            </span>
            <h2 className="question">{text(check.prompt)}</h2>
            <label className="field">
              {t("Your answer in Italian", "La tua risposta in italiano")}
              <input
                ref={answerRef}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={200}
                value={d.answers[step - 1]}
                disabled={d.checked[step - 1]}
                onChange={(e) => {
                  const value = e.target.value;
                  edit((x) => ({
                    ...x,
                    answers: x.answers.map((v, i) =>
                      i === step - 1 ? value : v,
                    ),
                  }));
                }}
              />
            </label>
            <div
              className="accent-keys"
              aria-label={t("Italian accents", "Accenti italiani")}
            >
              {["à", "è", "é", "ì", "ò", "ù", "’"].map((a) => (
                <button
                  type="button"
                  key={a}
                  disabled={d.checked[step - 1]}
                  onClick={() => {
                    const input = answerRef.current;
                    const start =
                      input?.selectionStart ?? d.answers[step - 1].length;
                    const end = input?.selectionEnd ?? start;
                    edit((x) => ({
                      ...x,
                      answers: x.answers.map((v, i) =>
                        i === step - 1
                          ? (v.slice(0, start) + a + v.slice(end)).slice(0, 200)
                          : v,
                      ),
                    }));
                    requestAnimationFrame(() => {
                      input?.focus();
                      input?.setSelectionRange(start + 1, start + 1);
                    });
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
            {(feedback || d.checked[step - 1]) && (
              <div
                className={`feedback ${d.checked[step - 1] ? "correct" : "retry"}`}
                role="status"
              >
                <strong>
                  {d.checked[step - 1]
                    ? t("Yes, that works.", "Sì, funziona.")
                    : t(
                        "A useful mistake. Try once more.",
                        "Un errore utile. Prova ancora.",
                      )}
                </strong>
                <p>{text(check.explanation)}</p>
                {!d.checked[step - 1] && (
                  <p>
                    {t("Expected:", "Risposta attesa:")}{" "}
                    <b lang="it">{check.answers[0]}</b>
                  </p>
                )}
              </div>
            )}
            <div className="button-row">
              <button
                type="submit"
                className="button primary"
                disabled={!d.answers[step - 1].trim()}
              >
                {d.checked[step - 1]
                  ? t("Continue", "Continua")
                  : t("Check my answer", "Controlla la risposta")}
                <Icon name="arrow" />
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => stepTo(0)}
              >
                {t("Look at the explanation", "Rivedi la spiegazione")}
              </button>
            </div>
            <p className="hint">
              {t(
                "Accents matter: è and e mean different things. A correction never erases your first attempt.",
                "Gli accenti contano: è ed e hanno significati diversi. Una correzione non cancella il primo tentativo.",
              )}
            </p>
          </form>
        )}
        {step === 3 && (
          <>
            <span className="tag">{t("MAKE IT YOURS", "USA PAROLE TUE")}</span>
            <h2 className="question">{text(m.output)}</h2>
            <label className="field">
              {t("My Italian", "Il mio italiano")}
              <textarea
                rows={5}
                maxLength={2000}
                value={d.output}
                placeholder={t(
                  "Try with the words you know…",
                  "Prova con le parole che conosci…",
                )}
                onChange={(e) =>
                  edit((x) => ({ ...x, output: e.target.value }))
                }
              />
            </label>
            <p className="hint">
              {t(
                "Write at least three words. Invent details if you prefer. This is practice, not an automatic writing assessment.",
                "Scrivi almeno tre parole. Inventa i dettagli se preferisci. È pratica, non una valutazione automatica della scrittura.",
              )}
            </p>
            <details
              className="model-answer"
              onToggle={(e) => {
                if (e.currentTarget.open && !d.modelSeen)
                  edit((x) => ({ ...x, modelSeen: true }));
              }}
            >
              <summary>
                {t(
                  "See one possible example (marks this attempt as supported)",
                  "Vedi un possibile esempio (segna il tentativo come aiutato)",
                )}
              </summary>
              <p lang="it">{m.model.it}</p>
              {p.translations && <p lang="en">{m.model.en}</p>}
            </details>
            <fieldset className="self-check">
              <legend>
                {t("Check your own work", "Controlla il tuo lavoro")}
              </legend>
              {m.rubric.map((r, i) => (
                <label key={i}>
                  <input
                    type="checkbox"
                    checked={d.rubric[i]}
                    onChange={(e) =>
                      edit((x) => ({
                        ...x,
                        rubric: x.rubric.map((v, j) =>
                          j === i ? e.target.checked : v,
                        ),
                      }))
                    }
                  />
                  {text(r)}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>{t("How did that feel?", "Come ti è sembrato?")}</legend>
              <div className="confidence-choices">
                {[
                  [1, t("Needs practice", "Da ripassare")],
                  [2, t("Getting there", "Ci sto arrivando")],
                  [3, t("Comfortable", "Mi sento sicuro")],
                ].map(([v, label]) => (
                  <button
                    key={v}
                    aria-pressed={confidence === v}
                    onClick={() => setConfidence(Number(v))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <button
              className="button primary"
              disabled={
                !d.rubric.every(Boolean) ||
                d.output.trim().split(/\s+/).length < 3 ||
                !d.checked.every(Boolean)
              }
              onClick={() => {
                save((s) =>
                  completeMission(
                    s,
                    m,
                    s.drafts[m.id] || emptyDraft(),
                    confidence,
                    today,
                  ),
                );
                setFinished(true);
              }}
            >
              {t("Save my practice", "Salva la mia pratica")}
              <Icon name="check" />
            </button>
            <p className="hint">
              {t(
                "Complete your own text and both checklist items to finish.",
                "Completa il tuo testo e le due voci della lista per finire.",
              )}
            </p>
          </>
        )}
      </article>
      <SourceNote m={m} t={t} pdfs={pdfs} pdfPageOffsets={pdfPageOffsets} />
    </div>
  );
}
function ReviewView({
  m,
  p,
  t,
  text,
  save,
  go,
  today,
}: Shared & { m: Mission }) {
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [localFirst, setLocalFirst] = useState<LocalRecallAttempt | null>(null);
  const first = firstCoreRecallToday(p, m.id, today) ?? (localFirst?.date === today ? localFirst.correct : null);
  const due =
    !!p.reviews[m.id] &&
    p.reviews[m.id].due <= today &&
    p.reviews[m.id].lastDate !== today;
  const [scheduledOn, setScheduledOn] = useState<string | null>(null);
  const scheduled = scheduledOn === today;
  const recallFeedback = coreRecallFeedback(p, m.id, today, localFirst, scheduledOn);
  if (!p.completed[m.id])
    return (
      <div className="study-wrap">
        <h1>{t("Learn it first", "Prima imparalo")}</h1>
        <p>
          {t(
            "Complete this lesson to start its memory reviews.",
            "Completa questa lezione per iniziare i ripassi di memoria.",
          )}
        </p>
        <button className="button primary" onClick={() => go(`lesson/${m.id}`)}>
          {t("Open lesson", "Apri la lezione")}
        </button>
      </div>
    );
  return (
    <div className="study-wrap">
      <button className="text-button" onClick={() => go("today")}>
        <Icon name="back" />
        {t("Back to today", "Torna a oggi")}
      </button>
      {p.sessions?.[today] && (
        <button className="text-button" onClick={() => go("session")}>
          {t("Return to my daily session", "Torna alla sessione quotidiana")} →
        </button>
      )}
      <article className="study-paper">
        <p className="eyebrow">
          {t("A TWO-MINUTE MEMORY CHECK", "UNA PROVA DI MEMORIA DI DUE MINUTI")}
        </p>
        <h1>{text(m.title)}</h1>
        <p>
          {t(
            "Try before looking back. A mistake simply brings the next review closer.",
            "Prova prima di rileggere. Un errore avvicina semplicemente il prossimo ripasso.",
          )}
        </p>
        {!due && !scheduled && (
          <p className="info-line">
            {t(
              "Extra practice: this will not change your score or review date.",
              "Pratica extra: non cambia il punteggio o la data del ripasso.",
            )}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const correct = isCorrect(answer, m.review.answers);
            setFeedback(correct);
            if (first === null) setLocalFirst({ date: today, correct });
            if (due && !scheduled) {
              save((s) => recordReview(s, m.id, correct, today));
              setScheduledOn(today);
            }
          }}
        >
          <h2 className="question">{text(m.review.prompt)}</h2>
          <label className="field">
            {t("Your answer in Italian", "La tua risposta in italiano")}
            <input
              value={answer}
              maxLength={200}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              disabled={feedback === true}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </label>
          <div className="accent-keys">
            {["à", "è", "é", "ì", "ò", "ù", "’"].map((a) => (
              <button
                type="button"
                key={a}
                disabled={feedback === true}
                onClick={() => setAnswer((answer + a).slice(0, 200))}
              >
                {a}
              </button>
            ))}
          </div>
          {feedback !== null && (
            <div
              className={`feedback ${feedback ? "correct" : "retry"}`}
              role="status"
            >
              <strong>
                {feedback
                  ? t("You’ve got it.", "Ci sei.")
                  : scheduled
                    ? t(
                        "Let’s bring this one back tomorrow.",
                        "Riprendiamolo domani.",
                      )
                    : t(
                        "Try the correction below.",
                        "Prova la correzione qui sotto.",
                      )}
              </strong>
              <p>{text(m.review.explanation)}</p>
              {!feedback && (
                <p>
                  {t("Expected:", "Risposta attesa:")}{" "}
                  <b lang="it">{m.review.answers[0]}</b>.{" "}
                  {t(
                    "Type it once to practise the correction.",
                    "Scrivilo una volta per esercitarti nella correzione.",
                  )}
                </p>
              )}
              {scheduled && (
                <small>
                  {t("Next review:", "Prossimo ripasso:")}{" "}
                  {p.reviews[m.id]?.due}
                </small>
              )}
            </div>
          )}
          {feedback !== true ? (
            <button className="button primary" disabled={!answer.trim()}>
              {t("Check recall", "Controlla il ricordo")}
              <Icon name="check" />
            </button>
          ) : (
            <div className="button-row">
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  const next = dueReviews(p, today).filter(
                    (id) => id !== m.id,
                  )[0];
                  go(next ? `review/${next}` : "today");
                }}
              >
                {dueReviews(p, today).filter((id) => id !== m.id).length
                  ? t("Next review", "Prossimo ripasso")
                  : t("Back to today", "Torna a oggi")}
                <Icon name="arrow" />
              </button>
              <span>
                {recallFeedback === "independent"
                  ? t("Recalled independently", "Ricordato in autonomia")
                  : recallFeedback === "supported"
                    ? t("Corrected with support", "Corretto con aiuto")
                    : t("Extra practice", "Pratica extra")}
              </span>
            </div>
          )}
        </form>
      </article>
    </div>
  );
}
function ProgressView({
  p,
  t,
  text,
  save,
  go,
  today,
  exportProgress,
  restore,
  loadError,
}: Shared & {
  exportProgress: () => void;
  restore: (p: Progress) => boolean;
  loadError: boolean;
}) {
  const [message, setMessage] = useState("");
  const [reset, setReset] = useState(false);
  const entries = Object.entries(p.completed);
  const attempts = entries.reduce((n, [, c]) => n + c.total, 0);
  const correct = entries.reduce((n, [, c]) => n + c.firstCorrect, 0);
  const practiced = new Set([
    ...entries.map(([, c]) => c.date),
    ...p.reviewLog.map((r) => r.date),
    ...Object.entries(p.sessions ?? {})
      .filter(([, s]) => s.done.length > 0)
      .map(([date]) => date),
  ]);
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  return (
    <div className="workspace">
      <PageIntro
        eyebrow={t(
          "EVIDENCE, NOT JUST A STREAK",
          "EVIDENZE, NON SOLO UNA SERIE",
        )}
        title={t(
          "Look how far you’ve come.",
          "Guarda quanta strada hai fatto.",
        )}
        description={t(
          "Your first attempts, later recall and your own Italian. Progress stays in this browser, on this device.",
          "I primi tentativi, il ricordo nel tempo e il tuo italiano. I progressi restano in questo browser, su questo dispositivo.",
        )}
      />
      <Rewards p={p} t={t} />
      <div className="stats-grid">
        <div>
          <Icon name="book" />
          <strong>
            {entries.length}
            <span>/ {missions.length}</span>
          </strong>
          <p>{t("lessons completed", "lezioni completate")}</p>
        </div>
        <div>
          <Icon name="check" />
          <strong>
            {attempts ? `${Math.round((correct / attempts) * 100)}%` : "—"}
          </strong>
          <p>{t("first-attempt accuracy", "precisione al primo tentativo")}</p>
          <small>
            {correct}/{attempts} {t("recall checks", "prove di memoria")}
          </small>
        </div>
        <div>
          <Icon name="refresh" />
          <strong>
            {p.reviewLog.length
              ? p.reviewLog.filter((r) => r.correct).length +
                "/" +
                p.reviewLog.length
              : "—"}
          </strong>
          <p>{t("later reviews recalled", "ripassi successivi ricordati")}</p>
        </div>
        <div>
          <Icon name="sun" />
          <strong>
            {week.filter((d) => practiced.has(d)).length}
            <span>/ 7</span>
          </strong>
          <p>
            {t(
              "days practised this week",
              "giorni di pratica negli ultimi sette",
            )}
          </p>
        </div>
      </div>
      <div className="progress-layout">
        <section>
          <div className="section-heading">
            <h2>{t("My Italian notebook", "Il mio quaderno d’italiano")}</h2>
            <span>
              {entries.length} {t("saved pieces", "testi salvati")}
            </span>
          </div>
          {!entries.length ? (
            <div className="empty-state">
              <Icon name="book" size={38} />
              <h3>
                {t(
                  "Your first page is waiting.",
                  "La prima pagina ti aspetta.",
                )}
              </h3>
              <p>
                {t(
                  "Finish a lesson and your own Italian will appear here.",
                  "Completa una lezione e il tuo italiano apparirà qui.",
                )}
              </p>
              <button
                className="button primary"
                onClick={() => go(`lesson/${nextMission(p, missions)?.id}`)}
              >
                {t("Start a small step", "Inizia un piccolo passo")}
              </button>
            </div>
          ) : (
            <div className="notebook-list">
              {entries
                .slice()
                .sort((a, b) => b[1].date.localeCompare(a[1].date))
                .map(([id, c]) => {
                  const m = missions.find((m) => m.id === id)!;
                  return (
                    <details key={id}>
                      <summary>
                        <span>
                          <strong>{text(m.title)}</strong>
                          <small>
                            {c.date} · {c.firstCorrect}/2{" "}
                            {t("first attempts", "primi tentativi")}
                          </small>
                        </span>
                        <span className="tag">
                          {c.supported
                            ? t("With support", "Con aiuto")
                            : t("Own attempt", "Tentativo autonomo")}
                        </span>
                      </summary>
                      <blockquote lang="it">{c.output}</blockquote>
                      <p className="hint">
                        {t(
                          "Writing self-checked, not automatically graded. Confidence:",
                          "Scrittura autoverificata, non valutata automaticamente. Sicurezza:",
                        )}{" "}
                        {c.confidence}/3
                      </p>
                      <button
                        className="text-button"
                        onClick={() => go(`review/${id}`)}
                      >
                        {t("Practise this again", "Esercitati di nuovo")} ↗
                      </button>
                    </details>
                  );
                })}
            </div>
          )}
          <SessionNotebook p={p} t={t} text={text} missions={missions} />
          <label className="field reflection">
            {t("A note to my future self", "Un appunto per il mio futuro")}
            <textarea
              maxLength={5000}
              rows={4}
              value={p.notes}
              placeholder={t(
                "What clicked? What would you like to ask in class?",
                "Che cosa hai capito? Che cosa vuoi chiedere in classe?",
              )}
              onChange={(e) => save((s) => ({ ...s, notes: e.target.value }))}
            />
          </label>
        </section>
        <aside>
          <section className="panel">
            <h2>{t("Keep your progress safe", "Conserva i tuoi progressi")}</h2>
            <p>
              {t(
                "Browser storage remembers your plan and work. Clearing site data or switching devices will not carry it over. Export a backup to keep a copy.",
                "Il browser ricorda il piano e il lavoro. Cancellando i dati del sito o cambiando dispositivo, i progressi non si trasferiscono. Esporta un backup per conservarne una copia.",
              )}
            </p>
            <button className="button secondary full" onClick={exportProgress}>
              <Icon name="download" />
              {t("Export progress", "Esporta progressi")}
            </button>
            <BackupTransfer current={p} ids={ids} t={t} apply={restore} mergeDisabled={loadError} />
            <p role="status">{message}</p>
            <details className="privacy-note">
              <summary>
                {t("How saving works", "Come funziona il salvataggio")}
              </summary>
              <p>
                {t(
                  "The app uses localStorage, not an account. Your writing is not sent to a server. Each browser has separate progress. Voice playback uses your browser’s speech service. Source PDFs you connect remain on your device.",
                  "L’app usa localStorage, senza un account. I tuoi testi non vengono inviati a un server. Ogni browser ha progressi separati. L’audio usa il servizio vocale del browser. I PDF collegati restano sul dispositivo.",
                )}
              </p>
              <p>
                {t(
                  "The previous textbook portal’s saved data is left intact. Its different scoring system is not imported into this course.",
                  "I dati salvati dal precedente portale del libro restano intatti. Il suo diverso sistema di valutazione non viene importato in questo corso.",
                )}
              </p>
            </details>
          </section>
          <section className="quiet-note">
            <h3>{t("A word about the numbers", "Due parole sui numeri")}</h3>
            <p>
              {t(
                "Finishing a lesson means you practised it. It is not proof of fluency or a CEFR certificate. Later recall and independent speaking are the next checks.",
                "Finire una lezione significa averla praticata. Non prova la padronanza e non è un certificato QCER. Il ricordo nel tempo e il parlato autonomo sono le prossime verifiche.",
              )}
            </p>
          </section>
          <div className="reset-area">
            {!reset ? (
              <button className="text-button" onClick={() => setReset(true)}>
                {loadError
                  ? t(
                      "Recover with a fresh start",
                      "Recupera con un nuovo inizio",
                    )
                  : t(
                      "Reset this course’s progress",
                      "Azzera i progressi di questo corso",
                    )}
              </button>
            ) : (
              <>
                <p>
                  {t(
                    "This removes the daily course’s saved plan and work from this browser. Export first if you want to keep it.",
                    "Questo elimina il piano e il lavoro del corso quotidiano da questo browser. Esporta prima se vuoi conservarli.",
                  )}
                </p>
                <button
                  className="button danger"
                  onClick={() => {
                    if (restore({ ...emptyProgress(), language: p.language })) {
                      setReset(false);
                      setMessage(t("Progress reset.", "Progressi azzerati."));
                    } else
                      setMessage(
                        t(
                          "Unable to reset storage.",
                          "Impossibile azzerare l’archivio.",
                        ),
                      );
                  }}
                >
                  {t("Delete saved progress", "Elimina i progressi salvati")}
                </button>{" "}
                <button className="text-button" onClick={() => setReset(false)}>
                  {t("Cancel", "Annulla")}
                </button>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
function Materials({
  p,
  t,
  text,
  go,
  pdfs,
  pdfPageOffsets = {},
  attachPdfs,
  disconnectPdf,
  pdfResults,
  pdfStatus,
  checkingPdfs,
}: Shared & {
  pdfs: Record<string, string>;
  pdfPageOffsets?: Record<string, number>;
  attachPdfs: (files: FileList | null) => void;
  disconnectPdf: (sourceId: string) => void;
  pdfResults: LocalPdfResult[];
  pdfStatus: Pair | null;
  checkingPdfs: boolean;
}) {
  const [filter, setFilter] = useState(1);
  return (
    <div className="workspace">
      <PageIntro
        eyebrow={t(
          "FROM CLASS TO EVERYDAY LIFE",
          "DAL CORSO ALLA VITA QUOTIDIANA",
        )}
        title={t(
          "Your materials. More ways to learn.",
          "I tuoi materiali. Più modi per imparare.",
        )}
        description={t(
          "The portal is a practice companion: short explanations, fresh situations and recall checks built around the supplied class topics.",
          "Il portale è un compagno di pratica: spiegazioni brevi, situazioni nuove e prove di memoria basate sugli argomenti del corso.",
        )}
      />
      <div className="support-box">
        <h2>
          {t(
            "Practise beside each source page",
            "Esercitati accanto a ogni pagina",
          )}
        </h2>
        <p>
          {t(
            "Find your file and physical page or slide. The companion offers original parallel practice, examples and self-checks. Reference pages and unclear pages are labelled separately.",
            "Trova il file e la pagina o diapositiva fisica. Il compagno offre pratica parallela originale, esempi e autoverifiche. Le pagine di riferimento e quelle poco chiare hanno etichette distinte.",
          )}
        </p>
        <button className="button primary" onClick={() => go("companion")}>
          {t("Open page companions", "Apri i compagni delle pagine")}
        </button>
      </div>
      <ResourceLibrary t={t} text={text} />
      <div className="materials-banner">
        <div>
          <Icon name="folder" size={28} />
          <h2>{t("Bring your own PDF alongside", "Affianca il tuo PDF")}</h2>
          <p>
            {t(
              "Connect your source PDF or a recognized combined book export, even if you renamed it. Chapter links open at the right page in that file. Files stay on your device; connections last until you disconnect or reload.",
              "Collega il PDF della fonte o un’esportazione combinata riconosciuta, anche se l’hai rinominata. I collegamenti dei capitoli aprono la pagina corretta nel file. I file restano sul tuo dispositivo; i collegamenti durano fino allo scollegamento o alla ricarica.",
            )}
          </p>
        </div>
        <label className="file-button">
          {t("Connect local PDFs", "Collega PDF locali")}
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            disabled={checkingPdfs}
            onChange={(e) => {
              void attachPdfs(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {pdfResults.filter((result) => (result.sourceIds?.length ?? 0) > 1).map((result) => <p className="hint" key={result.name}>{result.name}: {t(`${result.sourceIds!.length} source references connected. Page links adjust automatically.`, `${result.sourceIds!.length} fonti collegate. I collegamenti alle pagine si adattano automaticamente.`)}</p>)}
      <div role="status" aria-live="polite">
        {checkingPdfs
          ? t("Checking selected PDFs…", "Controllo dei PDF selezionati…")
          : pdfStatus
            ? text(pdfStatus)
            : pdfResults.length > 0
              ? t(
                  `${pdfResults.filter((result) => result.status === "matched").length} matched · ${pdfResults.filter((result) => result.status === "unmatched").length} unmatched · ${pdfResults.filter((result) => result.status === "error").length} unreadable`,
                  `${pdfResults.filter((result) => result.status === "matched").length} riconosciuti · ${pdfResults.filter((result) => result.status === "unmatched").length} non riconosciuti · ${pdfResults.filter((result) => result.status === "error").length} illeggibili`,
                )
              : null}
      </div>
      {pdfResults.filter((result) => result.status === "unmatched" || result.status === "error").map((result, index) => (
        <p className="hint" key={`${result.name}:${index}`} style={{ overflowWrap: "anywhere" }}>
          {result.name}: {result.status === "unmatched"
            ? t("No source match. Select the exact source PDF.", "Nessuna fonte corrispondente. Seleziona il PDF esatto della fonte.")
            : t("Could not read this file. Try selecting it again.", "Impossibile leggere il file. Prova a selezionarlo di nuovo.")}
        </p>
      ))}
      {Object.keys(pdfs).length > 0 && (
        <section aria-label={t("Connected PDFs", "PDF collegati")}>
          <h3>{t("Connected in this tab", "Collegati in questa scheda")}</h3>
          <ul>
            {sources.filter((source) => pdfs[source.id]).map((source) => (
              <li key={source.id} style={{ overflowWrap: "anywhere" }}>
                <a href={localPdfPageHref(pdfs[source.id], 1, pdfPageOffsets[source.id])} target="_blank" rel="noreferrer">{source.title}</a>{" · "}
                <button className="text-button" onClick={() => disconnectPdf(source.id)} aria-label={t(`Disconnect ${source.title}`, `Scollega ${source.title}`)}>
                  {t("Disconnect", "Scollega")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="source-context">
        <div>
          <h3>{t("The edition matters", "L’edizione conta")}</h3>
          <p>
            {t(
              "Courses 1–2 refer to Nuovo Espresso Plus 1. Course 3 introduces Plus 2. References below point to the supplied file’s pages, not to unverified textbook page numbers.",
              "I corsi 1–2 fanno riferimento a Nuovo Espresso Plus 1. Il corso 3 introduce Plus 2. I riferimenti indicano le pagine del file disponibile, non numeri di pagina del libro non verificati.",
            )}
          </p>
        </div>
        <div>
          <h3>
            {t("Practice, then do it yourself", "Esercitati, poi fai da te")}
          </h3>
          <p>
            {t(
              "Class homework that asks for independent work remains yours to complete. Portal examples use new details. New files can extend the course through the repository’s /new-material workflow.",
              "I compiti che richiedono lavoro autonomo restano da svolgere da te. Gli esempi del portale usano dettagli nuovi. Nuovi file possono ampliare il corso tramite il flusso /new-material del repository.",
            )}
          </p>
        </div>
      </div>
      <div className="section-heading">
        <h2>{t("Source library", "Biblioteca delle fonti")}</h2>
        <span>
          {t("Reviewed", "Rivisto")} {curriculum.reviewedOn}
        </span>
      </div>
      <div className="filter-tabs">
        {[1, 2, 3].map((c) => (
          <button
            key={c}
            aria-pressed={filter === c}
            onClick={() => setFilter(c)}
          >
            {t("Course", "Corso")} {c}
          </button>
        ))}
      </div>
      <div className="source-list">
        {sources
          .filter((s) => s.course === filter)
          .map((s) => {
            const linked = missions.filter((m) =>
              m.sources.some((r) => r.id === s.id),
            );
            return (
              <details key={s.id}>
                <summary>
                  <Icon name="book" />
                  <span>
                    <strong>{s.title}</strong>
                    <small>{s.path.split("/").slice(0, -1).join(" / ")}</small>
                  </span>
                  <span className="tag">
                    {linked.length
                      ? `${linked.length} ${t("lessons", "lezioni")}`
                      : t("Reference", "Riferimento")}
                  </span>
                </summary>
                <p>
                  {s.pages}{" "}
                  {s.title.endsWith(".pptx")
                    ? t("slides", "diapositive")
                    : t("PDF pages", "pagine PDF")}
                </p>
                {pdfs[s.id] && (
                  <a
                    className="text-button"
                    href={localPdfPageHref(pdfs[s.id], 1, pdfPageOffsets[s.id])}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("Open connected PDF", "Apri PDF collegato")} ↗
                  </a>
                )}
                {!linked.length && (
                  <p>
                    {t(
                      "Reviewed as background or overlapping revision. No dedicated daily lesson is claimed for this file.",
                      "Rivisto come riferimento o ripasso sovrapposto. Non è indicata una lezione quotidiana dedicata a questo file.",
                    )}
                  </p>
                )}
                <div className="linked-lessons">
                  {linked.map((m) => (
                    <button
                      className="text-button"
                      key={m.id}
                      onClick={() => go(`lesson/${m.id}`)}
                    >
                      {text(m.title)} <Icon name="arrow" />
                    </button>
                  ))}
                </div>
              </details>
            );
          })}
      </div>
      <p className="hint">
        {t(
          "Source files remain private. The catalogue includes PDFs and presentations; supporting documents and companion notes are not treated as teacher-verified answer keys.",
          "I file originali restano privati. Il catalogo include PDF e presentazioni; documenti di supporto e appunti complementari non sono trattati come soluzioni verificate dal docente.",
        )}
      </p>
      <span className="sr-only">{p.language}</span>
    </div>
  );
}
