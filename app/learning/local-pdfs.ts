import bundleCatalogue from "./pdf-bundles.json" with { type: "json" };
import type { Source } from "./types.ts";

export type LocalPdfResult = {
  name: string;
  status: "matched" | "unmatched" | "error" | "cancelled";
  sourceId?: string;
  sourceIds?: string[];
};
export type LocalPdfBundle = {
  sha256: string;
  pages: number;
  sources: { sourceId: string; sha256: string; pages: number; offset: number }[];
};
type LocalPdfSource = Pick<Source, "id" | "path" | "sha256"> & Partial<Pick<Source, "pages">>;
type LocalPdfFile = Blob & { name: string };
type ObjectUrls = {
  createObjectURL: (file: Blob) => string;
  revokeObjectURL: (url: string) => void;
};
type PageMapping = { sourceId: string; offset: number };

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_PAGES = 100_000;

function positivePageCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= MAX_PAGES;
}

// Invalid or ambiguous definitions never connect a file. Missing catalogue
// sources are allowed so a smaller course can use the same bundle metadata.
function knownBundles(sources: LocalPdfSource[], bundles: readonly LocalPdfBundle[]) {
  const result = new Map<string, PageMapping[]>();
  if (!Array.isArray(bundles) || bundles.length > 32) return result;
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const seenHashes = new Set<string>();
  for (const bundle of bundles) {
    if (!bundle || typeof bundle.sha256 !== "string" || !SHA256.test(bundle.sha256)) continue;
    if (seenHashes.has(bundle.sha256)) {
      result.delete(bundle.sha256);
      continue;
    }
    seenHashes.add(bundle.sha256);
    if (!positivePageCount(bundle.pages) || !Array.isArray(bundle.sources)
      || bundle.sources.length === 0 || bundle.sources.length > 32) continue;
    const sourceIds = new Set<string>();
    const ranges: { start: number; end: number }[] = [];
    const matches: PageMapping[] = [];
    let valid = true;
    for (const mapping of bundle.sources) {
      if (!mapping || typeof mapping.sourceId !== "string" || !mapping.sourceId.length
        || mapping.sourceId.length > 160 || sourceIds.has(mapping.sourceId)
        || typeof mapping.sha256 !== "string" || !SHA256.test(mapping.sha256)
        || !positivePageCount(mapping.pages) || !Number.isSafeInteger(mapping.offset)
        || mapping.offset < 0 || mapping.offset + mapping.pages > bundle.pages
        || ranges.some((range) => mapping.offset < range.end && mapping.offset + mapping.pages > range.start)) {
        valid = false;
        break;
      }
      sourceIds.add(mapping.sourceId);
      ranges.push({ start: mapping.offset, end: mapping.offset + mapping.pages });
      const source = sourceById.get(mapping.sourceId);
      if (!source) continue;
      if (!source.path.toLowerCase().endsWith(".pdf") || source.sha256 !== mapping.sha256
        || (source.pages !== undefined && source.pages !== mapping.pages)) {
        valid = false;
        break;
      }
      matches.push({ sourceId: source.id, offset: mapping.offset });
    }
    if (valid && matches.length) result.set(bundle.sha256, matches);
  }
  return result;
}

export function localPdfPageHref(url: string, page: number, offset = 0) {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(offset)
    || offset < 0 || !Number.isSafeInteger(page + offset)) {
    throw new RangeError("A local PDF page requires a positive page and a nonnegative offset.");
  }
  return `${url.split("#", 1)[0]}#page=${page + offset}`;
}

// Only source IDs, page offsets and temporary object URLs are retained. File
// bytes are read locally and never enter progress, storage or a request.
export function createLocalPdfStore(
  sources: LocalPdfSource[],
  urls: ObjectUrls = {
    createObjectURL: (file) => URL.createObjectURL(file),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  },
  bundles: readonly LocalPdfBundle[] = bundleCatalogue,
) {
  const byHash = new Map(
    sources
      .filter((source) => source.path.toLowerCase().endsWith(".pdf"))
      .map((source) => [source.sha256, source.id]),
  );
  const bundlesByHash = knownBundles(sources, bundles);
  const connections = new Map<string, { url: string; offset: number }>();
  let generation = 0;
  let disposed = false;
  function releaseUnused(candidates: Iterable<string>) {
    const retained = new Set(Array.from(connections.values(), (connection) => connection.url));
    for (const url of new Set(candidates)) {
      if (!retained.has(url)) urls.revokeObjectURL(url);
    }
  }
  function clear() {
    generation += 1;
    const released = Array.from(connections.values(), (connection) => connection.url);
    connections.clear();
    releaseUnused(released);
  }
  return {
    snapshot: (): Record<string, string> => Object.fromEntries(
      Array.from(connections, ([id, connection]) => [id, connection.url]),
    ),
    offsets: (): Record<string, number> => Object.fromEntries(
      Array.from(connections, ([id, connection]) => [id, connection.offset]),
    ),
    async connect(file: LocalPdfFile): Promise<LocalPdfResult> {
      const started = generation;
      if (disposed) return { name: file.name, status: "cancelled" };
      try {
        const bytes = await file.arrayBuffer();
        if (generation !== started) return { name: file.name, status: "cancelled" };
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        if (generation !== started) return { name: file.name, status: "cancelled" };
        const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const sourceId = byHash.get(sha256);
        const mappings = sourceId ? [{ sourceId, offset: 0 }] : bundlesByHash.get(sha256);
        if (!mappings) return { name: file.name, status: "unmatched" };
        const url = urls.createObjectURL(file);
        const released: string[] = [];
        for (const mapping of mappings) {
          const previous = connections.get(mapping.sourceId);
          if (previous) released.push(previous.url);
          connections.set(mapping.sourceId, { url, offset: mapping.offset });
        }
        releaseUnused(released);
        return sourceId
          ? { name: file.name, status: "matched", sourceId }
          : { name: file.name, status: "matched", sourceId: mappings[0].sourceId,
            sourceIds: mappings.map((mapping) => mapping.sourceId) };
      } catch {
        return { name: file.name, status: generation === started ? "error" : "cancelled" };
      }
    },
    disconnect(sourceId: string) {
      // A disconnect also cancels pending selections so they cannot restore it.
      generation += 1;
      const connection = connections.get(sourceId);
      if (!connection) return false;
      connections.delete(sourceId);
      releaseUnused([connection.url]);
      return true;
    },
    clear,
    dispose() {
      disposed = true;
      clear();
    },
  };
}
