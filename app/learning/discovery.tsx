import { useEffect, useRef, useState } from "react";
import grammar from "./grammar.json";
import curriculum from "./curriculum.json";
import companion from "./companion.json";
import { vocabBanks } from "./vocab-catalogue";
import { buildDiscoveryIndex, discoveryKinds, searchDiscovery, type DiscoveryKind, type DiscoveryLevel } from "./discovery-index";
import { catalogueParams, focusStudyHeading, replaceCatalogueParams } from "./navigation";
import type { GrammarUnit, Mission, PageCompanion, Pair, Programme, Progress, Source, VocabularyBank } from "./types";
import "./academy.css";

const sources = [...new Map([...(curriculum.sources as Source[]), ...(companion.sources as Source[])].map((source) => [source.id, source])).values()];
const sourceById = new Map(sources.map((source) => [source.id, source]));
const index = buildDiscoveryIndex({
  units: grammar.units as GrammarUnit[], missions: curriculum.missions as Mission[],
  programmes: grammar.programmes as Programme[], banks: vocabBanks as VocabularyBank[],
  bankRoutes: Object.fromEntries(vocabBanks.map(bank => [bank.id, `vocab-boost?bank=${encodeURIComponent(bank.id)}`])),
  sources, pages: companion.pages as PageCompanion[],
  bankMissions: Object.fromEntries(vocabBanks.map(bank => [bank.id, bank.relatedMissionIds ?? []])),
});
const kindLabels: Record<DiscoveryKind, Pair> = {
  grammar: { en: "Grammar", it: "Grammatica" },
  lesson: { en: "Short lesson", it: "Lezione breve" },
  programme: { en: "Study programme", it: "Percorso di studio" },
  vocabulary: { en: "Vocabulary bank", it: "Raccolta lessico" },
  page: { en: "Source page", it: "Pagina della fonte" },
  source: { en: "Source file", it: "File della fonte" },
};
type Props = {
  p: Progress;
  t: (en: string, it: string) => string;
  text: (pair: Pair) => string;
  go: (route: string) => void;
  today?: string;
};

