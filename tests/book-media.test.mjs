import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStudyMediaDownloader } from "../scripts/blink-study-media.mjs";

const readerId = "test-course";
const mediaUrl = "https://books.example/study/dialogue.mp3?idcurso=test-course&view=reader";
const sourceUrl = "https://books.example/study/dialogue.mp3";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const media = Buffer.from("synthetic audio bytes");
const limit = 500 * 1024 * 1024;
const oversizedBody = { length: limit + 1, subarray() { throw new Error("Oversized payload must be rejected before inspection"); } };

async function harness(t, plan, files = []) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "parliamo-media-test-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const destination = path.join(temporary, "study");
  const requests = [], writes = [], checkedPaths = [], responses = [], requestErrors = [];
  const pending = [...plan];
  const localPath = (file) => {
    const resolved = path.resolve(file);
    assert.ok(resolved.startsWith(`${destination}${path.sep}`), "All test file access stays in its temporary study directory");
    return resolved;
  };
  const request = Object.fromEntries(["head", "get"].map((method) => [method, async (url, options) => {
    requests.push({ method, url, options });
    const expected = pending.shift();
    try {
      assert.ok(expected, `Unexpected ${method.toUpperCase()} request`);
      assert.equal(method, expected.method);
      if (expected.url) assert.equal(url, expected.url);
      assert.equal(options.headers["Accept-Encoding"], "identity");
      if (expected.range !== undefined) assert.equal(options.headers.Range, expected.range);
    } catch (error) {
      // The downloader catches request errors; retain assertion failures so a
      // rejected download cannot accidentally make a malformed test plan pass.
      requestErrors.push(error);
      throw error;
    }
    const status = expected.status ?? 200;
    const response = {
      bodyCalls: 0,
      disposed: false,
      headers: () => expected.headers ?? {},
      status: () => status,
      ok: () => status >= 200 && status < 300,
      url: () => expected.finalUrl ?? url,
      async body() { this.bodyCalls++; return expected.body ?? Buffer.alloc(0); },
      async dispose() { this.disposed = true; },
    };
    responses.push(response);
    return response;
  }]));
  const downloader = createStudyMediaDownloader({
    request,
    readerId,
    destination,
    mediaManifest: { files },
    async privatePath(file) { const safe = localPath(file); checkedPaths.push(safe); return safe; },
    async atomic(file, body) {
      const safe = localPath(file);
      writes.push({ file: safe, body });
      await mkdir(path.dirname(safe), { recursive: true });
      await writeFile(safe, body, { mode: 0o600 });
    },
  });
  return {
    downloader, destination, requests, writes, checkedPaths, responses,
    async seed(file, bytes) {
      const safe = localPath(path.join(destination, file));
      await mkdir(path.dirname(safe), { recursive: true });
      await writeFile(safe, bytes, { mode: 0o600 });
      return safe;
    },
    complete() {
      assert.deepEqual(requestErrors, [], "Every request met the test's fake transport contract");
      assert.equal(pending.length, 0, "All planned requests were exercised");
      assert.ok(responses.every((response) => response.disposed), "Every acquired response was disposed");
    },
  };
}

const boundedHead = (body = media, mime = "audio/mpeg") => ({
  method: "head", headers: { "content-type": mime, "content-length": String(body.length) },
});
const fullGet = (body = media, mime = "audio/mpeg") => ({
  method: "get", headers: { "content-type": mime }, body,
});

test("media requests preserve the observed course URL while persisted metadata drops its query", async (t) => {
  const h = await harness(t, [boundedHead(), fullGet()]);
  const result = await h.downloader.download({ url: mediaUrl });
  assert.equal(result.status, "downloaded");
  assert.deepEqual(h.requests.map((request) => request.url), [mediaUrl, mediaUrl]);
  assert.equal(result.source, sourceUrl);
  assert.equal(result.sha256, digest(media));
  assert.equal(result.bytes, media.length);
  assert.equal(path.extname(result.file), ".mp3");
  assert.deepEqual(await readFile(h.writes[0].file), media);
  assert.ok(!JSON.stringify(h.downloader.files()).includes("?"));
  assert.ok(!JSON.stringify(h.downloader.files()).includes(readerId));
  h.complete();
});

test("media retries only observed variants and prefers the current course URL", async (t) => {
  const h = await harness(t, [
    { method: "head", url: mediaUrl, status: 403 },
    { method: "get", url: mediaUrl, status: 403, range: "bytes=0-0" },
    { ...boundedHead(), url: sourceUrl },
    { ...fullGet(), url: sourceUrl },
  ]);
  const result = await h.downloader.download({ url: sourceUrl, variants: [sourceUrl, mediaUrl, mediaUrl] });
  assert.equal(result.status, "downloaded");
  assert.deepEqual(h.requests.map((request) => request.url), [mediaUrl, mediaUrl, sourceUrl, sourceUrl]);
  assert.equal(result.source, sourceUrl);
  assert.ok(!JSON.stringify(h.downloader.files()).includes("?"));
  h.complete();
});

