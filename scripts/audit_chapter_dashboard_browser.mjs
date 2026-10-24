import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { emptyProgress, parseProgress, dayKey } from "../app/learning/engine.ts";
import { emptyAcademy, getGrammarDraft } from "../app/learning/academy-engine.ts";
import { emptyArcade } from "../app/learning/arcade-engine.ts";
import { emptySession } from "../app/learning/study.ts";
import { BOOK_PROGRAMME_ID, buildChapterCatalogue, nextChapterAction } from "../app/learning/chapter-dashboard.ts";

// Own disposable browser only. No shared CDP, browser profile or learner state.
const root = process.cwd();
const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(path.join(extension, "node_modules/playwright-core/index.mjs")).href);
const config = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const appUrl = process.env.PARLIAMO_URL || "http://127.0.0.1:5197";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(appUrl).hostname), "Only a local preview may be audited");
const evidenceDir = path.resolve(process.env.CHAPTER_DASHBOARD_AUDIT_DIR || "work/chapter-dashboard-audit");
assert.ok(evidenceDir.startsWith(`${path.join(root, "work")}${path.sep}`));
execFileSync("git", ["check-ignore", "--quiet", "--", path.relative(root, path.join(evidenceDir, "probe.png"))]);
const read = async (name) => JSON.parse(await fs.readFile(`app/learning/${name}.json`, "utf8"));
const [curriculum, grammar, enrichment, scenes] = await Promise.all(["curriculum", "grammar", "enrichment", "arcade-scenes"].map(read));
const chapters = buildChapterCatalogue({ missions: curriculum.missions, units: grammar.units, banks: enrichment.banks, scenes: scenes.scenes, programmes: grammar.programmes, sources: curriculum.sources });
const selected = chapters.find((chapter) => chapter.id === "espresso2-u01");
const today = dayKey(), missionIds = curriculum.missions.map((mission) => mission.id);
const checks = [], screenshots = [], layouts = [], errors = [], blockedRequests = [];
const pass = (label, details = {}) => { checks.push({ label, ...details }); console.log("PASS", label); };
let browser, context, page, failure;
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("parliamo-daily-v1")));
const fixture = (language = "en") => {
  const p = emptyProgress();
  p.language = language;
  p.academy = emptyAcademy();
  p.academy.programme = { id: "supported-a1", started: today, day: 3, completed: { "0": today } };
  p.notes = "Synthetic chapter dashboard audit fixture.";
  return p;
};
const until = async (test, label) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await test()) return;
    await page.waitForTimeout(50);
  }
  assert.fail(label);
};
const go = async (route) => {
  await page.goto(`${appUrl}/#${route}`);
  await page.locator(".daily-header").waitFor();
};
const seed = async (p, route = "chapters") => {
  parseProgress(JSON.stringify(p), missionIds);
  await page.evaluate((value) => localStorage.setItem("parliamo-daily-v1", JSON.stringify(value)), p);
  await go(route); await page.reload();
  await page.locator(".chapter-dashboard").waitFor();
};
const currentChapter = () => page.locator(`.chapter-dashboard[data-chapter-id="${selected.id}"]`).waitFor();
const assertProgramme = async (programme) => assert.deepEqual((await state()).academy.programme, programme);
const capture = async (name, locator) => {
  const file = path.join(evidenceDir, `${name}.png`);
  if (locator) await locator.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: true });
  screenshots.push(path.relative(root, file));
};
const layout = async (name, language, width) => {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth,
    overflowingControls: [...document.querySelectorAll("main button,main a,main input,main textarea,main select")]
      .filter((node) => node.getClientRects().length && (() => { const box = node.getBoundingClientRect(); return box.left < -2 || box.right > innerWidth + 2; })())
      .map((node) => node.tagName),
  }));
  layouts.push({ name, language, width, ...dimensions });
  assert.ok(dimensions.document <= dimensions.viewport + 1, `${name}/${language}/${width}: page overflow`);
  assert.deepEqual(dimensions.overflowingControls, [], `${name}/${language}/${width}: control overflow`);
  await capture(`${language}-${width}-${name}`);
};

