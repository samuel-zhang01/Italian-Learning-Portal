import assert from "node:assert/strict";
import test from "node:test";
import { parseStudyCaptions, parseStudyVTT } from "../scripts/blink-study-captions.mjs";

test("source VTT keeps dialogue and speakers while excluding timing and metadata", () => {
  const source = "\uFEFFWEBVTT\r\nKind: captions\r\n\r\nNOTE private player metadata is not dialogue\r\nignore this block\r\n\r\nfirst\r\n00:00:01.000 --> 00:00:03.000 align:start\r\n<v Sara>Ciao &amp; benvenuti!</v>\r\n\r\n00:03.000 --> 00:04.500\r\n<c.highlight>&Egrave; un caff&egrave; &#xE8; buono.</c>\r\nSeconda riga.\r\n";
  const original = source;
  const caption = parseStudyCaptions(source);
  assert.equal(caption.format, "webvtt");
  assert.equal(caption.cues, 2);
  assert.equal(caption.text, "Sara: Ciao & benvenuti!\nÈ un caffè è buono.\nSeconda riga.");
  assert.deepEqual(caption.warnings, []);
  assert.equal(source, original);
});

test("SubRip captions retain all repeated cue text with strict format detection", () => {
  const source = "1\r\n00:00:01,000 --> 00:00:02,000\r\n<i>Buongiorno.</i>\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nBuongiorno.\r\n";
  const caption = parseStudyCaptions(source, ".srt");
  assert.equal(caption.format, "subrip"); assert.equal(caption.cues, 2); assert.equal(caption.text, "Buongiorno.\nBuongiorno.");
  assert.throws(() => parseStudyCaptions(source, ".vtt"), /ExpectedWebVTT/);
});

test("caption derivation rejects missing cues, unrelated responses and oversized sources", () => {
  assert.throws(() => parseStudyVTT("WEBVTT\n\nNOTE no dialogue\n"), /CaptionCuesRequired/);
  assert.throws(() => parseStudyCaptions("<html>Please sign in.</html>", ".srt"), /ExpectedSubRip/);
  assert.throws(() => parseStudyCaptions("Unstructured text", ".vtt"), /ExpectedWebVTT/);
  assert.throws(() => parseStudyCaptions("x".repeat(5 * 1024 * 1024 + 1)), /UnboundedCaptionSource/);
});

test("caption text keeps literal encoded markup as text and discards invalid Unicode references", () => {
  const source = "WEBVTT\n\n00:00.000 --> 00:01.000\n&lt;esempio&gt; &#x1F600; &#xD800; &#x110000;\n";
  const caption = parseStudyVTT(source);
  assert.equal(caption.text, "<esempio> 😀");
  assert.equal(caption.cues, 1);
});

test("source recovery preserves orphan dialogue and grammar paragraphs in original order", () => {
  const source = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nPrima frase.\n\nAh, Matteo! \n\nUna regola utile: il pronome segue l'imperativo&nbsp;informale.\n\n2\n00:00:03.000 --> 00:00:04.000\nUltima frase.\n";
  assert.throws(() => parseStudyVTT(source), /UnexpectedUntimedCaptionBlock/);
  const caption = parseStudyCaptions(source, ".vtt", { recoverSourceText: true });
  assert.equal(caption.text, "Prima frase.\nAh, Matteo!\nUna regola utile: il pronome segue l'imperativo informale.\nUltima frase.");
  assert.equal(caption.cues, 2); assert.equal(caption.recoveredUntimedBlocks, 2);
  assert.deepEqual(caption.sourceBlocks.map((block) => [block.block, block.kind]), [[1, "cue"], [2, "untimed"], [3, "untimed"], [4, "cue"]]);
  assert.ok(caption.sourceBlocks.filter((block) => block.kind === "untimed").every((block) => !("timing" in block)));
  assert.deepEqual(caption.warnings, [{ block: 2, code: "untimed-source-block" }, { block: 3, code: "untimed-source-block" }]);
});

test("source recovery retains unambiguous single-digit timestamp seconds without inventing timing", () => {
  const source = "WEBVTT\n\n00:00:03.560 --> 00:00:7.000\nPrimo dialogo.\n\n00:00:7.000 --> 00:00:12.040\nSecondo dialogo.\n";
  assert.throws(() => parseStudyVTT(source), /InvalidCaptionTiming/);
  const caption = parseStudyCaptions(source, ".vtt", { recoverSourceText: true });
  assert.equal(caption.text, "Primo dialogo.\nSecondo dialogo.");
  assert.equal(caption.noncanonicalTimingCues, 2);
  assert.equal(caption.sourceBlocks[0].timing, "00:00:03.560 --> 00:00:7.000");
  assert.ok(caption.warnings.every((warning) => warning.code === "noncanonical-timestamp-width"));
});

test("headerless supplied transcripts require explicit source authorization and retain untimed provenance", () => {
  const source = "Benvenuti alla lezione.\nOggi parliamo dei nostri programmi.\n\nChe cosa facciamo domani?\n";
  assert.throws(() => parseStudyCaptions(source), /ExpectedWebVTT/);
  const caption = parseStudyCaptions(source, ".vtt", { allowPlainTranscript: true });
  assert.equal(caption.format, "supplied-plain-transcript"); assert.equal(caption.cues, 0);
  assert.equal(caption.recoveredUntimedBlocks, 2);
  assert.ok(caption.sourceBlocks.every((block) => block.kind === "untimed" && !("timing" in block)));
  assert.deepEqual(caption.warnings, [{ block: 0, code: "missing-webvtt-header" }]);
  assert.throws(() => parseStudyCaptions("<html>Please sign in.</html>", ".vtt", { allowPlainTranscript: true }), /ExpectedWebVTT/);
});

test("source recovery keeps dialogue with reversed source timing as explicitly untimed text", () => {
  const source = "WEBVTT\n\n00:01:33.425 --> 00:01:31.488\nQuesta frase rimane al suo posto.\n\n00:01:34.000 --> 00:01:36.000\nSegue la seconda frase.\n";
  assert.throws(() => parseStudyVTT(source), /InvalidCaptionTiming/);
  const caption = parseStudyCaptions(source, ".vtt", { recoverSourceText: true });
  assert.equal(caption.text, "Questa frase rimane al suo posto.\nSegue la seconda frase.");
  assert.equal(caption.cues, 1); assert.equal(caption.recoveredUntimedBlocks, 1);
  assert.equal(caption.sourceBlocks[0].kind, "untimed");
  assert.equal(caption.sourceBlocks[0].sourceTiming, "00:01:33.425 --> 00:01:31.488");
  assert.ok(!("timing" in caption.sourceBlocks[0]));
  assert.deepEqual(caption.warnings, [{ block: 1, code: "reversed-source-timing" }]);
});
