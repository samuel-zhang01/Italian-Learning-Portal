import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=execFileSync('browser-view',['--root'],{encoding:'utf8'}).trim();
const {chromium}=await import(pathToFileURL(root+'/node_modules/playwright-core/index.mjs').href);
const config=JSON.parse(await fs.readFile('/root/.config/browser-view/settings.json','utf8'));
const dir=path.resolve('site-dist');let phase='old';
const server=http.createServer(async(req,res)=>{try{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const target=path.resolve(dir,'.'+(name==='/'?'/index.html':name));
 if(!target.startsWith(dir+path.sep)){res.writeHead(403);return res.end()}
 let bytes=await fs.readFile(target);
 if(name==='/')bytes=Buffer.from(bytes.toString().replace('<head>',`<head><meta name="audit-release" content="${phase}">`));
 if(name==='/offline-worker.js')bytes=Buffer.from(bytes.toString().replace(/parliamo-public-[a-f0-9]+/g,`parliamo-public-audit-${phase}`));
 const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.webp':'image/webp'}[path.extname(target)];
 res.writeHead(200,{'Content-Type':mime||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
 }catch{res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless:true,args:config.allowNoSandbox?['--no-sandbox']:[]});const checks=[];
try{
 const context=await browser.newContext();const page=await context.newPage();await page.goto(base+'/#offline');await page.getByRole('button',{name:'Download for offline use',exact:true}).click();await page.getByRole('status').filter({hasText:'Download ready.'}).waitFor();
 await page.goto(base+'/#session');const draft=page.locator('.session-activity textarea').first();await draft.fill('Saved during offline version upgrade');const before=await page.evaluate(()=>localStorage.getItem('parliamo-daily-v1'));
 phase='new';await page.reload();await draft.waitFor();assert.equal(await page.locator('meta[name=audit-release]').getAttribute('content'),'old');assert.equal(await draft.inputValue(),'Saved during offline version upgrade');checks.push('New online HTML does not bypass pinned downloaded release');
 await page.goto(base+'/#offline');await page.getByRole('button',{name:'Check for an updated download',exact:true}).click();const activate=page.getByRole('button',{name:'Use downloaded update and reload',exact:true});await activate.waitFor();await activate.click();await page.waitForFunction(()=>document.querySelector('meta[name=audit-release]')?.content==='new');
 assert.equal(await page.evaluate(()=>localStorage.getItem('parliamo-daily-v1')),before);checks.push('Explicit activation loads the new downloaded shell without changing progress');
 await context.setOffline(true);await page.goto(base+'/#session');await draft.waitFor();assert.equal(await draft.inputValue(),'Saved during offline version upgrade');assert.equal(await page.locator('meta[name=audit-release]').getAttribute('content'),'new');checks.push('New release and unfinished draft work offline after update');await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await fs.mkdir('work/offline-audit',{recursive:true});await fs.writeFile('work/offline-audit/update-report.json',JSON.stringify({passed:checks.length===3,checks},null,2));}console.log(JSON.stringify(checks));
