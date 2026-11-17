import type { Dataset } from "./data/model";
import { getSource, sourceCatalog } from "./data/catalog";
import {
  mergeSource,
  validateSourceBundle,
  type SourceBundle,
} from "./data/source-loader";
import { importSeries, type Csv, type Mapping } from "./import";
import { parseWorkspace, type Workspace } from "./workspace";

export const STORAGE = "atlas-workspace-v1";
export const MAX_SESSION_BYTES = 9 * 1024 * 1024;
export type ImportEntry = { csv: Csv; mapping: Mapping };
export type Session = {
  format: "atlas";
  version: 1;
  workspace: Workspace;
  imports: ImportEntry[];
  sources?: SourceBundle[];
};
export function createSession(
  workspace: Workspace,
  imports: ImportEntry[],
  sources: SourceBundle[],
): Session {
  return {
    format: "atlas",
    version: 1,
    workspace: {
      ...workspace,
      name: workspace.name.trim() || "Naamloze werkruimte",
    },
    imports,
    sources,
  };
}
export function serializeSession(session: Session): string {
  const json = JSON.stringify(session);
  if (new TextEncoder().encode(json).length > MAX_SESSION_BYTES)
    throw new Error(
      "Deze werkruimte is te groot om veilig te bewaren. Gebruik minder geïmporteerde gegevens (maximaal 9 MB).",
    );
  return json;
}
export function restoreSession(
  value: unknown,
  base: Dataset,
): {
  workspace: Workspace;
  dataset: Dataset;
  imports: ImportEntry[];
  sources: SourceBundle[];
} {
  const fail = (): never => {
    throw new Error("Dit bestand is geen geldige Atlas-werkruimte.");
  };
  if (!value || typeof value !== "object") fail();
  const s = value as Session;
  if (
    s.format !== "atlas" ||
    s.version !== 1 ||
    !Array.isArray(s.imports) ||
    s.imports.length > 20 ||
    (s.sources !== undefined &&
      (!Array.isArray(s.sources) || s.sources.length > sourceCatalog.length))
  )
    fail();
  serializeSession(s);
  let dataset = base;
  const sources: SourceBundle[] = [];
  const seen = new Set<string>();
  for (const raw of s.sources ?? []) {
    const def = getSource(raw?.sourceId);
    if (!def || seen.has(def.id)) fail();
    const bundle = validateSourceBundle(raw, def!);
    dataset = mergeSource(dataset, bundle);
    seen.add(bundle.sourceId);
    sources.push(bundle);
  }
  const imports: ImportEntry[] = [];
  for (const entry of s.imports) {
    if (!entry || !entry.csv || !entry.mapping) fail();
    dataset = importSeries(dataset, entry.csv, entry.mapping);
    imports.push(structuredClone(entry));
  }
  return {
    workspace: parseWorkspace(
      s.workspace,
      dataset.variables.filter((v) => v.available).map((v) => v.id),
      dataset.years,
      dataset.areas.map((a) => a.code),
    ),
    dataset,
    imports,
    sources,
  };
}
