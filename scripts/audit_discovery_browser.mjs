import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emptyProgress, dayKey, parseProgress } from "../app/learning/engine.ts";
import { emptyAcademy, getGrammarDraft } from "../app/learning/academy-engine.ts";

// Own disposable Chromium and synthetic storage. Never attach to shared CDP.
process.umask(0o077);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserRoot = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(`${browserRoot}/node_modules/playwright-core/index.mjs`).href);
const config = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const base = (process.env.PARLIAMO_URL || "http://127.0.0.1:5197").replace(/\/+$/, "");
const target = new URL(base);
assert.ok(["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.search && !target.hash, "PARLIAMO_URL must be an HTTP(S) app base without credentials, query or hash.");
const work = path.join(repository, "work");
const evidenceDir = path.resolve(repository, process.env.DISCOVERY_REPORT_DIR || "work/discovery-browser");
const evidenceRelative = path.relative(work, evidenceDir);
assert.ok(evidenceRelative && !evidenceRelative.startsWith(`..${path.sep}`) && evidenceRelative !== ".." && !path.isAbsolute(evidenceRelative), "Discovery evidence must stay inside ignored work/.");
execFileSync("git", ["check-ignore", "--quiet", "--no-index", path.join(evidenceDir, "browser-report.json")], { cwd: repository });
const read = async (name) => JSON.parse(await fs.readFile(path.join(repository, "app", "learning", `${name}.json`), "utf8"));
const [grammar, curriculum, enrichment] = await Promise.all(["grammar", "curriculum", "enrichment"].map(read));
const unit = grammar.units.find((item) => item.id === "a2-imperfetto");
const programme = grammar.programmes.find((item) => item.id === "espresso-plus-a1-a2");
const bank = enrichment.banks.find((item) => item.id === "espresso2-u01");
assert.ok(unit && programme && bank, "The integrated Espresso programme, imperfect unit and chapter vocabulary bank must exist.");
const checks = [], errors = [], screenshots = [], forbiddenRequests = [];
let browser, context, page, failure, evidenceReady = false;
const pass = (label, details = {}) => {
  checks.push({ label, ...details });
  console.log("PASS", label, JSON.stringify(details));
};
const until = async (predicate, message) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return;
    await page.waitForTimeout(50);
  }
  assert.fail(message);
};
const go = async (route) => {
  await page.goto(`${base}/#${route}`);
  await page.locator(".daily-header").waitFor();
};
const headingVisible = async (locator) => {
  await locator.waitFor();
  await until(async () => locator.evaluate((node) => document.activeElement === node), "The opened task heading must receive focus.");
  const box = await locator.boundingBox();
  assert.ok(box && box.y >= 0 && box.y + box.height < page.viewportSize().height, "The focused heading must fit within the viewport.");
  return Math.round(box.y);
};
const noOverflow = async () => {
  const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.equal(size.document, size.viewport, "The route must not overflow horizontally.");
  return size;
};
const screen = async (name) => {
  await page.screenshot({ path: path.join(evidenceDir, name), fullPage: false });
  screenshots.push(name);
};
const startContext = async (language, width, height) => {
  context = await browser.newContext({ viewport: { width, height }, locale: "en-GB", reducedMotion: "reduce" });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = request.url();
    if (["GET", "HEAD"].includes(request.method()) && url.startsWith(`${base}/`)) return route.continue();
    forbiddenRequests.push({ method: request.method(), origin: new URL(url).origin });
    return route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await go("discover");
  await page.locator(".discovery-query input").waitFor();
  // A language button correctly keeps focus when clicked; check entry focus first.
  await headingVisible(page.locator(".discovery-intro h1"));
  if (language === "it") await page.getByRole("button", { name: "IT", exact: true }).click();
};
const chosenBank = async (language, width) => {
  const heading = page.locator(".vocabulary-topic-heading");
  const headingY = await headingVisible(heading);
  assert.equal(await heading.innerText(), bank.title[language]);
  const dimensions = await noOverflow();
  await screen(`${language}-${width}-vocabulary-chapter-focus.png`);
  pass("Chosen chapter bank and recall task are focused and visible", { language, width, headingY, ...dimensions });
};
const programmeFixture = (language) => {
  const progress = emptyProgress();
  progress.language = language;
  progress.academy = emptyAcademy();
  const day = programme.days.findIndex((item) => item.unitIds.includes(unit.id));
  assert.ok(day >= 0);
  progress.academy.programme = { id: programme.id, day, started: dayKey(), completed: {}, practice: {} };
  const complete = (id) => {
    const prerequisite = grammar.units.find((item) => item.id === id);
    assert.ok(prerequisite);
    for (const parent of prerequisite.prerequisites) if (!progress.academy.grammar[parent]?.completed) complete(parent);
    progress.academy.grammar[id] = { ...getGrammarDraft(progress, id), completed: dayKey() };
  };
  for (const id of unit.prerequisites) complete(id);
  for (const id of programme.days[day].unitIds) if (id !== unit.id) complete(id);
  assert.notEqual(grammar.units.find((item) => !progress.academy.grammar[item.id]?.completed)?.id, unit.id, "The fixture must leave an unrelated earlier unit unfinished.");
  parseProgress(JSON.stringify(progress), curriculum.missions.map((mission) => mission.id));
  return progress;
};

