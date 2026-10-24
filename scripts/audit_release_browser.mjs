import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { addDays, dayKey, emptyProgress, parseProgress, STORAGE_KEY } from "../app/learning/engine.ts";
import { emptyAcademy, getGrammarDraft } from "../app/learning/academy-engine.ts";
import { selectReviewQueue } from "../app/learning/review-queue.ts";
import { planningReviewCatalogue } from "../app/learning/planning-data.ts";

// Public release smoke: disposable standalone Chromium, synthetic local storage,
// verified TLS, same-origin GET/HEAD only. No shared profile, CDP or form submission.
process.umask(0o077);
const base = "https://italian.samuelzhang.co.uk";
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserRoot = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(`${browserRoot}/node_modules/playwright-core/index.mjs`).href);
const config = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const evidenceDir = path.resolve(repository, process.env.RELEASE_REPORT_DIR || "work/release-browser");
const relative = path.relative(path.join(repository, "work"), evidenceDir);
assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), "Evidence must remain in ignored work/.");
execFileSync("git", ["check-ignore", "--quiet", "--no-index", path.join(evidenceDir, "browser-report.json")], { cwd: repository });
const read = async (name) => JSON.parse(await fs.readFile(path.join(repository, "app", "learning", `${name}.json`), "utf8"));
const [grammar, curriculum, enrichment, sceneData] = await Promise.all(["grammar", "curriculum", "enrichment", "arcade-scenes"].map(read));
const unit = grammar.units.find((item) => item.id === "a2-imperfetto"), exercise = unit?.exercises[1];
const chapterId = "espresso2-u01", bank = enrichment.banks.find((item) => item.id === chapterId);
const scene = sceneData.scenes.find((item) => item.id === chapterId);
assert.ok(unit && exercise && !exercise.options && bank && scene, "The release fixture requires actual A2 grammar and chapter metadata.");
const today = dayKey(), ids = curriculum.missions.map((item) => item.id);
const checks = [], screenshots = [], pageErrors = [], blockedRequests = [], expectedBlockedAnalytics = [], failedResources = [], scriptResponses = new Set();
let browser, context, page, failure, evidenceReady = false, sample = {};
const pass = (label, details = {}) => { checks.push({ label, ...sample, ...details }); console.log("PASS", label, JSON.stringify({ ...sample, ...details })); };
const until = async (predicate, message) => {
  for (let attempt = 0; attempt < 150; attempt++) { if (await predicate()) return; await page.waitForTimeout(50); }
  assert.fail(message);
};
const raw = () => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
const state = async () => JSON.parse(await raw());
const go = async (route) => {
  await page.goto(`${base}/#${route}`);
  assert.equal(new URL(page.url()).origin, base, "Navigation must stay on the exact public origin.");
  await page.locator(".daily-header").waitFor();
};
const layout = async () => {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.equal(dimensions.document, dimensions.viewport, "The public route must not overflow horizontally.");
  return dimensions;
};
const capture = async (label) => {
  const name = `${sample.language}-${sample.width}-${label}.png`;
  await page.screenshot({ path: path.join(evidenceDir, name), fullPage: false }); screenshots.push(name);
};
const focusedVisible = async (locator) => {
  await locator.waitFor();
  await until(() => locator.evaluate((node) => document.activeElement === node), "The selected task heading must receive focus.");
  const box = await locator.boundingBox();
  assert.ok(box && box.y >= -1 && box.y + box.height <= page.viewportSize().height + 1, `The selected task heading must be visible (${JSON.stringify(box)}).`);
};
const fixture = (language) => {
  const p = emptyProgress(); p.language = language; p.academy = emptyAcademy();
  p.academy.grammar[unit.id] = {
    ...getGrammarDraft(p, unit.id), exerciseIndex: 6,
    output: "Synthetic release-audit production remains saved.", rubric: [0],
    answers: { [exercise.id]: "earlier submitted response" },
    attempts: { [exercise.id]: [{ date: addDays(today, -3), answer: "earlier submitted response", correct: false, assisted: false }] },
  };
  return parseProgress(JSON.stringify(p), ids);
};
const seed = async (p, route) => {
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: JSON.stringify(p) });
  await go(route); await page.reload(); await page.locator(".daily-header").waitFor();
  await until(async () => await page.locator("html").getAttribute("lang") === p.language, "Synthetic language must hydrate.");
};
const openContext = async (language, width, height) => {
  sample = { language, width, height };
  context = await browser.newContext({ viewport: { width, height }, locale: "en-GB", reducedMotion: "reduce", ignoreHTTPSErrors: false, serviceWorkers: "block" });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (["GET", "HEAD"].includes(request.method()) && url.origin === base) return route.continue();
    const evidence = { ...sample, method: request.method(), origin: url.origin, path: url.pathname };
    if (request.method() === "POST" && url.pathname === "/cdn-cgi/rum" && [base, "https://cloudflareinsights.com"].includes(url.origin)) expectedBlockedAnalytics.push(evidence);
    else blockedRequests.push(evidence);
    await route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(30000);
  page.on("pageerror", (error) => pageErrors.push({ ...sample, message: error.message }));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (response.status() >= 400) failedResources.push({ ...sample, path: url.pathname, status: response.status() });
    if (response.request().resourceType() === "script" && url.origin === base && response.status() < 400) scriptResponses.add(url.pathname);
  });
  const response = await page.goto(`${base}/#today`);
  assert.ok(response?.ok(), "Cold Today must return a successful HTTPS document.");
  assert.equal(new URL(page.url()).origin, base);
  const security = await response.securityDetails();
  // Chromium reports HTTP/3's verified encrypted transport as QUIC. Certificate
  // checks remain enabled for both HTTP/2 TLS and HTTP/3; never ignore errors.
  assert.ok(security?.protocol?.startsWith("TLS") || security?.protocol === "QUIC", `The public document must use verified HTTPS (reported protocol: ${security?.protocol ?? "unavailable"}).`);
  await page.locator(".today-workspace h1").waitFor();
  assert.equal(await raw(), null, "Cold entry must start with empty synthetic storage.");
  if (language === "it") await page.getByRole("button", { name: "IT", exact: true }).click();
  await until(async () => await page.locator("html").getAttribute("lang") === language, "Cold Today language switch must work.");
  assert.equal(await page.locator(".today-workspace h1").innerText(), language === "en" ? "A little Italian, today." : "Un po’ d’italiano, oggi.");
  await page.waitForLoadState("networkidle"); await layout(); await capture("cold-today");
  pass("Cold Today renders in a fresh verified-TLS context", { tlsProtocol: security.protocol });
};
const chapterChecks = async () => {
  await go("chapters"); await page.locator(".chapter-card").first().waitFor();
  assert.equal(await page.locator(".chapter-card").count(), 20);
  await page.getByRole("button", { name: "Plus 2 · A2", exact: true }).click();
  await until(async () => await page.locator(".chapter-card").count() === 10, "A2 filter must show ten chapters.");
  assert.equal(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("book"), "2");
  await page.reload(); await page.locator(".chapter-card").first().waitFor(); assert.equal(await page.locator(".chapter-card").count(), 10);
  await page.locator(".chapter-card").first().getByRole("button").click();
  await page.locator(`.chapter-dashboard[data-chapter-id="${chapterId}"]`).waitFor();
  assert.equal(await page.locator(".chapter-checkpoints li").count(), 4);
  await focusedVisible(page.locator(".chapter-dashboard h1")); await layout(); await capture("a2-chapter");
  pass("Twenty chapters, persistent A2 filter and focused chapter detail load");
};
const bankAndGameChecks = async () => {
  const before = await raw();
  await page.getByRole("button", { name: sample.language === "en" ? "Open chapter cards →" : "Apri le carte del capitolo →", exact: true }).click();
  const heading = page.locator(".vocabulary-topic-heading"); await focusedVisible(heading);
  assert.equal(await heading.innerText(), bank.title[sample.language]); assert.equal(new URL(page.url()).hash, `#vocabulary/${bank.id}`);
  assert.equal(await raw(), before, "Opening chapter vocabulary must not mutate progress."); await layout(); await capture("chapter-bank");
  await page.reload(); await focusedVisible(heading); assert.equal(await heading.innerText(), bank.title[sample.language]);
  pass("Chapter vocabulary deep route loads and survives reload");
  await go(`games/${scene.id}`); await page.locator(".arcade-setup").waitFor();
  assert.equal(await page.locator(".arcade-fields select").inputValue(), scene.id);
  assert.equal(await page.locator(".arcade-start p").innerText(), scene.title[sample.language]);
  assert.match(await page.locator(".arcade-start strong").innerText(), /^3 /);
  assert.equal(await raw(), before, "Opening the conversation intent must not start a round or mutate progress.");
  await layout(); await capture("chapter-game");
  pass("A2 game deep route loads the exact three-turn scene without starting it");
};
const discoveryChecks = async () => {
  await go("discover"); const query = page.locator(".discovery-query input"); await query.waitFor();
  await focusedVisible(page.locator(".discovery-intro h1")); await query.fill(sample.language === "en" ? "imperfect" : "imperfetto");
  await page.locator(".discovery-controls select").nth(0).selectOption("grammar");
  await page.locator(".discovery-controls select").nth(1).selectOption("A2");
  const result = page.locator(".discovery-card h2 button").filter({ hasText: unit.title[sample.language] });
  await result.waitFor(); await page.reload(); await query.waitFor();
  assert.equal(await query.inputValue(), sample.language === "en" ? "imperfect" : "imperfetto");
  await result.click(); await page.locator(".academy-steps").waitFor();
  assert.ok(new URL(page.url()).hash.startsWith(`#grammar/${unit.id}`)); await layout();
  pass("Bilingual discovery filters survive reload and load the exact lazy grammar route");
};
const reviewChecks = async () => {
  const p = fixture(sample.language); await seed(p, "reviews?minutes=5"); await page.locator(".review-hub").waitFor();
  const before = await raw(); assert.deepEqual(await state(), p);
  for (const minutes of [2, 5, 10]) {
    await page.getByRole("button", { name: `${minutes} min`, exact: true }).click();
    assert.equal(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("minutes"), String(minutes));
    assert.equal(await page.locator(".review-item").count(), selectReviewQueue(p, planningReviewCatalogue, today, minutes).items.length);
    assert.equal(await raw(), before, "Budget choices must not mutate progress.");
  }
  await page.reload(); await page.locator(".review-hub").waitFor();
  assert.equal(await page.getByRole("button", { name: "10 min", exact: true }).getAttribute("aria-pressed"), "true");
  await layout(); await capture("review-queue");
  pass("Unified 2/5/10-minute review choices are URL-backed and nonmutating");
  await page.locator(".review-next .button").click();
  const form = page.locator(".academy-exercise-card"), answer = form.locator("input:not([type=radio])"); await answer.waitFor();
  assert.equal(new URL(page.url()).hash, `#grammar/${unit.id}?exercise=${exercise.id}&review=1`);
  assert.equal(await form.locator("h3").innerText(), exercise.prompt[sample.language]); assert.equal(await answer.inputValue(), "");
  assert.equal(await raw(), before, "Exact review entry must not record an attempt.");
  await answer.fill("Synthetic unsubmitted release smoke response"); await page.reload(); await answer.waitFor();
  assert.equal(await answer.inputValue(), "Synthetic unsubmitted release smoke response");
  const pending = (await state()).academy.grammar[unit.id], original = p.academy.grammar[unit.id];
  assert.deepEqual(pending.attempts, original.attempts); assert.deepEqual(pending.answers, original.answers);
  assert.equal(pending.exerciseIndex, original.exerciseIndex); assert.equal(pending.output, original.output);
  assert.equal(pending.recallDrafts[exercise.id].answer, "Synthetic unsubmitted release smoke response");
  await layout(); await capture("grammar-pending-recall");
  pass("Known due grammar target opens exactly; unsubmitted draft survives reload separately from original evidence");
};

