import { useEffect, useMemo, useState, type ReactNode } from "react";
import { vocabBanks, vocabItems, vocabPracticeItems, vocabPartOfSpeechOptions, partOfSpeechLabel, vocabWordType, type VocabItem } from "./vocab-catalogue";
import { filterVocabulary, vocabularySummary, wordDue, wordStatus, type WordFilters } from "./vocab-explorer-model";
import { saveWord, wordKey } from "./academy-engine";
import { catalogueParams, replaceCatalogueParams } from "./navigation";
import { planningSources } from "./planning-data";
import { localPdfPageHref } from "./local-pdfs";
import { sourcePageLabel } from "./source-references";
import type { Pair, Progress } from "./types";
import "./vocab-collection.css";

export type VocabularyProps = { p: Progress; today: string; t: (en: string, it: string) => string; text: (pair: Pair) => string; save: (update: (p: Progress) => Progress) => void; go: (route: string) => void; pdfs?: Record<string, string>; pdfPageOffsets?: Record<string, number> };
type Props = VocabularyProps & { onStart: (items: VocabItem[], review?: boolean, bank?: string) => void };
type CollectionLayout = "list" | "grid";
const primaryWordIds = new Set(vocabItems.map(item => item.id));
const alphabet = new Intl.Collator("it", { sensitivity: "base", numeric: true });
const statusLabel = (status: string, t: VocabularyProps["t"]) => ({ new: t("New", "Nuova"), learning: t("Practising", "In allenamento"), recalled: t("Recalled", "Ricordata") })[status];

