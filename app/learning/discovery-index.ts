import type { GrammarUnit, Mission, PageCompanion, Pair, Programme, Progress, Source, VocabularyBank } from "./types.ts";

export type DiscoveryKind = "grammar" | "lesson" | "programme" | "vocabulary" | "page" | "source";
export type DiscoveryLevel = "all" | "A1" | "A2";
export const discoveryKinds: DiscoveryKind[] = ["grammar", "lesson", "programme", "vocabulary", "page", "source"];
export type DiscoveryEntry = {
  id: string;
  kind: DiscoveryKind;
  title: Pair;
  summary: Pair;
  route: string;
  level: string | null;
  sources: { id: string; pages: number[] }[];
  pageKind?: PageCompanion["kind"];
  terms: string;
};
type Catalogue = {
  units: GrammarUnit[];
  missions: Mission[];
  programmes: Programme[];
  banks: VocabularyBank[];
  sources: Source[];
  pages: PageCompanion[];
  bankMissions?: Record<string, string[]>;
};

// This is search normalization only. Italian answer grading keeps its own rules.
export const normaliseSearch = (value: string) => value.normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2")
  .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const pairText = (pair: Pair) => `${pair.en} ${pair.it}`;
const aliases: Record<string, string> = {
  "a2-imperfetto": "imperfetto imperfect past habits background abitudini passato",
  "a2-past-narrative": "passato prossimo imperfetto imperfect past narrative",
  "a2-conditional": "condizionale conditional requests advice richieste consigli",
  "a1-partitive-ne": "ne partitivo partitive pronoun quantity quantita",
  "a1-locative-ci": "ci locativo locative places luoghi",
  "a2-subjunctive-forms": "congiuntivo subjunctive present presente",
  "a2-subjunctive-opinions": "congiuntivo subjunctive opinions opinioni",
};
export const grammarSearchText = (unit: GrammarUnit) => normaliseSearch([
  unit.id, pairText(unit.title), pairText(unit.summary), aliases[unit.id] ?? "",
  ...unit.teaching.map(pairText), ...unit.words.map(pairText),
].join(" "));

export function preferredGrammarUnitId(p: Progress, units: GrammarUnit[], programmes: Programme[]) {
  const done = (id: string) => Boolean(p.academy?.grammar[id]?.completed);
  const active = p.academy?.programme;
  const programme = programmes.find((item) => item.id === active?.id);
  if (programme && active) {
    for (const day of programme.days.slice(active.day)) {
      const eligible = day.unitIds.map((id) => units.find((unit) => unit.id === id))
        .find((unit) => unit && !done(unit.id) && unit.prerequisites.every(done));
      if (eligible) return eligible.id;
    }
  }
  return units.find((unit) => !done(unit.id))?.id ?? units[0]?.id;
}

