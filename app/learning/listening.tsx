import { useEffect, useRef, useState } from "react";
import { createLocalAudioStore, listeningEndAction, listeningRange, transcriptLines } from "./listening-model";
import { focusStudyHeading } from "./navigation";
import "./listening.css";

type Props = { t: (en: string, it: string) => string };
const originals = [
  { id: "market", en: "A small purchase · A1", it: "Un piccolo acquisto · A1", lines: ["Vorrei due panini e una bottiglia d’acqua.", "Quanto costa tutto?", "Sono cinque euro e cinquanta."] },
  { id: "meeting", en: "An invitation · A1", it: "Un invito · A1", lines: ["Sabato vado al parco con mia sorella.", "Vuoi venire con noi?", "Ci incontriamo davanti al bar alle dieci."] },
  { id: "delay", en: "A change of plan · A2", it: "Un cambio di programma · A2", lines: ["Aspettavo il tram quando ha cominciato a piovere.", "Ho chiamato Luca e abbiamo cambiato programma.", "Alla fine siamo andati al museo a piedi."] },
];

export function ListeningView({ t }: Props) {
  const [store] = useState(() => createLocalAudioStore());
  const audio = useRef<HTMLAudioElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const sectionActive = useRef(false);
  const [file, setFile] = useState<{ name: string; url: string } | null>(null);
  const [mode, setMode] = useState<"local" | "original">("local");
  const [originalId, setOriginalId] = useState(originals[0].id);
  const [duration, setDuration] = useState(0), [start, setStart] = useState(0), [end, setEnd] = useState(0);
  const [repeating, setRepeating] = useState(false), [rate, setRate] = useState(1);
  const [pasted, setPasted] = useState(""), [readyTranscript, setReadyTranscript] = useState("");
  const [visible, setVisible] = useState(0), [dictation, setDictation] = useState("");
  const [checks, setChecks] = useState<boolean[]>([]), [error, setError] = useState<"file" | "decode" | "play" | "voice" | null>(null);
  const original = originals.find((item) => item.id === originalId)!;
  const lines = mode === "original" ? original.lines : transcriptLines(readyTranscript);
  const range = listeningRange(start, end, duration);
  useEffect(() => focusStudyHeading(heading.current), []);
  useEffect(() => () => { store.clear(); window.speechSynthesis?.cancel(); }, [store]);
  const resetTask = () => { setVisible(0); setDictation(""); setChecks([]); setError(null); };
  const detach = () => {
    sectionActive.current = false;
    const player = audio.current;
    if (player) { player.pause(); player.removeAttribute("src"); player.load(); }
    store.clear(); setFile(null); setDuration(0); setRepeating(false);
  };
  const playSection = async () => {
    if (!audio.current || !range) return;
    sectionActive.current = true;
    audio.current.currentTime = range.start;
    audio.current.playbackRate = rate;
    try { await audio.current.play(); setError(null); } catch { sectionActive.current = false; setError("play"); }
  };
  const sayOriginal = () => {
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") { setError("voice"); return; }
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(original.lines.join(" "));
    speech.lang = "it-IT"; speech.rate = rate; speech.onerror = (event) => { if (!["canceled", "interrupted"].includes(event.error)) setError("voice"); };
    window.speechSynthesis.speak(speech); setError(null);
  };
  return <div className="workspace listening-workspace">
    <p className="eyebrow">{t("LISTEN · REPLAY · CHECK YOURSELF", "ASCOLTA · RIPETI · AUTOVERIFICA")}</p>
    <h1 ref={heading} tabIndex={-1}>{t("A little listening, at your pace.", "Un po’ di ascolto, al tuo ritmo.")}</h1>
    <p>{t("Choose an audio file from your device, or try an original portal dictation. Your audio, pasted transcript and response stay in this tab and are not uploaded or included in progress backups. Leaving or reloading clears this workspace.", "Scegli un file audio dal dispositivo oppure prova un dettato originale del portale. Audio, trascrizione incollata e risposta restano in questa scheda: non vengono caricati né inclusi nei backup dei progressi. Uscendo o ricaricando, questo spazio si svuota.")}</p>
    <div className="button-row" role="group" aria-label={t("Listening source", "Fonte dell’ascolto")}>
      <button className="button secondary" aria-pressed={mode === "local"} onClick={() => { if (mode === "local") return; setMode("local"); window.speechSynthesis?.cancel(); resetTask(); }}>{t("My local audio", "Il mio audio locale")}</button>
      <button className="button secondary" aria-pressed={mode === "original"} onClick={() => { if (mode === "original") return; sectionActive.current = false; audio.current?.pause(); setRepeating(false); setMode("original"); resetTask(); }}>{t("Original dictation", "Dettato originale")}</button>
    </div>
    {mode === "local" ? <section className="panel">
      <h2>{t("Bring a recording", "Scegli una registrazione")}</h2>
      <label className="file-button">{t("Choose local audio", "Scegli un audio locale")}
        <input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.opus,.flac" onChange={(event) => {
          const selected = event.target.files?.[0]; event.target.value = ""; if (!selected) return;
          sectionActive.current = false; audio.current?.pause();
          const connection = store.connect(selected);
          if (!connection) { setError("file"); return; }
          setFile(connection); setDuration(0); setStart(0); setEnd(0); setRepeating(false); setPasted(""); setReadyTranscript(""); resetTask();
        }} />
      </label>
      {file && <>
        <p className="listening-filename">{file.name} <button className="text-button" onClick={() => { detach(); resetTask(); }}>{t("Disconnect audio", "Scollega l’audio")}</button></p>
        <audio ref={audio} src={file.url} controls preload="metadata" onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (!Number.isFinite(value) || value <= 0) { setError("decode"); return; }
          setDuration(value); setEnd(value); event.currentTarget.playbackRate = rate;
        }} onError={() => { setError("decode"); setRepeating(false); }} onTimeUpdate={(event) => {
          const action = listeningEndAction(event.currentTarget.currentTime, range, repeating, sectionActive.current);
          if (action?.type === "repeat") event.currentTarget.currentTime = action.time;
          if (action?.type === "pause") { sectionActive.current = false; event.currentTarget.pause(); event.currentTarget.currentTime = action.time; }
        }} onPause={(event) => { if (!event.currentTarget.ended) sectionActive.current = false; }} onEnded={() => { if (sectionActive.current && repeating && range) void playSection(); else sectionActive.current = false; }} />
        <div className="listening-range">
          <label className="field">{t("Section start · seconds", "Inizio del tratto · secondi")}<input type="number" min={0} max={duration || undefined} step="0.1" value={start} onChange={(event) => { setRepeating(false); setStart(Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0); }} /></label>
          <label className="field">{t("Section end · seconds", "Fine del tratto · secondi")}<input type="number" min={0} max={duration || undefined} step="0.1" value={end} onChange={(event) => { setRepeating(false); setEnd(Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0); }} /></label>
        </div>
        <p className="hint">{t("Choose at least a quarter-second within the recording. Play the section once, or repeat it until you pause.", "Scegli almeno un quarto di secondo nella registrazione. Ascolta il tratto una volta oppure ripetilo finché metti in pausa.")}</p>
        <div className="button-row"><button className="button secondary" disabled={!range} onClick={() => void playSection()}>{t("Play this section", "Ascolta questo tratto")}</button><label><input type="checkbox" disabled={!range} checked={repeating} onChange={(event) => setRepeating(event.target.checked)} /> {t("Repeat this section", "Ripeti questo tratto")}</label></div>
      </>}
      <details className="listening-transcript-editor"><summary>{t("Paste or change my transcript", "Incolla o cambia la trascrizione")}</summary>
        <label className="field">{t("Transcript for this recording", "Trascrizione della registrazione")}<textarea lang="it" maxLength={20000} rows={5} value={pasted} onChange={(event) => setPasted(event.target.value)} /></label>
        <button className="button secondary" onClick={(event) => { setReadyTranscript(pasted); resetTask(); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{t("Use this transcript for reveal", "Usa questa trascrizione per lo svelamento")}</button>
      </details>
    </section> : <section className="panel">
      <h2>{t("An original short scene", "Una breve scena originale")}</h2>
      <label className="field">{t("Choose a scene", "Scegli una scena")}<select value={originalId} onChange={(event) => { window.speechSynthesis?.cancel(); setOriginalId(event.target.value); resetTask(); }}>{originals.map((item) => <option key={item.id} value={item.id}>{t(item.en, item.it)}</option>)}</select></label>
      <p>{t("Listen before revealing the text. Playback uses your device’s synthetic Italian voice, not a publisher recording. If no voice is available, ask someone to read the revealed lines while you look away.", "Ascolta prima di svelare il testo. La lettura usa la voce italiana sintetica del dispositivo, non una registrazione dell’editore. Se la voce non è disponibile, chiedi a qualcuno di leggere le frasi svelate mentre non guardi.")}</p>
      <div className="button-row"><button className="button secondary" onClick={sayOriginal}>{t("Listen to the original dictation", "Ascolta il dettato originale")}</button><button className="text-button" onClick={() => window.speechSynthesis?.cancel()}>{t("Stop voice", "Ferma la voce")}</button></div>
    </section>}
    <label className="field listening-rate">{t("Playback speed", "Velocità di ascolto")}<select value={rate} onChange={(event) => { const value = Number(event.target.value); setRate(value); if (audio.current) audio.current.playbackRate = value; }}><option value={0.75}>0.75×</option><option value={0.9}>0.9×</option><option value={1}>1×</option></select></label>
    {error && <p role="status" className="feedback">{error === "file" ? t("Choose a nonempty audio file under 500 MB. Your current audio remains connected.", "Scegli un file audio non vuoto sotto 500 MB. L’audio attuale resta collegato.") : error === "decode" ? t("This browser could not read the recording. Try another audio format.", "Il browser non riesce a leggere la registrazione. Prova un altro formato audio.") : error === "voice" ? t("The Italian device voice is unavailable. You can reveal the text and read with a partner.", "La voce italiana del dispositivo non è disponibile. Puoi svelare il testo e leggere con un’altra persona.") : t("Playback did not start. Use the recording’s play control and try again.", "La riproduzione non è iniziata. Usa il comando di ascolto della registrazione e riprova.")}</p>}
    <details className="listening-routine">
      <summary>{t("A short listening-to-speaking routine", "Un breve percorso dall’ascolto al parlato")}</summary>
      <p>{t("For a ten-minute sitting, choose just a few lines. Try these steps with your recording or an original scene; pause whenever you need.", "Per una sessione di dieci minuti, scegli solo poche frasi. Prova questi passi con la tua registrazione o una scena originale; fermati quando serve.")}</p>
      <ol>
        <li>{t("Before playing, predict the situation from the title or context.", "Prima di ascoltare, prova a prevedere la situazione dal titolo o dal contesto.")}</li>
        <li>{t("Listen once with the transcript hidden. Say the main idea in a few words.", "Ascolta una volta con la trascrizione nascosta. Esprimi l’idea principale in poche parole.")}</li>
        <li>{t("Replay one uncertain detail, such as a time, a place or a verb ending.", "Riascolta un dettaglio incerto, per esempio un orario, un luogo o una desinenza verbale.")}</li>
        <li>{t("Reveal a line and compare it with what you heard. Choose one useful phrase.", "Svela una frase e confrontala con quello che hai sentito. Scegli un’espressione utile.")}</li>
        <li>{t("Hide the text. Say or write a short version with one detail changed, then check your meaning. You can use the response box below.", "Nascondi il testo. Racconta o scrivi una breve versione cambiando un dettaglio, poi controlla il senso. Puoi usare lo spazio per la risposta qui sotto.")}</li>
      </ol>
    </details>
    <section className="panel">
      <h2>{t("Write what you hear", "Scrivi quello che senti")}</h2>
      <label className="field">{t("My dictation or short summary", "Il mio dettato o breve riassunto")}<textarea lang="it" maxLength={3000} rows={5} value={dictation} onChange={(event) => { setDictation(event.target.value); setChecks([]); }} /></label>
      <p className="hint">{t("Try one sentence at a time. This response is self-assessed; there is no automatic writing or speech grade and no extra XP.", "Prova una frase alla volta. La risposta è autovalutata: non riceve un voto automatico sul testo o sul parlato né XP aggiuntivi.")}</p>
      <div className="button-row"><button className="button secondary" disabled={!lines.length || visible >= lines.length} onClick={() => setVisible((value) => Math.min(lines.length, value + 1))}>{t("Reveal one more line", "Svela un’altra frase")}</button><button className="text-button" disabled={!lines.length} onClick={() => setVisible(0)}>{t("Hide transcript", "Nascondi la trascrizione")}</button></div>
      {!lines.length && <p>{t("Paste a transcript above if you want to compare words. You can also replay your recording and self-check without one.", "Incolla una trascrizione qui sopra per confrontare le parole. Puoi anche riascoltare e autoverificarti senza trascrizione.")}</p>}
      {visible > 0 && <ol className="listening-reveal" lang="it">{lines.slice(0, visible).map((line, index) => <li key={index}>{line}</li>)}</ol>}
      <fieldset className="listening-checks" disabled={!dictation.trim()}><legend>{t("My listening self-check", "La mia autoverifica di ascolto")}</legend>{[
        ["I replayed a difficult section.", "Ho riascoltato un tratto difficile."], ["I compared meaning and at least one verb ending.", "Ho confrontato il senso e almeno una desinenza verbale."], ["I chose one phrase to say aloud again.", "Ho scelto una frase da ripetere ad alta voce."],
      ].map(([en, it], index) => <label key={en}><input type="checkbox" checked={checks[index] ?? false} onChange={(event) => setChecks((values) => [0, 1, 2].map((i) => i === index ? event.target.checked : Boolean(values[i])))} /> {t(en, it)}</label>)}</fieldset>
      <p role="status">{dictation.trim() && [0, 1, 2].every((i) => checks[i]) ? t("Self-check complete for this tab. Keep your own notes before leaving.", "Autoverifica completata per questa scheda. Conserva i tuoi appunti prima di uscire.") : t("Your response and checks stay here until you leave or reload.", "Risposta e autoverifiche restano qui finché non esci o ricarichi.")}</p>
    </section>
  </div>;
}