test("a bounded 206 probe supplies the extent when HEAD omits Content-Length", async (t) => {
  const h = await harness(t, [
    { method: "head", headers: { "content-type": "audio/mpeg" } },
    { method: "get", status: 206, range: "bytes=0-0", headers: { "content-type": "audio/mpeg", "content-range": `bytes 0-0/${media.length}` }, body: media.subarray(0, 1) },
    { ...fullGet(), status: 206, range: `bytes=0-${media.length - 1}`, headers: { "content-type": "audio/mpeg", "content-range": `bytes 0-${media.length - 1}/${media.length}` } },
  ]);
  const result = await h.downloader.download({ url: mediaUrl });
  assert.equal(result.status, "downloaded");
  assert.equal(result.bytes, media.length);
  assert.deepEqual(h.writes[0].body, media);
  assert.equal(h.responses[1].bodyCalls, 1, "The one-byte probe is inspected before the separate full download");
  h.complete();
});

test("a server ignoring Range with a complete 200 body is saved once with its actual extent", async (t) => {
  const h = await harness(t, [
    { method: "head", headers: { "content-type": "audio/mpeg" } },
    { ...fullGet(), range: "bytes=0-0" },
  ]);
  const result = await h.downloader.download({ url: mediaUrl });
  assert.equal(result.status, "downloaded");
  assert.equal(result.bytes, media.length);
  assert.equal(result.sha256, digest(media));
  assert.equal(h.requests.filter((request) => request.method === "get").length, 1);
  assert.equal(h.writes.length, 1);
  assert.ok(!JSON.stringify(h.downloader.files()).includes("?"));
  h.complete();
});

test("short and long media bodies cannot satisfy a declared byte extent", async (t) => {
  for (const body of [media.subarray(0, media.length - 1), Buffer.concat([media, Buffer.from("!")])]) {
    await t.test(`${body.length} bytes for a ${media.length}-byte declaration`, async (t) => {
      const h = await harness(t, [boundedHead(), fullGet(body)]);
      const result = await h.downloader.download({ url: mediaUrl });
      assert.equal(result.status, "invalid-media-response");
      assert.equal(h.writes.length, 0);
      assert.equal(h.downloader.size(), 0);
      h.complete();
    });
  }
});

test("a full range response with the wrong offset or total is rejected", async (t) => {
  const h = await harness(t, [
    { method: "head", headers: { "content-type": "audio/mpeg" } },
    { method: "get", status: 206, range: "bytes=0-0", headers: { "content-type": "audio/mpeg", "content-range": `bytes 0-0/${media.length}` }, body: media.subarray(0, 1) },
    { ...fullGet(), status: 206, range: `bytes=0-${media.length - 1}`, headers: { "content-type": "audio/mpeg", "content-range": `bytes 1-${media.length}/${media.length + 1}` } },
  ]);
  const result = await h.downloader.download({ url: mediaUrl });
  assert.notEqual(result.status, "downloaded");
  assert.equal(h.writes.length, 0);
  assert.equal(h.downloader.size(), 0);
  h.complete();
});

test("a 206 probe must describe and contain exactly the requested first byte", async (t) => {
  const cases = [
    ["missing range", undefined, media.subarray(0, 1)],
    ["unbounded range", "bytes 0-0/*", media.subarray(0, 1)],
    ["wrong offset", `bytes 1-1/${media.length}`, media.subarray(0, 1)],
    ["wrong end", `bytes 0-1/${media.length}`, media.subarray(0, 1)],
    ["empty probe", `bytes 0-0/${media.length}`, Buffer.alloc(0)],
    ["two-byte probe", `bytes 0-0/${media.length}`, media.subarray(0, 2)],
  ];
  for (const [name, contentRange, body] of cases) {
    await t.test(name, async (t) => {
      const h = await harness(t, [
        { method: "head", headers: { "content-type": "audio/mpeg" } },
        { method: "get", status: 206, range: "bytes=0-0", headers: { "content-type": "audio/mpeg", ...(contentRange ? { "content-range": contentRange } : {}) }, body },
      ]);
      const result = await h.downloader.download({ url: mediaUrl });
      assert.notEqual(result.status, "downloaded");
      assert.equal(h.requests.length, 2, "An invalid probe cannot trigger a full download");
      assert.equal(h.writes.length, 0);
      assert.equal(h.downloader.size(), 0);
      h.complete();
    });
  }
});

