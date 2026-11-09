import { validateGeoJSON } from "@jorisvdmije/map-master";
import { defaultFields, emptyFilters, parseGeoJSON, schema, type AnalysisArea, type Dataset, type Fields, type Filters } from "./model";

export const analysisStorageKey = "map-master-analysis-recovery-v1";
export type AnalysisDocument = {
  format: "map-master-analysis"; version: 1; name: string;
  dataset: Dataset["data"]; areas: { type: "FeatureCollection"; features: AnalysisArea[] };
  fields: Fields; filters: Filters; activeArea: number | null;
};
export type RestoredAnalysis = { dataset: Dataset; areas: AnalysisArea[]; fields: Fields; filters: Filters; activeArea: number | null };
export function parseAnalysis(value: unknown): RestoredAnalysis {
  if (!value || typeof value !== "object" || !("format" in value) || value.format !== "map-master-analysis" || !("version" in value) || value.version !== 1 || !("dataset" in value) || !("areas" in value)) throw new Error("This analysis file is not supported.");
  const saved = value as unknown as Partial<AnalysisDocument>;
  const dataset = parseGeoJSON(saved.dataset, typeof saved.name === "string" ? saved.name : "Recovered analysis");
  const areas = parseGeoJSON(saved.areas, "Areas").data.features;
  if (areas.length > 200 || areas.some(f => f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) throw new Error("An analysis supports up to 200 polygon areas.");
  validateGeoJSON({ type: "FeatureCollection", features: areas });
  const defaults = defaultFields(dataset), available = schema(dataset), f = saved.fields, filter = saved.filters;
  const fields: Fields = f && typeof f === "object" ? { category: typeof f.category === "string" && available.fields.includes(f.category) ? f.category : defaults.category, metric: typeof f.metric === "string" && available.numeric.includes(f.metric) ? f.metric : defaults.metric, size: f.size === true } : defaults;
  const range = Array.isArray(filter?.range) && filter.range.length === 2 && filter.range.every(n => typeof n === "number" && Number.isFinite(n)) && filter.range[0] <= filter.range[1] ? filter.range as [number, number] : null;
  const filters: Filters = filter && typeof filter === "object" ? { category: typeof filter.category === "string" ? filter.category : null, query: typeof filter.query === "string" ? filter.query : "", range, rangeExclusive: filter.rangeExclusive === true } : { ...emptyFilters };
  return { dataset, areas: areas as AnalysisArea[], fields, filters, activeArea: typeof saved.activeArea === "number" && Number.isInteger(saved.activeArea) && saved.activeArea >= 0 && saved.activeArea < areas.length ? saved.activeArea : null };
}

/** Browser recovery: detect intervening saves and preserve corrupt saved copies.
 * The memory fallback also survives client navigation when browser storage fails.
 */
let memory: string | null = null;
let memoryBase: string | null = null;
export class AnalysisRecovery {
  readonly raw: string | null;
  private expected: string | null = null;
  initial: RestoredAnalysis | null;
  private saved = false;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.saved;
  private status(saved: boolean) { if (saved !== this.saved) { this.saved = saved; this.listeners.forEach(listener => listener()); } return saved; }
  blocked = false;
  unavailable = false;
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null) {
    let disk: string | null = null;
    try { disk = storage?.getItem(analysisStorageKey) ?? null; }
    catch { this.unavailable = true; }
    const raw = memory ?? disk;
    this.expected = memory ? memoryBase : disk;
    this.raw = raw;
    try { this.initial = raw ? parseAnalysis(JSON.parse(raw)) : null; }
    catch { this.initial = null; this.blocked = true; }
    if (!storage) this.unavailable = true;
  }
  rejectRestore() { this.initial = null; this.blocked = true; this.status(false); }
  write(document: AnalysisDocument): boolean {
    if (this.blocked) return this.status(false);
    const serialized = JSON.stringify(document);
    memory = serialized;
    try {
      if (!this.storage) return this.status(false);
      if (this.storage.getItem(analysisStorageKey) !== this.expected) {
        this.unavailable = true; return this.status(false);
      }
      this.storage.setItem(analysisStorageKey, serialized);
      this.expected = serialized; memoryBase = serialized;
      this.unavailable = false; return this.status(true);
    } catch { this.unavailable = true; return this.status(false); }
  }
  discardCorruptCopy() {
    // Removal must succeed before a new recovery copy can replace the old one.
    if (this.storage) {
      if (this.storage.getItem(analysisStorageKey) !== this.expected) throw new Error("Another tab saved a newer analysis. Download your copy and reload before continuing.");
      this.storage.removeItem(analysisStorageKey);
    }
    this.expected = null; memoryBase = null; memory = null; this.blocked = false;
  }
}
export function openAnalysisRecovery(): AnalysisRecovery {
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* In-memory recovery still works for client navigation. */ }
  return new AnalysisRecovery(storage);
}
