import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import catalogue from "../app/learning/pdf-bundles.json" with { type: "json" };
import { createLocalPdfStore, localPdfPageHref } from "../app/learning/local-pdfs.ts";

function fixture() {
  const content = "%PDF-1.7\nA local study book";
  const hash = createHash("sha256").update(content).digest("hex");
  const source = {
    id: `src-${hash.slice(0, 12)}`,
    path: "materials/books/originals/book.pdf",
    title: "book.pdf · reader XPS → PDF",
    sha256: hash,
  };
  const created = [], revoked = [];
  const store = createLocalPdfStore([source], {
    createObjectURL: (file) => {
      created.push(file);
      return `blob:local-${created.length}`;
    },
    revokeObjectURL: (url) => revoked.push(url),
  });
  return { content, source, created, revoked, store };
}

test("local PDF identity follows its SHA-256 rather than a renamed filename or a catalogue title suffix", async () => {
  const { content, source, store, created, revoked } = fixture();
  const file = new File([content], "my-renamed-study-copy.pdf", { type: "application/pdf" });
  const result = await store.connect(file);
  assert.deepEqual(result, { name: file.name, status: "matched", sourceId: source.id });
  assert.deepEqual(store.snapshot(), { [source.id]: "blob:local-1" });
  assert.equal(created[0], file);
  assert.deepEqual(revoked, []);
  const snapshot = store.snapshot();
  delete snapshot[source.id];
  assert.ok(store.snapshot()[source.id], "external state cannot erase a connection silently");
  store.clear();
});

test("an unmatched file with the expected name creates no object URL and cannot replace a connected source", async () => {
  const { content, source, store, created, revoked } = fixture();
  await store.connect(new File([content], "copy.pdf"));
  const result = await store.connect(new File(["a different edition"], "book.pdf"));
  assert.equal(result.status, "unmatched");
  assert.deepEqual(store.snapshot(), { [source.id]: "blob:local-1" });
  assert.equal(created.length, 1);
  assert.deepEqual(revoked, []);
  store.clear();
});

test("replacement, explicit disconnection and cleanup each revoke the URLs they release", async () => {
  const { content, source, store, revoked } = fixture();
  await store.connect(new File([content], "first.pdf"));
  await store.connect(new File([content], "replacement.pdf"));
  assert.deepEqual(store.snapshot(), { [source.id]: "blob:local-2" });
  assert.deepEqual(revoked, ["blob:local-1"]);
  assert.equal(store.disconnect(source.id), true);
  assert.deepEqual(store.snapshot(), {});
  assert.deepEqual(revoked, ["blob:local-1", "blob:local-2"]);
  assert.equal(store.disconnect(source.id), false);
  await store.connect(new File([content], "third.pdf"));
  store.clear();
  store.clear();
  assert.deepEqual(store.snapshot(), {});
  assert.deepEqual(revoked, ["blob:local-1", "blob:local-2", "blob:local-3"]);
});

test("cleanup cancels an in-flight file read before it can create or retain a URL", async () => {
  const { content, store, created } = fixture();
  let finishRead;
  const file = {
    name: "late.pdf",
    arrayBuffer: () => new Promise((resolve) => { finishRead = resolve; }),
  };
  const pending = store.connect(file);
  store.clear();
  finishRead(await new Blob([content]).arrayBuffer());
  assert.equal((await pending).status, "cancelled");
  assert.equal(created.length, 0);
  assert.deepEqual(store.snapshot(), {});
});

function bundleFixture(changeBundle = (bundle) => bundle, selectSources = (sources) => sources) {
  const contents = ["%PDF-1.7\nFirst book", "%PDF-1.7\nSecond book"];
  const sources = contents.map((content, index) => ({
    id: `src-${index + 1}`,
    path: `materials/books/book-${index + 1}.pdf`,
    sha256: createHash("sha256").update(content).digest("hex"),
    pages: [240, 263][index],
  }));
  const content = "%PDF-1.7\nCombined books";
  const bundle = {
    sha256: createHash("sha256").update(content).digest("hex"),
    pages: 503,
    sources: sources.map((source, index) => ({
      sourceId: source.id, sha256: source.sha256, pages: source.pages, offset: index ? 240 : 0,
    })),
  };
  const created = [], revoked = [];
  const changed = changeBundle(structuredClone(bundle));
  const store = createLocalPdfStore(selectSources(sources), {
    createObjectURL: (file) => {
      created.push(file);
      return `blob:bundle-${created.length}`;
    },
    revokeObjectURL: (url) => revoked.push(url),
  }, Array.isArray(changed) ? changed : [changed]);
  return { content, contents, sources, bundle, store, created, revoked };
}

