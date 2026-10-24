import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emptyProgress, dayKey, addDays, parseProgress, STORAGE_KEY } from "../app/learning/engine.ts";
import { emptyAcademy, getGrammarDraft } from "../app/learning/academy-engine.ts";
import { emptyArcade, startArcadeRound } from "../app/learning/arcade-engine.ts";
import { arcadeItems } from "../app/learning/arcade-catalogue.ts";
import { planningReviewCatalogue } from "../app/learning/planning-data.ts";
import { selectReviewQueue } from "../app/learning/review-queue.ts";

// Synthetic records in a disposable standalone Chromium. Never attach to CDP.
process.umask(0o077);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserRoot = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(`${browserRoot}/node_modules/playwright-core/index.mjs`).href);
const config = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const base = (process.env.PARLIAMO_URL || "http://127.0.0.1:5197").replace(/\/+$/, "");
const origin = new URL(base);
assert.ok(["http:", "https:"].includes(origin.protocol) && !origin.username && !origin.password && !origin.search && !origin.hash, "Use a credential-free HTTP(S) app base.");
const evidenceDir = path.resolve(repository, process.env.REVIEW_REPORT_DIR || "work/review-queue-audit");
const relative = path.relative(path.join(repository, "work"), evidenceDir);
assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), "Evidence must remain inside ignored work/.");
execFileSync("git", ["check-ignore", "--quiet", "--no-index", path.join(evidenceDir, "browser-report.json")], { cwd: repository });
const phase = process.env.REVIEW_QA_PHASE || "all";
assert.ok(["all", "non-grammar", "grammar"].includes(phase));
const read = async (name) => JSON.parse(await fs.readFile(path.join(repository, "app", "learning", `${name}.json`), "utf8"));
const [grammar, curriculum] = await Promise.all([read("grammar"), read("curriculum")]);
const unit = grammar.units.find((item) => item.id === "a2-imperfetto");
const exercise = unit.exercises[1], mission = curriculum.missions[0];
const words = planningReviewCatalogue.words.slice(0, 2);
const arcade = arcadeItems.find((item) => item.mode === "conversation");
const unrelated = arcadeItems.find((item) => item.mode === "words");
assert.ok(exercise && !exercise.options && arcade && unrelated && words.length === 2);
const today = dayKey(), prior = addDays(today, -5);
const checks = [], errors = [], forbiddenRequests = [], screenshots = [];
let browser, context, page, evidenceReady = false, failure;
const pass = (label, details = {}) => { checks.push({ label, ...details }); console.log("PASS", label, JSON.stringify(details)); };
const until = async (predicate, label) => {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await page.waitForTimeout(50); }
  assert.fail(label);
};
const fixture = (language, active = false) => {
  let p = emptyProgress(); p.language = language; p.academy = emptyAcademy(); p.arcade = emptyArcade();
  p.completed[mission.id] = { date: prior, firstCorrect: 0, total: mission.checks.length, output: "Synthetic original writing stays saved.", supported: true, confidence: 2 };
  p.reviews[mission.id] = { due: addDays(today, -4), interval: 1, attempts: 0, correct: 0, lastDate: "" };
  p.academy.grammar[unit.id] = { ...getGrammarDraft(p, unit.id), exerciseIndex: 6, output: "Da piccola abitavo vicino a un lago. Disegnavo ogni giorno.", rubric: [0], answers: { [exercise.id]: "original submitted response" }, attempts: { [exercise.id]: [{ answer: "original submitted response", correct: false, assisted: false, date: addDays(today, -3) }] } };
  for (const [index, word] of words.entries()) p.academy.words[word.key] = { term: word.term, starred: true, successes: 1, lapses: 0, due: addDays(today, -2 + index), lastDate: addDays(today, -3) };
  p.arcade.settings.support = "recall";
  p.arcade.records[arcade.id] = { first: { answer: "Original wrong answer", correct: false, assisted: true }, last: { answer: "Later wrong answer", correct: false, assisted: false }, date: addDays(today, -3), due: addDays(today, -2), successes: 0 };
  if (active) { p = startArcadeRound(p, [unrelated], today, "synthetic-unrelated-round"); p.arcade.active.draft = "An unfinished synthetic response"; }
  return parseProgress(JSON.stringify(p), curriculum.missions.map((item) => item.id));
};
const go = async (route) => { await page.goto(`${base}/#${route}`); await page.locator(".daily-header").waitFor(); };
const stored = async () => JSON.parse(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY));
const rawStored = async () => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
const seed = async (p, route) => {
  await go("today");
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: JSON.stringify(p) });
  await go(route); await page.reload(); await page.locator(".daily-header").waitFor();
  await until(async () => await page.locator("html").getAttribute("lang") === p.language, "Synthetic language must hydrate.");
};
const unchanged = async (before, message) => assert.equal(await rawStored(), before, message);
const noOverflow = async () => {
  const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.equal(size.document, size.viewport, "No horizontal document overflow."); return size;
};
const screen = async (name) => { await page.screenshot({ path: path.join(evidenceDir, name), fullPage: false }); screenshots.push(name); };
const openContext = async (language, width, height = 844) => {
  context = await browser.newContext({ viewport: { width, height }, locale: "en-GB", reducedMotion: "reduce" });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (["GET", "HEAD"].includes(request.method()) && url.origin === origin.origin) return route.continue();
    forbiddenRequests.push({ method: request.method(), origin: url.origin }); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(fixture(language), "reviews?minutes=5"); await page.locator(".review-hub h1").waitFor();
};
const hubChecks = async (language, width) => {
  const original = fixture(language), expected = selectReviewQueue(original, planningReviewCatalogue, today, 5);
  const before = await rawStored();
  assert.equal(expected.totalDue, 5);
  assert.match(await page.locator(".review-queue-status").innerText(), /^5 /);
  assert.equal(await page.locator(".review-item").count(), expected.items.length);
  await until(async () => page.locator(".review-hub h1").evaluate((node) => document.activeElement === node), "Hub heading takes focus.");
  for (const minutes of [2, 10, 5]) {
    await page.getByRole("button", { name: `${minutes} min`, exact: true }).click();
    assert.equal(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("minutes"), String(minutes));
    assert.equal(await page.locator(".review-item").count(), selectReviewQueue(original, planningReviewCatalogue, today, minutes).items.length);
  }
  await page.reload(); await page.locator(".review-hub").waitFor();
  assert.equal(await page.getByRole("button", { name: "5 min", exact: true }).getAttribute("aria-pressed"), "true");
  await unchanged(before, "Opening and selecting a review budget must not mutate progress.");
  await noOverflow(); await screen(`${language}-${width}-review-hub.png`);
  await page.locator(".review-next .button").click(); await page.locator(".study-paper").waitFor();
  assert.equal(new URL(page.url()).hash, `#review/${mission.id}`);
  await unchanged(before, "Opening the recommended practice must not record an answer.");
  await page.goBack(); await page.locator(".review-hub").waitFor();
  assert.equal(await page.getByRole("button", { name: "5 min", exact: true }).getAttribute("aria-pressed"), "true");
  pass("Mixed queue, 2/5/10-minute plans, reload, focus, Back and nonmutating entry", { language, width, due: expected.totalDue });
};
const todayChecks = async (language) => {
  await page.setViewportSize({ width: 320, height: 844 }); await seed(fixture(language), "today");
  const link = page.locator(".today-review-link button"); await link.waitFor(); await link.scrollIntoViewIfNeeded();
  const box = await link.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= 320);
  assert.match(await link.innerText(), /^5 /); await noOverflow(); await screen(`${language}-320-today-review-link.png`);
  const before = await rawStored(); await link.click(); await page.locator(".review-hub").waitFor(); await unchanged(before, "Today CTA is a read-only entry.");
  pass("Today mixed-due optional review CTA wraps within 320px", { language, width: 320 });
};
const coreChecks = async (language) => {
  const initial = fixture(language); await seed(initial, `review/${mission.id}`); const before = await rawStored();
  const answer = page.locator(".study-paper form input"); await answer.waitFor(); await unchanged(before, "Core recall entry is read-only.");
  await answer.fill("synthetic incorrect reply"); await page.locator(".study-paper form .button.primary").click(); await page.locator(".feedback.retry").waitFor();
  let p = await stored(); assert.equal(p.reviews[mission.id].attempts, 1); assert.equal(p.reviews[mission.id].due, addDays(today, 1)); assert.deepEqual(p.completed, initial.completed); assert.equal(p.reviewLog.filter((item) => item.id === mission.id).length, 1);
  await page.reload(); await answer.waitFor(); await answer.fill(mission.review.answers[0]); await page.locator(".study-paper form .button.primary").click(); await page.locator(".feedback.correct").waitFor();
  p = await stored(); assert.equal(p.reviews[mission.id].attempts, 1); assert.equal(p.reviewLog.filter((item) => item.id === mission.id).length, 1); assert.deepEqual(p.completed, initial.completed);
  pass("Core wrong recall persists once; same-day correction preserves original credit and schedule", { language });
};
const wordChecks = async (language) => {
  const initial = fixture(language), target = words[1]; await seed(initial, `words?word=${encodeURIComponent(target.key)}`);
  const review = page.locator(".word-review"); await review.waitFor(); const before = await rawStored();
  assert.equal(await review.locator("h2").innerText(), target.term.en); await unchanged(before, "Exact word entry is read-only.");
  await review.getByRole("button", { name: language === "en" ? "Reveal my word" : "Scopri la parola", exact: true }).click();
  await unchanged(before, "Revealing a word must not rate it.");
  await review.getByRole("button", { name: language === "en" ? "Again tomorrow" : "Ancora domani", exact: true }).click();
  let p = await stored(); assert.equal(p.academy.words[target.key].lastDate, today); assert.equal(p.academy.words[target.key].due, addDays(today, 1)); assert.equal(p.academy.words[target.key].lapses, 1); assert.deepEqual(p.academy.words[words[0].key], initial.academy.words[words[0].key]);
  await page.reload(); await review.waitFor(); assert.equal(await review.locator("h2").count(), 0); assert.match(await review.innerText(), language === "en" ? /reviewed today/ : /ripassato questa parola oggi/);
  p = await stored(); assert.equal(p.academy.words[target.key].lapses, 1); await noOverflow();
  pass("Exact personal word selection, self-rating, reload and no silent fallback", { language, targetedSecondDueWord: true });
};
const arcadeChecks = async (language, width) => {
  const active = fixture(language, true); await seed(active, `games?review=${encodeURIComponent(arcade.id)}`);
  await page.locator(".arcade-playing").waitFor(); const before = await rawStored();
  const note = page.getByText(language === "en" ? "Finish your saved round first. Your requested review will be ready afterwards." : "Termina prima il giro salvato. Il ripasso richiesto sarà disponibile dopo.", { exact: true });
  await note.waitFor(); await unchanged(before, "A requested arcade review cannot overwrite another active round."); assert.deepEqual((await stored()).arcade.active, active.arcade.active);
  await noOverflow(); await note.scrollIntoViewIfNeeded(); await screen(`${language}-${width}-arcade-pending.png`);
  pass("Unrelated unfinished arcade round and draft remain intact", { language });
  const initial = fixture(language); await seed(initial, `games?review=${encodeURIComponent(arcade.id)}`);
  const start = page.getByRole("button", { name: language === "en" ? "Start this review" : "Inizia questo ripasso", exact: true }); await start.waitFor();
  const pending = await rawStored(); await unchanged(pending, "Arcade intent is read-only until explicit start."); await start.click(); await page.locator(".arcade-options").waitFor();
  assert.deepEqual((await stored()).arcade.active.itemIds, [arcade.id]);
  await page.getByRole("button", { name: arcade.options.find((option) => !arcade.answers.includes(option)), exact: true }).click(); await page.locator(".arcade-feedback").waitFor();
  let p = await stored(); assert.equal(p.arcade.records[arcade.id].last.correct, false); assert.deepEqual(p.arcade.records[arcade.id].first, initial.arcade.records[arcade.id].first); assert.equal(p.arcade.records[arcade.id].due, addDays(today, 1));
  await page.reload(); await page.locator(".arcade-feedback").waitFor(); assert.equal(await page.locator(".arcade-option").count(), 0);
  await page.getByRole("button", { name: language === "en" ? "Finish round" : "Concludi il giro", exact: true }).click(); await page.getByRole("heading", { name: arcade.title[language], exact: true }).waitFor();
  p = await stored(); assert.equal(p.arcade.active, null); assert.equal(p.arcade.history.length, 1); assert.equal(await start.count(), 0);
  const finished = p.arcade; await page.reload(); await page.getByRole("heading", { name: arcade.title[language], exact: true }).waitFor(); assert.deepEqual((await stored()).arcade, finished);
  pass("Exact arcade intent starts one item; wrong result, reload and finish retain first evidence once", { language });
};
const grammarChecks = async (language, width) => {
  const initial = fixture(language); await seed(initial, `grammar/${unit.id}?exercise=${exercise.id}&review=1`);
  const form = page.locator(".academy-exercise-card"), input = form.locator("input:not([type=radio])"); await input.waitFor();
  const before = await rawStored(); assert.equal(await input.inputValue(), ""); assert.equal(await form.locator("h3").innerText(), exercise.prompt[language]);
  await unchanged(before, "Grammar entry cannot record an attempt or expose the previous submitted answer.");
  await input.fill("synthetic unsubmitted recall"); await page.reload(); await input.waitFor();
  assert.equal(await input.inputValue(), "synthetic unsubmitted recall", "Unsubmitted recall must survive reload.");
  let p = await stored(); assert.equal(p.academy.grammar[unit.id].answers[exercise.id], initial.academy.grammar[unit.id].answers[exercise.id], "A recall draft must not overwrite the ordinary submitted answer.");
  assert.equal(p.academy.grammar[unit.id].attempts[exercise.id].length, 1);
  await input.fill("synthetic incorrect recall"); await form.locator("button[type=submit]").click(); await form.locator(".academy-feedback.retry").waitFor();
  p = await stored(); assert.equal(p.academy.grammar[unit.id].attempts[exercise.id].length, 2); assert.deepEqual(p.academy.grammar[unit.id].attempts[exercise.id][0], initial.academy.grammar[unit.id].attempts[exercise.id][0]);
  assert.equal(p.academy.grammar[unit.id].exerciseIndex, 6); assert.equal(p.academy.grammar[unit.id].output, initial.academy.grammar[unit.id].output);
  assert.deepEqual(p.academy.grammar[unit.id].rubric, [0]); await noOverflow(); await screen(`${language}-${width}-grammar-repair.png`);
  await page.reload(); await page.getByRole("heading", { name: language === "en" ? "Already checked today" : "Già controllato oggi", exact: true }).waitFor();
  const checked = await stored(); assert.equal(checked.academy.grammar[unit.id].attempts[exercise.id].length, 2);
  await go(`grammar/${unit.id}`); await page.locator(".academy-steps").waitFor();
  assert.match(await page.locator('.academy-steps button[aria-current="step"]').innerText(), language === "en" ? /Use it/ : /Usa/);
  assert.equal((await stored()).academy.grammar[unit.id].exerciseIndex, 6);
  pass("Target grammar recall draft survives reload, wrong first evidence is retained and ordinary lesson stage/index survive", { language, width, exercise: exercise.id });
};

