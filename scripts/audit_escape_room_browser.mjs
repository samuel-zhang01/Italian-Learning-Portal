import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import curriculum from '../app/learning/curriculum.json' with {type:'json'};
import grammar from '../app/learning/grammar.json' with {type:'json'};
import {emptyProgress,dayKey,addDays,STORAGE_KEY} from '../app/learning/engine.ts';
import {emptyAcademy,getGrammarDraft} from '../app/learning/academy-engine.ts';

// Own disposable Chromium profiles; synthetic progress only, no production writes.
const base=process.argv[2] || 'http://127.0.0.1:5212';
const output=process.argv[3] || 'work/escape-room-2026-11-12/browser-local';
assert.ok(base==='https://italian.samuelzhang.co.uk' || /^http:\/\/127\.0\.0\.1:\d+$/.test(base));
assert.ok(output.startsWith('work/'));
const extension=execFileSync('browser-view',['--root'],{encoding:'utf8'}).trim();
const {chromium}=await import(pathToFileURL(`${extension}/node_modules/playwright-core/index.mjs`).href);
const settings=JSON.parse(await fs.readFile('/root/.config/browser-view/settings.json','utf8'));
const browser=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless:true,args:settings.allowNoSandbox?['--no-sandbox']:[]});
const today=dayKey(),sid='src-6c05684ab06a',programme=grammar.programmes.find(p=>p.id==='course3-integrated-recall');
const missions=curriculum.missions.filter(m=>m.id.startsWith('reviewlab-'));
const checks=[],layouts=[],errors=[],blocked=[],failed=[];
let failure;
await fs.mkdir(output,{recursive:true});
const pass=(name,language,width)=>{checks.push({name,language,width});console.log('PASS',language,width,name)};
const current=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),STORAGE_KEY);
async function go(page,route,selector){await page.goto(`${base}/#${route}`);await page.locator(selector).first().waitFor()}
async function seed(page,p,route,selector){await page.evaluate(({key,p})=>localStorage.setItem(key,JSON.stringify(p)),{key:STORAGE_KEY,p});await go(page,route,selector);await page.reload();await page.locator(selector).first().waitFor()}
async function layout(page,label){const d=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth}));layouts.push({label,...d});assert.ok(d.document<=d.width+1,`${label}: horizontal overflow`)}
try {
 for(const language of ['en','it']) for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},ignoreHTTPSErrors:false,reducedMotion:'reduce'});
  await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.origin===base&&['GET','HEAD'].includes(r.method())&&!u.pathname.startsWith('/api/profile/'))return route.continue();if(u.pathname!=='/cdn-cgi/rum')blocked.push({origin:u.origin,path:u.pathname,method:r.method()});return route.abort()});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)failed.push({url:r.url(),status:r.status()})});
  const t=(en,it)=>language==='en'?en:it;
  const p=emptyProgress();p.language=language;p.plan.course=3;p.notes='Earlier synthetic notebook.';
  p.completed['say-hello']={date:addDays(today,-7),firstCorrect:1,total:2,output:'Mi chiamo Lina.',supported:false,confidence:2};
  await go(page,'today','.today-workspace');await seed(page,p,'today','.class-update');
  await layout(page,`${language}-${width}-today`);
  await page.screenshot({path:`${output}/${language}-${width}-today.png`,fullPage:true});
  await page.getByRole('button',{name:t('Open class revision route','Apri il percorso di ripasso'),exact:false}).click();
  await page.locator('.academy-programme-banner h2').waitFor();
  assert.equal(await page.locator('.academy-programme-banner h2').innerText(),programme.title[language]);
  assert.equal((await current(page)).academy?.programme??null,null,'Preview does not select a programme');
  await page.reload();await page.locator('.academy-programme-banner h2').waitFor();
  assert.equal(await page.locator('.academy-programme-banner h2').innerText(),programme.title[language]);
  await page.getByRole('button',{name:t('Make this my programme','Scegli questo percorso'),exact:false}).click();
  assert.equal((await current(page)).academy.programme.id,programme.id);
  assert.equal((await current(page)).completed['say-hello'].firstCorrect,1);
  await layout(page,`${language}-${width}-programme`);
  await page.screenshot({path:`${output}/${language}-${width}-programme.png`,fullPage:true});
  await go(page,'today','.session-preview');
  assert.equal(await page.locator('.session-preview h2').innerText(),missions[0].title[language]);
  await page.getByRole('button',{name:t('Continue today','Continua oggi'),exact:false}).first().click();
  await page.locator('.session-activity').waitFor();
  assert.equal((await current(page)).sessions[today].missionId,missions[0].id);
  assert.match(await page.locator('.session-page > .eyebrow').innerText(),/^A2/);
  pass('Class revision preview, explicit programme choice and Today topic agree; earlier evidence is retained',language,width);
  for(let i=0;i<missions.length;i++){
   const m=missions[i];
   await go(page,`lesson/${m.id}`,'.study-paper');
   assert.equal(await page.locator('.study-paper h1').innerText(),m.title[language]);
   await page.locator('.source-note summary').click();
   assert.ok((await page.locator('.source-note').innerText()).includes('Solution_Italian_Level_2_Escape_Room_.docx'));
   assert.ok((await page.locator('.source-note').innerText()).includes(m.sources[0].pages.join(', ')));
   if(width===390) await page.screenshot({path:`${output}/${language}-${width}-${m.id}.png`,fullPage:true});
   assert.ok((await page.locator('.source-note').innerText()).includes(t('Rendered document pages','Pagine del documento renderizzato')));
   assert.ok((await page.locator('.source-note').innerText()).includes(t('Word pagination may differ','L’impaginazione in Word può variare')));
   await page.getByRole('button',{name:t('Try it from memory','Prova a memoria'),exact:true}).click();
   const input=page.getByLabel(t('Your answer in Italian','La tua risposta in italiano'),{exact:true});
   await input.fill('sbagliato');
   await page.getByRole('button',{name:t('Check my answer','Controlla la risposta'),exact:true}).click();
   await page.locator('.feedback.retry').waitFor();
   await input.fill(m.checks[0].answers[0]);
   await page.getByRole('button',{name:t('Check my answer','Controlla la risposta'),exact:true}).click();
   await page.getByRole('button',{name:t('Continue','Continua'),exact:true}).click();
   await input.fill(m.checks[1].answers[0]);
   await page.reload();await input.waitFor();assert.equal(await input.inputValue(),m.checks[1].answers[0]);
   await page.getByRole('button',{name:t('Check my answer','Controlla la risposta'),exact:true}).click();
   await page.getByRole('button',{name:t('Continue','Continua'),exact:true}).click();
   await page.getByLabel(t('My Italian','Il mio italiano'),{exact:true}).fill(m.model.it);
   const save=page.getByRole('button',{name:t('Save my practice','Salva la mia pratica'),exact:true});
   assert.equal(await save.isDisabled(),true,'Self-check required');
   await page.locator('.self-check input').nth(0).check();await page.locator('.self-check input').nth(1).check();
   await save.click();await page.locator('.finish-panel').waitFor();
   const state=await current(page);
   assert.equal(state.completed[m.id].firstCorrect,1);assert.equal(state.completed[m.id].output,m.model.it);
   assert.equal(state.reviews[m.id].due,addDays(today,1));
   await layout(page,`${language}-${width}-${m.id}`);
   pass(`${m.id}: wrong-answer feedback, reload, self-check, completion and next-day scheduling`,language,width);
  }
  await go(page,'progress','.notebook-list');
  for(const summary of await page.locator('.notebook-list summary').all()) await summary.click();
  for(const m of missions)assert.ok((await page.locator('.notebook-list').innerText()).includes(m.model.it));
  pass('Notebook contains both original personal responses',language,width);
  await go(page,'session','.session-activity');
  await page.locator('.session-activity textarea').fill('Ricordo prendi e scrivi.');
  await page.getByRole('button',{name:t('Save my warm-up','Salva il riscaldamento'),exact:true}).click();
  for(let n=0;n<4;n++){
   await page.getByRole('button',{name:t('Reveal the Italian','Mostra l’italiano'),exact:true}).click();
   await page.getByRole('button',{name:t('I remembered it','L’ho ricordato'),exact:true}).click();
  }
  await page.getByRole('button',{name:t('Vocabulary practice complete','Pratica lessico completata'),exact:true}).click();
  const scene=page.locator('.session-activity input[lang=it]');
  await scene.fill('rosso');await page.getByRole('button',{name:t('Check the scene answer','Controlla la risposta sulla scena'),exact:true}).click();
  await page.locator('.session-activity .feedback.incorrect').waitFor();
  await scene.fill('tazze');await page.reload();await scene.waitFor();assert.equal(await scene.inputValue(),'tazze');
  await page.getByRole('button',{name:t('Check the scene answer','Controlla la risposta sulla scena'),exact:true}).click();
  await page.getByRole('button',{name:t('Save my scene practice','Salva la pratica sulla scena'),exact:true}).click();
  await page.getByLabel(t('My conversation notes','Appunti della mia conversazione'),{exact:true}).fill('Abbiamo più tazze che piatti. Questo cestino è più leggero di quello.');
  await page.locator('.session-activity input[type=checkbox]').check();
  await page.getByRole('button',{name:t('Save my speaking practice','Salva la pratica orale'),exact:true}).click();
  await page.locator('.session-activity textarea').fill('Abbiamo più tazze che piatti.');
  await page.getByRole('button',{name:t('Save my memory trail','Salva la mia traccia'),exact:true}).click();
  await page.locator('.session-celebration').waitFor();
  assert.equal((await current(page)).sessions[today].bankId,'reviewlab-quantities');
  pass('Guided Class revision vocabulary, scene correction, reload, self-assessed speaking and memory trail complete together',language,width);
  // Bring the next-day schedule forward in synthetic data to exercise the actual review UI today.
  const due=await current(page);
  for(const m of missions){due.completed[m.id].date=addDays(today,-1);due.reviews[m.id].due=today;due.reviews[m.id].lastDate=addDays(today,-1)}
  await seed(page,due,`review/${missions[0].id}`,'.study-paper form');
  const answer=page.getByLabel(t('Your answer in Italian','La tua risposta in italiano'),{exact:true});
  assert.equal(await answer.inputValue(),'');
  assert.ok(!(await page.locator('.study-paper form').innerText()).includes(`Expected: ${missions[0].review.answers[0]}`));
  await answer.fill(missions[0].review.answers[0]);
  await page.getByRole('button',{name:t('Check recall','Controlla il ricordo'),exact:true}).click();
  assert.equal((await current(page)).reviews[missions[0].id].due,addDays(today,3));
  pass('Scheduled recall starts hidden and advances independently after a correct answer',language,width);
  // Existing work cannot complete the new personal-transfer checkpoint by itself.
  const done=await current(page);done.academy??=emptyAcademy();
  for(const id of programme.days[0].unitIds)done.academy.grammar[id]={...getGrammarDraft(done,id),completed:addDays(today,-1)};
  await seed(page,done,'programmes?programme=course3-integrated-recall','.academy-programme-days section.academy-sheet');
  const personal=page.locator('.academy-programme-days section.academy-sheet');
  await personal.locator('textarea').fill('Prendi un vaso. Scrivi il tuo nome.');
  await page.reload();await personal.locator('textarea').waitFor();
  assert.equal(await personal.locator('textarea').inputValue(),'Prendi un vaso. Scrivi il tuo nome.');
  const personalSave=personal.getByRole('button',{name:t('Save my self-assessed practice','Salva la mia pratica autovalutata'),exact:true});
  assert.equal(await personalSave.isDisabled(),true);
  for(const box of await personal.locator('input[type=checkbox]').all())await box.check();
  await personalSave.click();
  await page.getByRole('button',{name:t('Mark this day complete','Segna il giorno come completato'),exact:false}).click();
  assert.equal((await current(page)).academy.programme.day,1);
  await go(page,'today','.session-preview');
  assert.equal((await current(page)).sessions[today].missionId,missions[0].id,'Started session remains pinned after programme advances');
  pass('Fresh programme response, draft reload and self-check gate the next study day; today’s session stays pinned',language,width);
  await go(page,`vocab-boost?view=library&source=${sid}`,'.vocab-explorer');
  await page.getByLabel(t('Class material','Materiale del corso'),{exact:true}).selectOption(sid);
  assert.match(await page.locator('.word-results-toolbar p').innerText(),/^16 /);
  assert.equal(await page.locator('.word-card').count(),12);
  await layout(page,`${language}-${width}-vocabulary`);
  await page.screenshot({path:`${output}/${language}-${width}-vocabulary.png`,fullPage:true});
  await go(page,`companion/${sid}-p2`,'.academy-source-meta');
  assert.ok((await page.locator('main').innerText()).includes(t('private answer-key','correttore privato')));
  pass('All 16 vocabulary entries are discoverable by source; the answer key remains reference-only',language,width);
  if(language==='en'&&width===390){
   await go(page,'materials','input[type=file]');
   await page.locator('input[type=file]').setInputFiles('data/incoming/escape-room-2026-11-12/rendered/Solution_Italian_Level_2_Escape_Room_.pdf');
   await page.getByText(/1 matched · 0 unmatched · 0 unreadable/).waitFor();
   await go(page,`lesson/${missions[0].id}`,'.source-note summary');await page.locator('.source-note summary').click();
   const href=await page.getByRole('link',{name:'Open connected PDF',exact:false}).getAttribute('href');
   assert.match(href,/^blob:.*#page=1$/);
   pass('Private Class revision PDF matches by checksum and opens the reviewed rendered page locally',language,width);
  }
  for(const w of [320,768]){
   await page.setViewportSize({width:w,height:1000});await go(page,'today','.class-update');await layout(page,`${language}-${w}-today`);
   await go(page,`lesson/${missions.at(-1).id}`,'.study-paper, .finish-panel');await layout(page,`${language}-${w}-polite`);
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(failed,[]);
}catch(error){failure=error;console.error(error.message)}finally{
 await fs.writeFile(`${output}/report.json`,JSON.stringify({testedAt:new Date().toISOString(),base,passed:!failure,checks,layouts,errors,blocked,failed,failure:failure?.message,limitations:['Synthetic isolated Chromium profiles; no physical device or screen-reader audit.','The next-day review UI uses an explicitly advanced synthetic schedule, alongside automated real-date scheduling tests.']},null,2)+'\n');
 await browser.close();
}
if(failure)throw failure;
