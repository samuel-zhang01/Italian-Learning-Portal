import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { addDays, dayKey, emptyProgress, parseProgress, STORAGE_KEY } from "../app/learning/engine.ts";
import { emptyAcademy, getGrammarDraft } from "../app/learning/academy-engine.ts";
import { a2DiagnosticChapters } from "../app/learning/a2-diagnostic-data.ts";
import { answerA2Diagnostic, continueA2Diagnostic, diagnosticCatchUp, diagnosticRunKey, emptyA2Diagnostics, hintA2Diagnostic, saveA2DiagnosticDraft, startA2Diagnostic } from "../app/learning/a2-diagnostic-model.ts";
import { planningUnits } from "../app/learning/planning-data.ts";

process.umask(0o077);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(`${extension}/node_modules/playwright-core/index.mjs`).href);
const config = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const base = (process.env.PARLIAMO_URL || "http://127.0.0.1:5200").replace(/\/+$/, "");
const origin = new URL(base); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname), "This synthetic audit targets a local preview only.");
const evidenceDir = path.resolve(repository, process.env.INSIGHTS_REPORT_DIR || "work/learning-insights-audit");
const relative = path.relative(path.join(repository, "work"), evidenceDir);
const phase = process.env.INSIGHTS_QA_PHASE || "all"; assert.ok(["all", "copy"].includes(phase));
assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
execFileSync("git", ["check-ignore", "--quiet", "--no-index", path.join(evidenceDir, "browser-report.json")], { cwd: repository });
const curriculum = JSON.parse(await fs.readFile(path.join(repository, "app/learning/curriculum.json"), "utf8"));
const ids = curriculum.missions.map((mission) => mission.id), chapter = a2DiagnosticChapters[2], today = dayKey(), oldDate = addDays(today, -2), key = diagnosticRunKey(oldDate, chapter.id);
const checks = [], screenshots = [], errors = [], blockedRequests = [];
let browser, context, page, failure, evidenceReady = false, sample;
const pass = (label, details = {}) => { checks.push({ label, ...sample, ...details }); console.log("PASS", label, JSON.stringify({ ...sample, ...details })); };
const until = async (predicate, label) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await page.waitForTimeout(50); } assert.fail(label); };
const go = async (route) => { await page.goto(`${base}/#${route}`); await page.locator(".daily-header").waitFor(); };
const raw = () => page.evaluate((storageKey) => localStorage.getItem(storageKey), STORAGE_KEY);
const stored = async () => JSON.parse(await raw());
const ordinary = (p) => { const rest = { ...p }; delete rest.diagnostics; delete rest.updatedAt; return rest; };
const fixture = (language) => {
  const p = emptyProgress(); p.language = language; p.academy = emptyAcademy(); p.plan.start = addDays(today, -20);
  const unit = planningUnits.find((item) => item.id === "a2-conditional");
  p.academy.grammar[unit.id] = { ...getGrammarDraft(p, unit.id), exerciseIndex: 4, output: "An unrelated saved production remains here.", rubric: [0] };
  let diagnostics = startA2Diagnostic(emptyA2Diagnostics(), chapter.id, oldDate);
  diagnostics = saveA2DiagnosticDraft(diagnostics, key, chapter.items[0].id, "An unfinished earlier draft");
  p.diagnostics = diagnostics; return parseProgress(JSON.stringify(p), ids);
};
const seed = async (p, route) => {
  await go("today"); await page.evaluate(({ storageKey, value }) => localStorage.setItem(storageKey, value), { storageKey: STORAGE_KEY, value: JSON.stringify(p) });
  await go(route); await page.reload(); await page.locator(".daily-header").waitFor();
  await until(async () => await page.locator("html").getAttribute("lang") === p.language, "Synthetic language hydrates.");
};
const layout = async (name) => {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.equal(dimensions.document, dimensions.viewport, "No horizontal overflow.");
  const file = `${sample.language}-${sample.width}-${name}.png`; await page.screenshot({ path: path.join(evidenceDir, file), fullPage: false }); screenshots.push(file);
};
const openContext = async (language, width) => {
  sample = { language, width, height: width === 1440 ? 1000 : 844 };
  context = await browser.newContext({ viewport: { width, height: sample.height }, locale: "en-GB", reducedMotion: "reduce" });
  await context.route("**/*", async (route) => { const request = route.request(), url = new URL(request.url()); if (url.origin === origin.origin && ["GET", "HEAD"].includes(request.method())) return route.continue(); blockedRequests.push({ method: request.method(), origin: url.origin }); return route.abort(); });
  page = await context.newPage(); page.setDefaultTimeout(12000); page.on("pageerror", (error) => errors.push(error.message));
  const p = emptyProgress(); p.language = language; await seed(p, "diagnostics");
};
const diagnosticFlow = async () => {
  const language = sample.language;
  await page.locator(".insights-topic-grid").waitFor(); assert.equal(await page.locator(".insights-topic-grid article").count(), 10); await layout("topic-catalogue");
  const initial = fixture(language); await seed(initial, `diagnostics?chapter=${chapter.id}`);
  const form = page.locator(".insights-diagnostic-question"), input = form.locator("input"); await input.waitFor();
  assert.match(await page.locator(".insights-run-date").innerText(), new RegExp(oldDate));
  assert.equal(await input.inputValue(), "An unfinished earlier draft"); assert.deepEqual(await stored(), initial);
  await input.fill("A pending answer before reload"); await page.reload(); await input.waitFor(); assert.equal(await input.inputValue(), "A pending answer before reload");
  pass("Ten chapter samples and an earlier unfinished check resume with the unsubmitted draft", { oldDate });
  await input.fill("synthetic wrong answer"); await form.locator("button[type=submit]").click(); await page.locator(".insights-diagnostic-feedback").waitFor();
  await page.reload(); await page.locator(".insights-diagnostic-feedback").waitFor();
  let p = await stored(); assert.equal(p.diagnostics.runs[key].answers[chapter.items[0].id].correct, false); assert.equal(p.diagnostics.runs[key].answers[chapter.items[0].id].answer, "synthetic wrong answer");
  await page.locator(".insights-diagnostic-feedback .button.primary").click(); await input.waitFor();
  await form.getByRole("button", { name: language === "en" ? "Use a hint · mark this answer as supported" : "Usa un indizio · segna questa risposta come aiutata", exact: true }).click();
  await input.fill(chapter.items[1].answers[0]); await form.locator("button[type=submit]").click(); await page.locator(".insights-diagnostic-feedback").waitFor();
  assert.equal((await stored()).diagnostics.runs[key].answers[chapter.items[1].id].assisted, true);
  await page.locator(".insights-diagnostic-feedback .button.primary").click(); await input.waitFor();
  await form.getByRole("button", { name: "è", exact: true }).click(); assert.equal(await input.inputValue(), "è");
  await page.reload(); await input.waitFor(); assert.equal(await input.inputValue(), "è");
  await form.locator("button[type=submit]").click(); await page.locator(".insights-diagnostic-feedback").waitFor();
  await page.locator(".insights-diagnostic-feedback .button.primary").click(); await page.locator(".insights-diagnostic-summary").waitFor();
  p = await stored(); assert.equal(Object.keys(p.diagnostics.runs[key].answers).length, 3); assert.equal(p.diagnostics.runs[key].answers[chapter.items[2].id].correct, true);
  assert.deepEqual(ordinary(p), ordinary(initial), "Diagnostics cannot change ordinary answers, credit, schedules or production.");
  assert.match(await page.locator(".insights-diagnostic-summary").innerText(), /1\/3/); await layout("completed-check");
  pass("Wrong first answer, recorded hint, accent entry, feedback reload and completion preserve ordinary progress");
  const firstStep = diagnosticCatchUp(p, chapter.items[0], planningUnits, chapter)[0];
  await page.locator(".insights-catch-up article li button").first().click();
  await until(async () => new URL(page.url()).hash === `#${firstStep.route}`, "Catch-up opens the actual first missing prerequisite or topic.");
  await page.locator(".academy-steps").waitFor(); await page.goBack(); await page.locator(".insights-diagnostic-summary").waitFor();
  assert.equal((await stored()).diagnostics.runs[key].answers[chapter.items[0].id].correct, false);
  pass("Targeted catch-up opens the specific known preparation; Back retains immutable first results", { route: firstStep.route });
  return await stored();
};
const weeklyFlow = async (p) => {
  const language = sample.language, mission = curriculum.missions[0], unit = planningUnits.find((item) => item.id === "a2-imperfetto"), exercise = unit.exercises[0];
  p.completed[mission.id] = { date: addDays(today, -3), firstCorrect: 0, total: 2, supported: true, output: "Synthetic original output.", confidence: 2 };
  p.reviewLog = [{ id: mission.id, date: today, correct: true }];
  p.academy.grammar[unit.id] = { ...getGrammarDraft(p, unit.id), attempts: { [exercise.id]: [{ date: addDays(today, -1), answer: "wrong", correct: false, assisted: false }, { date: addDays(today, -1), answer: "repair", correct: true, assisted: false }, { date: today, answer: "later recall", correct: true, assisted: false }] } };
  p = parseProgress(JSON.stringify(p), ids); await seed(p, "weekly"); await page.locator(".weekly-learning-report").waitFor(); const before = await raw();
  const grammarCard = page.locator(".insights-report-grid section").filter({ has: page.getByRole("heading", { name: language === "en" ? "Grammar first answers" : "Prime risposte di grammatica", exact: true }) });
  assert.deepEqual(await grammarCard.locator("dd").allTextContents(), ["1/2", "0", "1"]);
  const diagnosticCard = page.locator(".insights-report-grid section").filter({ has: page.getByRole("heading", { name: language === "en" ? "A2 topic samples" : "Campioni sui temi A2", exact: true }) });
  assert.deepEqual(await diagnosticCard.locator("dd").allTextContents(), ["3", "1", "1"]);
  assert.match(await page.locator(".insights-delayed-evidence").innerText(), /:\s*1\./);
  assert.ok(await page.locator(".insights-next-week li").count() >= 1); assert.ok(await page.locator(".insights-next-week li").count() <= 3);
  await page.reload(); await page.locator(".weekly-learning-report").waitFor(); assert.equal(await raw(), before); await layout("weekly-evidence");
  pass("Weekly mixed evidence keeps same-day repair separate, shows matched later-day recall and optional planned-day next steps without mutation");
  const empty = emptyProgress(); empty.language = language; await seed(empty, "weekly"); await page.locator(".insights-empty").waitFor();
  assert.match(await page.locator(".insights-delayed-evidence").innerText(), language === "en" ? /no matching later-day success/ : /Non c’è un successo/);
  pass("An empty week reports absent dated evidence without inventing weakness or delayed improvement");
};
const limitFlow = async () => {
  const p = fixture(sample.language); p.diagnostics = emptyA2Diagnostics();
  for (let day = 1; day <= 40; day++) for (const topic of a2DiagnosticChapters) p.diagnostics = startA2Diagnostic(p.diagnostics, topic.id, addDays(today, -day));
  await seed(p, `diagnostics?chapter=${chapter.id}`); await page.locator(".insights-limit").waitFor();
  assert.equal(await page.locator(".a2-diagnostic-start").count(), 0); assert.equal(Object.keys((await stored()).diagnostics.runs).length, 400);
  await layout("retention-limit");
  await page.locator(".insights-limit .button").click(); await until(async () => new URL(page.url()).hash === "#progress", "Limit guidance opens normal backup tools.");
  assert.equal(Object.keys((await stored()).diagnostics.runs).length, 400);
  pass("400-run limit explains preserved evidence and links backup tools instead of silently failing");
};
const copyFlow = async () => {
  const p = fixture(sample.language); let diagnostics = p.diagnostics;
  for (const [index, question] of chapter.items.entries()) {
    if (index === 1) diagnostics = hintA2Diagnostic(diagnostics, key, question.id);
    diagnostics = answerA2Diagnostic(diagnostics, key, question, index === 0 ? "wrong" : question.answers[0], today);
    diagnostics = continueA2Diagnostic(diagnostics, key);
  }
  p.diagnostics = diagnostics; await seed(p, `diagnostics?chapter=${chapter.id}`); await page.locator(".insights-diagnostic-summary").waitFor();
  assert.match(await page.locator(".insights-diagnostic-summary").innerText(), sample.language === "en" ? /1 supported answer/ : /1 risposta aiutata/);
  await layout("copy-completed-check");
  await go("diagnostics"); await page.locator(".insights-topic-grid").waitFor();
  assert.match(await page.locator(".insights-topic-grid article").nth(2).innerText(), sample.language === "en" ? /1 saved check/ : /1 controllo salvato/);
  const unit = planningUnits.find((item) => item.id === "a2-imperfetto"), exercise = unit.exercises[0];
  p.academy.grammar[unit.id] = { ...getGrammarDraft(p, unit.id), attempts: { [exercise.id]: [{ date: oldDate, answer: "old", correct: false, assisted: false }, { date: today, answer: "later", correct: true, assisted: false }] } };
  await seed(p, "weekly"); await page.locator(".insights-delayed-evidence").waitFor();
  assert.match(await page.locator(".insights-delayed-evidence").innerText(), /:\s*1\./);
  await page.locator(".insights-delayed-evidence").scrollIntoViewIfNeeded(); await layout("copy-weekly-counts");
  pass("Singular diagnostic/history wording and neutral later-day count labels verified on final rebuilt UI");
};

