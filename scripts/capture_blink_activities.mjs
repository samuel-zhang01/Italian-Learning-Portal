/** Archive sanitized, read-only study pages from the existing shared reader. */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeStudyPage } from "./blink-study-sanitizer.mjs";
import { createStudyMediaDownloader } from "./blink-study-media.mjs";

process.umask(0o077);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const option = (name) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : "";
const bookId = option("--book-id"), bookTitle = option("--book-title"), readerId = option("--reader-id");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bookId) || bookId.length > 160 || !bookTitle || bookTitle.length > 300 || !/^\d{1,20}$/.test(readerId)) {
  throw new Error("Supply --book-id <slug> --book-title <title> --reader-id <observed numeric ID>.");
}
const books = path.join(root, "materials", "books");
const bookFolder = path.join(books, bookId);
const destination = path.join(bookFolder, "interactive");
const mediaFolder = path.join(destination, "media");
const manifestPath = path.join(bookFolder, "interactive-manifest.json");
const mediaManifestPath = path.join(mediaFolder, "manifest.json");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const slug = (text) => text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const cleanUrl = (value) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1\]?)/i.test(url.hostname)) return null;
    return `${url.origin}${url.pathname}`;
  } catch { return null; }
};
const privatePath = async (file) => {
  const relative = path.relative(books, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("PrivatePathRequired");
  let current = books;
  for (const part of ["", ...relative.split(path.sep)]) {
    current = part ? path.join(current, part) : current;
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error("PrivateSymlinkRejected"); }
    catch (error) { if (error.code === "ENOENT") break; throw error; }
  }
  return file;
};
const atomic = async (file, bytes) => {
  await privatePath(file);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
};
const json = (file, data) => atomic(file, `${JSON.stringify(data, null, 2)}\n`);
const readJson = async (file, fallback) => {
  await privatePath(file);
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return fallback; throw error; }
};
const fingerprint = async (file) => digest(await readFile(await privatePath(file)));
const escaped = (value) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const htmlDocument = (title, body) => `<!doctype html>\n<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'none'; script-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>${escaped(title)}</title></head><body>${body}</body></html>\n`;


