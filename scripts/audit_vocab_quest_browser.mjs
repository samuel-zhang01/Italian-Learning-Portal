import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import curriculum from "../app/learning/curriculum.json" with { type: "json" };
import { emptyProgress, parseProgress, dayKey, addDays, STORAGE_KEY } from "../app/learning/engine.ts";
import { wordKey } from "../app/learning/academy-engine.ts";
import { vocabItems, vocabPracticeItems, vocabItemById } from "../app/learning/vocab-catalogue.ts";
import { vocabularyJourney } from "../app/learning/vocab-challenges.ts";
import { startVocabRound } from "../app/learning/vocab-engine.ts";

// Disposable profiles and synthetic learner work only. API reads and writes are
// blocked even on the public host; the audit never connects a real profile.
const base = (process.argv[2] || "http://127.0.0.1:5220").replace(/\/$/, "");
const output = path.resolve(process.argv[3] || "work/vocab-quest/browser-local");
const layoutOnly = process.argv.includes("--layout-only");
assert.ok(base === "https://italian.samuelzhang.co.uk" || /^http:\/\/127\.0\.0\.1:\d+$/.test(base));
assert.ok(output.startsWith(path.join(process.cwd(), "work") + path.sep));
const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(`${extension}/node_modules/playwright-core/index.mjs`).href);
const settings = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const browser = await chromium.launch({
  executablePath: "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
  headless: true, args: settings.allowNoSandbox ? ["--no-sandbox"] : [],
});
await fs.mkdir(output, { recursive: true });
const today = dayKey(), missionIds = curriculum.missions.map(mission => mission.id);
const checks = [], layouts = [], errors = [], blocked = [], failed = [], screenshots = [], touchTargets = [];
let failure, lastPage;
const current = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
const pass = (name, language, width) => { checks.push({ name, language, width }); console.log("PASS", language, width, name); };
async function go(page, route, selector) {
  await page.goto(`${base}/#${route}`);
  await page.locator(selector).first().waitFor();
}
async function seed(page, p, route = "vocab-boost", selector = ".vq-page-heading") {
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: STORAGE_KEY, value: p });
  await page.goto(`${base}/#${route}`); await page.reload(); await page.locator(selector).first().waitFor();
}
async function layout(page, label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, document: document.documentElement.scrollWidth }));
  layouts.push({ label, ...dimensions });
  assert.ok(dimensions.document <= dimensions.width + 1, `${label}: horizontal overflow ${dimensions.document}/${dimensions.width}`);
}
async function shot(page, label, fullPage = false) {
  await page.screenshot({ path: path.join(output, `${label}.png`), fullPage }); screenshots.push(`${label}.png`);
}
async function submit(page, value) {
  await page.locator("#vocab-answer").fill(value);
  await page.locator(".vocab-check").click();
  await page.locator(".vq-feedback").waitFor();
}
async function next(page, finish = false, keyboard = false) {
  if (keyboard) await page.locator(".vq-feedback").press("Enter");
  else await page.locator(".vocab-next").click();
  await page.locator(finish ? ".vq-finish" : "#vocab-answer").waitFor();
}
async function actualItem(page) {
  const p = await current(page), round = p.vocabPractice?.active;
  assert.ok(round, "A challenge is active");
  const item = vocabItemById.get(round.itemIds[round.index]);
  assert.ok(item, "The current saved word resolves to the catalogue"); return item;
}
async function buildTiles(page, target) {
  const pieces = /\s/.test(target.trim()) ? target.trim().split(/\s+/) : Array.from(target);
  for (const piece of pieces) await page.locator(".vq-tiles>div button:not([disabled])").filter({ hasText: new RegExp(`^${piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first().click();
  assert.equal(await page.locator("#vocab-answer").inputValue(), target);
}
async function freshContext(language, width) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 }, reducedMotion: "reduce", timezoneId: "UTC",
    isMobile: width <= 390, hasTouch: width <= 768, acceptDownloads: true, ignoreHTTPSErrors: false,
  });
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === base && ["GET", "HEAD"].includes(request.method()) && !url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname !== "/cdn-cgi/rum") blocked.push({ origin: url.origin, path: url.pathname, method: request.method() });
    return route.abort();
  });
  const page = await context.newPage(); lastPage = page; page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push({ language, width, message: error.message }));
  page.on("response", response => { if (response.status() >= 400 && response.url().startsWith(base)) failed.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await go(page, "vocab-boost", ".vq-page-heading");
  const p = emptyProgress(); p.language = language; p.notes = "Earlier synthetic notebook, keep this.";
  p.completed["say-hello"] = { date: addDays(today, -7), firstCorrect: 1, total: 2, output: "Mi chiamo Lina.", supported: false, confidence: 2 };
  await seed(page, p); return { context, page, initial: p };
}

try {
  for (const language of ["en", "it"]) for (const width of [320, 390, 768, 1440]) {
    const { context, page } = await freshContext(language, width);
    assert.equal(await page.locator(".vq-xp-bubble strong").innerText(), "0");
    assert.equal(await page.locator(".vq-goal-ring strong").innerText(), "0/10");
    assert.equal(await page.locator(".vq-badge.is-earned").count(), 0);
    assert.ok((await page.locator(".vq-page-heading").innerText()).includes(language === "en" ? "Word Quest" : "Avventura lessicale"));
    await layout(page, `${language}-${width}-hub`); await shot(page, `${language}-${width}-hub`);
    if (width === 390 || width === 1440) await shot(page, `${language}-${width}-hub-full`, true);
    pass("Fresh challenge hub has zero earned progress and fits the viewport", language, width);
    await context.close();
  }

  // The narrowest and tablet layouts also handle real extremes from the list.
  const longestCue = vocabItems.reduce((a, b) => a.word.term.en.length > b.word.term.en.length ? a : b);
  const longestTarget = vocabItems.reduce((a, b) => a.answers[0].length > b.answers[0].length ? a : b);
  const accented = vocabPracticeItems.filter(item => item.answers[0].endsWith("è")).sort((a, b) => a.answers[0].length - b.answers[0].length)[0];
  for (const language of ["en", "it"]) for (const width of [320, 768]) {
    const { context, page, initial } = await freshContext(language, width);
    if (width === 768) await page.setViewportSize({ width, height: 500 });
    const t = (en, it) => language === "en" ? en : it;
    await seed(page, startVocabRound(initial, [longestCue], today, `long-cue-${language}-${width}`, true), "vocab-boost", "#vocab-answer");
    await layout(page, `${language}-${width}-long-cue`); await shot(page, `${language}-${width}-long-cue`);
    await seed(page, startVocabRound(initial, [longestTarget], today, `long-target-${language}-${width}`, true), "vocab-boost", "#vocab-answer");
    await page.getByRole("button", { name: t("Use tiles", "Usa le tessere"), exact: true }).click();
    await page.locator(".vq-tiles").waitFor();
    await layout(page, `${language}-${width}-long-tiles`); await shot(page, `${language}-${width}-long-tiles`);
    assert.equal(vocabularyJourney(await current(page), today, vocabPracticeItems).xp, 0);
    pass("The longest actual English cue and Italian tile target fit without awarding browsing points", language, width);
    await buildTiles(page, longestTarget.answers[0]); await page.locator(".vocab-check").click();
    await page.locator(".vq-feedback.is-correct").waitFor();
    assert.equal((await current(page)).vocabPractice.records[longestTarget.id].last.assisted, true);
    await layout(page, `${language}-${width}-long-feedback`); await shot(page, `${language}-${width}-long-feedback`);
    if (width === 320) {
      assert.ok(accented);
      await seed(page, startVocabRound(initial, [accented], today, `accent-${language}`, true), "vocab-boost", "#vocab-answer");
      await page.locator("#vocab-answer").fill(accented.answers[0].slice(0, -1));
      await page.getByRole("button", { name: t("Insert è", "Inserisci è"), exact: true }).click();
      assert.equal(await page.locator("#vocab-answer").inputValue(), accented.answers[0]);
      await page.locator(".vocab-check").click(); await page.locator(".vq-feedback.is-correct").waitFor();
      assert.equal((await current(page)).vocabPractice.records[accented.id].last.assisted, false);
      await layout(page, `${language}-${width}-accent-feedback`);
      pass("The accent key inserts meaningful è without pretending keyboard assistance is a spelling hint", language, width);
    }
    await context.close();
  }

  if (!layoutOnly) for (const language of ["en", "it"]) for (const width of [390, 1440]) {
    const { context, page, initial } = await freshContext(language, width);
    const t = (en, it) => language === "en" ? en : it;
    await page.locator(".vq-challenge-card").filter({ has: page.getByText(t("Quick five", "Cinque al volo"), { exact: true }) }).click();
    await page.locator("#vocab-answer").waitFor();
    let p = await current(page); const roundId = p.vocabPractice.active.id, ids = [...p.vocabPractice.active.itemIds];
    assert.equal(ids.length, 5); assert.equal(new Set(ids).size, 5);
    await layout(page, `${language}-${width}-question`); await shot(page, `${language}-${width}-question`);
    touchTargets.push({ language, width, controls: await page.locator(".vq-close-round,.vocab-check,.vq-accent-keys button").evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { text: element.getAttribute("aria-label") || element.textContent.trim(), width: r.width, height: r.height }; })) });

    // A first mistake remains visible and survives a reload.
    await submit(page, "not an Italian answer");
    await page.reload(); await page.locator(".vq-feedback.needs-practice").waitFor();
    p = await current(page); assert.equal(p.vocabPractice.records[ids[0]].first.correct, false);
    assert.equal(p.vocabPractice.records[ids[0]].due, addDays(today, 1));
    assert.ok(await page.locator(".vocab-your-answer").isVisible());
    await layout(page, `${language}-${width}-wrong-feedback`); await shot(page, `${language}-${width}-wrong-feedback`);
    await next(page, false, true);

    // The next draft survives both a reload and a deliberate pause on the hub.
    let item = await actualItem(page); const answer = item.answers[0];
    await page.locator("#vocab-answer").fill(answer); await page.reload(); await page.locator("#vocab-answer").waitFor();
    assert.equal(await page.locator("#vocab-answer").inputValue(), answer);
    await page.getByRole("button", { name: t("Pause and save challenge", "Metti in pausa e salva la sfida"), exact: true }).click();
    await page.locator(".vq-page-heading").waitFor(); await page.reload(); await page.locator(".vq-page-heading").waitFor();
    p = await current(page); assert.equal(p.vocabPractice.active.id, roundId); assert.equal(p.vocabPractice.active.draft, answer);
    await layout(page, `${language}-${width}-paused-hub`);
    await page.getByRole("button", { name: t("Continue challenge", "Continua la sfida"), exact: true }).click();
    await page.locator("#vocab-answer").waitFor(); assert.equal(await page.locator("#vocab-answer").inputValue(), answer);
    await submit(page, answer); p = await current(page); assert.equal(p.vocabPractice.records[ids[1]].last.assisted, false);
    await page.reload(); await page.locator(".vq-feedback.is-correct").waitFor();
    assert.ok(await page.locator(".vq-feedback").evaluate(element => element === document.activeElement), "Feedback receives keyboard focus after reload");
    await next(page);
    pass("Wrong feedback, draft reload, pause/resume and independent recall preserve the same challenge", language, width);

    // A written hint and answer tiles both leave durable support evidence.
    item = await actualItem(page);
    await page.getByRole("button", { name: t("A little hint", "Un piccolo indizio"), exact: true }).click();
    await page.locator(".vq-hint").waitFor(); await page.reload(); await page.locator(".vq-hint").waitFor();
    await submit(page, item.answers[0]); p = await current(page);
    assert.equal(p.vocabPractice.records[ids[2]].last.assisted, true); await next(page);
    item = await actualItem(page);
    await page.getByRole("button", { name: t("Use tiles", "Usa le tessere"), exact: true }).click();
    await page.locator(".vq-tiles").waitFor();
    assert.equal(await page.locator("#vocab-answer").getAttribute("readonly"), "");
    assert.ok((await current(page)).vocabPractice.active.hints.includes(item.id));
    await layout(page, `${language}-${width}-tiles`); await shot(page, `${language}-${width}-tiles`);
    await buildTiles(page, item.answers[0]);
    await page.locator(".vocab-check").click(); await page.locator(".vq-feedback.is-correct").waitFor();
    assert.equal((await current(page)).vocabPractice.records[ids[3]].last.assisted, true);
    await next(page); item = await actualItem(page); await submit(page, item.answers[0]); await next(page, true);
    p = await current(page); const firstHistory = p.vocabPractice.history.find(round => round.id === roundId);
    assert.deepEqual([firstHistory.total, firstHistory.independent, firstHistory.supported], [5, 2, 2]);
    assert.equal(p.vocabPractice.active, null); assert.equal(vocabularyJourney(p, today, vocabPracticeItems).xp, 10);
    assert.equal(await page.locator(".vq-finish-goal progress").getAttribute("value"), "0.5");
    await layout(page, `${language}-${width}-finish`); await shot(page, `${language}-${width}-finish`);
    pass("A five-word challenge records one mistake, two independent answers and two supported answers honestly", language, width);

    // A retry repairs recall without deleting the first mistake or buying XP twice.
    await page.getByRole("button", { name: t("Give tricky words another go", "Riprova le parole difficili"), exact: true }).click();
    await page.locator("#vocab-answer").waitFor(); const retryIds = (await current(page)).vocabPractice.active.itemIds;
    assert.deepEqual(new Set(retryIds), new Set([ids[0], ids[2], ids[3]]));
    for (let index = 0; index < retryIds.length; index++) { item = await actualItem(page); await submit(page, item.answers[0]); await next(page, index === retryIds.length - 1); }
    p = await current(page); assert.equal(p.vocabPractice.records[ids[0]].first.correct, false);
    assert.equal(vocabularyJourney(p, today, vocabPracticeItems).xp, 10);
    assert.equal(vocabularyJourney(p, today, vocabPracticeItems).todayAnswered, 5);
    await page.getByRole("button", { name: t("Back to my challenges", "Torna alle mie sfide"), exact: true }).click();
    await page.locator(".vq-page-heading").waitFor();
    assert.equal(await page.locator(".vq-xp-bubble strong").innerText(), "10");
    assert.equal(await page.locator(".vq-goal-ring strong").innerText(), "5/10");
    assert.ok(await page.locator(".vq-badge").first().evaluate(element => element.classList.contains("is-earned")));
    pass("Tricky-word repair keeps first evidence, unique-word XP and the daily goal intact", language, width);

    // New CSV vocabulary is discoverable, saveable and directly challengeable.
    const candidates = vocabItems.filter(candidate => candidate.word.provenance === "course-list" && !p.vocabPractice.records[candidate.id]);
    const csvItem = candidates.find(candidate => candidate.word.term.it === "attico") ?? candidates[0]; assert.ok(csvItem);
    await page.locator(".vq-view-nav").getByRole("button", { name: t("All words", "Tutte le parole"), exact: true }).click();
    await page.locator("#word-search").waitFor(); await page.locator("#word-search").fill(csvItem.word.term.it);
    const card = page.locator(`[data-word-id="${csvItem.id}"]`); await card.waitFor();
    await card.getByRole("button", { name: t("View word", "Vedi parola"), exact: true }).click();
    await card.locator(".collection-details").waitFor(); await page.reload(); await card.locator(".collection-details").waitFor();
    assert.equal(await card.locator("blockquote p[lang=it]").count(), 0, "Translation-only entries do not invent a sentence");
    const xpBeforeSave = vocabularyJourney(await current(page), today, vocabPracticeItems).xp;
    await card.locator(".word-save").click(); p = await current(page);
    assert.equal(p.academy.words[wordKey(csvItem.word.term)].starred, true);
    assert.equal(vocabularyJourney(p, today, vocabPracticeItems).xp, xpBeforeSave);
    await layout(page, `${language}-${width}-csv-word`); await shot(page, `${language}-${width}-csv-word`);
    await card.getByRole("button", { name: t("Challenge this word", "Sfida questa parola"), exact: false }).click();
    await page.locator("#vocab-answer").waitFor(); assert.equal((await actualItem(page)).id, csvItem.id);
    await submit(page, csvItem.answers[0]); await next(page, true);
    p = await current(page); assert.equal(p.vocabPractice.records[csvItem.id].due, addDays(today, 1));
    assert.equal(vocabularyJourney(p, today, vocabPracticeItems).xp, 12);
    pass(`CSV word “${csvItem.word.term.it}” can be found, saved without XP, and practised from its details`, language, width);

    // Backdate only isolated synthetic evidence to verify the shared due queue.
    p.vocabPractice.records[csvItem.id].date = addDays(today, -1); p.vocabPractice.records[csvItem.id].due = today;
    await seed(page, p, "reviews", ".review-next");
    assert.equal(await page.locator(".review-next h2").innerText(), csvItem.word.term.en);
    await page.locator(".review-next").getByRole("button", { name: t("Start this review", "Inizia questo ripasso"), exact: false }).click();
    await page.locator(".vq-scheduled").waitFor();
    await page.locator(".vq-scheduled").getByRole("button", { name: t("Start this review", "Inizia questo ripasso"), exact: true }).click();
    await page.locator("#vocab-answer").waitFor(); assert.equal((await actualItem(page)).id, csvItem.id);
    await submit(page, csvItem.answers[0]); await next(page, true);
    p = await current(page); assert.equal(p.vocabPractice.records[csvItem.id].due, addDays(today, 3));
    assert.equal(vocabularyJourney(p, today, vocabPracticeItems).xp, 12);
    await go(page, "reviews", ".review-hub");
    assert.equal(await page.locator(".review-item").count(), 0);
    pass("The new CSV word joins shared scheduled recall and advances spacing without duplicate XP", language, width);

    await go(page, "progress", ".reflection textarea");
    const downloadPending = page.waitForEvent("download");
    await page.getByRole("button", { name: t("Export progress", "Esporta progressi"), exact: true }).click();
    const download = await downloadPending, filename = path.join(output, `${language}-${width}-synthetic-backup.json`);
    await download.saveAs(filename);
    const backup = parseProgress(await fs.readFile(filename, "utf8"), missionIds);
    assert.equal(backup.vocabPractice.records[csvItem.id].last.correct, true);
    assert.equal(backup.vocabPractice.records[ids[0]].first.correct, false);
    assert.deepEqual(backup.completed, initial.completed); assert.equal(backup.notes, initial.notes);
    assert.equal(backup.academy.words[wordKey(csvItem.word.term)].starred, true);
    pass("A real backup export preserves new word evidence, the first mistake, saved words and earlier work", language, width);
    await context.close();
  }
  assert.equal(errors.length, 0, "No application JavaScript errors");
  assert.equal(failed.length, 0, "No failed application assets");
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  console.error(failure);
  try { if (lastPage && !lastPage.isClosed()) await shot(lastPage, "failure"); } catch { /* Preserve the actual failure. */ }
} finally {
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify({
    testedAt: new Date().toISOString(), base, mode: layoutOnly ? "layouts" : "complete journey", passed: !failure, checks, layouts, screenshots, touchTargets, errors, failed, blocked,
    limitations: [
      "Isolated synthetic Chromium profiles, not physical devices or a human learning-outcome study.",
      "Scheduled recall uses explicitly backdated synthetic answer evidence; automated tests verify real-date scheduling.",
      "Device speech is not treated as a recording-quality test. API calls are blocked; no real profiles or learner records are read.",
    ], ...(failure ? { failure } : {}),
  }, null, 2) + "\n");
  await browser.close();
}
if (failure) process.exitCode = 1;