export function DiscoveryView({ p, t, text, go }: Props) {
  const params = catalogueParams();
  const [query, setQuery] = useState(() => (params.get("q") ?? "").slice(0, 200));
  const [kind, setKind] = useState<DiscoveryKind | "all">((discoveryKinds as string[]).includes(params.get("kind") ?? "") ? params.get("kind") as DiscoveryKind : "all");
  const [level, setLevel] = useState<DiscoveryLevel>(params.get("level") === "A1" || params.get("level") === "A2" ? params.get("level") as DiscoveryLevel : "all");
  const [visible, setVisible] = useState(24);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => focusStudyHeading(heading.current), []);
  const results = searchDiscovery(index, query, kind, level);
  const change = (nextQuery: string, nextKind = kind, nextLevel = level) => {
    setQuery(nextQuery.slice(0, 200)); setKind(nextKind); setLevel(nextLevel); setVisible(24);
    replaceCatalogueParams({ q: nextQuery, kind: nextKind, level: nextLevel });
  };
  return (
    <div className="workspace academy discovery-workspace">
      <div className="discovery-intro">
        <p className="eyebrow">{t("FIND YOUR NEXT USEFUL IDEA", "TROVA LA PROSSIMA IDEA UTILE")}</p>
        <h1 ref={heading} tabIndex={-1} className="study-focus-heading">{t("What would you like to practise?", "Che cosa vuoi esercitare?")}</h1>
        <p>{t("Find a topic across grammar, short lessons, study programmes, vocabulary and source pages. Open a result to study or practise; your search stays in this address.", "Cerca un argomento tra grammatica, lezioni brevi, percorsi di studio, lessico e pagine delle fonti. Apri un risultato per studiare o esercitarti: la ricerca resta in questo indirizzo.")}</p>
      </div>
      <div className="discovery-controls">
        <label className="field discovery-query">
          {t("Topic, word or source page", "Argomento, parola o pagina della fonte")}
          <input type="search" value={query} maxLength={200} onChange={(event) => change(event.target.value)} placeholder={t("Try imperfect, imperfetto, Plus 1 135…", "Prova imperfetto, imperfect, Plus 1 135…")} />
        </label>
        <label className="field">
          {t("Type of material", "Tipo di materiale")}
          <select value={kind} onChange={(event) => change(query, event.target.value as DiscoveryKind | "all")}>
            <option value="all">{t("All materials", "Tutti i materiali")}</option>
            {discoveryKinds.map((type) => <option key={type} value={type}>{text(kindLabels[type])}</option>)}
          </select>
        </label>
        <label className="field">
          {t("Level", "Livello")}
          <select value={level} onChange={(event) => change(query, kind, event.target.value as DiscoveryLevel)}>
            <option value="all">{t("All levels", "Tutti i livelli")}</option>
            <option value="A1">A1 / A1+</option><option value="A2">A2</option>
          </select>
        </label>
      </div>
      <div className="discovery-suggestions" aria-label={t("Example searches", "Esempi di ricerca")}>
        {["imperfetto", "Plus 1 135", "shopping"].map((example) => <button className="text-button" key={example} onClick={() => change(example, "all", "all")}>{example}</button>)}
        {(query || kind !== "all" || level !== "all") && <button className="text-button" onClick={() => change("", "all", "all")}>{t("Clear search", "Cancella la ricerca")}</button>}
      </div>
      <p role="status" className="academy-result-count">{results.length} {t("results", "risultati")} · {Math.min(visible, results.length)} {t("shown", "visualizzati")}</p>
      {!results.length && <div className="academy-empty"><p>{t("No matching materials. Try a shorter topic, an Italian grammar name or all levels.", "Nessun materiale corrispondente. Prova un argomento più breve, il nome italiano della regola o tutti i livelli.")}</p></div>}
      <div className="discovery-results">
        {results.slice(0, visible).map((entry) => {
          const completed = entry.kind === "grammar" ? p.academy?.grammar[entry.id]?.completed : entry.kind === "lesson" ? p.completed[entry.id] : entry.kind === "page" ? p.academy?.companion[entry.id]?.completed : false;
          return <article className="discovery-card" key={`${entry.kind}:${entry.id}`}>
            <div className="discovery-card-tags"><span className="tag">{text(kindLabels[entry.kind])}</span>{entry.level && <span className="tag">{entry.level === "A1-plus" ? "A1 → A2" : entry.level}</span>}{completed && <span>{t("✓ Completed", "✓ Completato")}</span>}</div>
            <h2><button onClick={() => go(entry.route)}>{text(entry.title)} <span aria-hidden="true">→</span></button></h2>
            <p>{text(entry.summary)}</p>
            {entry.pageKind && <p className="discovery-page-kind">{entry.pageKind === "reference" ? t("Reference & reflection · no practice credit", "Riferimento e riflessione · nessun credito di pratica") : entry.pageKind === "needs-review" ? t("Source check pending", "Verifica della fonte in attesa") : t("Original companion practice", "Pratica originale del compagno")}</p>}
            {entry.sources.length > 0 && <ul className="discovery-source-refs" aria-label={t("Source references", "Riferimenti alle fonti")}>{entry.sources.slice(0, 2).map((ref) => <li key={ref.id}>{sourceById.get(ref.id)?.title}{ref.pages.length > 0 && <> · {t("physical pages", "pagine fisiche")} {ref.pages.slice(0, 3).join(", ")}{ref.pages.length > 3 ? "…" : ""}</>}</li>)}{entry.sources.length > 2 && <li>{t(`${entry.sources.length - 2} more sources in the material`, `Altre ${entry.sources.length - 2} fonti nel materiale`)}</li>}</ul>}
          </article>;
        })}
      </div>
      {results.length > visible && <button className="button secondary discovery-more" onClick={() => setVisible((count) => count + 24)}>{t("Show 24 more", "Mostra altri 24")}</button>}
    </div>
  );
}
