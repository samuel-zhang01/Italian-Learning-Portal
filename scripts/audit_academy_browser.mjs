import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  emptyProgress,
  dayKey,
  parseProgress,
} from "../app/learning/engine.ts";
import {
  assessmentItems,
  emptyAcademy,
  getGrammarDraft,
  selectProgramme,
} from "../app/learning/academy-engine.ts";
const root = execFileSync("browser-view", ["--root"], {
  encoding: "utf8",
}).trim();
const { chromium } = await import(
  pathToFileURL(root + "/node_modules/playwright-core/index.mjs").href
);
const config = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const browser = process.env.PARLIAMO_CDP_URL
  ? await chromium.connectOverCDP(process.env.PARLIAMO_CDP_URL)
  : await chromium.launch({
      executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
      headless: true,
      args: config.allowNoSandbox ? ["--no-sandbox"] : [],
    });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "en-GB",
});
const page = await context.newPage(),
  url = process.env.PARLIAMO_URL || "http://127.0.0.1:5197";
const grammar = JSON.parse(
  await fs.readFile("app/learning/grammar.json", "utf8"),
);
const curriculum = JSON.parse(
  await fs.readFile("app/learning/curriculum.json", "utf8"),
);
const ids = curriculum.missions.map((m) => m.id),
  today = dayKey(),
  checks = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const button = (name) => page.getByRole("button", { name, exact: true });
