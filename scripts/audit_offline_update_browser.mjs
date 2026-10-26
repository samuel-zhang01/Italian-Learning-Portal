import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Simulated CDN releases with real service workers in owned disposable Chromium.
process.umask(0o077);
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const extension=execFileSync('browser-view',['--root'],{encoding:'utf8'}).trim();
const {chromium}=await import(pathToFileURL(`${extension}/node_modules/playwright-core/index.mjs`).href);
const config=JSON.parse(await fs.readFile('/root/.config/browser-view/settings.json','utf8'));
const directory=path.join(repository,'site-dist'),evidence=path.join(repository,'work/offline-audit');
execFileSync('git',['check-ignore','--quiet','--no-index',path.join(evidence,'update-report.json')],{cwd:repository});
const OLD='1111111111111111',NEW='2222222222222222';
const index=await fs.readFile(path.join(directory,'index.html'),'utf8');
const worker=await fs.readFile(path.join(directory,'offline-worker.js'),'utf8');
assert.match(index,/<meta name="parliamo-offline-version" content="[a-f0-9]{16}"/,'Build the release-meta implementation before running this audit');
assert.match(worker,/parliamo-public-[a-f0-9]{16}/);
let phase=OLD,failDiscovery=false;
const network=[],checks=[],screenshots=[],errors=[],blockedRequests=[];
const html=version=>index.replace(/(<meta name="parliamo-offline-version" content=")[a-f0-9]{16}("\s*\/?>)/,(_match,open,close)=>open+version+close);
const script=version=>worker.replace(/parliamo-public-[a-f0-9]{16}/g,`parliamo-public-${version}`);
const server=http.createServer(async(request,response)=>{
 try{
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);return response.end()}
  const url=new URL(request.url,'http://localhost'),name=decodeURIComponent(url.pathname);
  const target=path.resolve(directory,'.'+(name==='/'?'/index.html':name));
  if(!target.startsWith(directory+path.sep)){response.writeHead(403);return response.end()}
  let bytes;
  if(name==='/'){
   const discovery=url.searchParams.has('parliamo-offline-release');
   if(discovery)network.push({kind:'fresh-html',phase,status:failDiscovery?503:200});
   if(discovery&&failDiscovery){response.writeHead(503,{'Content-Type':'text/html','Cache-Control':'no-store'});return response.end('Temporary synthetic update-check failure')}
   bytes=Buffer.from(html(phase));
  }else if(name==='/offline-worker.js'){
   const release=url.searchParams.get('release');
   if(release!==null&&release!==OLD&&release!==NEW){response.writeHead(404);return response.end()}
   // Canonical and old-query bodies stay old forever, simulating CDN cache hits.
   const served=release===NEW?NEW:OLD;
   network.push({kind:'worker',release,servedVersion:served});bytes=Buffer.from(script(served));
  }else bytes=await fs.readFile(target);
  const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.webp':'image/webp'}[path.extname(target)];
  response.writeHead(200,{'Content-Type':mime||'application/octet-stream','Cache-Control':name==='/offline-worker.js'?'public,max-age=14400':'no-store'});response.end(request.method==='HEAD'?undefined:bytes);
 }catch{response.writeHead(404);response.end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser,context,page,failure;
const pass=(scenario,check,detail={})=>{checks.push({scenario,check,...detail});console.log('PASS offline update',scenario,check)};
const raw=()=>page.evaluate(()=>localStorage.getItem('parliamo-daily-v1'));
const metadata=()=>page.locator('meta[name="parliamo-offline-version"]').getAttribute('content');
const registration=()=>page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration('/');return reg?{active:reg.active?.scriptURL,waiting:reg.waiting?.scriptURL,scope:reg.scope,updateViaCache:reg.updateViaCache}:null});
const until=async(predicate,message)=>{for(let i=0;i<200;i++){if(await predicate())return;await page.waitForTimeout(50)}assert.fail(message)};
async function runScenario(scenario){
 phase=OLD;failDiscovery=false;
 context=await browser.newContext({serviceWorkers:'allow',viewport:{width:390,height:900}});await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin===base&&['GET','HEAD'].includes(request.method()))return route.continue();blockedRequests.push({origin:url.origin,path:url.pathname,method:request.method()});return route.abort()});page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${base}/#offline`);await page.locator('.offline-study').waitFor();assert.equal(await metadata(),OLD);
 assert.equal(await registration(),null,'Opening Offline does not automatically install a worker');
 if(scenario==='legacy-canonical'){
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/offline-worker.js',{scope:'/',updateViaCache:'none'});await navigator.serviceWorker.ready});
  await until(async()=>Boolean((await registration())?.active),'Legacy canonical worker activates');
  await page.reload();await page.locator('.offline-study').waitFor();await page.getByRole('button',{name:'Check for an updated download',exact:true}).waitFor();
  assert.equal(new URL((await registration()).active).search,'');
 }else{
  await page.getByRole('button',{name:'Download for offline use',exact:true}).click();await page.getByRole('status').filter({hasText:'Download ready.'}).waitFor();
  await until(async()=>Boolean((await registration())?.active),'Old queried worker activates');
  assert.equal(new URL((await registration()).active).searchParams.get('release'),OLD);
 }
 pass(scenario,'Old worker installed and recognized',{canonical:scenario==='legacy-canonical'});
 await page.goto(`${base}/#session`);const draft=page.locator('.session-activity textarea').first();await draft.waitFor();await draft.fill(`Synthetic draft retained through ${scenario} update`);const before=await raw();
 phase=NEW;await page.reload();await draft.waitFor();assert.equal(await metadata(),OLD);assert.equal(await draft.inputValue(),`Synthetic draft retained through ${scenario} update`);
 pass(scenario,'Downloaded old shell remains pinned online with its old metadata and saved draft');
 await page.goto(`${base}/#offline`);await page.locator('.offline-study').waitFor();
 if(scenario==='old-release-query'){
  failDiscovery=true;await page.getByRole('button',{name:'Check for an updated download',exact:true}).click();
  await page.getByRole('status').filter({hasText:'The download could not be completed or checked.'}).waitFor();
  assert.equal(new URL((await registration()).active).searchParams.get('release'),OLD);assert.equal((await registration()).waiting,undefined);assert.equal(await raw(),before);
  pass(scenario,'Failed fresh metadata discovery reports an error instead of silently reusing the stale worker');failDiscovery=false;
 }
 const requestStart=network.length;
 await page.getByRole('button',{name:'Check for an updated download',exact:true}).click();const activate=page.getByRole('button',{name:'Use downloaded update and reload',exact:true});await activate.waitFor();
 const waiting=await registration();assert.equal(new URL(waiting.waiting).searchParams.get('release'),NEW,'The new query must come from fresh network HTML, not the pinned old shell');
 assert.equal(await metadata(),OLD);assert.equal(await raw(),before);
 const updateRequests=network.slice(requestStart);assert.ok(updateRequests.some(entry=>entry.kind==='fresh-html'&&entry.phase===NEW&&entry.status===200));assert.ok(updateRequests.some(entry=>entry.kind==='worker'&&entry.release===NEW&&entry.servedVersion===NEW));
 await activate.click();await page.waitForFunction(version=>document.querySelector('meta[name="parliamo-offline-version"]')?.content===version,NEW);
 assert.equal(await raw(),before);assert.equal(new URL((await registration()).active).searchParams.get('release'),NEW);
 const keys=await page.evaluate(async()=>(await caches.keys()).filter(name=>name.startsWith('parliamo-public-')));assert.deepEqual(keys,[`parliamo-public-${NEW}`]);
 pass(scenario,'Fresh HTML discovery selects the new immutable query; explicit activation updates shell/cache without changing progress',{release:NEW});
 await context.setOffline(true);await page.goto(`${base}/#session`);await draft.waitFor();assert.equal(await draft.inputValue(),`Synthetic draft retained through ${scenario} update`);assert.equal(await metadata(),NEW);assert.equal(await raw(),before);
 pass(scenario,'Activated new release and unfinished draft remain available offline');
 await context.setOffline(false);await page.goto(`${base}/#offline`);await page.locator('.offline-study').waitFor();await page.getByRole('button',{name:'Remove offline download',exact:true}).waitFor();
 const file=`${scenario}-new-release.png`;await page.screenshot({path:path.join(evidence,file),fullPage:false});screenshots.push(file);
 await page.getByRole('button',{name:'Remove offline download',exact:true}).click();await page.getByRole('status').filter({hasText:'Offline download removed.'}).waitFor();assert.equal(await registration(),null);assert.equal(await raw(),before);
 assert.equal(await page.evaluate(async()=>(await caches.keys()).filter(name=>name.startsWith('parliamo-public-')).length),0);
 pass(scenario,'Queried current-release registration is recognized and removed while learner storage is preserved');await context.close();context=undefined;
}
try{
 await fs.mkdir(evidence,{recursive:true});
 browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||'/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless:true,args:config.allowNoSandbox?['--no-sandbox']:[]});
 await runScenario('old-release-query');await runScenario('legacy-canonical');assert.deepEqual(errors,[]);assert.deepEqual(blockedRequests,[]);
}catch(error){failure=error;console.error(error.stack||error);if(page&&!page.isClosed())await page.screenshot({path:path.join(evidence,'update-failure.png'),fullPage:false}).catch(()=>{})}
finally{if(context)await context.close().catch(()=>{});if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await fs.mkdir(evidence,{recursive:true});await fs.writeFile(path.join(evidence,'update-report.json'),JSON.stringify({date:new Date().toISOString(),base,simulation:'Immutable stale canonical/old-query worker bodies with fresh network HTML and a new release-query body',checks,screenshots,network,errors,blockedRequests,passed:!failure&&checks.length===11,failure:failure?.message??null,limitations:['Owned isolated Chromium and synthetic learner data only; no shared profile or actual CDN configuration changed.','The legacy scenario verifies current app compatibility with a canonical active worker; a genuinely pre-fix cached app must first obtain newer application code to gain the new discovery logic.']},null,2)+'\n')}
if(failure)process.exitCode=1;
