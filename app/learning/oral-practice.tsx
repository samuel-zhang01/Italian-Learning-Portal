import { useEffect, useRef, useState } from "react";
import { oralPracticeScenes } from "./oral-practice-data";
import {
  advanceOralPractice, checkOralChoice, completeOralPractice, completeOralTransfer,
  emptyOralPractice, MAX_ORAL_RUNS, oralDueRuns, oralPracticeAtCapacity, oralRunKey,
  saveOralChoice, saveOralPrediction, saveOralRetell, saveOralTransfer,
  seeOralModel, seeOralTranscript, seeOralTransferModel, setOralRetellCheck,
  setOralTransferCheck, startOralPractice,
  type OralCheckKind, type OralPracticeRun, type OralPracticeScene, type OralPracticeState,
} from "./oral-practice-model";
import { catalogueParams, focusStudyHeading } from "./navigation";
import type { Pair, Progress } from "./types";
import "./oral-practice.css";

type Props = {
  p: Progress; t: (en: string, it: string) => string; text: (pair: Pair) => string;
  go: (route: string) => void; today: string; save: (update: (p: Progress) => Progress) => void;
};
type Update = (change: (state: OralPracticeState) => OralPracticeState) => void;
const routeFor = (scene: string, key: string, transfer = false) =>
  `listen-speak?scene=${encodeURIComponent(scene)}&run=${encodeURIComponent(key)}${transfer ? "&return=1" : ""}`;