await privatePath(destination);
await mkdir(mediaFolder, { recursive: true, mode: 0o700 });
const lockPath = path.join(destination, ".capture.lock");
let lock;
try { lock = await open(await privatePath(lockPath), "wx", 0o600); }
catch (error) {
  if (error.code !== "EEXIST") throw error;
  const old = await readJson(lockPath, {});
  let running = true;
  if (Number.isInteger(old.pid) && old.pid > 0) { try { process.kill(old.pid, 0); } catch (probe) { if (probe.code === "ESRCH") running = false; } }
  if (running) throw new Error("InteractiveCaptureAlreadyRunning");
  await unlink(lockPath); lock = await open(lockPath, "wx", 0o600);
}
await lock.writeFile(JSON.stringify({ pid: process.pid }));
let browser, manifest;
try {
  const status = JSON.parse(execFileSync("browser-view", ["status"], { encoding: "utf8" }));
  const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
  const require = createRequire(import.meta.url);
  const { chromium } = require(path.join(extension, "node_modules", "playwright-core"));
  browser = await chromium.connectOverCDP(status.cdp);
  const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith("https://www.blinklearning.com/") && new RegExp(`#responsive/book/${readerId}(?:/|$)`).test(candidate.url()));
  if (!page) throw new Error("RequestedBookMustAlreadyBeOpen");
  page.setDefaultTimeout(20000);
  const indexUrl = await page.locator("iframe").first().evaluate((element) => element.src);
  const observed = new URL(indexUrl);
  if (observed.origin !== "https://www.blinklearning.com" || observed.pathname !== "/coursePlayer/clases2.php" || observed.searchParams.get("idcurso") !== readerId) throw new Error("ObservedBookIndexRequired");
  const outerFrame = async () => {
    const element = await page.locator("iframe").first().elementHandle();
    const frame = await element?.contentFrame();
    if (!frame) throw new Error("BookFrameUnavailable");
    return frame;
  };
  const restoreIndex = async () => {
    const frame = await outerFrame();
    await frame.goto(indexUrl, { waitUntil: "domcontentloaded" });
    // Some books start on a cover whose ordinary Units button creates the index.
    await frame.waitForFunction(() => document.querySelector("#list-units a") || [...document.querySelectorAll("button.btn-show-units")].some((button) => button.getClientRects().length));
    if (!await frame.locator("#list-units a").count()) await frame.locator("button.btn-show-units").click();
    await frame.locator("#list-units a").first().waitFor({ state: "attached" });
    return frame;
  };
  let frame = await restoreIndex();
  const sections = await frame.locator("#list-units a").evaluateAll((links) => links.map((link) => ({ title: (link.querySelector(".title")?.textContent || link.textContent || "").trim(), target: link.getAttribute("data-target") })).filter((item) => item.title && /^\d+$/.test(item.target)));
  if (!sections.length || sections.length > 100) throw new Error("UnboundedOrMissingContents");
  manifest = await readJson(manifestPath, { version: 1, bookId, bookTitle, readerId, activities: [] });
  if (manifest.bookId !== bookId || manifest.readerId !== readerId) throw new Error("InteractiveManifestBookMismatch");
  manifest.method = "Read-only navigation of source activity pages; sanitized study DOM with blank response slots; observed media requests only; no validation or answer submission.";
  const mediaManifest = await readJson(mediaManifestPath, { version: 1, bookId, files: [] });
  const mediaDownloader = createStudyMediaDownloader({ request: page.context().request, readerId, destination, mediaManifest, atomic, privatePath });
  const { download } = mediaDownloader;
  const openSection = async (section) => {
    const index = await restoreIndex();
    await index.locator(`#list-units a[data-target="${section.target}"]`).dispatchEvent("click");
    await index.getByRole("heading", { name: section.title, level: 2, exact: true }).waitFor({ state: "visible" });
    return index;
  };
  const all = [];
  if (argv.includes("--reuse-inventory")) {
    if (!manifest.inventory?.length || manifest.inventory.length !== manifest.discoveredActivities) throw new Error("VerifiedInventoryRequired");
    for (const entry of manifest.inventory) {
      const section = sections.find((item) => item.title === entry.section);
      if (!section) throw new Error("CachedInventorySectionMissing");
      all.push({ ...entry, target: section.target });
    }
  } else for (const section of sections.filter((item) => /^(?:Lezione \d+\s*(?:\||videocorso\b)|Facciamo il punto\b|Esercizi LEZIONE\b|Grammatica\b)/i.test(item.title))) {
    frame = await openSection(section);
    const content = frame.getByRole("region", { name: "Content", exact: true });
    const links = await content.locator("a.activity--title.activity--link").evaluateAll((nodes) => [...new Set(nodes.map((node) => node.textContent.trim()).filter((name) => name && !/^(?:Libro digitale|Soluzioni\b|Guida\b)/i.test(name)))]);
    for (const title of links) {
      const activitySlug = `${slug(section.title).slice(0, 80)}--${slug(title).slice(0, 70)}`;
      if (all.some((item) => item.slug === activitySlug)) throw new Error("DuplicateActivityIdentifier");
      all.push({ section: section.title, target: section.target, title, slug: activitySlug });
    }
  }
  manifest.discoveredActivities = all.length;
  manifest.inventory = all.map(({ section, title, slug }) => ({ section, title, slug }));
  manifest.activities = manifest.activities.filter((item) => all.some((entry) => entry.slug === item.slug));
  manifest.sections = sections.map((item) => item.title);
  await json(manifestPath, manifest);
  for (const activity of all) {
    if (option("--activity") && !`${activity.section} ${activity.title}`.includes(option("--activity"))) continue;
    const folder = path.join(destination, activity.slug);
    let record = manifest.activities.find((item) => item.slug === activity.slug);
    if (record?.status === "captured") {
      let valid = Number.isInteger(record.expectedPages) && record.expectedPages > 0 && record.files?.length === record.expectedPages * 2 + 2;
      for (const file of record.files || []) { try { valid &&= await fingerprint(path.join(bookFolder, file.path)) === file.sha256; } catch { valid = false; } }
      for (const media of record.media || []) { try { valid &&= media.status === "downloaded" && await fingerprint(path.join(destination, media.file)) === media.sha256; } catch { valid = false; } }
      if (valid && record.pages?.length === record.expectedPages) continue;
    }
    const knownPages = Number.isInteger(record?.expectedPages) && record.expectedPages > 1 && record.pages?.length === record.expectedPages ? record.expectedPages : null;
    record = { ...activity, status: "capturing", pages: [], files: [] };
    delete record.target;
    manifest.activities = [...manifest.activities.filter((item) => item.slug !== activity.slug), record];
    await json(manifestPath, manifest);
    try {
      record.stage = "open-source-activity";
      frame = await openSection({ title: activity.section, target: activity.target });
      const activityRegion = frame.getByRole("region", { name: "Content", exact: true });
      const sourceLink = activityRegion.getByRole("link", { name: activity.title, exact: true }).and(activityRegion.locator("a.activity--title.activity--link"));
      await pause(350);
      await sourceLink.click();
      record.stage = "wait-study-main";
      let study;
      for (let attempt = 0; attempt < 100 && !study; attempt++) {
        const activeBookFrame = await outerFrame();
        for (const candidate of page.frames()) {
          let parent = candidate;
          while (parent && parent !== activeBookFrame) parent = parent.parentFrame();
          const mainCount = await candidate.locator('[role="main"],main').count();
          if (argv.includes("--debug") && [0, 10].includes(attempt)) console.log(JSON.stringify({ debug: "study-frame", attempt, frame: page.frames().indexOf(candidate), insideBook: parent === activeBookFrame, mainCount }));
          if (parent === activeBookFrame && mainCount) { study = candidate; break; }
        }
        if (!study && attempt === 10 && await sourceLink.isVisible().catch(() => false)) await sourceLink.click();
        if (!study) await pause(200);
      }
      if (!study) throw new Error("StudyMainUnavailable");
      const tabs = study.locator('[role="tab"][aria-controls^="slider-item-"]');
      if (knownPages) await study.waitForFunction((count) => document.querySelectorAll('[role="tab"][aria-controls^="slider-item-"]').length === count, knownPages, { timeout: 20000 });
      else {
        // The study main can appear before the reader builds its page tabs.
        // Wait for ordinary tab initialization before treating it as one page.
        await tabs.first().waitFor({ state: "attached", timeout: 2000 }).catch((error) => { if (error.name !== "TimeoutError") throw error; });
        await pause(350);
      }
      const navigation = await tabs.evaluateAll((nodes) => nodes.map((node) => ({ control: node.getAttribute("aria-controls"), label: (node.textContent || "").trim() })));
      if (navigation.length > 300 || navigation.some((item) => !/^slider-item-\d+$/.test(item.control)) || new Set(navigation.map((item) => item.control)).size !== navigation.length) throw new Error("InvalidStudyPageNavigation");
      record.expectedPages = navigation.length || 1;
      if (argv.includes("--debug")) console.log(JSON.stringify({ debug: "source-main-ready", pages: record.expectedPages }));
      record.pageCountEvidence = navigation.length ? "All observed ordinary page tabs" : "Single study main without page tabs";
      const captured = [];
      for (let index = 0; index < record.expectedPages; index++) {
        record.stage = "capture-source-page";
        record.currentPage = index + 1;
        const tab = navigation[index];
        let pane;
        if (tab) {
          const button = study.locator(`[role="tab"][aria-controls="${tab.control}"]`);
          await button.click();
          // The reader leaves aria-selected stale after ordinary tab navigation.
          await study.waitForFunction((control) => {
            const indicator = document.querySelector(`[role="tab"][aria-controls="${control}"]`);
            return indicator?.classList.contains("active") || indicator?.getAttribute("aria-selected") === "true";
          }, tab.control, { timeout: 20000 });
          pane = study.locator(`#${tab.control}`);
          await pane.waitFor({ state: "attached" });
          if (!await pane.evaluate((node) => Boolean(node.closest('[role="main"],main')))) throw new Error("StudyPageOutsideMain");
        } else pane = study.locator('[role="main"],main').first();
        await pause(250);
        const clean = await pane.evaluate(sanitizeStudyPage);
        if (argv.includes("--debug")) console.log(JSON.stringify({ debug: "source-page", page: index + 1, chars: clean.text.length, media: clean.resources.length }));
        if (clean.html.length > 10_000_000 || !clean.html.trim()) throw new Error("EmptyOrUnboundedStudyPage");
        captured.push({ ...clean, page: index + 1, label: tab?.label || "1" });
      }
      if (captured.length !== record.expectedPages || await tabs.count() !== navigation.length) throw new Error("StudyPageCountChanged");
      const resourceGroups = new Map();
      for (const resource of captured.flatMap((item) => item.resources)) {
        const source = cleanUrl(resource.url);
        if (!source) continue;
        const existing = resourceGroups.get(source);
        if (existing) existing.variants.push(resource.url);
        else resourceGroups.set(source, { ...resource, variants: [resource.url] });
      }
      const resources = [...resourceGroups.values()];
      record.stage = "download-observed-media";
      const results = new Map();
      let queueIndex = 0;
      await Promise.all(Array.from({ length: 2 }, async () => {
        while (queueIndex < resources.length) { const resource = resources[queueIndex++]; results.set(cleanUrl(resource.url), await download(resource)); }
      }));
      mediaManifest.files = mediaDownloader.files();
      await json(mediaManifestPath, mediaManifest);
      const fileRecord = async (file, body) => {
        await atomic(file, body);
        const bytes = Buffer.from(body);
        return { path: path.relative(bookFolder, file).split(path.sep).join("/"), bytes: bytes.length, sha256: digest(bytes) };
      };
      const joined = [];
      for (const item of captured) {
        let html = item.html;
        for (const resource of item.resources) {
          const result = results.get(cleanUrl(resource.url));
          const local = result?.status === "downloaded" ? `../${result.file}` : "";
          html = html.replaceAll(`urn:parliamo-media:${resource.key}:end`, escaped(local));
        }
        html = html.replace(/\s(?:src|poster|href)=""/g, "");
        const name = `page-${String(item.page).padStart(3, "0")}`;
        record.files.push(await fileRecord(path.join(folder, `${name}.html`), htmlDocument(`${activity.title} · ${item.label}`, html)));
        record.files.push(await fileRecord(path.join(folder, `${name}.txt`), `${item.text}\n`));
        record.pages.push({ page: item.page, tabLabel: item.label, html: `${name}.html`, text: `${name}.txt`, slots: item.slots, questions: item.questions, sourceLinks: [...new Set(item.links.map(cleanUrl).filter(Boolean))] });
        joined.push({ html, text: item.text, label: item.label });
      }
      record.files.push(await fileRecord(path.join(folder, "content.html"), htmlDocument(activity.title, joined.map((item) => `<section><h2>${escaped(item.label)}</h2>${item.html}</section>`).join("\n"))));
      record.files.push(await fileRecord(path.join(folder, "content.txt"), joined.map((item, index) => `PAGE ${index + 1} · ${item.label}\n${item.text}`).join("\n\n") + "\n"));
      record.media = [...results.values()];
      record.status = record.media.some((item) => item.status !== "downloaded") ? "captured-text-media-incomplete" : "captured";
      record.answerHandling = "Response values and selections were never read. Inputs and editable responses are blank placeholders; feedback and validation controls are removed.";
      record.capturedAt = new Date().toISOString();
      record.stage = "complete";
      await json(path.join(folder, "manifest.json"), record);
      console.log(JSON.stringify({ bookId, activity: activity.title, pages: record.pages.length, expectedPages: record.expectedPages, media: record.media.length, status: record.status }));
    } catch (error) {
      record.status = "incomplete";
      record.error = error.name;
      if (/^[A-Z][A-Za-z]+$/.test(error.message)) record.reason = error.message;
      await json(path.join(folder, "manifest.json"), record);
      console.log(JSON.stringify({ bookId, activity: activity.title, status: record.status, stage: record.stage, page: record.currentPage, error: error.name }));
    }
    manifest.updatedAt = new Date().toISOString();
    await json(manifestPath, manifest);
    await restoreIndex();
  }
  manifest.updatedAt = new Date().toISOString();
  manifest.capturedActivities = manifest.activities.filter((item) => item.status === "captured").length;
  manifest.capturedPages = manifest.activities.reduce((sum, item) => sum + (item.pages?.length || 0), 0);
  await json(manifestPath, manifest);
  console.log(JSON.stringify({ bookId, discoveredActivities: all.length, capturedActivities: manifest.capturedActivities, capturedPages: manifest.capturedPages, mediaFiles: mediaDownloader.size() }));
} catch (error) {
  console.error(JSON.stringify({ bookId, error: error.name, status: "capture-stopped" }));
  process.exitCode = 1;
} finally {
  // For connectOverCDP this disconnects our transport; no page/context is closed.
  await browser?.close();
  await lock.close();
  await unlink(lockPath);
}