test("HTML MIME, disguised HTML, login redirects and oversized media never write files", async (t) => {
  const html = Buffer.from("  <!doctype html><html>Sign in</html>");
  const cases = [
    ["HTML HEAD", [{ ...boundedHead(), headers: { "content-type": "text/html", "content-length": "12" } }]],
    ["HTML GET MIME", [boundedHead(), { ...fullGet(), headers: { "content-type": "text/html" }, body: html }]],
    ["HTML disguised as audio", [boundedHead(html), fullGet(html)]],
    ["login redirect", [boundedHead(), { ...fullGet(), finalUrl: "https://books.example/login?return=reader" }]],
    ["oversized declaration", [{ ...boundedHead(), headers: { "content-type": "audio/mpeg", "content-length": String(limit + 1) } }]],
    ["oversized body", [boundedHead(), fullGet(oversizedBody)]],
  ];
  for (const [name, plan] of cases) {
    await t.test(name, async (t) => {
      const h = await harness(t, plan);
      const result = await h.downloader.download({ url: mediaUrl });
      assert.notEqual(result.status, "downloaded");
      assert.equal(h.writes.length, 0);
      assert.equal(h.downloader.size(), 0);
      h.complete();
    });
  }
});

test("ignored-Range 200 responses still reject HTML, login redirects and excessive bodies", async (t) => {
  const cases = [
    ["HTML MIME", { ...fullGet(), headers: { "content-type": "text/html" } }],
    ["HTML disguised as audio", fullGet(Buffer.from("\n<html>Sign in</html>"))],
    ["login redirect", { ...fullGet(), finalUrl: "https://books.example/signin" }],
    ["oversized body", fullGet(oversizedBody)],
  ];
  for (const [name, probe] of cases) {
    await t.test(name, async (t) => {
      const h = await harness(t, [
        { method: "head", headers: { "content-type": "audio/mpeg" } },
        { ...probe, range: "bytes=0-0" },
      ]);
      const result = await h.downloader.download({ url: mediaUrl });
      assert.notEqual(result.status, "downloaded");
      assert.equal(h.requests.length, 2);
      assert.equal(h.writes.length, 0);
      assert.equal(h.downloader.size(), 0);
      h.complete();
    });
  }
});

test("study captions and transcript PDFs are permitted with verified bytes", async (t) => {
  const captions = Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000\nBuongiorno!\n");
  const subtitles = Buffer.from("1\n00:00:00,000 --> 00:00:01,000\nBuongiorno!\n");
  const transcript = Buffer.from("%PDF-1.4\nSynthetic local transcript fixture\n%%EOF\n");
  for (const [extension, mime, body] of [["vtt", "text/vtt", captions], ["vtt", "text/plain", captions], ["srt", "application/x-subrip", subtitles], ["srt", "text/plain", subtitles], ["pdf", "application/pdf", transcript]]) {
    await t.test(`${mime} .${extension}`, async (t) => {
      const h = await harness(t, [boundedHead(body, mime), fullGet(body, mime)]);
      const result = await h.downloader.download({ url: `https://books.example/study/transcript.${extension}?idcurso=${readerId}` });
      assert.equal(result.status, "downloaded");
      assert.equal(result.mime, mime);
      assert.equal(result.sha256, digest(body));
      assert.equal(path.extname(result.file), `.${extension}`);
      assert.deepEqual(await readFile(h.writes[0].file), body);
      h.complete();
    });
  }
});

test("cache reuse fingerprints the local file instead of trusting metadata", async (t) => {
  const cached = { source: sourceUrl, status: "downloaded", file: "media/cached.mp3", mime: "audio/mpeg", bytes: media.length, sha256: digest(media) };
  const h = await harness(t, [], [cached]);
  const local = await h.seed(cached.file, media);
  const result = await h.downloader.download({ url: mediaUrl });
  assert.deepEqual(result, cached);
  assert.deepEqual(h.checkedPaths, [local]);
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 0);
  h.complete();
});

test("an altered cache with the same byte count is downloaded and hashed again", async (t) => {
  const cached = { source: sourceUrl, status: "downloaded", file: "media/cached.mp3", mime: "audio/mpeg", bytes: media.length, sha256: digest(media) };
  const h = await harness(t, [boundedHead(), fullGet()], [cached]);
  const altered = Buffer.from(media);
  altered[0] ^= 1;
  const local = await h.seed(cached.file, altered);
  const result = await h.downloader.download({ url: mediaUrl });
  assert.equal(result.status, "downloaded");
  assert.deepEqual(h.checkedPaths, [local]);
  assert.equal(h.requests.length, 2);
  assert.equal(h.writes.length, 1);
  assert.equal(result.sha256, digest(media));
  assert.deepEqual(await readFile(h.writes[0].file), media);
  assert.deepEqual(h.downloader.files(), [result]);
  h.complete();
});
