import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emptyProgress, parseProgress, dayKey, addDays, STORAGE_KEY } from "../app/learning/engine.ts";
import { emptyAcademy, getGrammarDraft } from "../app/learning/academy-engine.ts";
import { a2DiagnosticChapters } from "../app/learning/a2-diagnostic-data.ts";
import { emptyA2Diagnostics, startA2Diagnostic, answerA2Diagnostic, continueA2Diagnostic, diagnosticRunKey } from "../app/learning/a2-diagnostic-model.ts";

// Returning-learner simulations only. Never use shared CDP or existing storage.
process.umask(0o077);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(`${extension}/node_modules/playwright-core/index.mjs`).href);
const config = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const base = (process.env.PARLIAMO_URL || "http://127.0.0.1:5200").replace(/\/+$/, "");
const origin = new URL(base); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname), "Use a local preview for synthetic recall checks.");
const out = path.resolve(root, process.env.LEARNER_RECALL_REPORT_DIR || "work/learner-audit-returning/verification");
const relative = path.relative(path.join(root, "work"), out);
assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
execFileSync("git", ["check-ignore", "--quiet", "--no-index", path.join(out, "browser-report.json")], { cwd: root });
const read = async (name) => JSON.parse(await fs.readFile(path.join(root, "app/learning", `${name}.json`), "utf8"));
const [grammar, curriculum] = await Promise.all([read("grammar"), read("curriculum")]);
const today = dayKey(), old = addDays(today, -30), mission = curriculum.missions[0], ids = curriculum.missions.map((item) => item.id);
const chapter = a2DiagnosticChapters[2], target = grammar.units.find((unit) => unit.id === "a2-conditional");
const checks = [], screenshots = [], errors = [], blocked = [];
let browser, context, page, sample, failure, evidenceReady = false;
const pass = (label, detail = {}) => { checks.push({ label, ...sample, ...detail }); console.log("PASS", label, JSON.stringify({ ...sample, ...detail })); };
const until = async (predicate, label) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await page.waitForTimeout(50); } assert.fail(label); };
const raw = () => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
const stored = async () => JSON.parse(await raw());
const go = async (route) => { await page.goto(`${base}/#${route}`); await page.locator(".daily-header").waitFor(); };
const seed = async (p, route) => {
  p = parseProgress(JSON.stringify(p), ids);
  await go("today"); await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: JSON.stringify(p) });
  await go(route); await page.reload(); await page.locator(".daily-header").waitFor();
  await until(async () => await page.locator("html").getAttribute("lang") === p.language, "Synthetic language must hydrate.");
  return p;
};
const screenshot = async (name) => { const file = `${sample.language}-${sample.width}-${name}.png`; await page.screenshot({ path: path.join(out, file), fullPage: false }); screenshots.push(file); };
const newProgress = () => { const p = emptyProgress(); p.language = sample.language; return p; };
const dueCore = () => {
  const p = newProgress();
  p.completed[mission.id] = { date: old, firstCorrect: 2, total: 2, output: "Synthetic old personal production.", supported: false, confidence: 2 };
  p.reviews[mission.id] = { due: addDays(today, -20), interval: 3, attempts: 0, correct: 0, lastDate: "" };
  return p;
};
const coreAnswer = () => page.locator(".study-paper form input");
const submitCore = async (answer) => { await coreAnswer().fill(answer); await page.locator(".study-paper form .button.primary").click(); };
const label = () => page.locator(".study-paper form .button-row span");
const coreChecks = async () => {
  const p = await seed(dueCore(), "reviews?minutes=2"); await page.locator(".review-next .button").waitFor();
  assert.equal(await page.locator(".review-item").count(), 1); await page.locator(".review-next .button").click(); await coreAnswer().waitFor();
  assert.equal(new URL(page.url()).hash, `#review/${mission.id}`);
  await submitCore("synthetic wrong recall"); await page.locator(".feedback.retry").waitFor();
  const afterWrong = await stored(); await page.reload(); await coreAnswer().waitFor(); await submitCore(mission.review.answers[0]); await label().waitFor();
  assert.equal(await label().innerText(), sample.language === "en" ? "Corrected with support" : "Corretto con aiuto");
  const corrected = await stored(); assert.deepEqual(corrected.reviews, afterWrong.reviews); assert.deepEqual(corrected.reviewLog, afterWrong.reviewLog); assert.deepEqual(corrected.completed, p.completed);
  assert.equal(corrected.reviews[mission.id].due, addDays(today, 1)); assert.equal(corrected.reviews[mission.id].attempts, 1); assert.equal(corrected.reviews[mission.id].correct, 0);
  await label().scrollIntoViewIfNeeded(); await screenshot("corrected-after-reload");
  pass("A due queue target retains its first failure, tomorrow schedule and supported feedback after reload");
  await seed(dueCore(), `review/${mission.id}`); await coreAnswer().waitFor(); await submitCore(mission.review.answers[0]); await label().waitFor();
  assert.equal(await label().innerText(), sample.language === "en" ? "Recalled independently" : "Ricordato in autonomia");
  const firstSuccess = await stored(); assert.equal(firstSuccess.reviews[mission.id].attempts, 1); assert.equal(firstSuccess.reviews[mission.id].correct, 1);
  await page.reload(); await coreAnswer().waitFor(); await submitCore(mission.review.answers[0]); await label().waitFor();
  assert.equal(await label().innerText(), sample.language === "en" ? "Extra practice" : "Pratica extra");
  assert.deepEqual((await stored()).reviews, firstSuccess.reviews); assert.deepEqual((await stored()).reviewLog, firstSuccess.reviewLog);
  pass("A new scheduled success earns independent feedback once; repeating it after reload is extra practice");
  const extra = dueCore(); extra.reviews[mission.id].due = addDays(today, 5); extra.reviews[mission.id].lastDate = old;
  await seed(extra, `review/${mission.id}`); await coreAnswer().waitFor(); const before = await raw();
  await submitCore(mission.review.answers[0]); await label().waitFor(); assert.equal(await label().innerText(), sample.language === "en" ? "Extra practice" : "Pratica extra");
  assert.equal(await raw(), before);
  pass("An early unscheduled correct answer does not claim a new independent recall or mutate records");
};
const variantChecks = async () => {
  const unit = grammar.units.find((item) => item.id === "a2-better-best"), exercise = unit.exercises.find((item) => item.id === "a2-better-best-4");
  const p = newProgress(); p.academy = emptyAcademy(); p.academy.grammar[unit.id] = { ...getGrammarDraft(p, unit.id), answers: { [exercise.id]: exercise.answers[0] }, attempts: { [exercise.id]: [{ date: old, answer: exercise.answers[0], correct: true, assisted: false }] } };
  await seed(p, `grammar/${unit.id}?exercise=${exercise.id}&review=1`); const form = page.locator(".academy-exercise-card"); await form.locator("input:not([type=radio])").waitFor();
  await form.locator("input:not([type=radio])").fill("Questa è una soluzione ottima."); await form.locator("button[type=submit]").click(); await form.locator(".academy-feedback.correct").waitFor();
  const history = (await stored()).academy.grammar[unit.id].attempts[exercise.id]; assert.equal(history.at(-1).correct, true); assert.equal(history.at(-1).assisted, false); assert.deepEqual(history[0], p.academy.grammar[unit.id].attempts[exercise.id][0]);
  await form.locator(".academy-feedback").scrollIntoViewIfNeeded(); await screenshot("valid-postnoun-ottima");
  pass("The valid post-noun ottima transformation is accepted as independent grammar recall");
};
const catchUpFixture = () => {
  const p = newProgress(); p.academy = emptyAcademy();
  const complete = (id) => {
    if (p.academy.grammar[id]) return; const unit = grammar.units.find((item) => item.id === id);
    for (const prerequisite of unit.prerequisites) complete(prerequisite);
    p.academy.grammar[id] = { ...getGrammarDraft(p, id), completed: old, exerciseIndex: 3, output: "An old production from the previous month remains saved.", rubric: [0, 1, 2],
      answers: Object.fromEntries(unit.exercises.map((exercise) => [exercise.id, exercise.answers[0]])),
      attempts: Object.fromEntries(unit.exercises.map((exercise) => [exercise.id, [{ date: old, answer: exercise.answers[0], correct: true, assisted: false }]])),
    };
  };
  complete(target.id);
  let diagnostics = startA2Diagnostic(emptyA2Diagnostics(), chapter.id, today); const key = diagnosticRunKey(today, chapter.id);
  diagnostics = answerA2Diagnostic(diagnostics, key, chapter.items[0], "wrong", today); p.diagnostics = continueA2Diagnostic(diagnostics, key);
  return p;
};
const assertPractice = async (mode) => {
  await page.locator(".academy-steps").waitFor();
  assert.match(await page.locator('.academy-steps [aria-current="step"]').innerText(), sample.language === "en" ? /Practise/ : /Esercitati/);
  assert.equal(await page.locator(".academy-filters button").nth(mode === "due" ? 2 : 0).getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator(".academy-exercise-card").count(), 1);
};
const catchUpChecks = async () => {
  const p = await seed(catchUpFixture(), `diagnostics?chapter=${chapter.id}`); await page.locator(".insights-catch-up article li button").first().waitFor(); const before = await raw();
  await page.locator(".insights-catch-up article li button").first().click(); await assertPractice("due"); assert.equal(new URL(page.url()).hash, `#grammar/${target.id}?practice=1`);
  assert.equal(await page.locator('.academy-exercise-card input:not([type="radio"])').inputValue(), ""); assert.equal(await raw(), before);
  await page.locator(".academy-exercise-card").scrollIntoViewIfNeeded(); await screenshot("completed-unit-catchup-practice");
  await go(`grammar/${target.id}`); await page.locator(".academy-steps").waitFor(); assert.match(await page.locator('.academy-steps [aria-current="step"]').innerText(), sample.language === "en" ? /Use it/ : /Usala/);
  assert.equal(await page.locator(".academy-sheet textarea").inputValue(), p.academy.grammar[target.id].output);
  pass("Failed diagnostic catch-up opens blank due practice while normal reopening retains old production and stage");
  await go("weekly"); await page.locator(".weekly-learning-report").waitFor();
  const diagnosticSuggestion = page.locator(".insights-next-steps article").filter({ hasText: sample.language === "en" ? "topic check was incorrect or supported" : "L’ultimo controllo salvato" });
  await diagnosticSuggestion.getByRole("button").click(); await assertPractice("due"); assert.equal(new URL(page.url()).hash, `#grammar/${target.id}?practice=1`);
  assert.deepEqual((await stored()).academy.grammar[target.id], p.academy.grammar[target.id]);
  pass("The weekly diagnostic recommendation opens the same specific catch-up practice without rewriting old evidence");
  const fresh = catchUpFixture(); for (const exercise of target.exercises) fresh.academy.grammar[target.id].attempts[exercise.id].push({ date: today, answer: exercise.answers[0], correct: true, assisted: false });
  await seed(fresh, `grammar/${target.id}?practice=1`); await assertPractice("all");
  assert.deepEqual((await stored()).academy.grammar[target.id], fresh.academy.grammar[target.id]);
  pass("A catch-up request with no due questions opens All exercises rather than an empty due view");
};

