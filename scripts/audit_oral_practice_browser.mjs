import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emptyProgress, parseProgress, addDays, STORAGE_KEY } from "../app/learning/engine.ts";
import { oralPracticeScenes } from "../app/learning/oral-practice-data.ts";
import {
  advanceOralPractice, checkOralChoice, completeOralPractice, emptyOralPractice,
  oralRunKey, saveOralChoice, saveOralRetell, setOralRetellCheck, startOralPractice,
} from "../app/learning/oral-practice-model.ts";

// Six bounded workflows in disposable contexts. No shared browser or real audio.
process.umask(0o077);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(`${extension}/node_modules/playwright-core/index.mjs`).href);
const settings = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const base = (process.env.PARLIAMO_URL || "http://127.0.0.1:5200").replace(/\/+$/, "");
const origin = new URL(base); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const phase = process.env.ORAL_QA_PHASE || "all"; assert.ok(["all", "budget"].includes(phase));
const out = path.resolve(root, process.env.ORAL_REPORT_DIR || "work/oral-practice-learner-audit");
const relative = path.relative(path.join(root, "work"), out);
assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
execFileSync("git", ["check-ignore", "--quiet", "--no-index", path.join(out, "browser-report.json")], { cwd: root });
const curriculum = JSON.parse(await fs.readFile(path.join(root, "app/learning/curriculum.json"), "utf8"));
const ids = curriculum.missions.map((mission) => mission.id);
const TODAY = "2026-10-26", NEXT = "2026-10-27";
const scene = (id) => oralPracticeScenes.find((item) => item.id === id);
const route = (id, key, transfer = false) => `listen-speak?scene=${id}&run=${encodeURIComponent(key)}${transfer ? "&return=1" : ""}`;
const checks = [], screenshots = [], layouts = [], errors = [], blockedRequests = [], audioIntents = [];
let browser, context, page, sample, failure, evidenceReady = false, completedFive;
const pass = (label, detail = {}) => { checks.push({ label, ...detail }); console.log("PASS", label, JSON.stringify(detail)); };
const until = async (predicate, label) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await page.waitForTimeout(50); } assert.fail(label); };
const raw = () => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
const stored = async () => JSON.parse(await raw());
const ordinary = (p) => { const copy = { ...p }; delete copy.oralPractice; delete copy.updatedAt; return copy; };
const blank = (language = sample.language) => { const p = emptyProgress(); p.language = language; p.plan.start = TODAY; return p; };
const go = async (target) => { await page.goto(`${base}/#${target}`); await page.locator(".daily-header").waitFor(); };
const seed = async (p, target) => {
  p = parseProgress(JSON.stringify(p), ids); await go("today");
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: JSON.stringify(p) });
  await go(target); await page.reload(); await page.locator(".daily-header").waitFor();
  await until(async () => await page.locator("html").getAttribute("lang") === p.language, "Synthetic language hydrates."); return p;
};
const focus = async (locator) => { await locator.waitFor(); await until(() => locator.evaluate((node) => document.activeElement === node), "The selected task or feedback receives keyboard focus."); };
const capture = async (name, target) => {
  if (target) await target.scrollIntoViewIfNeeded();
  const size = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(size.document <= size.width + 1, `Horizontal overflow: ${name}`); layouts.push({ name, ...sample, ...size });
  const file = `${sample.language}-${sample.width}-${name}.png`; await page.screenshot({ path: path.join(out, file), fullPage: false }); screenshots.push(file);
};
const open = async (language, width, voice = "it") => {
  sample = { language, width, height: width === 1440 ? 1000 : 844 };
  context = await browser.newContext({ viewport: { width, height: sample.height }, locale: "en-GB", reducedMotion: "reduce", acceptDownloads: true });
  const contextSample = { ...sample };
  await context.exposeBinding("__oralAuditRecord", (_source, intent) => audioIntents.push({ ...contextSample, ...intent }));
  await context.route("**/*", (intercept) => { const request = intercept.request(), url = new URL(request.url()); if (url.origin === origin.origin && ["GET", "HEAD"].includes(request.method())) return intercept.continue(); blockedRequests.push({ origin: url.origin, method: request.method() }); return intercept.abort(); });
  await context.addInitScript((voiceLanguage) => {
    window.__oralAuditSpeech = [];
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel() {}, getVoices: () => [{ lang: voiceLanguage === "it" ? "it-IT" : "en-GB", name: "Audit voice" }], speak: (speech) => { const intent = { lang: speech.lang, rate: speech.rate, characters: speech.text.length }; window.__oralAuditSpeech.push(intent); void window.__oralAuditRecord(intent); } } });
  }, voice);
  page = await context.newPage(); page.setDefaultTimeout(12000); page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00Z`) });
};
const close = async () => { await context.close(); context = undefined; };
const textBox = () => page.locator(".oral-production textarea");
const modelButton = () => page.getByRole("button", { name: sample.language === "en" ? "Show a possible version · use support" : "Mostra una versione possibile · usa un aiuto", exact: true });
const checkButton = () => page.getByRole("button", { name: sample.language === "en" ? "Check my understanding" : "Controlla la mia comprensione", exact: true });
const start = async (id, minutes) => {
  await go(`listen-speak?minutes=${minutes}`); await page.locator(".oral-scene-grid").waitFor();
  const card = page.locator(".oral-scene-grid article").filter({ has: page.getByRole("heading", { name: scene(id).title[sample.language], exact: true }) });
  await card.getByRole("button").click(); await focus(page.locator(".oral-run h1"));
  const key = oralRunKey(TODAY, id); assert.equal((await stored()).oralPractice.runs[key].budget, minutes); return key;
};
const choose = async (value, keyboard = false) => {
  const radio = page.locator(`.oral-question input[value="${value}"]`);
  if (keyboard) { await radio.focus(); await radio.press("Space"); } else await radio.check();
  if (keyboard) { await checkButton().focus(); await checkButton().press("Enter"); } else await checkButton().click();
  await page.locator(".oral-question .feedback").waitFor(); await focus(page.locator(".oral-question .feedback"));
};
const advance = async () => { await page.locator(".oral-continue").click(); await focus(page.locator(".oral-run h1")); };
const checkProduction = async () => { await page.locator(".oral-self-check input").nth(0).check(); await page.locator(".oral-self-check input").nth(1).check(); };

async function fiveMinuteFlow() {
  await open("en", 390); const initial = await seed(blank(), "today"); const before = await raw();
  await page.locator(".today-oral-link button").click(); await page.locator(".oral-catalogue").waitFor(); assert.equal(await raw(), before);
  const key = await start("oral-market", 5); assert.equal(await page.locator(".oral-transcript").count(), 0); assert.equal(await page.locator(".oral-model").count(), 0);
  await page.locator(".oral-player details summary").click(); await page.locator(".oral-player textarea").fill("I expect a request and an alternative.");
  await page.getByRole("button", { name: "Listen to the scene", exact: true }).click(); assert.equal((await stored()).oralPractice.runs[key].transcriptSeen, false);
  await page.locator('.oral-question input[value="gist-a"]').check(); await page.reload(); await page.locator(".oral-question").waitFor(); assert.equal(await page.locator('.oral-question input[value="gist-a"]').isChecked(), true);
  await checkButton().click(); await focus(page.locator(".oral-question .feedback"));
  let run = (await stored()).oralPractice.runs[key]; assert.deepEqual(run.gist.first, { choiceId: "gist-a", correct: false, supported: false, date: TODAY });
  assert.equal(await page.locator('.oral-question input[value="gist-b"]').isDisabled(), true, "The explanation does not overwrite a first failure.");
  const readText = page.locator(".oral-player button[aria-expanded]");
  await readText.scrollIntoViewIfNeeded(); await readText.focus(); await readText.press("Enter"); await page.locator(".oral-transcript").waitFor();
  await until(() => readText.evaluate((node) => document.activeElement === node), "Opening text after checked feedback must keep focus on its trigger.");
  await page.reload(); await page.locator(".oral-question .feedback").waitFor(); assert.equal((await stored()).oralPractice.runs[key].gist.first.correct, false);
  await advance(); await textBox().waitFor(); assert.equal((await stored()).oralPractice.runs[key].detail.first, undefined);
  assert.match(await page.locator(".oral-frame").innerText(), /Vorrei/);
  await textBox().fill("Vorrei un chilo di pomodori. Prendo due chili di zucchine. Pago sei euro."); await modelButton().click();
  await page.reload(); await textBox().waitFor(); assert.match(await textBox().inputValue(), /zucchine/); assert.equal((await stored()).oralPractice.runs[key].modelSeen, true); assert.equal(await page.locator(".oral-model").count(), 0);
  await checkProduction(); await page.locator(".oral-complete").click(); await page.locator(".oral-summary").waitFor(); await focus(page.locator(".oral-run h1"));
  completedFive = await stored(); run = completedFive.oralPractice.runs[key]; assert.equal(run.completed, TODAY); assert.equal(run.due, NEXT); assert.equal(run.gist.first.correct, false); assert.equal(run.gist.first.supported, false); assert.deepEqual(ordinary(completedFive), ordinary(initial));
  await capture("five-minute-summary", page.locator(".oral-summary")); await close();
  pass("5-minute Today alternative preserves wrong-first evidence, supports retelling, survives stage reloads and leaves the usual plan unchanged", { language: "en", width: 390 });
}

async function tenMinuteFlow() {
  await open("it", 320); const initial = await seed(blank(), "listen-speak?minutes=10"); const key = await start("oral-delay", 10);
  await page.getByRole("button", { name: "Leggi il testo della scena · usa un aiuto", exact: true }).click(); assert.equal(await page.locator(".oral-transcript > div").count(), 4);
  await page.reload(); await page.locator(".oral-question").waitFor(); assert.equal(await page.locator(".oral-transcript").count(), 0); assert.equal((await stored()).oralPractice.runs[key].transcriptSeen, true);
  await choose("gist-a"); assert.equal((await stored()).oralPractice.runs[key].gist.first.supported, true); await advance();
  await choose("detail-a"); const first = (await stored()).oralPractice.runs[key].detail.first; assert.equal(first.correct, false); assert.equal(first.supported, true);
  await page.reload(); await page.locator(".oral-question .feedback").waitFor(); assert.deepEqual((await stored()).oralPractice.runs[key].detail.first, first); await advance();
  assert.match(await page.locator(".oral-frame").innerText(), /Nora aspettava/);
  await textBox().fill("Nora aspettava il treno. Ha preso l’autobus ed è arrivata al cinema alle sei."); await modelButton().click();
  await page.locator(".oral-self-check input").nth(0).check(); await page.reload(); await textBox().waitFor(); assert.equal(await page.locator(".oral-self-check input").nth(0).isChecked(), true);
  await textBox().fill("Nora aspettava il treno quando hanno annunciato la cancellazione. È arrivata al cinema alle sei."); assert.equal(await page.locator(".oral-self-check input").nth(0).isChecked(), false);
  await checkProduction(); await page.locator(".oral-complete").click(); await page.locator(".oral-summary").waitFor();
  const p = await stored(); assert.deepEqual(ordinary(p), ordinary(initial)); assert.equal(p.oralPractice.runs[key].detail.first.correct, false);
  await capture("ten-minute-summary", page.locator(".oral-summary")); await go("weekly"); await page.locator(".weekly-learning-report").waitFor();
  const card = page.locator(".insights-report-grid section").filter({ has: page.getByRole("heading", { name: "Breve pratica di ascolto e parlato", exact: true }) });
  assert.deepEqual(await card.locator("dd").allTextContents(), ["1", "1", "1", "0", "2", "0"]); await capture("weekly-oral-evidence", card);
  await close(); pass("10-minute supported comprehension and detail feedback survive reload; retell edits reset self-checks and weekly counts stay separate", { language: "it", width: 320 });
}

async function laterDayFlow() {
  await open("en", 390); const key = oralRunKey(TODAY, "oral-market"); await seed(completedFive, route("oral-market", key, true));
  await page.getByRole("heading", { name: "Return on another day", exact: true }).waitFor(); assert.equal(await page.locator(".oral-production").count(), 0); assert.equal((await stored()).oralPractice.runs[key].transfer, undefined);
  await page.clock.setFixedTime(new Date(`${NEXT}T12:00:00Z`)); await page.reload(); await textBox().waitFor(); await focus(page.locator(".oral-run h1"));
  assert.match(await page.locator(".oral-production").innerText(), /bread rolls/); assert.equal((await stored()).oralPractice.runs[key].transfer, undefined, "Opening a fresh task does not count it as completed.");
  await textBox().fill("Vorrei quattro panini. Va bene, prendo i tre panini. Sono tre euro. Grazie."); await modelButton().click();
  await page.reload(); await textBox().waitFor(); assert.match(await textBox().inputValue(), /quattro/); assert.equal((await stored()).oralPractice.runs[key].transfer.modelSeen, true);
  await checkProduction(); await page.locator(".oral-complete").click(); await page.locator(".oral-summary").waitFor();
  const after = (await stored()).oralPractice.runs[key], before = completedFive.oralPractice.runs[key]; assert.equal(after.transfer.completed, NEXT); assert.deepEqual({ ...after, transfer: undefined }, { ...before, transfer: undefined });
  assert.match(await page.locator(".oral-summary").innerText(), /not a speaking level or proof of improvement/); await capture("later-day-fresh-task", page.locator(".oral-summary")); await close();
  pass("Clock-controlled later-day response is unavailable early, saves fresh self-assessed work and retains the earlier first failure");
}

function completedFixture(id, budget = 5, wrong = false) {
  const key = oralRunKey(TODAY, id), content = scene(id); let state = startOralPractice(emptyOralPractice(), id, budget, TODAY);
  state = saveOralChoice(state, key, "gist", wrong ? content.gist.options.find((option) => option.id !== content.gist.correctOptionId).id : content.gist.correctOptionId); state = checkOralChoice(state, key, "gist", TODAY); state = advanceOralPractice(state, key);
  if (budget === 10) { state = saveOralChoice(state, key, "detail", content.detail.correctOptionId); state = checkOralChoice(state, key, "detail", TODAY); state = advanceOralPractice(state, key); }
  state = saveOralRetell(state, key, "Una versione sintetica con un dettaglio cambiato."); state = setOralRetellCheck(state, key, 0, true); state = setOralRetellCheck(state, key, 1, true); return completeOralPractice(state, key, TODAY);
}
const importBackup = async (p) => { await page.locator('.backup-transfer input[type="file"]').setInputFiles({ name: "synthetic-oral-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(p)) }); await page.locator(".restore-preview").waitFor(); };
async function backupFlow() {
  await open("en", 1440); await seed(completedFive, "progress");
  const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "Export progress", exact: true }).click(); const download = await downloadPromise;
  const exportPath = path.join(out, "synthetic-oral-export.json"); await download.saveAs(exportPath); const exported = parseProgress(await fs.readFile(exportPath, "utf8"), ids); assert.deepEqual(exported.oralPractice, completedFive.oralPractice);
  for (const run of Object.values(exported.oralPractice.runs)) for (const key of ["audio", "recording", "transcript", "lines", "url"]) assert.equal(Object.hasOwn(run, key), false);
  const incoming = blank("en"); incoming.plan.minutes = 10; incoming.plan.course = 3;
  incoming.oralPractice = { version: 1, runs: { ...completedFixture("oral-market").runs, ...completedFixture("oral-delay", 10).runs } };
  const before = await raw(); await importBackup(incoming); assert.equal(await raw(), before, "Selecting a backup is a local preview.");
  await page.getByRole("button", { name: "Merge missing work", exact: true }).click(); await until(async () => await page.locator(".restore-preview").count() === 0, "Merge completes.");
  const merged = await stored(); assert.equal(Object.keys(merged.oralPractice.runs).length, 2); assert.deepEqual(merged.oralPractice.runs[oralRunKey(TODAY, "oral-market")], completedFive.oralPractice.runs[oralRunKey(TODAY, "oral-market")]); assert.deepEqual(merged.plan, completedFive.plan);
  await importBackup(incoming); await page.getByRole("button", { name: "Replace & restore", exact: true }).click(); await until(async () => await page.locator(".restore-preview").count() === 0, "Explicit replacement completes.");
  assert.deepEqual((await stored()).oralPractice, incoming.oralPractice); assert.deepEqual((await stored()).plan, incoming.plan);
  const sparse = blank("en"); await importBackup(sparse); await page.getByRole("button", { name: "Replace & restore", exact: true }).click(); await until(async () => await page.locator(".restore-preview").count() === 0, "Old sparse backup loads."); assert.equal((await stored()).oralPractice, undefined);
  await go("listen-speak"); await page.locator(".oral-catalogue").waitFor(); assert.equal(await page.locator(".oral-history").count(), 0); await capture("sparse-backup-catalogue"); await close();
  pass("Local export/preview/whole-run merge/explicit replace preserve first evidence and exclude audio payloads; sparse old backups still open");
}

async function keyboardFlow() {
  await open("it", 390, "unavailable"); await seed(blank(), "listen-speak?minutes=5"); const key = await start("oral-invitation", 5);
  await page.getByRole("button", { name: "Ascolta la scena", exact: true }).focus(); await page.keyboard.press("Enter"); await page.getByText("Qui non è disponibile una voce italiana. Puoi leggere la scena sotto oppure chiedere a qualcuno di leggerla ad alta voce.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Leggi il testo della scena · usa un aiuto", exact: true }).click(); await choose("gist-c", true);
  assert.equal((await stored()).oralPractice.runs[key].gist.first.supported, true); await page.keyboard.press("Tab"); assert.equal(await page.locator(".oral-continue").evaluate((node) => document.activeElement === node), true);
  await page.keyboard.press("Enter"); await focus(page.locator(".oral-run h1")); await textBox().waitFor();
  await page.getByRole("button", { name: "EN", exact: true }).click(); assert.match(await page.locator(".oral-frame").innerText(), /Il mio amico/); assert.equal((await stored()).oralPractice.runs[key].modelSeen, false);
  await capture("keyboard-fallback-retell", page.locator(".oral-production")); await close();
  pass("Keyboard checking focuses feedback then Continue; unavailable voice requires explicit supported reading and Italian scaffolding remains available");
}

async function compactLayouts() {
  const sampled = [];
  for (const [language, width] of [["en", 320], ["it", 1440]]) {
    await open(language, width); const p = blank(); await seed(p, "listen-speak?minutes=10"); await page.locator(".oral-catalogue").waitFor(); assert.equal(await page.locator(".oral-scene-grid article").count(), 3); await capture("catalogue-layout");
    if (width === 320) {
      p.oralPractice = emptyOralPractice(); const sceneIds = oralPracticeScenes.map((item) => item.id);
      for (let index = 0; index < 200; index++) p.oralPractice = startOralPractice(p.oralPractice, sceneIds[index % 3], 5, addDays(TODAY, -Math.floor(index / 3) - 1));
      await seed(p, "listen-speak"); await page.getByText(/You have 200 saved sessions/).waitFor(); assert.equal(Object.keys((await stored()).oralPractice.runs).length, 200); await capture("capacity-guidance");
    }
    sampled.push({ language, width }); await close();
  }
  pass("Complementary phone/desktop layouts and the 200-run export guidance remain usable with sparse or full synthetic history", { layouts: sampled });
}

async function budgetVisualFollowUp() {
  await open("en", 320); await seed(blank(), "listen-speak?minutes=5");
  const observed = [];
  const luminance = (color) => {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map((value) => Number(value) / 255);
    assert.equal(channels?.length, 3, "Budget colors must have measurable RGB channels.");
    const linear = channels.map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  };
  const contrast = (foreground, background) => { const a = luminance(foreground), b = luminance(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
  for (const minutes of [5, 10]) {
    await page.getByRole("button", { name: `${minutes} minutes`, exact: true }).click();
    const selected = page.locator('.oral-budget button[aria-pressed="true"]'), other = page.locator('.oral-budget button[aria-pressed="false"]');
    await until(async () => await selected.innerText() === `${minutes} minutes`, "Budget choice updates.");
    assert.equal(await selected.evaluate((node) => node.classList.contains("primary")), true);
    const styles = await page.locator(".oral-budget button").evaluateAll((nodes) => nodes.map((node) => { const style = getComputedStyle(node); return { selected: node.getAttribute("aria-pressed") === "true", foreground: style.color, background: style.backgroundColor }; }));
    const active = styles.find((value) => value.selected), inactive = styles.find((value) => !value.selected);
    assert.notEqual(active.background, inactive.background, "The selected budget must visibly differ from the other button.");
    assert.notEqual(active.foreground, inactive.foreground, "Selected and unselected text treatments must remain distinct.");
    const activeContrast = contrast(active.foreground, active.background), inactiveContrast = contrast(inactive.foreground, inactive.background);
    assert.ok(activeContrast >= 4.5 && inactiveContrast >= 4.5, "Both budget labels must retain at least 4.5:1 text contrast.");
    assert.equal(await other.evaluate((node) => node.classList.contains("secondary")), true);
    observed.push({ minutes, active, inactive, activeContrast, inactiveContrast }); await capture(`budget-selected-${minutes}`, page.locator(".oral-budget"));
  }
  await close(); pass("Final selected-budget primary/secondary computed styles are distinct for 5 and 10 minutes at EN320", { observed });
}

try {
  await fs.mkdir(out, { recursive: true }); const realWork = await fs.realpath(path.join(root, "work")), realOut = await fs.realpath(out); assert.ok(!path.relative(realWork, realOut).startsWith("..")); evidenceReady = true;
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true, args: settings.allowNoSandbox ? ["--no-sandbox"] : [] });
  if (phase === "budget") await budgetVisualFollowUp();
  else { await fiveMinuteFlow(); await tenMinuteFlow(); await laterDayFlow(); await backupFlow(); await keyboardFlow(); await compactLayouts(); }
  assert.deepEqual(errors, []); assert.deepEqual(blockedRequests, []);
} catch (error) { failure = error; console.error(error.stack || error); if (page && evidenceReady && !page.isClosed()) await capture("failure").catch(() => {}); }
finally {
  if (context) await context.close().catch(() => {}); if (browser) await browser.close().catch(() => {});
  if (evidenceReady) await fs.writeFile(path.join(out, phase === "all" ? "browser-report.json" : "browser-report-budget.json"), `${JSON.stringify({ date: new Date().toISOString(), base, phase, synthetic: true, isolatedBrowser: true, fixedClock: TODAY, laterClock: NEXT, workflowGroups: checks.length, checks, screenshots, layouts, errors, blockedRequests, audioIntents, passed: !failure, failure: failure?.message ?? null, limitations: ["Synthetic learner workflows, not empirical learning or retention research.", "Device speech was replaced by a deterministic intent stub or an explicit unavailable-voice case; pronunciation quality and actual comprehension were not assessed.", "Only disposable synthetic progress/backups were exported, merged or replaced. No microphone, shared profile, source recording or real learner records were accessed."] }, null, 2)}\n`);
}
if (failure) process.exitCode = 1;