try {
  await fs.mkdir(evidenceDir, { recursive: true });
  const realWork = await fs.realpath(path.join(repository, "work")), realEvidence = await fs.realpath(evidenceDir);
  assert.ok(!path.relative(realWork, realEvidence).startsWith(".."), "Evidence symlinks must not escape work/."); evidenceReady = true;
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true, args: config.allowNoSandbox ? ["--no-sandbox"] : [] });
  for (const language of ["en", "it"]) {
    const width = language === "en" ? 390 : 320; await openContext(language, width);
    if (phase !== "grammar") { await hubChecks(language, width); await todayChecks(language); await page.setViewportSize({ width, height: 844 }); await coreChecks(language); await wordChecks(language); await arcadeChecks(language, width); }
    if (phase !== "non-grammar") await grammarChecks(language, width);
    await context.close(); context = undefined;
  }
  if (phase !== "grammar") {
    await openContext("en", 1440, 1000); await noOverflow(); await screen("en-1440-review-hub.png"); pass("Desktop mixed review hub layout", { language: "en", width: 1440 }); await context.close(); context = undefined;
  }
  assert.deepEqual(errors, [], "No uncaught browser errors."); assert.deepEqual(forbiddenRequests, [], "No writes or off-origin requests.");
} catch (error) { failure = error; console.error(error.stack || error); if (page && evidenceReady && !page.isClosed()) await screen(`failure-${phase}.png`).catch(() => {}); }
finally {
  if (context) await context.close().catch(() => {}); if (browser) await browser.close().catch(() => {});
  if (evidenceReady) await fs.writeFile(path.join(evidenceDir, `browser-report-${phase}.json`), `${JSON.stringify({ date: new Date().toISOString(), base, phase, synthetic: true, standaloneBrowser: true, checks, screenshots, browserErrors: errors, forbiddenRequests, passed: !failure, failure: failure?.message || null }, null, 2)}\n`);
}
if (failure) process.exitCode = 1;
