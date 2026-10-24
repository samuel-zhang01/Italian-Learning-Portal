import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { emptyProgress, parseProgress, dayKey, dailyMinutes } from "../app/learning/engine.ts";
import { selectProgramme } from "../app/learning/academy-engine.ts";
import { dailyStudyPlan, emptySession, learningRewards } from "../app/learning/study.ts";
import { chapterConversationComplete } from "../app/learning/chapter-context.ts";
import { emptyArcade, startArcadeRound, answerArcade, nextArcadeItem, updateArcadeDraft } from "../app/learning/arcade-engine.ts";
import { arcadeItemById } from "../app/learning/arcade-catalogue.ts";

// Launch an owned browser. Never use a shared profile, CDP connection or learner data.
const root = process.cwd();
const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(path.join(extension, "node_modules/playwright-core/index.mjs")).href);
const config = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const appUrl = process.env.PARLIAMO_URL || "http://127.0.0.1:5197";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(appUrl).hostname), "Audit only a local preview");
const evidence = path.resolve(process.env.CHAPTER_AUDIT_DIR || "work/chapter-student-audit");
assert.ok(evidence.startsWith(`${path.join(root, "work")}${path.sep}`), "Screenshots belong in private work/");
execFileSync("git", ["check-ignore", "--quiet", "--", path.relative(root, path.join(evidence, "probe.png"))]);
const read = async (name) => JSON.parse(await fs.readFile(`app/learning/${name}.json`, "utf8"));
const [curriculum, grammar, enrichment, companion] = await Promise.all([read("curriculum"), read("grammar"), read("enrichment"), read("companion")]);
const ids = curriculum.missions.map((mission) => mission.id);
const programme = grammar.programmes.find((item) => item.id === "espresso-plus-a1-a2");
const mission = curriculum.missions.find((item) => item.id.startsWith("espresso2-u01-"));
const lesson = enrichment.lessons.find((item) => item.missionId === mission.id);
const today = dayKey();
const checks = [], fixtures = [], measurements = [], durationChecks = [], screenshots = [], runtimeErrors = [], networkMutations = [], externalRequests = [];
let browser, context, page, failure;
const pass = (label, detail = {}) => { checks.push({ label, ...detail }); console.log("PASS", label); };
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("parliamo-daily-v1")));
const button = (name) => page.getByRole("button", { name: new RegExp(`^(?:←\\s*)?${name.replace(/\s*→$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s*→)?$`), exact: true });
const waitFor = async (predicate, label) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await predicate()) return;
    await page.waitForTimeout(50);
  }
  assert.fail(label);
};
const go = async (route) => {
  await page.goto(`${appUrl}/#${route}`);
  await page.locator(".daily-header").waitFor();
};
const reload = async () => { await page.reload(); await page.locator(".daily-header").waitFor(); };
const seed = async (progress, route) => {
  parseProgress(JSON.stringify(progress), ids);
  await page.evaluate((value) => localStorage.setItem("parliamo-daily-v1", JSON.stringify(value)), progress);
  await go(route);
  await reload();
};
const fixture = (selected = mission, language = "en") => {
  const progress = selectProgramme(emptyProgress(), programme.id, today);
  progress.language = language;
  progress.translations = true;
  progress.plan.minutes = 60;
  progress.plan.course = 3;
  const day = programme.days.findIndex((item) => item.missionIds.includes(selected.id));
  assert.ok(day >= 0);
  progress.academy.programme.day = day;
  fixtures.push({ missionId: selected.id, programme: programme.id, studyDay: day + 1, language,
    purpose: "Validated synthetic learner placed at a chapter application day; no real progress or prerequisite completions are read" });
  return progress;
};
const stage = async (key, language = "en") => {
  const names = {
    vocab: language === "en" ? "Vocabulary quest" : "Missione lessico",
    input: language === "en" ? "Listen, read, notice" : "Ascolta, leggi, osserva",
    speak: language === "en" ? "Your little conversation" : "La tua piccola conversazione",
  };
  await page.locator(".session-stages button").filter({ hasText: names[key] }).click();
};
const openRetell = async () => {
  const details = page.locator(".chapter-retell");
  if (await details.getAttribute("open") === null) await details.locator(":scope > summary").click();
  return details;
};
const screenshot = async (name) => {
  const file = `${name}.png`;
  await page.screenshot({ path: path.join(evidence, file), fullPage: true });
  screenshots.push(path.relative(root, path.join(evidence, file)));
};
const layout = async (name, language, width) => {
  const result = await page.evaluate(() => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth,
    title: document.querySelector("main h1")?.textContent,
    overflowingControls: [...document.querySelectorAll("main button,main input,main textarea,main select")]
      .filter((node) => node.getClientRects().length && (() => {
        const box = node.getBoundingClientRect(); return box.left < -2 || box.right > innerWidth + 2;
      })()).map((node) => node.tagName),
  }));
  measurements.push({ name, language, width, ...result });
  assert.ok(result.document <= result.viewport + 1, `${name}/${language}/${width}: horizontal page overflow`);
  assert.deepEqual(result.overflowingControls, [], `${name}/${language}/${width}: controls overflow`);
  await screenshot(`${language}-${width}-${name}`);
};
const answerCurrent = async (wrong = false) => {
  const progress = await state();
  const item = arcadeItemById.get(progress.arcade.active.itemIds[progress.arcade.active.index]);
  const answer = wrong ? item.options.find((option) => !item.answers.includes(option)) : item.answers[0];
  await page.locator(".arcade-option").filter({ hasText: new RegExp(`^${answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).click();
  await page.locator(".arcade-feedback").waitFor();
  return item;
};

try {
  await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
    headless: true, args: config.allowNoSandbox ? ["--no-sandbox"] : [],
  });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-GB", reducedMotion: "reduce" });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (!["GET", "HEAD"].includes(request.method())) {
      networkMutations.push({ method: request.method(), origin: url.origin });
      return route.abort();
    }
    if (url.origin !== new URL(appUrl).origin) { externalRequests.push(url.origin); return route.abort(); }
    return route.continue();
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });
  await go("today");

  await seed(fixture(), "session");
  assert.match(await page.locator(".session-page > .eyebrow").innerText(), /^A2/);
  await stage("vocab");
  const chapterBank = enrichment.banks.find((item) => item.id === "espresso2-u01");
  assert.ok((await page.locator(".session-activity").innerText()).includes(chapterBank.title.en));
  await button("Reveal the Italian").click();
  await button("I remembered it").click();
  await waitFor(async () => (await state()).sessions?.[today]?.bankId === chapterBank.id, "Fresh session did not pin chapter bank");
  assert.ok((await state()).sessions[today].recalled.includes("espresso2-u01:0"));
  pass("New A2 session displays the chapter bank and pins it on visible card practice");

  const legacy = fixture();
  legacy.sessions = { [today]: { ...emptySession(mission.id), recalled: ["clothes:0", "clothes:2"] } };
  delete legacy.sessions[today].bankId;
  await seed(legacy, "session");
  await stage("vocab");
  assert.ok((await page.locator(".session-activity").innerText()).includes(enrichment.banks.find((item) => item.id === "clothes").title.en));
  assert.match(await page.locator(".session-activity").innerText(), /saved session keeps the cards/);
  assert.equal(await page.locator(".word-dots button").filter({ hasText: "✓" }).count(), 2);
  await button("Reveal the Italian").click();
  await button("I remembered it").click();
  let progress = await state();
  assert.equal(progress.sessions[today].bankId, "clothes");
  assert.deepEqual([...progress.sessions[today].recalled].sort(), ["clothes:0", "clothes:1", "clothes:2"]);
  await reload(); await stage("vocab");
  assert.equal((await state()).sessions[today].bankId, "clothes");
  await screenshot("en-390-legacy-bank-preserved");
  pass("A started version-one session without bankId keeps its old bank, recalled cards and pinned bank after update/reload");

  await seed(fixture(), "session");
  await stage("input");
  const beforeOptional = { xp: learningRewards(await state()).xp, minutes: dailyMinutes(await state(), today) };
  await page.locator(".chapter-gist input").fill("nessuno");
  await button("Check the situation").click();
  await page.locator(".chapter-gist .feedback.incorrect").waitFor();
  await reload(); await stage("input");
  assert.equal(await page.locator(".chapter-gist input").inputValue(), "nessuno");
  await page.locator(".chapter-gist input").fill(lesson.skills.gist.answers[0]);
  await button("Check the situation").click();
  await page.locator(".chapter-gist .feedback.correct").waitFor();
  await reload(); await stage("input");
  assert.equal(await page.locator(".chapter-gist input").inputValue(), lesson.skills.gist.answers[0]);
  assert.equal(learningRewards(await state()).xp, beforeOptional.xp);
  pass("Optional gist supports a wrong attempt, correction and persisted drafts over reload without credit");

  await stage("speak");
  let retell = await openRetell();
  await retell.getByRole("textbox").fill(lesson.skills.retell.model.it);
  await retell.getByRole("checkbox").first().check();
  await reload(); await stage("speak"); retell = await openRetell();
  assert.equal(await retell.getByRole("textbox").inputValue(), lesson.skills.retell.model.it);
  assert.equal(await retell.getByRole("checkbox", { checked: true }).count(), 1);
  await retell.getByRole("checkbox").nth(1).check();
  assert.match(await retell.getByRole("status").innerText(), /Draft and self-checks saved/);
  await retell.getByRole("textbox").fill(`${lesson.skills.retell.model.it} Grazie.`);
  assert.equal(await retell.getByRole("checkbox", { checked: true }).count(), 0);
  await reload(); await stage("speak"); retell = await openRetell();
  assert.equal(await retell.getByRole("checkbox", { checked: true }).count(), 0);
  assert.ok((await retell.getByRole("textbox").inputValue()).endsWith("Grazie."));
  assert.equal(learningRewards(await state()).xp, beforeOptional.xp);
  assert.equal(dailyMinutes(await state(), today), beforeOptional.minutes);
  pass("Optional retell draft and criteria persist, edit resets both criteria, and no XP or minutes are added");

  await button("Chapter vocabulary →").click();
  await page.locator(".vocabulary-topic-heading").waitFor();
  assert.ok(page.url().endsWith("#vocabulary/espresso2-u01"));
  assert.equal(await page.locator(".vocabulary-topic-heading").innerText(), chapterBank.title.en);
  await waitFor(() => page.locator(".vocabulary-topic-heading").evaluate((node) => document.activeElement === node), "Chapter bank heading did not receive focus");
  await button("Practise in my daily session →").click();
  assert.ok(page.url().endsWith("#session"));
  assert.equal((await state()).sessions[today].missionId, mission.id);
  pass("Chapter vocabulary deep link selects and focuses its bank, then returns to the same session");

  await button("Try the A2 conversation →").click();
  await button("Let’s play").click();
  assert.equal((await state()).arcade.active.itemIds.length, 3);
  const first = await answerCurrent(true);
  assert.equal((await state()).arcade.records[first.id].first.correct, false);
  await reload();
  assert.equal((await state()).arcade.records[first.id].first.correct, false);
  await button("Next question →").click();
  await button("Show a hint").click();
  await reload();
  const hinted = await answerCurrent();
  assert.equal((await state()).arcade.records[hinted.id].first.assisted, true);
  await button("Next question →").click();
  await answerCurrent();
  await button("Finish round").click();
  progress = await state();
  assert.equal(progress.arcade.active, null);
  assert.equal(progress.arcade.history.at(-1).total, 3);
  assert.equal(progress.arcade.history.at(-1).independent, 1);
  assert.equal(progress.arcade.history.at(-1).supported, 1);
  assert.equal(chapterConversationComplete(progress, "espresso2-u01", today), false, "An uncorrected reply must remain due for repair");
  const xpBeforeRepair = learningRewards(progress).xp;
  await screenshot("en-390-a2-three-turn-round");
  await page.locator(".arcade-review > summary").click();
  await page.getByRole("button", { name: /^Replay mistakes & hints/ }).click();
  const repairCount = (await state()).arcade.active.itemIds.length;
  assert.equal(repairCount, 2);
  for (let index = 0; index < repairCount; index++) {
    await answerCurrent();
    await button(index === repairCount - 1 ? "Finish round" : "Next question").click();
  }
  progress = await state();
  assert.equal(chapterConversationComplete(progress, "espresso2-u01", today), true);
  assert.equal(learningRewards(progress).xp, xpBeforeRepair);
  await reload();
  assert.equal((await state()).arcade.records[first.id].first.correct, false);
  await screenshot("en-390-a2-conversation-completed");
  pass("Three A2 turns plus visible mistake repair complete the chapter extra; wrong-first/hint evidence survives reload without repeated XP");

  let unrelated = { ...fixture(), arcade: emptyArcade() };
  const unrelatedItems = ["word:survival:0", "word:survival:1"].map((id) => arcadeItemById.get(id));
  unrelated = startArcadeRound(unrelated, unrelatedItems, today, "chapter-audit-unrelated-round");
  unrelated = answerArcade(unrelated, unrelatedItems[0], unrelatedItems[0].answers[0], today);
  unrelated = nextArcadeItem(unrelated);
  unrelated = updateArcadeDraft(unrelated, "synthetic saved draft");
  const oldRound = structuredClone(unrelated.arcade.active);
  await seed(unrelated, "session");
  await button("Try the A2 conversation →").click();
  await page.locator(".arcade-playing").waitFor();
  assert.match(await page.locator("main").innerText(), /unfinished round/);
  assert.deepEqual((await state()).arcade.active, oldRound);
  await reload();
  assert.deepEqual((await state()).arcade.active, oldRound);
  await screenshot("en-390-existing-round-preserved");
  pass("Opening a chapter conversation intent preserves an unrelated active round, first answer, index and draft");

  for (const minutes of [5, 10, 15, 20, 30, 45, 60]) {
    for (const entry of ["today", "session"]) {
      const initial = selectProgramme(emptyProgress(), programme.id, today);
      initial.plan.minutes = minutes;
      const plan = dailyStudyPlan(initial, curriculum.missions, grammar.units, grammar.programmes, companion.pages, today);
      await seed(initial, entry);
      if (entry === "today") await button("Continue today").click();
      await page.locator(".session-page").waitFor();
      assert.match(await page.locator(".session-page > .eyebrow").innerText(), new RegExp(`ABOUT ${plan.duration} MINUTES`));
      if (await page.locator(".session-activity textarea").count()) {
        await page.locator(".session-activity textarea").first().fill("Ricordo una frase sintetica.");
      } else {
        await button("Open my core lesson").click();
      }
      const saved = await state();
      assert.equal(saved.sessions[today].duration, plan.duration);
      parseProgress(JSON.stringify(saved), ids);
      await reload();
      assert.equal((await state()).sessions[today].duration, plan.duration);
      parseProgress(JSON.stringify(await state()), ids);
      durationChecks.push({ dailyBudget: minutes, entry, expected: plan.duration, saved: saved.sessions[today].duration,
        plannedMinutes: plan.blocks.reduce((sum, block) => sum + block.minutes, 0), reloadValid: true });
    }
  }
  const legacyDuration = selectProgramme(emptyProgress(), programme.id, today);
  legacyDuration.plan.minutes = 60;
  legacyDuration.sessions = { [today]: emptySession(programme.days[0].missionIds[0], 15) };
  await seed(legacyDuration, "session");
  assert.match(await page.locator(".session-page > .eyebrow").innerText(), /ABOUT 15 MINUTES/);
  await page.locator(".session-activity textarea").first().fill("Conservo la durata già scelta.");
  await reload();
  assert.equal((await state()).sessions[today].duration, 15);
  parseProgress(JSON.stringify(await state()), ids);
  durationChecks.push({ dailyBudget: 60, entry: "legacy saved session", expected: 15, saved: 15, reloadValid: true });
  pass("All seven budgets match planned/session duration via Today and direct entry, reload as valid backups, and preserve an older 15-minute session", { browserCases: durationChecks.length });

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    const chapter = width === 320 ? "09" : width === 390 ? "01" : "10";
    const selected = curriculum.missions.find((item) => item.id.startsWith(`espresso2-u${chapter}-`));
    const extra = enrichment.lessons.find((item) => item.missionId === selected.id);
    for (const language of ["en", "it"]) {
      await seed(fixture(selected, language), "session");
      assert.match(await page.locator(".session-page > .eyebrow").innerText(), /^A2/);
      await stage("input", language);
      await page.locator(".scene > summary").click();
      await page.locator(".chapter-gist input").fill(extra.skills.gist.answers[0]);
      await button(language === "en" ? "Check the situation" : "Controlla la situazione").click();
      await page.locator(".chapter-gist .feedback.correct").waitFor();
      await layout("chapter-input", language, width);
      await stage("speak", language);
      retell = await openRetell();
      await retell.getByRole("textbox").fill(extra.skills.retell.model.it);
      for (const criterion of await retell.getByRole("checkbox").all()) await criterion.check();
      await layout("chapter-retell", language, width);
      await button(language === "en" ? "Chapter vocabulary →" : "Lessico del capitolo →").click();
      await page.locator(".vocabulary-topic-heading").waitFor();
      await waitFor(() => page.locator(".vocabulary-topic-heading").evaluate((node) => document.activeElement === node), "Responsive vocabulary heading focus failed");
      assert.ok(page.url().includes(`#vocabulary/espresso2-u${chapter}`));
      await layout("chapter-vocabulary", language, width);
      await button(language === "en" ? "Practise in my daily session →" : "Esercitati nella sessione quotidiana →").click();
      await button(language === "en" ? "Try the A2 conversation →" : "Prova la conversazione A2 →").click();
      await button(language === "en" ? "Let’s play" : "Giochiamo").click();
      assert.equal((await state()).arcade.active.itemIds.length, 3);
      await layout("chapter-conversation", language, width);
    }
  }
  pass("EN/IT input, retelling, chapter vocabulary and A2 conversation fit 320, 390 and 1440 pixel viewports", { layoutChecks: measurements.length });
  assert.deepEqual(runtimeErrors, []);
  assert.deepEqual(networkMutations, []);
  assert.deepEqual(externalRequests, []);
  pass("Disposable contexts produced no runtime errors, external requests or network mutations");
} catch (error) {
  failure = { name: error.name, message: error.message, location: error.stack?.split("\n").find((line) => line.includes("audit_chapter_browser.mjs"))?.trim() };
  console.error("FAIL", failure.location, error.message);
  if (page) await screenshot("failure").catch(() => {});
} finally {
  await context?.close();
  await browser?.close();
  const report = {
    generator: "scripts/audit_chapter_browser.mjs", reviewedOn: today,
    status: failure ? "failed" : "passed", preview: appUrl,
    method: "Owned headless Chromium and fresh disposable browser context. Browser View extension is used only to locate Playwright; no shared CDP connection, profile or learner state is accessed.",
    sandboxException: config.allowNoSandbox ? "Existing explicit browser-view allowNoSandbox configuration honoured for this isolated root-host test." : "Chromium sandbox enabled.",
    workflowGroupsPassed: checks.length, checks, measurements, durationChecks, screenshots, fixtures,
    runtimeErrors, networkMutations, externalRequests, failure,
    limits: ["Synthetic programme positions isolate chapter flows; this is not a human completion of all eighty days.",
      "Responsive layouts were tested at desktop-emulated viewport widths, not physical phones.",
      "Device speech audio quality and pronunciation were not assessed; public authored scenes and optional tasks were exercised without publisher audio.",
      "Core persistence flows use chapter 1; responsive checks additionally sample chapters 9 and 10 rather than every chapter.",
      "No production site, shared reader session, real learner progress, local database or backup was accessed."],
  };
  await fs.writeFile("docs/chapter-student-audit.json", JSON.stringify(report, null, 2) + "\n");
}
if (failure) process.exitCode = 1;
