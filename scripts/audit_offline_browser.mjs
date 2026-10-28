import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Owned disposable contexts only. Service workers are real; learner data is synthetic.
process.umask(0o077);
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=(process.env.PARLIAMO_URL||'http://127.0.0.1:5200').replace(/\/+$/,'');
const url=new URL(base),isPublic=base==='https://italian.samuelzhang.co.uk';
assert.ok(isPublic||(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/'&&!url.search&&!url.hash&&!url.username&&!url.password),'Exact authorized public origin or local built app only');
const extension=execFileSync('browser-view',['--root'],{encoding:'utf8'}).trim();
const {chromium}=await import(pathToFileURL(`${extension}/node_modules/playwright-core/index.mjs`).href);
const config=JSON.parse(await fs.readFile('/root/.config/browser-view/settings.json','utf8'));
const evidence=path.join(repository,isPublic?'work/offline-public-audit':'work/offline-audit');
execFileSync('git',['check-ignore','--quiet','--no-index',path.join(evidence,'browser-report.json')],{cwd:repository});
const checks=[],screenshots=[],errors=[],blocked=[],expectedAnalytics=[];
let browser,context,page,failure;
const pass=(language,check,detail={})=>{checks.push({language,check,...detail});console.log('PASS offline',language,check)};
const until=async(predicate,message)=>{for(let i=0;i<200;i++){if(await predicate())return;await page.waitForTimeout(50)}assert.fail(message)};
const raw=()=>page.evaluate(()=>localStorage.getItem('parliamo-daily-v1'));
const ready=language=>page.getByRole('status').filter({hasText:language==='en'?'Download ready.':'Download pronto.'});
const workers=()=>page.evaluate(async()=>{const registrations=await navigator.serviceWorker.getRegistrations();return registrations.map(reg=>({scope:reg.scope,updateViaCache:reg.updateViaCache,active:reg.active?.scriptURL,waiting:reg.waiting?.scriptURL,installing:reg.installing?.scriptURL}))});
try{
 await fs.mkdir(evidence,{recursive:true});
 browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||'/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless:true,args:config.allowNoSandbox?['--no-sandbox']:[]});
 for(const language of ['en','it']){
  context=await browser.newContext({viewport:{width:390,height:900},ignoreHTTPSErrors:false,serviceWorkers:'allow'});
  await context.route('**/*',route=>{const request=route.request(),target=new URL(request.url());if(target.origin===url.origin&&['GET','HEAD'].includes(request.method()))return route.continue();const event={origin:target.origin,path:target.pathname,method:request.method()};if(request.method()==='POST'&&target.pathname==='/cdn-cgi/rum'&&[url.origin,'https://cloudflareinsights.com'].includes(target.origin))expectedAnalytics.push(event);else blocked.push(event);return route.abort()});
  page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/#offline`);await page.locator('.offline-study').waitFor();
  if(language==='it')await page.getByRole('button',{name:'IT',exact:true}).click();
  const meta=page.locator('meta[name="parliamo-offline-version"]');assert.equal(await meta.count(),1);const version=await meta.getAttribute('content');assert.match(version,/^[a-f0-9]{16}$/);
  assert.deepEqual(await workers(),[],'No automatic service worker installation');
  await page.getByRole('button',{name:language==='en'?'Download for offline use':'Scarica per l’uso offline',exact:true}).click();await ready(language).waitFor();
  await until(async()=>Boolean((await workers())[0]?.active),'The explicitly downloaded worker activates');
  let registration=(await workers())[0],script=new URL(registration.active);
  assert.equal(script.origin,url.origin);assert.equal(script.pathname,'/offline-worker.js');assert.equal(script.searchParams.get('release'),version);assert.equal(registration.scope,`${url.origin}/`);assert.equal(registration.updateViaCache,'none');
  const cached=await page.evaluate(async()=>{const names=(await caches.keys()).filter(name=>name.startsWith('parliamo-public-'));const result=[];for(const name of names){const cache=await caches.open(name);result.push({name,paths:(await cache.keys()).map(request=>new URL(request.url).pathname),html:await(await cache.match('/')).text()})}return result});
  assert.equal(cached.length,1);assert.equal(cached[0].name,`parliamo-public-${version}`);assert.ok(cached[0].html.includes(`name="parliamo-offline-version" content="${version}"`));
  const paths=cached[0].paths;assert.ok(paths.includes('/'));assert.ok(paths.some(name=>name.includes('/assets/grammar-')));assert.ok(paths.every(name=>name==='/'||name==='/manifest.webmanifest'||name==='/app-icon.svg'||name==='/favicon.svg'||name.startsWith('/assets/')));
  await page.reload();await page.locator('.offline-study').waitFor();await page.getByRole('button',{name:language==='en'?'Check for an updated download':'Controlla aggiornamenti',exact:true}).waitFor();
  pass(language,'Explicit current-release query registration, complete public cache and queried-worker recognition',{version,workerQuery:script.search,assetCount:paths.length});
  await page.goto(`${base}/#session`);const draft=page.locator('.session-activity textarea').first();await draft.waitFor();await draft.fill('Synthetic offline draft');let before=await raw();
  await context.setOffline(true);await page.reload();await draft.waitFor();assert.equal(await draft.inputValue(),'Synthetic offline draft');
  for(const [target,selector] of [['grammar/a2-imperfetto','.academy-unit-heading h1'],['chapters','.chapter-card'],['games','.arcade-intro h1'],['practice','.practice-hub'],['vocab-boost','.vocab-start'],['vocabulary','.vocabulary-topic-heading'],['diagnostics','.insights-topic-grid'],['weekly','.weekly-learning-report'],['listening','.listening-workspace'],['listen-speak','.oral-catalogue'],['progress','.backup-transfer']]){await page.goto(`${base}/#${target}`);await page.locator(selector).first().waitFor();assert.equal(await page.locator('main').getByText('This section could not load.',{exact:true}).count(),0)}
  assert.equal(await raw(),before);
  await page.goto(`${base}/#listen-speak?minutes=5`);await page.locator('.oral-scene-grid button').first().click();await page.locator('.oral-run').waitFor();await page.locator('.oral-question input[type=radio]').first().check();before=await raw();
  await page.reload();await page.locator('.oral-run').waitFor();assert.equal(await page.locator('.oral-question input[type=radio]').first().isChecked(),true);assert.equal(await raw(),before);
  const screenshot=`${language}-queried-worker-offline-oral.png`;await page.screenshot({path:path.join(evidence,screenshot),fullPage:false});screenshots.push(screenshot);
  pass(language,'Offline reload, eleven lazy routes, guided draft and oral choice preserve stored progress');
  await context.setOffline(false);await page.goto(`${base}/#offline`);await page.locator('.offline-study').waitFor();
  await page.getByRole('button',{name:language==='en'?'Check for an updated download':'Controlla aggiornamenti',exact:true}).click();await until(async()=>{const button=page.getByRole('button',{name:language==='en'?'Check for an updated download':'Controlla aggiornamenti',exact:true});return await button.count()===1&&await button.isEnabled()},'The explicit update check finishes');await ready(language).waitFor();
  registration=(await workers())[0];script=new URL(registration.active);assert.equal(script.pathname,'/offline-worker.js');assert.equal(script.searchParams.get('release'),version);
  await page.getByRole('button',{name:language==='en'?'Remove offline download':'Rimuovi download offline',exact:true}).click();await page.getByRole('status').filter({hasText:language==='en'?'Offline download removed.':'Download offline rimosso.'}).waitFor();
  assert.deepEqual(await workers(),[],'Removal unregisters queried workers');assert.equal(await page.evaluate(async()=>(await caches.keys()).filter(name=>name.startsWith('parliamo-public-')).length),0);assert.equal(await raw(),before);
  pass(language,'Online current-release recheck and queried-worker removal preserve progress');await context.close();context=undefined;
 }
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
}catch(error){failure=error;console.error(error.stack||error);if(page&&!page.isClosed())await page.screenshot({path:path.join(evidence,'failure.png'),fullPage:false}).catch(()=>{})}
finally{if(context)await context.close().catch(()=>{});if(browser)await browser.close();await fs.mkdir(evidence,{recursive:true});await fs.writeFile(path.join(evidence,'browser-report.json'),JSON.stringify({date:new Date().toISOString(),base,isolation:'Owned fresh Chromium contexts with real service workers and synthetic progress only',checks,screenshots,errors,blockedRequests:blocked,expectedBlockedAnalytics:expectedAnalytics,passed:!failure&&checks.length===6,failure:failure?.message??null},null,2)+'\n')}
if(failure)process.exitCode=1;
