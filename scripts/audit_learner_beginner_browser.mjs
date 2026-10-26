import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { addDays, dayKey, emptyProgress, parseProgress, STORAGE_KEY } from "../app/learning/engine.ts";

// Simulated learner only: owned disposable Chromium, no shared CDP or profile.
process.umask(0o077);
const root = process.cwd(), base = process.env.PARLIAMO_URL || "http://127.0.0.1:5200";
const origin = new URL(base);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) && !origin.username && !origin.password);
const evidence = path.resolve(process.env.BEGINNER_AUDIT_DIR || "work/learner-audit-beginner/after");
assert.ok(evidence.startsWith(`${path.join(root, "work")}${path.sep}`));
execFileSync("git", ["check-ignore", "--quiet", "--no-index", path.join(evidence, "report.json")]);
const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(`${extension}/node_modules/playwright-core/index.mjs`).href);
const config = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const curriculum = JSON.parse(await fs.readFile("app/learning/curriculum.json", "utf8"));
const ids = curriculum.missions.map((mission) => mission.id), mission = curriculum.missions[0], today = dayKey();
const checks = [], measurements = [], screenshots = [], errors = [], forbiddenRequests = [];
let browser, context, page, failure;
const pass = (label, details = {}) => { checks.push({ label, ...details }); console.log("PASS", label); };
const state = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
const until = async (predicate, label) => {
  for (let n = 0; n < 120; n++) { if (await predicate()) return; await page.waitForTimeout(50); }
  assert.fail(label);
};
const go = async (route) => { await page.goto(`${base}/#${route}`); await page.locator(".daily-header").waitFor(); };
const seed = async (p, route) => {
  parseProgress(JSON.stringify(p), ids);
  await go("today");
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: JSON.stringify(p) });
  await go(route); await page.reload(); await page.locator(".daily-header").waitFor();
  await until(async () => await page.locator("html").getAttribute("lang") === p.language, "Synthetic language hydrates");
};
const fixture = (language) => { const p = emptyProgress(); p.language = language; return p; };
const button = (label) => page.getByRole("button", { name: new RegExp(`^(?:←\\s*)?${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s*→)?$`), exact: true });
const openContext = async (width, language) => {
  context = await browser.newContext({ viewport: { width, height: 844 }, locale: "en-GB", timezoneId: "UTC", reducedMotion: "reduce" });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (["GET", "HEAD"].includes(request.method()) && url.origin === origin.origin) return route.continue();
    forbiddenRequests.push({ method: request.method(), origin: url.origin }); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await seed(fixture(language), "today");
};
const screenshot = async (name, locator) => {
  const file = path.join(evidence, `${name}.png`);
  if (locator) await locator.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: false });
  screenshots.push(path.relative(root, file));
};
const activity = async (label, width, language, mobile = true) => {
  const heading = page.locator(".session-activity > h2");
  await heading.waitFor();
  if (mobile) await until(() => heading.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return document.activeElement === node && box.top >= -1 && box.bottom <= innerHeight + 1;
  }), "The active phone task receives visible heading focus");
  else await page.waitForTimeout(100);
  const measured = await heading.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { heading: node.textContent, focused: document.activeElement === node, top: Math.round(box.top), bottom: Math.round(box.bottom), scrollY, viewportHeight: innerHeight, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
  });
  measurements.push({ label, width, language, ...measured });
  assert.ok(measured.documentWidth <= measured.viewportWidth + 1, "No horizontal overflow");
  if (!mobile) { assert.equal(measured.focused, false); assert.equal(measured.scrollY, 0); }
  return measured;
};

