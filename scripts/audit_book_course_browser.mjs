import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { emptyProgress, dayKey, parseProgress } from "../app/learning/engine.ts";
import { getGrammarDraft } from "../app/learning/academy-engine.ts";

// An owned, disposable browser process. Never attach to a learner's CDP session.
const browserRoot = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(`${browserRoot}/node_modules/playwright-core/index.mjs`).href);
const config = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const appUrl = process.env.PARLIAMO_URL || "http://127.0.0.1:5197";
const evidenceDir = process.env.BOOK_COURSE_REPORT_DIR || "work/book-course-audit";
const reportPath = "docs/book-course-student-audit.json";
const readJSON = async (name) => JSON.parse(await fs.readFile(`app/learning/${name}.json`, "utf8"));
const [grammar, curriculum, companion] = await Promise.all([
  readJSON("grammar"), readJSON("curriculum"), readJSON("companion"),
]);
const programme = grammar.programmes.find((item) => item.id === "espresso-plus-a1-a2");
assert.ok(programme, "The integrated Espresso Plus programme must exist before this audit runs.");
assert.equal(programme.days.length, 80);
const unit = grammar.units.find((item) => item.id === "a2-imperfetto");
const introUnit = grammar.units.find((item) => item.id === "a2-subjunctive-forms");
assert.ok(unit && introUnit);
const guideId = "src-070c40bad24b";
const guide = companion.sources.find((item) => item.id === guideId);
assert.equal(guide?.pages, 166, "Publisher guide must retain its physical PDF page count.");
const sourceRef = unit.sources.find((item) => item.id === guideId);
const sourcePage = companion.pages.find((item) => item.sourceId === guideId && item.page === sourceRef.pages[0]);
assert.ok(sourcePage, "A cited physical guide page must have a navigable companion.");

const checks = [], errors = [], measurements = [], screenshots = [], fixtures = [];
let browser, context, page, failure;
const today = dayKey();
const ids = curriculum.missions.map((item) => item.id);
const pass = (label, details = {}) => {
  checks.push({ label, ...details });
  console.log("PASS", label);
};
const button = (name) => page.getByRole("button", { name, exact: true });
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("parliamo-daily-v1")));
const go = async (route) => {
  await page.goto(`${appUrl}/#${route}`);
  await page.locator(".daily-header").waitFor();
};
const reload = async () => {
  await page.reload();
  await page.locator(".daily-header").waitFor();
};
const seed = async (progress, route) => {
  parseProgress(JSON.stringify(progress), ids);
  await page.evaluate((value) => localStorage.setItem("parliamo-daily-v1", JSON.stringify(value)), progress);
  await go(route);
  await reload();
};
const screenshot = async (name) => {
  const filename = `${name}.png`;
  await page.screenshot({ path: path.join(evidenceDir, filename), fullPage: true });
  screenshots.push(filename);
};
const practicePanel = () => page.getByRole("region", { name: "Daily personal practice", exact: true });
const assertDisabled = async (locator, label) => assert.equal(await locator.isDisabled(), true, label);
const until = async (predicate, label) => {
  for (let tries = 0; tries < 60; tries++) {
    if (await predicate()) return;
    await page.waitForTimeout(50);
  }
  assert.fail(label);
};
const chooseLanguage = async (language) => {
  await button(language.toUpperCase()).click();
  await until(async () => (await state()).language === language, `Language did not persist: ${language}`);
};
const sourceFixture = (progress, dayIndex) => {
  const p = structuredClone(progress), day = programme.days[dayIndex];
  p.academy ??= { grammar: {}, companion: {}, programme: null, assessments: {}, words: {} };
  for (const id of day.unitIds) {
    const linked = grammar.units.find((item) => item.id === id);
    p.academy.grammar[id] = {
      ...getGrammarDraft(p, id),
      answers: Object.fromEntries(linked.exercises.map((exercise) => [exercise.id, exercise.answers[0]])),
      attempts: Object.fromEntries(linked.exercises.map((exercise) => [exercise.id, [{
        answer: exercise.answers[0], correct: true, assisted: false, date: today,
      }]])),
      output: "Ho preparato questa risposta sintetica.",
      rubric: linked.production.rubric.map((_, index) => index),
      completed: today,
    };
  }
  for (const id of day.missionIds) p.completed[id] = {
    date: today, firstCorrect: 2, total: 2, output: "Questa è una risposta sintetica.", supported: false, confidence: 2,
  };
  fixtures.push({ purpose: "Linked work already completed, to isolate the new day-practice gate", day: dayIndex + 1, unitIds: day.unitIds, missionIds: day.missionIds });
  return p;
};

