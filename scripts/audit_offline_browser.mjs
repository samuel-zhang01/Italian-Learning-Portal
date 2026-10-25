import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const base=process.env.PARLIAMO_URL||'http://127.0.0.1:5200';
const isPublic=base==='https://italian.samuelzhang.co.uk';
assert.ok(isPublic||['localhost','127.0.0.1'].includes(new URL(base).hostname),'Exact authorized public origin or local built app only');
const root=execFileSync('browser-view',['--root'],{encoding:'utf8'}).trim();
const {chromium}=await import(pathToFileURL(root+'/node_modules/playwright-core/index.mjs').href);
const config=JSON.parse(await fs.readFile('/root/.config/browser-view/settings.json','utf8'));
const browser=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless:true,args:config.allowNoSandbox?['--no-sandbox']:[]});
const checks=[];const evidence=isPublic?'work/offline-public-audit':'work/offline-audit';await fs.mkdir(evidence,{recursive:true});
try{for(const lang of ['en','it']){
 const context=await browser.newContext({viewport:{width:390,height:900},ignoreHTTPSErrors:false});
 if(isPublic)await context.route('**/*',route=>{const request=route.request();return new URL(request.url()).origin===base&&['GET','HEAD'].includes(request.method())?route.continue():route.abort()});
 const page=await context.newPage();
 await page.goto(base+'/#offline');await page.locator('.offline-study').waitFor();if(lang==='it')await page.getByRole('button',{name:'IT',exact:true}).click();
 assert.equal(await page.evaluate(async()=> (await navigator.serviceWorker.getRegistrations()).length),0,'No automatic worker installation');
 await page.getByRole('button',{name:lang==='en'?'Download for offline use':'Scarica per l’uso offline',exact:true}).click();
 await page.getByRole('status').filter({hasText:lang==='en'?'Download ready.':'Download pronto.'}).waitFor();
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 const paths=await page.evaluate(async()=>{const key=(await caches.keys()).find(k=>k.startsWith('parliamo-public-'));return(await(await caches.open(key)).keys()).map(r=>new URL(r.url).pathname)});
 assert.ok(paths.includes('/'));assert.ok(paths.some(p=>p.includes('/assets/grammar-')));assert.ok(paths.every(p=>p==='/'||p==='/manifest.webmanifest'||p==='/app-icon.svg'||p==='/favicon.svg'||p.startsWith('/assets/')));
 checks.push({lang,check:'Explicit complete public download',assetCount:paths.length});
 await page.goto(base+'/#session');const draft=page.locator('.session-activity textarea').first();await draft.waitFor();await draft.fill('Synthetic offline draft');
 const before=await page.evaluate(()=>localStorage.getItem('parliamo-daily-v1'));await context.setOffline(true);await page.reload();await draft.waitFor();assert.equal(await draft.inputValue(),'Synthetic offline draft');
 for(const route of ['grammar/a2-imperfetto','chapters','games','vocabulary','diagnostics','weekly','listening','progress']){await page.goto(base+'/#'+route);await page.locator('main h1').first().waitFor();assert.equal(await page.locator('main').getByText('This section could not load.',{exact:true}).count(),0)}
 assert.equal(await page.evaluate(()=>localStorage.getItem('parliamo-daily-v1')),before);
 checks.push({lang,check:'Offline reload, eight lazy routes and pending draft preserved'});
 await context.setOffline(false);await page.goto(base+'/#offline');await page.locator('.offline-study').waitFor();
 await page.getByRole('button',{name:lang==='en'?'Check for an updated download':'Controlla aggiornamenti',exact:true}).click();await page.getByRole('status').filter({hasText:lang==='en'?'Download ready.':'Download pronto.'}).waitFor();
 await page.getByRole('button',{name:lang==='en'?'Remove offline download':'Rimuovi download offline',exact:true}).click();await page.getByRole('status').filter({hasText:lang==='en'?'Offline download removed.':'Download offline rimosso.'}).waitFor();
 assert.equal(await page.evaluate(async()=> (await caches.keys()).filter(k=>k.startsWith('parliamo-public-')).length),0);assert.equal(await page.evaluate(()=>localStorage.getItem('parliamo-daily-v1')),before);
 checks.push({lang,check:'Recheck and removal preserve progress'});await context.close();console.log('PASS offline',lang);
}}finally{await browser.close();await fs.writeFile(evidence+'/browser-report.json',JSON.stringify({checks,passed:checks.length===6},null,2));}
