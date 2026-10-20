import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { emptyProgress, dayKey, addDays, parseProgress } from "../app/learning/engine.ts";
import { selectProgramme, startAssessment, answerAssessment, assessmentItems, getGrammarDraft } from "../app/learning/academy-engine.ts";
import { emptySession, sessionActivities } from "../app/learning/study.ts";

const root = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(`${root}/node_modules/playwright-core/index.mjs`).href);
const config = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
  headless: true,
  args: config.allowNoSandbox ? ["--no-sandbox"] : [],
});
const url = process.env.PARLIAMO_URL || "http://127.0.0.1:5197";
const output = process.env.CONSOLIDATION_REPORT_DIR || "work/consolidation-browser";
const grammar = JSON.parse(await fs.readFile("app/learning/grammar.json", "utf8"));
const curriculum = JSON.parse(await fs.readFile("app/learning/curriculum.json", "utf8"));
const ids = curriculum.missions.map((mission) => mission.id);
const today = dayKey(), yesterday = addDays(today, -1);
const checks = [], errors = [], edgeWarnings = [], measurements = [];
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() !== "error") return;
  const text = message.text();
  if (new URL(url).hostname === "italian.samuelzhang.co.uk"
    && /Content Security Policy/i.test(text)
    && (text.includes("https://static.cloudflareinsights.com/")
      || text.startsWith("Executing inline script violates"))) {
    edgeWarnings.push(text);
  } else errors.push(text);
});
const go = async (route) => {
  await page.goto(`${url}/#${route}`);
  await page.locator(".daily-header").waitFor();
};
const seed = async (progress, route = "today") => {
  parseProgress(JSON.stringify(progress), ids);
  await page.evaluate((value) => localStorage.setItem("parliamo-daily-v1", JSON.stringify(value)), progress);
  await go(route);
  await page.reload();
  await page.locator(".daily-header").waitFor();
};
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("parliamo-daily-v1")));
const pass = (label) => { checks.push(label); console.log("PASS", label); };
const button = (name) => page.getByRole("button", { name, exact: true });

