import type { Pair, Source } from "./types.ts";

export function sourcePageLabel(source: Source): Pair {
  if (source.pagination?.basis === "rendered-document") {
    return { en: "Rendered document pages", it: "Pagine del documento renderizzato" };
  }
  return source.path.toLowerCase().endsWith(".pptx")
    ? { en: "Slides", it: "Diapositive" }
    : { en: "PDF pages", it: "Pagine PDF" };
}
