import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const phase = process.argv[2] || "after";
assert.ok(["baseline", "after"].includes(phase));
const base = process.env.PARLIAMO_URL || "http://127.0.0.1:5197";
const root = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(`${root}/node_modules/playwright-core/index.mjs`).href);
const config = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true, args: config.allowNoSandbox ? ["--no-sandbox"] : [] });
const samples = [], errors = [];
try {
  for (let sample = 0; sample < 3; sample++) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route("**/*", async (route) => {
      assert.ok(route.request().url().startsWith(base + "/") && route.request().method() === "GET", "Only local static resources are expected");
      await route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/#today`);
    await page.locator(".session-preview .today-primary-action").waitFor();
    const usableMs = await page.evaluate(() => performance.now());
    await page.waitForLoadState("networkidle");
    const resources = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => ({ path: new URL(r.name).pathname, bytes: r.decodedBodySize, transferBytes: r.transferSize })));
    const scripts = resources.filter((r) => r.path.endsWith(".js"));
    let jsBytes = 0, gzipBytes = 0;
    for (const item of scripts) {
      assert.match(item.path, /^\/assets\/[^/]+\.js$/);
      const body = await fs.readFile(path.join("site-dist", item.path.slice(1)));
      jsBytes += body.length; gzipBytes += gzipSync(body).length;
    }
    samples.push({ usableMs: Math.round(usableMs), jsBytes, gzipBytes, scripts: scripts.map((r) => r.path), resources });
    await context.close();
  }
} finally { await browser.close(); }
assert.deepEqual(errors, []);
const report = { measuredAt: new Date().toISOString(), phase, target: base, method: "Three cold disposable Chromium contexts on localhost, with cache disabled by request routing. Initial Today remains fully usable; compressed bytes are computed from the exact requested built scripts.", samples, medianUsableMs: samples.map((s) => s.usableMs).sort((a,b) => a-b)[1], initialJsBytes: samples[0].jsBytes, initialGzipBytes: samples[0].gzipBytes, errors, limitations: "Local timing is not a real mobile/network performance score. Byte reduction and deferred resource requests are the acceptance measurements." };
await fs.mkdir("work/loading-audit", { recursive: true });
await fs.writeFile(`work/loading-audit/${phase}.json`, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ phase, initialJsBytes: report.initialJsBytes, initialGzipBytes: report.initialGzipBytes, medianUsableMs: report.medianUsableMs, samples: samples.length }));
