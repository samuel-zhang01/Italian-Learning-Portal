import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emptyDraft, emptyProgress, parseProgress, dayKey, STORAGE_KEY } from "../app/learning/engine.ts";
import { getGrammarDraft, selectProgramme } from "../app/learning/academy-engine.ts";
import { emptySession } from "../app/learning/study.ts";
import { planningMissions, planningPages, planningUnits } from "../app/learning/planning-data.ts";

// Own disposable browser only: no shared CDP, profile or real learner storage.
const root = fileURLToPath(new URL("../", import.meta.url));
const base = new URL(process.env.PARLIAMO_URL || "http://127.0.0.1:5197");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Loading audit requires a localhost preview");
assert.ok(["http:", "https:"].includes(base.protocol));
const output = path.resolve(root, process.env.LOADING_REPORT_DIR || "work/loading-browser");
assert.ok(output.startsWith(`${path.join(root, "work")}${path.sep}`), "Evidence belongs in ignored work/");
execFileSync("git", ["check-ignore", "--quiet", "--", path.relative(root, path.join(output, "probe.json"))]);
const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(path.join(extension, "node_modules/playwright-core/index.mjs")).href);
const settings = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const today = dayKey(), ids = planningMissions.map((mission) => mission.id);
const mission = planningMissions.find((item) => item.id.startsWith("espresso2-u01-"));
const unit = planningUnits[0];
assert.ok(mission && unit && planningPages[0]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fixture = (language = "en") => {
  const progress = selectProgramme(emptyProgress(), "supported-a1", today);
  progress.language = language;
  progress.notes = "Synthetic loading audit notebook.";
  progress.sessions = { [today]: { ...emptySession(mission.id, 15, "clothes"),
    warmup: "Una bozza sintetica da conservare.", inputAnswer: "Irene", gistAnswer: "Irene",
    retell: "Un regalo diverso per Paolo.", retellChecks: [true, false] } };
  progress.drafts[planningMissions[0].id] = { ...emptyDraft(), output: "Una risposta ancora incompleta." };
  progress.academy.grammar[unit.id] = { ...getGrammarDraft(progress, unit.id),
    answers: { [unit.exercises[0].id]: "Bozza non ancora inviata." } };
  parseProgress(JSON.stringify(progress), ids);
  return progress;
};
const checks = [], requestsOutsidePreview = [], mutations = [], errors = [], expectedFailureErrors = [], deepRoutes = [], coldToday = [], faults = [], screenshots = [];
const scripts = new Map();
const assets = path.join(root, "site-dist", "assets");
for (const name of await fs.readdir(assets)) {
  if (!name.endsWith(".js")) continue;
  const file = path.join(assets, name), stat = await fs.lstat(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), "Built assets must be ordinary files");
  scripts.set(`/assets/${name}`, await fs.readFile(file, "utf8"));
}
assert.ok(scripts.size > 1, "Build must contain lazy chunks before running this audit");