try {
  await fs.mkdir(evidenceDir, { recursive: true });
  const realWork = await fs.realpath(path.join(repository, "work")), realEvidence = await fs.realpath(evidenceDir); assert.ok(!path.relative(realWork, realEvidence).startsWith("..")); evidenceReady = true;
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true, args: config.allowNoSandbox ? ["--no-sandbox"] : [] });
  const layouts = phase === "copy" ? [["en", 390], ["it", 320]] : [["en", 390], ["it", 320], ["en", 1440]];
  for (const [language, width] of layouts) { await openContext(language, width); if (phase === "copy") await copyFlow(); else { const p = await diagnosticFlow(); await weeklyFlow(p); await limitFlow(); } await context.close(); context = undefined; }
  assert.deepEqual(errors, []); assert.deepEqual(blockedRequests, []);
} catch (error) { failure = error; console.error(error.stack || error); if (page && evidenceReady && !page.isClosed()) await layout("failure").catch(() => {}); }
finally {
  if (context) await context.close().catch(() => {}); if (browser) await browser.close().catch(() => {});
  if (evidenceReady) await fs.writeFile(path.join(evidenceDir, phase === "all" ? "browser-report.json" : "browser-report-copy.json"), `${JSON.stringify({ date: new Date().toISOString(), base, phase, synthetic: true, standaloneBrowser: true, checks, screenshots, runtimeErrors: errors, blockedRequests, passed: !failure, failure: failure?.message ?? null, limitations: ["Synthetic isolated Chromium only; no existing learner state, shared browser, proficiency claim or remote publication.", "Backup merge and malicious-import behavior are covered by the separate model/backup regression tests."] }, null, 2)}\n`);
}
if (failure) process.exitCode = 1;