export function OralPracticeView(props: Props) {
  const { p, t, text, go, today, save } = props;
  const state = p.oralPractice ?? emptyOralPractice();
  const params = catalogueParams(), requestedKey = params.get("run") ?? "";
  const scene = oralPracticeScenes.find((item) => item.id === params.get("scene"));
  const selected = Object.hasOwn(state.runs, requestedKey) ? state.runs[requestedKey] : undefined;
  const run = selected?.sceneId === scene?.id ? selected : undefined;
  const budget = params.get("minutes") === "5" ? 5 : 10;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (!run) return focusStudyHeading(heading.current); }, [run]);
  const update: Update = (change) => save((progress) => {
    const before = progress.oralPractice ?? emptyOralPractice(), after = change(before);
    return before === after ? progress : { ...progress, oralPractice: after };
  });
  if (scene && run) return <OralRun key={`${requestedKey}:${params.get("return") === "1"}`} {...props} {...{ scene, run, update }} runKey={requestedKey} transferMode={params.get("return") === "1"} />;
  const due = oralDueRuns(state, today), limited = oralPracticeAtCapacity(state);
  const runs = Object.entries(state.runs).sort(([a], [b]) => b.localeCompare(a));
  return <div className="workspace oral-practice oral-catalogue">
    <button className="text-button" onClick={() => go("today")}>← {t("Back to today", "Torna a oggi")}</button>
    <p className="eyebrow">{t("LISTEN · UNDERSTAND · MAKE IT YOURS", "ASCOLTA · COMPRENDI · FALLO TUO")}</p>
    <h1 ref={heading} tabIndex={-1}>{t("A short listening & speaking session.", "Una breve sessione di ascolto e parlato.")}</h1>
    <p>{t("Choose this as a short alternative to your usual session. Listen for meaning, check a detail if you have time, then tell a changed version in your own Italian. Your usual plan stays available.", "Scegli questa breve alternativa alla sessione abituale. Ascolta per capire il senso, controlla un dettaglio se hai tempo e poi racconta una versione diversa in italiano. Il tuo piano abituale resta disponibile.")}</p>
    <p className="hint">{t("Written drafts and self-checks save in this browser and in your progress backup. Times are suggestions; you can pause. Playback uses a synthetic Italian device voice. You can also read with support. No microphone is needed.", "Bozze scritte e autoverifiche si salvano in questo browser e nel backup dei progressi. I tempi sono indicativi: puoi fermarti. L’ascolto usa una voce italiana sintetica del dispositivo. Puoi anche leggere con un aiuto. Non serve il microfono.")}</p>
    {requestedKey && !run && <p role="status">{t("That saved session is unavailable here. Choose a scene or open one of your saved sessions below.", "Quella sessione salvata non è disponibile qui. Scegli una scena oppure apri una delle sessioni salvate sotto.")}</p>}
    <fieldset className="oral-budget"><legend>{t("How much time would you like?", "Quanto tempo vuoi dedicare?")}</legend>
      {([5, 10] as const).map((minutes) => <button key={minutes} className={`button ${budget === minutes ? "primary" : "secondary"}`} aria-pressed={budget === minutes} onClick={() => go(`listen-speak?minutes=${minutes}`)}>{minutes} {t("minutes", "minuti")}</button>)}
    </fieldset>
    <p className="oral-recipe">{budget === 5 ? t("About 2 minutes to listen and understand + 3 minutes to retell and self-check.", "Circa 2 minuti per ascoltare e capire + 3 minuti per raccontare e autoverificarti.") : t("About 3 minutes for the gist + 3 for a detail + 4 to retell and self-check.", "Circa 3 minuti per il senso generale + 3 per un dettaglio + 4 per raccontare e autoverificarti.")}</p>
    {limited && <section className="panel" role="status"><h2>{t("Your saved practice is preserved.", "La tua pratica salvata è conservata.")}</h2><p>{t(`You have ${MAX_ORAL_RUNS} saved sessions. You can continue them and their return tasks. New sessions are paused at this limit; export your progress before managing backups.`, `Hai ${MAX_ORAL_RUNS} sessioni salvate. Puoi continuarle e svolgere i relativi compiti successivi. A questo limite le nuove sessioni sono sospese: esporta i progressi prima di gestire i backup.`)}</p><button className="button secondary" onClick={() => go("progress")}>{t("Open progress backups", "Apri i backup dei progressi")}</button></section>}
    {!!due.length && <section className="oral-due panel"><h2>{t("Try a new situation on another day", "Prova una nuova situazione in un altro giorno")}</h2><p>{t("These return tasks use different details. Choose one; there is no penalty for waiting.", "Questi compiti successivi usano dettagli diversi. Scegline uno: aspettare non comporta penalità.")}</p><ul>{due.slice(0, 3).map((item) => {
      const known = oralPracticeScenes.find((entry) => entry.id === item.sceneId)!;
      return <li key={oralRunKey(item.date, item.sceneId)}><button className="text-button" onClick={() => go(routeFor(item.sceneId, oralRunKey(item.date, item.sceneId), true))}>{text(known.title)} · {t("from", "dal")} {item.due} →</button></li>;
    })}</ul>{due.length > 3 && <p>{t("More return tasks are available in saved sessions below.", "Altri compiti successivi sono disponibili nelle sessioni salvate sotto.")}</p>}</section>}
    <div className="oral-scene-grid">{oralPracticeScenes.map((item) => {
      const unfinished = runs.find(([, value]) => value.sceneId === item.id && !value.completed);
      const key = unfinished?.[0] ?? oralRunKey(today, item.id), saved = state.runs[key];
      return <article className="panel" key={item.id}><p className="eyebrow">{item.level} · {t("ORIGINAL SCENE", "SCENA ORIGINALE")}</p><h2>{text(item.title)}</h2><p>{text(item.context)}</p>
        <button className="button primary" disabled={!saved && limited} onClick={() => { if (!saved) update((value) => startOralPractice(value, item.id, budget, today)); go(routeFor(item.id, key)); }}>{saved ? saved.completed ? t("See today’s saved practice", "Vedi la pratica salvata di oggi") : t(`Resume ${saved.budget}-minute practice`, `Riprendi la pratica di ${saved.budget} minuti`) : t(`Start ${budget}-minute practice`, `Inizia la pratica di ${budget} minuti`)} →</button>
        {saved && !saved.completed && <p className="hint">{t("Your existing draft keeps the time option you chose when starting.", "La bozza esistente mantiene il tempo scelto all’inizio.")}</p>}
      </article>;
    })}</div>
    {!!runs.length && <details className="oral-history"><summary>{t("My saved sessions and return tasks", "Le mie sessioni salvate e i compiti successivi")} · {runs.length}</summary><ul>{runs.map(([key, item]) => {
      const known = oralPracticeScenes.find((entry) => entry.id === item.sceneId)!;
      return <li key={key}><button className="text-button" onClick={() => go(routeFor(item.sceneId, key))}>{item.date} · {text(known.title)} · {item.budget} min · {item.completed ? t("self-check saved", "autoverifica salvata") : t("draft", "bozza")}</button>{item.due && item.due <= today && <button className="text-button" onClick={() => go(routeFor(item.sceneId, key, true))}>{item.transfer?.completed ? t("See my return task", "Vedi il compito successivo") : t("Open return task", "Apri il compito successivo")} →</button>}</li>;
    })}</ul></details>}
    <div className="button-row"><button className="text-button" onClick={() => go("listening")}>{t("Practise with my own local audio", "Esercitati con il tuo audio locale")} →</button><button className="text-button" onClick={() => go("progress")}>{t("Back up my progress", "Salva i miei progressi")} →</button></div>
  </div>;
}