try {
  await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true, args: config.allowNoSandbox ? ["--no-sandbox"] : [] });
  for (const language of ["en", "it"]) for (const width of [320, 390]) {
    await openContext(width, language);
    await page.locator(".today-primary-action").click(); await page.locator(".session-page").waitFor();
    await activity("Today entry", width, language); await screenshot(`${language}-${width}-today-opens-task`);
    const text = language === "en" ? "Ciao, mi chiamo Ada." : "Ciao, mi chiamo Lia.";
    await page.locator(".session-activity textarea").fill(text);
    await until(async () => (await state()).sessions[today].warmup === text, "Typed warm-up is saved");
    const beforeReload = await state();
    await page.reload(); await activity("Direct reload with pending warm-up", width, language);
    assert.equal(await page.locator(".session-activity textarea").inputValue(), text);
    assert.deepEqual((await state()).sessions, beforeReload.sessions, "Focusing a resumed task must not rewrite saved work");
    await button(language === "en" ? "Save my warm-up" : "Salva il riscaldamento").click();
    await until(async () => (await state()).sessions[today].done.includes("warmup"), "Warm-up completes");
    const resumed = await state();
    await page.reload(); await activity("Direct reload at next unfinished activity", width, language);
    assert.ok((await page.locator(".session-activity > h2").innerText()).includes(language === "en" ? "Learn one useful idea" : "Impara un’idea utile"));
    assert.deepEqual((await state()).sessions, resumed.sessions);
    pass(`${language.toUpperCase()}${width}: Today entry and two reload states focus the active task and preserve drafts`);
    await context.close(); context = null;
  }
  for (const language of ["en", "it"]) {
    await openContext(1440, language);
    await page.locator(".today-primary-action").click(); await page.locator(".session-page").waitFor();
    await activity("Desktop entry retains overview", 1440, language, false);
    pass(`${language.toUpperCase()} desktop: entry keeps its original overview and scroll position`);
    await context.close(); context = null;
  }
  for (const language of ["en", "it"]) {
    await openContext(390, language);
    await go("weekly"); await page.locator(".weekly-learning-report").waitFor();
    assert.equal(await page.locator(".insights-empty").isVisible(), true);
    const next = page.locator(".insights-next-steps");
    const expected = language === "en" ? "Continue today" : "Continua oggi";
    assert.equal(await next.getByRole("heading", { level: 3 }).innerText(), expected);
    assert.equal(await page.locator(".insights-next-week button").innerText(), `${expected} →`);
    assert.equal(await page.getByRole("button", { name: language === "en" ? "Open my A2 topic checks →" : "Apri i controlli sui temi A2 →", exact: true }).count(), 1, "A2 checks remain an optional destination");
    const before = await state();
    await screenshot(`${language}-390-empty-weekly-neutral-next-step`, next);
    await next.getByRole("button").click(); await page.locator(".today-primary-action").waitFor();
    await until(async () => new URL(page.url()).hash === "#today", "The weekly suggestion opens Today");
    assert.deepEqual(await state(), before, "Opening the suggested route preserves all progress");
    pass(`${language.toUpperCase()} empty A1 weekly report recommends Today and keeps optional A2 checks separate`);
    await context.close(); context = null;
  }

  // A bounded lesson/review sample checks that beginner correction affordances remain clear.
  await openContext(390, "en");
  await go(`lesson/${mission.id}`); await page.locator(".study-paper h1").waitFor();
  await button("Try it from memory").click();
  await page.getByRole("textbox", { name: "Your answer in Italian", exact: true }).fill("risposta di prova errata");
  await button("Check my answer").click(); await page.locator(".feedback.retry").waitFor();
  assert.ok((await page.locator(".feedback.retry").innerText()).includes(mission.checks[0].answers[0]));
  await page.getByRole("textbox", { name: "Your answer in Italian", exact: true }).fill(mission.checks[0].answers[0]);
  await button("Check my answer").click(); await page.locator(".feedback.correct").waitFor();
  assert.equal((await state()).drafts[mission.id].first[0], false);
  await screenshot("en-390-first-lesson-correction");
  const reviewFixture = fixture("en");
  reviewFixture.completed[mission.id] = { date: addDays(today, -3), firstCorrect: 0, total: 2, output: "Mi chiamo Ada.", supported: true, confidence: 2 };
  reviewFixture.reviews[mission.id] = { due: addDays(today, -1), interval: 1, attempts: 0, correct: 0, lastDate: "" };
  await seed(reviewFixture, `review/${mission.id}`); await page.locator(".study-paper").waitFor();
  await page.getByRole("textbox", { name: "Your answer in Italian", exact: true }).fill("risposta di prova errata");
  await button("Check recall").click(); await page.locator(".feedback.retry").waitFor();
  assert.match(await page.locator(".feedback.retry").innerText(), /tomorrow/);
  await page.getByRole("textbox", { name: "Your answer in Italian", exact: true }).fill(mission.review.answers[0]);
  await button("Check recall").click(); await page.locator(".feedback.correct").waitFor();
  assert.equal((await state()).reviewLog.filter((entry) => entry.id === mission.id).length, 1);
  assert.equal((await state()).reviewLog[0].correct, false, "The correction must not erase the initial recall result");
  await screenshot("en-390-due-review-correction");
  pass("Sample first lesson and due review provide correction/continue affordances while retaining first errors");
  assert.deepEqual(errors, []); assert.deepEqual(forbiddenRequests, []);
} catch (error) {
  failure = { name: error.name, message: error.message, location: error.stack?.split("\n").find((line) => line.includes("audit_learner_beginner_browser"))?.trim() };
  if (page) await screenshot("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {}); await browser?.close().catch(() => {});
  const result = { generator: "scripts/audit_learner_beginner_browser.mjs", status: failure ? "failed" : "passed", preview: base, date: today,
    method: "Simulated agent learner inspection, not real-user observation. Owned disposable Chromium and validated synthetic records; no shared profile/CDP or real learner state.",
    workflowGroupsPassed: checks.length, checks, measurements, screenshots, runtimeErrors: errors, forbiddenRequests,
    ...(failure ? { failure } : {}), limits: ["Phone dimensions are viewport emulation, not physical-device testing.", "No inference about real-user confusion, fatigue, retention or learning improvement.", "A bounded sample of first lesson/review affordances, not a full course completion.", "No production site, private study source, shared browser or learner database was accessed."] };
  await fs.writeFile(path.join(evidence, "report.json"), `${JSON.stringify(result, null, 2)}\n`);
  const reportFile = "docs/learner-beginner-audit-2026-10-26.json";
  const audit = JSON.parse(await fs.readFile(reportFile, "utf8")); audit.verification = result;
  await fs.writeFile(reportFile, `${JSON.stringify(audit, null, 2)}\n`);
  if (failure) console.error(failure.name, failure.message);
}