try {
  await fs.mkdir(evidenceDir, { recursive: true });
  const realWork = await fs.realpath(work), realEvidence = await fs.realpath(evidenceDir);
  assert.ok(!path.relative(realWork, realEvidence).startsWith(".."), "Evidence directory symlinks must not escape work/.");
  evidenceReady = true;
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
    headless: true,
    args: config.allowNoSandbox ? ["--no-sandbox"] : [],
  });
  for (const language of ["en", "it"]) {
    const width = language === "en" ? 390 : 320;
    await startContext(language, width, 844);
    const query = page.locator(".discovery-query input");
    await query.fill("imper");
    await query.pressSequentially("fetto");
    assert.equal(await query.inputValue(), "imperfetto");
    assert.equal(await query.evaluate((node) => node === document.activeElement), true);
    const imperfect = () => page.locator(".discovery-card h2 button").filter({ hasText: unit.title[language] });
    await imperfect().first().waitFor();
    await page.locator(".discovery-controls select").nth(0).selectOption("grammar");
    await page.locator(".discovery-controls select").nth(1).selectOption("A2");
    await page.reload(); await query.waitFor();
    assert.equal(await query.inputValue(), "imperfetto");
    assert.equal(await page.locator(".discovery-controls select").nth(0).inputValue(), "grammar");
    assert.equal(await page.locator(".discovery-controls select").nth(1).inputValue(), "A2");
    await imperfect().click();
    await until(async () => new URL(page.url()).hash.startsWith(`#grammar/${unit.id}`), "Discovery must open the imperfect unit.");
    await page.goBack(); await query.waitFor();
    assert.equal(await query.inputValue(), "imperfetto");
    pass("Discovery topic, filters, typing focus, reload and Back", { language, width });

    await page.locator(".discovery-controls select").nth(0).selectOption("all");
    await page.locator(".discovery-controls select").nth(1).selectOption("all");
    await query.fill("Plus 1 135");
    await page.locator(".discovery-card h2 button").first().click();
    await until(async () => new URL(page.url()).hash.startsWith("#companion/src-1647be2784c9-p135"), "Page search must open physical Plus1 page135.");
    pass("Physical page discovery opens the focused task", { language, width, page: 135, headingY: await headingVisible(page.locator(".academy-companion-sheet h2")) });

    await go("grammar");
    const grammarQuery = page.locator(".academy-toolbar input[type=search]");
    await grammarQuery.fill("imperfetto");
    await page.locator(".academy-filters button").last().click();
    await page.waitForTimeout(100);
    const count = await page.locator(".academy-unit-card").count();
    assert.ok(count > 0);
    await page.locator(".academy-unit-card h2 button").first().click();
    await page.locator(".academy-back").click(); await grammarQuery.waitFor();
    assert.equal(await grammarQuery.inputValue(), "imperfetto");
    assert.equal(await page.locator(".academy-unit-card").count(), count);
    assert.equal(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("filter"), "tense");
    await page.reload(); await grammarQuery.waitFor();
    assert.equal(await grammarQuery.inputValue(), "imperfetto");
    assert.equal(await page.locator(".academy-unit-card").count(), count);
    pass("Grammar query/filter survive opening, return and reload", { language, width, results: count });

    await go("companion/src-1647be2784c9-p1");
    const sourceQuery = page.locator(".academy-companion-controls input[type=search]");
    await sourceQuery.fill("135"); await page.waitForTimeout(100);
    assert.equal(await page.locator(".academy-page-list button").count(), 1);
    await page.locator(".academy-page-list button").click();
    await until(async () => new URL(page.url()).hash.includes("-p135?q=135"), "Companion selection must retain its search query.");
    assert.equal(await sourceQuery.inputValue(), "135");
    assert.equal(await page.locator(".academy-page-list button").count(), 1);
    await headingVisible(page.locator(".academy-companion-sheet h2"));
    await page.reload(); await sourceQuery.waitFor();
    assert.equal(await sourceQuery.inputValue(), "135");
    assert.equal(await page.locator(".academy-page-list button").count(), 1);
    await headingVisible(page.locator(".academy-companion-sheet h2"));
    await noOverflow(); await screen(`${language}-${width}-companion-focus.png`);
    pass("Companion query and task focus survive selection and reload", { language, width });

    const fixture = programmeFixture(language);
    await page.evaluate((value) => localStorage.setItem("parliamo-daily-v1", JSON.stringify(value)), fixture);
    await go("grammar"); await page.reload();
    await page.getByRole("button", { name: language === "en" ? "Continue my grammar journey →" : "Continua il mio percorso di grammatica →", exact: true }).click();
    await until(async () => new URL(page.url()).hash.startsWith(`#grammar/${unit.id}`), "Continuation must prefer the eligible active-programme unit.");
    pass("Grammar continuation prefers the eligible programme unit", { language, width, unit: unit.id, syntheticPrerequisiteCompletions: Object.keys(fixture.academy.grammar).length });
    await go("discover?q=Plus+1+135"); await page.locator(".discovery-card").first().waitFor();
    await noOverflow(); await screen(`${language}-${width}-discovery-source.png`);
    await go(`vocabulary/${bank.id}`); await chosenBank(language, width);
    await context.close(); context = null;
  }

  await startContext("en", 1440, 1000);
  await go("discover?q=imperfetto&kind=grammar&level=A2");
  await page.locator(".discovery-card").first().waitFor();
  const desktopQuery = page.locator(".discovery-query input");
  assert.equal(await desktopQuery.inputValue(), "imperfetto");
  const columns = await page.locator(".discovery-results").evaluate((node) => getComputedStyle(node).gridTemplateColumns);
  assert.equal(columns.split(" ").length, 2);
  await screen("en-1440-discovery.png");
  pass("Desktop discovery direct-query filters and two-column layout", { language: "en", width: 1440, columns, ...await noOverflow() });
  await desktopQuery.fill("scarf");
  await page.locator(".discovery-controls select").nth(0).selectOption("vocabulary");
  await page.locator(".discovery-controls select").nth(1).selectOption("all");
  await page.locator(".discovery-card h2 button").filter({ hasText: bank.title.en }).click();
  await page.waitForURL((url) => url.hash === `#vocabulary/${bank.id}`);
  pass("English word search opens the matching chapter bank", { query: "scarf", bankId: bank.id });
  await chosenBank("en", 1440);
  await page.goBack(); await desktopQuery.waitFor();
  assert.equal(await desktopQuery.inputValue(), "scarf");
  await page.getByRole("button", { name: "IT", exact: true }).click();
  await desktopQuery.fill("sciarpa");
  await page.locator(".discovery-card h2 button").filter({ hasText: bank.title.it }).click();
  await page.waitForURL((url) => url.hash === `#vocabulary/${bank.id}`);
  assert.equal(await page.locator(".vocabulary-topic-heading").innerText(), bank.title.it);
  pass("Italian word search opens the matching chapter bank", { query: "sciarpa", bankId: bank.id });
  assert.deepEqual(errors, []);
  assert.deepEqual(forbiddenRequests, []);
} catch (error) {
  failure = error;
  console.error(error.stack);
  if (evidenceReady && page && !page.isClosed()) await screen("failure.png").catch(() => {});
} finally {
  await context?.close(); await browser?.close();
  const report = {
    checkedAt: new Date().toISOString(), status: failure ? "failed" : "passed", target: base,
    isolation: "Owned disposable Chromium and validated synthetic progress; no shared CDP, existing profile, private PDFs or learner records accessed.",
    checks, errors, forbiddenRequests, screenshots: screenshots.map((file) => path.relative(repository, path.join(evidenceDir, file))),
    limitations: [
      "Targeted Chromium workflows, not a full-site audit, physical-device or screen-reader certification.",
      "Programme prerequisites are explicitly synthetic fixtures to isolate continuation; no real course completion is claimed.",
      "Screenshots are viewport-height evidence; visual inspection must be recorded separately after viewing them.",
      "This reusable runner consolidates the previously verified flows and does not automatically overwrite their manual review record."
    ],
    ...(failure ? { failure: failure.message } : {}),
  };
  if (evidenceReady) {
    const reportFile = path.join(evidenceDir, "browser-report.json");
    await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Discovery audit ${report.status}: ${path.relative(repository, reportFile)}`);
  }
}
if (failure) process.exitCode = 1;
