import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { vocabItems, vocabPracticeItems, vocabItemById } from "../app/learning/vocab-catalogue.ts";
import { filterVocabulary, vocabularySummary, wordStatus, wordDue } from "../app/learning/vocab-explorer-model.ts";
import { answerVocab, startVocabRound, finishVocabRound, hintVocab } from "../app/learning/vocab-engine.ts";
import { emptyProgress, parseProgress, isCorrect } from "../app/learning/engine.ts";
import { saveWord } from "../app/learning/academy-engine.ts";
import { selectReviewQueue } from "../app/learning/review-queue.ts";
import { planningReviewCatalogue } from "../app/learning/planning-data.ts";
import curriculum from "../app/learning/curriculum.json" with { type: "json" };
import enrichment from "../app/learning/enrichment.json" with { type: "json" };
import companion from "../app/learning/companion.json" with { type: "json" };
import grammar from "../app/learning/grammar.json" with { type: "json" };
import library from "../app/learning/vocab-library.json" with { type: "json" };
const fresh = {query:"",bank:"all",source:"all",level:"all",status:"all"};
const today = "2026-11-03", sourceId="src-0885f267bac5";
const newWords = vocabItems.filter(item => item.bankId.startsWith("week4-"));
const missionIds = curriculum.missions.map(m => m.id);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;

test("source refresh preserves every prior content object and vocabulary identity", () => {
  const report=JSON.parse(readFileSync(new URL("../docs/week4-vocabulary-review.json",import.meta.url),"utf8"));
  for (const [path, baseline] of Object.entries(report.baseline)) {
    const [file,key]=path.split(".");
    const values={curriculum,enrichment,companion,grammar,library}[file][key].slice(0,baseline.count);
    assert.equal(createHash("sha256").update(JSON.stringify(canonical(values))).digest("hex"),baseline.sha256,path);
  }
  assert.ok(report.previousPracticeIds.every(id=>vocabItemById.has(id)));
});

test("shopping words distinguish lesson vocabulary from original extensions with resolvable physical pages", () => {
  assert.equal(newWords.length,60);
  assert.equal(newWords.filter(w=>w.level==="A1").length,45);
  assert.equal(newWords.filter(w=>w.level==="A2").length,15);
  for (const item of newWords) {
    assert.ok(["lesson","extension"].includes(item.word.provenance));
    assert.ok(item.word.example.en && item.word.example.it);
    assert.ok(isCorrect(item.word.term.it,item.answers));
    for (const ref of item.sourceRefs) {
      assert.equal(ref.id,sourceId);
      for (const number of ref.pages) assert.ok(companion.pages.some(page=>page.id===`${ref.id}-p${number}`));
    }
  }
  for (const page of [3,14]) assert.equal(companion.pages.find(p=>p.id===`${sourceId}-p${page}`).kind,"reference");
  assert.equal(companion.pages.filter(p=>p.sourceId===sourceId).length,14);
  const p=filterVocabulary(vocabItems,emptyProgress(),today,{...fresh,source:sourceId,level:"A1"});
  assert.equal(p.length,45);
  assert.equal(filterVocabulary(vocabItems,emptyProgress(),today,{...fresh,query:"impermeabile"})[0].word.term.it,"l’impermeabile");
});

test("reading and filtering do not claim recall; wrong and assisted attempts remain inspectable", () => {
  const word=newWords[0];
  const p=emptyProgress(),before=JSON.stringify(p);
  filterVocabulary(vocabItems,p,today,{...fresh,status:"new"});
  vocabularySummary(vocabItems,p,today);
  assert.equal(JSON.stringify(p),before);
  let state=finishVocabRound(answerVocab(startVocabRound(p,[word],today,"wrong"),word,"wrong",today));
  assert.equal(wordStatus(state.vocabPractice.records[word.id]),"learning");
  state=finishVocabRound(answerVocab(hintVocab(startVocabRound(state,[word],today,"hinted")),word,word.answers[0],today));
  const record=state.vocabPractice.records[word.id];
  assert.equal(record.first.correct,false);
  assert.equal(wordStatus(record),"learning");
  assert.equal(wordDue(record,today),false);
  assert.equal(wordDue(record,"2026-11-04"),true);
  assert.deepEqual(filterVocabulary(vocabItems,state,"2026-11-04",{...fresh,status:"due"}).map(x=>x.id),[word.id]);
  state=finishVocabRound(answerVocab(startVocabRound(state,[word],"2026-11-04","independent"),word,word.answers[0],"2026-11-04"));
  assert.equal(wordStatus(state.vocabPractice.records[word.id]),"recalled");
  const restored=parseProgress(JSON.stringify(state),missionIds);
  assert.equal(restored.vocabPractice.records[word.id].first.correct,false);
  assert.ok(selectReviewQueue(restored,planningReviewCatalogue,"2026-11-05").items.some(x=>x.id===`vocab:${word.id}`));
});

test("search and saved filters compose, including existing supplemental grammar identities", () => {
  const word=vocabItemById.get("grammar-word:avere:0");
  const p=saveWord(emptyProgress(),word.word.term);
  assert.deepEqual(filterVocabulary(vocabPracticeItems,p,today,{...fresh,status:"saved",query:"fame"}).map(w=>w.id),[word.id]);
  assert.deepEqual(filterVocabulary(vocabPracticeItems,p,today,{...fresh,status:"saved",source:sourceId}),[]);
  assert.equal(filterVocabulary(newWords,p,today,{...fresh,query:"SI"}).some(w=>w.word.term.it==="a me sì"),true);
  const accented=newWords.find(w=>w.word.term.it==="a me sì");
  assert.equal(isCorrect("a me si",accented.answers),false);
});
