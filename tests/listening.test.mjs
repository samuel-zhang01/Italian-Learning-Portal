import test from "node:test";
import assert from "node:assert/strict";
import { createLocalAudioStore, listeningRange, listeningEndAction, transcriptLines } from "../app/learning/listening-model.ts";

test("local audio connects without reading bytes, preserves a valid connection on rejection and releases URLs once", () => {
  const created = [], revoked = [];
  const store = createLocalAudioStore({ createObjectURL: (file) => { created.push(file); return `blob:audio-${created.length}`; }, revokeObjectURL: (url) => revoked.push(url) });
  const first = { name: "personal.MP3", type: "", size: 100, arrayBuffer: () => assert.fail("audio bytes must not be read or uploaded") };
  assert.deepEqual(store.connect(first), { name: first.name, url: "blob:audio-1" });
  const snapshot = store.snapshot(); snapshot.url = "changed";
  assert.equal(store.snapshot().url, "blob:audio-1");
  for (const file of [{ name: "empty.wav", type: "audio/wav", size: 0 }, { name: "too-big.mp3", type: "audio/mpeg", size: 500_000_001 }, { name: "document.html", type: "text/html", size: 100 }]) {
    assert.equal(store.connect(file), null);
    assert.equal(store.snapshot().url, "blob:audio-1");
  }
  assert.deepEqual(revoked, []);
  store.connect({ name: "second.wav", type: "audio/wav", size: 44 });
  assert.deepEqual(revoked, ["blob:audio-1"]);
  store.clear(); store.clear();
  assert.deepEqual(revoked, ["blob:audio-1", "blob:audio-2"]);
  assert.equal(store.snapshot(), null);
  assert.equal(created.length, 2);
});

test("a failed object URL allocation cannot erase the previous recording", () => {
  let fail = false;
  const revoked = [];
  const store = createLocalAudioStore({ createObjectURL: () => { if (fail) throw new Error("allocation"); return "blob:good"; }, revokeObjectURL: (url) => revoked.push(url) });
  store.connect({ name: "good.wav", type: "audio/wav", size: 100 }); fail = true;
  assert.equal(store.connect({ name: "next.wav", type: "audio/wav", size: 100 }), null);
  assert.equal(store.snapshot().url, "blob:good"); assert.deepEqual(revoked, []);
  store.clear(); assert.deepEqual(revoked, ["blob:good"]);
});

test("section bounds and endpoint actions distinguish a single play from repeating", () => {
  const range = listeningRange(0.5, 1.25, 3);
  assert.deepEqual(range, { start: 0.5, end: 1.25 });
  assert.equal(listeningEndAction(1.2, range, false, true), null);
  assert.deepEqual(listeningEndAction(1.3, range, false, true), { type: "pause", time: 1.25 });
  assert.deepEqual(listeningEndAction(1.3, range, true, true), { type: "repeat", time: 0.5 });
  assert.equal(listeningEndAction(2, range, true, false), null, "ordinary full-recording playback is independent of section controls");
  assert.deepEqual(listeningRange(-2, 50, 3), { start: 0, end: 3 });
  for (const values of [[0, 0.2, 3], [2, 1, 3], [4, 5, 3], [0, 2, 0], [NaN, 2, 3], [0, Infinity, 3]]) assert.equal(listeningRange(...values), null);
});

test("progressive transcript lines retain supplied wording and never create timing", () => {
  assert.deepEqual(transcriptLines("  Ciao! Come stai?\r\nBene.\n\nGrazie.  "), ["Ciao!", "Come stai?", "Bene.", "Grazie."]);
  assert.deepEqual(transcriptLines(""), []);
  const supplied = "Una frase senza punto";
  assert.deepEqual(transcriptLines(supplied), [supplied]);
  assert.equal(transcriptLines("a".repeat(20_001))[0].length, 20_000);
});
