import type { Feature, FeatureCollection } from 'geojson';
import type { GeoJSONSource } from '../gl/map.js';
import { renderIdProperty } from './feature-styling.js';

type Diff = { remove: string[]; add: Feature[] };
/** Diff render IDs, including their type, rather than coercing numeric/string core IDs. */
export function sourceDiff(previous: ReadonlyMap<string, string>, collection: FeatureCollection): { diff: Diff; next: Map<string, string> } {
  const next = new Map<string, string>(), add: Feature[] = [], remove: string[] = [];
  for (const feature of collection.features) {
    const id = String(feature.properties![renderIdProperty]), fingerprint = JSON.stringify(feature);
    next.set(id, fingerprint);
    if (previous.get(id) !== fingerprint) {
      if (previous.has(id)) remove.push(id);
      add.push(feature);
    }
  }
  for (const id of previous.keys()) if (!next.has(id)) remove.push(id);
  return { diff: { remove, add }, next };
}

/** Serialize worker uploads. Mapbox retains its full setData path; MapLibre uses diffs.
 * A failed upload invalidates the baseline, so the next upload sends a full collection.
 */
export class CommittedSourceUpload {
  private queue = Promise.resolve();
  private baseline: Map<string, string> | undefined;
  private incremental = false;
  constructor(private readonly source: GeoJSONSource) {}

  upload(collection: FeatureCollection): Promise<void> {
    const result = this.queue.then(async () => {
      const { diff, next } = sourceDiff(this.baseline ?? new Map(), collection);
      if (this.baseline && diff.add.length === 0 && diff.remove.length === 0) return;
      const source = this.source;
      if (this.baseline && this.incremental && 'updateData' in source && typeof source.updateData === 'function') {
        await (source.updateData as (diff: Diff) => Promise<void>).call(source, diff);
      } else {
        const pending = source.setData(collection);
        // MapLibre's async setData/getData contract distinguishes it from Mapbox's
        // incompatible updateData(FeatureCollection) method. Never pass Mapbox a diff.
        this.incremental = !!pending && typeof (pending as Promise<unknown>).then === 'function'
          && 'getData' in source && typeof source.getData === 'function';
        await pending;
      }
      this.baseline = next;
    });
    this.queue = result.catch(() => { this.baseline = undefined; this.incremental = false; });
    return result;
  }
}