try {
  await fs.mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true, args: config.allowNoSandbox ? ["--no-sandbox"] : [] });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-GB", reducedMotion: "reduce" });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (!["GET", "HEAD"].includes(request.method()) || (url.protocol !== "blob:" && url.origin !== new URL(appUrl).origin)) {
      blockedRequests.push({ method: request.method(), origin: url.origin }); return route.abort();
    }
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await go("chapters");
  const p = fixture();
  await seed(p);
  assert.equal(await page.locator(".chapter-card").count(), 20);
  await until(() => page.locator(".chapter-dashboard h1").evaluate((node) => document.activeElement === node), "Dashboard heading receives entry focus");
  await page.getByRole("button", { name: "Plus 2 · A2", exact: true }).click();
  await until(async () => await page.locator(".chapter-card").count() === 10, "Book filter shows ten A2 chapters");
  assert.equal(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("book"), "2");
  await page.reload(); await page.locator(".chapter-dashboard").waitFor();
  assert.equal(await page.locator(".chapter-card").count(), 10);
  assert.equal(await page.getByRole("button", { name: "Plus 2 · A2", exact: true }).getAttribute("aria-pressed"), "true");
  await assertProgramme(p.academy.programme);
  pass("Twenty chapters, book filter URL and reload work without replacing the active programme/day");

  await page.locator(".chapter-card").first().getByRole("button").click(); await currentChapter();
  await until(() => page.locator(".chapter-dashboard h1").evaluate((node) => document.activeElement === node), "Chapter heading receives entry focus");
  const action = nextChapterAction(p, selected, grammar.units, today);
  await page.locator(".chapter-next button").click();
  await until(() => Promise.resolve(new URL(page.url()).hash === `#${action.route}`), "Recommendation opens the prerequisite-safe grammar destination");
  await page.locator(".chapter-dashboard").waitFor({ state: "hidden" });
  await assertProgramme(p.academy.programme);
  await page.goBack(); await currentChapter();
  await page.getByRole("button", { name: /Open the chapter lesson/ }).click();
  await until(() => Promise.resolve(new URL(page.url()).hash === `#lesson/${selected.missionId}`), "Chapter core link opens its exact mission");
  await page.locator(".chapter-dashboard").waitFor({ state: "hidden" });
  await page.goBack(); await currentChapter();
  await page.getByRole("button", { name: /Open chapter cards/ }).click();
  await page.locator(".vocabulary-topic-heading").waitFor();
  assert.equal(new URL(page.url()).hash, `#vocabulary/${selected.bankId}`);
  await until(() => page.locator(".vocabulary-topic-heading").evaluate((node) => document.activeElement === node), "Chapter vocabulary receives focus");
  await page.goBack(); await currentChapter();
  await page.getByRole("button", { name: /Try the three-turn scene/ }).click();
  await until(() => Promise.resolve(new URL(page.url()).hash === `#games/${selected.sceneId}`), "Chapter scene opens its exact A2 scene intent");
  await page.locator(".chapter-dashboard").waitFor({ state: "hidden" });
  await assertProgramme(p.academy.programme);
  pass("Chapter prerequisite, core, vocabulary and A2 conversation links are exact, focused and programme-preserving");

  const evidence = fixture();
  evidence.academy.programme = { id: BOOK_PROGRAMME_ID, started: today, day: selected.dayIndices[1], completed: { [selected.dayIndices[0]]: today } };
  evidence.sessions = { [today]: { ...emptySession(selected.missionId, 30), bankId: selected.bankId,
    recalled: selected.wordIds.map((id) => id.replace(/^word:/, "")), gistAnswer: "Irene", retell: "Il regalo è per Paolo.", retellChecks: [true, true] } };
  evidence.arcade = emptyArcade();
  const reply = { answer: "Risposta sintetica.", correct: true, assisted: true };
  for (const id of selected.wordIds) evidence.arcade.records[id] = { first: reply, last: reply, date: today, due: today, successes: 1 };
  for (const id of selected.turnIds) evidence.arcade.records[`scene:${selected.sceneId}:${id}`] = { first: reply, last: reply, date: today, due: today, successes: 1 };
  evidence.academy.grammar[selected.unitIds[0]] = { ...getGrammarDraft(evidence, selected.unitIds[0]), completed: today };
  await seed(evidence, `chapters/${selected.id}`);
  const recorded = await page.locator(".chapter-recorded-evidence").innerText();
  assert.match(recorded, /Not completed/);
  assert.match(recorded, /1\/2 units completed/);
  assert.match(recorded, /1\/4 saved/);
  await page.locator(".chapter-practice-evidence > summary").click();
  const optional = await page.locator(".chapter-practice-evidence").innerText();
  assert.match(optional, /8\/8/); assert.match(optional, /3\/3/);
  assert.match(optional, /your self-report/); assert.match(optional, /may use hints/);
  assert.match(optional, /do not complete a core lesson/);
  await assertProgramme(evidence.academy.programme);
  await capture("en-390-recorded-and-self-report-evidence");
  pass("Recorded core/grammar/checkpoint completion stays distinct from full vocabulary reports, supported replies and saved drafts");

  await go("materials"); await page.locator('.materials-banner input[type="file"]').waitFor();
  await page.locator('.materials-banner input[type="file"]').setInputFiles("materials/books/exports/combined-student-books.pdf");
  await until(async () => await page.locator('.materials-banner input[type="file"]').isEnabled(), "Local PDF hashing completes");
  assert.equal(await page.getByRole("region", { name: "Connected PDFs", exact: true }).locator("li").count(), 2);
  await go(`chapters/${selected.id}`); await currentChapter();
  const reader = selected.sources.find((ref) => ref.kind === "reader");
  const readerCard = page.locator(".chapter-sources article").filter({ has: page.getByRole("heading", { name: reader.source.title, exact: true }) });
  const links = await readerCard.locator("a").evaluateAll((nodes) => nodes.map((node) => ({ text: node.textContent, href: node.href, target: node.target })));
  assert.deepEqual(links.map((link) => link.text), reader.pages.map((number) => `Page ${number}`));
  assert.ok(links.every((link, index) => link.href.startsWith("blob:") && link.href.endsWith(`#page=${reader.pages[index] + 240}`) && link.target === "_blank"));
  assert.match(await readerCard.innerText(), /Pages in the connected export/);
  assert.ok((await page.locator(".chapter-sources").innerText()).includes("TEACHER SUPPORT"));
  await assertProgramme(evidence.academy.programme);
  await capture("en-390-connected-reader-page-offsets", page.locator(".chapter-sources"));
  pass("Actual locally matched combined PDF produces chapter reader links at exact cited physical page +240, with separate teacher-support labels", { physicalPages: reader.pages, offset: 240 });

  for (const language of ["en", "it"]) {
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await seed(fixture(language));
      await layout("overview", language, width);
      await go(`chapters/${selected.id}`); await currentChapter();
      await page.locator(".chapter-practice-evidence > summary").click();
      await layout("chapter-detail", language, width);
      await capture(`${language}-${width}-next-step`, page.locator(".chapter-next"));
      await assertProgramme(fixture(language).academy.programme);
    }
  }
  pass("EN/IT overview and chapter detail fit 320, 390 and 1440 pixel viewports", { layoutChecks: layouts.length });
  assert.deepEqual(errors, []); assert.deepEqual(blockedRequests, []);
  pass("No runtime errors, external requests or network mutations occurred");
} catch (error) {
  failure = { name: error.name, message: error.message, location: error.stack?.split("\n").find((line) => line.includes("audit_chapter_dashboard_browser"))?.trim() };
  if (page) await capture("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {}); await browser?.close().catch(() => {});
  const file = "docs/chapter-dashboard-review.json";
  const review = JSON.parse(await fs.readFile(file, "utf8"));
  review.validation.browser = {
    status: failure ? "failed" : "passed", generator: "scripts/audit_chapter_dashboard_browser.mjs", reviewedOn: today,
    preview: appUrl, method: "Owned disposable headless Chromium with validated synthetic progress; no shared CDP/profile or real learner state.",
    sandboxException: "Existing explicit browser-view allowNoSandbox config used on this root host.",
    workflowGroupsPassed: checks.length, checks, layouts, screenshots, runtimeErrors: errors, blockedRequests,
    ...(failure ? { failure } : {}),
    limits: ["Synthetic evidence isolates dashboard behavior; it does not represent a human completion of all chapters.", "Viewport emulation, not physical phones.", "The existing combined PDF was locally matched for exact link offsets; this does not repeat full PDF export/content verification.", "Publisher media and pronunciation were not exercised.", "No production site, shared reader, local learner database or backups were accessed."],
  };
  await fs.writeFile(file, `${JSON.stringify(review, null, 2)}\n`);
  if (failure) console.error(failure.name, failure.message);
}
