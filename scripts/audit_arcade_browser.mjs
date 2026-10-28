import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  emptyProgress,
  parseProgress,
  dayKey,
} from "../app/learning/engine.ts";
import {
  emptyArcade,
  startArcadeRound,
  shuffled,
} from "../app/learning/arcade-engine.ts";
import {
  arcadeItems,
  arcadeItemById,
} from "../app/learning/arcade-catalogue.ts";
const root = execFileSync("browser-view", ["--root"], {
  encoding: "utf8",
}).trim();
const { chromium } = await import(
  pathToFileURL(root + "/node_modules/playwright-core/index.mjs").href
);
const config = JSON.parse(
  await fs.readFile("/root/.config/browser-view/settings.json", "utf8"),
);
const browser = await chromium.launch({
  executablePath:
    process.env.BROWSER_EXECUTABLE_PATH ||
    "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
  headless: true,
  args: config.allowNoSandbox ? ["--no-sandbox"] : [],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage(),
  url = process.env.PARLIAMO_URL || "http://127.0.0.1:5197",
  output = process.env.ARCADE_REPORT_DIR || "work/arcade-browser";
const today = dayKey(),
  checks = [],
  errors = [];
const curriculum = JSON.parse(
  await fs.readFile("app/learning/curriculum.json", "utf8"),
);
page.on("pageerror", (e) => errors.push(e.message));
const button = (name) =>
  page.getByRole("button", {
    name: new RegExp(
      "^(?:←\\s*)?" +
        name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "(?:\\s*→)?$",
    ),
    exact: true,
  });
const state = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("parliamo-daily-v1")));
const go = async (route) => {
  await page.goto(`${url}/#${route}`);
  await page.waitForSelector(".daily-header");
  if (route.startsWith("games")) await page.locator(".arcade").waitFor({ state: "visible" });
};
const seed = async (p) => {
  await page.evaluate(
    (p) => localStorage.setItem("parliamo-daily-v1", JSON.stringify(p)),
    p,
  );
  await page.reload();
  await page.waitForSelector(".daily-header");
  if (new URL(page.url()).hash.startsWith("#games")) await page.locator(".arcade").waitFor({ state: "visible" });
};
const ok = (label) => {
  checks.push(label);
  console.log("PASS", label);
};
const getItem = (p) =>
  arcadeItemById.get(p.arcade.active.itemIds[p.arcade.active.index]);