try {
  await fs.mkdir(evidenceDir, { recursive: true });
  const realWork = await fs.realpath(path.join(repository, "work")), realEvidence = await fs.realpath(evidenceDir);
  assert.ok(!path.relative(realWork, realEvidence).startsWith(".."), "Evidence symlinks must not escape work/."); evidenceReady = true;
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true, args: config.allowNoSandbox ? ["--no-sandbox"] : [] });
  for (const language of ["en", "it"]) for (const width of [language === "en" ? 390 : 320, 1440]) {
    await openContext(language, width, width === 1440 ? 1000 : 844);
    const coldScriptCount = scriptResponses.size;
    await chapterChecks(); await bankAndGameChecks(); await discoveryChecks(); await reviewChecks();
    if (checks.length === 7) assert.ok(scriptResponses.size > coldScriptCount, "Lazy routes must fetch additional JavaScript chunks after cold Today.");
    await context.close(); context = undefined;
  }
  assert.deepEqual(pageErrors, [], "No uncaught runtime errors.");
  assert.deepEqual(blockedRequests, [], "No network writes or off-origin requests attempted.");
  assert.deepEqual(failedResources, [], "No failing public resource responses.");
} catch (error) {
  failure = error; console.error(error.stack || error);
  if (page && evidenceReady && !page.isClosed()) await capture("failure").catch(() => {});
} finally {
  if (context) await context.close().catch(() => {}); if (browser) await browser.close().catch(() => {});
  if (evidenceReady) await fs.writeFile(path.join(evidenceDir, "browser-report.json"), `${JSON.stringify({ date: new Date().toISOString(), target: base, isolation: "Standalone owned Chromium, disposable synthetic contexts, strict TLS and same-origin GET/HEAD only", noFormsSubmitted: true, checks, screenshots, pageErrors, blockedRequests, expectedBlockedAnalytics, failedResources, successfulScriptPaths: [...scriptResponses].sort(), passed: !failure, failure: failure?.message || null, limitations: ["Synthetic public release smoke only; no real profile, PDF connection, submitted practice, remote write or proficiency assessment.", "Any Cloudflare analytics POST to the exact /cdn-cgi/rum path is blocked and reported separately; it is never allowed."] }, null, 2)}\n`);
}
if (failure) process.exitCode = 1;
