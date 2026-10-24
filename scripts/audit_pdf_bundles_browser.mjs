import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { emptyProgress, parseProgress } from "../app/learning/engine.ts";

// Own disposable browser and synthetic storage; never attach to shared CDP.
const browserRoot = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(`${browserRoot}/node_modules/playwright-core/index.mjs`).href);
const config = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const base = process.env.PARLIAMO_URL || "http://127.0.0.1:5197";
const evidenceDir = process.env.PDF_BUNDLE_REPORT_DIR || "work/pdf-bundle-browser";
const [curriculum, grammar, companion] = await Promise.all(["curriculum", "grammar", "companion"].map(async (name) => JSON.parse(await fs.readFile(`app/learning/${name}.json`, "utf8"))));
const book1 = "src-1647be2784c9", book2 = "src-580f7558db56";
const source1 = curriculum.sources.find((s) => s.id === book1), source2 = curriculum.sources.find((s) => s.id === book2);
const mission = curriculum.missions.find((m) => m.sources.some((s) => s.id === book2));
const unit = grammar.units.find((u) => u.sources.some((s) => s.id === book2));
const citedPage = companion.pages.find((p) => p.sourceId === book2 && p.page === 33);
assert.ok(source1 && source2 && mission && unit && citedPage);
const checks = [], errors = [], screenshots = [], layouts = [], forbiddenRequests = [];
const pass = (label, evidence = {}) => { checks.push({ label, ...evidence }); console.log("PASS", label); };
let browser, context, page, failure;
const go = async (route) => {
  await page.goto(`${base}/#${route}`);
  await page.locator(".daily-header").waitFor();
  await page.waitForTimeout(100);
};
const until = async (fn, label) => {
  for (let tries = 0; tries < 120; tries++) {
    if (await fn()) return;
    await page.waitForTimeout(100);
  }
  assert.fail(label);
};
const connections = () => page.getByRole("region", { name: /^(Connected PDFs|PDF collegati)$/ }).locator("li");
const upload = async (file) => {
  await page.locator('.materials-banner input[type="file"]').setInputFiles(file);
  await until(async () => await page.locator('.materials-banner input[type="file"]').isEnabled(), "PDF checking must finish");
};
const saveScreen = async (name) => {
  await page.screenshot({ path: path.join(evidenceDir, `${name}.png`), fullPage: true }); screenshots.push(`${name}.png`);
};
try {
  await fs.mkdir(evidenceDir, { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true, args: config.allowNoSandbox ? ["--no-sandbox"] : [] });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-GB", reducedMotion: "reduce" });
  await context.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    window.__pdfAudit = { created: [], revoked: [] };
    URL.createObjectURL = (blob) => { const url = create(blob); window.__pdfAudit.created.push(url); return url; };
    URL.revokeObjectURL = (url) => { window.__pdfAudit.revoked.push(url); revoke(url); };
  });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = request.url();
    if ((url.startsWith(base + "/") && request.method() === "GET") || url.startsWith("blob:")) return route.continue();
    forbiddenRequests.push({ method: request.method(), origin: new URL(url).origin });
    return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await go("materials");
  const progress = emptyProgress(); parseProgress(JSON.stringify(progress), curriculum.missions.map((m) => m.id));
  await page.evaluate((value) => localStorage.setItem("parliamo-daily-v1", JSON.stringify(value)), progress);
  await page.reload(); await page.locator(".daily-header").waitFor();
  const before = await page.evaluate(() => localStorage.getItem("parliamo-daily-v1"));
  const renamedBook = path.join(evidenceDir, "my-renamed-italian-books.pdf");
  await fs.rm(renamedBook, { force: true });
  await fs.link("materials/books/exports/combined-student-books.pdf", renamedBook);
  await upload(renamedBook);
  assert.equal(await connections().count(), 2);
  const links = await connections().locator("a").evaluateAll((items) => items.map((a) => ({ title: a.textContent, href: a.href })));
  const first = links.find((l) => l.title === source1.title), second = links.find((l) => l.title === source2.title);
  assert.ok(first.href.endsWith("#page=1")); assert.ok(second.href.endsWith("#page=241"));
  const bundleUrl = second.href.split("#")[0]; assert.equal(first.href.split("#")[0], bundleUrl);
  assert.equal(await page.evaluate(async (url) => { const r = await fetch(url); return r.ok && (await r.blob()).size; }, bundleUrl), (await fs.stat(renamedBook)).size);
  pass("Renamed real 503-page combined PDF connects both books with one live local object URL", { offsets: [0, 240] });
  await saveScreen("en-390-combined-connected");

  await go(`lesson/${mission.id}`);
  await page.locator(".source-note").first().locator("summary").click();
  const missionPage = mission.sources.find((s) => s.id === book2).pages[0];
  assert.ok((await page.locator('.source-note a[href^="blob:"]').first().getAttribute("href")).endsWith(`#page=${240 + missionPage}`));
  pass("Core lesson citations add the Book 2 offset", { sourcePage: missionPage, exportedPage: 240 + missionPage });
  await go(`grammar/${unit.id}`);
  const unitPage = unit.sources.find((s) => s.id === book2).pages[0];
  assert.ok((await page.locator('.academy-source-list a[href^="blob:"]').all()).length > 0);
  assert.ok((await page.locator('.academy-source-list a[href^="blob:"]').first().getAttribute("href")).endsWith(`#page=${240 + unitPage}`));
  pass("Grammar citations add the same offset", { sourcePage: unitPage, exportedPage: 240 + unitPage });
  await go(`companion/${citedPage.id}`);
  assert.equal(await page.locator('a[href^="blob:"]').first().getAttribute("href"), `${bundleUrl}#page=273`);
  pass("Page companion 33 opens physical page 273 in combined books");
  await saveScreen("en-390-offset-companion");

  await go("materials");
  await page.getByRole("button", { name: `Disconnect ${source1.title}`, exact: true }).click();
  assert.equal(await connections().count(), 1);
  assert.equal(await page.evaluate((url) => window.__pdfAudit.revoked.includes(url), bundleUrl), false);
  assert.equal(await page.evaluate(async (url) => (await fetch(url)).ok, bundleUrl), true);
  pass("Disconnecting Book 1 retains Book 2 and its live shared URL");
  await upload("materials/books/exports/nuovo-espresso-plus-2-student-book.pdf");
  assert.equal(await connections().count(), 1);
  const replacement = await connections().locator("a").getAttribute("href");
  assert.ok(replacement.endsWith("#page=1")); assert.notEqual(replacement.split("#")[0], bundleUrl);
  assert.equal(await page.evaluate((url) => window.__pdfAudit.revoked.filter((x) => x === url).length, bundleUrl), 1);
  pass("Individual replacement resets Book 2 to page 1 and releases the unused bundle once");
  await upload({ name: "combined-student-books.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nwrong synthetic file\n%%EOF") });
  assert.equal(await connections().locator("a").getAttribute("href"), replacement);
  assert.match(await page.locator('main').innerText(), /No source match/);
  pass("A same-name incorrect PDF cannot replace a recognized file");
  assert.equal(await page.evaluate(() => localStorage.getItem("parliamo-daily-v1")), before);
  assert.equal(await page.evaluate(() => Object.values(localStorage).some((value) => value.includes("blob:") || value.includes("my-renamed-italian-books"))), false);
  pass("PDF bytes, names, object URLs and connections never enter synthetic progress storage");
  await page.reload(); await page.locator(".daily-header").waitFor();
  assert.equal(await connections().count(), 0);
  pass("Reload releases all PDF connections without changing progress");

  for (const language of ["en", "it"]) for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.getByRole("button", { name: language.toUpperCase(), exact: true }).click();
    for (const route of ["today", "programmes", "grammar", "discover", "progress", "vocabulary/espresso2-u10", "games/espresso2-u10", "materials"]) {
      await go(route);
      const measurement = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, nav: [...document.querySelectorAll('.daily-header nav button')].map((b) => { const r = b.getBoundingClientRect(); return { left: r.left, right: r.right }; }) }));
      assert.ok(measurement.scroll <= measurement.client + 1, `${language}/${width}/${route}: page overflow`);
      assert.ok(measurement.nav.every((r) => r.left >= -1 && r.right <= width + 1), `${language}/${width}: main navigation must fit`);
      layouts.push({ language, width, route, overflow: measurement.scroll - measurement.client });
    }
    await saveScreen(`${language}-${width}-materials`);
  }
  pass("48 EN/IT phone and desktop route layouts fit, with all five main destinations visible");
  assert.deepEqual(forbiddenRequests, []); assert.deepEqual(errors, []);
  pass("No uploads, external requests or browser runtime errors occurred");
} catch (error) { failure = error; console.error(error.stack); if (page) await saveScreen("failure").catch(() => {}); }
finally {
  await context?.close(); await browser?.close();
  await fs.rm(path.join(evidenceDir, "my-renamed-italian-books.pdf"), { force: true });
  const report = { checkedAt: new Date().toISOString(), status: failure ? "failed" : "passed", target: base, isolation: "Owned disposable browser and validated synthetic learner state; no shared browser/profile or real learner records accessed", checks, layouts, errors, forbiddenRequests, screenshots: screenshots.map((file) => path.join(evidenceDir, file)), limitations: ["The ordinary 503-page student bundle and a canonical individual replacement were exercised in the browser; the larger reference/complete aliases are covered by hash/page metadata and store tests.", "PDF citation hrefs, local blob reads and boundary renders verify addressing; browser PDF viewer pagination and third-party PDF viewers are not controlled by this app."], ...(failure ? { failure: failure.message } : {}) };
  await fs.writeFile("docs/pdf-bundle-student-audit.json", JSON.stringify(report, null, 2) + "\n");
}
if (failure) process.exitCode = 1;