const answerCurrent = async (wrong = false) => {
  await page.locator(".arcade-question").waitFor({ state: "visible" });
  const p = await state(),
    q = getItem(p),
    r = p.arcade.active;
  if (await page.locator(".arcade-option").count()) {
    const answer = wrong
      ? q.options.find((x) => !q.answers.includes(x))
      : q.answers[0];
    await page
      .locator(".arcade-option")
      .filter({
        hasText: new RegExp(
          `^${answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        ),
      })
      .click();
  } else if (await page.locator(".arcade-tiles").count()) {
    const remaining = shuffled(q.tokens, r.id + q.id).map((word, i) => ({
      word,
      i,
    }));
    for (const word of q.answers[0].replace(/[.!?]$/, "").split(" ")) {
      const index = remaining.findIndex((x) => x.word === word);
      assert.ok(index >= 0, `${q.id}: token ${word}`);
      await page
        .locator(".arcade-tiles button")
        .nth(remaining[index].i)
        .click();
      remaining.splice(index, 1);
    }
    await button("Check answer").click();
  } else {
    await page
      .locator("#arcade-answer")
      .fill(wrong ? "sbagliato" : q.answers[0]);
    await button("Check answer").click();
  }
  await page.waitForSelector(".arcade-feedback");
};
try {
  await fs.mkdir(output, { recursive: true });
  await go("today");
  assert.equal(await page.locator(".practice-menu").getAttribute("open"), null);
  assert.equal(
    await page.locator(".today-options").getAttribute("open"),
    null,
  );
  await page.locator(".today-options > summary").click();
  await button("Open games").click();
  await page.locator("#arcade-game").waitFor({ state: "visible" });
  assert.equal(await page.locator("#arcade-game option").count(), 5);
  assert.equal(
    await page.locator(".arcade-customise").getAttribute("open"),
    null,
  );
  ok("Today has one game entry; tool menus and game settings start collapsed");
  for (const mode of ["words", "verbs", "builder", "detective", "conversation"]) {
    const p = { ...emptyProgress(), arcade: emptyArcade() };
    p.arcade.settings.mode = mode;
    await seed(p);
    await button("Let’s play").click();
    const initial = await state();
    assert.ok(initial.arcade.active);
    for (let i = 0; i < initial.arcade.active.itemIds.length; i++) {
      assert.equal(await page.locator(".arcade-question").count(), 1);
      if (i === 0 && mode !== "builder") {
        await button("Show a hint").click();
        await page.reload();
      }
      await answerCurrent(i === 1 && mode !== "builder");
      const checked = await state();
      if (i === 0) {
        await page.reload();
        assert.deepEqual(
          (await state()).arcade.active.answers,
          checked.arcade.active.answers,
        );
      }
      if (i < initial.arcade.active.itemIds.length - 1)
        await button("Next question").click();
      else await button("Finish round").click();
    }
    const done = await state();
    assert.equal(done.arcade.active, null);
    assert.equal(done.arcade.history.length, 1);
    assert.equal(done.arcade.history[0].total, mode === "conversation" ? 3 : 5);
    parseProgress(
      JSON.stringify(done),
      curriculum.missions.map((m) => m.id),
    );
    ok(
      `${mode}: complete round, single question, hint/correction evidence, reload and valid backup`,
    );
  }
  let booster = { ...emptyProgress(), arcade: emptyArcade() };
  booster.arcade.settings.mode = "verbs";
  booster.arcade.settings.support = "recall";
  booster.arcade.settings.verbLevel = "past";
  booster = startArcadeRound(booster, [arcadeItemById.get("verb:andare:past:0")], today, "female-past", true);
  await seed(booster);
  await page.locator("#arcade-answer").fill("sono andata");
  await page.reload();
  await page.locator("#arcade-answer").waitFor({ state: "visible" });
  assert.equal(await page.locator("#arcade-answer").inputValue(), "sono andata");
  await button("Check answer").click();
  assert.equal(await page.locator(".arcade-answer").innerText(), "sono andata");
  assert.equal((await state()).arcade.records["verb:andare:past:0"].last.correct, true);
  assert.equal(await page.locator(".booster-forms").getAttribute("open"), null);
  await page.locator(".booster-forms summary").click();
  assert.equal(await page.locator(".booster-forms tbody tr").count(), 6);
  await page.locator(".arcade-round-help summary").click();
  assert.match(await page.locator(".arcade-source-note").innerText(), /original practice/);
  assert.ok(!/src-[a-f0-9]/.test(await page.locator(".arcade-source-note").innerText()));
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: `${output}/en-${width}-verb-feedback.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  ok("Typed past tense preserves drafts and accepted feminine answer; six-person reminder and named lesson sources fit phone and desktop");
  booster = { ...emptyProgress(), arcade: emptyArcade() };
  booster.arcade.settings.wordFocus = "articles";
  booster.arcade.settings.support = "recall";
  booster = startArcadeRound(booster, [arcadeItemById.get("noun:zaino:plural")], today, "noun-plural", true);
  await seed(booster);
  await page.locator("#arcade-answer").fill("gli zaini");
  await button("Check answer").click();
  assert.equal((await state()).arcade.records["noun:zaino:plural"].last.correct, true);
  await button("Save this word").click();
  assert.ok(Object.values((await state()).academy.words).some((word) => word.term.it === "lo zaino" && word.starred));
  ok("Noun plural recall checks the full article+noun phrase and saves the noun to the personal word bank");
  let p = { ...emptyProgress(), arcade: emptyArcade() };
  p.arcade.settings.mode = "builder";
  p.arcade.settings.support = "recall";
  p.language = "it";
  await seed(p);
  await button("Giochiamo").click();
  assert.ok(await page.locator(".arcade-word-cues").isVisible());
  await page.locator("#arcade-answer").fill("La chiave");
  await page.reload();
  assert.equal(await page.locator("#arcade-answer").inputValue(), "La chiave");
  await button("Inserisci è").click();
  assert.ok((await page.locator("#arcade-answer").inputValue()).includes("è"));
  ok(
    "Italian typed builder preserves word clues and draft; accent keyboard inserts Italian characters",
  );
  p = { ...emptyProgress(), arcade: emptyArcade() };
  p.arcade.settings.support = "recall";
  const slash = arcadeItems.find(
    (x) => x.mode === "words" && x.answers[0].includes("/"),
  );
  p = startArcadeRound(p, [slash], today, "slash", true);
  await seed(p);
  assert.ok(await page.locator(".arcade-option").count());
  p.arcade.active = null;
  p.arcade.settings.mode = "detective";
  const choice = arcadeItems.find((x) => x.id === "grammar:noun-gender-3");
  p = startArcadeRound(p, [choice], today, "choice", true);
  await seed(p);
  assert.ok(await page.locator(".arcade-option").count());
  ok(
    "Recall mode keeps necessary choices for paired vocabulary and choice-dependent grammar",
  );
  p = { ...emptyProgress(), arcade: emptyArcade() };
  await seed(p);
  await button("Let’s play").click();
  await answerCurrent();
  await button("Save this word").click();
  assert.ok(
    Object.values((await state()).academy.words).some((x) => x.starred),
  );
  await button("Pause & save").click();
  await page.locator(".today-options > summary").click();
  await button("Open games").click();
  await page.locator(".arcade-feedback").waitFor({ state: "visible" });
  await page.locator(".arcade-round-help summary").click();
  await button("End this round early").click();
  await button("Keep playing").click();
  assert.ok((await state()).arcade.active);
  await button("End this round early").click();
  await button("End round and choose again").click();
  assert.equal((await state()).arcade.active, null);
  assert.equal(Object.keys((await state()).arcade.records).length, 1);
  ok(
    "Word saving, pause/resume, cancel early-end and explicit early-end retain submitted practice",
  );
  for (const language of ["en", "it"])
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 });
      p = { ...emptyProgress(), language, arcade: emptyArcade() };
      await seed(p);
      await go("games");
      for (const expanded of [false, true]) {
        if (expanded) await page.locator(".arcade-customise summary").click();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        );
        assert.equal(
          overflow,
          false,
          `${language}/${width}/settings:${expanded}`,
        );
        const rects = await page
          .locator("#arcade-game, #arcade-focus, .arcade-start .button")
          .evaluateAll((els) =>
            els.map((el) => {
              const r = el.getBoundingClientRect();
              return { width: r.width, height: r.height, right: r.right };
            }),
          );
        assert.ok(rects.every((r) => r.height >= 44 && r.right <= width + 1));
        if (!expanded) {
          await page.evaluate(() =>
            window.scrollTo({ top: 0, behavior: "instant" }),
          );
          await page.screenshot({
            path: `${output}/${language}-${width}-lobby.png`,
            fullPage: true,
          });
        }
      }
      await button(language === "en" ? "Let’s play" : "Giochiamo").click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      assert.equal(await page.locator(".arcade-question").count(), 1);
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
      await page.screenshot({
        path: `${output}/${language}-${width}-question.png`,
        fullPage: true,
      });
      await go("today");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
      await page.screenshot({
        path: `${output}/${language}-${width}-today.png`,
        fullPage: true,
      });
    }
  ok(
    "English and Italian at 320, 390 and 1440 pixels fit without overflow; new targets are at least 44px",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go("games");
  p = { ...emptyProgress(), arcade: emptyArcade() };
  await seed(p);
  await page.locator("#arcade-game").focus();
  await page.keyboard.press("Home");
  assert.equal((await state()).arcade.settings.mode, "words");
  await button("Let’s play").focus();
  await page.keyboard.press("Enter");
  await page.locator(".arcade-option").nth(0).focus();
  await page.keyboard.press("Enter");
  assert.ok(
    await page
      .locator(".arcade-feedback")
      .evaluate((el) => el === document.activeElement),
  );
  ok(
    "Keyboard-only game selection and answering work; feedback receives focus",
  );
  assert.deepEqual(errors, []);
  ok("No browser runtime errors in audited journeys");
  await fs.writeFile(
    `${output}/results.json`,
    JSON.stringify(
      {
        url,
        checkedAt: new Date().toISOString(),
        checks,
        errors,
        syntheticProgressOnly: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await fs.writeFile(
    `${output}/failure.json`,
    JSON.stringify({ url, checks, errors, failure: String(error) }, null, 2),
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
