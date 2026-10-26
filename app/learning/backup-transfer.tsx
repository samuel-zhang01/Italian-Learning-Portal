import { useEffect, useMemo, useRef, useState } from "react";
import { parseProgress, STORAGE_KEY } from "./engine";
import { backupCounts, backupMergeBase, mergeProgressBackups } from "./backup-merge";
import { MAX_ORAL_RUNS } from "./oral-practice-model";
import type { Progress } from "./types";
import "./backup-transfer.css";

type Props = {
  current: Progress;
  ids: string[];
  t: (en: string, it: string) => string;
  apply: (progress: Progress) => boolean;
  mergeDisabled?: boolean;
};
export function BackupTransfer({ current, ids, t, apply, mergeDisabled = false }: Props) {
  const [pending, setPending] = useState<Progress | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const [override, setOverride] = useState<{ atCurrent: Progress; progress: Progress } | null>(null);
  const request = useRef(0);
  const previouslySaved = useRef(false);
  useEffect(() => () => { request.current += 1; }, []);
  const base = override?.atCurrent === current ? override.progress : current;
  const oralMergeOverLimit = !!pending && new Set([...Object.keys(base.oralPractice?.runs ?? {}), ...Object.keys(pending.oralPractice?.runs ?? {})]).size > MAX_ORAL_RUNS;
  const preview = useMemo(() => {
    if (!pending || mergeDisabled) return null;
    try { return mergeProgressBackups(base, pending, ids, base.updatedAt); }
    catch { return null; }
  }, [base, pending, ids, mergeDisabled]);
  const read = async (file: File | undefined) => {
    if (!file) return;
    const operation = ++request.current;
    setPending(null); setName(""); setMessage(""); setChecking(true);
    try {
      try { previouslySaved.current = localStorage.getItem(STORAGE_KEY) !== null; } catch { previouslySaved.current = false; }
      if (!file.size || file.size > 8_000_000) throw new Error("backup-size");
      const value = parseProgress(await file.text(), ids);
      if (request.current !== operation) return;
      setPending(value); setName(file.name);
    } catch {
      if (request.current === operation) setMessage(t("This is not a valid Parliamo backup. Your current progress is unchanged.", "Questo non è un backup Parliamo valido. I progressi attuali non sono cambiati."));
    } finally { if (request.current === operation) setChecking(false); }
  };
  const accept = (mode: "merge" | "replace") => {
    if (!pending || (mode === "merge" && (!preview || mergeDisabled))) return;
    if (mode === "merge") {
      // Recheck browser-local work before applying an earlier preview. A second
      // tab may have saved while the selected file was being read or inspected.
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const fresh = backupMergeBase(base, raw, ids, previouslySaved.current);
        previouslySaved.current = fresh.previouslySaved;
          if (fresh.changed) {
            setOverride({ atCurrent: current, progress: fresh.progress });
            setMessage(t("The work saved here changed. The preview is updated; review it and choose again.", "Il lavoro salvato qui è cambiato. L’anteprima è aggiornata: controllala e scegli di nuovo."));
            return;
          }
      } catch {
        setMessage(t("The current saved record could not be checked. Export it for recovery or use the explicit replacement option.", "Non è stato possibile controllare il salvataggio attuale. Esportalo per recuperarlo oppure usa la sostituzione esplicita."));
        return;
      }
    }
    try {
      const progress = mode === "merge" ? mergeProgressBackups(base, pending, ids).progress
        : { ...pending, updatedAt: new Date().toISOString() };
      if (!apply(progress)) throw new Error("storage");
      setPending(null); setName("");
      setMessage(mode === "merge" ? t("Missing work merged. Existing answers, drafts and schedules were kept.", "Lavoro mancante unito. Risposte, bozze e scadenze già presenti sono state conservate.") : t("Progress restored.", "Progressi ripristinati."));
    } catch {
      setMessage(t("The backup was not applied. Storage may be unavailable; keep both backup files.", "Il backup non è stato applicato. Il salvataggio potrebbe non essere disponibile: conserva entrambi i file di backup."));
    }
  };
  const labels = {
    lessons: t("Completed lessons", "Lezioni completate"), lessonDrafts: t("Lesson drafts", "Bozze delle lezioni"),
    sessions: t("Saved sessions", "Sessioni salvate"), grammar: t("Grammar records", "Schede di grammatica"),
    words: t("Personal words", "Parole personali"), games: t("Game records", "Schede dei giochi"), diagnostics: t("Chapter checks", "Controlli dei capitoli"),
    oralPractice: t("Listening & speaking runs", "Sessioni di ascolto e parlato"),
  };
  const here = backupCounts(base), incoming = pending && backupCounts(pending);
  return <div className="backup-transfer">
    <label className="file-button">{t("Choose a backup to restore", "Scegli un backup da ripristinare")}
      <input type="file" accept=".json,application/json" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void read(file); }} />
    </label>
    {checking && <p role="status">{t("Checking this backup locally…", "Controllo locale del backup…")}</p>}
    {pending && incoming && <div className="restore-preview">
      <h3>{t("Review before restoring", "Controlla prima di ripristinare")}</h3>
      <p className="backup-filename">{name}</p>
      <p>{t("Selecting a file has not changed your work. Keep a current export before combining or replacing progress.", "La selezione del file non ha cambiato il tuo lavoro. Conserva un’esportazione attuale prima di unire o sostituire i progressi.")}</p>
      <table><thead><tr><th scope="col">{t("Saved work", "Lavoro salvato")}</th><th scope="col">{t("Here", "Qui")}</th><th scope="col">{t("Backup", "Backup")}</th></tr></thead><tbody>{Object.entries(labels).map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{here[key as keyof typeof here]}</td><td>{incoming[key as keyof typeof incoming]}</td></tr>)}</tbody></table>
      <h4>{t("Merge missing work", "Unisci il lavoro mancante")}</h4>
      <p>{t("Merge adds missing records and nonoverlapping answers. It keeps this browser’s existing first attempts, drafts, review dates, settings and active study day. Different overlapping entries stay here; keep the source backup to retain its alternatives.", "L’unione aggiunge schede mancanti e risposte non sovrapposte. Conserva primi tentativi, bozze, date di ripasso, impostazioni e giorno di studio attivo di questo browser. Le voci sovrapposte diverse restano quelle presenti qui: conserva il backup di origine per mantenere le alternative.")}</p>
      {preview ? <p role="status">{t(`${preview.additions} missing entries can be added; ${preview.conflicts} differing overlaps will keep the current version.`, `Si possono aggiungere ${preview.additions} voci mancanti; ${preview.conflicts} sovrapposizioni diverse manterranno la versione attuale.`)}</p> : <p role="status">{oralMergeOverLimit && !mergeDisabled ? t(`Together these backups contain more than ${MAX_ORAL_RUNS} distinct listening and speaking sessions. Merge would exceed the storage limit. Keep both backups; no saved work has been removed.`, `Insieme questi backup contengono più di ${MAX_ORAL_RUNS} sessioni distinte di ascolto e parlato. L’unione supererebbe il limite di archiviazione. Conserva entrambi i backup: nessun lavoro salvato è stato eliminato.`) : t("Merge is unavailable until the current saved work can be validated. The replacement option below remains explicit.", "L’unione non è disponibile finché il lavoro attuale non può essere convalidato. La sostituzione qui sotto rimane un’azione esplicita.")}</p>}
      <button className="button primary" disabled={!preview || !preview.additions || mergeDisabled} onClick={() => accept("merge")}>{t("Merge missing work", "Unisci il lavoro mancante")}</button>
      <h4>{t("Replace everything here", "Sostituisci tutto qui")}</h4>
      <p>{t("Replacement discards this browser’s current progress and uses the selected backup’s work and settings instead. It is separate from merge.", "La sostituzione elimina i progressi attuali di questo browser e usa il lavoro e le impostazioni del backup selezionato. È distinta dall’unione.")}</p>
      <div className="button-row"><button className="button secondary" onClick={() => accept("replace")}>{t("Replace & restore", "Sostituisci e ripristina")}</button><button className="text-button" onClick={() => { request.current += 1; setPending(null); setName(""); setMessage(t("Backup not applied.", "Backup non applicato.")); }}>{t("Cancel", "Annulla")}</button></div>
    </div>}
    <p role="status">{message}</p>
  </div>;
}