const go = async (route) => {
  await page.goto(url + "/#" + route);
  await page.waitForSelector(".daily-header");
};
const state = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("parliamo-daily-v1")));
const seed = async (p) => {
  await page.evaluate(
    (p) => localStorage.setItem("parliamo-daily-v1", JSON.stringify(p)),
    p,
  );
  await page.reload();
  await page.waitForSelector(".daily-header");
};
const ok = (label) => {
  checks.push(label);
  console.log("PASS", label);
};
try {
  await fs.mkdir("work", { recursive: true });
  await go("plan");
  for (const minutes of [5, 10, 15, 20, 30, 45, 60]) {
    await seed(emptyProgress());
    await button(new RegExp(`^${minutes}\\s*min$`)).click();
    assert.equal((await state()).plan.minutes, minutes);
    await go("today");
    const blocks = await page
      .locator(".itinerary-blocks li strong")
      .allTextContents();
    assert.equal(
      blocks.reduce((sum, s) => sum + Number(s.match(/(\d+) min/)[1]), 0),
      minutes,
    );
    await go("session");
    assert.match(
      await page.locator(".session-page > .eyebrow").innerText(),
      new RegExp(`${Math.min(30, minutes)} MINUTES`),
    );
    assert.equal(
      await page.locator(".session-stages button").count(),
      minutes === 5 ? 1 : minutes === 10 ? 3 : 6,
    );
    if (minutes > 5) {
      await page
        .getByLabel("A phrase I can remember", { exact: true })
        .fill("Ciao sono Nina.");
      await page.reload();
      assert.equal(
        await page
          .getByLabel("A phrase I can remember", { exact: true })
          .inputValue(),
        "Ciao sono Nina.",
      );
      assert.equal(
        (await state()).sessions[today].duration,
        Math.min(30, minutes),
      );
    }
    await go("plan");
  }
  ok(
    "all seven budgets produce exact itinerary totals, correct session stages and persistent duration snapshots",
  );
  const saved = await state();
  await button(/^5\s*min$/).click();
  await go("session");
  assert.equal(
    (await state()).sessions[today].duration,
    saved.sessions[today].duration,
  );
  assert.match(
    await page.locator(".session-page > .eyebrow").innerText(),
    /30 MINUTES/,
  );
  await go("today");
  const clippedBlocks = await page
    .locator(".itinerary-blocks li strong")
    .allTextContents();
  assert.equal(
    clippedBlocks.reduce((sum, s) => sum + Number(s.match(/(\d+) min/)[1]), 0),
    5,
  );
  const legacySession = await state();
  delete legacySession.sessions[today].duration;
  await seed(legacySession);
  await go("session");
  assert.match(
    await page.locator(".session-page > .eyebrow").innerText(),
    /30 MINUTES/,
  );
  ok(
    "changing the time budget caps today's blocks and preserves active or older session steps",
  );
  for (const [programmeId, minutes, index, duration, workshops] of [
    ["supported-a1", 30, 0, 15, 1],
    ["intensive-a1", 45, 0, 15, 2],
    ["intensive-a1", 60, 0, 30, 2],
    ["grammar-repair", 60, 3, 15, 3],
  ]) {
    const p = selectProgramme(emptyProgress(), programmeId, today);
    p.plan.minutes = minutes;
    p.academy.programme.day = index;
    const day = grammar.programmes.find((x) => x.id === programmeId).days[
      index
    ];
    const mission = curriculum.missions.find((x) => x.id === day.missionIds[0]);
    await go("today");
    await seed(p);
    await page
      .locator(".session-preview h2")
      .filter({ hasText: mission.title.en })
      .waitFor();
    const blocks = await page
      .locator(".itinerary-blocks li strong")
      .allTextContents();
    assert.equal(
      blocks.reduce((sum, s) => sum + Number(s.match(/(\d+) min/)[1]), 0),
      minutes,
    );
    assert.equal(
      blocks.filter((s) => s.includes("Grammar practice")).length,
      workshops,
    );
    await page.locator(".today-primary-action").click();
    assert.equal((await state()).sessions[today].missionId, mission.id);
    assert.equal((await state()).sessions[today].duration, duration);
    await page.reload();
    assert.equal((await state()).sessions[today].duration, duration);
  }
  ok(
    "all three active programmes combine the right number of grammar blocks and required core mission within 30/45/60-minute budgets",
  );
  await go("readiness");
  await seed(emptyProgress());
  for (const mode of ["readiness", "tense"]) {
    await go(mode);
    const items = assessmentItems(grammar.units, today, mode);
    assert.equal(items.length, 12);
    await button("Start my check").click();
    for (let i = 0; i < items.length; i++) {
      const e = items[i].exercise;
      await page
        .getByLabel("My Italian answer", { exact: true })
        .fill(i === 0 ? "wrong" : e.answers[0]);
      await button("Save my first answer").click();
      await page
        .getByRole("heading", {
          name:
            i === 0
              ? ["correct", "reorder"].includes(e.kind)
                ? "This doesn’t match a model answer yet."
                : "A useful clue for your next practice."
              : "That fits.",
          exact: true,
        })
        .waitFor();
      if (i === 0) {
        await page.reload();
        const p = await state();
        assert.equal(
          p.academy.assessments[`${today}:${mode}`].answers[e.id].correct,
          false,
        );
      } else
        await button(
          i === items.length - 1 ? "See my results" : "Next question",
        ).click();
    }
    await page
      .getByRole("heading", {
        name: "11/12 first answers correct",
        exact: true,
      })
      .waitFor();
    const p = await state();
    assert.ok(p.academy.assessments[`${today}:${mode}`].completed);
    assert.deepEqual(parseProgress(JSON.stringify(p), ids), p);
    await page.reload();
    await page
      .getByRole("heading", {
        name: "11/12 first answers correct",
        exact: true,
      })
      .waitFor();
    assert.equal(await button("Start my check").count(), 0);
  }
  ok(
    "both twelve-question diagnostics preserve wrong first answers, resume after reload, explain corrections and retain results",
  );
  await go("words");
  await page.getByLabel("Find a word or phrase", { exact: true }).fill("caffè");
  const coffee = page.locator(".vocabulary-grid .panel").filter({
    has: page.getByRole("heading", { name: "un caffè", exact: true }),
  });
  await coffee
    .getByRole("button", { name: "☆ Save word", exact: true })
    .click();
  await button("Reveal my word").click();
  await button("Again tomorrow").click();
  assert.equal((await state()).academy.words["un caffè"].lapses, 1);
  await page.reload();
  await page
    .getByRole("heading", { name: "Today's words are done.", exact: true })
    .waitFor();
  ok(
    "saved vocabulary persists and an unsuccessful self-rated recall returns tomorrow without repeat credit",
  );
  await go("progress");
  const beforeImport = await state();
  const large = { ...emptyProgress(), academy: emptyAcademy() };
  const companion = JSON.parse(
    await fs.readFile("app/learning/companion.json", "utf8"),
  );
  for (const entry of companion.pages.filter((p) => p.kind === "practice"))
    large.academy.companion[entry.id] = {
      answer: "Una frase personale. ".repeat(90),
      selfChecked: true,
      modelSeen: true,
      completed: today,
    };
  for (const u of grammar.units)
    large.academy.grammar[u.id] = {
      ...getGrammarDraft(large, u.id),
      attempts: Object.fromEntries(
        u.exercises.map((e) => [
          e.id,
          Array.from({ length: 12 }, () => ({
            answer: "Una frase da correggere. ".repeat(20),
            correct: false,
            assisted: true,
            date: today,
          })),
        ]),
      ),
    };
  const buffer = Buffer.from(JSON.stringify(large));
  assert.ok(buffer.length > 2_000_000);
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic-academy-backup.json",
    mimeType: "application/json",
    buffer,
  });
  await page
    .getByRole("heading", { name: "Review before restoring", exact: true })
    .waitFor();
  assert.match(
    await page.locator(".restore-preview").innerText(),
    /730 companion pages/,
  );
  assert.deepEqual(await state(), beforeImport);
  await page.locator('input[type="file"]').setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("broken"),
  });
  await page
    .getByText(
      "This is not a valid Parliamo backup. Your current progress is unchanged.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await page.locator(".restore-preview").count(), 0);
  assert.deepEqual(await state(), beforeImport);
  ok(
    "large academy backups reach a detailed restore preview; invalid replacements clear stale previews without overwriting work",
  );
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const lang of ["EN", "IT"]) {
      await button(lang).click();
      for (const route of [
        "today",
        "plan",
        "session",
        "progress",
        "programmes",
        "readiness",
        "tense",
        "words",
      ]) {
        await go(route);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${width}/${lang}/${route}`,
        );
      }
    }
  }
  ok(
    "core and new planning/diagnostic routes fit desktop, 390px and 320px in both languages",
  );
  await button("EN").click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go("today");
  await page.screenshot({
    path: "work/academy-home-desktop.png",
    fullPage: true,
  });
  await go("readiness");
  await page.screenshot({
    path: "work/academy-readiness-results.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  ok("no browser runtime errors across the audited journeys");
  await fs.writeFile(
    "work/academy-browser-results.json",
    JSON.stringify({ date: today, checks, errors }, null, 2),
  );
} catch (error) {
  await page.screenshot({
    path: "work/academy-browser-failure.png",
    fullPage: true,
  });
  console.error("FAILED", page.url(), error.message);
  throw error;
} finally {
  await context.close();
  await browser.close();
}