test("a renamed combined book connects both sources with physical page offsets and one object URL", async () => {
  const { content, sources, store, created } = bundleFixture();
  const result = await store.connect(new File([content], "anything.pdf"));
  assert.deepEqual(result, {
    name: "anything.pdf", status: "matched", sourceId: sources[0].id,
    sourceIds: sources.map((source) => source.id),
  });
  assert.deepEqual(store.snapshot(), { "src-1": "blob:bundle-1", "src-2": "blob:bundle-1" });
  assert.deepEqual(store.offsets(), { "src-1": 0, "src-2": 240 });
  assert.equal(localPdfPageHref(store.snapshot()["src-2"], 1, store.offsets()["src-2"]), "blob:bundle-1#page=241");
  assert.equal(localPdfPageHref(store.snapshot()["src-2"], 33, store.offsets()["src-2"]), "blob:bundle-1#page=273");
  const offsets = store.offsets();
  offsets["src-2"] = 0;
  assert.equal(store.offsets()["src-2"], 240);
  assert.equal(created.length, 1);
  store.clear();
});

test("disconnecting one book keeps the shared bundle URL alive until its last user leaves", async () => {
  const { content, store, revoked } = bundleFixture();
  await store.connect(new File([content], "combined.pdf"));
  assert.equal(store.disconnect("src-1"), true);
  assert.deepEqual(store.snapshot(), { "src-2": "blob:bundle-1" });
  assert.deepEqual(store.offsets(), { "src-2": 240 });
  assert.deepEqual(revoked, []);
  assert.equal(store.disconnect("src-2"), true);
  assert.deepEqual(revoked, ["blob:bundle-1"]);
  assert.deepEqual(store.offsets(), {});
  store.clear();
  assert.deepEqual(revoked, ["blob:bundle-1"]);
});

test("an individual replacement resets its offset without releasing another book's shared URL", async () => {
  const { content, contents, store, revoked } = bundleFixture();
  await store.connect(new File([content], "combined.pdf"));
  const replacement = await store.connect(new File([contents[1]], "second-renamed.pdf"));
  assert.deepEqual(replacement, { name: "second-renamed.pdf", status: "matched", sourceId: "src-2" });
  assert.deepEqual(store.snapshot(), { "src-1": "blob:bundle-1", "src-2": "blob:bundle-2" });
  assert.deepEqual(store.offsets(), { "src-1": 0, "src-2": 0 });
  assert.deepEqual(revoked, []);
  store.disconnect("src-1");
  assert.deepEqual(revoked, ["blob:bundle-1"]);
  store.dispose();
  store.dispose();
  assert.deepEqual(revoked, ["blob:bundle-1", "blob:bundle-2"]);
});

test("replacing a whole bundle and clearing release each shared URL exactly once", async () => {
  const { content, store, revoked } = bundleFixture();
  await store.connect(new File([content], "first.pdf"));
  await store.connect(new File([content], "second.pdf"));
  assert.deepEqual(revoked, ["blob:bundle-1"]);
  store.clear();
  store.clear();
  assert.deepEqual(revoked, ["blob:bundle-1", "blob:bundle-2"]);
  assert.deepEqual(store.snapshot(), {});
  assert.deepEqual(store.offsets(), {});
});

test("disconnect, clear and dispose cancel pending bundle reads before URL creation", async (t) => {
  for (const action of ["disconnect", "clear", "dispose"]) {
    await t.test(action, async () => {
      const { content, store, created } = bundleFixture();
      let finishRead;
      const pending = store.connect({
        name: "late-combined.pdf",
        arrayBuffer: () => new Promise((resolve) => { finishRead = resolve; }),
      });
      if (action === "disconnect") store.disconnect("src-2");
      else store[action]();
      finishRead(await new Blob([content]).arrayBuffer());
      assert.equal((await pending).status, "cancelled");
      assert.equal(created.length, 0);
      assert.deepEqual(store.snapshot(), {});
      assert.deepEqual(store.offsets(), {});
    });
  }
});

