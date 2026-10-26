import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emptyProgress, STORAGE_KEY } from "../app/learning/engine.ts";

// Isolated local-only audit. Never connects to the shared browser or real audio.
const root = fileURLToPath(new URL("../", import.meta.url));
const base = new URL(process.env.PARLIAMO_URL || "http://127.0.0.1:5200");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname));
const output = path.resolve(root, process.env.TRANSFER_REPORT_DIR || "work/learner-audit-transfer/regression");
assert.ok(output.startsWith(`${path.join(root, "work")}${path.sep}`));
execFileSync("git", ["check-ignore", "--quiet", "--", path.relative(root, path.join(output, "probe.json"))]);
const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(path.join(extension, "node_modules/playwright-core/index.mjs")).href);
const settings = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const labels = {
  en: { original: "Original dictation", local: "My local audio", draft: "My dictation or short summary", reveal: "Reveal one more line", editor: "Paste or change my transcript", transcript: "Transcript for this recording", use: "Use this transcript for reveal", routine: "A short listening-to-speaking routine" },
  it: { original: "Dettato originale", local: "Il mio audio locale", draft: "Il mio dettato o breve riassunto", reveal: "Svela un’altra frase", editor: "Incolla o cambia la trascrizione", transcript: "Trascrizione della registrazione", use: "Usa questa trascrizione per lo svelamento", routine: "Un breve percorso dall’ascolto al parlato" },
};
const checks = [], errors = [], outside = [], writes = [], screenshots = [], scripts = new Set();
const contexts = new Set();
let browser, failure;
const controls = async (page, draftLabel) => ({ draft: await page.getByRole("textbox", { name: draftLabel, exact: true }).inputValue(), revealed: await page.locator(".listening-reveal li").count(), checks: await page.locator(".listening-checks input").evaluateAll((inputs) => inputs.map((input) => input.checked)) });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
async function assertCleared(page, label) {
  assert.deepEqual(await controls(page, label), { draft: "", revealed: 0, checks: [false, false, false] });
}
try {
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true, args: settings.allowNoSandbox ? ["--no-sandbox"] : [] });
  for (const language of ["en", "it"]) for (const width of [320, 390]) {
    const t = labels[language], progress = emptyProgress(); progress.language = language; progress.plan.minutes = 10; progress.plan.course = 2;
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" }); contexts.add(context);
    await context.addInitScript(({ key, progress }) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(progress)); }, { key: STORAGE_KEY, progress });
    await context.route("**/*", (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!["GET", "HEAD"].includes(request.method())) { writes.push({ origin: url.origin, method: request.method() }); return route.abort(); }
      if (url.origin !== base.origin) { outside.push(url.origin); return route.abort(); }
      if (url.pathname.endsWith(".js")) scripts.add(url.pathname);
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(new URL("/#listening", base).href); await page.locator(".listening-workspace").waitFor();
    const routine = page.locator(".listening-routine");
    assert.equal(await routine.getAttribute("open"), null);
    await routine.getByText(t.routine, { exact: true }).click();
    assert.equal(await routine.locator("li").count(), 5); assert.equal(await overflow(page), false);
    await page.getByRole("button", { name: t.original, exact: true }).click();
    await page.locator(".listening-workspace select").first().selectOption("delay");
    await page.getByRole("textbox", { name: t.draft, exact: true }).fill("Aspettavo l’autobus; poi sono andata al museo.");
    await page.getByRole("button", { name: t.reveal, exact: true }).click();
    await page.getByRole("button", { name: t.reveal, exact: true }).click();
    await page.locator(".listening-checks input").nth(0).check(); await page.locator(".listening-checks input").nth(2).check();
    const original = await controls(page, t.draft);
    await page.getByRole("button", { name: t.original, exact: true }).click();
    assert.deepEqual(await controls(page, t.draft), original, "tapping the active original source must preserve the draft, reveal and checks");
    assert.equal(await page.locator(".listening-workspace select").first().inputValue(), "delay");
    await page.getByRole("button", { name: t.local, exact: true }).click(); await assertCleared(page, t.draft);
    await page.getByText(t.editor, { exact: true }).click();
    await page.getByRole("textbox", { name: t.transcript, exact: true }).fill("Oggi viaggio in treno. Domani vado a piedi.");
    await page.getByRole("button", { name: t.use, exact: true }).click();
    await page.getByRole("textbox", { name: t.draft, exact: true }).fill("Domani viaggio con mia sorella.");
    await page.getByRole("button", { name: t.reveal, exact: true }).click();
    await page.locator(".listening-checks input").nth(1).check();
    const local = await controls(page, t.draft);
    await page.getByRole("button", { name: t.local, exact: true }).click();
    assert.deepEqual(await controls(page, t.draft), local, "tapping the active local source must preserve the draft, reveal and checks");
    assert.equal(await overflow(page), false);
    if ((language === "en" && width === 390) || (language === "it" && width === 320)) {
      const file = path.join(output, `${language}-${width}-routine.png`); await page.screenshot({ path: file, fullPage: true }); screenshots.push(path.relative(root, file));
    }
    await page.getByRole("button", { name: t.original, exact: true }).click(); await assertCleared(page, t.draft);
    assert.deepEqual(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY), progress);
    await page.reload(); await page.locator(".listening-workspace").waitFor(); await assertCleared(page, t.draft);
    assert.equal(await page.locator(".listening-routine").getAttribute("open"), null);
    assert.deepEqual(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY), progress);
    checks.push({ language, width, optionalRoutine: "collapsed by default, five bilingual steps, no overflow", selectedSources: "both preserve response/reveal/self-checks", changedSources: "both clear task state", reload: "ephemeral work cleared; stored progress unchanged" });
    process.stdout.write(`PASS ${language} ${width}px listening transfer and source continuity\n`);
    await context.close(); contexts.delete(context);
  }
  assert.deepEqual(errors, []); assert.deepEqual(outside, []); assert.deepEqual(writes, []);
} catch (error) { failure = error; process.stderr.write(`${error.stack}\n`); }
finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close(); await fs.mkdir(output, { recursive: true, mode: 0o700 });
  const index = await fs.readFile(path.join(root, "site-dist/index.html"));
  await fs.writeFile(path.join(output, "report.json"), `${JSON.stringify({ checkedAt: new Date().toISOString(), status: failure ? "failed" : "passed", target: base.origin,
    buildIndexSHA256: createHash("sha256").update(index).digest("hex"), scripts: [...scripts],
    isolation: "Owned disposable Chromium contexts and synthetic tab-local responses; no shared profile, real audio or learner data.",
    checks, errors, outsideRequests: outside, writeRequests: writes, screenshots,
    limitations: ["This checks source continuity, bilingual phone usability and local state boundaries, not comprehension or speaking gains.", "No device speech or publisher recording was played in this regression; native section playback has a separate generated-WAV audit."],
    ...(failure ? { failure: failure.message } : {}) }, null, 2)}\n`, { mode: 0o600 });
}
if (failure) process.exitCode = 1;