function CollectionIcon({ name }: { name: "search" | "book" | "sound" | "star" | "grid" | "list" | "arrow" | "close" }) {
  const paths: Record<typeof name, ReactNode> = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    book: <><path d="M12 6c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V5c-3-1-7-1-10 1Z" /><path d="M12 6v15M5 9h3M16 9h3M5 13h3M16 13h3" /></>,
    sound: <><path d="m11 4-6 5H2v6h3l6 5V4Z" /><path d="M16 8a6 6 0 0 1 0 8M19 4a11 11 0 0 1 0 16" /></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9L7.5 14 3 9.6l6.2-.9L12 3Z" />,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    list: <><path d="M9 5h12M9 12h12M9 19h12" /><circle cx="3.5" cy="5" r=".7" /><circle cx="3.5" cy="12" r=".7" /><circle cx="3.5" cy="19" r=".7" /></>,
    arrow: <path d="m9 5 7 7-7 7" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function WordGrammar({ item, t, text }: Pick<VocabularyProps, "t" | "text"> & { item: VocabItem }) {
  return <dl className="collection-grammar">
    {vocabWordType(item) && <div><dt>{t("Word type", "Tipo di parola")}</dt><dd>{text(partOfSpeechLabel(vocabWordType(item)))}</dd></div>}
    {item.word.gender && <div><dt>{t("Gender", "Genere")}</dt><dd>{item.word.gender === "m" ? t("Masculine", "Maschile") : item.word.gender === "f" ? t("Feminine", "Femminile") : t("Masculine or feminine", "Maschile o femminile")}</dd></div>}
    {item.word.plural && <div><dt>{t("Plural", "Plurale")}</dt><dd lang="it">{item.word.plural.it}</dd></div>}
    {item.answers.length > 1 && <div className="collection-grammar-forms"><dt>{t("Accepted forms", "Forme accettate")}</dt><dd lang="it">{item.answers.join(" · ")}</dd></div>}
  </dl>;
}

export function WordSources({ item, t, text, go, pdfs, pdfPageOffsets }: Pick<VocabularyProps, "t" | "text" | "go" | "pdfs" | "pdfPageOffsets"> & { item: VocabItem }) {
  const bank = vocabBanks.find(bank => bank.id === item.bankId);
  return <div className="word-sources">
    <h4>{t("Keep exploring", "Continua a esplorare")}</h4>
    <p>{item.word.provenance === "course-list" ? t("From your course vocabulary collection.", "Dalla raccolta di vocaboli del tuo corso.") : item.word.provenance === "lesson" ? t("Class vocabulary with an original practice example.", "Lessico del corso con un esempio originale per la pratica.") : item.sourceRefs?.length ? t("Original practice connected to this lesson’s topic.", "Pratica originale collegata al tema della lezione.") : t("Everyday vocabulary for your Italian.", "Lessico quotidiano per il tuo italiano.")}</p>
    {item.sourceRefs?.map(ref => {
      const source = planningSources.find(source => source.id === ref.id);
      return <div className="word-source-ref" key={ref.id}>
        <span>{source?.title ?? ref.id}</span>
        <small>{source ? text(sourcePageLabel(source)) : t("Source pages", "Pagine della fonte")}: {ref.pages.join(", ")}</small>
        <div className="word-source-pages">{ref.pages.map(page => <button type="button" className="text-button" key={page} onClick={() => go(`companion/${ref.id}-p${page}`)}>{t(`Page ${page} notes`, `Note pagina ${page}`)} ↗</button>)}</div>
        {pdfs?.[ref.id] ? <a href={localPdfPageHref(pdfs[ref.id], ref.pages[0], pdfPageOffsets?.[ref.id])} target="_blank" rel="noreferrer">{t("Open my PDF here", "Apri qui il mio PDF")} ↗</a> : <button type="button" className="text-button" onClick={() => go("materials")}>{t("Connect my class PDF", "Collega il mio PDF del corso")} →</button>}
      </div>;
    })}
    <div className="word-source-pages">
      {bank?.relatedMissionIds?.map(id => <button key={id} type="button" className="text-button" onClick={() => go(`lesson/${id}`)}>{t("Use it in a lesson", "Usala in una lezione")} →</button>)}
      {(item.unitId ? [item.unitId] : bank?.relatedGrammarIds ?? []).map(id => <button key={id} type="button" className="text-button" onClick={() => go(`grammar/${id}`)}>{t("Grammar connection", "Collegamento grammaticale")} →</button>)}
    </div>
    {bank && <small>{text(bank.title)}</small>}
  </div>;
}

export function VocabularyExplorer(props: Props) {
  const { p, t, text, save, today, onStart } = props;
  const [params] = useState(catalogueParams);
  const reviewView = params.get("view") === "review";
  const valid = (key: string, choices: string[], fallback = "all") => choices.includes(params.get(key) ?? "") ? params.get(key)! : fallback;
  const [filters, setFilters] = useState<WordFilters>({
    query: params.get("q") ?? "", bank: valid("bank", vocabBanks.map(bank => bank.id)),
    level: valid("level", ["A1", "A2"]), source: valid("source", planningSources.map(source => source.id)),
    status: params.get("status") === "any" ? "all" : valid("status", ["new", "learning", "recalled", "due", "saved"], reviewView ? "due" : "all"),
    partOfSpeech: valid("type", vocabPartOfSpeechOptions.map(option => option.id)),
    collection: valid("collection", ["everyday", "lesson", "course"]),
  });
  const [expanded, setExpanded] = useState(params.get("word") ?? "");
  const [limit, setLimit] = useState(24);
  const [cover, setCover] = useState(params.get("cover") === "true");
  const [revealed, setRevealed] = useState<string[]>([]);
  const [sort, setSort] = useState(params.get("sort") === "recent" ? "recent" : "alphabetical");
  const [layout, setLayout] = useState<CollectionLayout>(params.get("layout") === "grid" ? "grid" : "list");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!expanded) return;
    const frame = requestAnimationFrame(() => document.getElementById(`details-${expanded}`)?.closest("article")?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [expanded]);
  const writeParams = (next: WordFilters, word = expanded, nextSort = sort, nextLayout = layout, nextCover = cover) => replaceCatalogueParams({ view: reviewView ? "review" : "library", bank: next.bank, q: next.query, level: next.level, status: next.status === "all" ? "any" : next.status, source: next.source, type: next.partOfSpeech ?? "all", collection: next.collection ?? "all", word, sort: nextSort, layout: nextLayout, cover: nextCover ? "true" : "" });
  const update = (patch: Partial<WordFilters>) => { const next = { ...filters, ...patch }; setFilters(next); setLimit(24); setExpanded(""); setRevealed([]); writeParams(next, ""); };
  const reset = () => update({ query: "", bank: "all", level: "all", source: "all", status: "all", partOfSpeech: "all", collection: "all" });
  const items = useMemo(() => vocabPracticeItems.filter(item => primaryWordIds.has(item.id) || p.vocabPractice?.records[item.id] || p.academy?.words[wordKey(item.word.term)]?.starred), [p.vocabPractice?.records, p.academy?.words]);
  const matching = useMemo(() => {
    const values = filterVocabulary(items, p, today, filters);
    return values.sort((a, b) => (sort === "recent" ? (p.vocabPractice?.records[b.id]?.date ?? "").localeCompare(p.vocabPractice?.records[a.id]?.date ?? "") : 0) || alphabet.compare(a.word.term.it, b.word.term.it) || alphabet.compare(a.word.term.en, b.word.term.en));
  }, [items, p, today, filters, sort]);
  const totals = useMemo(() => vocabularySummary(items, p, today), [items, p, today]);
  const availableSources = useMemo(() => {
    const sourceIds = new Set(items.flatMap(item => item.sourceRefs?.map(ref => ref.id) ?? []));
    return planningSources.filter(source => sourceIds.has(source.id));
  }, [items]);
  const visible = matching.slice(0, limit);
  const deepLinked = matching.find(item => item.id === expanded);
  if (deepLinked && !visible.includes(deepLinked)) visible.push(deepLinked);
  const challengeSize = Math.min(p.vocabPractice?.settings.size ?? 5, matching.length);
  const filtered = Boolean(filters.query || [filters.bank, filters.level, filters.source, filters.status, filters.partOfSpeech, filters.collection].some(value => value && value !== "all"));
  const readAloud = (item: VocabItem) => {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") { setNotice(t("Audio is unavailable. Try saying the Italian aloud.", "L’audio non è disponibile. Prova a pronunciare l’italiano.")); return; }
    const utterance = new SpeechSynthesisUtterance(item.word.term.it);
    utterance.lang = "it-IT"; utterance.rate = .85;
    const voice = window.speechSynthesis.getVoices().find(candidate => candidate.lang.startsWith("it"));
    if (voice) utterance.voice = voice;
    utterance.onerror = event => { if (event.error !== "interrupted" && event.error !== "canceled") setNotice(t("Audio could not play. You can read the word aloud.", "L’audio non è partito. Puoi leggere la parola ad alta voce.")); };
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance);
    setNotice(t(`Device voice · ${item.word.term.it}`, `Voce del dispositivo · ${item.word.term.it}`));
  };
  const statuses = [
    { id: "all", label: t("All words", "Tutte"), count: items.length },
    { id: "new", label: t("New", "Nuove"), count: totals.new },
    { id: "learning", label: t("Practising", "In allenamento"), count: totals.learning },
    { id: "recalled", label: t("Recalled", "Ricordate"), count: totals.recalled },
    { id: "due", label: t("Due now", "Da ripassare"), count: totals.due },
    { id: "saved", label: t("Saved", "Salvate"), count: totals.saved },
  ];
  return <section className="vocab-explorer word-collection" aria-labelledby="word-library-heading">
    <header className="collection-heading collection-heading-compact">
      <div><h2 id="word-library-heading" className="collection-sr">{reviewView ? t("Your words to review", "Le tue parole da ripassare") : t("Browse your words", "Esplora le tue parole")}</h2><p>{t("Find a word, save a favourite, or turn any selection into a challenge.", "Trova una parola, salva le preferite o trasforma una selezione in una sfida.")}</p></div>
      <div className="collection-book" aria-hidden="true"><span>ciao!</span><CollectionIcon name="book" /><small>hello!</small></div>
    </header>
    <div className="collection-progress"><span><strong>{totals.recalled.toLocaleString()}</strong> {t("recalled", "ricordate")}<small> / {items.length.toLocaleString()}</small></span><div role="progressbar" aria-label={t("Words recalled without hints", "Parole ricordate senza indizi")} aria-valuemin={0} aria-valuemax={items.length || 1} aria-valuenow={totals.recalled}><span style={{ width: `${items.length ? totals.recalled / items.length * 100 : 0}%` }} /></div><small>{t("Your latest typed attempts", "I tuoi ultimi tentativi scritti")}</small></div>
    {p.vocabPractice?.active && <div className="collection-paused"><span>{t("Your challenge is waiting right where you left it.", "La tua sfida ti aspetta dove l’hai lasciata.")}</span><button type="button" onClick={() => props.go("vocab-boost")}>{t("Resume challenge", "Riprendi la sfida")} →</button></div>}
    <div className="collection-states" role="group" aria-label={t("Filter by practice status", "Filtra per stato della pratica")}>
      {statuses.map(status => <button type="button" key={status.id} className={`collection-state collection-state-${status.id}`} aria-pressed={filters.status === status.id} onClick={() => update({ status: status.id })}><strong>{status.count.toLocaleString()}</strong><span>{status.label}</span></button>)}
    </div>
    <div className="collection-tools">
      <div className="collection-search"><label htmlFor="word-search">{t("Search your words", "Cerca le tue parole")}</label><div><CollectionIcon name="search" /><input className="collection-input" id="word-search" type="search" value={filters.query} placeholder={t("Italian or English…", "Italiano o inglese…")} onChange={event => update({ query: event.target.value.slice(0, 100) })} />{filters.query && <button type="button" className="collection-clear" aria-label={t("Clear search", "Cancella la ricerca")} onClick={() => update({ query: "" })}><CollectionIcon name="close" /></button>}</div></div>
      <label className="collection-field">{t("Word type", "Tipo di parola")}<select className="collection-input" value={filters.partOfSpeech ?? "all"} onChange={event => update({ partOfSpeech: event.target.value })}><option value="all">{t("All types", "Tutti i tipi")}</option>{vocabPartOfSpeechOptions.map(option => <option key={option.id} value={option.id}>{text(option.label)}</option>)}</select></label>
      <label className="collection-field">{t("Topic", "Tema")}<select className="collection-input" value={filters.bank} onChange={event => update({ bank: event.target.value })}><option value="all">{t("Every topic", "Tutti i temi")}</option>{vocabBanks.map(bank => <option key={bank.id} value={bank.id}>{text(bank.title)}</option>)}</select></label>
    </div>
    <details className="collection-more-filters" open={filters.source !== "all" || filters.level !== "all" || filters.collection !== "all" || undefined}>
      <summary>{t("More filters", "Altri filtri")}</summary>
      <div><label className="collection-field">{t("Collection", "Raccolta")}<select className="collection-input" value={filters.collection ?? "all"} onChange={event => update({ collection: event.target.value })}><option value="all">{t("Every collection", "Tutte le raccolte")}</option><option value="everyday">{t("Everyday themes", "Temi quotidiani")}</option><option value="lesson">{t("Lesson vocabulary", "Lessico delle lezioni")}</option><option value="course">{t("More from your course", "Altro dal tuo corso")}</option></select></label>
      <label className="collection-field">{t("Lesson level", "Livello delle lezioni")}<select className="collection-input" value={filters.level} onChange={event => update({ level: event.target.value })}><option value="all">{t("All levels", "Tutti i livelli")}</option><option value="A1">A1 · {t("Essentials", "Basi")}</option><option value="A2">A2 · {t("Build on it", "Un passo avanti")}</option></select></label>
      <label className="collection-field">{t("Class material", "Materiale del corso")}<select className="collection-input" value={filters.source} onChange={event => update({ source: event.target.value })}><option value="all">{t("All materials", "Tutti i materiali")}</option>{availableSources.map(source => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label></div>
    </details>
    <div className="collection-results">
      <p role="status"><strong>{matching.length.toLocaleString()}</strong> {matching.length === 1 ? t("word to explore", "parola da esplorare") : t("words to explore", "parole da esplorare")}{filtered && <button type="button" onClick={reset}>{t("Reset filters", "Azzera i filtri")}</button>}</p>
      <label className="collection-sort"><span className="collection-sr">{t("Sort words", "Ordina le parole")}</span><select aria-label={t("Sort words", "Ordina le parole")} value={sort} onChange={event => { setSort(event.target.value); setLimit(24); writeParams(filters, expanded, event.target.value); }}><option value="alphabetical">{t("Italian A–Z", "Italiano A–Z")}</option><option value="recent">{t("Recently practised", "Allenate di recente")}</option></select></label>
      <div className="collection-layout" role="group" aria-label={t("Word display", "Visualizzazione delle parole")}>
        {(["list", "grid"] as const).map(value => <button type="button" key={value} aria-pressed={layout === value} aria-label={value === "list" ? t("List view", "Elenco") : t("Card view", "Carte")} onClick={() => { setLayout(value); writeParams(filters, expanded, sort, value); }}><CollectionIcon name={value} /></button>)}
      </div>
    </div>
    <div className="collection-practice-bar"><button type="button" className="collection-cover" aria-pressed={cover} onClick={() => { setCover(!cover); setRevealed([]); writeParams(filters, expanded, sort, layout, !cover); }}>{cover ? t("✓ Italian covered", "✓ Italiano coperto") : t("Cover Italian", "Copri l’italiano")}</button><button type="button" className="collection-practise" disabled={!matching.length || Boolean(p.vocabPractice?.active)} onClick={() => onStart(matching, false, filters.bank)}>{challengeSize === 1 ? t("Challenge: 1 word", "Sfida: 1 parola") : t(`Challenge: ${challengeSize} words`, `Sfida: ${challengeSize} parole`)}<span aria-hidden="true">→</span></button></div>
    <p className="collection-notice" aria-live="polite">{notice}</p>
    {filters.status === "recalled" && <p className="collection-evidence-note">{t("Recalled = your latest typed answer was right without a hint. A later review helps it last.", "Ricordata = l’ultima risposta scritta era corretta senza indizi. Un ripasso successivo aiuta a conservarla.")}</p>}
    {!matching.length && <div className="collection-empty"><span aria-hidden="true"><CollectionIcon name="book" /></span><h3>{filters.status === "due" ? t("A little breathing room.", "Un piccolo momento di pausa.") : t("Let’s find another word.", "Troviamo un’altra parola.")}</h3><p>{filters.status === "due" ? t("Nothing is due in this selection. Explore something new while your words settle in.", "Nessun ripasso in questa selezione. Esplora qualcosa di nuovo mentre le parole si fissano.") : filters.status === "saved" ? t("Star any word to keep it here. Try all words to find a favourite.", "Metti una stella a una parola per conservarla qui. Cerca tra tutte per trovare le preferite.") : t("Try a shorter search or clear a filter. Your next favourite is in here somewhere.", "Prova una ricerca più breve o azzera un filtro. La tua prossima parola preferita è qui da qualche parte.")}</p><button type="button" className="collection-practise" onClick={reset}>{t("Explore all words", "Esplora tutte le parole")} →</button></div>}
    <div className={`collection-words collection-words-${layout} word-card-grid`}>{visible.map(item => {
      const record = p.vocabPractice?.records[item.id], status = wordStatus(record), saved = Boolean(p.academy?.words[wordKey(item.word.term)]?.starred);
      const open = expanded === item.id, hidden = cover && !revealed.includes(item.id);
      const bank = vocabBanks.find(bank => bank.id === item.bankId);
      return <article className={`collection-word word-card${open ? " word-card-open" : ""}`} key={item.id} data-word-id={item.id}>
        <div className="collection-entry">
          <div className="collection-entry-word">{hidden ? <button type="button" className="collection-reveal" onClick={() => setRevealed([...revealed, item.id])}>{t("Try to recall…", "Prova a ricordare…")}<span>{t("Reveal", "Scopri")} ↻</span></button> : <h3 lang="it">{item.word.term.it}</h3>}<span className="collection-word-type">{text(partOfSpeechLabel(vocabWordType(item)))}</span></div>
          <p className="collection-entry-meaning" lang="en">{item.word.term.en}</p>
          <div className="collection-word-actions"><button type="button" className="collection-icon-button collection-audio" disabled={hidden} aria-label={hidden ? t("Reveal Italian to listen", "Scopri l’italiano per ascoltare") : t(`Hear ${item.word.term.it}`, `Ascolta ${item.word.term.it}`)} onClick={() => readAloud(item)}><CollectionIcon name="sound" /></button><button type="button" className="collection-icon-button word-save" aria-pressed={saved} aria-label={hidden ? t(`${saved ? "Unsave" : "Save"} this word`, `${saved ? "Rimuovi" : "Salva"} questa parola`) : t(`${saved ? "Unsave" : "Save"} ${item.word.term.en}`, `${saved ? "Rimuovi" : "Salva"} ${item.word.term.it}`)} onClick={() => { save(state => saveWord(state, item.word.term, item.word.exampleKind === "translation" ? undefined : item.word.example)); setNotice(saved ? t("Removed from saved words.", "Rimossa dalle parole salvate.") : t("Saved! Find it under your starred words.", "Salvata! La trovi tra le parole con la stella.")); }}><CollectionIcon name="star" /></button></div>
          <div className="collection-entry-footer"><span className={`collection-status collection-status-${wordDue(record, today) ? "due" : status}`}>{wordDue(record, today) ? t("Due for review", "Da ripassare") : statusLabel(status, t)}</span><button type="button" className="collection-open" aria-expanded={open} aria-controls={`details-${item.id}`} onClick={() => { setExpanded(open ? "" : item.id); writeParams(filters, open ? "" : item.id); }}>{open ? t("Close", "Chiudi") : t("View word", "Vedi parola")}<CollectionIcon name="arrow" /></button></div>
        </div>
        {open && <div id={`details-${item.id}`} className="collection-details word-card-details">
          {hidden ? <p>{t("Reveal the Italian to see the word details and example.", "Scopri l’italiano per vedere i dettagli e l’esempio.")}</p> : <div className="collection-detail-columns"><div className="collection-definition"><span>{item.word.exampleKind === "translation" ? t("Meaning", "Significato") : t("In a sentence", "In una frase")}</span><blockquote>{item.word.exampleKind !== "translation" && <p lang="it">{item.word.example.it}</p>}<p lang="en">{item.word.example.en}</p></blockquote><WordGrammar item={item} t={t} text={text} /></div><div className="collection-memory"><h4>{t("Your practice story", "La storia della tua pratica")}</h4>{record ? <><dl><div><dt>{t("First attempt", "Primo tentativo")}</dt><dd>{record.first.correct ? record.first.assisted ? t("With a hint", "Con un indizio") : t("Without hints", "Senza indizi") : t("Needed practice", "Da allenare")}</dd></div><div><dt>{t("Latest attempt", "Ultimo tentativo")}</dt><dd>{record.date} · {statusLabel(status, t)}</dd></div><div><dt>{t("Next review", "Prossimo ripasso")}</dt><dd>{record.due}</dd></div></dl>{record.last.answer !== "—" && <p>{t("You wrote", "Hai scritto")}: <span lang="it">{record.last.answer}</span></p>}</> : <p>{t("Your story starts with a typed answer. Take a small challenge when you’re ready.", "La tua storia inizia con una risposta scritta. Prova una piccola sfida quando vuoi.")}</p>}</div></div>}
          <div className="collection-detail-actions"><button type="button" className="collection-practise" disabled={Boolean(p.vocabPractice?.active)} onClick={() => onStart([item], true, item.bankId)}>{t("Challenge this word", "Sfida questa parola")} →</button>{!hidden && <button type="button" className="collection-device-voice" onClick={() => readAloud(item)}><CollectionIcon name="sound" />{t("Hear the Italian · device voice", "Ascolta l’italiano · voce del dispositivo")}</button>}</div>
          {(item.sourceRefs?.length || item.unitId || bank?.relatedMissionIds?.length || bank?.relatedGrammarIds?.length) ? <details className="collection-connections"><summary>{t("Lesson & grammar connections", "Collegamenti a lezioni e grammatica")}</summary><WordSources {...props} item={item} /></details> : <p className="collection-origin">{text(item.title)}</p>}
        </div>}
      </article>;
    })}</div>
    {!!matching.length && <footer className="collection-pagination"><p>{matching.length === 1 ? t("Showing 1 word", "Mostrata 1 parola") : t(`Showing ${visible.length} of ${matching.length} words`, `Mostrate ${visible.length} parole su ${matching.length}`)}</p>{matching.length > limit && <button type="button" className="collection-load-more word-load-more" onClick={() => setLimit(limit + 24)}>{t("Show 24 more", "Mostra altre 24")} <span aria-hidden="true">↓</span></button>}</footer>}
    {reviewView && <div className="collection-history"><h3>{t("Your recent challenges", "Le tue sfide recenti")}</h3>{p.vocabPractice?.history.length ? <ol>{p.vocabPractice.history.slice(-5).reverse().map(round => <li key={round.id}><time>{round.date}</time><span>{t(`${round.independent}/${round.total} without hints · ${round.supported} with help`, `${round.independent}/${round.total} senza indizi · ${round.supported} con aiuto`)}</span></li>)}</ol> : <p>{t("Your completed challenges will appear here. One small round is all it takes to begin.", "Qui compariranno le sfide completate. Basta un piccolo giro per iniziare.")}</p>}</div>}
  </section>;
}
