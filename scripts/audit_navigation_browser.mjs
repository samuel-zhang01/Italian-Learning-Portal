import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { emptyProgress, emptyDraft, STORAGE_KEY } from "../app/learning/engine.ts";
import { planningMissions } from "../app/learning/planning-data.ts";

const base = new URL(process.env.PARLIAMO_URL || "http://127.0.0.1:5207");
assert.ok(["127.0.0.1", "localhost", "italian.samuelzhang.co.uk"].includes(base.hostname));
const output = process.env.NAVIGATION_REPORT_DIR || "work/navigation-audit/after";
assert.ok(output.startsWith("work/"));
const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(`${extension}/node_modules/playwright-core/index.mjs`).href);
const settings = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const browser = await chromium.launch({ executablePath: "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true, args: settings.allowNoSandbox ? ["--no-sandbox"] : [] });
const checks = [], frames = [], layouts = [], errors = [], screenshots = [], blockedWrites = [];
let failure;
await fs.mkdir(output, { recursive: true });
async function create(language, width, motion = "no-preference") {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: motion, serviceWorkers: "block" });
  const progress = emptyProgress(); progress.language = language; progress.notes = "Synthetic navigation notebook.";
  progress.drafts[planningMissions[0].id] = { ...emptyDraft(), output: "Una bozza da conservare." };
  await context.addInitScript(({ key, progress }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(progress)); }, { key: STORAGE_KEY, progress });
  const control = { slow: false, delayMs: 800, scripts: [] };
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (!["GET", "HEAD"].includes(request.method())) { blockedWrites.push(url.pathname); return route.abort(); }
    if (url.origin !== base.origin || url.pathname.startsWith("/api/profile/")) return route.abort();
    if (url.pathname.endsWith(".js")) control.scripts.push(url.pathname);
    if (control.slow && url.pathname.endsWith(".js")) await new Promise(resolve => setTimeout(resolve, control.delayMs));
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(18000);
  page.on("pageerror", error => errors.push(error.message));
  return { page, context, control, progress };
}
async function beginFrames(page) {
  await page.evaluate(() => {
    window.navigationFrames = []; window.recordNavigation = true; const start = performance.now();
    const sample = () => {
      const h = document.querySelector("main h1"), nav = document.querySelector(".daily-header nav");
      window.navigationFrames.push({ ms: Math.round(performance.now() - start), heading: h?.textContent ?? null,
        y: scrollY, height: document.documentElement.scrollHeight, navX: nav?.getBoundingClientRect().x,
        pending: !!document.querySelector(".route-pending"), library: !!document.querySelector(".vocab-explorer") });
      if (window.recordNavigation) requestAnimationFrame(sample);
    }; sample();
  });
}
async function endFrames(page, label) {
  const samples = await page.evaluate(() => { window.recordNavigation = false; return window.navigationFrames; });
  frames.push({ label, samples });
  assert.ok(samples.length > 2);
  assert.equal(samples.filter(sample => !sample.heading).length, 0, `${label}: a page disappeared while loading`);
  return samples;
}
async function shot(page, name) { await page.screenshot({ path: `${output}/${name}.png` }); screenshots.push(`${name}.png`); }
async function layout(page, label) {
  const result = await page.evaluate(() => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const controls = [...document.querySelectorAll("main button, main input:not([type=file]), main select, main textarea, .daily-header button")].filter(visible);
    const overflow = controls.filter(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }).map(el => el.textContent.slice(0, 60));
    const nav = [...document.querySelectorAll(".daily-header nav button")].map(el => el.getBoundingClientRect());
    let overlap = false; for (let i = 0; i < nav.length; i++) for (let j = i + 1; j < nav.length; j++) {
      if (Math.min(nav[i].right, nav[j].right) > Math.max(nav[i].left, nav[j].left) + 1 && Math.min(nav[i].bottom, nav[j].bottom) > Math.max(nav[i].top, nav[j].top) + 1) overlap = true;
    }
    return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, overflow, overlap, y: scrollY };
  });
  layouts.push({ label, ...result }); assert.ok(result.documentWidth <= result.width + 1, label); assert.deepEqual(result.overflow, [], label); assert.equal(result.overlap, false, label);
}
async function state(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY); }
async function hash(page, route) { await page.evaluate(value => { location.hash = value; }, route); await page.waitForFunction(expected => document.querySelector("main")?.dataset.route === expected && document.querySelector('main[aria-busy="false"] h1'), route); }
const pass = label => { checks.push(label); console.log("PASS", label); };
try {
  for (const language of ["en", "it"]) for (const width of [390, 1440]) {
    const { page, context, control, progress } = await create(language, width);
    await page.goto(`${base.origin}/#today`); await page.locator(".today-workspace").waitFor();
    control.slow = true; await beginFrames(page);
    await page.locator(".daily-header nav").getByRole("button", { name: language === "en" ? "Practice" : "Pratica", exact: true }).click();
    await page.locator(".route-pending").waitFor();
    assert.ok(await page.locator(".today-workspace").isVisible(), "Outgoing page remains usable during loading");
    await page.locator(".practice-hub").waitFor(); await page.waitForTimeout(80);
    const samples = await endFrames(page, `slow-practice-${language}-${width}`);
    assert.ok(samples.some(sample => sample.pending));
    assert.ok(Math.max(...samples.map(sample => sample.navX)) - Math.min(...samples.map(sample => sample.navX)) < 1, "Scrollbar changes must not shift navigation");
    assert.equal(await page.evaluate(() => scrollY), 0);
    await layout(page, `practice-${language}-${width}`);
    const actions = await page.locator(".practice-hub-actions > .button").evaluateAll(nodes => nodes.map(node => ({ y: node.getBoundingClientRect().y, h: node.getBoundingClientRect().height })));
    if (width === 1440) assert.ok(Math.max(...actions.map(a => a.y)) - Math.min(...actions.map(a => a.y)) < 1, "Main actions align across the cards");
    const action = page.locator(".practice-hub-actions > .button").first(); const before = await action.boundingBox(); await action.hover(); await page.waitForTimeout(180); assert.deepEqual(await action.boundingBox(), before, "Hover must not move the click target");
    await shot(page, `practice-${language}-${width}`);
    control.slow = false;
    await page.getByRole("button", { name: language === "en" ? "Explore my word library →" : "Esplora il mio lessico →", exact: true }).click();
    await page.locator(".vocab-explorer").waitFor();
    await page.getByRole("searchbox", { name: language === "en" ? "Search English or Italian" : "Cerca in inglese o italiano", exact: true }).fill("giacca");
    const filteredHash = await page.evaluate(() => location.hash);
    control.slow = true; await beginFrames(page);
    await page.locator(".practice-switcher").getByRole("button", { name: language === "en" ? "Grammar" : "Grammatica", exact: true }).click();
    await page.locator(".route-pending").waitFor(); assert.ok(await page.locator(".vocab-explorer").isVisible());
    await page.locator(".workspace.academy").waitFor(); await page.waitForTimeout(100);
    const librarySamples = await endFrames(page, `library-to-grammar-${language}-${width}`);
    assert.ok(librarySamples.filter(sample => sample.pending).every(sample => sample.library), "Retained library must not switch view when URL changes");
    assert.equal(await page.evaluate(() => scrollY), 0, "The navigation remains visible on a new catalogue");
    await page.goBack(); await page.locator(".vocab-explorer").waitFor();
    assert.equal(await page.evaluate(() => location.hash), filteredHash);
    assert.equal(await page.locator(".word-search input").inputValue(), "giacca");
    await page.goForward(); await page.locator(".workspace.academy").waitFor();
    await page.locator(".daily-header nav").getByRole("button", { name: language === "en" ? "Today" : "Oggi", exact: true }).click();
    await page.locator(".today-workspace").waitFor();
    // Find is still cold. The second click must cancel it without showing it later.
    await page.locator(".daily-header nav").getByRole("button", { name: language === "en" ? "Find" : "Cerca", exact: true }).click();
    await page.locator(".route-pending").waitFor();
    await page.locator(".daily-header nav").getByRole("button", { name: language === "en" ? "Today" : "Oggi", exact: true }).click();
    await page.waitForTimeout(control.delayMs * 2 + 200);
    assert.ok(await page.locator(".today-workspace").isVisible()); assert.equal(await page.evaluate(() => location.hash), "#today");
    assert.equal(await page.locator(".route-pending").count(), 0);
    assert.deepEqual(await state(page), progress, "Navigation must not change notebook or unfinished answers");
    pass(`Slow navigation retains content; aligned stable controls; library Back/Forward; rapid clicks and saved drafts: ${language}/${width}`);
    await context.close();
  }
  for (const language of ["en", "it"]) {
    const { page, context, control, progress } = await create(language, 390);
    await page.goto(`${base.origin}/#today`); await page.locator(".today-workspace").waitFor();
    control.slow = true;
    await page.locator(".daily-header nav").getByRole("button", { name: language === "en" ? "Practice" : "Pratica", exact: true }).focus();
    await page.waitForTimeout(80);
    assert.ok(control.scripts.some(name => /practice-hub-/.test(name)), "Keyboard focus should start loading the chosen destination before activation");
    await page.keyboard.press("Enter"); await page.locator(".route-pending").waitFor();
    assert.ok(await page.locator(".today-workspace").isVisible());
    await page.locator(".practice-hub").waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), "main-content");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "SUMMARY");
    await page.keyboard.press("Enter"); assert.equal(await page.locator(".practice-menu").getAttribute("open"), "");
    await page.keyboard.press("Enter"); assert.equal(await page.locator(".practice-menu").getAttribute("open"), null);
    assert.deepEqual(await state(page), progress);
    await context.close();
  }
  pass("Keyboard focus preloads the destination; Enter navigates, focus moves to content and the tools menu remains operable");
  for (const initial of ["grammar/noun-gender?practice=1", "games?mode=verbs", "chapters?book=2", "diagnostics?chapter=espresso2-u01"]) {
    const { page, context, control, progress } = await create("en", 1440);
    await page.goto(`${base.origin}/#${initial}`); await page.locator("main h1").first().waitFor();
    await page.waitForTimeout(100);
    const before = await page.locator("main").innerText(); control.slow = true;
    await page.locator(".daily-header nav").getByRole("button", { name: "Find", exact: true }).click();
    await page.locator(".route-pending").waitFor();
    assert.equal(await page.locator("main").innerText(), before, `${initial}: outgoing page mode must not change to the next URL's parameters`);
    await page.locator(".discovery-workspace").waitFor();
    assert.deepEqual(await state(page), progress); await context.close();
  }
  pass("Outgoing grammar, verb, chapter and diagnostic modes stay unchanged while the next page loads");
  const routes = ["today", "practice", "programmes", "grammar", "grammar/noun-gender", "discover", "progress", "vocab-boost?view=library", "reviews", "materials", "session", "chapters", "words", "plan", "offline", "games?mode=verbs", "vocabulary", "listening", "listen-speak", "weekly", "diagnostics", "readiness", "tense", "profile", "companion"];
  for (const width of [320, 390, 768, 1440]) for (const language of ["en", "it"]) {
    const { page, context } = await create(language, width, "reduce");
    await page.goto(`${base.origin}/#today`); await page.locator(".today-workspace").waitFor();
    for (const route of routes) { await hash(page, route); await page.waitForTimeout(80); await layout(page, `${language}-${width}-${route}`); }
    await page.locator(".practice-menu > summary").click(); await layout(page, `${language}-${width}-expanded-tools`);
    if ([390, 1440].includes(width)) { await hash(page, "vocab-boost?view=library"); await shot(page, `library-${language}-${width}`); }
    await context.close();
  }
  pass("EN/IT layout matrix: 25 pages and expanded navigation at 320, 390, 768 and 1440 px, with reduced motion");
  assert.deepEqual(errors, []);
  // Production may send edge analytics; all non-read requests were blocked.
  assert.ok(blockedWrites.every(path => path === "/cdn-cgi/rum"));
} catch (error) { failure = error; console.error(error.stack); }
finally {
  await browser.close();
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ checkedAt: new Date().toISOString(), target: base.origin, status: failure ? "failed" : "passed", checks, frames: frames.map(({ label, samples }) => ({ label, samples: samples.length, blankFrames: samples.filter(s => !s.heading).length, pendingFrames: samples.filter(s => s.pending).length })), layouts, errors, blockedWrites, screenshots, ...(failure ? { failure: failure.message } : {}), limitations: "Synthetic owned Chromium profiles; 800 ms delays affect new JavaScript requests. This is a navigation/layout regression check, not a real-device network benchmark." }, null, 2) + "\n");
  await fs.writeFile(path.join(output, "frames.json"), JSON.stringify(frames) + "\n");
}
if (failure) process.exitCode = 1;
