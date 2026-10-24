/** Archive only book pages rendered by the user's existing shared reader. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name) => args[args.indexOf(name) + 1];
const bookId = args.includes("--book-id") ? arg("--book-id") : "";
const title = args.includes("--book-title") ? arg("--book-title") : "";
const nativeOnly = args.includes("--native-only");
const readerId = args.includes("--reader-id") ? arg("--reader-id") : null;
if (readerId !== null && !/^\d+$/.test(readerId)) throw new Error("Use the numeric book ID observed in the library.");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bookId) || !title) {
  throw new Error("Supply --book-id <stable-slug> and --book-title <exact reader title>.");
}
process.umask(0o077);
const destination = path.join(root, "materials", "books", bookId);
const status = JSON.parse(execFileSync("browser-view", ["status"], { encoding: "utf8" }));
const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(extension, "node_modules", "playwright-core"));
const browser = await chromium.connectOverCDP(status.cdp);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const slug = (name) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const writeJson = async (file, data) => {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
};
let manifest;
try {
  const candidates = browser.contexts().flatMap((context) => context.pages())
    .filter((page) => page.url().startsWith("https://www.blinklearning.com/"));
  const page = candidates.find((page) => readerId ? new RegExp(`#responsive/book/${readerId}(?:/|$)`).test(page.url()) : page.url().includes("#responsive/book/"));
  if (!page) throw new Error("Open the requested book in the shared browser first.");
  const indexFrameUrl = await page.locator("iframe").first().evaluate((element) => element.src);
  const observedIndex = new URL(indexFrameUrl);
  if (observedIndex.origin !== "https://www.blinklearning.com" || observedIndex.pathname !== "/coursePlayer/clases2.php") throw new Error("Open the book index before capturing its sections.");
  page.setDefaultTimeout(20000);
  const frameFor = async (part) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const frame = page.frames().find((f) => f.parentFrame() === page.mainFrame() && f.url().includes(part));
      if (frame) return frame;
      await pause(200);
    }
    throw new Error(`Reader frame unavailable: ${part}`);
  };
  const verifyTitle = async (frame) => {
    if (readerId) {
      const course = new URL(frame.url()).searchParams.get("idcurso");
      if (course !== readerId) throw new Error("The reader does not match the book ID observed in the library.");
      return;
    }
    await frame.waitForFunction((expected) => (document.body?.innerText ?? "").split("\n").slice(0, 10).some((line) => line.trim() === expected), title);
  };
  const returnToIndex = async () => {
    // Preserve the SPA's selected-book state; some readers' Return controls leave the book.
    const frame = page.frames().find((entry) => entry.parentFrame() === page.mainFrame() && entry.url().startsWith("https://www.blinklearning.com/coursePlayer/"));
    if (!frame) throw new Error("The shared book frame is no longer open.");
    await frame.goto(indexFrameUrl, { waitUntil: "domcontentloaded" });
    await frame.locator("#list-units a").first().waitFor({ state: "attached" });
    await verifyTitle(frame);
    return frame;
  };
  let reader = page.frames().find((f) => f.parentFrame() === page.mainFrame() && f.url().includes("librodigital_html.php"));
  if (reader) {
    await verifyTitle(reader);
    await returnToIndex();
  }
  let units = await frameFor("clases2.php");
  await verifyTitle(units);
  const restoreIndexIfNeeded = async () => {
    if (await units.locator("#list-units a").count()) return;
    // Some older attachment viewers return to the legacy index layout.
    units = await returnToIndex();
  };
  await restoreIndexIfNeeded();
  await units.locator("#list-units a").first().waitFor({ state: "attached" });
  const contents = await units.locator("#list-units a").evaluateAll((links) => links.map((link) => ({ title: (link.querySelector(".title")?.textContent ?? link.textContent).trim(), target: link.getAttribute("data-target") }))
    .filter((entry) => /^(intro|Lezione \d+\s*(?:\||videocorso$)|Facciamo il punto|Esercizi LEZIONE|Grammatica$|Soluzioni |Guida per)/i.test(entry.title) && /^\d+$/.test(entry.target)));
  const sections = [...new Set(contents.map((entry) => entry.title))];
  if (sections.length < 20) throw new Error("The book contents have not loaded completely.");
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const manifestPath = path.join(destination, "reader-manifest.json");
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch { /* First capture. */ }
  manifest ??= { version: 1, bookId, title, sections: [] };
  manifest.method = "Observed reader assets via ordinary range requests; unencrypted XPS and optional rendered canvases; no session export";
  if (readerId) manifest.readerId = readerId;
  if (manifest.bookId !== bookId || manifest.title !== title) throw new Error("Existing manifest belongs to another book.");
  manifest.contents = sections;
  manifest.updatedAt = new Date().toISOString();
  await writeJson(manifestPath, manifest);
  for (const section of sections) {
    if (args.includes("--section") && !section.includes(arg("--section"))) continue;
    let record = manifest.sections.find((item) => item.title === section);
    if (nativeOnly && record?.native?.sha256) {
      const file = path.resolve(destination, record.native.file);
      if (!file.startsWith(`${destination}${path.sep}`)) throw new Error("Invalid native cache path.");
      try {
        const bytes = await readFile(file);
        if (bytes.length === record.native.bytes && digest(bytes) === record.native.sha256) continue;
      } catch { /* Recapture a missing cache file. */ }
    } else if (!nativeOnly && record?.status === "captured") continue;
    record ??= { title: section, slug: slug(section), pages: [] };
    if (!manifest.sections.includes(record)) manifest.sections.push(record);
    try {
      record.stage = "open-section";
      units = await frameFor("clases2.php");
      await restoreIndexIfNeeded();
      // Invoke the reader's own section link, including its off-screen side menu.
      await units.locator(`#list-units a[data-target="${contents.find((entry) => entry.title === section).target}"]`).dispatchEvent("click");
      record.stage = "wait-section";
      await units.getByRole("heading", { name: section, level: 2, exact: true }).waitFor({ state: "visible" });
      record.stage = "read-activities";
      const content = units.getByRole("region", { name: "Content", exact: true });
      await content.waitFor();
      record.activities = await content.getByRole("link").evaluateAll((links) => [...new Set(links.map((link) => link.innerText.trim()))]
        .filter((name) => name && !name.endsWith(" Actions")));
      let digital = content.getByRole("link", { name: /^Libro digitale$/i });
      if (!await digital.count() && section.startsWith("Soluzioni")) {
        digital = content.getByRole("link", { name: section, exact: true });
      }
      if (!await digital.count()) {
        record.status = "no-digital-book-link";
        record.note = "Activity listed; its interactive/media content needs separate review.";
        await writeJson(manifestPath, manifest);
        console.log(JSON.stringify({ bookId, section, status: record.status }));
        continue;
      }
      await digital.click();
      record.stage = "load-document";
      reader = await frameFor("librodigital_html.php");
      await verifyTitle(reader);
      await reader.locator("#activepage").waitFor({ state: "attached" });
      await reader.waitForFunction(() => {
        const input = document.querySelector("#activepage");
        return /[1-9]/.test(input?.parentElement.parentElement.querySelector(".total")?.textContent ?? "");
      });
      const totalText = await reader.locator("#activepage").evaluate((input) => input.parentElement.parentElement.querySelector(".total").textContent);
      const total = Number(totalText.match(/\d+/)?.[0]);
      if (!Number.isInteger(total) || total < 1 || total > 500) throw new Error("Unverified document page count.");
      record.expectedPages = total;
      record.locator = "Document page index; printed book page must be verified from the capture.";
      await reader.locator(".pageContainer canvas.hacc").first().waitFor({ state: "attached" });
      if (nativeOnly) {
        record.stage = "download-observed-native-asset";
        const asset = await reader.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name).find((url) => /\.bpdf(?:[?#]|$)/i.test(url)));
        if (!asset) throw new Error("No native reader asset was observed.");
        const resource = new URL(asset);
        if (resource.origin !== "https://www.blinklearning.com" || !resource.pathname.startsWith("/useruploads/") || resource.username || resource.password) throw new Error("Unexpected reader asset location.");
        const request = page.context().request;
        const header = await request.get(asset, { headers: { Range: "bytes=0-63" }, timeout: 30000 });
        const bytesExpected = Number(header.headers()["content-range"]?.split("/")[1]);
        await header.dispose();
        if (!Number.isSafeInteger(bytesExpected) || bytesExpected < 64 || bytesExpected > 500 * 1024 * 1024) throw new Error("Native asset size was not bounded.");
        const response = await request.get(asset, { headers: { Range: `bytes=0-${bytesExpected - 1}` }, timeout: 120000 });
        if (response.status() !== 206) throw new Error("Native asset did not use the reader's ordinary range response.");
        const bytes = await response.body();
        await response.dispose();
        if (bytes.length !== bytesExpected || bytes.subarray(0, 4).toString("hex") !== "504b0304") throw new Error("Native asset is incomplete or has an unexpected format.");
        const nativeFolder = path.join(destination, "originals", "reader-native");
        await mkdir(nativeFolder, { recursive: true, mode: 0o700 });
        const file = path.join(nativeFolder, `${record.slug}.bpdf`);
        await writeFile(file, bytes, { mode: 0o600 });
        record.native = { file: path.relative(destination, file).split(path.sep).join("/"), originalFilename: path.basename(resource.pathname), source: `${resource.origin}${resource.pathname}`, bytes: bytes.length, sha256: digest(bytes) };
        record.status = record.pages.length === total ? "captured" : "native-captured";
        delete record.error;
        delete record.note;
        await returnToIndex();
        manifest.updatedAt = new Date().toISOString();
        await writeJson(manifestPath, manifest);
        console.log(JSON.stringify({ bookId, section, pages: total, bytes: bytes.length, status: record.status }));
        continue;
      }
      if (await reader.locator(".pageContainer").count() < total) {
        await reader.locator("#modo-continuo").click();
        await pause(400);
      }
      const folder = path.join(destination, "pages", record.slug);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      record.stage = "capture-pages";
      for (let number = 1; number <= total; number++) {
        record.lastAttemptedPage = number;
        const filename = `page-${String(number).padStart(3, "0")}.png`;
        const file = path.join(folder, filename);
        const previous = record.pages.find((entry) => entry.page === number);
        if (previous) {
          try { if (digest(await readFile(file)) === previous.sha256) continue; } catch { /* Recapture. */ }
        }
        const navigation = reader.locator("#activepage");
        if (!await navigation.isVisible()) await reader.locator("#tool-search").click();
        await navigation.fill(String(number));
        await navigation.press("Enter");
        await pause(200);
        const container = reader.locator(`#pageContainer${number}`);
        await container.scrollIntoViewIfNeeded();
        const canvas = container.locator("canvas.hacc");
        await canvas.waitFor({ state: "attached" });
        await pause(250);
        const captured = await canvas.evaluate((element) => ({ width: element.width, height: element.height, data: element.toDataURL("image/png") }));
        if (captured.width < 300 || captured.height < 300) throw new Error(`Page ${number} has not rendered.`);
        const bytes = Buffer.from(captured.data.split(",")[1], "base64");
        if (bytes.length < 5000) throw new Error(`Page ${number} appears blank or incomplete.`);
        await writeFile(file, bytes, { mode: 0o600 });
        const entry = { page: number, file: path.relative(destination, file).split(path.sep).join("/"), sha256: digest(bytes), bytes: bytes.length, width: captured.width, height: captured.height };
        record.pages = [...record.pages.filter((item) => item.page !== number), entry].sort((a, b) => a.page - b.page);
        record.status = "capturing";
        await writeJson(manifestPath, manifest);
      }
      record.status = record.pages.length === total ? "captured" : "incomplete";
      if (record.status === "captured") {
        delete record.error;
        delete record.note;
      }
      await returnToIndex();
      console.log(JSON.stringify({ bookId, section, pages: record.pages.length, status: record.status }));
    } catch (error) {
      record.status = "needs-review";
      record.error = error.name; // Exclude raw request data and browser diagnostics.
      console.log(JSON.stringify({ bookId, section, status: record.status, stage: record.stage, error: error.name, operation: error.message?.split(":")[0] }));
      reader = page.frames().find((f) => f.parentFrame() === page.mainFrame() && f.url().includes("librodigital_html.php"));
      if (reader) await returnToIndex().catch(() => {});
    }
    manifest.updatedAt = new Date().toISOString();
    await writeJson(manifestPath, manifest);
  }
  console.log(JSON.stringify({ bookId, capturedPages: manifest.sections.reduce((sum, section) => sum + section.pages.length, 0), sections: manifest.sections.length }));
} finally {
  await browser.close(); // Disconnect from CDP; leave the user's browser running.
}
