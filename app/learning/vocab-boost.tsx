import { useEffect, useRef, useState, type FormEvent } from "react";
import { vocabBanks, vocabItemById, vocabItems, vocabPracticeItems, vocabPool, vocabSearch, type VocabItem } from "./vocab-catalogue";
import { answerVocab, emptyVocabPractice, finishVocabRound, hintVocab, nextVocabItem, startVocabRound, updateVocabDraft } from "./vocab-engine";
import { saveWord, wordKey } from "./academy-engine";
import { catalogueParams, catalogueRoute, replaceCatalogueParams } from "./navigation";
import { PracticeNavigation } from "./practice-navigation";
import type { ArcadeRound } from "./types";
import { VocabularyExplorer, WordSources, type VocabularyProps } from "./vocab-explorer";
import { vocabularySummary } from "./vocab-explorer-model";
import "./vocab-boost.css";
type Props = VocabularyProps;

export function VocabularyBooster(props: Props) {
  const { p, today, t, text, save, go } = props;
  const progress = p.vocabPractice ?? emptyVocabPractice();
  const [params] = useState(catalogueParams);
  const requested = params.get("bank") ?? p.vocabPractice?.settings.bank;
  const [bankId, setBankId] = useState(requested && (vocabBanks.some(bank => bank.id === requested) || ["all", "saved"].includes(requested)) ? requested : vocabBanks[0].id);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [visible, setVisible] = useState(6);
  const [completedRound, setCompletedRound] = useState<ArcadeRound | null>(null);
  const [completedId, setCompletedId] = useState<string | null>(null);
  const [group, setGroup] = useState("everyday");
  const screen = useRef<HTMLDivElement>(null);
  const activeId = progress.active?.id;
  useEffect(() => {
    if (!activeId) {
      const heading = screen.current?.querySelector<HTMLElement>("h1");
      heading?.setAttribute("tabindex", "-1"); heading?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    }
  }, [activeId, completedId]);
  const view = params.get("view") ?? "practice";
  const totals = vocabularySummary(vocabPracticeItems, p, today);
  const reviewId = params.get("review");
  const reviewItem = reviewId ? vocabItemById.get(reviewId) : undefined;
  const pool = vocabPool(p, bankId);
  const due = vocabPracticeItems.filter(item => progress.records[item.id]?.due <= today && progress.records[item.id]?.date !== today);
  const mistakes = vocabPracticeItems.filter(item => progress.records[item.id] && (!progress.records[item.id].last.correct || progress.records[item.id].last.assisted));
  const selectedBank = vocabBanks.find(bank => bank.id === bankId);
  const choose = (id: string) => { setBankId(id); replaceCatalogueParams({ bank: id, q: query }); };
  const start = (items = pool, review = false, selected = bankId) => {
    setCompletedId(null);
    save(state => startVocabRound({ ...state, vocabPractice: { ...(state.vocabPractice ?? emptyVocabPractice()), settings: { ...(state.vocabPractice ?? emptyVocabPractice()).settings, bank: selected } } }, items, today, crypto.randomUUID(), review));
    if (view === "library" || view === "review") go("vocab-boost");
  };
  if (progress.active && view !== "library" && view !== "review") {
    const item = vocabItemById.get(progress.active.itemIds[progress.active.index]);
    if (!item) return <div className="workspace vocab-workspace"><h1>{t("This word is unavailable", "Questa parola non è disponibile")}</h1><p>{t("Your saved answers are safe. End this round to choose another topic.", "Le risposte salvate sono al sicuro. Termina questo giro per scegliere un altro tema.")}</p><button className="button secondary" onClick={() => save(state => ({ ...state, vocabPractice: { ...state.vocabPractice!, active: null } }))}>{t("End this round", "Termina questo giro")}</button></div>;
    return <VocabQuestion key={`${progress.active.id}:${progress.active.index}`} {...props} round={progress.active} item={item} onFinish={() => { setCompletedId(progress.active!.id); setCompletedRound(progress.active!); save(finishVocabRound); }} />;
  }
  const completed = progress.history.find(round => round.id === completedId);
  if (completed) return <div ref={screen} className="workspace vocab-workspace vocab-finish">
    <PracticeNavigation active="vocabulary" t={t} go={go} />
    <p className="vocab-celebration" aria-hidden="true">✦ ✦ ✦</p>
    <h1>{t("A little more Italian.", "Un po’ più d’italiano.")}</h1>
    <p>{t(`${completed.independent} of ${completed.total} recalled without hints.`, `${completed.independent} parole su ${completed.total} ricordate senza indizi.`)}</p>
    <p>{t(`${completed.supported} correct with help. Mistakes and supported words are ready to practise again.`, `${completed.supported} corrette con aiuto. Gli errori e le parole aiutate sono pronti per un altro giro.`)}</p>
    <div className="vocab-round-receipt">
      <h2>{t("Your words from this round", "Le parole di questo giro")}</h2>
      {completedRound?.itemIds.map(id => { const item = vocabItemById.get(id); const answer = completedRound.answers[id]; if (!item || !answer) return null; return <div key={id}><span><strong lang="it">{item.word.term.it}</strong><small lang="en">{item.word.term.en}</small></span><span className={`word-status word-status-${answer.correct && !answer.assisted ? "recalled" : "learning"}`}>{answer.correct ? answer.assisted ? t("With help", "Con aiuto") : t("Recalled", "Ricordata") : t("Practise again", "Da riprovare")}</span><button className="text-button" onClick={() => go(catalogueRoute("vocab-boost", {view:"library", word:id, q:item.word.term.en}))}>{t("Revisit", "Rivedi")} →</button></div>; })}
    </div>
    <div className="vocab-finish-actions">
      {mistakes.length > 0 && <button className="button primary" onClick={() => start(mistakes, true)}>{t("Practise tricky words", "Riprova le parole difficili")} →</button>}
      <button className={`button ${mistakes.length ? "secondary" : "primary"}`} onClick={() => { setCompletedId(null); go("vocab-boost"); }}>{t("Choose my next words", "Scegli le prossime parole")}</button>
      <button className="text-button" onClick={() => go("today")}>{t("Done for now · back to today", "Basta per ora · torna a oggi")}</button>
    </div>
    <p className="hint">{t("Your first attempts stay recorded. Tomorrow’s due words also appear in the shared review queue.", "I primi tentativi restano registrati. Le parole da ripassare domani compaiono anche nell’elenco dei ripassi.")}</p>
  </div>;
  const needle = vocabSearch(query);
  const matching = vocabBanks.filter(bank => (needle || group === "all" || (group === "everyday" ? bank.original : !bank.original)) && (!needle || vocabSearch(`${bank.title.en} ${bank.title.it} ${bank.words.map(word => `${word.term.en} ${word.term.it}`).join(" ")}`).includes(needle)));
  return <div ref={screen} className="workspace vocab-workspace">
    <PracticeNavigation active="vocabulary" t={t} go={go} />
    <header className="vocab-intro"><p className="eyebrow">{t("A LITTLE EVERY DAY", "UN PO’ OGNI GIORNO")}</p><h1>{t("Words for real life.", "Parole per la vita.")}</h1><p>{t("Learn in context. Try from memory. Come back with confidence.", "Impara nel contesto. Prova a ricordare. Ritorna con fiducia.")}</p></header>
    <nav className="vocab-view-nav" aria-label={t("Vocabulary workspace", "Spazio del vocabolario")}>
      {[["practice",t("Practise", "Allenati")],["library",t("Explore words", "Esplora le parole")],["review",t("My review", "Il mio ripasso")]].map(([id,label]) => <button key={id} aria-current={view === id ? "page" : undefined} onClick={() => go(catalogueRoute("vocab-boost", {view:id}))}>{label}{id === "review" && totals.due > 0 && <span>{totals.due}</span>}</button>)}
    </nav>
    {view === "library" || view === "review" ? <VocabularyExplorer {...props} onStart={start} /> : <>

    {reviewId !== null ? <section className="panel vocab-launch">
      <h2>{t("Your scheduled word", "La parola da ripassare")}</h2>
      {reviewItem && due.some(item => item.id === reviewId) ? <button className="button primary" onClick={() => start([reviewItem], true)}>{t("Type this review", "Scrivi questo ripasso")}</button> : <p role="status">{t("This word is not due now. Choose a topic or return to your reviews.", "Questa parola non è da ripassare ora. Scegli un tema o torna ai ripassi.")}</p>}
      <button className="text-button" onClick={() => go("reviews")}>{t("Back to my review queue", "Torna ai miei ripassi")}</button>
      <button className="text-button" onClick={() => go("vocab-boost")}>{t("Choose vocabulary", "Scegli il vocabolario")}</button>
    </section> : <section className="panel vocab-launch">
      <label htmlFor="vocab-topic">{t("My topic", "Il mio tema")}</label>
      <select id="vocab-topic" value={bankId} onChange={event => choose(event.target.value)}>
        <option value="all">{t("Mix all topics", "Mescola tutti i temi")}</option>
        <option value="saved">{t("My saved words", "Le mie parole salvate")}</option>
        <optgroup label={t("Everyday vocabulary", "Vocabolario quotidiano")}>{vocabBanks.filter(bank => bank.original).map(bank => <option key={bank.id} value={bank.id}>{text(bank.title)}</option>)}</optgroup>
        <optgroup label={t("From my course", "Dal mio corso")}>{vocabBanks.filter(bank => !bank.original).map(bank => <option key={bank.id} value={bank.id}>{text(bank.title)}</option>)}</optgroup>
      </select>
      <button className="button primary vocab-start" disabled={!pool.length} onClick={() => start()}>{t(`Start ${Math.min(progress.settings.size, pool.length)} words`, `Inizia con ${Math.min(progress.settings.size, pool.length)} parole`)} →</button>
      {!pool.length ? <p role="status">{t("Save some words first, or choose another topic.", "Salva prima qualche parola oppure scegli un altro tema.")}</p> : <p className="hint">{t("Type every answer. Hints are always available.", "Scrivi ogni risposta. Gli indizi sono sempre disponibili.")}</p>}
      <details className="vocab-options"><summary>{t("Round options", "Opzioni del giro")}</summary>
        <label htmlFor="vocab-size">{t("Round length", "Lunghezza del giro")}</label>
        <select id="vocab-size" value={progress.settings.size} onChange={event => save(state => ({ ...state, vocabPractice: { ...(state.vocabPractice ?? emptyVocabPractice()), settings: { ...(state.vocabPractice ?? emptyVocabPractice()).settings, size: Number(event.target.value) as 5 | 10 } } }))}><option value={5}>{t("5 words", "5 parole")}</option><option value={10}>{t("10 words", "10 parole")}</option></select>
        <p>{t("Due words come first, then new words. Mistakes return for support. Practice points celebrate effort; they are not a language grade.", "Prima le parole da ripassare, poi quelle nuove. Gli errori tornano per aiutarti. I punti celebrano la pratica; non sono un voto linguistico.")}</p>
      </details>
    </section>}
    <div className="vocab-review-actions">
      {due.length > 0 && <button className="button secondary" onClick={() => start(due, true)}>{t(`Review due words (${due.length})`, `Ripassa le parole in scadenza (${due.length})`)}</button>}
      {mistakes.length > 0 && <button className="text-button" onClick={() => start(mistakes, true)}>{t(`Practise mistakes (${mistakes.length})`, `Riprova gli errori (${mistakes.length})`)}</button>}
    </div>
    <div className="vocab-memory-strip"><span><strong>{totals.recalled}</strong>{t("recalled without hints", "ricordate senza indizi")}</span><span><strong>{totals.learning}</strong>{t("need another try", "da riprovare")}</span><span><strong>{totals.due}</strong>{t("ready for review", "da ripassare")}</span></div>
    <section className="vocab-feature" aria-labelledby="vocab-feature-title">
      <div className="vocab-feature-heading"><span className="eyebrow">{t("FROM YOUR CLASS · WEEK 4", "DAL TUO CORSO · SETTIMANA 4")}</span><span className="vocab-feature-stamp" aria-hidden="true">Ciao,<br/>shopping!</span><h2 id="vocab-feature-title">{t("Find it. Try it. Make it yours.", "Cerca. Prova. Scegli.")}</h2><p>{t("A small shopping trip, from your first words to choosing between two things.", "Un piccolo giro di shopping, dalle prime parole alla scelta fra due cose.")}</p></div>
      <ol className="vocab-learning-path">{vocabBanks.filter(bank => bank.id.startsWith("week4-")).map((bank,index) => <li key={bank.id}><span className="vocab-path-number">0{index+1}</span><div><small>{bank.level === "A1" ? t("A1 essentials", "Basi A1") : t("A2 extension", "Estensione A2")}</small><h3>{text(bank.title)}</h3><p>{t(`${bank.words.length} words & phrases`, `${bank.words.length} parole ed espressioni`)}</p><button className="text-button" onClick={() => go(catalogueRoute("vocab-boost", {view:"library",bank:bank.id}))}>{t("Explore & learn", "Esplora e impara")} →</button></div></li>)}</ol>
    </section>
    <section className="vocab-library" aria-labelledby="vocab-library-title">
      <h2 id="vocab-library-title">{t("Choose a familiar topic", "Scegli un tema familiare")}</h2>
      <button className="text-button" onClick={() => go("vocab-boost?view=library")}>{t("Search every word, example & source", "Cerca tutte le parole, gli esempi e le fonti")} →</button>
      <p className="hint">{t(`${vocabItems.length} words and phrases · ${vocabBanks.length} topics · ${Object.keys(progress.records).length} practised`, `${vocabItems.length} parole ed espressioni · ${vocabBanks.length} temi · ${Object.keys(progress.records).length} parole allenate`)}</p>
      <label htmlFor="vocab-search">{t("Find a topic or word", "Cerca un tema o una parola")}</label>
      <input id="vocab-search" type="search" value={query} placeholder={t("e.g. food, travel, casa", "es. cibo, viaggi, casa")} onChange={event => { setQuery(event.target.value.slice(0, 100)); setVisible(6); replaceCatalogueParams({ bank: bankId, q: event.target.value.slice(0, 100) }); }} />
      <div className="vocab-library-filters">{[["everyday", t("Everyday", "Quotidiano")], ["course", t("My course", "Il mio corso")], ["all", t("All", "Tutti")]].map(([id, title]) => <button key={id} aria-pressed={group === id} onClick={() => { setGroup(id); setVisible(6); }}>{title}</button>)}</div>
      <div className="vocab-topic-grid">{matching.slice(0, visible).map(bank => {
        const seen = bank.words.filter(word => progress.records[word.id]).length;
        return <article className="vocab-topic-card" key={bank.id}><h3>{text(bank.title)}</h3><p>{t(`${seen}/${bank.words.length} practised`, `${seen}/${bank.words.length} allenate`)}</p><progress value={seen} max={bank.words.length} aria-label={t(`${text(bank.title)}: words practised`, `${text(bank.title)}: parole allenate`)} /><button className="text-button" onClick={() => { choose(bank.id); start(vocabPool(p, bank.id), false, bank.id); }}>{t("Type these words", "Scrivi queste parole")} →</button></article>;
      })}</div>
      {!matching.length && <p role="status">{t("No match yet. Try an English or Italian word.", "Nessuna corrispondenza. Prova una parola inglese o italiana.")}</p>}
      {matching.length > visible && <button className="button secondary" onClick={() => setVisible(value => value + 6)}>{t("Show more topics", "Mostra altri temi")}</button>}
    </section>
    </>}
    <nav className="practice-related" aria-label={t("Keep these words connected", "Collega queste parole")}>
      <button className="text-button" onClick={() => go("words")}>{t("My saved word bank", "Il mio lessico salvato")}</button>
      {view === "practice" && <button className="text-button" onClick={() => go(selectedBank ? `vocabulary/${selectedBank.id}` : "vocabulary")}>{t("Learn with vocabulary cards", "Impara con le carte lessico")}</button>}
      {view === "practice" && selectedBank?.relatedMissionIds?.[0] && <button className="text-button" onClick={() => go(`lesson/${selectedBank.relatedMissionIds![0]}`)}>{t("Use these words in a lesson", "Usa queste parole in una lezione")}</button>}
      <button className="text-button" onClick={() => go("practice")}>{t("All practice", "Tutta la pratica")}</button>
    </nav>
  </div>;
}