try {
  await fs.mkdir(evidenceDir, { recursive: true });
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
    headless: true,
    args: config.allowNoSandbox ? ["--no-sandbox"] : [],
  });
  context = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: "en-GB", reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push({ kind: "pageerror", message: error.message }));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push({ kind: "console", message: message.text() });
  });
  await go("programmes");
  await seed(emptyProgress(), "programmes");
  await page.locator(".programme-options").first().locator("summary").click();
  await page.locator(".academy-programme-choices button").filter({ hasText: programme.title.en }).click();
  await button("Make this my programme →").click();
  assert.equal((await state()).academy.programme.id, programme.id);
  assert.match(await page.locator("#current-programme-day").innerText(), /1 of 80/);
  await screenshot("en-390-selected-80-day-route");
  pass("Selected the 80-study-day route through the visible programme chooser");

  const response = "Buongiorno, mi chiamo Livia. Come, scusi? Livia.";
  let panel = practicePanel();
  const savePractice = () => panel.getByRole("button", { name: "Save my self-assessed practice", exact: true });
  await assertDisabled(savePractice(), "Empty practice must not save.");
  await assertDisabled(button("Mark this day complete"), "An empty day must not complete.");
  await panel.getByRole("textbox").fill("Due parole");
  for (const item of await panel.getByRole("checkbox").all()) await item.check();
  await assertDisabled(savePractice(), "Two-word practice must not save even with all criteria ticked.");
  await panel.getByRole("textbox").fill(response);
  assert.equal(await panel.getByRole("checkbox", { checked: true }).count(), 0);
  await panel.getByRole("checkbox").first().check();
  await assertDisabled(savePractice(), "One criterion must not be enough.");
  for (const item of await panel.getByRole("checkbox").all()) await item.check();
  await panel.getByRole("button", { name: "Show a possible response", exact: true }).click();
  await until(async () => (await state()).academy.programme.practice?.["0"]?.modelSeen === true, "Model exposure must save.");
  await reload();
  panel = practicePanel();
  assert.equal(await panel.getByRole("textbox").inputValue(), response);
  assert.equal(await panel.getByRole("checkbox", { checked: true }).count(), programme.days[0].practice.rubric.length);
  assert.equal(await panel.getByRole("button", { name: "Hide a possible response", exact: true }).count(), 1);
  assert.equal((await state()).academy.programme.practice["0"].completed, undefined);
  await screenshot("en-390-personal-draft-after-reload");
  pass("Personal draft, every criterion and model exposure survive reload; unfinished work stays unfinished");

  const editedResponse = `${response} Grazie.`;
  await panel.getByRole("textbox").fill(editedResponse);
  assert.equal(await panel.getByRole("checkbox", { checked: true }).count(), 0);
  await assertDisabled(savePractice(), "Editing must require a new self-check.");
  for (const item of await panel.getByRole("checkbox").all()) await item.check();
  await savePractice().click();
  await until(async () => Boolean((await state()).academy.programme.practice["0"].completed), "Personal practice completion must persist.");
  await assertDisabled(button("Mark this day complete"), "Personal practice alone cannot bypass linked work.");
  let progress = await state();
  assert.equal(progress.academy.programme.practice["0"].modelSeen, true);
  await seed(sourceFixture(progress, 0), "programmes");
  assert.equal(await button("Mark this day complete").isEnabled(), true);
  await button("Mark this day complete").click();
  await until(async () => (await state()).academy.programme.day === 1, "Day advancement failed.");
  panel = practicePanel();
  assert.equal(await panel.getByRole("textbox").inputValue(), "");
  assert.equal(await panel.getByRole("checkbox", { checked: true }).count(), 0);
  assert.equal((await state()).academy.programme.practice["1"], undefined);
  progress = await state();
  await seed(sourceFixture(progress, 1), "programmes");
  await assertDisabled(button("Mark this day complete"), "Old grammar/mission completion cannot bypass a fresh day's practice.");
  assert.match(await page.locator(".academy-day-action").innerText(), /personal practice and self-check first/);
  pass("Editing resets self-checks; personal work and linked work both gate completion; day 2 has a distinct empty draft", { fixtureUse: "Linked day-1/day-2 work was seeded, not completed through every existing lesson UI." });

  await go(`grammar/${unit.id}`);
  await button("Try it step by step →").click();
  let card = page.locator(".academy-exercise-card");
  await card.getByRole("textbox").fill("risposta sintetica sbagliata");
  await card.getByRole("button", { name: "Check my answer", exact: true }).click();
  await card.locator(".academy-feedback.retry").waitFor();
  progress = await state();
  assert.equal(progress.academy.grammar[unit.id].attempts[unit.exercises[0].id][0].correct, false);
  assert.equal(progress.academy.grammar[unit.id].attempts[unit.exercises[0].id][0].assisted, false);
  await screenshot("en-390-a2-wrong-first-answer");
  await card.getByRole("textbox").fill(unit.exercises[0].answers[0]);
  await card.getByRole("button", { name: "Check this attempt", exact: true }).click();
  await card.locator(".academy-feedback.correct").waitFor();
  await page.locator(".academy-question-dots button").nth(1).click();
  card = page.locator(".academy-exercise-card");
  await card.getByRole("textbox").fill(unit.exercises[1].answers[0]);
  await reload();
  card = page.locator(".academy-exercise-card");
  assert.equal(await card.getByRole("textbox").inputValue(), unit.exercises[1].answers[0]);
  await chooseLanguage("it");
  assert.match(await card.locator("h3").innerText(), /Completa/);
  progress = await state();
  const firstHistory = progress.academy.grammar[unit.id].attempts[unit.exercises[0].id];
  assert.equal(firstHistory.length, 2);
  assert.equal(firstHistory[0].correct, false);
  assert.equal(firstHistory[1].correct, true);
  assert.equal(firstHistory[1].assisted, true);
  await screenshot("it-390-a2-mid-lesson-reload");
  pass("New A2 lesson keeps wrong first-attempt evidence, marks the correction supported, and resumes an unsubmitted answer after reload");

  await page.locator(".academy-steps button").nth(2).click();
  await assertDisabled(button("Completa questa unità ✓"), "Unsolved grammar unit must not complete.");
  await page.locator(".academy-steps button").nth(1).click();
  for (let index = 1; index < unit.exercises.length; index++) {
    const exercise = unit.exercises[index];
    await page.locator(".academy-question-dots button").nth(index).click();
    card = page.locator(".academy-exercise-card");
    if (exercise.options?.length) await card.getByRole("radio", { name: exercise.answers[0], exact: true }).check();
    else await card.getByRole("textbox").fill(exercise.answers[0]);
    await card.getByRole("button", { name: "Controlla la risposta", exact: true }).click();
    await card.locator(".academy-feedback.correct").waitFor();
  }
  await page.locator(".academy-steps button").nth(2).click();
  await page.getByRole("textbox", { name: "La mia risposta in italiano", exact: true }).fill(
    "Da piccola abitavo vicino a un lago. Di solito leggevo. La domenica facevamo la pizza. La casa era piccola.",
  );
  await assertDisabled(button("Completa questa unità ✓"), "Production criteria must gate grammar completion.");
  for (const item of await page.locator(".academy-checklist").getByRole("checkbox").all()) await item.check();
  await button("Completa questa unità ✓").click();
  await until(async () => Boolean((await state()).academy.grammar[unit.id].completed), "A2 completion must save.");
  progress = await state();
  assert.equal(progress.academy.grammar[unit.id].attempts[unit.exercises[0].id][0].correct, false);
  assert.equal(Object.values(progress.academy.grammar[unit.id].attempts).filter((history) => history[0].correct).length, unit.exercises.length - 1);
  assert.equal(progress.academy.grammar[unit.id].rubric.length, 3);
  await screenshot("it-390-a2-production-completed");
  await reload();
  assert.ok((await state()).academy.grammar[unit.id].completed);
  pass("Completed the new A2 grammar unit through all 8 exercises and all 3 self-checks in Italian; original first error survives completion and reload");

  const sourceList = page.locator(".academy-source-list");
  assert.match(await sourceList.innerText(), new RegExp(sourceRef.pages.join(", ")));
  assert.match(await sourceList.innerText(), /NEPLUS2_guida|guida|guide/i);
  await sourceList.getByRole("button", { name: "Apri il compagno della pagina →", exact: true }).click();
  assert.ok(page.url().endsWith(`/#companion/${sourcePage.id}`));
  assert.equal(await page.getByRole("combobox", { name: "Il mio file del corso", exact: true }).inputValue(), guideId);
  assert.match(await page.locator(".academy-source-meta").innerText(), /166/);
  assert.match(await page.locator(".academy-companion-sheet .academy-card-top").innerText(), new RegExp(`PAGINA / DIAPOSITIVA ${sourcePage.page}`));
  assert.match(await page.locator(".academy-companion-sheet").innerText(), /non conta come esercizio completato/i);
  await screenshot("it-390-physical-guide-reference-page");
  pass("A2 source link opens the correct physical guide page; metadata retains 166 physical pages and labels it as reference without exercise credit", { sourceId: guideId, physicalPages: sourceRef.pages, openedPage: sourcePage.page });

  await go(`grammar/${introUnit.id}`);
  assert.match(await page.locator(".academy-teaching").innerText(), /introduzione al congiuntivo presente/);
  await go("programmes");
  assert.match(await page.locator(".programme-workspace").innerText(), /Questa verifica riguarda le basi A1/);
  await go("readiness");
  assert.match(await page.locator(".assessment-view").innerText(), /temi A1/);
  assert.match(await page.locator(".assessment-view").innerText(), /non certifica un livello QCER/);
  pass("Introductory subjunctive scope and A1-only non-certifying diagnostic scope are visible to the learner");

  const routes = ["today", "programmes", `grammar/${unit.id}`, `grammar/${introUnit.id}`, "lesson/espresso2-u10-discuss-a-home", `companion/${sourcePage.id}`, "readiness"];
  for (const language of ["en", "it"]) {
    await chooseLanguage(language);
    for (const width of [390, 320, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      for (const route of routes) {
        await go(route);
        const metric = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
        assert.ok(metric.document <= metric.viewport + 1, `${language}/${width}/${route}: horizontal overflow ${metric.document}`);
        assert.ok(await page.locator("main").innerText(), `${language}/${width}/${route}: empty main`);
        if (route === "programmes") {
          assert.equal(await page.getByRole("region", { name: language === "en" ? "Daily personal practice" : "Pratica personale del giorno", exact: true }).count(), 1);
          assert.match(await page.locator("#current-programme-day").innerText(), /(?:of|di) 80/);
        }
        measurements.push({ language, width, route, ...metric });
        await screenshot(`${language}-${width}-${route.replaceAll("/", "-")}`);
      }
    }
  }
  pass("Seven student screens render in EN/IT at 390px, 320px and desktop without horizontal overflow", { combinations: measurements.length });
  assert.deepEqual(errors, [], "Browser runtime/console errors were observed.");
  pass("No browser runtime or console errors during the audited journey");
} catch (error) {
  failure = { message: error.message, stack: error.stack?.split("\n").slice(0, 8), route: page?.url() };
  console.error("FAIL", error.message);
  if (page) await screenshot("failure").catch(() => {});
} finally {
  const report = {
    reviewedOn: new Date().toISOString(), status: failure ? "failed" : "passed", appUrl,
    browserIsolation: "Separate owned headless Chromium process, fresh disposable context. No shared CDP connection, user context, cookies, storage, browser pages or profile inspected.",
    syntheticDataOnly: true, programmeId: programme.id, programmeStudyDays: programme.days.length,
    grammarUnit: unit.id, checks, failure: failure ?? null, errors, measurements,
    evidence: { directory: evidenceDir, screenshots }, fixtures,
    limitations: [
      "One representative A2 unit was completed through the UI; the other new units received layout/scope samples or content/unit-test coverage, not full browser completion.",
      "Only the first two programme days were exercised. Linked grammar/mission completions were explicitly seeded to isolate day-practice gates; the full 80-day route was not completed in real time.",
      "Viewport/overflow assertions and saved screenshots require a visual review for typography and content readability; they do not measure pronunciation, language proficiency or CEFR placement.",
      "Public deployment, account authentication, publisher reader access, audio and media playback are outside this synthetic local preview audit.",
    ],
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(evidenceDir, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  await context?.close();
  // This closes only the browser process launched by this script.
  await browser?.close();
}
if (failure) process.exitCode = 1;