test("a disposed store does not read any later file", async () => {
  const { store, created } = bundleFixture();
  store.dispose();
  const result = await store.connect({ name: "after-dispose.pdf", arrayBuffer: () => { throw new Error("must not read"); } });
  assert.equal(result.status, "cancelled");
  assert.deepEqual(created, []);
});

test("unsafe, stale or ambiguous bundle maps cannot connect a file", async (t) => {
  const changes = {
    "negative offset": (b) => { b.sources[1].offset = -1; return b; },
    "fractional offset": (b) => { b.sources[1].offset = 240.5; return b; },
    "beyond the last page": (b) => { b.sources[1].offset += 1; return b; },
    "overlapping ranges": (b) => { b.sources[1].offset = 239; return b; },
    "duplicate source": (b) => { b.sources[1].sourceId = b.sources[0].sourceId; return b; },
    "changed source hash": (b) => { b.sources[1].sha256 = "f".repeat(64); return b; },
    "changed source extent": (b) => { b.sources[1].pages -= 1; return b; },
    "excessive page count": (b) => { b.pages = 100_001; return b; },
    "no sources": (b) => { b.sources = []; return b; },
    "malformed source": (b) => { b.sources[0] = null; return b; },
    "duplicate bundle hash": (b) => [b, structuredClone(b)],
    "too many bundles": (b) => Array.from({ length: 33 }, () => structuredClone(b)),
  };
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, async () => {
      const { content, store, created } = bundleFixture(change);
      assert.equal((await store.connect(new File([content], "combined.pdf"))).status, "unmatched");
      assert.deepEqual(created, []);
      assert.deepEqual(store.snapshot(), {});
    });
  }
});

test("a course containing only one source can recognize that source inside a known bundle", async () => {
  const { content, store } = bundleFixture((bundle) => bundle, (sources) => [sources[1]]);
  const result = await store.connect(new File([content], "subset.pdf"));
  assert.deepEqual(result.sourceIds, ["src-2"]);
  assert.deepEqual(store.snapshot(), { "src-2": "blob:bundle-1" });
  assert.deepEqual(store.offsets(), { "src-2": 240 });
  store.clear();
});

test("local PDF page links replace an old fragment and reject invalid page arithmetic", () => {
  assert.equal(localPdfPageHref("blob:local#page=9", 33), "blob:local#page=33");
  assert.equal(localPdfPageHref("blob:local#zoom=120", 1, 240), "blob:local#page=241");
  for (const [page, offset] of [[0, 0], [-1, 0], [1.5, 0], [1, -1], [1, NaN], [1, Infinity], [1, Number.MAX_SAFE_INTEGER]]) {
    assert.throws(() => localPdfPageHref("blob:local", page, offset), RangeError);
  }
});

test("the production catalogue contains only bounded hash and page metadata for verified PDF exports", () => {
  assert.equal(catalogue.length, 6);
  for (const bundle of catalogue) {
    assert.deepEqual(Object.keys(bundle).sort(), ["pages", "sha256", "sources"]);
    assert.match(bundle.sha256, /^[a-f0-9]{64}$/);
    for (const source of bundle.sources) {
      assert.deepEqual(Object.keys(source).sort(), ["offset", "pages", "sha256", "sourceId"]);
      assert.ok(source.offset >= 0 && source.offset + source.pages <= bundle.pages);
    }
  }
  const combined = catalogue.find((bundle) => bundle.sha256 === "ed2bb6813cd7569a2efabd4dd3f959203a433d7c3fa0943a8004cf2e7527ad84");
  assert.equal(combined.pages, 503);
  assert.deepEqual(combined.sources.map(({ sourceId, pages, offset }) => ({ sourceId, pages, offset })), [
    { sourceId: "src-1647be2784c9", pages: 240, offset: 0 },
    { sourceId: "src-580f7558db56", pages: 263, offset: 240 },
  ]);
  const complete = catalogue.find((bundle) => bundle.pages === 3762);
  assert.deepEqual(complete.sources.map(({ sourceId, offset }) => ({ sourceId, offset })), [
    { sourceId: "src-1647be2784c9", offset: 0 },
    { sourceId: "src-580f7558db56", offset: 1730 },
    { sourceId: "src-070c40bad24b", offset: 2099 },
  ]);
});
