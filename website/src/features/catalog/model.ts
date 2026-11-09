import { availability, themes, type Catalog, type CatalogEntry } from "./types";
export type CatalogFilters = {
  q: string;
  theme: string;
  availability: string;
  coverage: string;
  provider: string;
  saved: boolean;
};
export const defaultFilters: CatalogFilters = {
  q: "",
  theme: "all",
  availability: "all",
  coverage: "all",
  provider: "all",
  saved: false,
};
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("nl");
export function readFilters(
  search: string,
  entries: CatalogEntry[],
): CatalogFilters {
  const params = new URLSearchParams(search);
  const choice = (key: string, values: string[]) =>
    values.includes(params.get(key) ?? "") ? params.get(key)! : "all";
  return {
    q: (params.get("q") ?? "").slice(0, 200),
    theme: choice("theme", Object.keys(themes)),
    availability: choice("availability", Object.keys(availability)),
    coverage: choice("coverage", ["amsterdam", "netherlands"]),
    provider: choice("provider", [
      ...new Set(entries.map((entry) => entry.publisher)),
    ]),
    saved: params.get("saved") === "1",
  };
}
export function filterCatalog(
  entries: CatalogEntry[],
  filters: CatalogFilters,
  saved: readonly string[] = [],
) {
  const words = normalize(filters.q.trim()).split(/\s+/).filter(Boolean);
  return entries
    .filter(
      (entry) =>
        (filters.theme === "all" || entry.theme === filters.theme) &&
        (filters.availability === "all" ||
          entry.availability === filters.availability) &&
        (filters.coverage === "all" || entry.coverage === filters.coverage) &&
        (filters.provider === "all" || entry.publisher === filters.provider) &&
        (!filters.saved || saved.includes(entry.id)) &&
        words.every((word) =>
          normalize(
            [
              entry.title,
              entry.summary,
              entry.publisher,
              themes[entry.theme],
              entry.level,
              entry.time,
              entry.caveat,
              ...entry.tags,
              ...entry.formats,
              "Amsterdam",
              entry.coverage === "netherlands"
                ? "Nederland landelijk"
                : "gemeentelijk",
            ].join(" "),
          ).includes(word),
        ),
    )
    .sort(
      (a, b) =>
        ({ local: 0, connected: 1, source: 2 })[a.availability] -
          { local: 0, connected: 1, source: 2 }[b.availability] ||
        a.title.localeCompare(b.title, "nl"),
    );
}
export function parseSaved(raw: string, entries: CatalogEntry[]): string[] {
  try {
    if (raw.length > 16000) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const allowed = new Set(entries.map((entry) => entry.id));
    return [
      ...new Set(
        value.filter(
          (id): id is string => typeof id === "string" && allowed.has(id),
        ),
      ),
    ];
  } catch {
    return [];
  }
}
export const datasetPath = (id: string) => `/data/${encodeURIComponent(id)}/`;
export function metadataExport(
  catalog: Catalog,
  entries: CatalogEntry[],
  filters: CatalogFilters,
) {
  return {
    format: "map-master-data-catalog",
    version: 1,
    exportedAt: new Date().toISOString(),
    sourceLinksReviewedAt: catalog.checkedAt,
    filters,
    meaning:
      "Bronprofielen en downloadverwijzingen; dit bestand bevat geen volledige datasets en is geen live beschikbaarheidscontrole.",
    datasets: entries,
  };
}
export function catalogCsv(entries: CatalogEntry[]) {
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    return `"${(/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      [
        "ID",
        "Dataset",
        "Thema",
        "Aanbieder",
        "Dekking",
        "Niveau",
        "Bronperiode",
        "Beschikbaar",
        "Formaten",
        "Bron",
        "Betekenis en beperking",
      ],
      ...entries.map((entry) => [
        entry.id,
        entry.title,
        themes[entry.theme],
        entry.publisher,
        entry.coverage === "amsterdam" ? "Amsterdam" : "Nederland",
        entry.level,
        entry.time,
        availability[entry.availability],
        entry.formats.join(" / "),
        entry.source.url,
        entry.caveat,
      ]),
    ]
      .map((row) => row.map(cell).join(";"))
      .join("\r\n")
  );
}
