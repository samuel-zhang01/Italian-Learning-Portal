import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emptyDraft, emptyProgress, parseProgress, dayKey, STORAGE_KEY } from "../app/learning/engine.ts";
import { planningMissions } from "../app/learning/planning-data.ts";
import { diagnosticItemIds, emptyA2Diagnostics, startA2Diagnostic } from "../app/learning/a2-diagnostic-model.ts";

// Only disposable owned contexts, generated audio and synthetic progress.
const root = fileURLToPath(new URL("../", import.meta.url));
const base = new URL(process.env.PARLIAMO_URL || "http://127.0.0.1:5200");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname));
const output = path.resolve(root, process.env.PRIVATE_PRACTICE_REPORT_DIR || "work/private-practice-browser");
assert.ok(output.startsWith(`${path.join(root, "work")}${path.sep}`));
execFileSync("git", ["check-ignore", "--quiet", "--", path.relative(root, path.join(output, "probe.json"))]);
const extension = execFileSync("browser-view", ["--root"], { encoding: "utf8" }).trim();
const { chromium } = await import(pathToFileURL(path.join(extension, "node_modules/playwright-core/index.mjs")).href);
const settings = JSON.parse(await fs.readFile("/root/.config/browser-view/settings.json", "utf8"));
const ids = planningMissions.map((item) => item.id), [first, second, third] = ids, today = dayKey();
const completion = (correct) => ({ date: today, firstCorrect: correct, total: 2, output: "Una risposta sintetica personale.", supported: false, confidence: 2 });
function fixture(language = "en") {
  const p = emptyProgress(); p.language = language; p.notes = "Synthetic current notebook.";
  p.completed[first] = completion(0);
  p.drafts[third] = { ...emptyDraft(), output: "La mia bozza non ancora inviata." };
  p.reviews[first] = { due: today, interval: 1, attempts: 1, correct: 0, lastDate: today };
  p.diagnostics = startA2Diagnostic(emptyA2Diagnostics(), "espresso2-u01", today);
  p.diagnostics.runs[`${today}:espresso2-u01`].drafts[diagnosticItemIds("espresso2-u01")[0]] = "Una bozza sintetica A2.";
  return parseProgress(JSON.stringify(p), ids);
}
function backup() {
  const p = emptyProgress(); p.completed[first] = completion(2); p.completed[second] = completion(1);
  p.notes = "Synthetic other-device notebook.";
  p.diagnostics = startA2Diagnostic(emptyA2Diagnostics(), "espresso2-u01", today);
  const run = p.diagnostics.runs[`${today}:espresso2-u01`];
  for (const id of run.itemIds) run.answers[id] = { answer: "Synthetic submitted answer.", correct: true, assisted: false, date: today };
  return parseProgress(JSON.stringify(p), ids);
}
function wave(seconds = 3) {
  const rate = 8000, count = seconds * rate, data = Buffer.alloc(44 + count * 2);
  data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i += 1) data.writeInt16LE(Math.round(Math.sin(i * 440 * Math.PI * 2 / rate) * 3000), 44 + i * 2);
  return data;
}
const checks = [], errors = [], externalRequests = [], mutationRequests = [], screenshots = [];
const contexts = new Set();
let browser, failure;
const pass = (label, evidence = {}) => { checks.push({ label, ...evidence }); process.stdout.write(`PASS ${label}\n`); };
const state = (page) => page.evaluate((key) => { const raw = localStorage.getItem(key); return raw === null ? null : JSON.parse(raw); }, STORAGE_KEY);
const hashRoute = async (page, route) => { await page.evaluate((value) => { location.hash = value; }, route); };
async function createPage(language = "en") {
  const progress = fixture(language);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", locale: language === "it" ? "it-IT" : "en-GB" });
  contexts.add(context);
  await context.addInitScript(({ key, progress }) => {
    if (localStorage.getItem(key) === null && !sessionStorage.getItem("synthetic-seeded")) {
      localStorage.setItem(key, JSON.stringify(progress)); sessionStorage.setItem("synthetic-seeded", "true");
    }
    window.__privatePracticeAudit = { created: [], revoked: [], wraps: 0 };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => { const url = create(value); window.__privatePracticeAudit.created.push(url); return url; };
    URL.revokeObjectURL = (url) => { window.__privatePracticeAudit.revoked.push(url); return revoke(url); };
  }, { key: STORAGE_KEY, progress });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (!["GET", "HEAD"].includes(request.method())) { mutationRequests.push({ method: request.method(), origin: url.origin }); return route.abort(); }
    if (url.origin !== base.origin && !["blob:", "data:"].includes(url.protocol)) { externalRequests.push(url.origin); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => errors.push({ kind: "pageerror", message: error.message.slice(0, 500) }));
  page.on("console", (entry) => { if (entry.type() === "error") errors.push({ kind: "console", message: entry.text().slice(0, 500) }); });
  await page.goto(new URL("/#listening", base).href); await page.locator(".listening-workspace").waitFor();
  return { context, page, progress };
}
async function screenshot(page, name) {
  const file = path.join(output, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); screenshots.push(path.relative(root, file));
}
const chooseBackup = async (page, value, name = "synthetic-backup.json") => {
  await page.locator('.backup-transfer input[type="file"]').setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)) });
};
async function close(context) { await context.close(); contexts.delete(context); }