try {
  await fs.mkdir(out, { recursive: true });
  const realWork = await fs.realpath(path.join(root, "work")), realOut = await fs.realpath(out); assert.ok(!path.relative(realWork, realOut).startsWith("..")); evidenceReady = true;
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true, args: config.allowNoSandbox ? ["--no-sandbox"] : [] });
  for (const [language, width] of [["en", 390], ["it", 320], ["en", 1440]]) {
    sample = { language, width, height: width === 1440 ? 1000 : 844 };
    context = await browser.newContext({ viewport: { width, height: sample.height }, locale: "en-GB", reducedMotion: "reduce" });
    await context.route("**/*", (route) => { const request = route.request(), url = new URL(request.url()); if (url.origin === origin.origin && ["GET", "HEAD"].includes(request.method())) return route.continue(); blocked.push({ method: request.method(), origin: url.origin }); return route.abort(); });
    page = await context.newPage(); page.setDefaultTimeout(12000); page.on("pageerror", (error) => errors.push(error.message));
    await coreChecks(); await variantChecks(); await catchUpChecks(); await context.close(); context = undefined;
  }
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
} catch (error) { failure = error; console.error(error.stack || error); if (page && evidenceReady && !page.isClosed()) await screenshot("failure").catch(() => {}); }
finally {
  if (context) await context.close().catch(() => {}); if (browser) await browser.close().catch(() => {});
  if (evidenceReady) await fs.writeFile(path.join(out, "browser-report.json"), `${JSON.stringify({ date: new Date().toISOString(), base, simulation: true, isolation: "Owned standalone Chromium with disposable synthetic contexts; no shared browser/profile or real learner records", checks, screenshots, errors, blockedRequests: blocked, passed: !failure, failure: failure?.message ?? null, limitations: ["Reproducible software learner simulations, not empirical learner research or measured retention improvement."] }, null, 2)}\n`);
}
if (failure) process.exitCode = 1;
