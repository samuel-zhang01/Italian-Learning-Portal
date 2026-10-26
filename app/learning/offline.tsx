import { useEffect, useState } from "react";

type Props = { t: (en: string, it: string) => string };
export function offlineWorkerScriptUrl(release: string | null | undefined) {
  return release && /^[a-f0-9]{16}$/.test(release) ? `/offline-worker.js?release=${release}` : "/offline-worker.js";
}
export async function latestOfflineWorkerScriptUrl(currentRelease: string | null | undefined) {
  // Ordinary query fetches bypass the pinned navigation shell. A new nonce
  // also avoids reusing an edge-cached response from an earlier release.
  const response = await fetch(`/?parliamo-offline-release=${crypto.randomUUID()}`, { cache: "no-store", credentials: "same-origin", redirect: "error" });
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("text/html")) throw new Error("offline-release-response");
  const html = await response.text();
  if (html.length > 1_000_000) throw new Error("offline-release-size");
  const metas = new DOMParser().parseFromString(html, "text/html").querySelectorAll<HTMLMetaElement>('meta[name="parliamo-offline-version"]');
  if (metas.length > 1 || (metas.length === 1 && !/^[a-f0-9]{16}$/.test(metas[0].content))) throw new Error("offline-release-metadata");
  // Successful legacy HTML may not have a release tag. Network failures never
  // fall back to an old release and pretend an update was checked.
  return offlineWorkerScriptUrl(metas.length ? metas[0].content : currentRelease);
}
export function isOfflineWorkerScript(scriptURL: string | undefined, origin: string) {
  if (!scriptURL) return false;
  try { const url = new URL(scriptURL); return url.origin === origin && url.pathname === "/offline-worker.js"; }
  catch { return false; }
}
export function OfflineStudy({ t }: Props) {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "ready" | "error" | "removed">("idle");
  const [update, setUpdate] = useState(false);
  const supported = typeof navigator !== "undefined" && "serviceWorker" in navigator && window.isSecureContext;
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    navigator.serviceWorker.getRegistration("/").then(reg => {
      if (alive && reg && isOfflineWorkerScript(reg.active?.scriptURL, window.location.origin)) {
        setRegistration(reg); setStatus("ready"); setUpdate(Boolean(reg.waiting));
      }
    }).catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [supported]);
  async function download() {
    setBusy(true);
    try {
      const release = document.querySelector<HTMLMetaElement>('meta[name="parliamo-offline-version"]')?.content;
      const reg = await navigator.serviceWorker.register(await latestOfflineWorkerScriptUrl(release), { scope: "/", updateViaCache: "none" });
      await reg.update();
      const worker = reg.installing;
      if (worker) await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => { worker.removeEventListener("statechange", check); reject(new Error("timeout")); }, 90000);
        function check() {
          if (["installed", "activated", "redundant"].includes(worker!.state)) {
            clearTimeout(timer); worker!.removeEventListener("statechange", check);
            if (worker!.state === "redundant") reject(new Error("installation")); else resolve();
          }
        }
        worker.addEventListener("statechange", check); check();
      });
      if (!reg.active && !reg.waiting) {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error("activation")), 15000);
          navigator.serviceWorker.ready.then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); reject(new Error("activation")); });
        });
      }
      setRegistration(reg); setStatus("ready"); setUpdate(Boolean(reg.waiting));
    } catch { setStatus("error"); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try {
      if (registration && isOfflineWorkerScript(registration.active?.scriptURL, window.location.origin)) await registration.unregister();
      for (const key of await caches.keys()) if (key.startsWith("parliamo-public-")) await caches.delete(key);
      setRegistration(null); setUpdate(false); setStatus("removed");
    } catch { setStatus("error"); } finally { setBusy(false); }
  }
  function activate() {
    if (!registration?.waiting) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    registration.waiting.postMessage("ACTIVATE_UPDATE");
  }
  return <section className="workspace offline-study">
    <p className="eyebrow">{t("Study on this device", "Studia su questo dispositivo")}</p>
    <h1>{t("Offline study", "Studio offline")}</h1>
    <p>{t("Download the app’s lessons, grammar, vocabulary and games before going offline. Your work continues to save in this browser.", "Scarica lezioni, grammatica, lessico e giochi dell’app prima di andare offline. Il lavoro continua a salvarsi in questo browser.")}</p>
    <p>{t("Book PDFs and listening files stay separate: select your local files again when needed. External links and some device voices need a connection.", "I PDF dei libri e i file audio restano separati: seleziona di nuovo i file locali quando servono. I link esterni e alcune voci del dispositivo richiedono una connessione.")}</p>
    <div className="optional-practice-links">
      <button className="button primary" disabled={!supported || busy} onClick={download}>{busy ? t("Working…", "Operazione in corso…") : registration ? t("Check for an updated download", "Controlla aggiornamenti") : t("Download for offline use", "Scarica per l’uso offline")}</button>
      {registration && <button className="button secondary" disabled={busy} onClick={remove}>{t("Remove offline download", "Rimuovi download offline")}</button>}
      {update && <button className="button primary" onClick={activate}>{t("Use downloaded update and reload", "Usa l’aggiornamento e ricarica")}</button>}
    </div>
    <p role="status">{!supported ? t("Offline installation needs a supported browser and a secure connection.", "L’installazione offline richiede un browser compatibile e una connessione sicura.") : status === "ready" ? t("Download ready. This browser uses the downloaded app online and offline. Check here for updates; saved progress stays on this device.", "Download pronto. Questo browser usa l’app scaricata online e offline. Controlla qui gli aggiornamenti; i progressi restano su questo dispositivo.") : status === "removed" ? t("Offline download removed. Your progress is unchanged. Reload while online to finish removal.", "Download offline rimosso. I progressi non sono cambiati. Ricarica online per completare la rimozione.") : status === "error" ? t("The download could not be completed or checked. Reconnect and try again; your progress has not changed.", "Non è stato possibile completare o controllare il download. Riconnettiti e riprova; i progressi non sono cambiati.") : ""}</p>
    <h2>{t("Add Parliamo to your home screen", "Aggiungi Parliamo alla schermata Home")}</h2>
    <p>{t("After downloading, use your browser’s Install app or Add to Home Screen menu when available. Keep a progress backup: browser storage can be cleared by the device.", "Dopo il download, usa il menu Installa app o Aggiungi alla schermata Home del browser, se disponibile. Conserva un backup dei progressi: il dispositivo può cancellare i dati del browser.")}</p>
  </section>;
}