try {
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true, args: settings.allowNoSandbox ? ["--no-sandbox"] : [] });
  const { page, context, progress } = await createPage();
  const audioInput = page.locator('.listening-workspace input[type="file"]');
  await audioInput.setInputFiles({ name: "synthetic-three-seconds.wav", mimeType: "audio/wav", buffer: wave() });
  await page.waitForFunction(() => document.querySelector("audio")?.duration === 3);
  await page.locator("audio").evaluate((audio) => { audio.muted = true; audio.addEventListener("timeupdate", () => {
    const audit = window.__privatePracticeAudit;
    if (audit.lastTime > audio.currentTime + 0.2) audit.wraps += 1;
    audit.lastTime = audio.currentTime;
  }); });
  await page.getByLabel("Section start · seconds", { exact: true }).fill("0.4");
  await page.getByLabel("Section end · seconds", { exact: true }).fill("0.9");
  await page.getByRole("button", { name: "Play this section", exact: true }).click();
  await page.waitForFunction(() => { const a = document.querySelector("audio"); return a?.paused && Math.abs(a.currentTime - 0.9) < 0.03; });
  const once = await page.locator("audio").evaluate((a) => ({ paused: a.paused, time: a.currentTime, duration: a.duration }));
  await page.getByRole("checkbox", { name: "Repeat this section", exact: true }).check();
  await page.getByRole("button", { name: "Play this section", exact: true }).click();
  await page.waitForFunction(() => window.__privatePracticeAudit.wraps >= 3 && !document.querySelector("audio").paused);
  await page.locator("audio").evaluate((audio) => audio.pause());
  const repeat = await page.evaluate(() => ({ wraps: window.__privatePracticeAudit.wraps, time: document.querySelector("audio").currentTime }));
  assert.deepEqual(await state(page), progress);
  pass("Generated WAV plays a section once to its endpoint, repeats until paused, and never enters progress", { once, repeat });

  const transcript = "Testo sintetico: il treno parte alle nove.\nPorto una piccola valigia.";
  await page.getByText("Paste or change my transcript", { exact: true }).click();
  await page.getByRole("textbox", { name: "Transcript for this recording", exact: true }).fill(transcript);
  await page.getByRole("button", { name: "Use this transcript for reveal", exact: true }).click();
  assert.equal(await page.locator(".listening-reveal").count(), 0);
  await page.getByRole("button", { name: "Reveal one more line", exact: true }).click();
  assert.equal(await page.locator(".listening-reveal li").count(), 1);
  await page.getByRole("button", { name: "Reveal one more line", exact: true }).click();
  assert.equal(await page.locator(".listening-reveal li").count(), 2);
  await page.getByRole("textbox", { name: "My dictation or short summary", exact: true }).fill("Una mia risposta sintetica privata.");
  for (const box of await page.locator(".listening-checks input").all()) await box.check();
  await page.getByText("Self-check complete for this tab. Keep your own notes before leaving.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Hide transcript", exact: true }).click();
  assert.equal(await page.locator(".listening-reveal").count(), 0);
  assert.deepEqual(await state(page), progress);
  await screenshot(page, "en-listening-self-check");
  const oldURL = await page.locator("audio").getAttribute("src");
  await audioInput.setInputFiles({ name: "replacement-synthetic.wav", mimeType: "audio/wav", buffer: wave(2) });
  await page.waitForFunction(() => document.querySelector("audio")?.duration === 2);
  assert.equal(await page.evaluate((url) => window.__privatePracticeAudit.revoked.filter((x) => x === url).length, oldURL), 1);
  await page.getByRole("button", { name: "Disconnect audio", exact: true }).click();
  assert.equal(await page.locator("audio").count(), 0);
  await audioInput.setInputFiles({ name: "unmount-synthetic.wav", mimeType: "audio/wav", buffer: wave() });
  await page.waitForFunction(() => document.querySelector("audio")?.duration === 3);
  await hashRoute(page, "progress"); await page.locator(".backup-transfer").waitFor();
  assert.deepEqual(await page.evaluate(() => ({ created: window.__privatePracticeAudit.created.length, revoked: window.__privatePracticeAudit.revoked.length })), { created: 3, revoked: 3 });
  assert.deepEqual(await state(page), progress);
  pass("Transcript reveal and self-check remain tab-local; replacement, disconnect and leaving each release their audio URL");

  const incoming = backup();
  await chooseBackup(page, incoming); await page.getByRole("heading", { name: "Review before restoring", exact: true }).waitFor();
  assert.deepEqual(await state(page), progress, "file selection cannot mutate progress");
  await page.locator(".restore-preview").getByRole("button", { name: "Merge missing work", exact: true }).click();
  await page.getByText("Missing work merged. Existing answers, drafts and schedules were kept.", { exact: true }).waitFor();
  const merged = await state(page); parseProgress(JSON.stringify(merged), ids);
  assert.deepEqual(merged.completed[first], progress.completed[first]); assert.deepEqual(merged.completed[second], incoming.completed[second]);
  assert.deepEqual(merged.reviews, progress.reviews); assert.deepEqual(merged.drafts, progress.drafts); assert.deepEqual(merged.diagnostics, progress.diagnostics);
  assert.equal(merged.notes, progress.notes);
  pass("Backup selection previews locally; explicit merge preserves first answers, pending lesson/A2 drafts, notes and schedules while adding missing work");

  await chooseBackup(page, "{broken");
  await page.getByText("This is not a valid Parliamo backup. Your current progress is unchanged.", { exact: true }).waitFor();
  assert.deepEqual(await state(page), merged);
  await chooseBackup(page, incoming); await page.getByRole("heading", { name: "Review before restoring", exact: true }).waitFor();
  await page.locator(".restore-preview").getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(await state(page), merged);
  await chooseBackup(page, incoming); await page.getByRole("heading", { name: "Review before restoring", exact: true }).waitFor();
  await page.getByRole("button", { name: "Replace & restore", exact: true }).click();
  await page.getByText("Progress restored.", { exact: true }).first().waitFor();
  const replaced = await state(page); assert.deepEqual({ ...replaced, updatedAt: "" }, { ...incoming, updatedAt: "" });
  pass("Malformed files and cancellation leave progress intact; the separate replacement action retains legacy restore behavior");
  await screenshot(page, "en-backup-restored"); await close(context);

  for (const clear of [false, true]) {
    const { context: other, page: tab, progress: original } = await createPage();
    await hashRoute(tab, "progress"); await tab.locator(".backup-transfer").waitFor();
    await chooseBackup(tab, incoming); await tab.getByRole("heading", { name: "Review before restoring", exact: true }).waitFor();
    const newer = { ...original, notes: "Synthetic newer work saved after preview." };
    await tab.evaluate(({ clear, key, newer }) => { if (clear) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(newer)); }, { clear, key: STORAGE_KEY, newer });
    const merge = tab.locator(".restore-preview").getByRole("button", { name: "Merge missing work", exact: true });
    await merge.click();
    await tab.getByText("The work saved here changed. The preview is updated; review it and choose again.", { exact: true }).waitFor();
    assert.deepEqual(await state(tab), clear ? null : newer, "refreshing a stale preview cannot apply the backup");
    await merge.click(); await tab.getByText("Missing work merged. Existing answers, drafts and schedules were kept.", { exact: true }).waitFor();
    const result = await state(tab); parseProgress(JSON.stringify(result), ids);
    assert.equal(result.notes, clear ? incoming.notes : newer.notes);
    assert.equal(Object.hasOwn(result.drafts, third), !clear, "cleared work cannot be resurrected from the stale tab");
    await close(other);
  }
  pass("A changed or cleared saved record refreshes the preview and requires a second explicit merge, without resurrecting cleared drafts");

  const { context: italian, page: it, progress: italianProgress } = await createPage("it");
  await it.getByRole("heading", { name: "Un po’ di ascolto, al tuo ritmo.", exact: true }).waitFor();
  await it.getByRole("button", { name: "Dettato originale", exact: true }).click();
  await it.getByRole("button", { name: "Svela un’altra frase", exact: true }).click();
  assert.equal(await it.locator(".listening-reveal li").count(), 1);
  assert.equal(await it.locator("audio").count(), 0);
  const overflow = await it.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); assert.equal(overflow, false);
  await screenshot(it, "it-original-dictation-mobile");
  await hashRoute(it, "progress"); await it.locator(".backup-transfer").waitFor();
  await chooseBackup(it, incoming); await it.getByRole("heading", { name: "Controlla prima di ripristinare", exact: true }).waitFor();
  assert.equal(await it.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  assert.deepEqual(await state(it), italianProgress);
  await screenshot(it, "it-backup-preview-mobile");
  await it.reload(); await it.locator(".backup-transfer").waitFor();
  assert.equal(await it.locator(".restore-preview").count(), 0);
  await hashRoute(it, "listening"); await it.locator(".listening-workspace").waitFor();
  assert.equal(await it.locator(".listening-reveal").count(), 0); assert.equal(await it.locator("audio").count(), 0);
  assert.equal(await it.getByRole("textbox", { name: "Il mio dettato o breve riassunto", exact: true }).inputValue(), "");
  await close(italian);
  pass("Italian mobile listening and backup previews fit the viewport; reloading clears tab-only listening and pending imports");
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []); assert.deepEqual(mutationRequests, []);
  pass("All feature journeys made no external or write requests and produced no runtime errors");
} catch (error) { failure = error; process.stderr.write(`${error.stack}\n`); }
finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close(); await fs.mkdir(output, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(output, "report.json"), `${JSON.stringify({ checkedAt: new Date().toISOString(), status: failure ? "failed" : "passed", target: base.origin,
    isolation: "Owned disposable Chromium contexts, generated WAVs and validated synthetic progress only; no shared profile or private source assets.",
    checks, errors, externalRequests, mutationRequests, screenshots,
    limitations: ["The generated local WAV verifies native playback and repeat endpoints; publisher media compatibility is not inferred.", "Device speech availability varies; the original dictation text/reveal fallback is checked without sending speech requests."],
    ...(failure ? { failure: failure.message } : {}) }, null, 2)}\n`, { mode: 0o600 });
}
if (failure) process.exitCode = 1;
