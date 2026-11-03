import { useEffect, useState } from "react";
import { vocabBanks, vocabItems, vocabPracticeItems, vocabPool, type VocabItem } from "./vocab-catalogue";
import { filterVocabulary, vocabularySummary, wordDue, wordStatus, type WordFilters } from "./vocab-explorer-model";
import { saveWord, wordKey } from "./academy-engine";
import { catalogueParams, replaceCatalogueParams } from "./navigation";
import { planningSources } from "./planning-data";
import { localPdfPageHref } from "./local-pdfs";
import type { Pair, Progress } from "./types";

export type VocabularyProps = { p: Progress; today: string; t: (en: string, it: string) => string; text: (pair: Pair) => string; save: (update: (p: Progress) => Progress) => void; go: (route: string) => void; pdfs?: Record<string, string>; pdfPageOffsets?: Record<string, number> };
type Props = VocabularyProps & { onStart: (items: VocabItem[], review?: boolean, bank?: string) => void };
const statusLabel = (status: string, t: VocabularyProps["t"]) => ({ new: t("Not tried yet", "Da provare"), learning: t("Needs practice", "Da allenare"), recalled: t("Recalled", "Ricordata") })[status];

export function WordSources({ item, t, text, go, pdfs, pdfPageOffsets }: Pick<VocabularyProps, "t" | "text" | "go" | "pdfs" | "pdfPageOffsets"> & { item: VocabItem }) {
  const bank = vocabBanks.find(bank => bank.id === item.bankId);
  return <div className="word-sources">
    <h4>{t("Back to the material", "Torna al materiale")}</h4>
    <p>{item.word.provenance === "lesson" ? t("Class vocabulary · original example", "Lessico del corso · esempio originale") : item.sourceRefs?.length ? t("Original practice linked to this lesson’s topic", "Pratica originale collegata al tema della lezione") : t("Original everyday practice for this level", "Pratica quotidiana originale per questo livello")}</p>
    {item.sourceRefs?.map(ref => {
      const source = planningSources.find(source => source.id === ref.id);
      return <div className="word-source-ref" key={ref.id}>
        <span>{source?.title ?? ref.id}</span>
        <small>{t("Physical pages / slides", "Pagine / diapositive fisiche")}: {ref.pages.join(", ")}</small>
        <div className="word-source-pages">{ref.pages.map(page => <button type="button" className="text-button" key={page} onClick={() => go(`companion/${ref.id}-p${page}`)}>{t(`Page ${page} notes`, `Note pagina ${page}`)} ↗</button>)}</div>
        {pdfs?.[ref.id] ? <a href={localPdfPageHref(pdfs[ref.id], ref.pages[0], pdfPageOffsets?.[ref.id])} target="_blank" rel="noreferrer">{t("Open my PDF at this page", "Apri il mio PDF a questa pagina")} ↗</a> : <button type="button" className="text-button" onClick={() => go("materials")}>{t("Connect my private PDF", "Collega il mio PDF privato")} →</button>}
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
  const [filters, setFilters] = useState<WordFilters>({ query: params.get("q") ?? "", bank: valid("bank", vocabBanks.map(b => b.id)), level: valid("level", ["A1", "A2"]), source: valid("source", planningSources.map(s => s.id)), status: params.get("status") === "any" ? "all" : valid("status", ["new", "learning", "recalled", "due", "saved"], reviewView ? "due" : "all") });
  const [expanded, setExpanded] = useState(params.get("word") ?? "");
  const [limit, setLimit] = useState(12);
  const [cover, setCover] = useState(false);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!expanded) return;
    const frame = requestAnimationFrame(() => document.getElementById(`details-${expanded}`)?.closest("article")?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [expanded]);
  const writeParams = (next: WordFilters, word = expanded) => replaceCatalogueParams({ view: reviewView ? "review" : "library", bank: next.bank, q: next.query, level: next.level, status: next.status === "all" ? "any" : next.status, source: next.source, word });
  const update = (patch: Partial<WordFilters>) => { const next = { ...filters, ...patch }; setFilters(next); setLimit(12); setExpanded(""); writeParams(next, ""); };
  // Saved grammar/noun entries remain reachable even when they are outside the core word library.
  const items = vocabPracticeItems.filter(item => vocabItems.includes(item) || p.vocabPractice?.records[item.id] || p.academy?.words[wordKey(item.word.term)]?.starred);
  const matching = filterVocabulary(items, p, today, filters);
  const totals = vocabularySummary(items, p, today);
  const availableSources = planningSources.filter(source => items.some(item => item.sourceRefs?.some(ref => ref.id === source.id)));
  const visible = matching.slice(0, limit);
  const deepLinked = matching.find(item => item.id === expanded);
  if (deepLinked && !visible.includes(deepLinked)) visible.push(deepLinked);
  return <section className="vocab-explorer" aria-labelledby="word-library-heading">
    <div className="word-library-heading"><div><p className="eyebrow">{t("YOUR ITALIAN, WITH CONTEXT", "IL TUO ITALIANO, NEL CONTESTO")}</p><h2 id="word-library-heading">{reviewView ? t("Make it stick.", "Fissalo nella memoria.") : t("A word is only the beginning.", "Una parola è solo l’inizio.")}</h2></div><span className="word-library-count">{vocabItems.length}<small>{t("words & phrases", "parole ed espressioni")}</small></span></div>
    {p.vocabPractice?.active && <div className="word-paused"><p>{t("Your typing round is paused. You can browse here; resume that round before starting another.", "Il giro scritto è in pausa. Puoi esplorare qui; riprendi quel giro prima di iniziarne un altro.")}</p><button className="button secondary" onClick={() => props.go("vocab-boost")}>{t("Resume my round", "Riprendi il mio giro")} →</button></div>}
    <p className="hint">{t("Find it, see it in a sentence, then try it from memory. Opening a card does not count as recall.", "Trovala, leggila in una frase, poi prova a ricordarla. Aprire una carta non conta come richiamo dalla memoria.")}</p>
    <div className="word-state-tabs" aria-label={t("Filter by learning evidence", "Filtra per risultati di apprendimento")}>
      {[["all",t("All words", "Tutte le parole"), items.length], ["new",t("Not tried", "Da provare"),totals.new],["learning",t("Needs practice", "Da allenare"),totals.learning],["recalled",t("Recalled", "Ricordate"),totals.recalled],["due",t("Due now", "Da ripassare"),totals.due],["saved",t("Saved", "Salvate"),vocabPool(p,"saved").length]].map(([id,label,count]) => <button key={id} aria-pressed={filters.status === id} onClick={() => update({status:String(id)})}>{label}<span>{count}</span></button>)}
    </div>
    <div className="word-search"><label htmlFor="word-search">{t("Search English or Italian", "Cerca in inglese o italiano")}</label><input id="word-search" type="search" value={filters.query} placeholder={t("Try ‘jacket’, ‘a righe’, ‘receipt’…", "Prova «giacca», «a righe», «scontrino»…")} onChange={event => update({query:event.target.value.slice(0,100)})}/></div>
    <div className="word-filters">
      <label>{t("Topic", "Tema")}<select aria-label={t("Topic", "Tema")} value={filters.bank} onChange={event => update({bank:event.target.value})}><option value="all">{t("Every topic", "Tutti i temi")}</option>{vocabBanks.map(bank => <option key={bank.id} value={bank.id}>{text(bank.title)}</option>)}</select></label>
      <label>{t("Level", "Livello")}<select aria-label={t("Level", "Livello")} value={filters.level} onChange={event => update({level:event.target.value})}><option value="all">{t("All levels", "Tutti i livelli")}</option><option value="A1">A1 · {t("Essentials", "Basi")}</option><option value="A2">A2 · {t("Build on it", "Un passo avanti")}</option></select></label>
      <label>{t("Class material", "Materiale del corso")}<select aria-label={t("Class material", "Materiale del corso")} value={filters.source} onChange={event => update({source:event.target.value})}><option value="all">{t("All materials", "Tutti i materiali")}</option>{availableSources.map(source => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label>
    </div>
    <div className="word-results-toolbar"><p role="status">{t(`${matching.length} matching words`, `${matching.length} parole trovate`)}</p><button className="text-button" aria-pressed={cover} onClick={() => {setCover(!cover);setRevealed([]);}}>{cover ? t("Show Italian", "Mostra l’italiano") : t("Cover Italian to recall", "Copri l’italiano per ricordare")}</button><button className="button primary" disabled={!matching.length || Boolean(p.vocabPractice?.active)} onClick={() => onStart(matching, false, filters.bank)}>{t(`Practise ${Math.min(p.vocabPractice?.settings.size ?? 5,matching.length)} of these`, `Allena ${Math.min(p.vocabPractice?.settings.size ?? 5,matching.length)} di queste`)} →</button></div>
    {filters.status === "recalled" && <p className="hint">{t("Recalled means your latest typed attempt was correct without a hint. The next review checks whether it lasts.", "Ricordata significa che l’ultimo tentativo scritto era corretto senza indizi. Il prossimo ripasso verifica se il ricordo dura.")}</p>}
    <p className="word-live-notice" aria-live="polite">{notice}</p>
    {!matching.length && <div className="word-empty"><h3>{filters.status === "due" ? t("Nothing due in this selection.", "Nessun ripasso in questa selezione.") : t("No words in this selection yet.", "Ancora nessuna parola in questa selezione.")}</h3><p>{t("Try another topic, save a word, or clear your filters to explore.", "Prova un altro tema, salva una parola oppure azzera i filtri per esplorare.")}</p><button className="button secondary" onClick={() => update({query:"",bank:"all",level:"all",source:"all",status:"all"})}>{t("Explore all words", "Esplora tutte le parole")}</button></div>}
    <div className="word-card-grid">{visible.map(item => {
      const record = p.vocabPractice?.records[item.id], status = wordStatus(record), saved = Boolean(p.academy?.words[wordKey(item.word.term)]?.starred);
      const open = expanded === item.id, hidden = cover && !revealed.includes(item.id);
      return <article className={`word-card ${open ? "word-card-open" : ""}`} key={item.id} data-word-id={item.id}>
        <div className="word-card-meta"><span>{item.level ?? "A1–A2"} · {text(item.title)}</span><button className="word-save" aria-pressed={saved} aria-label={t(`${saved ? "Unsave" : "Save"} ${item.word.term.en}`, `${saved ? "Rimuovi" : "Salva"} ${item.word.term.it}`)} onClick={() => {save(state => saveWord(state,item.word.term,item.word.exampleKind === "translation" ? undefined : item.word.example));setNotice(saved ? t("Removed from saved words.","Rimossa dalle parole salvate.") : t("Saved to your word bank.","Salvata nel tuo lessico."));}}>{saved ? "★" : "☆"}</button></div>
        <p className="word-translation" lang="en">{item.word.term.en}</p>
        {hidden ? <button className="word-reveal" onClick={() => setRevealed([...revealed,item.id])}>{t("Recall it, then reveal", "Ricorda, poi scopri")} ↻</button> : <h3 lang="it">{item.word.term.it}</h3>}
        <div className="word-card-bottom"><span className={`word-status word-status-${status}`}>{wordDue(record,today) ? t("Due for review", "Da ripassare") : statusLabel(status,t)}</span><button className="text-button" aria-expanded={open} aria-controls={`details-${item.id}`} onClick={() => {setExpanded(open ? "" : item.id);writeParams(filters,open ? "" : item.id);}}>{open ? t("Close details", "Chiudi dettagli") : t("Example & history", "Esempio e storia")} {open ? "−" : "+"}</button></div>
        {open && <div id={`details-${item.id}`} className="word-card-details">
          {hidden ? <p>{t("Reveal the Italian to read the example and word details.", "Scopri l’italiano per leggere l’esempio e i dettagli della parola.")}</p> : <><blockquote><p lang="it">{item.word.example.it}</p><p lang="en">{item.word.example.en}</p></blockquote>{item.word.plural && <p>{t("Plural", "Plurale")}: <span lang="it">{item.word.plural.it}</span></p>}{item.word.gender && <p>{t("Gender", "Genere")}: {item.word.gender === "m" ? t("masculine", "maschile") : item.word.gender === "f" ? t("feminine", "femminile") : t("masculine or feminine", "maschile o femminile")}</p>}{item.answers.length > 1 && <p>{t("Accepted forms", "Forme accettate")}: <span lang="it">{item.answers.join(" · ")}</span></p>}</>}
          <div className="word-memory"><h4>{t("Your recall record", "Il tuo richiamo dalla memoria")}</h4>{record ? <><dl><div><dt>{t("First attempt", "Primo tentativo")}</dt><dd>{record.first.correct ? record.first.assisted ? t("With help", "Con aiuto") : t("Without hints", "Senza indizi") : t("Needed practice", "Da allenare")}</dd></div><div><dt>{t("Latest attempt", "Ultimo tentativo")}</dt><dd>{record.date} · {statusLabel(status,t)}</dd></div><div><dt>{t("Next review", "Prossimo ripasso")}</dt><dd>{record.due}</dd></div></dl>{!hidden && record.last.answer !== "—" && <p>{t("You wrote", "Hai scritto")}: <span lang="it">{record.last.answer}</span></p>}</> : <p>{t("No typed attempt yet. Try it when you are ready; your first attempt will stay recorded.", "Ancora nessun tentativo scritto. Prova quando vuoi; il primo tentativo resterà registrato.")}</p>}</div>
          <button className="button secondary" disabled={Boolean(p.vocabPractice?.active)} onClick={() => onStart([item],true,item.bankId)}>{t("Type this word", "Scrivi questa parola")} →</button>
          <WordSources {...props} item={item}/>
        </div>}
      </article>;
    })}</div>
    {matching.length > limit && <button className="button secondary word-load-more" onClick={() => setLimit(limit+12)}>{t(`Show 12 more · ${matching.length-limit} remaining`, `Mostra altre 12 · ${matching.length-limit} rimanenti`)}</button>}
    {reviewView && <div className="word-history"><h3>{t("Recent rounds", "Giri recenti")}</h3>{p.vocabPractice?.history.length ? <ol>{p.vocabPractice.history.slice(-5).reverse().map(round => <li key={round.id}><time>{round.date}</time><span>{t(`${round.independent}/${round.total} without hints · ${round.supported} with help`, `${round.independent}/${round.total} senza indizi · ${round.supported} con aiuto`)}</span></li>)}</ol> : <p>{t("Your finished rounds will appear here.", "Qui compariranno i giri completati.")}</p>}</div>}
  </section>;
}
