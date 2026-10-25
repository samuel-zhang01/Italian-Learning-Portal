import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const base=process.env.PARLIAMO_URL||'http://127.0.0.1:5199';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Isolated local app only');
const root=execFileSync('browser-view',['--root'],{encoding:'utf8'}).trim();
const {chromium}=await import(pathToFileURL(root+'/node_modules/playwright-core/index.mjs').href);
const cfg=JSON.parse(await fs.readFile('/root/.config/browser-view/settings.json','utf8'));
const output='work/ui-enhancement';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless:true,args:cfg.allowNoSandbox?['--no-sandbox']:[]});
const checks=[], failures=[], errors=[], screenshots=[];
const phase=process.env.UI_AUDIT_PHASE||'all';
assert.ok(['all','normal','enlarged'].includes(phase));
const expectedChecks=phase==='normal'?348:phase==='enlarged'?126:474;
const routes=['today','session','programmes','grammar','grammar/a2-imperfetto','chapters','chapters/espresso2-u01','reviews','games','vocabulary','words','readiness','tense','discover','progress','plan','materials','diagnostics','weekly','listening','offline'];
async function audit(page,sample){
 const layout=await page.evaluate(()=>{
  const groups=['.daily-header nav','.lang-switch','.session-stages'];const clashes=[];
  for(const selector of groups){const nodes=[...document.querySelectorAll(selector+' > button')];for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
   const a=nodes[i].getBoundingClientRect(),b=nodes[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)clashes.push(selector);
  }}
  const controls=[...document.querySelectorAll('main button,main input:not([type=file]),main textarea,main select,.daily-header button')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&(r.left< -1||r.right>innerWidth+1)}).map(el=>({tag:el.tagName,text:el.textContent.slice(0,65)}));
  return{viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,clashes,controls};
 });
 const result={...sample,...layout};checks.push(result);if(layout.documentWidth>layout.viewport+1||layout.clashes.length||layout.controls.length)failures.push(result);
}
try{
 if(phase!=='enlarged') for(const width of [320,390,768,900,1280,1888])for(const language of ['en','it']){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});const page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',e=>errors.push({width,language,message:e.message}));
  for(const route of routes){await page.goto(base+'/?audit-route='+encodeURIComponent(route)+'#'+route);await page.locator('main h1').first().waitFor();
   if(await page.locator('html').getAttribute('lang')!==language)await page.getByRole('button',{name:language.toUpperCase(),exact:true}).click();
   await page.evaluate(()=>document.fonts.ready);await audit(page,{width,language,route,mode:'normal'});
   if(['session','diagnostics','listening'].includes(route)&&[320,1280].includes(width)){const name=`${language}-${width}-${route}.png`;await page.screenshot({path:output+'/'+name,fullPage:route!=='session'});screenshots.push(name);}
   if(route==='session'){
    const stages=page.locator('.session-stages button');assert.equal(await stages.count(),6);
    for(let i=0;i<6;i++){await stages.nth(i).click();await page.waitForFunction(()=>document.activeElement===document.querySelector('.session-activity h2'));await audit(page,{width,language,route,mode:'stage-'+i});}
    await stages.nth(0).click();const answer=page.locator('.session-activity textarea').first();await answer.fill('Synthetic layout draft — '+ 'parola'.repeat(60));await page.reload();await answer.waitFor();assert.match(await answer.inputValue(),/^Synthetic layout draft/);
    await audit(page,{width,language,route,mode:'long-saved-draft'});
   }
  }
  await page.locator('.practice-menu > summary').click();await audit(page,{width,language,route:'offline',mode:'expanded-tools'});
  await context.close();console.log('PASS layout width/language',width,language);
 }
 if(phase!=='normal') for(const mode of ['text','zoom'])for(const width of [320,768,900,1888])for(const language of ['en','it']){
  if(mode==='zoom'&&width===320)continue; // >=320 effective CSS-pixel width.
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});const page=await context.newPage();
  for(const route of ['today','session','grammar/a2-imperfetto','progress','chapters/espresso2-u01','diagnostics','weekly','listening','offline']){
   await page.goto(base+'/?audit-route='+encodeURIComponent(route)+'#'+route);await page.locator('main h1').first().waitFor();if(await page.locator('html').getAttribute('lang')!==language)await page.getByRole('button',{name:language.toUpperCase(),exact:true}).click();
   if(mode==='zoom')await page.addStyleTag({content:'body{zoom:2}'});else await page.evaluate(()=>{const sizes=[...document.querySelectorAll('.daily-app *')].map(el=>[el,parseFloat(getComputedStyle(el).fontSize)]);for(const[el,size]of sizes)el.style.setProperty('font-size',size*2+'px','important')});
   await audit(page,{width,language,route,mode});
   if(route==='session'&&width===1888){const name=`${language}-${width}-${mode}.png`;await page.screenshot({path:output+'/'+name});screenshots.push(name);}
  }await context.close();console.log('PASS enlarged matrix',mode,width,language);
 }
}catch(error){errors.push({message:error.message});throw error;}finally{await browser.close();await fs.writeFile(output+'/responsive-'+phase+'-report.json',JSON.stringify({passed:checks.length===expectedChecks&&!failures.length&&!errors.length,expectedChecks,checks,failures,errors,screenshots},null,2));}
console.log(JSON.stringify({checks:checks.length,failures,errors,screenshots:screenshots.length},null,2));assert.equal(checks.length,expectedChecks);assert.equal(failures.length,0);assert.equal(errors.length,0);
