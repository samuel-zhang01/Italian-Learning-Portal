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
const b = await chromium.connectOverCDP(
  process.env.PARLIAMO_CDP_URL || "http://127.0.0.1:9222",
);
for (const kind of ["blocked", "quota", "corrupt"]) {
  const c = await b.newContext();
  const page = await c.newPage();
  await c.addInitScript((kind) => {
    if (kind === "blocked")
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("Denied", "SecurityError");
        },
      });
    if (kind === "quota")
      Storage.prototype.setItem = function () {
        throw new DOMException("Quota", "QuotaExceededError");
      };
    if (kind === "corrupt" && !sessionStorage.getItem("seeded")) {
      localStorage.setItem("parliamo-daily-v1", "BROKEN");
      sessionStorage.setItem("seeded", "yes");
    }
  }, kind);
  await page.goto(appUrl);
  if (kind === "corrupt") {
    await page
      .getByText("Your saved progress could not be read.", { exact: false })
      .waitFor();
    assert.equal(
      await page.evaluate(() => localStorage.getItem("parliamo-daily-v1")),
      "BROKEN",
    );
    await page
      .getByRole("button", { name: "Open recovery", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Recover with a fresh start", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete saved progress", exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("parliamo-daily-v1")).version,
      ),
      1,
    );
  } else {
    await page
      .getByRole("button", { name: "Start my 5-minute lesson", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Try it from memory", exact: true })
      .click();
    await page
      .getByLabel("Your answer in Italian", { exact: true })
      .fill("chiamo");
    await page
      .getByRole("button", { name: "Check my answer", exact: true })
      .click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Your answer in Italian", { exact: true }).fill("ti");
    await page
      .getByRole("button", { name: "Check my answer", exact: true })
      .click();
    await page
      .getByText("Browser storage is unavailable.", { exact: false })
      .waitFor();
    await page.getByRole("button", { name: "Continue", exact: true }).waitFor();
  }
  console.log("PASS", kind, "storage recovery/session");
  await c.close();
}
await b.close();