try {
  await fs.mkdir(output, { recursive: true });
  await go("today");
  for (const language of ["en", "it"]) {
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await seed({ ...emptyProgress(), language });
      const mainButtons = page.locator(".daily-header nav button");
      assert.equal(await mainButtons.count(), 4);
      for (const item of await mainButtons.all()) {
        const box = await item.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
        assert.ok(box.height >= 44);
      }
      const primary = await page.locator(".today-primary-action").boundingBox();
      assert.ok(primary.y + primary.height < 844, `${language}/${width}: primary action below first screen`);
      assert.equal(await page.locator(".today-options").getAttribute("open"), null);
      assert.equal(await page.locator(".practice-menu").count(), 1);
      assert.equal(await page.locator(".practice-menu").getAttribute("open"), null);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      measurements.push({ language, width, primaryY: Math.round(primary.y), pageHeight: await page.evaluate(() => document.documentElement.scrollHeight) });
      await page.screenshot({ path: `${output}/${language}-${width}-today.png`, fullPage: true });
    }
  }
  pass("Four visible navigation choices, one above-fold start action and collapsed optional tools in EN/IT at 320, 390 and 1440px");

  await page.setViewportSize({ width: 390, height: 844 });
  await seed(emptyProgress(), "programmes");
  assert.match(await page.locator(".academy-programme-banner").innerText(), /28-day supported A1/);
  const choose = button("Make this my programme →");
  const chooseBox = await choose.boundingBox();
  assert.ok(chooseBox.y + chooseBox.height < 844, "Programme selection needs too much scrolling");
  assert.equal(await page.locator(".academy-programme-days > li").count(), 1);
  for (const disclosure of await page.locator(".programme-options").all())
    assert.equal(await disclosure.getAttribute("open"), null);
  await choose.click();
  await button("Continue today · day 1 →").click();
  await page.locator(".today-primary-action").waitFor();
  assert.equal((await state()).academy.programme.id, "supported-a1");
  const programme = grammar.programmes.find((item) => item.id === "supported-a1");
  const mission = curriculum.missions.find((item) => item.id === programme.days[0].missionIds[0]);
  assert.equal(await page.locator(".session-preview h2").innerText(), mission.title.en);
  await page.locator(".today-disclosure").first().locator("summary").click();
  assert.match(await page.locator(".study-itinerary").innerText(), new RegExp(mission.title.en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await page.locator(".today-primary-action").click();
  await page.locator(".session-page").waitFor();
  assert.equal((await state()).sessions[today].missionId, mission.id);
  const draft = page.getByLabel("A phrase I can remember", { exact: true });
  await draft.fill("Ciao, sono Nina.");
  await page.reload();
  assert.equal(await draft.inputValue(), "Ciao, sono Nina.");
  pass("Supported programme is recommended, selection is above-fold, Today and checklist agree, and session draft survives reload");

  let finished = selectProgramme(emptyProgress(), "supported-a1", today);
  finished.sessions = { [today]: { ...emptySession(mission.id, 15), done: sessionActivities(15) } };
  finished.completed[mission.id] = { date: today, firstCorrect: 2, total: 2, output: "Ciao.", supported: false, confidence: 2 };
  await seed(finished);
  const unit = grammar.units.find((item) => item.id === programme.days[0].unitIds[0]);
  assert.equal(await page.locator(".session-preview h2").innerText(), unit.title.en);
  await page.locator(".today-primary-action").click();
  await page.waitForURL(`**/#grammar/${unit.id}`);
  pass("Completing the guided session advances the single Today action to programme grammar");

  const five = selectProgramme(emptyProgress(), "supported-a1", yesterday);
  five.plan.minutes = 5;
  five.completed[mission.id] = { ...finished.completed[mission.id], date: yesterday };
  five.sessions = { [yesterday]: { ...emptySession(mission.id, 5), done: ["core"] } };
  await seed(five);
  assert.equal(await page.locator(".session-preview h2").innerText(), unit.title.en);
  assert.match(await page.locator(".session-preview").innerText(), /about 5 minutes/);
  await page.locator(".today-primary-action").click();
  await page.waitForURL(`**/#grammar/${unit.id}`);
  five.academy.grammar[unit.id] = { ...getGrammarDraft(five, unit.id), completed: today };
  await seed(five);
  await button("Finish this study day →").click();
  await button("Mark this day complete").click();
  assert.equal((await state()).academy.programme.day, 1);
  pass("Five-minute programme sittings advance to grammar on the next date and allow the study day to finish");

  await seed(emptyProgress(), "games");
  await button("Let’s play →").click();
  await page.locator(".arcade-question").waitFor();
  await page.locator(".practice-menu summary").click();
  await page.locator(".practice-menu").getByRole("button", { name: "Grammar lab", exact: true }).click();
  await go("programmes");
  await button("Make this my programme →").click();
  await button("Continue today · day 1 →").click();
  await page.locator(".today-primary-action").waitFor();
  assert.equal(await page.locator(".practice-menu").count(), 1);
  await page.goBack();
  await page.goForward();
  assert.equal(await page.locator(".practice-menu").count(), 1);
  assert.equal(await page.locator(".practice-menu").getAttribute("open"), null);
  pass("Games–grammar–programme–Today and browser history preserve exactly one closed tools menu");

  await seed(emptyProgress(), "grammar/simple-prepositions");
  await page.locator(".academy-steps").getByRole("button", { name: /Practise$/ }).click();
  await button(/^Exercise 4:/).click();
  let form = page.locator(".academy-exercise-card");
  await form.getByRole("textbox").fill("A piedi vado da Ada.");
  await form.getByRole("button", { name: "Check my answer", exact: true }).click();
  await form.locator(".academy-feedback.correct").waitFor();
  await go("grammar/present-are");
  await page.locator(".academy-steps").getByRole("button", { name: /Practise$/ }).click();
  await button(/^Exercise 5:/).click();
  form = page.locator(".academy-exercise-card");
  assert.match(await form.innerText(), /Write the whole corrected sentence/);
  await form.getByRole("textbox").fill("Voi cucinate a casa.");
  await form.getByRole("button", { name: "Check my answer", exact: true }).click();
  await form.locator(".academy-feedback.correct").waitFor();
  pass("Valid Italian word order receives credit and correction prompts explicitly request a whole sentence");

  for (const mode of ["readiness", "tense"]) {
    let progress = startAssessment(emptyProgress(), grammar.units, yesterday, mode);
    const items = assessmentItems(grammar.units, yesterday, mode);
    progress = answerAssessment(progress, `${yesterday}:${mode}`, items[0].exercise, items[0].exercise.answers[0], yesterday);
    await seed(progress, mode);
    await page.getByText(`Continue your saved check from`, { exact: false }).waitFor();
    assert.equal(await button("Start my check").count(), 0);
    assert.equal(await page.getByRole("progressbar").getAttribute("value"), "1");
    await page.getByLabel("My Italian answer", { exact: true }).fill(items[1].exercise.answers[0]);
    await button("Save my first answer").click();
    await button("Next question").click();
    await page.reload();
    assert.equal(await page.getByRole("progressbar").getAttribute("value"), "2");
    let saved = await state();
    assert.equal(saved.academy.assessments[`${yesterday}:${mode}`].answers[items[1].exercise.id].date, today);
    await button("Start a new check for today").click();
    saved = await state();
    assert.equal(Object.keys(saved.academy.assessments[`${yesterday}:${mode}`].answers).length, 2);
    assert.ok(saved.academy.assessments[`${today}:${mode}`]);
    const history = page.locator("details").filter({ has: page.locator("summary", { hasText: "Previous checks" }) });
    assert.equal(await history.getAttribute("open"), null);
    await history.locator("summary").click();
    await history.getByRole("combobox").selectOption(`${yesterday}:${mode}`);
    assert.equal(await page.getByRole("progressbar").getAttribute("value"), "2");
  }
  pass("Both diagnostics resume across dates, retain answers on reload and preserve old checks when starting today's check");

  await seed(emptyProgress());
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  assert.ok(await page.locator("#main-content").evaluate((element) => element === document.activeElement));
  pass("Keyboard skip link moves focus to the main learning area");
  assert.deepEqual(errors, []);
  if (edgeWarnings.some((message) => message.startsWith("Executing inline script"))) {
    // The deployed app has no inline scripts. Verify that blocked inline code
    // belongs to the edge injection, and retain these warnings in the report.
    assert.ok(await page.locator("script:not([src])").evaluateAll((scripts) =>
      scripts.length > 0 && scripts.every((script) => script.textContent.includes("/cdn-cgi/"))));
  }
  pass("No runtime errors or duplicate-key console errors in audited journeys");
  const report = { checkedAt: new Date().toISOString(), url, checks, measurements, errors,
    edgeWarnings: [...new Set(edgeWarnings)], syntheticProgressOnly: true };
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + "\n");
} finally {
  await context.close();
  await browser.close();
}