function OralRun({ p, t, text, go, today, scene, run, runKey, transferMode, update }: Props & { scene: OralPracticeScene; run: OralPracticeRun; runKey: string; transferMode: boolean; update: Update }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false), [modelOpen, setModelOpen] = useState(false);
  const [voiceError, setVoiceError] = useState(false), [rate, setRate] = useState(1);
  const stage = transferMode ? "transfer" : run.stage;
  useEffect(() => { window.speechSynthesis?.cancel(); return focusStudyHeading(heading.current); }, [stage, run.transfer?.completed]);
  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);
  const speak = () => {
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") { setVoiceError(true); return; }
    const voices = window.speechSynthesis.getVoices(), voice = voices.find((item) => item.lang.toLowerCase().startsWith("it"));
    if (voices.length && !voice) { setVoiceError(true); return; }
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(scene.lines.map((line) => line.text.it).join(" "));
    speech.lang = "it-IT"; speech.rate = rate; if (voice) speech.voice = voice;
    speech.onerror = (event) => { if (!["canceled", "interrupted"].includes(event.error)) setVoiceError(true); };
    setVoiceError(false); window.speechSynthesis.speak(speech);
  };
  const production = transferMode ? scene.transfer : scene.retell;
  const draft = transferMode ? run.transfer?.draft ?? "" : run.retellDraft;
  const checks = transferMode ? run.transfer?.checks ?? [false, false] : run.retellChecks;
  const finished = transferMode ? Boolean(run.transfer?.completed) : Boolean(run.completed);
  const canTransfer = Boolean(run.completed && run.due && run.due <= today);
  const modelSeen = transferMode ? run.transfer?.modelSeen : run.modelSeen;
  const checkKind: OralCheckKind | null = !transferMode && (run.stage === "gist" || run.stage === "detail") ? run.stage : null;
  const question = checkKind ? scene[checkKind] : null, answer = checkKind ? run[checkKind] : null;
  const firstDate = answer?.first?.date, firstChoice = answer?.first?.choiceId;
  useEffect(() => { if (firstDate && firstChoice) return focusStudyHeading(feedback.current); }, [checkKind, firstDate, firstChoice]);
  const title = transferMode ? t("A new situation, another day", "Una nuova situazione, un altro giorno") : run.stage === "gist" ? t("Listen for the main idea", "Ascolta per capire il senso generale") : run.stage === "detail" ? t("Catch one detail", "Cogli un dettaglio") : run.stage === "retell" ? t("Tell a changed version", "Racconta una versione diversa") : t("Your practice is saved", "La tua pratica è salvata");
  const sceneText = <div className="oral-transcript">{scene.lines.map((line, index) => <div key={index}><p lang="it"><b>{line.speaker}:</b> {line.text.it}</p>{p.translations && <p lang="en">{line.text.en}</p>}</div>)}</div>;
  return <div className="workspace oral-practice oral-run">
    <button className="text-button" onClick={() => go("listen-speak")}>← {t("All short sessions", "Tutte le sessioni brevi")}</button>
    <p className="eyebrow">{scene.level} · {text(scene.title)} · {transferMode ? t("RETURN TASK", "COMPITO SUCCESSIVO") : t(`ABOUT ${run.budget} MINUTES`, `CIRCA ${run.budget} MINUTI`)}</p>
    <h1 ref={heading} tabIndex={-1}>{title}</h1>
    {!transferMode && !run.completed && <ol className="oral-stages" aria-label={t("Session stages", "Fasi della sessione")}>{(["gist", ...(run.budget === 10 ? ["detail"] : []), "retell"] as const).map((item) => <li key={item} aria-current={run.stage === item ? "step" : undefined}>{item === "gist" ? t("Main idea", "Senso generale") : item === "detail" ? t("One detail", "Un dettaglio") : t("Retell & self-check", "Racconta e autoverifica")}</li>)}</ol>}
    <p className="hint">{t("Your written work saves as you go. Pause whenever you need; this practice keeps your usual plan unchanged.", "Il lavoro scritto si salva mentre procedi. Fermati quando serve: questa pratica mantiene il tuo piano abituale.")}</p>
    {transferMode && !canTransfer ? <section className="panel" role="status"><h2>{t("Return on another day", "Torna in un altro giorno")}</h2><p>{t("This new situation opens from", "Questa nuova situazione si apre dal")} {run.due ?? "—"}.</p><button className="button secondary" onClick={() => go(routeFor(scene.id, runKey))}>{t("See my saved practice", "Vedi la mia pratica salvata")}</button></section> : <>
      {!transferMode && !run.completed && <section className="panel oral-player">
        <h2>{t("The scene", "La scena")}</h2><p>{text(scene.context)}</p>
        {run.stage === "gist" && <details><summary>{t("Before listening: make a prediction", "Prima di ascoltare: fai una previsione")}</summary><label className="field">{t("My prediction · optional", "La mia previsione · facoltativa")}<textarea rows={2} maxLength={500} value={run.prediction} disabled={!!run.gist.first} onChange={(event) => update((value) => saveOralPrediction(value, runKey, event.target.value))} /></label></details>}
        <div className="button-row"><button className="button secondary" onClick={speak}>{t("Listen to the scene", "Ascolta la scena")}</button><button className="text-button" onClick={() => window.speechSynthesis?.cancel()}>{t("Stop voice", "Ferma la voce")}</button><label className="field oral-rate">{t("Voice speed", "Velocità della voce")}<select value={rate} onChange={(event) => setRate(Number(event.target.value))}><option value={0.75}>0.75×</option><option value={0.9}>0.9×</option><option value={1}>1×</option></select></label></div>
        <p className="hint">{t("Synthetic Italian device voice. Replay freely. If listening is unavailable, open the text and practise reading with support.", "Voce italiana sintetica del dispositivo. Riascolta liberamente. Se l’ascolto non è disponibile, apri il testo ed esercitati nella lettura con un aiuto.")}</p>
        {voiceError && <p role="status">{t("An Italian voice is unavailable here. You can read the scene below or ask someone to read it aloud.", "Qui non è disponibile una voce italiana. Puoi leggere la scena sotto oppure chiedere a qualcuno di leggerla ad alta voce.")}</p>}
        <button className="text-button" aria-expanded={transcriptOpen} onClick={() => { if (!transcriptOpen) update((value) => seeOralTranscript(value, runKey)); setTranscriptOpen(!transcriptOpen); }}>{transcriptOpen ? t("Hide scene text", "Nascondi il testo della scena") : t("Read scene text · use support", "Leggi il testo della scena · usa un aiuto")}</button>
        {transcriptOpen && sceneText}
        {run.transcriptSeen && <p className="hint">{t("Text support has been used in this session. Your earlier first answers keep their original record.", "In questa sessione è stato usato il testo come aiuto. Le prime risposte precedenti mantengono la loro registrazione originale.")}</p>}
      </section>}
      {checkKind && question && answer && <section className="panel oral-question">
        <h2>{text(question.prompt)}</h2><fieldset disabled={!!answer.first}><legend>{t("Choose the meaning", "Scegli il significato")}</legend>{question.options.map((option) => <label className="oral-option" key={option.id}><input type="radio" name={checkKind} value={option.id} checked={answer.selection === option.id} onChange={() => update((value) => saveOralChoice(value, runKey, checkKind, option.id))} /><span>{text(option.label)}</span></label>)}</fieldset>
        {!answer.first ? <button className="button primary" disabled={!answer.selection} onClick={() => update((value) => checkOralChoice(value, runKey, checkKind, today))}>{t("Check my understanding", "Controlla la mia comprensione")}</button> : <>
          <div ref={feedback} tabIndex={-1} className={`feedback ${answer.first.correct ? "correct" : "retry"}`} role="status"><strong>{answer.first.correct ? t("That meaning fits.", "Quel significato è corretto.") : t("Compare this with the scene, then continue.", "Confronta questa risposta con la scena, poi continua.")}</strong><p>{text(question.explanation)}</p><p>{t("First response:", "Prima risposta:")} {text(question.options.find((option) => option.id === answer.first!.choiceId)!.label)}</p><p>{answer.first.supported ? t("Text or model support was recorded before this answer.", "Prima di questa risposta è stato registrato l’uso del testo o del modello.") : t("No text or model support was recorded before this answer.", "Prima di questa risposta non è stato registrato l’uso del testo o del modello.")}</p></div>
          <button className="button primary oral-continue" onClick={() => update((value) => advanceOralPractice(value, runKey))}>{t("Continue", "Continua")} →</button>
        </>}
      </section>}
      {(run.stage === "retell" || transferMode) && !finished && <section className="panel oral-production">
        <h2>{transferMode ? t("Use Italian with fresh details", "Usa l’italiano con dettagli nuovi") : t("Make one change", "Cambia un dettaglio")}</h2><p>{text(production.prompt)}</p><div className="oral-frame"><p lang="it">{production.frame.it}</p>{p.translations && <p lang="en">{production.frame.en}</p>}</div>
        <label className="field">{t("My version, or notes from speaking", "La mia versione, o appunti dal parlato")}<textarea lang="it" rows={5} maxLength={2000} value={draft} onChange={(event) => update((value) => transferMode ? saveOralTransfer(value, runKey, event.target.value, today) : saveOralRetell(value, runKey, event.target.value))} /></label>
        <button className="text-button" aria-expanded={modelOpen} onClick={() => { if (!modelOpen) update((value) => transferMode ? seeOralTransferModel(value, runKey, today) : seeOralModel(value, runKey)); setModelOpen(!modelOpen); }}>{modelOpen ? t("Hide possible version", "Nascondi una versione possibile") : t("Show a possible version · use support", "Mostra una versione possibile · usa un aiuto")}</button>
        {modelOpen && <div className="oral-model"><p lang="it">{production.model.it}</p>{p.translations && <p lang="en">{production.model.en}</p>}</div>}
        {modelSeen && <p className="hint">{t("Model support is recorded for this task.", "L’uso del modello come aiuto è registrato per questo compito.")}</p>}
        <fieldset className="oral-self-check" disabled={!draft.trim()}><legend>{t("My self-check", "La mia autoverifica")}</legend>{production.rubric.map((criterion, index) => <label key={index}><input type="checkbox" checked={checks[index]} onChange={(event) => update((value) => transferMode ? setOralTransferCheck(value, runKey, index, event.target.checked, today) : setOralRetellCheck(value, runKey, index, event.target.checked))} /> {text(criterion)}</label>)}</fieldset>
        <p className="hint">{t("These checks are your own assessment of your version. The app does not grade pronunciation or spontaneous speaking. Editing your version clears its checks so you can check it again.", "Questi controlli sono la tua valutazione della versione. L’app non valuta la pronuncia o il parlato spontaneo. Modificando la versione, le caselle si svuotano per permetterti di ricontrollarla.")}</p>
        <button className="button primary oral-complete" disabled={!draft.trim() || !checks.every(Boolean)} onClick={() => update((value) => transferMode ? completeOralTransfer(value, runKey, today) : completeOralPractice(value, runKey, today))}>{t("Save my self-check", "Salva la mia autoverifica")}</button>
      </section>}
      {finished && <section className="panel oral-summary" role="status"><h2>{transferMode ? t("Your return task is saved", "Il tuo compito successivo è salvato") : t("A small practice, completed", "Una piccola pratica completata")}</h2><p>{t("Self-check saved on", "Autoverifica salvata il")} {transferMode ? run.transfer?.completed : run.completed}.</p><p lang="it" className="oral-saved-output">{draft}</p><p>{modelSeen ? t("A possible version was opened as support.", "Una versione possibile è stata aperta come aiuto.") : t("No model was opened for this task.", "Per questo compito non è stato aperto un modello.")}</p><p>{t("This records practice and your self-check, not a speaking level or proof of improvement.", "Questa traccia registra la pratica e la tua autoverifica, non un livello di parlato o una prova di miglioramento.")}</p>
        {!transferMode && <><ul className="oral-first-results">{(["gist", ...(run.budget === 10 ? ["detail"] : [])] as OralCheckKind[]).map((kind) => <li key={kind}>{kind === "gist" ? t("Main idea", "Senso generale") : t("Detail", "Dettaglio")}: {run[kind].first?.correct ? t("first answer fitted", "prima risposta corretta") : t("first answer needed feedback", "prima risposta da rivedere")} · {run[kind].first?.supported ? t("text/model support used", "testo/modello usato come aiuto") : t("no text/model support recorded", "nessun aiuto da testo/modello registrato")}</li>)}</ul><p>{t("A different situation is available from", "Una situazione diversa è disponibile dal")} {run.due}.</p>{canTransfer && <button className="button secondary" onClick={() => go(routeFor(scene.id, runKey, true))}>{run.transfer?.completed ? t("See my return task", "Vedi il compito successivo") : t("Try the new situation", "Prova la nuova situazione")} →</button>}</>}
        {transferMode && <details><summary>{t("Compare with my earlier version", "Confronta con la mia versione precedente")}</summary><p lang="it" className="oral-saved-output">{run.retellDraft}</p><p>{t("The situations differ. Use your own checks or discuss both versions with a teacher; their length is not a progress score.", "Le situazioni sono diverse. Usa le tue autoverifiche o discuti entrambe le versioni con un insegnante: la lunghezza non è un punteggio di progresso.")}</p></details>}
        <div className="button-row"><button className="button primary" onClick={() => go("today")}>{t("Back to today", "Torna a oggi")}</button><button className="button secondary" onClick={() => go("weekly")}>{t("See my week of practice", "Vedi la mia settimana di pratica")}</button></div>
      </section>}
    </>}
    <p className="hint"><button className="text-button" onClick={() => go("progress")}>{t("Back up my progress", "Salva i miei progressi")} →</button></p>
  </div>;
}
