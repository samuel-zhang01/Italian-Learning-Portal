/** Request-only static study-source parity pilot. Raw source HTML/JSON stays in memory. */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeStudyPage } from "./blink-study-sanitizer.mjs";
import { createStudyMediaDownloader } from "./blink-study-media.mjs";
import { parseStudyCaptions } from "./blink-study-captions.mjs";

process.umask(0o077);
const argv = process.argv.slice(2);
const option = (key) => argv.includes(key) ? argv[argv.indexOf(key) + 1] : "";
const bookId = option("--book-id"), readerId = option("--reader-id");
const capturing = argv.includes("--capture");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bookId) || bookId.length > 160 || !/^\d{1,20}$/.test(readerId) || !(option("--activity") || capturing && argv.includes("--all"))) throw new Error("SupplyBookReaderAndActivityFilterOrCaptureAll");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bookFolder = path.join(root, "materials", "books", bookId);
const folder = path.join(bookFolder, "interactive-static-pilot");
const destination = path.join(bookFolder, "interactive");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const slug = (value) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const normalize = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("it");
const tokens = (value) => normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
const cleanUrl = (value) => { const url = new URL(value); return `${url.origin}${url.pathname}`; };
const escaped = (value) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const htmlDocument = (title, body) => `<!doctype html>\n<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'none'; script-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>${escaped(title)}</title></head><body>${body}</body></html>\n`;
const privatePath = async (file) => {
  const relative = path.relative(bookFolder, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("PrivatePathRequired");
  let current = path.join(root, "materials", "books");
  for (const part of ["", bookId, ...relative.split(path.sep)]) {
    current = part ? path.join(current, part) : current;
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error("PrivateSymlinkRejected"); }
    catch (error) { if (error.code === "ENOENT") break; throw error; }
  }
  return file;
};
const atomic = async (file, value) => {
  await privatePath(file);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, value, { mode: 0o600, flag: "wx" }); await rename(temporary, file); }
  finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
};
const readJson = async (file) => {
  await privatePath(file);
  if ((await lstat(file)).size > 50 * 1024 * 1024) throw new Error("UnboundedPrivateManifest");
  return JSON.parse(await readFile(file, "utf8"));
};
let sourceInventory, bootstrapped = false;
try { sourceInventory = await readJson(path.join(bookFolder, "interactive-manifest.json")); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  const readerPath = path.join(bookFolder, "reader-manifest.json");
  const reader = await readJson(readerPath);
  if (reader.bookId !== bookId || !Array.isArray(reader.sections) || reader.sections.length > 100) throw new Error("VerifiedReaderInventoryRequired");
  const inventory = [];
  for (const section of reader.sections.filter((item) => /^(?:Lezione \d+\s*(?:\||videocorso\b)|Facciamo il punto\b|Esercizi LEZIONE\b|Grammatica\b)/i.test(item.title))) {
    if (!Array.isArray(section.activities) || section.activities.length > 300) throw new Error("BoundedObservedActivitiesRequired");
    for (const title of [...new Set(section.activities.filter((item) => typeof item === "string").map((item) => item.trim()).filter((item) => item && !/^(?:Libro digitale|Soluzioni\b|Guida\b)/i.test(item) && !/\b(?:Grade|Actions)\b/.test(item)))]) {
      inventory.push({ section: section.title, title, slug: `${slug(section.title).slice(0, 80)}--${slug(title).slice(0, 70)}` });
    }
  }
  if (new Set(inventory.map((entry) => entry.slug)).size !== inventory.length) throw new Error("DuplicateObservedActivitySlugs");
  sourceInventory = { version: 1, bookId, bookTitle: reader.title || bookId, readerId, sections: reader.sections.map((item) => item.title), inventory, discoveredActivities: inventory.length, activities: [], inventoryEvidence: { path: "reader-manifest.json", sha256: digest(await readFile(readerPath)), method: "Existing reader-manifest section activity names observed through ordinary book DOM; study sections only, digital PDFs/solutions/guides and Grade/Actions wrappers excluded; intersected with exact source JSON unit/subunit titles before any activity request." } };
  bootstrapped = true;
}
if (sourceInventory.readerId !== readerId || sourceInventory.bookId !== bookId || !Array.isArray(sourceInventory.inventory) || sourceInventory.inventory.length !== sourceInventory.discoveredActivities || sourceInventory.inventory.length > 1000) throw new Error("VerifiedDOMInventoryRequired");
const requested = sourceInventory.inventory.filter((entry) => !option("--activity") || `${entry.section} ${entry.title}`.includes(option("--activity")));
if (!requested.length || requested.length > (capturing ? 1000 : 10)) throw new Error("ExpectedBoundedObservedActivities");
if (requested.some((entry) => !/^[a-z0-9][a-z0-9-]{0,159}$/.test(entry.slug))) throw new Error("InvalidActivitySlug");
const status = JSON.parse(execFileSync("browser-view", ["status"], { encoding: "utf8" }));
const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(extension, "node_modules", "playwright-core"));
let shared, isolated, lock, observedPage, sourceRequestObserver;
let stage = "attach-request-context";
const lockPath = path.join(destination, ".capture.lock");
try {
  if (capturing) {
    await privatePath(lockPath);
    await mkdir(destination, { recursive: true, mode: 0o700 });
    try { lock = await open(lockPath, "wx", 0o600); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const old = await readJson(lockPath);
      let running = true;
      if (Number.isInteger(old.pid) && old.pid > 0) { try { process.kill(old.pid, 0); } catch (probe) { if (probe.code === "ESRCH") running = false; } }
      if (running) throw new Error("InteractiveCaptureAlreadyRunning");
      await unlink(lockPath); lock = await open(lockPath, "wx", 0o600);
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    if (!bootstrapped) sourceInventory = await readJson(path.join(bookFolder, "interactive-manifest.json"));
  }
  shared = await chromium.connectOverCDP(status.cdp);
  const sharedPage = shared.contexts().flatMap((context) => context.pages()).find((page) => page.url().startsWith("https://www.blinklearning.com/") && new RegExp(`#responsive/book/${readerId}(?:/|$)`).test(page.url()));
  if (!sharedPage) throw new Error("RequestedBookMustAlreadyBeOpen");
  observedPage = sharedPage;
  const originalRequest = sharedPage.context().request;
  let activeRequests = 0, nextRequest = 0;
  const requestWaiters = [];
  const boundedRequest = async (method, ...args) => {
    if (activeRequests >= 2) await new Promise((resolve) => requestWaiters.push(resolve));
    else activeRequests++;
    try {
      const delay = Math.max(0, nextRequest - Date.now());
      nextRequest = Math.max(Date.now(), nextRequest) + 180;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return await originalRequest[method](...args);
    } finally { const next = requestWaiters.shift(); if (next) next(); else activeRequests--; }
  };
  const request = { get: (...args) => boundedRequest("get", ...args), head: (...args) => boundedRequest("head", ...args) };
  stage = "observe-book-source-json";
  const observedJson = new Map();
  const currentBookFrame = (frame) => {
    for (let parent = frame; parent; parent = parent.parentFrame()) {
      try { const url = new URL(parent.url()); if (url.origin === "https://www.blinklearning.com" && url.searchParams.get("idcurso") === readerId) return true; }
      catch { /* An ordinary navigation can briefly leave an empty frame URL. */ }
    }
    return false;
  };
  const rememberSource = (value, time) => {
    try {
      const url = new URL(value);
      if (url.origin === "https://www.blinklearning.com" && url.pathname === "/coursePlayer/curso_json.php" && (!url.searchParams.has("idcurso") || url.searchParams.get("idcurso") === readerId)) observedJson.set(value, Math.max(observedJson.get(value) || 0, time));
    } catch { /* Ignore unrelated request metadata. */ }
  };
  sourceRequestObserver = (request) => { try { if (currentBookFrame(request.frame())) rememberSource(request.url(), Date.now()); } catch { /* Ignore requests without a book frame. */ } };
  sharedPage.on("request", sourceRequestObserver);
  const observationDeadline = Date.now() + 20000;
  while (!observedJson.size && Date.now() < observationDeadline) {
    for (const frame of sharedPage.frames().filter(currentBookFrame)) {
      try {
        const entries = await frame.evaluate(() => performance.getEntriesByType("resource").filter((entry) => {
          try { const url = new URL(entry.name); return url.origin === "https://www.blinklearning.com" && url.pathname === "/coursePlayer/curso_json.php"; }
          catch { return false; }
        }).map((entry) => ({ name: entry.name, time: performance.timeOrigin + entry.startTime })));
        for (const entry of entries) rememberSource(entry.name, entry.time);
      } catch { /* The active renderer may replace this frame's context. */ }
    }
    if (!observedJson.size) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  sharedPage.off("request", sourceRequestObserver); sourceRequestObserver = null;
  if (!observedJson.size) throw new Error("OneObservedSourceJSONRequired");
  const observedSourceJSON = [...observedJson].sort((a, b) => b[1] - a[1])[0][0];
  const requestText = async (url, maximum, kind) => {
    const response = await request.get(url, { timeout: 45000, maxRedirects: 3 });
    try {
      const final = new URL(response.url());
      if (!response.ok() || final.origin !== "https://www.blinklearning.com" || /(?:login|signin)\b/i.test(final.pathname)) throw new Error("SourceRequestUnavailable");
      const declared = Number(response.headers()["content-length"]);
      if (Number.isFinite(declared) && declared > maximum) throw new Error("UnboundedSourceResponse");
      const body = await response.body();
      if (body.length > maximum) throw new Error("UnboundedSourceResponse");
      const text = body.toString("utf8");
      if (kind === "html" && !/<(?:!doctype|html|div)\b/i.test(text)) throw new Error("ExpectedStudyHTML");
      return text;
    } finally { await response.dispose(); }
  };
  const course = JSON.parse(await requestText(observedSourceJSON, 5 * 1024 * 1024, "json"));
  stage = "match-observed-source-inventory";
  if (!Array.isArray(course.units) || course.units.length > 100) throw new Error("ExpectedBoundedSourceUnits");
  const targets = requested.map((entry) => {
    const units = course.units.filter((unit) => normalize(unit.title) === normalize(entry.section));
    const matches = units.flatMap((unit) => Array.isArray(unit.subunits) ? unit.subunits : []).filter((item) => normalize(item.title) === normalize(entry.title));
    if (matches.length !== 1 || typeof matches[0].url !== "string") throw new Error("ObservedActivitySourceMatchRequired");
    const url = new URL(matches[0].url, "https://www.blinklearning.com");
    if (url.origin !== "https://www.blinklearning.com" || url.username || url.password || url.pathname !== "/coursePlayer/clases2.php" || url.searchParams.get("idcurso") !== readerId) throw new Error("ExactObservedBookActivityRequired");
    return { ...entry, url: url.href };
  });
  stage = "launch-isolated-parser";
  isolated = await chromium.launch({ executablePath: option("--chromium-executable") || process.env.BROWSER_EXECUTABLE_PATH || chromium.executablePath(), headless: true, chromiumSandbox: !argv.includes("--allow-no-sandbox") });
  const context = await isolated.newContext({ serviceWorkers: "block", acceptDownloads: false });
  let blockedNetworkRequests = 0;
  await context.route("**/*", async (route) => { blockedNetworkRequests++; await route.abort(); });
  const parser = await context.newPage();
  const reports = [];
  let persistQueue = Promise.resolve();
  const mediaDestination = capturing ? destination : folder;
  const mediaManifestPath = path.join(mediaDestination, "media", "manifest.json");
  let mediaManifest = { version: 1, bookId, files: [] };
  try { mediaManifest = await readJson(mediaManifestPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const mediaDownloader = createStudyMediaDownloader({ request, readerId, destination: mediaDestination, mediaManifest, atomic, privatePath });
  const persist = () => {
    persistQueue = persistQueue.then(async () => {
      sourceInventory.capturedActivities = sourceInventory.activities.filter((item) => item.status === "captured").length;
      sourceInventory.capturedPages = sourceInventory.activities.reduce((total, item) => total + (item.pages?.length || 0), 0);
      sourceInventory.updatedAt = new Date().toISOString();
      await atomic(path.join(bookFolder, "interactive-manifest.json"), JSON.stringify(sourceInventory, null, 2) + "\n");
      await atomic(mediaManifestPath, JSON.stringify({ version: 1, bookId, files: mediaDownloader.files() }, null, 2) + "\n");
    });
    return persistQueue;
  };
  const captureTarget = async (target) => {
    const existing = sourceInventory.activities.find((entry) => entry.slug === target.slug);
    if (capturing && !argv.includes("--force") && existing?.status === "captured" && existing.captureMethod === "static-source-inert-dom-v3-audio-captions") {
      let valid = existing.files?.length === existing.expectedPages * 2 + 2 && existing.pages?.length === existing.expectedPages;
      for (const item of existing.files || []) { try { valid &&= digest(await readFile(await privatePath(path.join(bookFolder, item.path)))) === item.sha256; } catch { valid = false; } }
      for (const item of existing.captionFiles || []) { try { valid &&= digest(await readFile(await privatePath(path.join(bookFolder, item.path)))) === item.sha256; } catch { valid = false; } }
      for (const item of existing.media || []) { try { valid &&= item.status === "downloaded" && digest(await readFile(await privatePath(path.join(destination, item.file)))) === item.sha256; } catch { valid = false; } }
      if (valid) return;
    }
    stage = "request-exact-source-html";
    const html = await requestText(target.url, 32 * 1024 * 1024, "html");
    stage = "parse-inert-source-html";
    const parsed = await parser.evaluate(({ html, base, trustedSanitizer }) => {
      // Only our sanitizer is compiled. Source markup stays in a detached,
      // inert DOMParser document; source scripts are never evaluated/attached.
      const sanitize = new Function(`return (${trustedSanitizer})`)();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const mains = [...doc.querySelectorAll('[role="main"],main')];
      const sourceSliders = [...doc.querySelectorAll('#slider.carousel-inner')];
      const diagnostics = { roleMainCount: mains.length, sourceSliderCount: sourceSliders.length, documentPaneCount: [...doc.querySelectorAll('[id^="slider-item-"]')].filter((node) => /^slider-item-\d+$/.test(node.id)).length, sourceScriptCount: doc.querySelectorAll("script").length, sourceInputCount: doc.querySelectorAll("input").length };
      // The reader adds role=main during initialization. Its original #slider
      // container is the same documented study region, without running JS.
      if (mains.length > 1 || !mains.length && sourceSliders.length !== 1) return { failure: "OneStudyMainRequired", diagnostics };
      const main = mains[0] || sourceSliders[0];
      const tabs = [...doc.querySelectorAll('[role="tab"][aria-controls^="slider-item-"]')].map((tab) => ({ control: tab.getAttribute("aria-controls"), label: (tab.textContent || "").trim() }));
      let panes = [...main.querySelectorAll('[id^="slider-item-"]')].filter((pane) => /^slider-item-\d+$/.test(pane.id));
      diagnostics.tabCount = tabs.length;
      diagnostics.studyPaneCount = panes.length;
      if (panes.length > 300 || tabs.length > 300) return { failure: "UnboundedStudyPages", diagnostics };
      if (new Set(panes.map((pane) => pane.id)).size !== panes.length || new Set(tabs.map((tab) => tab.control)).size !== tabs.length) return { failure: "DuplicateStudyPages", diagnostics };
      if (tabs.some((tab) => !/^slider-item-\d+$/.test(tab.control))) return { failure: "InvalidStudyPageControls", diagnostics };
      if (tabs.length) {
        // Source panes are staged outside #slider until the reader initializes.
        // Bind only exact IDs explicitly referenced by the observed page tabs;
        // unreferenced template/source panes are excluded.
        const bound = tabs.map((tab) => [...doc.querySelectorAll(`[id="${tab.control}"]`)]);
        if (bound.some((matches) => matches.length !== 1)) return { failure: "StaticTabPaneCountMismatch", diagnostics };
        panes = bound.map((matches) => matches[0]);
        diagnostics.boundSourcePaneCount = panes.length;
        diagnostics.unreferencedDocumentPanes = diagnostics.documentPaneCount - panes.length;
      }
      const ordered = tabs.length ? tabs.map((tab) => ({ pane: panes.find((pane) => pane.id === tab.control), label: tab.label })) : panes.length ? panes.sort((a, b) => Number(a.id.split("-").at(-1)) - Number(b.id.split("-").at(-1))).map((pane) => ({ pane, label: pane.id })) : [{ pane: main, label: "1" }];
      const pages = ordered.map(({ pane, label }, index) => ({ ...sanitize(pane, base), page: index + 1, label }));
      if (pages.some((page) => !page.html.trim() || page.html.length > 10_000_000)) return { failure: "EmptyOrUnboundedStudyPage", diagnostics };
      return { diagnostics, tabCount: tabs.length, paneCount: panes.length, pages };
    }, { html, base: target.url, trustedSanitizer: sanitizeStudyPage.toString() });
    if (parsed.failure) { console.log(JSON.stringify({ bookId, stage, diagnostics: parsed.diagnostics })); throw new Error(parsed.failure); }
    if (capturing && ["captured", "captured-text-media-incomplete", "captured-needs-rendered-transcript"].includes(existing?.status) && Number.isInteger(existing.expectedPages) && existing.expectedPages > 0 && existing.pages?.length === existing.expectedPages && existing.pages.every((page, index) => page.page === index + 1) && existing.files?.length === existing.expectedPages * 2 + 2 && parsed.pages.length !== existing.expectedPages) {
      let verifiedPrevious = true;
      for (const item of existing.files) {
        try { const bytes = await readFile(await privatePath(path.join(bookFolder, item.path))); verifiedPrevious &&= bytes.length === item.bytes && digest(bytes) === item.sha256; }
        catch { verifiedPrevious = false; }
      }
      if (verifiedPrevious) throw new Error("StaticRenderedPageCountMismatch");
    }
    stage = "compare-or-save-sanitized-study-pages";
    const captionResults = new Map();
    const captionGroups = new Map();
    for (const item of parsed.pages.flatMap((page) => page.resources).filter((item) => item.tag === "track" && ["captions", "subtitles"].includes(item.kind))) {
      const source = cleanUrl(item.url), previous = captionGroups.get(source);
      if (previous) { if (!previous.variants.includes(item.url)) previous.variants.push(item.url); }
      else captionGroups.set(source, { ...item, variants: [item.url] });
    }
    const captionResources = [...captionGroups.values()];
    let captionIndex = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (captionIndex < captionResources.length) {
        const resource = captionResources[captionIndex++];
        captionResults.set(cleanUrl(resource.url), await mediaDownloader.download(resource));
      }
    }));
    for (const page of parsed.pages) {
      page.captionTracks = [];
      const tracks = page.resources.filter((item) => item.tag === "track" && ["captions", "subtitles"].includes(item.kind));
      for (const [index, resource] of tracks.entries()) {
        const media = captionResults.get(cleanUrl(resource.url));
        const track = { player: resource.player, kind: resource.kind, srclang: resource.srclang, label: resource.label, status: media?.status || "not-downloaded", source: cleanUrl(resource.url) };
        page.captionTracks.push(track);
        if (media?.status !== "downloaded") continue;
        try {
          if (media.bytes > 5 * 1024 * 1024) throw new Error("UnboundedCaptionSource");
          const caption = parseStudyCaptions(await readFile(await privatePath(path.join(mediaDestination, media.file)), "utf8"), path.extname(new URL(resource.url).pathname), { recoverSourceText: true, allowPlainTranscript: true });
          const name = `page-${String(page.page).padStart(3, "0")}-captions-${String(index + 1).padStart(3, "0")}.txt`;
          const text = `${caption.text}\n`;
          const file = path.join(mediaDestination, target.slug, name);
          await atomic(file, text);
          Object.assign(track, { status: "derived", format: caption.format, cues: caption.cues, sourceBlocks: caption.sourceBlocks, warnings: caption.warnings, recoveredUntimedBlocks: caption.recoveredUntimedBlocks, noncanonicalTimingCues: caption.noncanonicalTimingCues, words: tokens(caption.text).length, path: path.relative(bookFolder, file).split(path.sep).join("/"), bytes: Buffer.byteLength(text), sha256: digest(text), derivedFrom: { path: path.relative(bookFolder, path.join(mediaDestination, media.file)).split(path.sep).join("/"), bytes: media.bytes, sha256: media.sha256 } });
          page.text += `\n\nSOURCE CAPTIONS\n${caption.text}`;
          page.html += `<section><h3>Source captions${resource.label ? ` · ${escaped(resource.label)}` : ""}</h3><pre>${escaped(caption.text)}</pre></section>`;
        } catch (error) {
          track.status = "caption-derivation-failed";
          track.reason = ["UnboundedCaptionSource", "ExpectedWebVTT", "ExpectedSubRip", "CaptionCuesRequired", "UnexpectedUntimedCaptionBlock", "InvalidCaptionTiming"].find((code) => error.message.includes(code)) || "CaptionReadFailure";
        }
      }
      page.needsRenderedTranscript = (page.videos || []).filter((video) => {
        const tracks = page.captionTracks.filter((track) => track.player === video.index);
        return !video.observedVideoSources || !tracks.length || tracks.some((track) => track.status !== "derived");
      }).map((video) => video.index);
    }
    if (!capturing) await atomic(mediaManifestPath, JSON.stringify({ version: 1, bookId, files: mediaDownloader.files() }, null, 2) + "\n");
    if (capturing) {
      const resources = new Map();
      for (const item of parsed.pages.flatMap((page) => page.resources)) {
        const source = cleanUrl(item.url);
        const previous = resources.get(source);
        if (previous) { if (!previous.variants.includes(item.url)) previous.variants.push(item.url); }
        else resources.set(source, { ...item, variants: [item.url] });
      }
      const queue = [...resources.values()], results = new Map();
      let index = 0;
      await Promise.all(Array.from({ length: 2 }, async () => {
        while (index < queue.length) { const resource = queue[index++]; results.set(cleanUrl(resource.url), await mediaDownloader.download(resource)); }
      }));
      for (const page of parsed.pages) {
        for (const video of page.videos || []) {
          const sources = page.resources.filter((item) => item.player === video.index && ["video", "source"].includes(item.tag));
          if (sources.some((item) => results.get(cleanUrl(item.url))?.status !== "downloaded") && !page.needsRenderedTranscript.includes(video.index)) page.needsRenderedTranscript.push(video.index);
        }
      }
      for (const page of parsed.pages) {
        const previous = existing?.pages?.find((item) => item.page === page.page);
        if (!previous) continue;
        try {
          const file = await privatePath(path.join(destination, target.slug, previous.html));
          const expected = existing.files.find((item) => item.path === path.relative(bookFolder, file).split(path.sep).join("/"));
          const bytes = await readFile(file);
          if (!expected || bytes.length !== expected.bytes || digest(bytes) !== expected.sha256) continue;
          const previousVideos = (bytes.toString("utf8").match(/<video\b/gi) || []).length;
          page.verifiedRenderedVideoCount = previousVideos;
          for (let index = page.videos?.length || 0; index < previousVideos; index++) page.needsRenderedTranscript.push(index);
        } catch { /* Unverified prior files cannot serve as a preservation fallback. */ }
      }
      for (const page of parsed.pages.filter((item) => item.needsRenderedTranscript.length)) {
        page.renderedTranscriptFallback = { status: "needs-rendered-transcript", players: page.needsRenderedTranscript };
        const previous = existing?.pages?.find((item) => item.page === page.page);
        if (!previous) continue;
        try {
          const saved = {};
          for (const [kind, name] of [["html", previous.html], ["text", previous.text]]) {
            const file = await privatePath(path.join(destination, target.slug, name));
            const relative = path.relative(bookFolder, file).split(path.sep).join("/");
            const expected = existing.files.find((item) => item.path === relative);
            const bytes = await readFile(file);
            if (!expected || digest(bytes) !== expected.sha256 || bytes.length !== expected.bytes) throw new Error("RenderedFallbackChecksumMismatch");
            saved[kind] = { value: bytes.toString("utf8"), sha256: expected.sha256 };
          }
          if (!saved.html.value.includes("script-src 'none'") || /<(?:script|iframe|object|embed|input|textarea|select|button|form)\b/i.test(saved.html.value)) throw new Error("UnsafeRenderedFallback");
          page.preservedRenderedHTML = saved.html.value;
          page.text = saved.text.value.trimEnd();
          page.slots = previous.slots || page.slots;
          page.questions = previous.questions || page.questions;
          page.renderedTranscriptFallback = { status: "preserved-rendered-page", players: page.needsRenderedTranscript, htmlSHA256: saved.html.sha256, textSHA256: saved.text.sha256 };
        } catch (error) {
          page.renderedTranscriptFallback.reason = ["RenderedFallbackChecksumMismatch", "UnsafeRenderedFallback"].find((code) => error.message.includes(code)) || "RenderedFallbackUnavailable";
        }
      }
      const activityFolder = path.join(destination, target.slug);
      const preservedRendered = parsed.pages.some((page) => page.preservedRenderedHTML);
      const mediaRecords = new Map();
      for (const item of [...(preservedRendered ? existing?.media || [] : []), ...results.values()]) {
        const key = item.source || `unresolved:${mediaRecords.size}`;
        if (mediaRecords.get(key)?.status !== "downloaded" || item.status === "downloaded") mediaRecords.set(key, item);
      }
      const record = { section: target.section, title: target.title, slug: target.slug, expectedPages: parsed.pages.length, pageCountEvidence: parsed.tabCount ? "All source HTML tabs and matching detached static study panes" : "All detached static study panes in source study main", captureMethod: "static-source-inert-dom-v3-audio-captions", sourceHTMLSHA256: digest(html), sourceHTMLBytes: Buffer.byteLength(html), pages: [], files: [], captionFiles: parsed.pages.flatMap((page) => page.captionTracks.filter((track) => track.status === "derived")), needsRenderedTranscript: parsed.pages.filter((page) => page.needsRenderedTranscript.length).map((page) => ({ page: page.page, ...page.renderedTranscriptFallback })), media: [...mediaRecords.values()], editorAudioPlayers: parsed.pages.reduce((sum, page) => sum + (page.editorAudios?.players || 0), 0), missingEditorAudioURIs: parsed.pages.reduce((sum, page) => sum + (page.editorAudios?.missingAudioURI || 0), 0), capturedAt: new Date().toISOString(), answerHandling: "Source response values were never read. Input, textarea, selection and editable responses are blank placeholders. Feedback and source scripts are removed." };
      const saveFile = async (name, value) => {
        const file = path.join(activityFolder, name);
        await atomic(file, value);
        return { path: path.relative(bookFolder, file).split(path.sep).join("/"), bytes: Buffer.byteLength(value), sha256: digest(value) };
      };
      const joined = [];
      for (const page of parsed.pages) {
        let html = page.html;
        for (const resource of page.resources) {
          const result = results.get(cleanUrl(resource.url));
          html = html.replaceAll(`urn:parliamo-media:${resource.key}:end`, result?.status === "downloaded" ? escaped(`../${result.file}`) : "");
        }
        html = html.replace(/\s(?:src|poster|href)=""/g, "");
        const name = `page-${String(page.page).padStart(3, "0")}`;
        record.files.push(await saveFile(`${name}.html`, page.preservedRenderedHTML || htmlDocument(`${target.title} · ${page.label}`, html)));
        record.files.push(await saveFile(`${name}.txt`, `${page.text}\n`));
        record.pages.push({ page: page.page, tabLabel: page.label, html: `${name}.html`, text: `${name}.txt`, slots: page.slots, questions: page.questions, sourceLinks: [...new Set(page.links.map(cleanUrl))], captionTracks: page.captionTracks, renderedTranscriptFallback: page.renderedTranscriptFallback });
        const preservedBody = page.preservedRenderedHTML?.match(/<body>([\s\S]*)<\/body>/i)?.[1];
        joined.push({ html: preservedBody || html, text: page.text, label: page.label });
      }
      record.files.push(await saveFile("content.html", htmlDocument(target.title, joined.map((page) => `<section><h2>${escaped(page.label)}</h2>${page.html}</section>`).join("\n"))));
      record.files.push(await saveFile("content.txt", joined.map((page, index) => `PAGE ${index + 1} · ${page.label}\n${page.text}`).join("\n\n") + "\n"));
      const unresolvedTranscripts = record.needsRenderedTranscript.filter((item) => item.status !== "preserved-rendered-page");
      if (record.needsRenderedTranscript.length) record.captionCoverageNote = "Source captions were not recoverable for every listed clip. Corresponding checksum-verified rendered pages are preserved where available; captionless media is retained without inventing a transcript.";
      record.status = unresolvedTranscripts.length ? "captured-needs-rendered-transcript" : record.missingEditorAudioURIs || record.media.some((item) => item.status !== "downloaded") ? "captured-text-media-incomplete" : "captured";
      await atomic(path.join(activityFolder, "manifest.json"), JSON.stringify(record, null, 2) + "\n");
      sourceInventory.activities = [...sourceInventory.activities.filter((entry) => entry.slug !== target.slug), record];
      sourceInventory.method = "Exact observed source activity URLs intersected with verified DOM inventory; detached static study DOM, no source script execution, no UI navigation, blank response sanitization; observed media only.";
      await persist();
      console.log(JSON.stringify({ bookId, activity: target.title, pages: record.pages.length, media: record.media.length, status: record.status, method: record.captureMethod }));
      return;
    }
    const rendered = sourceInventory.activities.find((entry) => entry.slug === target.slug);
    const pages = [];
    for (const page of parsed.pages) {
      let renderedText = null;
      const previous = rendered?.pages?.find((item) => item.page === page.page);
      if (previous) {
        const source = await privatePath(path.join(bookFolder, "interactive", target.slug, previous.text));
        renderedText = await readFile(source, "utf8");
      }
      const staticWords = tokens(page.text), renderedWords = renderedText === null ? [] : tokens(renderedText);
      const staticCounts = new Map();
      for (const word of staticWords) staticCounts.set(word, (staticCounts.get(word) || 0) + 1);
      const missing = [];
      for (const word of renderedWords) { if (staticCounts.get(word)) staticCounts.set(word, staticCounts.get(word) - 1); else missing.push(word); }
      const file = `page-${String(page.page).padStart(3, "0")}.txt`;
      const text = `${page.text}\n`;
      await atomic(path.join(folder, target.slug, file), text);
      pages.push({ page: page.page, text: file, bytes: Buffer.byteLength(text), sha256: digest(text), sourceWords: staticWords.length, renderedWords: renderedWords.length, exactNormalizedText: renderedText !== null && normalize(page.text) === normalize(renderedText), renderedMissingWords: missing.length, missingWords: missing.slice(0, 500), slots: page.slots, mediaCounts: page.resources.reduce((counts, item) => ({ ...counts, [item.tag]: (counts[item.tag] || 0) + 1 }), {}), playerSetups: page.playerSetups, editorPlayers: page.editorPlayers, editorAudios: page.editorAudios, captionTracks: page.captionTracks, needsRenderedTranscript: page.needsRenderedTranscript });
    }
    const report = { version: 1, bookId, title: target.title, section: target.section, slug: target.slug, method: "Exact source activity URL from observed curso_json endpoint, intersected with existing DOM inventory. Detached inert DOMParser in separate no-auth network-blocked browser; source scripts never executed; blank response sanitization.", source: cleanUrl(target.url), sourceHTMLBytes: Buffer.byteLength(html), sourceHTMLSHA256: digest(html), tabCount: parsed.tabCount, paneCount: parsed.paneCount, pages: pages.length, expectedRenderedPages: rendered?.expectedPages || null, matchingPageCount: rendered?.expectedPages === pages.length, allRenderedTextCovered: Boolean(rendered?.expectedPages === pages.length && pages.every((page) => page.renderedWords > 0 && page.renderedMissingWords === 0)), exactNormalizedPages: pages.filter((page) => page.exactNormalizedText).length, renderedMissingWords: pages.reduce((sum, page) => sum + page.renderedMissingWords, 0), pageReports: pages, blockedNetworkRequests, rawSourcesPersisted: false };
    await atomic(path.join(folder, target.slug, "manifest.json"), JSON.stringify(report, null, 2) + "\n");
    reports.push(report);
    console.log(JSON.stringify({ bookId, activity: target.title, staticPages: pages.length, renderedPages: report.expectedRenderedPages, matchingPageCount: report.matchingPageCount, exactNormalizedPages: report.exactNormalizedPages, missingWords: report.renderedMissingWords, allRenderedTextCovered: report.allRenderedTextCovered }));
  };
  let targetIndex = 0;
  const safeCodes = ["SourceRequestUnavailable", "UnboundedSourceResponse", "ExpectedStudyHTML", "OneStudyMainRequired", "UnboundedStudyPages", "DuplicateStudyPages", "StaticTabPaneCountMismatch", "StaticRenderedPageCountMismatch", "InvalidStudyPageControls", "EmptyOrUnboundedStudyPage", "PrivatePathRequired", "PrivateSymlinkRejected"];
  const outcomes = await Promise.allSettled(Array.from({ length: capturing ? 2 : 1 }, async () => {
    while (targetIndex < targets.length) {
      const target = targets[targetIndex++];
      try { await captureTarget(target); }
      catch (error) {
        if (!capturing) throw error;
        const reason = safeCodes.find((code) => new RegExp(`\\b${code}\\b`).test(error.message)) || "SourceOrParserFailure";
        const old = sourceInventory.activities.find((entry) => entry.slug === target.slug);
        let previousIntact = Boolean(old?.pages?.length && old?.files?.length);
        for (const item of old?.files || []) {
          try { previousIntact &&= digest(await readFile(await privatePath(path.join(bookFolder, item.path)))) === item.sha256; }
          catch { previousIntact = false; }
        }
        const attempt = { status: "incomplete", error: error.name, reason, attemptedAt: new Date().toISOString() };
        const record = previousIntact ? { ...old, staticAttempt: attempt } : { section: target.section, title: target.title, slug: target.slug, status: "incomplete", pages: [], files: [], ...attempt, captureMethod: "static-source-inert-dom-v3-audio-captions", previousRepresentationHadPages: Boolean(old?.pages?.length) };
        await atomic(path.join(destination, target.slug, "manifest.json"), JSON.stringify(record, null, 2) + "\n");
        sourceInventory.activities = [...sourceInventory.activities.filter((entry) => entry.slug !== target.slug), record];
        await persist();
        console.log(JSON.stringify({ bookId, activity: target.title, status: record.status, reason }));
        process.exitCode = 1;
      }
    }
  }));
  for (const result of outcomes) if (result.status === "rejected") throw result.reason;
  if (!capturing) await atomic(path.join(folder, "manifest.json"), JSON.stringify({ version: 1, bookId, method: "Static source parity pilot; not a full interactive capture", activities: reports, rawSourcesPersisted: false }, null, 2) + "\n");
} catch (error) {
  const safeCodes = ["InteractiveCaptureAlreadyRunning", "RequestedBookMustAlreadyBeOpen", "OneObservedSourceJSONRequired", "SourceRequestUnavailable", "UnboundedSourceResponse", "ExpectedStudyHTML", "ExpectedBoundedSourceUnits", "ObservedActivitySourceMatchRequired", "ExactObservedBookActivityRequired", "OneStudyMainRequired", "UnboundedStudyPages", "DuplicateStudyPages", "StaticTabPaneCountMismatch", "StaticRenderedPageCountMismatch", "InvalidStudyPageControls", "EmptyOrUnboundedStudyPage", "PrivatePathRequired", "PrivateSymlinkRejected"];
  const reason = safeCodes.find((code) => new RegExp(`\\b${code}\\b`).test(error.message)) || "SourceOrParserFailure";
  console.error(JSON.stringify({ status: "static-pilot-failed", stage, error: error.name, reason }));
  process.exitCode = 1;
} finally {
  if (sourceRequestObserver) observedPage?.off("request", sourceRequestObserver);
  await isolated?.close();
  if (shared) await shared.close(); // Disconnect this CDP client; preserve the existing browser.
  if (lock) { await lock.close(); await unlink(lockPath); }
}
