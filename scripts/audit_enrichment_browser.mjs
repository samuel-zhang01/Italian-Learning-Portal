import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const root = execFileSync("browser-view", ["--root"], {
  encoding: "utf8",
}).trim();
const { chromium } = await import(
  pathToFileURL(root + "/node_modules/playwright-core/index.mjs").href
);
const browser = await chromium.connectOverCDP(
  process.env.PARLIAMO_CDP_URL || "http://127.0.0.1:9224",
);
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "en-GB",
});
const page = await context.newPage();
const url = process.env.PARLIAMO_URL || "http://127.0.0.1:3000";
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const ok = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
const button = (name) => page.getByRole("button", { name, exact: true });
const state = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("parliamo-daily-v1")));
const go = async (route) => {
  await page.goto(url + "/#" + route);
  await page.waitForSelector(".daily-header");
};
try {
  await fs.mkdir("work", { recursive: true });
  await go("today");
  await page.screenshot({
    path: "work/enriched-home-desktop.png",
    fullPage: true,
  });
  await button("Start my 30-minute session →").click();
  await page
    .getByLabel("A phrase I can remember", { exact: true })
    .fill("Ciao, mi chiamo Ada.");
  await button("Save my warm-up").click();
  await button("Open my core lesson").click();
  await button("Try it from memory").click();
  await page
    .getByLabel("Your answer in Italian", { exact: true })
    .fill("chiamo");
  await button("Check my answer").click();
  await button("Continue").click();
  await page.getByLabel("Your answer in Italian", { exact: true }).fill("ti");
  await button("Check my answer").click();
  await button("Continue").click();
  await page
    .getByLabel("My Italian", { exact: true })
    .fill("Mi chiamo Ada. E tu?");
  await page.locator(".self-check input").nth(0).check();
  await page.locator(".self-check input").nth(1).check();
  await button("Save my practice").click();
  await button("Continue my daily session →").click();
  await page
    .getByRole("heading", { name: "Vocabulary quest", exact: true })
    .waitFor();
  assert.equal(
    Object.values((await state()).sessions)[0].missionId,
    "say-hello",
  );
  ok(
    "guided topic remains pinned after core completion and returns to vocabulary",
  );
  for (let i = 0; i < 8; i++) {
    await button("Reveal the Italian").click();
    await button(
      i % 2 ? "I needed help — repeat it" : "I remembered it",
    ).click();
  }
  await button("Vocabulary practice complete").click();
  const input = page.getByLabel(
    "What is the first speaker called? Write only the name.",
    { exact: true },
  );
  await input.fill("Leo");
  await button("Check the scene answer").click();
  await page
    .getByText(
      "Try again. Open the scene and look for the detail; using support is welcome.",
      { exact: true },
    )
    .waitFor();
  await page.reload();
  await input.waitFor();
  assert.equal(await input.inputValue(), "Leo");
  await input.fill("Nina");
  await button("Check the scene answer").click();
  await button("Save my scene practice").click();
  await page
    .getByLabel("My conversation notes", { exact: true })
    .fill("Ciao, mi chiamo Ada. E tu? Piacere!");
  await page.reload();
  await page.waitForSelector(".session-activity");
  assert.equal(
    await page
      .getByLabel("My conversation notes", { exact: true })
      .inputValue(),
    "Ciao, mi chiamo Ada. E tu? Piacere!",
  );
  await page.locator(".session-activity input[type=checkbox]").check();
  await button("Save my speaking practice").click();
  await page
    .getByLabel("My phrase for next time", { exact: true })
    .fill("Puoi ripetere, per favore?");
  await button("Save my memory trail").click();
  await page
    .getByText("Daily explorer badge earned", { exact: false })
    .waitFor();
  const completed = await state();
  const today = Object.keys(completed.sessions)[0];
  assert.equal(completed.sessions[today].recalled.length, 8);
  await go("today");
  assert.equal(await page.locator(".goal-number").innerText(), "30/ 30 min");
  await page.screenshot({
    path: "work/enriched-home-complete.png",
    fullPage: true,
  });
  ok(
    "six quests complete a 30-minute day with eight vocabulary attempts, correction, draft reload and badge",
  );
  await go("session");
  await button("Save my memory trail").click();
  assert.deepEqual((await state()).sessions, completed.sessions);
  ok("replaying a completed activity does not duplicate completion");
  await go("vocabulary");
  await page
    .getByLabel("Find an English or Italian word", { exact: true })
    .fill("cappuccino");
  await page
    .getByRole("heading", { name: "At the café", exact: true })
    .waitFor();
  await button("Reveal the Italian").click();
  await page.locator(".word-answer").filter({ hasText: "un caffè" }).waitFor();
  ok(
    "vocabulary search selects a matching bank and flashcards reveal the Italian",
  );
  // Every new scene is interactable and its supplied answer passes the actual UI.
  const content = JSON.parse(
    await fs.readFile("app/learning/enrichment.json", "utf8"),
  );
  for (const lesson of content.lessons) {
    await page.evaluate(
      ({ today, missionId }) => {
        const p = JSON.parse(localStorage.getItem("parliamo-daily-v1"));
        p.sessions[today] = {
          missionId,
          done: ["warmup", "core", "vocab"],
          warmup: "Ciao sono Ada",
          recalled: [],
          inputAnswer: "",
          speaking: "",
          exit: "",
        };
        localStorage.setItem("parliamo-daily-v1", JSON.stringify(p));
      },
      { today, missionId: lesson.missionId },
    );
    await go("session");
    await page.reload();
    await page.waitForSelector(".session-activity");
    await page
      .getByLabel(lesson.question.prompt.en, { exact: true })
      .fill(lesson.question.answers[0]);
    await button("Check the scene answer").click();
    await page
      .getByText("Yes — you found the detail.", { exact: true })
      .waitFor();
  }
  ok(
    "all 36 enrichment scenes accept their authored comprehension answers in the browser",
  );
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const language of ["en", "it"]) {
      await button(language.toUpperCase()).click();
      for (const route of [
        "today",
        "session",
        "vocabulary",
        "plan",
        "progress",
        "materials",
      ]) {
        await go(route);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${language}/${route} overflows ${width}px`,
        );
        if (width === 390)
          await page.screenshot({
            path: `work/enriched-${language}-${route}.png`,
            fullPage: true,
          });
      }
    }
  }
  ok("all enriched screens fit 390px and 320px in EN and IT");
  assert.deepEqual(errors, []);
  ok("no browser runtime errors");
  await fs.writeFile(
    "work/enrichment-browser-results.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
} catch (error) {
  await page.screenshot({
    path: "work/enrichment-failure.png",
    fullPage: true,
  });
  console.log(
    "FAILURE PAGE",
    (await page.locator("main").innerText()).slice(0, 2500),
  );
  console.log("SYNTHETIC STATE", JSON.stringify(await state()));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