function VocabQuestion({ p, t, text, save, go, today, pdfs, pdfPageOffsets, round, item, onFinish }: Props & { round: ArcadeRound; item: VocabItem; onFinish: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const result = round.answers[item.id];
  const hint = round.hints.includes(item.id);
  const [ending, setEnding] = useState(false);
  const bank = vocabBanks.find(bank => bank.id === item.bankId);
  const saved = Boolean(p.academy?.words[wordKey(item.word.term)]?.starred);
  useEffect(() => { title.current?.focus({ preventScroll: true }); title.current?.scrollIntoView({ block: "nearest" }); }, []);
  useEffect(() => { if (result) { input.current?.blur(); feedback.current?.focus({ preventScroll: true }); feedback.current?.scrollIntoView({ block: "nearest" }); } }, [result]);
  const check = (event: FormEvent) => { event.preventDefault(); if (!result && round.draft.trim()) save(state => answerVocab(state, item, round.draft, today)); };
  const insertAccent = (accent: string) => {
    const start = input.current?.selectionStart ?? round.draft.length, end = input.current?.selectionEnd ?? start;
    save(state => updateVocabDraft(state, round.draft.slice(0, start) + accent + round.draft.slice(end)));
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(start + 1, start + 1); });
  };
  return <div className="workspace vocab-workspace vocab-round">
    <div className="vocab-round-top"><button className="text-button" onClick={() => go("practice")}>← {t("Pause & save", "Pausa e salva")}</button><span>{round.index + 1} / {round.itemIds.length}</span></div>
    <progress className="vocab-round-progress" value={Object.keys(round.answers).length} max={round.itemIds.length} aria-label={t("Round progress", "Avanzamento del giro")} />
    <form className="panel vocab-question" onSubmit={check}>
      <p className="eyebrow">{t("TYPE THIS IN ITALIAN", "SCRIVI IN ITALIANO")}</p>
      <h1 ref={title} tabIndex={-1} lang="en">{item.word.term.en}</h1>
      {item.paired && <p className="hint">{t("One of the listed forms is enough.", "Basta una delle forme indicate.")}</p>}
      {!result ? <>
        <label htmlFor="vocab-answer">{t("Your Italian", "Il tuo italiano")}</label>
        <input id="vocab-answer" ref={input} value={round.draft} maxLength={500} lang="it" autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="done" aria-describedby="vocab-answer-help" onChange={event => save(state => updateVocabDraft(state, event.target.value))} />
        <p id="vocab-answer-help" className="hint">{t("Include the article for “the” or “a”. Keep accents: è and e are different.", "Scrivi l’articolo per «the» o «a». Mantieni gli accenti: è ed e sono diversi.")}</p>
        <button type="submit" className="button primary vocab-check" disabled={!round.draft.trim()}>{t("Check answer", "Controlla la risposta")}</button>
        <div className="vocab-help"><button className="text-button" type="button" onClick={() => save(hintVocab)}>{t("Give me a hint", "Dammi un indizio")}</button><button className="text-button" type="button" onClick={() => save(state => answerVocab(hintVocab(state), item, "—", today))}>{t("Show the answer", "Mostra la risposta")}</button></div>
        {hint && <p className="vocab-hint" role="status">{text(item.hint)} · {t("Help recorded for this word", "Aiuto registrato per questa parola")}</p>}
        <details className="vocab-accents"><summary>{t("Accent keys · à è é ì ò ù", "Tasti accentati · à è é ì ò ù")}</summary><div>{["à", "è", "é", "ì", "ò", "ù"].map(accent => <button key={accent} type="button" aria-label={t(`Insert ${accent}`, `Inserisci ${accent}`)} onPointerDown={event => event.preventDefault()} onClick={() => insertAccent(accent)}>{accent}</button>)}</div></details>
      </> : <div ref={feedback} className={`vocab-feedback ${result.correct ? "is-correct" : "needs-practice"}`} tabIndex={-1} role="region" aria-label={t("Answer feedback", "Riscontro sulla risposta")}>
        <h2>{result.correct ? result.assisted ? t("You got it with help.", "Ci sei riuscito con aiuto.") : t("You remembered it!", "Te la sei ricordata!") : t("Let’s remember this one.", "Ricordiamo questa parola.")}</h2>
        {!result.correct && result.answer !== "—" && <p className="vocab-your-answer">{t("You wrote:", "Hai scritto:")} <span lang="it">{result.answer}</span></p>}
        <p className="vocab-model" lang="it">{result.correct ? result.answer : item.answers[0]}</p>
        {!result.correct && <p className="hint">{t("Compare the spelling and article. You can practise it again after this round.", "Confronta la grafia e l’articolo. Puoi riprovarla dopo questo giro.")}</p>}
        <button type="button" className="button primary vocab-next" onClick={() => round.index === round.itemIds.length - 1 ? onFinish() : save(nextVocabItem)}>{round.index === round.itemIds.length - 1 ? t("Finish round", "Concludi il giro") : t("Next word", "Prossima parola")} →</button>
        <button type="button" className="text-button" aria-pressed={saved} onClick={() => save(state => saveWord(state, item.word.term, item.word.exampleKind === "translation" ? undefined : item.word.example))}>{saved ? t("★ In my word bank", "★ Nel mio lessico") : t("☆ Save to my word bank", "☆ Salva nel mio lessico")}</button>
        <p className="vocab-next-review">{t("Next review", "Prossimo ripasso")}: <strong>{p.vocabPractice?.records[item.id]?.due}</strong></p>
        <details className="vocab-example"><summary>{item.word.exampleKind === "translation" ? t("Translation reminder", "Promemoria della traduzione") : t("Example & word details", "Esempio e dettagli della parola")}</summary><p lang="it">{item.word.example.it}</p><p lang="en">{item.word.example.en}</p>{item.word.plural && <p>{t("Plural:", "Plurale:")} <span lang="it">{item.word.plural.it}</span></p>}{item.answers.length > 1 && <p>{t("Also accepted:", "Altre forme accettate:")} <span lang="it">{item.answers.join(" · ")}</span></p>}{(item.unitId || bank?.relatedGrammarIds?.[0]) && <button className="text-button" type="button" onClick={() => go(`grammar/${item.unitId ?? bank!.relatedGrammarIds![0]}`)}>{t("Explain the grammar", "Spiega la grammatica")} →</button>}</details>
        <details className="vocab-example"><summary>{t("Where this word belongs", "Da dove viene questa parola")}</summary><WordSources item={item} t={t} text={text} go={go} pdfs={pdfs} pdfPageOffsets={pdfPageOffsets}/></details>
      </div>}
    </form>
    <p className="vocab-context">{text(item.title)} · {t("Saved as you go", "Si salva mentre procedi")}</p>
    <details className="vocab-end"><summary>{t("Change topic", "Cambia tema")}</summary>{ending ? <><p>{t("Submitted answers stay saved. This unfinished answer will be discarded.", "Le risposte inviate restano salvate. Questa risposta incompleta verrà eliminata.")}</p><button className="button secondary" onClick={() => { save(state => ({ ...state, vocabPractice: { ...state.vocabPractice!, active: null } })); go("vocab-boost"); }}>{t("End round and choose a topic", "Termina il giro e scegli un tema")}</button><button className="text-button" onClick={() => setEnding(false)}>{t("Keep this round", "Continua questo giro")}</button></> : <button className="text-button" onClick={() => setEnding(true)}>{t("End this round early", "Termina questo giro prima")}</button>}</details>
  </div>;
}