// Prove actual teaching bodies reside in deferred chunks, without reporting text.
const read = async (name) => JSON.parse(await fs.readFile(path.join(root, "app/learning", `${name}.json`), "utf8"));
const [grammar, companion, enrichment, scenes] = await Promise.all(["grammar", "companion", "enrichment", "arcade-scenes"].map(read));
const candidates = {
  grammar: grammar.units.flatMap((item) => item.teaching.map((pair) => pair.it)),
  companion: companion.pages.map((item) => item.task.it),
  enrichment: enrichment.lessons.flatMap((item) => item.skills ? [item.skills.retell.model.it] : []),
  scenes: scenes.scenes.flatMap((scene) => scene.turns.map((turn) => turn.prompt.it)),
};
const sentinels = Object.entries(candidates).map(([category, values]) => {
  const text = values.find((value) => value.length > 80 && !/["\\\n\r]/.test(value)
    && [...scripts.values()].some((body) => body.includes(value)));
  assert.ok(text, `A compiled ${category} body is required for a real payload check`);
  return { category, text, sha256: hash(text), assets: [...scripts].filter(([, body]) => body.includes(text)).map(([name]) => name) };
});
const pass = (label, detail = {}) => { checks.push({ label, ...detail }); process.stdout.write(`PASS ${label}\n`); };
let browser, failure;
const contexts = new Set();
async function createPage(language = "en") {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", locale: language === "it" ? "it-IT" : "en-GB" });
  contexts.add(context);
  const progress = fixture(language), control = { blockLazy: false, initial: new Set(), blocked: new Set(), scripts: new Set(), phase: "healthy" };
  await context.addInitScript(({ progress, key }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(progress));
  }, { progress, key: STORAGE_KEY });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (!["GET", "HEAD"].includes(request.method())) {
      mutations.push({ method: request.method(), origin: url.origin }); return route.abort();
    }
    if (url.origin !== base.origin) { requestsOutsidePreview.push(url.origin); return route.abort(); }
    if (url.pathname.endsWith(".js")) {
      control.scripts.add(url.pathname);
      if (control.blockLazy && !control.initial.has(url.pathname)) {
        control.blocked.add(url.pathname); return route.abort("failed");
      }
    }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const error = (kind, message) => {
    const entry = { kind, message: message.slice(0, 600) };
    if (control.phase === "fault" && control.blocked.size) expectedFailureErrors.push(entry);
    else errors.push(entry);
  };
  page.on("pageerror", (value) => error("pageerror", value.message));
  page.on("console", (value) => { if (value.type() === "error") error("console", value.text()); });
  return { context, page, progress, control };
}
const state = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
const go = async (page, route) => {
  await page.goto(new URL(`/#${route}`, base).href);
  await page.locator(".daily-header").waitFor();
};
const changeRoute = (page, route) => page.evaluate((value) => { window.location.hash = value; }, route);
async function closeContext(context) { await context.close(); contexts.delete(context); }
async function screenshot(page, name) {
  const target = path.join(output, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true }); screenshots.push(path.relative(root, target));
}

