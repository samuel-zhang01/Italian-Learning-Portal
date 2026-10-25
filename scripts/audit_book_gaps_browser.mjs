import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { addDays, dayKey, emptyDraft, emptyProgress, parseProgress, STORAGE_KEY } from "../app/learning/engine.ts";
import { selectProgramme } from "../app/learning/academy-engine.ts";
import { emptySession } from "../app/learning/study.ts";

// Synthetic progress and an owned browser; never connect to shared CDP/profile.
process.umask(0o077);
const root = process.cwd();
const browserRoot = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(`${browserRoot}/node_modules/playwright-core/index.mjs`).href);
const config = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const base = (process.env.PARLIAMO_URL || "http://127.0.0.1:5200").replace(/\/+$/, "");
const origin = new URL(base);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) && !origin.username && !origin.password);
const evidenceDir = path.resolve(process.env.BOOK_GAP_AUDIT_DIR || "work/book-gap-browser");
assert.ok(evidenceDir.startsWith(`${path.join(root, "work")}${path.sep}`));
execFileSync("git", ["check-ignore", "--quiet", "--no-index", path.join(evidenceDir, "browser-report.json")]);
const read = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const [curriculum, grammar, review] = await Promise.all([
  read("app/learning/curriculum.json"), read("app/learning/grammar.json"), read("docs/book-gap-content-review.json"),
]);
const units = review.unitSourceMap.map(({ unitId }) => grammar.units.find((unit) => unit.id === unitId));
const mission = curriculum.missions.find((item) => item.id === "book2-quick-help");
const formal = curriculum.missions.find((item) => item.id === "book2-formal-enquiry");
const oldMission = curriculum.missions[0], oldDraftMission = curriculum.missions[1];
assert.ok(units.length === 10 && units.every(Boolean) && mission && formal);
const ids = curriculum.missions.map((item) => item.id), today = dayKey(), tomorrow = addDays(today, 1), prior = addDays(today, -4);
const checks = [], layouts = [], screenshots = [], errors = [], forbiddenRequests = [];
let browser, context, page, failure;
const pass = (label, details = {}) => { checks.push({ label, ...details }); console.log("PASS", label); };
const until = async (predicate, label) => {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await page.waitForTimeout(50); }
  assert.fail(label);
};
const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
const go = async (route) => { await page.goto(`${base}/#${route}`); await page.locator(".daily-header").waitFor(); };
const button = (name) => page.getByRole("button", { name: new RegExp(`^(?:←\\s*)?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s*→)?$`), exact: true });
const fixture = (language = "en") => {
  const p = selectProgramme(emptyProgress(), "supported-a1", prior);
  p.language = language; p.academy.programme.day = 4; p.academy.programme.completed = { "0": prior };
  p.completed[oldMission.id] = { date: prior, firstCorrect: 1, total: oldMission.checks.length, output: "Mi chiamo Rina e studio italiano.", supported: true, confidence: 2 };
  p.reviews[oldMission.id] = { due: addDays(today, 7), interval: 7, attempts: 1, correct: 1, lastDate: prior };
  p.drafts[oldDraftMission.id] = { ...emptyDraft(), step: 1, answers: ["vecchia bozza", ""], output: "Un appunto già salvato." };
  p.notes = "Synthetic legacy note for the supplementary-content audit.";
  return p;
};
const seed = async (p, route) => {
  parseProgress(JSON.stringify(p), ids);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: JSON.stringify(p) });
  await go(route); await page.reload(); await page.locator(".daily-header").waitFor();
  await until(async () => await page.locator("html").getAttribute("lang") === p.language, "Fixture language hydrates");
};
const preserved = (actual, original) => {
  assert.deepEqual(actual.academy.programme, original.academy.programme);
  assert.deepEqual(actual.completed[oldMission.id], original.completed[oldMission.id]);
  assert.deepEqual(actual.reviews[oldMission.id], original.reviews[oldMission.id]);
  assert.deepEqual(actual.drafts[oldDraftMission.id], original.drafts[oldDraftMission.id]);
  assert.equal(actual.notes, original.notes);
};
const capture = async (name) => {
  const file = path.join(evidenceDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false }); screenshots.push(path.relative(root, file));
};
const layout = async (label, extra = {}) => {
  const result = await page.evaluate(() => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth,
    overflowingControls: [...document.querySelectorAll("main button,main a,main input,main textarea,main select")]
      .filter((node) => node.getClientRects().length && (() => { const box = node.getBoundingClientRect(); return box.left < -2 || box.right > innerWidth + 2; })())
      .map((node) => node.tagName),
  }));
  layouts.push({ label, ...extra, ...result });
  assert.ok(result.document <= result.viewport + 1, `${label}: document overflow`);
  assert.deepEqual(result.overflowingControls, [], `${label}: overflowing control`);
};

