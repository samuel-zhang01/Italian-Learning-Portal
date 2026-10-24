/** Derive readable source captions while retaining the original sidecar separately. */
const boundedSource = (value) => {
  if (typeof value !== "string" || Buffer.byteLength(value) > 5 * 1024 * 1024) throw new Error("UnboundedCaptionSource");
  return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
};

function sourceText(value) {
  const entities = { amp: "&", AMP: "&", lt: "<", LT: "<", gt: ">", GT: ">", quot: '"', QUOT: '"', apos: "'", nbsp: " ", agrave: "à", Agrave: "À", egrave: "è", Egrave: "È", eacute: "é", Eacute: "É", igrave: "ì", Igrave: "Ì", ograve: "ò", Ograve: "Ò", ugrave: "ù", Ugrave: "Ù" };
  return value.replace(/<v(?:\.[^\s>]+)*\s+([^>]+)>/g, "$1: ").replace(/<[^>]*>/g, "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code.startsWith("#")) {
      const number = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : "";
    }
    return entities[code] ?? whole;
  }).trim();
}

function recognizableProse(value) {
  return /\p{L}/u.test(value) && /\s|[.!?;,:"“”']/u.test(value) && !/^\s*(?:[\[{]|<!?\s*(?:html|doctype|head|body|script|style|form)\b)/i.test(value) && !value.includes("-->");
}

function timestamp(value) {
  if (!/^\d+(?::\d+){1,2}\.\d{3}$/.test(value)) return null;
  const [whole, milliseconds] = value.split(".");
  const fields = whole.split(":");
  if (fields.at(-1).length > 2 || Number(fields.at(-1)) >= 60 || fields.length === 3 && (fields[1].length > 2 || Number(fields[1]) >= 60)) return null;
  const seconds = fields.reduce((total, item) => total * 60 + Number(item), 0) + Number(milliseconds) / 1000;
  if (!Number.isFinite(seconds)) return null;
  return { seconds, canonical: /^(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}$/.test(value) };
}

export function parseStudyVTT(value, { recoverSourceText = false } = {}) {
  const source = boundedSource(value);
  if (!/^WEBVTT(?:[ \t][^\n]*)?\n/.test(source)) throw new Error("ExpectedWebVTT");
  const sourceBlocks = [], warnings = [];
  let cues = 0, recoveredUntimedBlocks = 0, noncanonicalTimingCues = 0;
  const blocks = source.split(/\n[ \t]*\n/);
  for (let block = 1; block < blocks.length; block++) {
    const raw = blocks[block];
    if (!raw.trim()) continue;
    const lines = raw.split("\n");
    if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/.test((lines[0] || "").trim())) continue;
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      const text = sourceText(raw);
      if (!recoverSourceText || !recognizableProse(text)) throw new Error("UnexpectedUntimedCaptionBlock");
      sourceBlocks.push({ block, kind: "untimed", text });
      warnings.push({ block, code: "untimed-source-block" });
      recoveredUntimedBlocks++;
      continue;
    }
    const timing = lines[timingIndex].trim();
    const match = timing.match(/^(\S+)\s+-->\s+(\S+)(?:\s.*)?$/);
    const start = match && timestamp(match[1]), end = match && timestamp(match[2]);
    if (!start || !end || lines.slice(timingIndex + 1).some((line) => line.includes("-->"))) throw new Error("InvalidCaptionTiming");
    const text = sourceText(lines.slice(timingIndex + 1).join("\n"));
    if (end.seconds < start.seconds) {
      if (!recoverSourceText || !recognizableProse(text)) throw new Error("InvalidCaptionTiming");
      sourceBlocks.push({ block, kind: "untimed", text, sourceTiming: timing });
      warnings.push({ block, code: "reversed-source-timing" });
      recoveredUntimedBlocks++;
      continue;
    }
    if (!start.canonical || !end.canonical) {
      if (!recoverSourceText) throw new Error("InvalidCaptionTiming");
      warnings.push({ block, code: "noncanonical-timestamp-width" });
      noncanonicalTimingCues++;
    }
    if (text) { sourceBlocks.push({ block, kind: "cue", text, timing }); cues++; }
  }
  if (!sourceBlocks.length) throw new Error("CaptionCuesRequired");
  return { text: sourceBlocks.map((item) => item.text).join("\n"), cues, sourceBlocks, warnings, recoveredUntimedBlocks, noncanonicalTimingCues };
}

export function parseStudyCaptions(value, extension = ".vtt", options = {}) {
  const normalized = boundedSource(value);
  if (normalized.startsWith("WEBVTT")) return { ...parseStudyVTT(value, options), format: "webvtt" };
  if (options.allowPlainTranscript && [".vtt", ".srt"].includes(extension.toLowerCase()) && !normalized.includes("-->") && recognizableProse(normalized)) {
    const sourceBlocks = normalized.split(/\n[ \t]*\n/).map((block, index) => ({ block: index + 1, kind: "untimed", text: sourceText(block) })).filter((block) => block.text);
    if (!sourceBlocks.length || sourceBlocks.some((block) => !recognizableProse(block.text))) throw new Error("UnexpectedUntimedCaptionBlock");
    return { text: sourceBlocks.map((block) => block.text).join("\n"), cues: 0, sourceBlocks, warnings: [{ block: 0, code: "missing-webvtt-header" }], recoveredUntimedBlocks: sourceBlocks.length, noncanonicalTimingCues: 0, format: "supplied-plain-transcript" };
  }
  if (extension.toLowerCase() !== ".srt") throw new Error("ExpectedWebVTT");
  if (!/(?:^|\n)\d{2,}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2,}:\d{2}:\d{2},\d{3}(?:\s|$)/m.test(normalized)) throw new Error("ExpectedSubRip");
  const converted = normalized.replace(/^(\d{2,}:\d{2}:\d{2}),(\d{3})(\s+-->\s+\d{2,}:\d{2}:\d{2}),(\d{3})(.*)$/gm, "$1.$2$3.$4$5");
  return { ...parseStudyVTT(`WEBVTT\n\n${converted}`, options), format: "subrip" };
}