try {
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
    headless: true, args: settings.allowNoSandbox ? ["--no-sandbox"] : [],
  });
  for (const language of ["en", "it"]) {
    const { context, page, progress, control } = await createPage(language);
    await go(page, "today"); await page.locator(".today-primary-action").waitFor();
    await page.waitForLoadState("networkidle");
    const requested = [...control.scripts];
    assert.ok(requested.length && requested.every((name) => scripts.has(name)));
    for (const item of sentinels) assert.ok(!item.assets.some((asset) => control.scripts.has(asset)), `${item.category} teaching payload loaded on cold Today`);
    assert.ok(!requested.some((name) => /\/(?:academy|chapters|companion|grammar|enrichment|enriched|arcade-scenes)-/.test(name)));
    assert.deepEqual(await state(page), progress, "hydrating Today must preserve unfinished synthetic work");
    coldToday.push({ language, scripts: requested, jsBytes: requested.reduce((sum, name) => sum + Buffer.byteLength(scripts.get(name)), 0), hydrated: true, primaryActionVisible: true });
    await screenshot(page, `${language}-cold-today`);
    await closeContext(context);
  }
  pass("Cold EN/IT Today is usable and hydrates unfinished progress without requesting full teaching payloads", { languages: 2, payloadCategories: sentinels.length });

  const routes = [
    ["grammar/noun-gender", ".academy-steps"], ["programmes", ".programme-workspace"],
    [`companion/${planningPages[0].id}`, ".academy-companion-layout"], ["discover", ".discovery-workspace"],
    ["session", ".session-page"], ["vocabulary/espresso2-u01", ".vocabulary-topic-heading"],
    ["games/espresso2-u01", ".arcade"], ["chapters/espresso2-u01", ".chapter-dashboard"],
    ["reviews", ".review-hub"], ["words", 'h1:text-is("Words that stay with you.")'],
  ];
  for (const [route, selector] of routes) {
    const { context, page, progress, control } = await createPage();
    await go(page, route); await page.locator(selector).first().waitFor();
    await page.waitForLoadState("networkidle");
    assert.equal(await page.locator('main [role="alert"]').count(), 0);
    assert.deepEqual(await state(page), progress, `opening ${route} must retain synthetic evidence`);
    deepRoutes.push({ route, loaded: true, scripts: [...control.scripts] });
    await closeContext(context);
  }
  pass("Ten direct lazy-route URLs load their study tools and preserve saved drafts", { routes: deepRoutes.length });

  for (const language of ["en", "it"]) {
    const { context, page, progress, control } = await createPage(language);
    await go(page, "today"); await page.locator(".today-primary-action").waitFor(); await page.waitForLoadState("networkidle");
    control.initial = new Set(control.scripts); control.phase = "fault"; control.blockLazy = true;
    const route = `grammar/${unit.id}`;
    await changeRoute(page, route);
    const alert = page.locator('main [role="alert"]');
    await alert.getByRole("heading", { name: language === "en" ? "This section could not load." : "Questa sezione non si è caricata.", exact: true }).waitFor();
    assert.ok(control.blocked.size, "The test must actually fail a new lazy JS request");
    const retryName = language === "en" ? "Reload this section" : "Ricarica questa sezione";
    assert.ok(await alert.getByRole("button", { name: retryName, exact: true }).isVisible());
    assert.deepEqual(await state(page), progress);
    await screenshot(page, `${language}-lazy-failure`);
    await page.locator(".daily-header nav").getByRole("button", { name: language === "en" ? "Today" : "Oggi", exact: true }).click();
    await page.locator(".today-workspace").waitFor();
    assert.equal(await page.locator('main [role="alert"]').count(), 0);
    assert.deepEqual(await state(page), progress);
    await changeRoute(page, route); await alert.getByRole("button", { name: retryName, exact: true }).waitFor();
    control.blockLazy = false;
    await alert.getByRole("button", { name: retryName, exact: true }).click();
    await page.getByRole("heading", { name: unit.title[language], level: 1, exact: true }).waitFor();
    await page.waitForLoadState("networkidle"); control.phase = "healthy";
    assert.deepEqual(await state(page), progress);
    await changeRoute(page, "session"); await page.locator(".session-page").waitFor();
    const label = language === "en" ? "A phrase I can remember" : "Una frase che ricordo";
    const draft = page.getByRole("textbox", { name: label, exact: true });
    assert.equal(await draft.inputValue(), progress.sessions[today].warmup);
    const updated = "Bozza sintetica aggiornata dopo il ripristino.";
    await draft.fill(updated);
    await page.waitForFunction(({ key, date, value }) => JSON.parse(localStorage.getItem(key)).sessions[date].warmup === value, { key: STORAGE_KEY, date: today, value: updated });
    await page.reload(); await draft.waitFor(); assert.equal(await draft.inputValue(), updated);
    const restored = await state(page); parseProgress(JSON.stringify(restored), ids);
    assert.deepEqual(restored.drafts, progress.drafts);
    assert.deepEqual(restored.academy, progress.academy);
    assert.equal(restored.sessions[today].bankId, "clothes");
    assert.equal(restored.sessions[today].retell, progress.sessions[today].retell);
    faults.push({ language, blockedScripts: [...control.blocked], retryVisible: true, leftFailureRoute: true, reloadRecovered: true, priorDraftsIntact: true, newDraftResumed: true });
    await screenshot(page, `${language}-recovered-session`);
    await closeContext(context);
  }
  pass("Forced lazy-JS failures show bilingual recovery; leaving the route and reloading both work without losing drafts", { languages: 2 });
  assert.deepEqual(requestsOutsidePreview, []); assert.deepEqual(mutations, []); assert.deepEqual(errors, []);
  pass("Owned synthetic browsers made no external requests or progress API calls; healthy journeys had no runtime errors");
} catch (error) {
  failure = error; process.stderr.write(`${error.stack}\n`);
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close();
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  const report = { checkedAt: new Date().toISOString(), status: failure ? "failed" : "passed", target: base.origin,
    isolation: "Owned disposable Chromium contexts and validated synthetic state; no shared CDP/profile or learner data.",
    checks, coldToday, deepRoutes, faults, deferredBodySentinels: sentinels.map(({ category, sha256, assets }) => ({ category, sha256, assets })),
    errors, expectedFailureErrors, requestsOutsidePreview, mutations, screenshots,
    limitations: ["The forced fault aborts static lazy-script requests; it does not simulate every hosting/network failure.", "The recovery button reloads the document, matching the user-facing instruction; synthetic saved work remains browser-local.", "Byte/timing benchmarks are recorded separately; this audit verifies request boundaries and recovery behaviour."],
    ...(failure ? { failure: failure.message } : {}) };
  await fs.writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
if (failure) process.exitCode = 1;
