import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const browserRoot = execFileSync("browser-view", ["--root"], {
  encoding: "utf8",
}).trim();
const { chromium } = await import(
  pathToFileURL(browserRoot + "/node_modules/playwright-core/index.mjs").href
);
const appUrl = process.env.PARLIAMO_URL || "http://127.0.0.1:3000";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.connectOverCDP(
  process.env.PARLIAMO_CDP_URL || "http://127.0.0.1:9222",
);
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "en-GB",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await fs.mkdir("work", { recursive: true });
const checks = [];
const ok = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
const go = async (route) => {
  await page.goto(appUrl + "/#" + route);
  await page.waitForSelector(".daily-header");
};
const state = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("parliamo-daily-v1")));
try {
  await go("today");
  await page
    .getByRole("button", { name: "Start my 5-minute lesson", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Try it from memory", exact: true })
    .click();
  await page.getByLabel("Your answer in Italian", { exact: true }).fill("sono");
  await page
    .getByRole("button", { name: "Check my answer", exact: true })
    .click();
  await page
    .getByText("A useful mistake. Try once more.", { exact: true })
    .waitFor();
  await page
    .getByLabel("Your answer in Italian", { exact: true })
    .fill(" CHIAMO. ");
  await page
    .getByRole("button", { name: "Check my answer", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Your answer in Italian", { exact: true }).fill("ti");
  await page.reload();
  await page.getByLabel("Your answer in Italian", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByLabel("Your answer in Italian", { exact: true })
      .inputValue(),
    "ti",
  );
  ok("wrong answer correction and reload resume");
  await page.getByRole("button", { name: "IT", exact: true }).click();
  await page
    .getByRole("button", { name: "Controlla la risposta", exact: true })
    .click();
  await page.getByRole("button", { name: "Continua", exact: true }).click();
  await page
    .getByLabel("Il mio italiano", { exact: true })
    .fill("Mi chiamo Ada. Sono studentessa. Come ti chiami?");
  await page.locator(".self-check input").nth(0).check();
  await page.locator(".self-check input").nth(1).check();
  await page
    .getByRole("button", { name: "Salva la mia pratica", exact: true })
    .click();
  await page.getByText("È italiano che puoi usare.", { exact: true }).waitFor();
  let p = await state();
  assert.equal(p.completed["say-hello"].firstCorrect, 1);
  assert.equal(Object.keys(p.completed).length, 1);
  ok("complete lesson in Italian with honest first-attempt score");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page
    .getByRole("button", { name: "Back to today", exact: true })
    .click();
  await page.getByRole("button", { name: "My plan", exact: true }).click();
  await page.getByRole("button", { name: "5 min", exact: true }).click();
  await page
    .getByRole("combobox", { name: "What I’m working on", exact: true })
    .selectOption("3");
  await page.reload();
  await page
    .getByRole("combobox", { name: "What I’m working on", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("combobox", { name: "What I’m working on", exact: true })
      .inputValue(),
    "3",
  );
  ok("daily budget and learning path persist");
  await go("progress");
  await page.locator(".notebook-list summary").click();
  await page
    .getByText("Mi chiamo Ada. Sono studentessa. Come ti chiami?", {
      exact: true,
    })
    .waitFor();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export progress", exact: true })
    .click();
  const download = await downloadEvent;
  const path = await download.path();
  const backup = await fs.readFile(path, "utf8");
  assert.equal(JSON.parse(backup).completed["say-hello"].firstCorrect, 1);
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from("{broken"),
    });
  await page
    .getByText(
      "This is not a valid Parliamo backup. Your current progress is unchanged.",
      { exact: true },
    )
    .waitFor();
  assert.equal(Object.keys((await state()).completed).length, 1);
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(backup),
    });
  await page
    .getByRole("button", { name: "Replace & restore", exact: true })
    .click();
  await page.getByText("Progress restored.", { exact: true }).waitFor();
  ok("export, invalid import rejection and confirmed restore");
  // Make the completed lesson due in this isolated test profile.
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("parliamo-daily-v1"));
    p.reviews["say-hello"].due = "2020-01-01";
    localStorage.setItem("parliamo-daily-v1", JSON.stringify(p));
  });
  await page.reload();
  await go("review/say-hello");
  await page.getByLabel("Your answer in Italian", { exact: true }).fill("ti");
  await page.getByRole("button", { name: "Check recall", exact: true }).click();
  await page.getByLabel("Your answer in Italian", { exact: true }).fill("si");
  await page.getByRole("button", { name: "Check recall", exact: true }).click();
  p = await state();
  assert.equal(p.reviewLog.length, 1);
  assert.equal(p.reviewLog[0].correct, false);
  assert.equal(p.reviews["say-hello"].interval, 1);
  ok("failed delayed recall keeps its first score and schedules tomorrow");
  // All primary screens in both languages on a narrow phone.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const language of ["en", "it"]) {
    await page
      .getByRole("button", { name: language.toUpperCase(), exact: true })
      .click();
    for (const route of [
      "today",
      "path",
      "plan",
      "progress",
      "materials",
      "lesson/where-from",
    ]) {
      await go(route);
      await page.waitForTimeout(70);
      const width = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        view: innerWidth,
      }));
      assert.ok(
        width.doc <= width.view + 1,
        `${language}/${route}: horizontal overflow ${width.doc}`,
      );
      await page.screenshot({
        path: `work/audit-${language}-${route.replace("/", "-")}.png`,
        fullPage: true,
      });
    }
  }
  ok("all primary screens fit 390px in English and Italian");
  await page.setViewportSize({ width: 320, height: 800 });
  await go("today");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  ok("320px home layout fits");
  // Same-browser tabs update without overwriting unrelated changes.
  const second = await ctx.newPage();
  await second.goto(appUrl + "/#progress");
  await second
    .getByLabel("Un appunto per il mio futuro", { exact: true })
    .fill("Ripassare i verbi.");
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "EN", exact: true }).click();
  assert.equal((await state()).notes, "Ripassare i verbi.");
  await second.close();
  ok("two-tab updates retain saved notes");
  assert.deepEqual(errors, []);
  ok("no browser runtime errors");
  await fs.writeFile(
    "work/browser-audit-results.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
} finally {
  await ctx.close();
  await browser.close();
}
