/** Print the verified private study archive; no account, session or source scripts. */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.umask(0o077);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const booksRoot = path.join(root, "materials", "books");
const exportsRoot = path.join(booksRoot, "exports");
execFileSync("git", ["check-ignore", "--quiet", "--no-index", "materials/books/exports/privacy-probe.pdf"], { cwd: root });
const args = process.argv.slice(2);
const option = (key) => args.includes(key) ? args[args.indexOf(key) + 1] : "";
const ids = args.flatMap((value, index) => value === "--book-id" ? [args[index + 1]] : []);
if (!ids.length) ids.push("nuovo-espresso-plus-1", "nuovo-espresso-plus-2");
if (ids.some((id) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))) throw new Error("ValidBookIdRequired");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const escaped = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const confined = async (file) => {
  const relative = path.relative(booksRoot, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("PrivatePathRequired");
  let current = booksRoot;
  for (const part of ["", ...relative.split(path.sep)]) {
    current = part ? path.join(current, part) : current;
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error("SymlinkRefused"); }
    catch (error) { if (error.code === "ENOENT") break; throw error; }
  }
  return file;
};
const atomic = async (file, value) => {
  await confined(file); await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, value, { mode: 0o600, flag: "wx" }); await rename(temporary, file); }
  finally { await unlink(temporary).catch((e) => { if (e.code !== "ENOENT") throw e; }); }
};
const json = async (file) => JSON.parse(await readFile(await confined(file), "utf8"));
const verify = async (metadata) => {
  if (!metadata.path || !/^[a-f0-9]{64}$/.test(metadata.sha256) || !Number.isSafeInteger(metadata.bytes)) throw new Error("VerifiedInputRequired");
  const file = path.resolve(root, metadata.path);
  const bytes = await readFile(await confined(file));
  if (bytes.length !== metadata.bytes || sha(bytes) !== metadata.sha256) throw new Error("SourceChecksumMismatch");
  return { file, bytes };
};
const style = `
@page{size:A4;margin:17mm 14mm 18mm}
html,body{background:white!important;color:#182a20!important}
body{font-family:"DejaVu Sans",Arial,sans-serif;font-size:10pt;line-height:1.48;overflow-wrap:anywhere}
body>section{break-before:page}body>section:first-child{break-before:auto}
h1{font-size:18pt}h2{font-size:14pt}h3{font-size:12pt}h1,h2,h3,h4{break-after:avoid}
p,li{orphans:2;widows:2}img{max-width:100%;height:auto;max-height:150mm;object-fit:contain}
table{border-collapse:collapse;width:100%;table-layout:auto;font-size:9pt}td,th{padding:4px;border:1px solid #ccd3cd;overflow-wrap:anywhere}tr,figure{break-inside:avoid}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:9pt/1.5 "DejaVu Sans",Arial,sans-serif}
a{color:#235838;text-decoration:underline}audio,video{display:none}.media-reference{font-size:9pt;color:#405944;border-left:2px solid #9cab9e;padding:5px 9px}
`;
const printVersion = `private-interactive-print-v1:${sha(style)}`;
const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = createRequire(import.meta.url)(path.join(extension, "node_modules", "playwright-core"));
let browser, server;
const report = { schemaVersion: 1, generator: "scripts/export_interactive_pdfs.mjs", generatedAt: new Date().toISOString(), pathBase: "repository-root", printVersion, books: [] };
try {
  // An allowlist server exposes only hash-verified HTML/images to this isolated
  // printer. It has no directory listing, account data or public listener.
  const routes = new Map(), targets = [];
  for (const bookId of ids) {
    const folder = path.join(booksRoot, bookId);
    const manifestPath = path.join(folder, "interactive-manifest.json");
    const manifestBytes = await readFile(await confined(manifestPath));
    const manifest = JSON.parse(manifestBytes);
    const mediaPath = path.join(folder, "interactive", "media", "manifest.json");
    const mediaBytes = await readFile(await confined(mediaPath));
    const media = JSON.parse(mediaBytes);
    if (manifest.bookId !== bookId || manifest.inventory.length !== manifest.discoveredActivities || manifest.activities.length !== manifest.discoveredActivities) throw new Error("CompleteObservedInventoryRequired");
    const bySlug = new Map(manifest.activities.map((a) => [a.slug, a]));
    const activities = [];
    for (const item of manifest.inventory) {
      const activity = bySlug.get(item.slug);
      if (!activity || activity.pages.length !== activity.expectedPages || !activity.pages.length) throw new Error("CompleteStudyPagesRequired");
      const metadata = activity.files.find((file) => file.path === `interactive/${activity.slug}/content.html`);
      if (!metadata) throw new Error("ActivityHTMLRequired");
      const checked = await verify({ ...metadata, path: `materials/books/${bookId}/${metadata.path}` });
      if (/<(?:script|iframe|object|embed|input|textarea|select|button|form)\b/i.test(checked.bytes.toString("utf8"))) throw new Error("InertStudyHTMLRequired");
      const urlPath = `/${bookId}/interactive/${activity.slug}/content.html`;
      routes.set(urlPath, { file: checked.file, mime: "text/html; charset=utf-8" });
      activities.push({ section: activity.section, title: activity.title, slug: activity.slug, sourcePages: activity.pages.length, html: metadata, urlPath });
    }
    for (const item of media.files.filter((item) => item.status === "downloaded" && item.mime.startsWith("image/"))) {
      const checked = await verify({ ...item, path: `materials/books/${bookId}/interactive/${item.file}` });
      routes.set(`/${bookId}/interactive/${item.file}`, { file: checked.file, mime: item.mime });
    }
    targets.push({ bookId, title: manifest.bookTitle || bookId, activities, inventorySHA256: sha(manifestBytes), mediaManifestSHA256: sha(mediaBytes) });
  }
  server = createServer(async (request, response) => {
    try {
      const route = routes.get(new URL(request.url, "http://127.0.0.1").pathname);
      if (!route || !["GET", "HEAD"].includes(request.method)) { response.writeHead(404); response.end(); return; }
      let bytes = await readFile(await confined(route.file));
      if (route.mime.startsWith("text/html")) bytes = Buffer.from(bytes.toString("utf8").replace("style-src 'none'", "style-src 'unsafe-inline'"));
      response.writeHead(200, { "Content-Type": route.mime, "Content-Length": bytes.length, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: option("--chromium-executable") || process.env.BROWSER_EXECUTABLE_PATH || chromium.executablePath(), headless: true, chromiumSandbox: !args.includes("--allow-no-sandbox") });
  const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
  let externalRequests = 0, blockedLocalMediaRequests = 0;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { externalRequests++; await route.abort(); }
    else if (!routes.has(url.pathname)) {
      // Audio/video are exported as references, and are never fetched by the
      // printer. A browser's optional favicon is unrelated to study content.
      if (url.pathname === "/favicon.ico") await route.fulfill({ status: 204 });
      else { blockedLocalMediaRequests++; await route.abort(); }
    } else await route.continue();
  });
  const page = await context.newPage();
  const mergeProgram = `import json,hashlib,os,sys,tempfile
from pathlib import Path
import pymupdf as fitz
plan=json.loads(Path(sys.argv[1]).read_text())
output=Path(sys.argv[2]);pdf=fitz.open();toc=[];activities=[];last_section=None
for activity in plan['activities']:
 source=Path(activity['printFile']);raw=source.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=activity['printSHA256']:raise ValueError('PrintCacheChecksumMismatch')
 with fitz.open(stream=raw,filetype='pdf') as part:
  if part.is_encrypted or not len(part):raise ValueError('PrintablePDFRequired')
  start=len(pdf)+1
  if activity['section']!=last_section:toc.append([1,activity['section'],start]);last_section=activity['section']
  toc.append([2,activity['title'],start]);pdf.insert_pdf(part)
  activities.append({**{k:activity[k] for k in ['section','title','slug','sourcePages','html','printSHA256']},'startPage':start,'endPage':len(pdf),'pages':len(part)})
pdf.set_toc(toc);pdf.set_metadata({'title':plan['title']+' - interactive study activities','subject':'Private source export; blank responses. Source audio/video remain in the private media archive. Interactive page labels differ from physical PDF pages.','creator':'Parliamo private source exporter'})
fd,temp=tempfile.mkstemp(prefix=output.name+'.',suffix='.tmp',dir=output.parent);os.close(fd)
try:
 pdf.save(temp,garbage=4,deflate=True);pdf.close();os.replace(temp,output)
finally:
 if os.path.exists(temp):os.unlink(temp)
with fitz.open(output) as check:
 if len(check)!=activities[-1]['endPage'] or len(check.get_toc())!=len(toc):raise ValueError('MergedPDFVerificationFailed')
 print(json.dumps({'pages':len(check),'bookmarks':len(toc),'activities':activities}))
`;
  for (const target of targets) {
    const printed = [];
    for (const [index, activity] of target.activities.entries()) {
      const folder = path.join(exportsRoot, "_print-cache", target.bookId);
      const pdfFile = path.join(folder, `${activity.slug}.pdf`);
      const cacheFile = `${pdfFile}.json`;
      const cacheKey = sha(JSON.stringify([printVersion, activity.html.sha256, target.mediaManifestSHA256]));
      let cached = false;
      if (!args.includes("--force")) {
        try {
          const prior = await json(cacheFile);
          const bytes = await readFile(await confined(pdfFile));
          cached = prior.cacheKey === cacheKey && prior.sha256 === sha(bytes) && bytes.length === prior.bytes;
        } catch { /* Missing or changed print caches are regenerated. */ }
      }
      if (!cached) {
        if (index === 0) console.log(JSON.stringify({ bookId: target.bookId, stage: "render-first-activity" }));
        await page.goto(`${origin}${activity.urlPath}`, { waitUntil: "load", timeout: 60000 });
        const forbidden = await page.locator("script,iframe,object,embed,input,textarea,select,button,form").count();
        if (forbidden) throw new Error("InertStudyHTMLRequired");
        await page.addStyleTag({ content: style });
        const diagnostics = await page.evaluate(async () => {
          for (const node of document.querySelectorAll("audio,video")) {
            const note = document.createElement("p"); note.className = "media-reference";
            note.textContent = `${node.tagName === "AUDIO" ? "Source audio" : "Source video"} · available separately in the private media archive. Supplied transcript text follows where available.`;
            node.replaceWith(note);
          }
          const images = [...document.images].filter((image) => image.getAttribute("src"));
          await Promise.all(images.map((image) => image.complete ? undefined : new Promise((resolve) => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true }); setTimeout(resolve, 15000); })));
          return { images: images.length, failedImages: images.filter((image) => !image.complete || image.naturalWidth === 0).length, studyPages: document.body.querySelectorAll(":scope > section").length };
        });
        if (diagnostics.failedImages || diagnostics.studyPages !== activity.sourcePages) throw new Error("PrintSourceRenderMismatch");
        const header = `<div style="font:8px Arial;width:100%;padding:0 14mm;color:#526057">${escaped(target.title)} · ${escaped(activity.title)}</div>`;
        const footer = '<div style="font:8px Arial;width:100%;padding:0 14mm;color:#526057">Private study export · responses blank <span style="float:right">PDF <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>';
        if (index === 0) console.log(JSON.stringify({ bookId: target.bookId, stage: "print-first-activity", diagnostics }));
        let deadline;
        const bytes = await Promise.race([
          page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true, headerTemplate: header, footerTemplate: footer, tagged: true }),
          new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("ActivityPrintDeadline")), 60000); }),
        ]).finally(() => clearTimeout(deadline));
        await atomic(pdfFile, bytes);
        await atomic(cacheFile, JSON.stringify({ cacheKey, bytes: bytes.length, sha256: sha(bytes), diagnostics }) + "\n");
      }
      const bytes = await readFile(await confined(pdfFile));
      printed.push({ ...activity, printFile: pdfFile, printSHA256: sha(bytes) });
      if ((index + 1) % 20 === 0 || index === target.activities.length - 1) console.log(JSON.stringify({ bookId: target.bookId, processedActivities: index + 1, expectedActivities: target.activities.length }));
    }
    const planFile = path.join(exportsRoot, "_print-cache", target.bookId, "merge-plan.json");
    await atomic(planFile, JSON.stringify({ title: target.title, activities: printed }));
    const output = await confined(path.join(exportsRoot, `${target.bookId}-interactive-activities.pdf`));
    const merged = JSON.parse(execFileSync("python3", ["-c", mergeProgram, planFile, output], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }));
    const bytes = await readFile(output);
    report.books.push({ bookId: target.bookId, path: path.relative(root, output).split(path.sep).join("/"), sha256: sha(bytes), bytes: bytes.length, pages: merged.pages, bookmarks: merged.bookmarks, observedActivities: target.activities.length, sourceStudyPages: target.activities.reduce((sum, activity) => sum + activity.sourcePages, 0), sourceInventorySHA256: target.inventorySHA256, sourceMediaManifestSHA256: target.mediaManifestSHA256, activities: merged.activities });
    console.log(JSON.stringify({ bookId: target.bookId, physicalPDFPages: merged.pages, sourceStudyPages: report.books.at(-1).sourceStudyPages, activities: target.activities.length }));
  }
  report.externalRequests = externalRequests;
  report.blockedLocalMediaRequests = blockedLocalMediaRequests;
  if (externalRequests) throw new Error("UnexpectedPrinterRequest");
  await atomic(path.join(exportsRoot, "interactive-print-manifest.json"), JSON.stringify(report, null, 2) + "\n");
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