try {
  await fs.mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true, args: config.allowNoSandbox ? ["--no-sandbox"] : [] });
  context = await browser.newContext({ viewport: { width: 320, height: 900 }, locale: "en-GB", timezoneId: "UTC", reducedMotion: "reduce", acceptDownloads: true });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (["GET", "HEAD"].includes(request.method()) && (url.origin === origin.origin || url.protocol === "blob:")) return route.continue();
    forbiddenRequests.push({ method: request.method(), origin: url.origin }); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await go("today");

  for (const language of ["en", "it"]) {
    const original = fixture(language);
    await seed(original, `grammar/${units[0].id}`);
    for (const unit of units) {
      await go(`grammar/${unit.id}`);
      await page.locator(".academy-unit-heading h1").waitFor();
      await until(async () => await page.locator(".academy-unit-heading h1").innerText() === unit.title[language], "The exact grammar route finishes rendering");
      assert.equal(await page.locator(".academy-unit-heading h1").innerText(), unit.title[language]);
      assert.ok((await page.locator(".academy-teaching").innerText()).includes(unit.teaching[0][language]));
      const sourceText = await page.locator(".academy-source-list").innerText();
      for (const source of unit.sources) assert.ok(sourceText.includes(source.pages.join(", ")));
      await layout(`${language}/${unit.id}/learn`, { language, unitId: unit.id, stage: "learn" });
      await capture(`${language}-320-${unit.id}`);
      await page.locator(".academy-steps button").filter({ hasText: language === "en" ? "Practise" : "Esercitati" }).click();
      await page.locator(".academy-exercise-card").waitFor();
      assert.ok((await page.locator(".academy-exercise-card h3").innerText()).includes(unit.exercises[0].prompt[language]));
      await layout(`${language}/${unit.id}/practise`, { language, unitId: unit.id, stage: "practise" });
      preserved(await stored(), original);
    }
    pass(`All ten new workshops open teaching, exact source pages and first practice in ${language.toUpperCase()} at320px`, { routes: 10, layoutChecks: 20 });
  }

  const original = fixture();
  await seed(original, `lesson/${mission.id}`);
  await page.locator(".study-paper h1").waitFor();
  await button("Try it from memory").click();
  await page.getByLabel("Your answer in Italian", { exact: true }).fill("diggli");
  await button("Check my answer").click();
  await page.locator(".feedback.retry").waitFor();
  assert.equal((await stored()).drafts[mission.id].first[0], false);
  await page.getByLabel("Your answer in Italian", { exact: true }).fill(mission.checks[0].answers[0]);
  await button("Check my answer").click(); await page.locator(".feedback.correct").waitFor();
  await button("Continue").click();
  await page.getByLabel("Your answer in Italian", { exact: true }).fill(mission.checks[1].answers[0]);
  await page.reload(); await page.getByLabel("Your answer in Italian", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Your answer in Italian", { exact: true }).inputValue(), mission.checks[1].answers[0]);
  assert.equal((await stored()).drafts[mission.id].first[0], false);
  await button("IT").click();
  await button("Controlla la risposta").click(); await page.locator(".feedback.correct").waitFor();
  await button("Continua").click();
  await page.getByRole("textbox", { name: "Il mio italiano", exact: true }).fill(mission.model.it);
  await page.locator(".self-check input").first().check();
  await page.reload(); await page.getByRole("textbox", { name: "Il mio italiano", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Il mio italiano", exact: true }).inputValue(), mission.model.it);
  assert.equal(await page.locator(".self-check input:checked").count(), 1);
  assert.equal(await button("Salva la mia pratica").isDisabled(), true);
  await page.locator(".self-check input").nth(1).check();
  await button("Salva la mia pratica").click(); await page.locator(".finish-panel").waitFor();
  let p = await stored(); preserved(p, original);
  assert.equal(p.completed[mission.id].firstCorrect, 1);
  assert.equal(p.completed[mission.id].output, mission.model.it);
  assert.equal(p.reviews[mission.id].due, tomorrow);
  await layout("new-lesson-completed-it"); await capture("it-320-new-lesson-completed");
  pass("A new lesson retains wrong-first evidence, corrected recall, unsubmitted answer and production drafts over reload, then schedules tomorrow’s review");

  await page.clock.setFixedTime(new Date(`${tomorrow}T12:00:00Z`));
  await go(`review/${mission.id}`); await page.reload();
  await page.getByLabel("La tua risposta in italiano", { exact: true }).waitFor();
  assert.ok(!(await page.locator(".study-paper").innerText()).includes("Pratica extra"));
  await page.getByLabel("La tua risposta in italiano", { exact: true }).fill(mission.review.answers[0]);
  await button("Controlla il ricordo").click(); await page.locator(".feedback.correct").waitFor();
  p = await stored(); preserved(p, original);
  assert.equal(p.reviews[mission.id].lastDate, tomorrow);
  assert.equal(p.reviews[mission.id].due, addDays(tomorrow, 3));
  assert.equal(p.reviewLog.filter((entry) => entry.id === mission.id).length, 1);
  assert.equal(p.completed[mission.id].firstCorrect, 1);
  await capture("it-320-new-lesson-scheduled-recall");
  await go("progress"); await page.getByRole("button", { name: "Esporta progressi", exact: true }).waitFor();
  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta progressi", exact: true }).click();
  const download = await downloadReady;
  const exported = parseProgress(await fs.readFile(await download.path(), "utf8"), ids);
  preserved(exported, original);
  assert.equal(exported.completed[mission.id].firstCorrect, 1);
  assert.equal(exported.reviews[mission.id].lastDate, tomorrow);
  assert.equal(exported.drafts[mission.id].output, mission.model.it);
  pass("A browser-only next-day clock exercises scheduled recall and an actual exported backup preserves new and legacy evidence", { clock: "Owned page Date fixed to the following day; no real waiting or system clock changes" });

  await page.clock.setFixedTime(new Date(`${today}T12:00:00Z`));
  for (const language of ["en", "it"]) {
    const formalFixture = fixture(language);
    formalFixture.plan.course = 3; formalFixture.plan.minutes = 30;
    formalFixture.sessions = { [today]: emptySession(formal.id, 30, "espresso2-u08") };
    await seed(formalFixture, "session"); await page.locator(".session-page h1").waitFor();
    assert.equal(await page.locator(".session-page h1").innerText(), formal.title[language]);
    assert.match(await page.locator(".session-page > .eyebrow").innerText(), /^A2/);
    await layout(`formal-guided-session-${language}`);
    await capture(`${language}-320-formal-enquiry-a2-session`);
    preserved(await stored(), formalFixture);
  }
  pass("Pinned formal-enquiry guided sessions display A2 in EN and IT without changing the saved programme/day");
  assert.deepEqual(errors, []); assert.deepEqual(forbiddenRequests, []);
  pass("Owned contexts produced no runtime errors, external requests or network mutations");
} catch (error) {
  failure = { name: error.name, message: error.message, location: error.stack?.split("\n").find((line) => line.includes("audit_book_gaps_browser"))?.trim() };
  if (page) await capture("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {}); await browser?.close().catch(() => {});
  const report = {
    generator: "scripts/audit_book_gaps_browser.mjs", reviewedOn: today, status: failure ? "failed" : "passed", preview: base,
    method: "Owned disposable Chromium, local preview, validated synthetic progress; no shared CDP, private profile or real learner data.",
    sandboxException: "Existing explicit browser-view allowNoSandbox configuration honoured on this host.",
    workflowGroupsPassed: checks.length, checks, layouts, screenshots, runtimeErrors: errors, forbiddenRequests,
    ...(failure ? { failure } : {}),
    limits: ["All ten new grammar teaching routes and first exercises were opened in EN/IT at320px; the browser did not answer all80 new controlled items.", "One new lesson was completed end to end; the remaining new lessons have authored-content/answer-contract tests rather than separate full browser completions.", "Next-day scheduled recall uses the owned page’s simulated Date; no system clock or real learner schedule was changed.", "Viewport emulation, not a physical phone. Device speech and publisher media were not exercised.", "No production site, shared reader, private book files, local learner database or backups were accessed."],
  };
  await fs.writeFile(path.join(evidenceDir, "browser-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const currentReview = await read("docs/book-gap-content-review.json");
  currentReview.validation.browser = report;
  await fs.writeFile("docs/book-gap-content-review.json", `${JSON.stringify(currentReview, null, 2)}\n`);
  if (failure) console.error(failure.name, failure.message);
}