export function buildDiscoveryIndex(data: Catalogue): DiscoveryEntry[] {
  const sourceById = new Map(data.sources.map((source) => [source.id, source]));
  const unitById = new Map(data.units.map((unit) => [unit.id, unit]));
  const sourceLevel = (source: Source) => {
    const title = normaliseSearch(`${source.title} ${source.path}`);
    return title.includes("nuovo espresso plus 2") ? "A2" : title.includes("nuovo espresso plus 1") ? "A1" : null;
  };
  const refs = (values: DiscoveryEntry["sources"]): DiscoveryEntry["sources"] => {
    const merged = new Map<string, Set<number>>();
    for (const ref of values) {
      const source = sourceById.get(ref.id);
      if (!source) continue;
      const pages = merged.get(ref.id) ?? new Set<number>();
      for (const page of ref.pages) if (Number.isInteger(page) && page > 0 && page <= source.pages) pages.add(page);
      merged.set(ref.id, pages);
    }
    return [...merged].map(([id, pages]) => ({ id, pages: [...pages].sort((a, b) => a - b) }));
  };
  const refText = (values: DiscoveryEntry["sources"]) => values.map((ref) => {
    const source = sourceById.get(ref.id);
    return `${source?.title ?? ""} ${source?.path ?? ""} ${ref.pages.join(" ")}`;
  }).join(" ");
  const levelOf = (units: GrammarUnit[]) => {
    const levels = new Set(units.map((unit) => unit.level));
    if (levels.has("A2") && (levels.has("A1") || levels.has("A1-plus"))) return "A1–A2";
    if (levels.has("A2")) return "A2";
    if (levels.has("A1-plus")) return "A1-plus";
    return levels.has("A1") ? "A1" : null;
  };
  const missionUnits = (id: string) => data.units.filter((unit) => unit.missionIds.includes(id));
  const missionLevel = (mission: Mission) => levelOf(missionUnits(mission.id)) ?? (mission.course === 3 ? "A1-plus" : "A1");
  const entries: DiscoveryEntry[] = [];
  const add = (entry: DiscoveryEntry) => entries.push({ ...entry, sources: refs(entry.sources), terms: normaliseSearch(`${entry.terms} ${refText(entry.sources)}`) });
  for (const unit of data.units) add({
    id: unit.id, kind: "grammar", title: unit.title, summary: unit.summary,
    route: `grammar/${unit.id}`, level: unit.level, sources: unit.sources,
    terms: grammarSearchText(unit),
  });
  for (const mission of data.missions) add({
    id: mission.id, kind: "lesson", title: mission.title, summary: mission.goal,
    route: `lesson/${mission.id}`, level: missionLevel(mission), sources: mission.sources,
    terms: `${pairText(mission.title)} ${pairText(mission.goal)} ${pairText(mission.rule)} ${missionUnits(mission.id).map(grammarSearchText).join(" ")}`,
  });
  for (const programme of data.programmes) {
    const units = [...new Set(programme.days.flatMap((day) => day.unitIds))].map((id) => unitById.get(id)).filter((unit): unit is GrammarUnit => Boolean(unit));
    add({ id: programme.id, kind: "programme", title: programme.title, summary: programme.summary,
      route: "programmes", level: levelOf(units), sources: refs(units.flatMap((unit) => unit.sources)),
      terms: `${pairText(programme.title)} ${pairText(programme.summary)} ${programme.days.map((day) => `${pairText(day.title)} ${pairText(day.outcome)}`).join(" ")} ${units.map(grammarSearchText).join(" ")}` });
  }
  for (const bank of data.banks) {
    const missions = data.missions.filter((mission) => data.bankMissions?.[bank.id]?.includes(mission.id));
    const levels = new Set(missions.map(missionLevel));
    const level = levels.has("A2") && levels.size > 1 ? "A1–A2" : [...levels][0] ?? null;
    add({ id: bank.id, kind: "vocabulary", title: bank.title,
      summary: { en: `${bank.words.length} words and phrases to practise with vocabulary cards.`, it: `${bank.words.length} parole ed espressioni da esercitare con le carte lessico.` },
      route: `vocabulary/${bank.id}`, level, sources: refs(missions.flatMap((mission) => mission.sources)),
      terms: `${pairText(bank.title)} ${bank.words.map((word) => pairText(word.term)).join(" ")} ${missions.map((mission) => `${pairText(mission.title)} ${pairText(mission.goal)}`).join(" ")}` });
  }
  for (const source of data.sources) {
    const first = data.pages.find((page) => page.sourceId === source.id);
    if (!first) continue;
    add({ id: source.id, kind: "source", title: { en: source.title, it: source.title },
      summary: { en: `${source.pages} physical pages / slides. Open its companion catalogue.`, it: `${source.pages} pagine / diapositive fisiche. Apri le schede della fonte.` },
      route: `companion/${first.id}`, level: sourceLevel(source), sources: [{ id: source.id, pages: [] }],
      terms: `${source.title} ${source.path}` });
  }
  for (const page of data.pages) {
    const source = sourceById.get(page.sourceId);
    if (!source) continue;
    add({ id: page.id, kind: "page", title: page.focus,
      summary: { en: `${source.title} · physical page ${page.page}`, it: `${source.title} · pagina fisica ${page.page}` },
      route: `companion/${page.id}`, level: sourceLevel(source) ?? levelOf(page.unitIds.map((id) => unitById.get(id)).filter((unit): unit is GrammarUnit => Boolean(unit))),
      sources: [{ id: source.id, pages: [page.page] }], pageKind: page.kind,
      terms: `${pairText(page.focus)} ${source.title} ${source.path} ${page.page} ${page.unitIds.map((id) => unitById.get(id)).filter((unit): unit is GrammarUnit => Boolean(unit)).map(grammarSearchText).join(" ")}` });
  }
  return entries;
}

export function searchDiscovery(index: DiscoveryEntry[], query: string, kind: DiscoveryKind | "all" = "all", level: DiscoveryLevel = "all") {
  const terms = normaliseSearch(query.slice(0, 200)).split(" ").filter(Boolean);
  const exact = (text: string, term: string) => text.startsWith(term) || text.includes(` ${term}`);
  const selected = index.filter((entry) => (kind === "all" || entry.kind === kind)
    && (level === "all" || (level === "A1" ? entry.level?.startsWith("A1") : entry.level === "A2" || entry.level === "A1–A2"))
    && terms.every((term) => exact(entry.terms, term)));
  if (!terms.length && kind === "all") {
    const groups = discoveryKinds.map((type) => selected.filter((entry) => entry.kind === type));
    return Array.from({ length: Math.max(0, ...groups.map((group) => group.length)) }, (_, i) => groups.map((group) => group[i]).filter((entry): entry is DiscoveryEntry => Boolean(entry))).flat();
  }
  const score = (entry: DiscoveryEntry) => terms.reduce((sum, term) => sum + (exact(normaliseSearch(pairText(entry.title)), term) ? 8 : 0), 0)
    + (entry.kind === "page" && terms.some((term) => /^\d+$/.test(term)) ? 20 : entry.kind === "grammar" ? 5 : 0);
  return selected.map((entry, order) => ({ entry, order, score: score(entry) }))
    .sort((a, b) => b.score - a.score || a.order - b.order).map(({ entry }) => entry);
}
