import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ProfileState, ProfileSync } from "./profile-sync";
import "./profile.css";
type Translate = (en: string, it: string) => string;

export function profileStatusText(state: ProfileState, t: Translate) {
  if (state.status === "guest") return t("Save across devices", "Salva su più dispositivi");
  if (state.status === "saving" || state.status === "checking") return t("Saving…", "Salvataggio…");
  if (state.status === "synced") return t("Saved online", "Salvato online");
  if (state.status === "offline") return t("Saved here · waiting for connection", "Salvato qui · in attesa della connessione");
  if (state.status === "conflict") return t("Review changes from another device", "Rivedi le modifiche da un altro dispositivo");
  if (state.status === "expired") return t("Sign in to keep syncing", "Accedi per continuare a sincronizzare");
  if (state.status === "error") return t("Sync paused · work saved on this device", "Sincronizzazione in pausa · lavoro salvato qui");
  return t("Open profile", "Apri il profilo");
}
function errorText(error: string, t: Translate) {
  if (["invalid_credentials", "invalid-credentials", "invalid_login"].includes(error)) return t("Check your username and PIN, then try again.", "Controlla nome utente e PIN, poi riprova.");
  if (error === "try-later" || error.includes("rate") || error.includes("limited")) return t("Too many attempts. Wait a few minutes before trying again.", "Troppi tentativi. Aspetta qualche minuto prima di riprovare.");
  if (error === "profile-unavailable") return t("That profile cannot be created. Try Sign in if it is yours, or choose another username.", "Non è possibile creare questo profilo. Prova Accedi se è tuo, oppure scegli un altro nome utente.");
  if (["new-work-kept", "sign-in-before-sign-out"].includes(error)) return t("Your latest work is still saved here. Sign in again to upload it before leaving this device.", "Il lavoro più recente è ancora salvato qui. Accedi di nuovo per caricarlo prima di lasciare questo dispositivo.");
  if (error === "work-changed") return t("You added more practice while the profile was opening. It is still here; choose again how to open the profile.", "Hai aggiunto pratica mentre si apriva il profilo. È ancora qui; scegli di nuovo come aprire il profilo.");
  if (error.includes("pin")) return t("Choose six digits. Avoid repeated digits and common sequences such as 123456.", "Scegli sei cifre. Evita cifre ripetute e sequenze comuni come 123456.");
  if (error === "offline") return t("Connect to the internet to sign in or sync. Your practice stays saved on this device.", "Connettiti a Internet per accedere o sincronizzare. La pratica resta salvata su questo dispositivo.");
  if (error === "device-storage") return t("This browser could not keep the sync record. Your existing practice has not been discarded; download a backup in Progress.", "Questo browser non ha potuto conservare il registro di sincronizzazione. La pratica esistente non è stata eliminata; scarica un backup in Progressi.");
  if (error === "profile_changed") return t("Another tab changed profiles. Sign in again before syncing this work.", "Un’altra scheda ha cambiato profilo. Accedi di nuovo prima di sincronizzare questo lavoro.");
  return t("The profile could not be opened or saved. Check the details and connection, then try again. Your local practice is still here.", "Non è stato possibile aprire o salvare il profilo. Controlla i dati e la connessione, poi riprova. La pratica locale è ancora qui.");
}
export function ProfileView({ sync, t, go }: { sync: ProfileSync; t: Translate; go: (route: string) => void }) {
  const state = useSyncExternalStore(sync.subscribe, sync.snapshot, sync.snapshot);
  const [creating, setCreating] = useState(!state.username);
  const [username, setUsername] = useState(state.username || "Samuel");
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState("");
  const errorMessage = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (formError || state.error) {
      errorMessage.current?.focus({ preventScroll: true });
      errorMessage.current?.scrollIntoView({ block: "nearest" });
    }
  }, [formError, state.error]);
  const connected = (["synced", "saving", "offline", "conflict"].includes(state.status) || (state.status === "error" && Boolean(state.lastSynced))) && Boolean(state.username);
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } finally { setBusy(false); } };
  const downloadRecovery = async (kind: "local" | "remote" = "local") => {
    const copy = await sync.recovery();
    if (!copy || !copy[kind]) { setDownloadMessage(t("No saved transfer copy yet.", "Nessuna copia di trasferimento salvata.")); return; }
    // The local copy is a normal, restorable Parliamo progress backup.
    const url = URL.createObjectURL(new Blob([JSON.stringify(copy[kind], null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `parliamo-${kind === "local" ? "device" : "online"}-before-sync.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloadMessage(t("Saved copy downloaded. Restore or merge it from Progress if needed.", "Copia salvata scaricata. Puoi ripristinarla o unirla da Progressi."));
  };
  return <div className="workspace profile-page">
    <p className="eyebrow">{t("YOUR LEARNING, WITH YOU", "IL TUO STUDIO, CON TE")}</p>
    <h1>{connected ? state.username : t("A simple study profile.", "Un semplice profilo di studio.")}</h1>
    <p>{t("Use the same username and six-digit PIN on your phone or computer. Lessons, games and drafts come with you.", "Usa lo stesso nome utente e PIN di sei cifre su telefono e computer. Lezioni, giochi e bozze ti seguono.")}</p>
    {state.status === "joining" ? <section className="panel profile-panel">
      <h2>{t(`Open ${state.username} on this device`, `Apri ${state.username} su questo dispositivo`)}</h2>
      <p>{state.foreignLocal ? t("This device has work from a different profile. It will be kept as a recovery copy before opening this profile.", "Questo dispositivo ha lavoro di un altro profilo. Verrà conservato come copia di recupero prima di aprire questo profilo.") : t("There is already practice saved on this device. You can add missing records to your profile or open the profile as it is. Overlapping records keep the profile version; a device copy is kept.", "C’è già pratica salvata su questo dispositivo. Puoi aggiungere i dati mancanti al profilo o aprire il profilo così com’è. In caso di sovrapposizione resta la versione del profilo; conserviamo una copia del dispositivo.")}</p>
      {!state.foreignLocal && <button className="button primary" disabled={busy} onClick={() => void run(() => sync.finishJoin(true))}>{t("Bring my device’s practice too", "Porta anche la pratica del dispositivo")}</button>}
      <button className="button secondary" disabled={busy} onClick={() => void run(() => sync.finishJoin(false))}>{t("Open saved profile", "Apri il profilo salvato")}</button>
    </section> : connected ? <section className="panel profile-panel">
      <p className="profile-sync-status" role="status">{profileStatusText(state, t)}</p>
      {state.status === "conflict" ? <>
        <h2>{t("Two devices changed the same work.", "Due dispositivi hanno modificato lo stesso lavoro.")}</h2>
        <p>{t("Choose which version to use for those overlapping changes. Independent work is combined, and a copy of this device’s work is kept below.", "Scegli quale versione usare per le modifiche sovrapposte. Il lavoro indipendente viene unito e una copia di questo dispositivo resta disponibile sotto.")}</p>
        <button className="button primary" disabled={busy} onClick={() => void run(() => sync.resolve("local"))}>{t("Keep this device’s changes", "Mantieni le modifiche di questo dispositivo")}</button>
        <button className="button secondary" disabled={busy} onClick={() => void run(() => sync.resolve("remote"))}>{t("Use the other device’s changes", "Usa le modifiche dell’altro dispositivo")}</button>
      </> : <div className="button-row">
        <button className="button primary" onClick={() => go("today")}>{t("Continue learning", "Continua a studiare")} →</button>
        <button className="button secondary" disabled={busy || state.status === "saving"} onClick={() => void run(() => sync.flush())}>{t("Sync now", "Sincronizza ora")}</button>
      </div>}
      <p className="hint">{t("Offline practice saves here first and syncs when you reconnect. Wait for “Saved online” before switching devices.", "La pratica offline si salva prima qui e si sincronizza quando torni online. Aspetta «Salvato online» prima di cambiare dispositivo.")}</p>
      <button className="text-button" disabled={busy || state.status === "conflict"} onClick={() => void run(() => sync.logout())}>{t("Save and sign out of this device", "Salva ed esci da questo dispositivo")}</button>
      <p className="hint">{t("Signing out clears this device’s practice after saving it online. Sign in again to bring it back.", "Uscendo, la pratica viene rimossa da questo dispositivo dopo il salvataggio online. Accedi di nuovo per ritrovarla.")}</p>
    </section> : <form className="panel profile-panel" onSubmit={(event) => {
      event.preventDefault(); setFormError("");
      if (creating && pin !== confirmation) { setFormError(t("The two PINs do not match.", "I due PIN non corrispondono.")); return; }
      const submittedPin = pin; setPin(""); setConfirmation("");
      void run(() => sync.connect(username.trim(), submittedPin, creating));
    }}>
      <div className="profile-tabs" aria-label={t("Profile access", "Accesso al profilo")}>
        <button type="button" aria-pressed={creating} disabled={busy} onClick={() => { setCreating(true); setFormError(""); }}>{t("Create profile", "Crea profilo")}</button>
        <button type="button" aria-pressed={!creating} disabled={busy} onClick={() => { setCreating(false); setFormError(""); }}>{t("Sign in", "Accedi")}</button>
      </div>
      <label>{t("Username", "Nome utente")}<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,31}" required value={username} onChange={event => setUsername(event.target.value)} /></label>
      <p className="hint">{t("3–32 letters or numbers; _ and - can follow the first character. Capital letters do not create a different profile.", "3–32 lettere o numeri; _ e - sono ammessi dopo il primo carattere. Le maiuscole non creano un profilo diverso.")}</p>
      <label>{t("Six-digit PIN", "PIN di sei cifre")}<input name="pin" type="password" inputMode="numeric" autoComplete={creating ? "new-password" : "current-password"} minLength={6} maxLength={6} pattern="[0-9]{6}" required value={pin} onChange={event => { setPin(event.target.value.replace(/\D/g, "")); setFormError(""); }} /></label>
      {creating && <label>{t("Repeat PIN", "Ripeti PIN")}<input name="pin-confirmation" type="password" inputMode="numeric" autoComplete="new-password" minLength={6} maxLength={6} pattern="[0-9]{6}" required value={confirmation} onChange={event => { setConfirmation(event.target.value.replace(/\D/g, "")); setFormError(""); }} /></label>}
      {creating && <p className="hint">{t("Choose six digits you can keep safely. We cannot look up a forgotten PIN; keep a progress backup too.", "Scegli sei cifre da conservare al sicuro. Non possiamo recuperare un PIN dimenticato; conserva anche un backup dei progressi.")}</p>}
      <button className="button primary" disabled={busy}>{busy ? t("Connecting…", "Connessione…") : creating ? t("Create my profile", "Crea il mio profilo") : t("Sign in", "Accedi")}</button>
      <button className="text-button" type="button" onClick={() => go("today")}>{t("Keep studying on this device", "Continua a studiare su questo dispositivo")}</button>
    </form>}
    {(formError || state.error) && <p ref={errorMessage} tabIndex={-1} className="feedback" role="alert">{formError || errorText(state.error, t)}</p>}
    <details className="profile-details"><summary>{t("Saved copies & how it works", "Copie salvate e come funziona")}</summary>
      <p>{t("The server stores a salted PIN hash, never the PIN itself. Your browser uses a secure sign-in cookie; the learning records are saved on the server and cached on this device.", "Il server conserva un hash del PIN con un sale, mai il PIN stesso. Il browser usa un cookie di accesso sicuro; i dati di studio sono salvati sul server e conservati su questo dispositivo.")}</p>
      <button className="button secondary" onClick={() => void downloadRecovery().catch(() => setDownloadMessage(t("The saved copy is unavailable in this browser.", "La copia salvata non è disponibile in questo browser.")))}>{t("Download last device copy", "Scarica l’ultima copia del dispositivo")}</button>
      <button className="button secondary" onClick={() => void downloadRecovery("remote").catch(() => setDownloadMessage(t("The saved copy is unavailable in this browser.", "La copia salvata non è disponibile in questo browser.")))}>{t("Download last online copy", "Scarica l’ultima copia online")}</button>
      <button className="text-button" onClick={() => go("progress")}>{t("Progress & backups", "Progressi e backup")} →</button>
      <p role="status">{downloadMessage}</p>
    </details>
  </div>;
}
