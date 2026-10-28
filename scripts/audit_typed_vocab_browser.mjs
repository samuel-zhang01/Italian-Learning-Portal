import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { emptyProgress, parseProgress, dayKey, addDays } from "../app/learning/engine.ts";
import { emptyArcade, startArcadeRound } from "../app/learning/arcade-engine.ts";
import { arcadeItems } from "../app/learning/arcade-catalogue.ts";
import { emptyVocabPractice, startVocabRound } from "../app/learning/vocab-engine.ts";
import { vocabBanks, vocabItems, vocabItemById } from "../app/learning/vocab-catalogue.ts";
import curriculum from "../app/learning/curriculum.json" with { type: "json" };

const base = (process.env.PARLIAMO_URL || "http://127.0.0.1:5197").replace(/\/+$/, "");
const output = process.env.TYPED_VOCAB_REPORT_DIR || "work/typed-vocab-ui-audit/final";
const target = new URL(base);
assert.ok(["127.0.0.1", "localhost", "italian.samuelzhang.co.uk"].includes(target.hostname));
assert.ok(!target.username && !target.password && !target.search && !target.hash);
const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(`${extension}/node_modules/playwright-core/index.mjs`).href);
const config = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true, args: config.allowNoSandbox ? ["--no-sandbox"] : [] });
const checks = [], layouts = [], screenshots = [], errors = [], blocked = [];
const today = dayKey(), ids = curriculum.missions.map(m => m.id);
let phase = "initialisation", activePage;
const contexts = [];
const pass = (id, name) => { checks.push({ id, name }); console.log("PASS", id, name); };
const state = page => page.evaluate(() => JSON.parse(localStorage.getItem("parliamo-daily-v1")));
const ready = async (page, selector) => { await page.locator(selector).first().waitFor({ state: "visible" }); };
const go = async (page, route, selector) => { await page.evaluate(route => { location.hash = route; }, route); await ready(page, selector); };
const make = async (width = 390, height = 844) => {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" }); contexts.push(context);
  // This audit uses browser-local synthetic progress only and cannot mutate the profile service.
  await context.route("**/api/profile/**", route => { blocked.push({ path: new URL(route.request().url()).pathname, method: route.request().method() }); return route.abort(); });
  const page = await context.newPage(); activePage = page;
  page.on("pageerror", error => errors.push({ name: error.name, message: error.message.slice(0, 250) }));
  await page.goto(`${base}/#today`); await ready(page, ".today-workspace");
  return { context, page };
};
const seed = async (page, progress, route, selector) => {
  await page.evaluate(progress => { localStorage.setItem("parliamo-daily-v1", JSON.stringify(progress)); localStorage.removeItem("parliamo-profile-link-v1"); }, progress);
  await page.goto(`${base}/#${route}`); await page.reload(); await ready(page, selector);
};
const snap = async (page, name) => { await page.screenshot({ path: `${output}/${name}.png`, fullPage: true }); screenshots.push(`${name}.png`); };
const measure = async (page, detail) => {
  const values = await page.evaluate(() => {
    const bounds = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
    const visible = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden" && e.getClientRects().length > 0; };
    const controls = [...document.querySelectorAll('main button,main select,main input:not([type="radio"]):not([type="checkbox"]),main textarea,main summary')].filter(visible);
    const primary = [...document.querySelectorAll("main .button.primary")].find(visible);
    const clipping = [...document.querySelectorAll("main h1,main h2,main p,main label,main button")].filter(visible).filter(e => { const s = getComputedStyle(e); return /hidden|clip/.test(s.overflowX + " " + s.overflowY) && (e.scrollWidth > e.clientWidth + 2 || e.scrollHeight > e.clientHeight + 2); }).map(e => ({ text: e.textContent?.trim().slice(0, 80), rect: bounds(e), className: e.className }));
    return { viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth - innerWidth, headerHeight: document.querySelector(".daily-header")?.getBoundingClientRect().height, primary: primary ? { text: primary.textContent.trim(), ...bounds(primary) } : null,
      undersized: controls.filter(e => e.getBoundingClientRect().height < 43.5).map(e => ({ tag: e.tagName, text: e.textContent?.trim().slice(0, 60), ...bounds(e) })), clipping,
      fields: controls.filter(e => ["INPUT", "SELECT", "TEXTAREA"].includes(e.tagName)).map(e => ({ fontSize: getComputedStyle(e).fontSize, padding: getComputedStyle(e).padding, ...bounds(e) })) };
  });
  layouts.push({ ...detail, ...values }); return values;
};
const feedback = page => page.locator(".vocab-feedback");
const answer = async (page, word, typed = word.answers[0]) => { await page.locator("#vocab-answer").fill(typed); await page.locator(".vocab-check").click(); await ready(page, ".vocab-feedback"); };
const activeItem = async page => { const p = await state(page); return vocabItemById.get(p.vocabPractice.active.itemIds[p.vocabPractice.active.index]); };
try {
  await fs.mkdir(output, { recursive: true });
  const { page } = await make();
  phase = "practice-entry";
  await page.locator('.daily-header nav').getByRole("button", { name: "Practice", exact: true }).click();
  await ready(page, ".practice-hub");
  assert.equal(await page.locator(".practice-hub-card").count(), 3);
  await page.getByRole("button", { name: /Type 5 words/ }).click(); await ready(page, ".vocab-start");
  const initial = await measure(page, { language: "en", route: "vocab-lobby-entry", group: "journey" });
  assert.ok(initial.primary.bottom <= 844, "Start action should fit the initial 390px viewport");
  await page.locator(".vocab-start").click(); await ready(page, "#vocab-answer");
  assert.equal(await page.locator(".vocab-question").count(), 1);
  assert.equal(await page.locator(".arcade-option").count(), 0);
  assert.equal((await state(page)).vocabPractice.active.support, "recall");
  pass("entry", "Practice presents connected vocabulary, verbs and grammar; vocabulary opens directly in typing mode");

  phase = "feedback-and-first-attempts";
  const first = await activeItem(page);
  await answer(page, first, "sbagliato");
  assert.ok((await feedback(page).innerText()).includes("Let’s remember this one."));
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("vocab-feedback")), true);
  assert.equal((await state(page)).vocabPractice.records[first.id].first.correct, false);
  await page.getByRole("button", { name: /Save to my word bank/ }).click();
  assert.equal(await page.getByRole("button", { name: /In my word bank/ }).getAttribute("aria-pressed"), "true");
  await page.locator(".vocab-next").click(); await ready(page, "#vocab-answer");
  const second = await activeItem(page);
  await page.getByRole("button", { name: "Give me a hint", exact: true }).click();
  await page.reload(); await ready(page, ".vocab-hint");
  await answer(page, second);
  assert.ok((await feedback(page).innerText()).includes("You got it with help."));
  assert.equal((await state(page)).vocabPractice.records[second.id].first.assisted, true);
  await page.locator(".vocab-next").click(); await ready(page, "#vocab-answer");
  const third = await activeItem(page);
  await page.locator("#vocab-answer").fill("bozza"); await page.reload(); await ready(page, "#vocab-answer");
  assert.equal(await page.locator("#vocab-answer").inputValue(), "bozza");
  await page.getByRole("button", { name: /Pause & save/ }).click(); await ready(page, ".practice-hub");
  await page.getByRole("button", { name: /Resume my words/ }).click(); await ready(page, "#vocab-answer");
  assert.equal(await page.locator("#vocab-answer").inputValue(), "bozza");
  await answer(page, third);
  while (!(await page.locator(".vocab-next").innerText()).includes("Finish round")) { await page.locator(".vocab-next").click(); await ready(page, "#vocab-answer"); await answer(page, await activeItem(page)); }
  await page.locator(".vocab-next").click(); await ready(page, ".vocab-finish");
  assert.ok((await page.locator(".vocab-finish").innerText()).includes("3 of 5 recalled without hints."));
  const completed = await state(page); assert.equal(completed.vocabPractice.history.at(-1).supported, 1);
  assert.equal(completed.vocabPractice.records[first.id].first.correct, false);
  parseProgress(JSON.stringify(completed), ids);
  pass("learning", "Wrong and hinted answers remain honest; drafts/hints survive reload and pause; completion offers a clear stopping point");

  phase = "independent-games";
  const fixture = emptyProgress(); fixture.arcade = emptyArcade();
  const game = startArcadeRound(fixture, arcadeItems.filter(item => item.mode === "words").slice(0, 5), today, "audit-unrelated-game");
  game.arcade.active.draft = "separate game draft";
  const separate = startVocabRound(game, [first], today, "audit-vocabulary");
  await seed(page, separate, "vocab-boost", "#vocab-answer");
  await page.locator("#vocab-answer").fill("vocabulary draft");
  await page.getByRole("button", { name: /Pause & save/ }).click(); await ready(page, ".practice-hub");
  await page.getByRole("button", { name: "Other games", exact: true }).click(); await ready(page, ".arcade-question");
  assert.equal((await state(page)).arcade.active.draft, "separate game draft");
  await go(page, "vocab-boost", "#vocab-answer");
  assert.equal(await page.locator("#vocab-answer").inputValue(), "vocabulary draft");
  assert.equal((await state(page)).arcade.active.id, "audit-unrelated-game");
  pass("separate", "Vocabulary and Games retain independent unfinished rounds and typed answers");

  phase = "library-and-links";
  await seed(page, emptyProgress(), "vocab-boost", ".vocab-start");
  assert.ok(vocabItems.length >= 700, "Expanded typed vocabulary should have at least 700 original/course entries");
  assert.equal(await page.locator(".vocab-topic-card").count(), 6);
  await page.locator("#vocab-search").fill(first.word.term.it);
  assert.ok(await page.locator(".vocab-topic-card").count() > 0);
  await page.reload(); await ready(page, "#vocab-search");
  assert.equal(await page.locator("#vocab-search").inputValue(), first.word.term.it);
  await page.locator("#vocab-search").fill("zzznomatch");
  await page.getByText("No match yet. Try an English or Italian word.", { exact: true }).waitFor();
  await page.locator("#vocab-search").fill("");
  await page.getByRole("button", { name: "Show more topics", exact: true }).click();
  assert.equal(await page.locator(".vocab-topic-card").count(), 12);
  const bank = vocabBanks[0]; await page.locator("#vocab-topic").selectOption(bank.id);
  await page.getByRole("button", { name: "Learn with vocabulary cards", exact: true }).click(); await ready(page, ".vocabulary-topic-heading");
  assert.equal((await page.locator(".vocabulary-topic-heading").innerText()).trim(), bank.title.en);
  await seed(page, completed, "words", ".word-review");
  assert.equal((await page.locator(".word-review h2").innerText()).trim(), first.word.term.en);
  await page.getByRole("button", { name: "Reveal my word", exact: true }).click();
  assert.equal((await page.locator(".word-review h3").innerText()).trim(), first.word.term.it);
  await page.getByRole("button", { name: /Type my saved words/ }).click(); await ready(page, ".vocab-start");
  assert.equal(await page.locator("#vocab-topic").inputValue(), "saved");
  await page.locator(".vocab-start").click(); await ready(page, "#vocab-answer");
  assert.deepEqual((await state(page)).vocabPractice.active.itemIds, [first.id]);
  await seed(page, emptyProgress(), `discover?q=${encodeURIComponent(first.word.term.it)}`, ".discovery-results");
  const foundBank = vocabBanks.find(item => item.id === first.bankId);
  await page.locator(".discovery-card").filter({ hasText: foundBank.title.en }).getByRole("button").click(); await ready(page, ".vocab-start");
  assert.equal(await page.locator("#vocab-topic").inputValue(), foundBank.id);
  pass("library", "The expanded library is searchable and paged; new topics open matching cards and saved words appear in the shared word bank");

  phase = "saved-grammar-word";
  await seed(page, emptyProgress(), "grammar/avere", ".academy-word-list");
  await page.getByRole("button", { name: "Save word: fame / avere fame", exact: true }).click();
  await page.getByRole("button", { name: /Review my saved words/ }).click(); await ready(page, ".word-review");
  assert.equal(await page.locator(".vocabulary-grid article:visible").count(), 0, "The additional catalogue starts collapsed");
  await page.getByRole("button", { name: /Type my saved words/ }).click(); await ready(page, ".vocab-start");
  await page.locator(".vocab-start").click(); await ready(page, "#vocab-answer");
  assert.deepEqual((await state(page)).vocabPractice.active.itemIds, ["grammar-word:avere:0"]);
  await answer(page, vocabItemById.get("grammar-word:avere:0"), "avere fame");
  assert.equal((await state(page)).vocabPractice.records["grammar-word:avere:0"].first.correct, true);
  pass("grammar-word", "Saving a grammar-only expression leads to a typed round accepting one valid form, with the extra word catalogue collapsed");

  phase = "shared-review";
  const due = emptyProgress(); due.vocabPractice = emptyVocabPractice();
  due.vocabPractice.records[first.id] = { ...completed.vocabPractice.records[first.id], date: addDays(today, -1), due: today };
  await seed(page, due, "reviews", ".review-next");
  await page.getByRole("button", { name: /Start this review/ }).click(); await ready(page, ".vocab-launch");
  assert.ok(page.url().includes("vocab-boost?review="));
  await page.getByRole("button", { name: "Type this review", exact: true }).click(); await ready(page, "#vocab-answer");
  assert.equal((await state(page)).vocabPractice.active.itemIds[0], first.id);
  await answer(page, first);
  assert.equal((await state(page)).vocabPractice.records[first.id].first.correct, false);
  pass("review", "The shared review queue opens the scheduled typed word and retains its original first attempt");

  phase = "keyboard";
  await seed(page, emptyProgress(), "vocab-boost", ".vocab-start");
  for (let i = 0; i < 24 && await page.evaluate(() => !document.activeElement?.classList.contains("vocab-start")); i++) await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("vocab-start")), true);
  assert.notEqual(await page.locator(".vocab-start").evaluate(e => getComputedStyle(e).outlineStyle), "none");
  await page.keyboard.press("Enter"); await ready(page, "#vocab-answer");
  const typed = startVocabRound(emptyProgress(), [first, second], today, "audit-keyboard");
  await seed(page, typed, "vocab-boost", "#vocab-answer");
  for (let i = 0; i < 12 && await page.evaluate(() => document.activeElement?.id !== "vocab-answer"); i++) await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "vocab-answer");
  const keyboardWord = await activeItem(page); await page.keyboard.type(keyboardWord.answers[0]); await page.keyboard.press("Enter"); await ready(page, ".vocab-feedback");
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("vocab-feedback")), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("vocab-next")), true);
  assert.notEqual(await page.locator(".vocab-next").evaluate(e => getComputedStyle(e).outlineStyle), "none");
  await page.keyboard.press("Enter"); await ready(page, "#vocab-answer");
  assert.equal((await state(page)).vocabPractice.active.index, 1);
  pass("keyboard", "Keyboard-only answering and continuation work, with focused feedback and a visible focus outline");

  phase = "supported-answer";
  await seed(page, startVocabRound(emptyProgress(), [first], today, "audit-supported-answer"), "vocab-boost", "#vocab-answer");
  await page.locator("#vocab-answer").fill("caff");
  await page.locator(".vocab-accents summary").click();
  await page.getByRole("button", { name: "Insert è", exact: true }).click();
  assert.equal(await page.locator("#vocab-answer").inputValue(), "caffè");
  await page.getByRole("button", { name: "Show the answer", exact: true }).click(); await ready(page, ".vocab-feedback");
  const supportedRecord = (await state(page)).vocabPractice.records[first.id];
  assert.equal(supportedRecord.first.assisted, true); assert.equal(supportedRecord.first.correct, false);
  await page.locator(".vocab-example summary").click();
  assert.ok((await page.locator(".vocab-example").innerText()).includes(first.word.example.it));
  await page.locator(".vocab-next").click(); await ready(page, ".vocab-finish");
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "H1");
  pass("support", "Accent keys insert correctly; Show the answer records support without independent credit; completion receives focus");

  phase = "profile-mismatch-focus";
  const { page: profilePage } = await make(390, 390);
  await go(profilePage, "profile", ".profile-page");
  const temporaryPin = Array.from(crypto.getRandomValues(new Uint8Array(6)), value => String(value % 10)).join("");
  await profilePage.locator('[name="pin"]').fill(temporaryPin);
  for (const offset of [1, 2]) {
    const differentPin = String((Number(temporaryPin[0]) + offset) % 10) + temporaryPin.slice(1);
    await profilePage.locator('[name="pin-confirmation"]').fill(differentPin);
    await profilePage.getByRole("button", { name: "Create my profile", exact: true }).click();
    await profilePage.getByRole("alert").filter({ hasText: "The two PINs do not match." }).waitFor();
    await profilePage.waitForFunction(() => document.activeElement?.getAttribute("role") === "alert");
    const alert = await profilePage.getByRole("alert").boundingBox();
    assert.ok(alert.y >= 0 && alert.y + alert.height <= 392);
  }
  pass("profile-error", "Initial and repeated local PIN mismatches focus a visible alert in a short viewport without contacting the profile service");

  phase = "layout-matrix";
  const longWord = [...vocabItems].sort((a, b) => b.word.term.en.length - a.word.term.en.length)[0];
  for (const language of ["en", "it"]) for (const [width, height] of [[320, 700], [360, 800], [390, 844], [768, 1024], [1440, 1000], [844, 390]]) {
    const { context, page: layoutPage } = await make(width, height); const p = { ...emptyProgress(), language };
    const layoutRoutes = [["today", ".today-workspace"], ["practice", ".practice-hub"], ["vocab-boost", ".vocab-start"], ["grammar", ".academy"], ["grammar/past-avere", ".academy-unit-heading"], ["games", ".arcade"], ["vocabulary", ".vocabulary-topic-heading"], ["words", ".word-review"], ["profile", ".profile-page"]];
    await seed(layoutPage, p, "today", ".today-workspace");
    for (const [route, selector] of layoutRoutes) {
      await go(layoutPage, route, selector);
      await measure(layoutPage, { language, width, height, route, group: "matrix" });
      if (["practice", "vocab-boost"].includes(route) && [320, 390, 1440].includes(width)) await snap(layoutPage, `${language}-${width}-${route}`);
    }
    const round = startVocabRound(p, [longWord], today, `layout-${language}-${width}`);
    await seed(layoutPage, round, "vocab-boost", "#vocab-answer");
    await measure(layoutPage, { language, width, height, route: "vocab-question", group: "matrix" });
    await layoutPage.locator("#vocab-answer").fill("una risposta sbagliata");
    await layoutPage.locator(".vocab-check").click(); await ready(layoutPage, ".vocab-feedback");
    await measure(layoutPage, { language, width, height, route: "vocab-feedback", group: "matrix" });
    if ([320, 390, 1440, 844].includes(width)) await snap(layoutPage, `${language}-${width}-feedback`);
    await layoutPage.locator(".vocab-next").click(); await ready(layoutPage, ".vocab-finish");
    await measure(layoutPage, { language, width, height, route: "vocab-finish", group: "matrix" });
    await context.close();
  }
  assert.equal(layouts.filter(row => row.group === "matrix" && row.overflow > 1).length, 0, "No page horizontal overflow in the matrix");
  assert.equal(layouts.filter(row => row.group === "matrix" && row.clipping.length).length, 0, "No text/controls clipped in the matrix");
  assert.equal(layouts.filter(row => row.group === "matrix" && row.undersized.length).length, 0, "Visible measured controls have 44px targets");
  pass("layouts", "EN/IT routes, questions, feedback and completion fit portrait, desktop and short landscape without overflow, clipping or undersized controls");

  phase = "reflow-and-keyboard-height";
  const { page: small } = await make(390, 844);
  await seed(small, startVocabRound(emptyProgress(), [longWord], today, "keyboard-height"), "vocab-boost", "#vocab-answer");
  await small.locator("#vocab-answer").focus(); await small.setViewportSize({ width: 390, height: 390 });
  await small.locator("#vocab-answer").fill(longWord.answers[0]);
  await small.locator(".vocab-check").scrollIntoViewIfNeeded(); await small.locator(".vocab-check").click(); await ready(small, ".vocab-feedback");
  await measure(small, { language: "en", route: "feedback-keyboard-height", group: "keyboard-height" });
  await small.locator(".vocab-next").scrollIntoViewIfNeeded(); await small.locator(".vocab-next").click(); await ready(small, ".vocab-finish");
  await snap(small, "keyboard-height-finish");
  const { page: zoom } = await make(1280, 900);
  await seed(zoom, emptyProgress(), "vocab-boost", ".vocab-start");
  await zoom.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await measure(zoom, { language: "en", route: "vocab-lobby-200-percent-css-zoom", group: "zoom" });
  await zoom.locator(".vocab-start").click(); await ready(zoom, "#vocab-answer");
  await zoom.locator("#vocab-answer").fill((await activeItem(zoom)).answers[0]); await zoom.locator(".vocab-check").click(); await ready(zoom, ".vocab-feedback");
  await measure(zoom, { language: "en", route: "vocab-feedback-200-percent-css-zoom", group: "zoom" });
  await snap(zoom, "zoom-200-percent-feedback");
  assert.equal(layouts.filter(row => ["zoom", "keyboard-height"].includes(row.group) && (row.overflow > 1 || row.clipping.length)).length, 0);
  pass("reflow", "200% CSS zoom and a reduced-height keyboard approximation remain scrollable and operable; no physical keyboard claim");
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  pass("runtime", "No uncaught browser errors or profile-service requests in the synthetic guest journeys");
  await fs.writeFile(`${output}/results.json`, JSON.stringify({ passed: true, testedAt: new Date().toISOString(), base, checks, layouts, screenshots, errors, blocked, vocabularyEntries: vocabItems.length, topics: vocabBanks.length, syntheticDataOnly: true, limitations: ["Headless Chromium, not physical iOS/Android hardware.", "CSS zoom/reflow and reduced-height viewport approximate magnification and an open keyboard.", "Profiles are not accessed; sync integration is covered separately."] }, null, 2) + "\n");
} catch (error) {
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await fs.writeFile(`${output}/failure.json`, JSON.stringify({ phase, error: error.message, checks, layouts, errors, blocked }, null, 2) + "\n");
  console.error(`Typed vocabulary audit failed at ${phase}: ${error.message}`); process.exitCode = 1;
} finally { for (const context of contexts) await context.close().catch(() => {}); await browser.close(); }
